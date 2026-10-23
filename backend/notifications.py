"""Notification persistence (schema v2, client review 15 Oct 2026): one SQLite database per
deployment (a site's backend), every row scoped by site_id.

EKO stores notifications, acknowledgements, shelving and audit only; FIN stays the source of
truth and nothing here writes to FIN. Every row carries the site it belongs to, and a site is
only ever the FIN project the session actually reads: an unnamed project records nothing.
"""
import base64
import json
import os
import re
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

BUNDLE_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_RE = re.compile(r"^[A-Za-z0-9_.\-]+$")   # the FIN project-name rule (fin_client.PROJECT_ID_RE)
NOTIFICATION_RETENTION = timedelta(days=90)    # notifications + delivery history
RECORD_RETENTION = timedelta(days=730)         # acknowledgements, shelving + audit: 24 months
PURGE_EVERY = timedelta(hours=24)

MIGRATIONS = [
    (1, """
    CREATE TABLE notification_events (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
      fin_priority INTEGER CHECK (fin_priority BETWEEN 0 AND 255),
      source_kind TEXT,
      source_ref TEXT,
      asset_id TEXT,
      created_at TEXT NOT NULL,
      last_at TEXT NOT NULL,
      state TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'resolved')),
      resolved_at TEXT,
      dedup_key TEXT NOT NULL,
      params_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE UNIQUE INDEX ux_events_active_dedup ON notification_events (dedup_key) WHERE status = 'active';
    CREATE INDEX ix_events_site_asset_time ON notification_events (site_id, asset_id, created_at);
    CREATE INDEX ix_events_site_time ON notification_events (site_id, created_at);
    CREATE INDEX ix_events_site_type_time ON notification_events (site_id, type, created_at);

    CREATE TABLE notification_recipients (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES notification_events (id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT,
      channel TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      opened_at TEXT,
      dismissed_at TEXT,
      UNIQUE (event_id, user_id, channel)
    );
    CREATE INDEX ix_recipients_user_opened ON notification_recipients (user_id, opened_at);
    CREATE INDEX ix_recipients_user_event ON notification_recipients (user_id, event_id);

    CREATE TABLE alarm_acknowledgements (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      alarm_id TEXT NOT NULL,
      fin_record_id TEXT,
      occurrence_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT,
      acknowledged_at TEXT NOT NULL,
      origin TEXT,
      request_id TEXT,
      fin_sync_status TEXT,
      UNIQUE (site_id, alarm_id, occurrence_id)
    );

    CREATE TABLE alarm_shelving (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      alarm_id TEXT NOT NULL,
      occurrence_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 10080),
      shelved_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ended_at TEXT,
      ended_by TEXT
    );
    CREATE UNIQUE INDEX ux_shelving_active ON alarm_shelving (site_id, alarm_id, occurrence_id) WHERE ended_at IS NULL;

    CREATE TABLE notification_delivery_history (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES notification_events (id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX ix_delivery_event_time ON notification_delivery_history (event_id, occurred_at);
    CREATE INDEX ix_delivery_user_time ON notification_delivery_history (user_id, occurred_at);

    CREATE TABLE notification_audit_log (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      asset_id TEXT,
      origin TEXT,
      reason TEXT,
      occurred_at TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX ix_audit_site_time ON notification_audit_log (site_id, occurred_at);
    CREATE INDEX ix_audit_site_asset_time ON notification_audit_log (site_id, asset_id, occurred_at);
    CREATE INDEX ix_audit_site_actor_time ON notification_audit_log (site_id, actor_id, occurred_at);

    -- type '*' is the user's master toggle: off overrides every type
    CREATE TABLE notification_preferences (
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      PRIMARY KEY (user_id, type)
    );

    CREATE TABLE eko_role_mapping (
      user_id TEXT PRIMARY KEY,
      eko_role TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );
    """),
    # Data only, no schema change: events stored before project recipients existed get theirs,
    # so the history recorded so far is visible. New events get one in Store.condition.
    (2, """
    INSERT OR IGNORE INTO notification_recipients (id, event_id, user_id, role, channel, delivery_status)
    SELECT 'rcp_' || e.id, e.id, '#project:' || e.site_id, NULL, 'inapp', 'delivered' FROM notification_events e;
    """),
    # Who an event is for (role routing reads this in a later phase), and roles and preferences per
    # site. Existing events keep their shared project-wide visibility: audience ('project', site).
    # Preferences saved so far belong to a project recipient ('#project:<site>'): they keep that
    # site; a row with no site in its owner gets '' (no such rows are written by this code).
    (3, """
    CREATE TABLE notification_audience (
      event_id TEXT NOT NULL REFERENCES notification_events (id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('project', 'role', 'user')),
      value TEXT NOT NULL,
      PRIMARY KEY (event_id, kind, value)
    );
    CREATE INDEX ix_audience_kind_value ON notification_audience (kind, value);
    INSERT OR IGNORE INTO notification_audience (event_id, kind, value)
    SELECT id, 'project', site_id FROM notification_events;

    CREATE TABLE notification_preferences_v3 (
      user_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      PRIMARY KEY (user_id, site_id, type)
    );
    INSERT INTO notification_preferences_v3 (user_id, site_id, type, enabled)
    SELECT user_id, CASE WHEN substr(user_id, 1, 9) = '#project:' THEN substr(user_id, 10) ELSE '' END, type, enabled
    FROM notification_preferences;
    DROP TABLE notification_preferences;
    ALTER TABLE notification_preferences_v3 RENAME TO notification_preferences;

    CREATE TABLE eko_role_mapping_v3 (
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      eko_role TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (site_id, user_id)
    );
    INSERT INTO eko_role_mapping_v3 (site_id, user_id, eko_role, updated_by, updated_at)
    SELECT '', user_id, eko_role, updated_by, updated_at FROM eko_role_mapping;
    DROP TABLE eko_role_mapping;
    ALTER TABLE eko_role_mapping_v3 RENAME TO eko_role_mapping;
    """),
    # Per-user read/dismissed state and preferences. No row is rewritten: the project's shared recipient
    # ('#project:<site>') and its preferences stay as they are and become the BASELINE every user starts
    # from (what was read or dismissed so far stays so for everyone); a user's own rows, created when
    # that user first acts, override it for that user alone. This records, per site, how much state was
    # inherited, so the change is on the audit trail.
    (4, """
    INSERT OR IGNORE INTO notification_audit_log (id, site_id, actor_id, action, target_type, target_id, occurred_at, details_json)
    SELECT 'aud_mig4_' || s.site_id, s.site_id, 'system', 'notifications.per_user_state', 'site', s.site_id,
           strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
           '{"baseline_notifications":' || s.n || ',"baseline_opened":' || s.opened || ',"baseline_dismissed":' || s.dismissed
           || ',"baseline_preferences":' || (SELECT count(*) FROM notification_preferences x WHERE x.user_id = s.owner) || '}'
    FROM (SELECT user_id AS owner, substr(user_id, 10) AS site_id, count(*) AS n, count(opened_at) AS opened,
                 count(dismissed_at) AS dismissed
          FROM notification_recipients WHERE substr(user_id, 1, 9) = '#project:' GROUP BY user_id) s;
    """),
]


def utc_iso(when: datetime) -> str:
    return when.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def default_db_path() -> str:
    """Outside the export bundle, so unzipping a new export over the backend keeps the history."""
    if sys.platform == "win32" and os.environ.get("LOCALAPPDATA"):
        base = os.path.join(os.environ["LOCALAPPDATA"], "EKO-DT")
    else:
        base = os.path.join(os.path.expanduser("~"), ".local", "share", "eko-dt")
    return os.path.join(base, "notifications.sqlite3")


def resolve_db_path(configured: Optional[str]) -> str:
    """EKO_NOTIFICATION_DB, then config.json's notification_db_path, then the per-user default.
    A path inside the bundle is refused: a re-export would overwrite it."""
    path = os.path.abspath(os.environ.get("EKO_NOTIFICATION_DB") or configured or default_db_path())
    try:
        inside = os.path.commonpath([path, BUNDLE_DIR]) == BUNDLE_DIR
    except ValueError:   # another drive (Windows): outside by definition
        inside = False
    if inside:
        raise ValueError(f"notification database must be outside the backend bundle: {path}")
    return path


VIEWS = ("all", "unread", "read")            # read = opened (contract: POST /opened)
SEVERITIES = ("critical", "warning", "info")
CHANNEL = "inapp"                            # the only channel the contract defines
MASTER = "*"                                 # notification_preferences row for the master toggle
# Types a user can switch off so they are not shown at all: left out of their list, count and bulk actions.
# (alarm.critical is the one type the site creates for everyone; the others are the user's own anyway.)
USER_HIDEABLE = ("alarm.critical",)
# Read, dismissed and preference state is per signed-in user and site. The site's shared recipient
# ('#project:<site>', the state before per-user sign-in) is the baseline every user starts from: a
# user's own recipient row, created the first time that user acts on a notification, overrides it for
# that user alone. The baseline row is only ever read, so one user's action cannot reach another's.
# A real user id never starts with the reserved prefix (_check_user refuses one that does).
PROJECT_RECIPIENT_PREFIX = "#project:"


def project_recipient(site_id: str) -> str:
    return PROJECT_RECIPIENT_PREFIX + site_id


PAGE_DEFAULT, PAGE_MAX = 50, 100
SEARCHED = ("e.type", "e.asset_id", "e.source_ref", "e.params_json")
# u = this user's own row, p = the site's baseline row; the user's row wins once it exists.
# A notification is visible to a user when the event is for the whole project (audience) or the user
# has a row of their own for it. Placeholders: user id (the joins), then site id (the visibility test).
_OPENED = "(CASE WHEN u.id IS NULL THEN p.opened_at ELSE u.opened_at END)"
_DISMISSED = "(CASE WHEN u.id IS NULL THEN p.dismissed_at ELSE u.dismissed_at END)"
_JOINS = (
    " FROM notification_events e"
    f" LEFT JOIN notification_recipients u ON u.event_id = e.id AND u.user_id = ? AND u.channel = '{CHANNEL}'"
    f" LEFT JOIN notification_recipients p ON p.event_id = e.id AND p.user_id = '{PROJECT_RECIPIENT_PREFIX}' || e.site_id"
    f" AND p.channel = '{CHANNEL}'"
)
_VISIBLE = (
    "e.site_id = ? AND (u.id IS NOT NULL OR EXISTS (SELECT 1 FROM notification_audience a"
    " WHERE a.event_id = e.id AND a.kind = 'project' AND a.value = e.site_id))"
)
_ITEM_SQL = (
    "SELECT e.id, e.type, e.severity, e.site_id, e.asset_id, e.source_kind, e.source_ref, e.created_at,"
    f" e.params_json, {_OPENED} AS opened_at, {_DISMISSED} AS dismissed_at" + _JOINS
)
_STATE_SQL = f"SELECT e.id AS event_id, u.id AS own_id, {_OPENED} AS opened_at, {_DISMISSED} AS dismissed_at" + _JOINS


class StoreError(Exception):
    """The database could not answer. The message is always STORE_FAILED, so an API can show it
    as is; the SQLite detail stays on __cause__ for the server log only."""


STORE_FAILED = "notification storage failed"


def _check_user(user_id) -> None:
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("a user id is required")
    if user_id.startswith(PROJECT_RECIPIENT_PREFIX):
        raise ValueError("this user id is reserved")


def _check_ids(user_id, site_id) -> None:
    _check_user(user_id)
    if not isinstance(site_id, str) or not SITE_RE.match(site_id):
        raise ValueError("a valid site id is required")


def _check_text(name: str, value) -> None:
    """An optional filter: absent, or text (anything else is a bad request, not a database error)."""
    if value is not None and not isinstance(value, str):
        raise ValueError(f"{name} must be text")


def _check_notification_id(notification_id) -> None:
    if not isinstance(notification_id, str) or not notification_id:
        raise ValueError("a notification id is required")


def _params_json(params: Optional[dict]) -> str:
    # UTF-8, not \u escapes: search runs a LIKE over this text, and Arabic must match as typed
    return json.dumps(params or {}, ensure_ascii=False)


def _item(row) -> dict:
    """The contract's list item, less title/body/actions: those are rendered from type + params."""
    try:
        params = json.loads(row["params_json"] or "{}")
    except ValueError as exc:   # a stored row we cannot read is a storage fault, not a bad request
        raise StoreError(STORE_FAILED) from exc
    return {
        "id": row["id"], "type": row["type"], "severity": row["severity"], "site_id": row["site_id"],
        "asset_id": row["asset_id"], "source": {"kind": row["source_kind"], "id": row["source_ref"]},
        "created_at": row["created_at"], "opened_at": row["opened_at"], "dismissed_at": row["dismissed_at"],
        "params": params,
    }


def _encode_cursor(item: dict) -> str:
    raw = json.dumps([item["created_at"], item["id"]]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[str, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        created, last_id = json.loads(raw)
        if isinstance(created, str) and isinstance(last_id, str):
            return created, last_id
    except (ValueError, TypeError):
        pass
    raise ValueError("invalid cursor")


def _private(path: str) -> None:
    """Owner-only on POSIX (a database, its backup). Windows: the folder's ACL decides (README)."""
    if os.name == "posix":
        os.chmod(path, 0o600)


class Store:
    def __init__(self, path: str):
        # a folder this creates is the owner's only (POSIX; ignored on Windows); an existing one is left as set up
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        self.path = path
        # one writer, this process; not tied to the opening thread (a test client runs the app on its own)
        self.db = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        _private(path)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA busy_timeout=5000")
        self._migrate()
        self._purged_at: Optional[datetime] = None

    def _migrate(self) -> None:
        self.db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
        done = {r[0] for r in self.db.execute("SELECT version FROM schema_migrations")}
        pending = [(v, sql) for v, sql in MIGRATIONS if v not in done]
        if pending and done:   # a database that holds data: copy it as it is before changing it
            self.backup_path = self._backup(max(done))
        for version, sql in pending:
            # one transaction per version: a failed migration leaves the previous schema and data intact
            try:
                self.db.executescript(
                    f"BEGIN IMMEDIATE;\n{sql}\nINSERT INTO schema_migrations VALUES ({int(version)}, '{utc_iso(datetime.now(timezone.utc))}');\nCOMMIT;"
                )
            except sqlite3.Error:
                self._rollback()
                raise

    def _backup(self, version: int) -> str:
        """A consistent copy (SQLite's online backup, WAL included) next to the database:
        <name>.v<version>-<UTC time>.bak. A backup that fails stops the migration."""
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        target = f"{self.path}.v{int(version)}-{stamp}.bak"
        copy = sqlite3.connect(target)
        try:
            self.db.backup(copy)
        finally:
            copy.close()
        _private(target)
        return target

    def close(self) -> None:
        self.db.close()

    def condition(self, site_id: Optional[str], type_: str, active: bool, *, severity: str,
                  source_kind: str, source_ref: str, asset_id: Optional[str] = None,
                  state: str = "failed", params: Optional[dict] = None,
                  now: Optional[datetime] = None) -> Optional[str]:
        """A condition FIN reports on every poll: one active row while it holds (dedup key
        site + asset + type + state), resolved when it clears; a recurrence opens a new row.
        Returns the active row's id, or None when nothing is active (or there is no site)."""
        if not site_id or not SITE_RE.match(site_id):
            return None
        now = now or datetime.now(timezone.utc)
        stamp = utc_iso(now)
        key = "|".join([site_id, asset_id or "", type_, state])
        self._maybe_purge(now)
        row = self.db.execute(
            "SELECT id FROM notification_events WHERE dedup_key = ? AND status = 'active'", (key,)
        ).fetchone()
        if not active:
            if row:
                self.db.execute(
                    "UPDATE notification_events SET status = 'resolved', resolved_at = ?, last_at = ? WHERE id = ?",
                    (stamp, stamp, row["id"]),
                )
            return None
        if row:
            self.db.execute(
                "UPDATE notification_events SET last_at = ?, params_json = ? WHERE id = ?",
                (stamp, _params_json(params), row["id"]),
            )
            return row["id"]
        event_id = "ntf_" + uuid.uuid4().hex
        with self._write():   # the event, its audience and its project recipient together, or neither
            self.db.execute(
                "INSERT INTO notification_events (id, site_id, type, severity, source_kind, source_ref, asset_id,"
                " created_at, last_at, state, status, dedup_key, params_json) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?)",
                (event_id, site_id, type_, severity, source_kind, source_ref, asset_id, stamp, stamp, state, key,
                 _params_json(params)),
            )
            # everyone on the project, as every event so far; role routing (a later phase) narrows it
            self.db.execute("INSERT INTO notification_audience (event_id, kind, value) VALUES (?, 'project', ?)",
                            (event_id, site_id))
            self.db.execute(
                "INSERT INTO notification_recipients (id, event_id, user_id, role, channel, delivery_status)"
                " VALUES (?, ?, ?, NULL, ?, 'delivered')", ("rcp_" + event_id, event_id, project_recipient(site_id), CHANNEL),
            )
        return event_id

    def active_states(self, site_id: str, type_: str) -> list[tuple]:
        """(asset_id, state) of this site's still-active conditions of one type: what a poll that no
        longer sees them must resolve."""
        _check_ids("system", site_id)
        rows = self._read("SELECT asset_id, state FROM notification_events WHERE site_id = ? AND type = ? AND status = 'active'",
                          [site_id, type_])
        return [(r["asset_id"], r["state"]) for r in rows]

    def events(self, site_id: str) -> list[dict]:
        """A site's events, newest first. Never another site's."""
        rows = self.db.execute(
            "SELECT * FROM notification_events WHERE site_id = ? ORDER BY created_at DESC, rowid DESC", (site_id,)
        )
        return [dict(r) for r in rows]

    # ── Recipient reads and writes (contract §2). user_id and site_id are trusted values from the
    # server's own user session, never from a request (main._notification_scope).

    def list_notifications(self, user_id: str, site_id: str, *, view: str = "all", type_: Optional[str] = None,
                           severity: Optional[str] = None, asset_id: Optional[str] = None,
                           q: Optional[str] = None, limit: int = PAGE_DEFAULT,
                           cursor: Optional[str] = None) -> dict:
        """One recipient's in-app notifications on one site, newest first. Dismissed ones are not
        listed (dismiss hides, it does not delete). Bad input raises ValueError; a storage failure
        raises StoreError.

        Paging is keyset on (event created_at, id), both descending; ties on created_at are
        ordered by id, so no row is repeated or skipped across pages. A notification created after
        the first page is not on later pages (it is newer than the cursor): it shows on the next
        fresh listing. Backdated rows are not supported mid-walk: an event whose created_at falls
        in the part already read (an old event delivered late, a backdated insert) is skipped by
        that walk and shows only when the list is read again from the start."""
        _check_ids(user_id, site_id)
        if view not in VIEWS:
            raise ValueError(f"view must be one of {VIEWS}")
        if severity is not None and severity not in SEVERITIES:
            raise ValueError(f"severity must be one of {SEVERITIES}")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= PAGE_MAX:
            raise ValueError(f"limit must be 1..{PAGE_MAX}")
        for name, value in (("type", type_), ("asset_id", asset_id), ("q", q)):
            _check_text(name, value)
        hide, hidden = self._hidden(user_id, site_id)
        sql = [_ITEM_SQL, "WHERE", _VISIBLE + hide, f"AND {_DISMISSED} IS NULL"]
        args: list = [user_id, site_id, *hidden]
        if view == "unread":
            sql.append(f"AND {_OPENED} IS NULL")
        elif view == "read":
            sql.append(f"AND {_OPENED} IS NOT NULL")
        for column, value in (("e.type", type_), ("e.severity", severity), ("e.asset_id", asset_id)):
            if value is not None:
                sql.append(f"AND {column} = ?")
                args.append(value)
        if q:
            like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            sql.append("AND (" + " OR ".join(f"{c} LIKE ? ESCAPE '\\'" for c in SEARCHED) + ")")
            args += [like] * len(SEARCHED)
        if cursor:
            created, last_id = _decode_cursor(cursor)
            sql.append("AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?))")
            args += [created, created, last_id]
        sql.append("ORDER BY e.created_at DESC, e.id DESC LIMIT ?")
        args.append(limit + 1)
        rows = self._read(" ".join(sql), args)
        items = [_item(r) for r in rows[:limit]]
        more = len(rows) > limit
        return {"items": items, "next_cursor": _encode_cursor(items[-1]) if more else None}

    def get_notification(self, user_id: str, site_id: str, notification_id: str) -> Optional[dict]:
        """The notification only when it is visible to this user on this site, else None (the caller
        answers 404 either way, so another site's id reveals nothing), with this user's own state."""
        _check_ids(user_id, site_id)
        _check_notification_id(notification_id)
        hide, hidden = self._hidden(user_id, site_id)
        rows = self._read(_ITEM_SQL + " WHERE e.id = ? AND " + _VISIBLE + hide, [user_id, notification_id, site_id, *hidden])
        return _item(rows[0]) if rows else None

    def mark_opened(self, user_id: str, site_id: str, notification_id: str,
                    now: Optional[datetime] = None) -> Optional[dict]:
        """Set opened_at once; repeating it changes nothing. None when not this user's on this site."""
        return self._stamp_once("opened_at", "opened", user_id, site_id, notification_id, now)

    def dismiss(self, user_id: str, site_id: str, notification_id: str,
                now: Optional[datetime] = None) -> Optional[dict]:
        """Set dismissed_at once (never deletes); repeating it changes nothing."""
        return self._stamp_once("dismissed_at", "dismissed", user_id, site_id, notification_id, now)

    def undismiss(self, user_id: str, site_id: str, notification_id: str,
                  now: Optional[datetime] = None) -> Optional[dict]:
        """Undo this user's dismiss (the bell's Undo). A notification that is not dismissed is left alone."""
        _check_ids(user_id, site_id)
        _check_notification_id(notification_id)
        stamp = utc_iso(now or datetime.now(timezone.utc))
        hide, hidden = self._hidden(user_id, site_id)
        with self._write():
            row = self.db.execute(_STATE_SQL + " WHERE e.id = ? AND " + _VISIBLE + hide,
                                  (user_id, notification_id, site_id, *hidden)).fetchone()
            if row is None:
                return None
            if row["dismissed_at"] is not None:
                self._set_own(user_id, row, "dismissed_at", None)
                self._history(notification_id, user_id, "undismissed", stamp)
        return self.get_notification(user_id, site_id, notification_id)

    def unread_count(self, user_id: str, site_id: str) -> int:
        """Listed (not dismissed) notifications not yet opened, for this recipient on this site."""
        _check_ids(user_id, site_id)
        hide, hidden = self._hidden(user_id, site_id)
        rows = self._read(
            "SELECT count(*) AS n" + _JOINS + f" WHERE {_VISIBLE}{hide} AND {_OPENED} IS NULL AND {_DISMISSED} IS NULL",
            [user_id, site_id, *hidden])
        return int(rows[0]["n"])

    def mark_all_opened(self, user_id: str, site_id: str, now: Optional[datetime] = None) -> int:
        """Open every listed, unopened notification (the bell's "mark all read"). Returns how many."""
        return self._stamp_all("opened_at", "opened", f"{_DISMISSED} IS NULL", user_id, site_id, now)

    def dismiss_opened(self, user_id: str, site_id: str, now: Optional[datetime] = None) -> int:
        """Dismiss every opened notification still listed (the bell's "archive read"). Returns how many."""
        return self._stamp_all("dismissed_at", "dismissed", f"{_OPENED} IS NOT NULL", user_id, site_id, now)

    def _stamp_all(self, column: str, status: str, also: str, user_id: str, site_id: str,
                   now: Optional[datetime]) -> int:
        _check_ids(user_id, site_id)
        stamp = utc_iso(now or datetime.now(timezone.utc))
        state = {"opened_at": _OPENED, "dismissed_at": _DISMISSED}[column]
        hide, hidden = self._hidden(user_id, site_id)   # a notification the user cannot see is not theirs to open or dismiss
        with self._write():
            rows = self.db.execute(_STATE_SQL + f" WHERE {_VISIBLE}{hide} AND {state} IS NULL AND {also}",
                                   (user_id, site_id, *hidden)).fetchall()
            for r in rows:
                self._set_own(user_id, r, column, stamp)
                self._history(r["event_id"], user_id, status, stamp)
        return len(rows)

    def _stamp_once(self, column: str, status: str, user_id: str, site_id: str, notification_id: str,
                    now: Optional[datetime]) -> Optional[dict]:
        _check_ids(user_id, site_id)
        _check_notification_id(notification_id)
        stamp = utc_iso(now or datetime.now(timezone.utc))
        hide, hidden = self._hidden(user_id, site_id)
        with self._write():
            row = self.db.execute(_STATE_SQL + " WHERE e.id = ? AND " + _VISIBLE + hide,
                                  (user_id, notification_id, site_id, *hidden)).fetchone()
            if row is None:
                return None
            if row[column] is None:   # the first time only: a repeat leaves the time and the history alone
                self._set_own(user_id, row, column, stamp)
                self._history(notification_id, user_id, status, stamp)
        return self.get_notification(user_id, site_id, notification_id)

    def _set_own(self, user_id: str, row, column: str, value: Optional[str]) -> None:
        """Set one state column on THIS user's recipient row. The row is created on the first write,
        starting from the state the user was seeing (the site baseline), so nothing else changes."""
        if row["own_id"] is None:
            self.db.execute(
                "INSERT INTO notification_recipients (id, event_id, user_id, role, channel, delivery_status, opened_at, dismissed_at)"
                " VALUES (?, ?, ?, NULL, ?, 'delivered', ?, ?)",
                ("rcp_" + uuid.uuid4().hex, row["event_id"], user_id, CHANNEL, row["opened_at"], row["dismissed_at"]),
            )
        self.db.execute(f"UPDATE notification_recipients SET {column} = ? WHERE event_id = ? AND user_id = ? AND channel = ?",
                        (value, row["event_id"], user_id, CHANNEL))

    def _history(self, event_id: str, user_id: str, status: str, stamp: str) -> None:
        self.db.execute(
            "INSERT INTO notification_delivery_history (id, event_id, user_id, channel, status, occurred_at)"
            " VALUES (?, ?, ?, ?, ?, ?)", ("dlv_" + uuid.uuid4().hex, event_id, user_id, CHANNEL, status, stamp),
        )

    def _hidden(self, user_id: str, site_id: str) -> tuple[str, list]:
        """(SQL clause, args) leaving out the types this user's EFFECTIVE preferences switch off: their own
        toggle over the site's baseline, or their master toggle off. One rule for the list, its pages, the
        unread count and the bulk actions, so they always describe the same notifications. It only narrows
        what one user sees: whether the site creates a type is decided elsewhere (project_wants)."""
        prefs = self.get_preferences(user_id, site_id)
        off = [t for t in USER_HIDEABLE if not prefs["master_enabled"] or prefs["types"].get(t) is False]
        return (" AND e.type NOT IN (" + ",".join("?" * len(off)) + ")", off) if off else ("", [])

    def _saved(self, owner: str, site_id: str) -> dict:
        rows = self._read("SELECT type, enabled FROM notification_preferences WHERE user_id = ? AND site_id = ?", [owner, site_id])
        return {r["type"]: bool(r["enabled"]) for r in rows}

    def get_preferences(self, user_id: str, site_id: str) -> dict:
        """{"master_enabled", "types": {type: enabled}} for this user on this site: the user's own
        toggles over the site's baseline ones. A type with no saved toggle is absent: its default
        comes from the type registry, not from here. No saved master means on."""
        _check_ids(user_id, site_id)
        saved = {**self._saved(project_recipient(site_id), site_id), **self._saved(user_id, site_id)}
        return {"master_enabled": saved.pop(MASTER, True), "types": saved}

    def update_preferences(self, user_id: str, site_id: str, *, master_enabled: Optional[bool] = None,
                           types: Optional[dict] = None) -> dict:
        """Save the given toggles for this user on this site in one transaction (all or none);
        toggles not given are kept. The site's baseline is never touched from here."""
        _check_ids(user_id, site_id)
        self._save_preferences(user_id, site_id, master_enabled, types)
        return self.get_preferences(user_id, site_id)

    def update_project_preferences(self, site_id: str, *, master_enabled: Optional[bool] = None,
                                   types: Optional[dict] = None) -> None:
        """The site's baseline toggles (what every user starts from, and the site-level switch for
        whether alarm.critical notifications are created). No HTTP route reaches this: it is the
        seam for the later administration phase and for operators."""
        _check_ids("system", site_id)
        self._save_preferences(project_recipient(site_id), site_id, master_enabled, types)

    def project_wants(self, site_id: str, type_: str, default: bool) -> bool:
        """Whether the SITE creates notifications of this type (its baseline master and toggle,
        else the caller's default): one setting for the project, not any user's preference."""
        _check_ids("system", site_id)
        saved = self._saved(project_recipient(site_id), site_id)
        return saved.get(MASTER, True) and saved.get(type_, default)

    def _save_preferences(self, owner: str, site_id: str, master_enabled, types) -> None:
        if master_enabled is not None and not isinstance(master_enabled, bool):
            raise ValueError("master_enabled must be true or false")
        types = types or {}
        if not isinstance(types, dict):
            raise ValueError("types must map a type to true or false")
        for key, value in types.items():
            if not isinstance(key, str) or not key.strip() or key == MASTER:
                raise ValueError(f"invalid notification type: {key!r}")
            if not isinstance(value, bool):
                raise ValueError(f"{key} must be true or false")
        changes = list(types.items()) + ([(MASTER, master_enabled)] if master_enabled is not None else [])
        with self._write():
            self.db.executemany(
                "INSERT INTO notification_preferences (user_id, site_id, type, enabled) VALUES (?, ?, ?, ?)"
                " ON CONFLICT (user_id, site_id, type) DO UPDATE SET enabled = excluded.enabled",
                [(owner, site_id, key, int(value)) for key, value in changes],
            )

    def role_of(self, site_id: str, user_id: str) -> Optional[str]:
        """The EKO role mapped to this user on this site, or None. Read only: mapping is a later phase."""
        _check_ids(user_id, site_id)
        rows = self._read("SELECT eko_role FROM eko_role_mapping WHERE site_id = ? AND user_id = ?", [site_id, user_id])
        return rows[0]["eko_role"] if rows else None

    def wants(self, user_id: str, site_id: str, type_: str, default: bool) -> bool:
        """Whether this user wants notifications of this type on this site: master off overrides
        every type; otherwise the saved toggle, else the type's registry default (the caller's)."""
        prefs = self.get_preferences(user_id, site_id)
        return prefs["master_enabled"] and prefs["types"].get(type_, default)

    def _read(self, sql: str, args: list) -> list:
        try:
            return self.db.execute(sql, args).fetchall()
        except sqlite3.Error as exc:
            raise StoreError(STORE_FAILED) from exc

    @contextmanager
    def _write(self):
        """One write transaction: committed whole, or rolled back and raised as StoreError."""
        try:
            self.db.execute("BEGIN IMMEDIATE")
        except sqlite3.Error as exc:
            raise StoreError(STORE_FAILED) from exc
        try:
            yield
            self.db.execute("COMMIT")
        except sqlite3.Error as exc:
            self._rollback()
            raise StoreError(STORE_FAILED) from exc
        except BaseException:
            self._rollback()
            raise

    def _rollback(self) -> None:
        # SQLite may already have rolled back (RAISE(ROLLBACK), some I/O errors): a second
        # ROLLBACK would fail and hide the error that caused it
        if self.db.in_transaction:
            try:
                self.db.execute("ROLLBACK")
            except sqlite3.Error:
                pass

    def purge(self, now: Optional[datetime] = None) -> None:
        """Notifications + delivery history after 90 days (a condition still active is kept);
        acknowledgements, shelving and audit after 24 months."""
        now = now or datetime.now(timezone.utc)
        short, long_ = utc_iso(now - NOTIFICATION_RETENTION), utc_iso(now - RECORD_RETENTION)
        with self._write():   # all of it or none of it
            self.db.execute("DELETE FROM notification_delivery_history WHERE occurred_at < ?", (short,))
            # recipients and any remaining delivery history go with their event (ON DELETE CASCADE)
            self.db.execute("DELETE FROM notification_events WHERE status = 'resolved' AND last_at < ?", (short,))
            self.db.execute("DELETE FROM alarm_acknowledgements WHERE acknowledged_at < ?", (long_,))
            # a shelf still in force is kept however old (ending expired shelves is not built yet)
            self.db.execute("DELETE FROM alarm_shelving WHERE ended_at IS NOT NULL AND ended_at < ?", (long_,))
            # audit rows outlive the notifications they name: target_id is not a foreign key on purpose
            self.db.execute("DELETE FROM notification_audit_log WHERE occurred_at < ?", (long_,))
        self._purged_at = now

    def _maybe_purge(self, now: datetime) -> None:
        if self._purged_at is None or now - self._purged_at >= PURGE_EVERY:
            self.purge(now)


_store: Optional[Store] = None
_configured: Optional[str] = None


def configure(db_path: Optional[str]) -> None:
    """config.json's notification_db_path; the store opens on first use."""
    global _configured
    _configured = db_path or None


def store() -> Store:
    """The deployment's store, opened on first use; a store that cannot open is a StoreError."""
    global _store
    if _store is None:
        try:
            _store = Store(resolve_db_path(_configured))
        except (sqlite3.Error, OSError, ValueError) as exc:
            raise StoreError(STORE_FAILED) from exc
    return _store


def condition(site_id: Optional[str], type_: str, active: bool, **fields) -> Optional[str]:
    """Store.condition on the site database. A storage failure is logged and never stops
    the polling that reported the condition."""
    try:
        return store().condition(site_id, type_, active, **fields)
    except (sqlite3.Error, StoreError, OSError, ValueError) as exc:
        print(f"[notifications] {type_} not recorded: {exc.__cause__ or exc}")
        return None
