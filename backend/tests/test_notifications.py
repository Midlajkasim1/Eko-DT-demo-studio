"""Notification persistence: schema, dedup and condition lifecycle, site isolation, retention, and
the one trigger wired so far (the FIN work-order read for the site this session reads)."""
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from fake_fin import FakeFinClient  # noqa: E402  (sets EKO_NOTIFICATION_DB before main can write)
import main  # noqa: E402
import notifications  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

T0 = datetime(2026, 10, 16, 8, 0, tzinfo=timezone.utc)
SYNC = dict(severity="warning", source_kind="integration", source_ref="fin-workorders")


def iso(when):
    return notifications.utc_iso(when)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="eko-notif-test-")
        self.store = notifications.Store(os.path.join(self.dir, "n.sqlite3"))

    def tearDown(self):
        self.store.close()

    def rows(self, site):
        return self.store.events(site)

    def test_schema_is_migrated_once_with_wal_foreign_keys_and_full_sync(self):
        db = self.store.db
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertTrue({"notification_events", "notification_recipients", "alarm_acknowledgements", "alarm_shelving",
                         "notification_delivery_history", "notification_audit_log", "notification_preferences",
                         "schema_migrations", "eko_role_mapping"} <= tables)
        self.assertEqual(db.execute("PRAGMA journal_mode").fetchone()[0], "wal")
        self.assertEqual(db.execute("PRAGMA foreign_keys").fetchone()[0], 1)
        self.assertEqual(db.execute("PRAGMA synchronous").fetchone()[0], 2)   # FULL
        self.store.close()
        self.store = notifications.Store(self.store.path)                    # reopening applies nothing twice
        self.assertEqual([r[0] for r in self.store.db.execute("SELECT version FROM schema_migrations ORDER BY version")],
                         [v for v, _ in notifications.MIGRATIONS])   # each version exactly once, in order

    def test_migration_2_gives_existing_events_their_project_recipient_once(self):
        db = self.store.db
        db.execute("INSERT INTO notification_events (id, site_id, type, severity, created_at, last_at, state, status, dedup_key)"
                   " VALUES ('ntf_old', 'siteA', 'int.sync_failed', 'warning', 'x', 'x', 'failed', 'resolved', 'k-old')")
        db.execute("DELETE FROM schema_migrations WHERE version = 2")   # as if this store predates migration 2
        self.store.close()
        self.store = notifications.Store(self.store.path)
        self.store.close()
        self.store = notifications.Store(self.store.path)               # reopened: not applied twice
        rows = [tuple(r) for r in self.store.db.execute("SELECT event_id, user_id, channel FROM notification_recipients")]
        self.assertEqual(rows, [("ntf_old", "#project:siteA", "inapp")])
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM schema_migrations WHERE version = 2").fetchone()[0], 1)

    def test_a_new_condition_comes_with_its_project_recipient(self):
        eid = self.store.condition("siteA", "int.sync_failed", True, **SYNC)
        self.store.condition("siteA", "int.sync_failed", True, **SYNC)     # a repeat poll adds no second recipient
        rows = [tuple(r) for r in self.store.db.execute("SELECT event_id, user_id FROM notification_recipients")]
        self.assertEqual(rows, [(eid, notifications.project_recipient("siteA"))])
        self.assertEqual(self.store.list_notifications("u1", "siteA")["items"][0]["id"], eid)   # for the whole project

    def test_repeated_polls_keep_one_active_row(self):
        ids = {self.store.condition("siteA", "int.sync_failed", True, now=T0 + timedelta(seconds=30 * i), **SYNC)
               for i in range(5)}
        self.assertEqual(len(ids), 1)
        [row] = self.rows("siteA")
        self.assertEqual((row["status"], row["created_at"], row["last_at"]), ("active", iso(T0), iso(T0 + timedelta(seconds=120))))

    def test_condition_resolves_and_a_recurrence_is_a_new_row(self):
        first = self.store.condition("siteA", "int.sync_failed", True, now=T0, **SYNC)
        self.assertIsNone(self.store.condition("siteA", "int.sync_failed", False, now=T0 + timedelta(minutes=1), **SYNC))
        self.store.condition("siteA", "int.sync_failed", False, now=T0 + timedelta(minutes=2), **SYNC)   # still clear: no-op
        second = self.store.condition("siteA", "int.sync_failed", True, now=T0 + timedelta(minutes=3), **SYNC)
        self.assertNotEqual(first, second)
        by_id = {r["id"]: r for r in self.rows("siteA")}
        self.assertEqual((by_id[first]["status"], by_id[first]["resolved_at"]), ("resolved", iso(T0 + timedelta(minutes=1))))
        self.assertEqual(by_id[second]["status"], "active")

    def test_dedup_key_is_site_asset_type_state(self):
        self.store.condition("siteA", "t", True, asset_id="AHU-1", **SYNC)
        self.store.condition("siteA", "t", True, asset_id="AHU-2", **SYNC)
        self.store.condition("siteA", "t", True, asset_id="AHU-1", state="other", **SYNC)
        self.store.condition("siteA", "t", True, asset_id="AHU-1", **SYNC)
        self.assertEqual(sorted(r["dedup_key"] for r in self.rows("siteA")),
                         ["siteA|AHU-1|t|failed", "siteA|AHU-1|t|other", "siteA|AHU-2|t|failed"])

    def test_sites_never_share_rows(self):
        self.store.condition("siteA", "int.sync_failed", True, **SYNC)
        self.store.condition("siteB", "int.sync_failed", True, **SYNC)
        self.store.condition("siteA", "int.sync_failed", False, **SYNC)
        self.assertEqual([r["status"] for r in self.rows("siteA")], ["resolved"])
        self.assertEqual([r["status"] for r in self.rows("siteB")], ["active"])   # A clearing never touches B
        self.assertTrue(all(r["site_id"] == "siteB" for r in self.rows("siteB")))

    def test_unnamed_or_invalid_site_records_nothing(self):
        for site in (None, "", "../x", "a b"):
            self.assertIsNone(self.store.condition(site, "int.sync_failed", True, **SYNC), site)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM notification_events").fetchone()[0], 0)

    def test_schema_enforces_one_active_row_and_foreign_keys(self):
        self.store.condition("siteA", "t", True, **SYNC)
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.db.execute(
                "INSERT INTO notification_events (id, site_id, type, severity, created_at, last_at, state, status, dedup_key)"
                " VALUES ('dup', 'siteA', 't', 'warning', 'x', 'x', 'failed', 'active', 'siteA||t|failed')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.db.execute("INSERT INTO notification_recipients (id, event_id, user_id, channel, delivery_status)"
                                  " VALUES ('r', 'no-such-event', 'u', 'inapp', 'pending')")
        with self.assertRaises(sqlite3.IntegrityError):   # shelving: a reason is required, over 7 days refused
            self.store.db.execute("INSERT INTO alarm_shelving (id, site_id, alarm_id, occurrence_id, user_id, reason,"
                                  " duration_minutes, shelved_at, expires_at) VALUES ('s', 'siteA', 'a', 'o', 'u', '  ', 60, 'x', 'y')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.db.execute("INSERT INTO alarm_shelving (id, site_id, alarm_id, occurrence_id, user_id, reason,"
                                  " duration_minutes, shelved_at, expires_at) VALUES ('s', 'siteA', 'a', 'o', 'u', 'why', 10081, 'x', 'y')")

    def test_retention_90_days_for_notifications_24_months_for_records(self):
        now = T0
        old = self.store.condition("siteA", "old", True, now=now - timedelta(days=95), **SYNC)
        self.store.condition("siteA", "old", False, now=now - timedelta(days=91), **SYNC)          # resolved 91 days ago
        recent = self.store.condition("siteA", "recent", True, now=now - timedelta(days=95), **SYNC)
        self.store.condition("siteA", "recent", False, now=now - timedelta(days=89), **SYNC)
        ongoing = self.store.condition("siteA", "ongoing", True, now=now - timedelta(days=200), **SYNC)   # still active
        db = self.store.db
        db.execute("INSERT INTO notification_delivery_history (id, event_id, user_id, channel, status, occurred_at)"
                   " VALUES ('d-old', ?, 'u', 'inapp', 'sent', ?)", (old, iso(now - timedelta(days=95))))
        db.execute("INSERT INTO notification_delivery_history (id, event_id, user_id, channel, status, occurred_at)"
                   " VALUES ('d-new', ?, 'u', 'inapp', 'sent', ?)", (ongoing, iso(now - timedelta(days=10))))
        for rid, months in (("keep", 23), ("drop", 25)):
            at = iso(now - timedelta(days=30.5 * months))
            db.execute("INSERT INTO notification_audit_log (id, site_id, action, occurred_at) VALUES (?, 'siteA', 'x', ?)", (rid, at))
            db.execute("INSERT INTO alarm_acknowledgements (id, site_id, alarm_id, occurrence_id, user_id, acknowledged_at)"
                       " VALUES (?, 'siteA', ?, 'o', 'u', ?)", (rid, rid, at))
        self.store.purge(now)
        self.assertEqual({r["id"] for r in self.rows("siteA")}, {recent, ongoing})
        self.assertEqual([r[0] for r in db.execute("SELECT id FROM notification_delivery_history")], ["d-new"])
        self.assertEqual([r[0] for r in db.execute("SELECT id FROM notification_audit_log")], ["keep"])
        self.assertEqual([r[0] for r in db.execute("SELECT id FROM alarm_acknowledgements")], ["keep"])


class RecipientStoreTests(unittest.TestCase):
    """The recipient operations. User and site are trusted inputs here (a future server-side
    session supplies them); no HTTP route reaches these yet."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="eko-notif-test-")
        self.store = notifications.Store(os.path.join(self.dir, "n.sqlite3"))
        self.n = 0

    def tearDown(self):
        try:
            self.store.close()
        except sqlite3.Error:
            pass

    def event(self, site="siteA", type_="int.sync_failed", severity="warning", asset=None, at=T0, params=None):
        self.n += 1
        eid = f"ntf_{self.n:04d}"
        self.store.db.execute(
            "INSERT INTO notification_events (id, site_id, type, severity, source_kind, source_ref, asset_id, created_at,"
            " last_at, state, status, dedup_key, params_json) VALUES (?,?,?,?,?,?,?,?,?,?,'resolved',?,?)",
            (eid, site, type_, severity, "integration", f"src-{self.n}", asset, iso(at), iso(at), "s", f"k{self.n}",
             notifications._params_json(params)))
        return eid

    def deliver(self, eid, user="u1", channel="inapp", opened=None, dismissed=None):
        self.store.db.execute(
            "INSERT INTO notification_recipients (id, event_id, user_id, role, channel, delivery_status, opened_at, dismissed_at)"
            " VALUES (?,?,?,?,?,'delivered',?,?)", (f"r-{eid}-{user}-{channel}", eid, user, "technician", channel, opened, dismissed))
        return eid

    def ids(self, page):
        return [i["id"] for i in page["items"]]

    # ── listing ─────────────────────────────────────────────────────────────────────────

    def test_list_is_scoped_to_the_recipient_and_site(self):
        mine = self.deliver(self.event())
        self.deliver(self.event(), user="u2")                              # another user, same site
        self.deliver(self.event(site="siteB"))                             # same user, another site
        self.deliver(self.event(), channel="email")                        # not an in-app delivery
        self.event()                                                       # nobody is a recipient
        self.assertEqual(self.ids(self.store.list_notifications("u1", "siteA")), [mine])
        self.assertEqual(self.store.list_notifications("u3", "siteA")["items"], [])

    def test_unread_read_views_and_dismissed_rows_are_not_listed(self):
        unread = self.deliver(self.event(at=T0))
        read = self.deliver(self.event(at=T0 + timedelta(minutes=1)), opened=iso(T0))
        self.deliver(self.event(at=T0 + timedelta(minutes=2)), dismissed=iso(T0))
        self.assertEqual(self.ids(self.store.list_notifications("u1", "siteA")), [read, unread])
        self.assertEqual(self.ids(self.store.list_notifications("u1", "siteA", view="unread")), [unread])
        self.assertEqual(self.ids(self.store.list_notifications("u1", "siteA", view="read")), [read])

    def test_type_severity_asset_filters_and_search(self):
        a = self.deliver(self.event(type_="report.ready", severity="info", asset="AHU-1", params={"report": "ملخص طاقة"}))
        b = self.deliver(self.event(type_="int.sync_failed", severity="warning", asset="AHU-2", params={"reason": "50%_down"}))
        page = lambda **kw: self.ids(self.store.list_notifications("u1", "siteA", **kw))   # noqa: E731
        self.assertEqual(page(type_="report.ready"), [a])
        self.assertEqual(page(severity="warning"), [b])
        self.assertEqual(page(asset_id="AHU-1"), [a])
        self.assertEqual(page(q="طاقة"), [a])                       # Arabic params are searchable as typed
        self.assertEqual(page(q="50%_"), [b])                        # % and _ are literal, not wildcards
        self.assertEqual(page(q="%"), [b])
        self.assertEqual(page(q="ahu-2"), [b])                       # case-insensitive for ASCII
        self.assertEqual(page(type_="report.ready", severity="warning"), [])

    def test_cursor_pages_are_stable_and_complete(self):
        made = [self.deliver(self.event(at=T0 + timedelta(minutes=i // 2))) for i in range(7)]   # pairs share a timestamp
        seen, cursor, pages = [], None, 0
        while True:
            page = self.store.list_notifications("u1", "siteA", limit=3, cursor=cursor)
            seen += self.ids(page)
            pages += 1
            if pages == 1:   # a notification arriving between pages does not shift or repeat the next one
                self.deliver(self.event(at=T0 + timedelta(hours=1)))
            cursor = page["next_cursor"]
            if not cursor:
                break
        self.assertEqual(pages, 3)
        self.assertEqual(sorted(seen), sorted(made))
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(seen, sorted(made, key=lambda e: (self.store.get_notification("u1", "siteA", e)["created_at"], e), reverse=True))

    def test_bad_inputs_are_refused(self):
        bad = [dict(view="archived"), dict(severity="red"), dict(limit=0), dict(limit=101), dict(limit=True),
               dict(limit="5"), dict(cursor="not-a-cursor"), dict(cursor="WzFd")]   # WzFd = "[1]"
        for kwargs in bad:
            with self.assertRaises(ValueError, msg=kwargs):
                self.store.list_notifications("u1", "siteA", **kwargs)
        for user, site in (("", "siteA"), (None, "siteA"), ("u1", ""), ("u1", "../x"), ("u1", None)):
            with self.assertRaises(ValueError):
                self.store.list_notifications(user, site)
            with self.assertRaises(ValueError):
                self.store.mark_opened(user, site, "ntf_0001")

    # ── detail, opened, dismissed ───────────────────────────────────────────────────────

    def test_detail_only_for_its_recipient_on_its_site(self):
        mine = self.deliver(self.event(params={"reason": "x"}))
        theirs = self.deliver(self.event(), user="u2")
        other_site = self.deliver(self.event(site="siteB"))
        item = self.store.get_notification("u1", "siteA", mine)
        self.assertEqual((item["id"], item["params"], item["source"]["kind"]), (mine, {"reason": "x"}, "integration"))
        self.assertIsNone(self.store.get_notification("u1", "siteA", theirs))
        self.assertIsNone(self.store.get_notification("u1", "siteA", other_site))   # right user, wrong site
        self.assertIsNone(self.store.get_notification("u1", "siteA", "ntf_missing"))

    def test_opened_and_dismiss_are_idempotent_and_recorded_once(self):
        eid = self.deliver(self.event())
        first = self.store.mark_opened("u1", "siteA", eid, now=T0)
        again = self.store.mark_opened("u1", "siteA", eid, now=T0 + timedelta(hours=1))
        self.assertEqual((first["opened_at"], again["opened_at"]), (iso(T0), iso(T0)))
        gone = self.store.dismiss("u1", "siteA", eid, now=T0 + timedelta(minutes=5))
        self.store.dismiss("u1", "siteA", eid, now=T0 + timedelta(hours=2))
        self.assertEqual(gone["dismissed_at"], iso(T0 + timedelta(minutes=5)))
        self.assertEqual(self.store.get_notification("u1", "siteA", eid)["dismissed_at"], iso(T0 + timedelta(minutes=5)))
        self.assertEqual(self.store.list_notifications("u1", "siteA")["items"], [])          # hidden, not deleted
        history = [tuple(r) for r in self.store.db.execute(
            "SELECT status, occurred_at FROM notification_delivery_history WHERE event_id = ? ORDER BY occurred_at", (eid,))]
        self.assertEqual(history, [("opened", iso(T0)), ("dismissed", iso(T0 + timedelta(minutes=5)))])

    def test_opened_and_dismiss_never_reach_another_recipient_or_site(self):
        theirs = self.deliver(self.event(), user="u2")
        other_site = self.deliver(self.event(site="siteB"))
        self.assertIsNone(self.store.mark_opened("u1", "siteA", theirs))
        self.assertIsNone(self.store.dismiss("u1", "siteA", theirs))
        self.assertIsNone(self.store.mark_opened("u1", "siteA", other_site))
        self.assertIsNone(self.store.get_notification("u2", "siteA", theirs)["opened_at"])
        self.assertIsNone(self.store.get_notification("u1", "siteB", other_site)["dismissed_at"])
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM notification_delivery_history").fetchone()[0], 0)

    # ── preferences ─────────────────────────────────────────────────────────────────────

    def test_preferences_default_persist_and_merge(self):
        self.assertEqual(self.store.get_preferences("u1", "siteA"), {"master_enabled": True, "types": {}})
        self.store.update_preferences("u1", "siteA", types={"report.ready": False, "int.sync_failed": True})
        self.store.update_preferences("u1", "siteA", types={"report.ready": True})                       # others are kept
        self.store.update_preferences("u2", "siteA", master_enabled=False)
        self.store.close()
        self.store = notifications.Store(self.store.path)                                     # survives a restart
        self.assertEqual(self.store.get_preferences("u1", "siteA"),
                         {"master_enabled": True, "types": {"report.ready": True, "int.sync_failed": True}})
        self.assertEqual(self.store.get_preferences("u2", "siteA"), {"master_enabled": False, "types": {}})

    def test_master_off_overrides_every_type(self):
        self.store.update_preferences("u1", "siteA", types={"report.ready": True, "int.sync_failed": False})
        self.assertTrue(self.store.wants("u1", "siteA", "report.ready", default=False))
        self.assertFalse(self.store.wants("u1", "siteA", "int.sync_failed", default=True))
        self.assertTrue(self.store.wants("u1", "siteA", "wo.assigned", default=True))      # unsaved: the registry default
        self.assertFalse(self.store.wants("u1", "siteA", "alarm.critical", default=False))
        self.store.update_preferences("u1", "siteA", master_enabled=False)
        for type_, default in (("report.ready", True), ("wo.assigned", True)):
            self.assertFalse(self.store.wants("u1", "siteA", type_, default=default))
        self.assertEqual(self.store.get_preferences("u1", "siteA")["types"], {"report.ready": True, "int.sync_failed": False})

    def test_preference_input_is_validated(self):
        for kwargs in (dict(master_enabled=1), dict(types={"x": 1}), dict(types={"*": True}), dict(types={" ": True}),
                       dict(types=["x"])):
            with self.assertRaises(ValueError, msg=kwargs):
                self.store.update_preferences("u1", "siteA", **kwargs)
        self.assertEqual(self.store.get_preferences("u1", "siteA"), {"master_enabled": True, "types": {}})

    # ── database failures ───────────────────────────────────────────────────────────────

    def test_a_failed_preference_update_saves_nothing(self):
        self.store.db.execute("CREATE TEMP TRIGGER boom BEFORE INSERT ON notification_preferences"
                              " WHEN NEW.type = 'boom' BEGIN SELECT RAISE(ABORT, 'disk said no'); END")
        with self.assertRaises(notifications.StoreError):
            self.store.update_preferences("u1", "siteA", master_enabled=False, types={"report.ready": False, "boom": True})
        self.assertEqual(self.store.get_preferences("u1", "siteA"), {"master_enabled": True, "types": {}})

    def test_a_failed_history_write_leaves_the_notification_unopened(self):
        eid = self.deliver(self.event())
        self.store.db.execute("CREATE TEMP TRIGGER boom BEFORE INSERT ON notification_delivery_history"
                              " BEGIN SELECT RAISE(ABORT, 'disk said no'); END")
        with self.assertRaises(notifications.StoreError):
            self.store.mark_opened("u1", "siteA", eid)
        self.assertIsNone(self.store.get_notification("u1", "siteA", eid)["opened_at"])

    def test_storage_failures_raise_store_error(self):
        eid = self.deliver(self.event())
        self.store.close()
        for call in (lambda: self.store.list_notifications("u1", "siteA"),
                     lambda: self.store.get_notification("u1", "siteA", eid),
                     lambda: self.store.mark_opened("u1", "siteA", eid),
                     lambda: self.store.dismiss("u1", "siteA", eid),
                     lambda: self.store.get_preferences("u1", "siteA"),
                     lambda: self.store.update_preferences("u1", "siteA", master_enabled=False)):
            with self.assertRaises(notifications.StoreError):
                call()

    # ── regressions (review 16 Oct 2026) ────────────────────────────────────────────────

    def test_a_transaction_sqlite_already_rolled_back_raises_store_error_with_its_cause(self):
        # RAISE(ROLLBACK) ends the transaction inside SQLite; a second ROLLBACK used to fail and
        # replace the real error with a raw "cannot rollback - no transaction is active"
        eid = self.deliver(self.event())
        for table in ("notification_preferences", "notification_delivery_history"):
            self.store.db.execute(f"CREATE TEMP TRIGGER boom_{table} BEFORE INSERT ON {table}"
                                  " BEGIN SELECT RAISE(ROLLBACK, 'disk said no'); END")
        for call in (lambda: self.store.update_preferences("u1", "siteA", master_enabled=False),
                     lambda: self.store.mark_opened("u1", "siteA", eid)):
            with self.assertRaises(notifications.StoreError) as caught:
                call()
            self.assertIsInstance(caught.exception.__cause__, sqlite3.IntegrityError)
            self.assertFalse(self.store.db.in_transaction)
        self.assertEqual(self.store.get_preferences("u1", "siteA"), {"master_enabled": True, "types": {}})
        self.assertIsNone(self.store.get_notification("u1", "siteA", eid)["opened_at"])
        self.store.db.execute("DROP TRIGGER boom_notification_preferences")
        self.assertFalse(self.store.update_preferences("u1", "siteA", master_enabled=False)["master_enabled"])   # still usable

    def test_a_failed_purge_deletes_nothing_and_never_stops_polling(self):
        eid = self.deliver(self.event())
        db = self.store.db
        db.execute("INSERT INTO notification_delivery_history (id, event_id, user_id, channel, status, occurred_at)"
                   " VALUES ('d-old', ?, 'u1', 'inapp', 'sent', ?)", (eid, iso(T0 - timedelta(days=200))))
        db.execute("INSERT INTO notification_audit_log (id, site_id, action, occurred_at) VALUES ('a-old', 'siteA', 'x', ?)",
                   (iso(T0 - timedelta(days=900)),))
        for mode in ("ABORT", "ROLLBACK"):   # the audit delete runs after the delivery-history delete
            db.execute(f"CREATE TEMP TRIGGER boom BEFORE DELETE ON notification_audit_log BEGIN SELECT RAISE({mode}, 'no'); END")
            with self.assertRaises(notifications.StoreError):
                self.store.purge(T0)
            db.execute("DROP TRIGGER boom")
            self.assertEqual(db.execute("SELECT count(*) FROM notification_delivery_history").fetchone()[0], 1, mode)
            self.assertFalse(db.in_transaction)
        db.execute("CREATE TEMP TRIGGER boom BEFORE DELETE ON notification_audit_log BEGIN SELECT RAISE(ROLLBACK, 'no'); END")
        real, notifications._store = notifications._store, self.store
        try:   # the purge runs inside the polling trigger: a failure is logged, never raised into the loop
            self.store._purged_at = None
            self.assertIsNone(notifications.condition("siteA", "int.sync_failed", True, **SYNC))
        finally:
            notifications._store = real

    def test_store_errors_never_carry_database_text(self):
        self.store.db.execute("CREATE TEMP TRIGGER boom BEFORE INSERT ON notification_preferences"
                              " BEGIN SELECT RAISE(ABORT, 'secret table detail'); END")
        with self.assertRaises(notifications.StoreError) as caught:
            self.store.update_preferences("u1", "siteA", master_enabled=False)
        self.assertEqual(str(caught.exception), notifications.STORE_FAILED)
        self.assertIn("secret table detail", str(caught.exception.__cause__))   # kept for the server log only
        self.store.db.execute("DROP TABLE notification_preferences")             # a read failure says the same
        with self.assertRaises(notifications.StoreError) as caught:
            self.store.get_preferences("u1", "siteA")
        self.assertEqual(str(caught.exception), notifications.STORE_FAILED)
        self.assertIn("notification_preferences", str(caught.exception.__cause__))

    def test_wrong_typed_filters_and_ids_are_bad_requests_not_storage_errors(self):
        for kwargs in (dict(type_=["x"]), dict(asset_id={"a": 1}), dict(q=5), dict(q=["x"]), dict(type_=7)):
            with self.assertRaises(ValueError, msg=kwargs):
                self.store.list_notifications("u1", "siteA", **kwargs)
        for bad_id in (None, "", ["x"], 5):
            for call in (self.store.get_notification, self.store.mark_opened, self.store.dismiss):
                with self.assertRaises(ValueError, msg=(call.__name__, bad_id)):
                    call("u1", "siteA", bad_id)

    def test_an_unreadable_stored_row_is_a_storage_error(self):
        eid = self.deliver(self.event())
        self.store.db.execute("UPDATE notification_events SET params_json = 'not json' WHERE id = ?", (eid,))
        for call in (lambda: self.store.list_notifications("u1", "siteA"),
                     lambda: self.store.get_notification("u1", "siteA", eid)):
            with self.assertRaises(notifications.StoreError):   # not ValueError: it is not the caller's input
                call()

    def test_bulk_open_dismiss_opened_undo_and_unread_count_stay_in_scope(self):
        a = self.deliver(self.event(at=T0))
        b = self.deliver(self.event(at=T0 + timedelta(minutes=1)))
        theirs = self.deliver(self.event(), user="u2")
        other_site = self.deliver(self.event(site="siteB"))
        self.assertEqual(self.store.unread_count("u1", "siteA"), 2)
        self.assertEqual(self.store.mark_all_opened("u1", "siteA", now=T0), 2)
        self.assertEqual(self.store.mark_all_opened("u1", "siteA", now=T0), 0)            # idempotent
        self.assertEqual(self.store.unread_count("u1", "siteA"), 0)
        self.assertIsNone(self.store.get_notification("u2", "siteA", theirs)["opened_at"])
        self.assertIsNone(self.store.get_notification("u1", "siteB", other_site)["opened_at"])
        self.assertEqual(self.store.dismiss_opened("u1", "siteA", now=T0), 2)
        self.assertEqual(self.store.list_notifications("u1", "siteA")["items"], [])
        back = self.store.undismiss("u1", "siteA", a, now=T0)
        self.assertIsNone(back["dismissed_at"])
        self.assertEqual(self.ids(self.store.list_notifications("u1", "siteA")), [a])
        self.assertIsNone(self.store.undismiss("u1", "siteA", theirs))                     # not this recipient's
        self.assertIsNone(self.store.undismiss("u1", "siteA", other_site))                 # not this site's
        self.assertEqual(self.store.undismiss("u1", "siteA", a)["dismissed_at"], None)     # nothing to undo: unchanged
        statuses = sorted(r[0] for r in self.store.db.execute(
            "SELECT status FROM notification_delivery_history WHERE user_id = 'u1'"))
        self.assertEqual(statuses, ["dismissed", "dismissed", "opened", "opened", "undismissed"])
        del b

    def test_notification_routes_live_only_under_v1(self):
        paths = {getattr(r, "path", "") for r in main.app.routes}
        stray = [p for p in paths if p.startswith("/api/notifications") and not p.startswith(main.NOTIF_BASE + "/")]
        self.assertEqual(stray, [])
        self.assertIn(main.NOTIF_BASE + "/notifications", paths)


GOOD_WO_READ = 'ver:"3.0"\nequipment,work_orders\n7,123\n'


class NotificationApiTests(unittest.TestCase):
    """The project-scoped API through main's real sign-in path, with the fake FIN client."""
    MARSA = None   # set in setUp: config.json's own FIN project
    OTHER = "ellisdonDemo"

    def setUp(self):
        self.MARSA = main.BASE_CONFIG["project_name"]
        self._real_client, self._real_store = main.FinScramClient, notifications._store
        main.FinScramClient = FakeFinClient
        FakeFinClient.slow_realtime = False
        FakeFinClient.missing_points = set()

        async def good_read(_self, endpoint, is_text=False):   # work orders read fine: no polling noise
            return GOOD_WO_READ
        FakeFinClient.fetch_api = good_read
        self.dir = tempfile.mkdtemp(prefix="eko-notif-api-")
        notifications._store = notifications.Store(os.path.join(self.dir, "n.sqlite3"))
        self.http = TestClient(main.app)
        self.http.__enter__()

    def tearDown(self):
        self.http.post("/api/fin/logout")
        self.http.__exit__(None, None, None)
        main.FinScramClient = self._real_client
        main.apply_project_settings(None)
        notifications._store.close()
        notifications._store = self._real_store
        if "fetch_api" in FakeFinClient.__dict__:
            del FakeFinClient.fetch_api

    # ── helpers ──
    def login(self, fin_project, project_id, password="p"):
        r = self.http.post("/api/fin/login", json={"username": "u", "password": password,
                                                   "settings": {"finProjectName": fin_project}, "project_id": project_id})
        self.assertEqual(r.status_code, 200, r.text)

    def switch(self, fin_project, project_id):
        r = self.http.post("/api/fin/project-settings", json={"settings": {"finProjectName": fin_project}, "project_id": project_id})
        self.assertEqual(r.status_code, 200, r.text)

    def call(self, method, path, project="proj-marsa", **kw):
        headers = kw.pop("headers", {})
        if project is not None:
            headers["X-Eko-Project"] = project
        return self.http.request(method, main.NOTIF_BASE + path, headers=headers, **kw)

    def on_app(self, fn):
        """Run fn on the app's thread: the store has one SQLite connection, used by one thread."""
        return self.http.portal.call(fn)

    def event(self, site, type_="int.sync_failed", state="failed", now=None):
        return self.on_app(lambda: notifications.store().condition(site, type_, True, state=state, now=now, **SYNC))

    def page(self, project="proj-marsa", **params):
        r = self.call("GET", "/notifications", project=project, params=params)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def assert_error(self, r, status, code):
        self.assertEqual(r.status_code, status, r.text)
        self.assertEqual(r.json()["error"]["code"], code)
        self.assertEqual(set(r.json()["error"]), {"code", "message", "details"})

    # ── access ──
    def test_every_route_refuses_when_the_backend_is_not_signed_in(self):
        for method, path in (("GET", "/notifications"), ("GET", "/notifications/ntf_x"), ("POST", "/notifications/ntf_x/opened"),
                             ("POST", "/notifications/ntf_x/dismiss"), ("DELETE", "/notifications/ntf_x/dismiss"),
                             ("POST", "/notifications/opened-all"), ("POST", "/notifications/dismiss-opened"),
                             ("GET", "/preferences"), ("PUT", "/preferences")):
            self.assert_error(self.call(method, path), 401, "unauthenticated")

    def test_the_project_header_is_required_and_must_be_the_served_project(self):
        self.login(self.MARSA, "proj-marsa")
        self.assert_error(self.call("GET", "/notifications", project=None), 400, "project_required")
        for forged in ("proj-other", "", " proj-marsa", "PROJ-MARSA", "proj-marsa%00"):
            r = self.call("GET", "/notifications", project=forged)
            self.assertIn(r.status_code, (400, 409), forged)
        self.assertEqual(self.call("GET", "/notifications").status_code, 200)

    # ── identifiers: X-Eko-Project is the Eko-DT project id, never the FIN project name ──
    def test_the_fin_project_name_is_not_the_project_header(self):
        self.login(self.MARSA, "proj-marsa")
        st = self.http.get("/api/fin/status").json()
        self.assertEqual((st["project_id"], st["project_name"]), ("proj-marsa", self.MARSA))   # two different identifiers
        self.assert_error(self.call("GET", "/notifications", project=self.MARSA), 409, "project_mismatch")
        self.assertEqual(self.call("GET", "/notifications", project="proj-marsa").status_code, 200)
        eid = self.event(self.MARSA)
        self.assertEqual(self.page()["items"][0]["site_id"], self.MARSA)    # the site id is the FIN project name

    def test_signed_in_without_an_eko_project_every_header_is_refused(self):
        # the viewer's sign-in and login.html send no project: the backend then serves no Eko-DT project
        r = self.http.post("/api/fin/login", json={"username": "u", "password": "p"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsNone(self.http.get("/api/fin/status").json()["project_id"])
        for header in ("proj-marsa", self.MARSA, "None", "null"):
            self.assert_error(self.call("GET", "/notifications", project=header), 409, "project_mismatch")

    def test_switching_updates_the_identifier_the_header_must_match(self):
        self.login(self.MARSA, "proj-marsa")
        self.switch(self.OTHER, "proj-other")
        self.assertEqual(self.http.get("/api/fin/status").json()["project_id"], "proj-other")
        self.assertEqual(self.call("GET", "/notifications", project="proj-other").status_code, 200)
        for stale in ("proj-marsa", self.OTHER):
            self.assert_error(self.call("GET", "/notifications", project=stale), 409, "project_mismatch")

    def test_a_project_fin_does_not_validate_is_refused(self):
        self.login("ghost", "proj-ghost")              # the fake FIN cannot read "ghost": signed in, not validated
        self.assertIs(self.http.get("/api/fin/status").json()["project_validated"], False)
        self.assert_error(self.call("GET", "/notifications", project="proj-ghost"), 409, "project_not_validated")
        self.assert_error(self.call("POST", "/notifications/opened-all", project="proj-ghost"), 409, "project_not_validated")

    def test_cross_origin_browsers_are_refused(self):
        self.login(self.MARSA, "proj-marsa")
        pre = self.http.options(main.NOTIF_BASE + "/notifications/opened-all", headers={
            "Origin": "https://evil.example", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-eko-project"})
        self.assertNotIn("access-control-allow-origin", {k.lower() for k in pre.headers})
        for path in (main.NOTIF_BASE + "/notifications", "/api/fin/status", "/api/fin/alarms"):
            r = self.http.get(path, headers={"Origin": "https://evil.example", "X-Eko-Project": "proj-marsa"})
            self.assertNotIn("access-control-allow-origin", {k.lower() for k in r.headers}, path)

    # ── project scope ──
    def test_marsa_notifications_are_listed_with_count_scope_and_stamp(self):
        self.login(self.MARSA, "proj-marsa")
        empty = self.page()
        self.assertEqual((empty["items"], empty["next_cursor"], empty["unread_count"], empty["scope"]), ([], None, 0, "user"))
        eid = self.event(self.MARSA)
        r = self.call("GET", "/notifications")
        self.assertEqual(r.headers.get("X-Eko-Project"), "proj-marsa")
        body = r.json()
        self.assertEqual([i["id"] for i in body["items"]], [eid])
        self.assertEqual((body["unread_count"], body["items"][0]["site_id"]), (1, self.MARSA))

    def test_another_project_cannot_be_read_counted_or_changed(self):
        mine, theirs = self.event(self.MARSA), self.event(self.OTHER)
        self.login(self.MARSA, "proj-marsa")
        self.assertEqual([i["id"] for i in self.page()["items"]], [mine])
        self.assertEqual(self.page()["unread_count"], 1)
        for method, path in (("GET", f"/notifications/{theirs}"), ("POST", f"/notifications/{theirs}/opened"),
                             ("POST", f"/notifications/{theirs}/dismiss"), ("DELETE", f"/notifications/{theirs}/dismiss")):
            self.assert_error(self.call(method, path), 404, "not_found")
        self.call("POST", "/notifications/opened-all")
        self.call("POST", "/notifications/dismiss-opened")
        self.call("PUT", "/preferences", json={"master_enabled": False})
        other = self.on_app(lambda: notifications.store().get_notification("u", self.OTHER, theirs))
        self.assertEqual((other["opened_at"], other["dismissed_at"]), (None, None))
        self.assertTrue(self.on_app(lambda: notifications.store().get_preferences("u", self.OTHER))["master_enabled"])

    def test_switching_project_serves_the_new_project_only(self):
        mine, theirs = self.event(self.MARSA), self.event(self.OTHER)
        self.login(self.MARSA, "proj-marsa")
        self.assertEqual([i["id"] for i in self.page()["items"]], [mine])
        self.switch(self.OTHER, "proj-other")
        self.assert_error(self.call("GET", "/notifications"), 409, "project_mismatch")   # the old dashboard is refused
        self.assertEqual([i["id"] for i in self.page(project="proj-other")["items"]], [theirs])
        self.switch(self.MARSA, "proj-marsa")
        self.assertEqual([i["id"] for i in self.page()["items"]], [mine])

    # ── lifecycle ──
    def test_open_dismiss_undo_bulk_and_unread_count(self):
        a = self.event(self.MARSA, state="a", now=T0)
        b = self.event(self.MARSA, state="b", now=T0 + timedelta(minutes=1))
        self.login(self.MARSA, "proj-marsa")
        self.assertEqual(self.page()["unread_count"], 2)
        first = self.call("POST", f"/notifications/{a}/opened").json()["opened_at"]
        self.assertEqual(self.call("POST", f"/notifications/{a}/opened").json()["opened_at"], first)   # idempotent
        self.assertEqual(self.page(view="unread")["unread_count"], 1)
        self.assertEqual([i["id"] for i in self.page(view="unread")["items"]], [b])
        self.assertIsNotNone(self.call("POST", f"/notifications/{a}/dismiss").json()["dismissed_at"])
        self.assertEqual([i["id"] for i in self.page()["items"]], [b])
        self.assertIsNone(self.call("DELETE", f"/notifications/{a}/dismiss").json()["dismissed_at"])  # Undo
        self.assertEqual(sorted(i["id"] for i in self.page()["items"]), sorted([a, b]))
        self.assertEqual(self.call("POST", "/notifications/opened-all").json(), {"updated": 1})
        self.assertEqual(self.page()["unread_count"], 0)
        self.assertEqual(self.call("POST", "/notifications/dismiss-opened").json(), {"updated": 2})
        self.assertEqual(self.page()["items"], [])
        self.assert_error(self.call("POST", "/notifications/ntf_missing/opened"), 404, "not_found")

    def test_preferences_round_trip_for_the_project(self):
        self.login(self.MARSA, "proj-marsa")
        site = {"critical_alarms": False}                 # read-only facts about the site, beside the user's own
        self.assertEqual(self.call("GET", "/preferences").json(), {"master_enabled": True, "types": {}, "site": site})
        r = self.call("PUT", "/preferences", json={"types": {"report.ready": False}, "master_enabled": False})
        self.assertEqual(r.json(), {"master_enabled": False, "types": {"report.ready": False}, "site": site})
        self.assertEqual(self.call("GET", "/preferences").json()["master_enabled"], False)

    def test_bad_input_is_a_400_in_the_contract_shape(self):
        self.login(self.MARSA, "proj-marsa")
        for params in ({"limit": "0"}, {"limit": "abc"}, {"limit": "101"}, {"view": "archived"}, {"cursor": "nope"}):
            self.assert_error(self.call("GET", "/notifications", params=params), 400, "invalid_input")
        for body in ({"master_enabled": "yes"}, {"types": {"x": 1}}, {"user_id": "u2"}, ["x"]):
            self.assert_error(self.call("PUT", "/preferences", json=body), 400, "invalid_input")
        self.assert_error(self.call("PUT", "/preferences", content=b"{not json", headers={"Content-Type": "application/json"}),
                          400, "invalid_input")

    def test_a_storage_failure_is_a_500_with_the_fixed_message_only(self):
        self.login(self.MARSA, "proj-marsa")
        held, env = notifications._store, os.environ["EKO_NOTIFICATION_DB"]
        # a store that cannot open (a refused path), never a connection closed under the poller
        os.environ["EKO_NOTIFICATION_DB"] = os.path.join(notifications.BUNDLE_DIR, "refused.sqlite3")
        self.on_app(lambda: setattr(notifications, "_store", None))
        try:
            r = self.call("GET", "/notifications")
            self.assert_error(r, 500, "storage_failed")
            self.assertEqual(r.json()["error"]["message"], notifications.STORE_FAILED)
            self.assertNotIn("sqlite", r.text.lower())
            self.assertNotIn("refused.sqlite3", r.text)
        finally:
            os.environ["EKO_NOTIFICATION_DB"] = env
            self.on_app(lambda: setattr(notifications, "_store", held))

    def test_no_fin_credential_reaches_a_response(self):
        secret = "pw-NEVER-SHOWN-7f3a"
        self.login(self.MARSA, "proj-marsa", password=secret)
        eid = self.event(self.MARSA)
        responses = [self.call("GET", "/notifications"), self.call("GET", f"/notifications/{eid}"),
                     self.call("POST", f"/notifications/{eid}/opened"), self.call("GET", "/preferences"),
                     self.http.get("/api/fin/status"), self.http.get("/api/auth/status"), self.http.get("/api/fin/config")]
        for r in responses:
            dump = r.text + " ".join(f"{k}:{v}" for k, v in r.headers.items())
            self.assertNotIn(secret, dump)
            self.assertNotIn("scram data=", dump.lower())

    def test_the_work_order_sync_trigger_reaches_the_api(self):
        del FakeFinClient.fetch_api                 # the fake has no read: the work-order sync fails
        self.login(self.MARSA, "proj-marsa")
        items = wait_for(lambda: self.page()["items"])
        self.assertEqual(items[0]["type"], "int.sync_failed")
        self.assertEqual(items[0]["params"]["system"], "FIN")


class DbPathTests(unittest.TestCase):
    def setUp(self):
        self.env = os.environ.pop("EKO_NOTIFICATION_DB", None)

    def tearDown(self):
        if self.env is not None:
            os.environ["EKO_NOTIFICATION_DB"] = self.env

    def test_a_path_inside_the_export_bundle_is_refused(self):
        for inside in (os.path.join(notifications.BUNDLE_DIR, "n.sqlite3"),
                       os.path.join(notifications.BUNDLE_DIR, "data", "n.sqlite3")):
            with self.assertRaises(ValueError):
                notifications.resolve_db_path(inside)

    def test_env_then_config_then_a_default_outside_the_bundle(self):
        outside = os.path.join(tempfile.gettempdir(), "eko", "n.sqlite3")
        self.assertEqual(notifications.resolve_db_path(outside), os.path.abspath(outside))
        default = notifications.resolve_db_path(None)
        self.assertFalse(default.startswith(notifications.BUNDLE_DIR), default)
        os.environ["EKO_NOTIFICATION_DB"] = os.path.join(tempfile.gettempdir(), "env.sqlite3")
        self.assertEqual(notifications.resolve_db_path(outside), os.path.join(tempfile.gettempdir(), "env.sqlite3"))


def wait_for(fn, timeout=6.0):
    end = time.time() + timeout
    while time.time() < end:
        value = fn()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("timed out")


class WorkOrderSyncTriggerTests(unittest.TestCase):
    """Through main's real sign-in and polling path, with the fake FIN client."""

    def setUp(self):
        self._real_client = main.FinScramClient
        main.FinScramClient = FakeFinClient
        FakeFinClient.slow_realtime = False
        FakeFinClient.missing_points = set()
        self.http = TestClient(main.app)
        self.http.__enter__()

    def tearDown(self):
        self.http.post("/api/fin/logout")
        self.http.__exit__(None, None, None)
        main.FinScramClient = self._real_client
        main.apply_project_settings(None)
        if "fetch_api" in FakeFinClient.__dict__:
            del FakeFinClient.fetch_api

    def login(self, fin_project, project_id):
        r = self.http.post("/api/fin/login", json={"username": "u", "password": "p",
                                                   "settings": {"finProjectName": fin_project}, "project_id": project_id})
        self.assertEqual(r.status_code, 200, r.text)

    def active(self, site):
        store = notifications._store
        return [r for r in (store.events(site) if store else []) if r["type"] == "int.sync_failed" and r["status"] == "active"]

    def test_marsa_read_failure_is_one_active_row_until_a_good_read(self):
        site = main.BASE_CONFIG["project_name"]          # Marsa's own configured FIN project
        self.login(site, "proj-site")                   # the fake has no fetch_api: the work-order read fails
        [first] = wait_for(lambda: self.active(site))
        self.login(site, "proj-site")                   # a new session polls again: still one active row
        time.sleep(0.3)
        self.assertEqual([r["id"] for r in self.active(site)], [first["id"]])

        async def good_read(self, endpoint, is_text=False):
            return 'ver:"3.0"\nequipment,work_orders\n7,123\n'
        FakeFinClient.fetch_api = good_read
        self.login(site, "proj-site")
        wait_for(lambda: not self.active(site))
        resolved = next(r for r in notifications._store.events(site) if r["id"] == first["id"])
        self.assertEqual(resolved["status"], "resolved")

    def test_another_project_never_runs_or_records_the_marsa_read(self):
        self.login("adnocWarsan", "proj-A")
        time.sleep(0.3)
        self.assertEqual(main.CONFIG["workorder_expr"], "")
        store = notifications._store
        self.assertEqual(store.events("adnocWarsan") if store else [], [])


if __name__ == "__main__":
    unittest.main()
