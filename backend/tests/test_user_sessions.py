"""Phase 1 of per-user notifications: trusted user sessions on the real sign-in path, and the
notification store's migration 3 (audience, site-scoped preferences and roles) with its backup.

The FIN client is the fake one (any username/password signs in): what is tested is that the
session holds the username the sign-in accepted, and nothing a request states."""
import contextlib
import glob
import io
import os
import sqlite3
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from fake_fin import FakeFinClient  # noqa: E402  (sets EKO_NOTIFICATION_DB before main can write)
import main  # noqa: E402
import notifications  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

GOOD_WO_READ = 'ver:"3.0"\nequipment,work_orders\n7,123\n'
ROUTES = (("GET", "/notifications"), ("GET", "/notifications/ntf_x"), ("POST", "/notifications/ntf_x/opened"),
          ("POST", "/notifications/ntf_x/dismiss"), ("DELETE", "/notifications/ntf_x/dismiss"),
          ("POST", "/notifications/opened-all"), ("POST", "/notifications/dismiss-opened"),
          ("GET", "/preferences"), ("PUT", "/preferences"))


class UserSessionTests(unittest.TestCase):
    """Two browsers are two cookie jars on one test client: `browser(token)` puts one in place."""

    def setUp(self):
        self.MARSA, self.OTHER = main.BASE_CONFIG["project_name"], "ellisdonDemo"
        self._real_client, self._real_store = main.FinScramClient, notifications._store
        main.FinScramClient = FakeFinClient
        FakeFinClient.slow_realtime = False
        FakeFinClient.missing_points = set()

        async def good_read(_self, endpoint, is_text=False):
            return GOOD_WO_READ
        FakeFinClient.fetch_api = good_read
        main.SESSIONS.clear()
        notifications._store = notifications.Store(os.path.join(tempfile.mkdtemp(prefix="eko-sess-"), "n.sqlite3"))
        self.http = TestClient(main.app)
        self.http.__enter__()

    def tearDown(self):
        main.SESSIONS.clear()
        self.http.cookies.clear()
        self.http.post("/api/fin/logout")
        self.http.__exit__(None, None, None)
        main.FinScramClient = self._real_client
        main.apply_project_settings(None)
        notifications._store.close()
        notifications._store = self._real_store
        if "fetch_api" in FakeFinClient.__dict__:
            del FakeFinClient.fetch_api

    # ── helpers ──
    def browser(self, token=None):
        self.http.cookies.clear()
        if token:
            self.http.cookies.set(main.SESSION_COOKIE, token)

    def sign_in(self, user, fin_project=None, project_id="proj-marsa", **headers):
        """Sign in from a fresh browser; returns that browser's session token (from Set-Cookie)."""
        self.browser()
        r = self.http.post("/api/fin/login", headers=headers, json={
            "username": user, "password": "pw-" + user, "settings": {"finProjectName": fin_project or self.MARSA},
            "project_id": project_id})
        self.assertEqual(r.status_code, 200, r.text)
        return self.http.cookies.get(main.SESSION_COOKIE)

    def call(self, method, path, project="proj-marsa", **kw):
        headers = kw.pop("headers", {})
        headers["X-Eko-Project"] = project
        return self.http.request(method, main.NOTIF_BASE + path, headers=headers, **kw)

    def assert_error(self, r, status, code):
        self.assertEqual(r.status_code, status, r.text)
        self.assertEqual(r.json()["error"]["code"], code)

    # ── no session, expired session ──
    def test_without_a_session_every_notification_route_is_401(self):
        self.sign_in("alice")                            # the backend is signed in to FIN ...
        self.browser()                                   # ... but this browser never signed in
        for method, path in ROUTES:
            self.assert_error(self.call(method, path), 401, "session_required")
        self.assert_error(self.http.get("/api/auth/me"), 401, "session_required")

    def test_an_expired_session_is_401_and_is_dropped(self):
        token = self.sign_in("alice")
        self.assertEqual(self.call("GET", "/notifications").status_code, 200)
        [held] = main.SESSIONS.values()
        held["expires_at"] = time.time() - 1
        for method, path in ROUTES[:1] + ROUTES[-1:]:
            self.browser(token)
            r = self.call(method, path)
            self.assertEqual(r.status_code, 401, r.text)
            self.assertIn(r.json()["error"]["code"], ("session_expired", "session_required"))
        self.assertEqual(main.SESSIONS, {}, "an expired session is removed, not kept")

    def test_a_made_up_token_is_401(self):
        self.sign_in("alice")
        for token in ("x", "a" * 43, main._token_key("x")):
            self.browser(token)
            self.assert_error(self.call("GET", "/notifications"), 401, "session_required")

    # ── two users ──
    def test_two_users_have_separate_sessions_and_one_sign_out_never_ends_the_other(self):
        alice = self.sign_in("alice")
        bob = self.sign_in("bob")
        self.assertNotEqual(alice, bob)
        for token, who in ((alice, "alice"), (bob, "bob")):
            self.browser(token)
            me = self.http.get("/api/auth/me").json()
            self.assertEqual((me["user_id"], me["site"], me["role"]), (who, self.MARSA, None))
            self.assertEqual(self.http.get("/api/fin/me").json()["user_id"], who)
        self.browser(bob)
        self.assertEqual(self.http.post("/api/fin/logout").json()["status"], "signed_out")
        self.assert_error(self.http.get("/api/auth/me"), 401, "session_required")      # bob is out
        self.assertTrue(main.client and main.client.is_authenticated, "the FIN session still serves alice")
        self.browser(alice)
        self.assertEqual(self.http.get("/api/auth/me").json()["user_id"], "alice")
        self.assertEqual(self.call("GET", "/notifications").status_code, 200)
        self.assertEqual(self.http.post("/api/fin/logout").json()["status"], "disconnected")  # the last one out
        self.assertIsNone(main.client)

    def test_a_sign_out_from_a_browser_with_no_session_changes_nothing_for_others(self):
        alice = self.sign_in("alice")
        self.browser()
        self.http.post("/api/auth/logout")
        self.assertTrue(main.client and main.client.is_authenticated)
        self.browser(alice)
        self.assertEqual(self.http.get("/api/auth/me").json()["user_id"], "alice")

    def test_signing_in_again_replaces_this_browsers_session(self):
        self.sign_in("alice")
        r = self.http.post("/api/auth/login", json={"username": "alice2", "password": "p",
                                                    "settings": {"finProjectName": self.MARSA}, "project_id": "proj-marsa"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual([s["user_id"] for s in main.SESSIONS.values()], ["alice2"])
        self.assertEqual(self.http.get("/api/auth/me").json()["user_id"], "alice2")

    # ── identity comes from the sign-in only ──
    def test_forged_user_ids_and_roles_never_change_who_you_are(self):
        self.sign_in("alice")
        forged = {"X-Eko-User": "bob", "X-User-Id": "bob", "X-Remote-User": "bob", "X-Eko-Role": "admin",
                  "Remote-User": "bob", "X-Forwarded-User": "bob"}
        me = self.http.get("/api/auth/me", headers=forged, params={"user_id": "bob", "role": "admin"}).json()
        self.assertEqual((me["user_id"], me["role"]), ("alice", None))
        self.assert_error(self.call("PUT", "/preferences", json={"user_id": "bob", "master_enabled": False}), 400, "invalid_input")
        self.assert_error(self.call("PUT", "/preferences", json={"role": "admin"}), 400, "invalid_input")
        self.assertEqual(self.call("GET", "/notifications", headers=dict(forged)).status_code, 200)
        rows = self.http.portal.call(lambda: notifications.store().db.execute(
            "SELECT DISTINCT user_id FROM notification_preferences").fetchall())
        self.assertNotIn("bob", [r[0] for r in rows])

    def test_the_role_is_the_sites_own_mapping(self):
        token = self.sign_in("alice")
        self.http.portal.call(lambda: notifications.store().db.execute(
            "INSERT INTO eko_role_mapping (site_id, user_id, eko_role, updated_at) VALUES (?, 'alice', 'engineer', 'x')", (self.MARSA,)))
        self.http.portal.call(lambda: notifications.store().db.execute(
            "INSERT INTO eko_role_mapping (site_id, user_id, eko_role, updated_at) VALUES (?, 'alice', 'executive', 'x')", (self.OTHER,)))
        self.browser(token)
        self.assertEqual(self.http.get("/api/auth/me", headers={"X-Eko-Role": "executive"}).json()["role"], "engineer")

    # ── cookie and secrecy ──
    def test_the_cookie_is_httponly_samesite_and_secure_over_https(self):
        self.browser()
        body = {"username": "alice", "password": "p", "settings": {"finProjectName": self.MARSA}, "project_id": "proj-marsa"}
        plain = self.http.post("/api/fin/login", json=body).headers["set-cookie"].lower()
        self.assertTrue(plain.startswith(main.SESSION_COOKIE + "="))
        for part in ("httponly", "samesite=strict", "path=/", "max-age="):
            self.assertIn(part, plain)
        self.assertNotIn("secure", plain.replace("samesite", ""))
        self.browser()
        tls = self.http.post("/api/fin/login", json=body, headers={"X-Forwarded-Proto": "https"}).headers["set-cookie"].lower()
        self.assertIn("; secure", tls)

    def test_no_password_or_token_is_kept_shown_or_logged(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            token = self.sign_in("alice")
            responses = [self.http.get("/api/auth/me"), self.call("GET", "/notifications"),
                         self.http.get("/api/auth/status"), self.http.get("/api/fin/status")]
            self.http.post("/api/fin/logout")
        self.assertTrue(token)
        self.assertNotIn(token, out.getvalue())
        self.assertNotIn("pw-alice", out.getvalue())
        for r in responses:
            self.assertNotIn(token, r.text)
            self.assertNotIn("pw-alice", r.text)
        self.sign_in("bob")
        self.assertNotIn(self.http.cookies.get(main.SESSION_COOKIE), repr(main.SESSIONS), "only its hash is kept")

    # ── project isolation ──
    def test_a_session_serves_only_the_site_it_signed_in_for(self):
        alice = self.sign_in("alice", self.MARSA, "proj-marsa")
        self.sign_in("bob", self.OTHER, "proj-other")    # the shared FIN session now serves OTHER
        self.browser(alice)
        self.assert_error(self.call("GET", "/notifications", project="proj-marsa"), 409, "project_mismatch")
        self.assert_error(self.call("GET", "/notifications", project="proj-other"), 409, "session_project_mismatch")
        self.assertEqual(self.http.get("/api/auth/me").json()["site"], self.MARSA)

    def test_a_project_switch_moves_only_its_own_session(self):
        alice = self.sign_in("alice")
        bob = self.sign_in("bob")                         # bob's credentials now drive the FIN session
        self.browser(alice)                               # alice switches: validated with bob's session
        r = self.http.post("/api/fin/project-settings", json={"settings": {"finProjectName": self.OTHER}, "project_id": "proj-other"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assert_error(self.call("GET", "/notifications", project="proj-other"), 409, "session_project_mismatch")
        self.browser(bob)
        self.assert_error(self.call("GET", "/notifications", project="proj-other"), 409, "session_project_mismatch")
        r = self.http.post("/api/fin/project-settings", json={"settings": {"finProjectName": self.OTHER}, "project_id": "proj-other"})
        self.assertEqual(self.call("GET", "/notifications", project="proj-other").status_code, 200, "the owner moves")


class ExportedBundleSessionTests(unittest.TestCase):
    """Export with FIN Backend: the backend serves its bundled project.json, and the viewer's
    sign-in (SignInOverlay, login.html) posts only username, password and server URL."""

    def setUp(self):
        self.MARSA = main.BASE_CONFIG["project_name"]
        self._real_client, self._real_store, self._real_json = main.FinScramClient, notifications._store, main.PROJECT_JSON
        main.FinScramClient = FakeFinClient
        FakeFinClient.slow_realtime = False
        FakeFinClient.missing_points = set()

        async def good_read(_self, endpoint, is_text=False):
            return GOOD_WO_READ
        FakeFinClient.fetch_api = good_read
        folder = tempfile.mkdtemp(prefix="eko-bundle-")
        main.PROJECT_JSON = os.path.join(folder, "project.json")
        with open(main.PROJECT_JSON, "w", encoding="utf-8") as fh:
            fh.write('{"projectId": "proj-bundle", "isFinProject": true, "apiSettings": {"finProjectName": "%s"}}' % self.MARSA)
        main.SESSIONS.clear()
        notifications._store = notifications.Store(os.path.join(folder, "n.sqlite3"))
        self.http = TestClient(main.app)
        self.http.__enter__()          # startup applies the bundled project.json

    def tearDown(self):
        main.SESSIONS.clear()
        self.http.cookies.clear()
        self.http.post("/api/fin/logout")
        self.http.__exit__(None, None, None)
        main.FinScramClient, main.PROJECT_JSON = self._real_client, self._real_json
        main.apply_project_settings(None)
        notifications._store.close()
        notifications._store = self._real_store
        if "fetch_api" in FakeFinClient.__dict__:
            del FakeFinClient.fetch_api

    def viewer_sign_in(self, user):
        self.http.cookies.clear()
        r = self.http.post("/api/auth/login", json={"username": user, "password": "p", "server_url": "https://localhost"})
        self.assertEqual(r.status_code, 200, r.text)
        return self.http.cookies.get(main.SESSION_COOKIE)

    def test_the_viewer_sign_in_opens_a_session_for_the_bundled_project(self):
        token = self.viewer_sign_in("alice")
        self.assertEqual(self.http.get("/api/fin/status").json()["project_id"], "proj-bundle")
        self.assertEqual(self.http.get("/api/auth/me").json()["user_id"], "alice")
        r = self.http.get(main.NOTIF_BASE + "/notifications", headers={"X-Eko-Project": "proj-bundle"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(token)

    def test_a_second_browser_is_connected_by_status_but_has_no_session(self):
        self.viewer_sign_in("alice")
        self.http.cookies.clear()                                   # another browser opens the viewer
        status = self.http.get("/api/auth/status").json()
        self.assertTrue(status["authenticated"], "the status still says the backend is connected to FIN (unchanged)")
        self.assertEqual(self.http.get("/api/auth/me").status_code, 401, "... which no longer signs this browser in")
        r = self.http.get(main.NOTIF_BASE + "/notifications", headers={"X-Eko-Project": "proj-bundle"})
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (401, "session_required"))
        self.viewer_sign_in("bob")
        self.assertEqual(self.http.get("/api/auth/me").json()["user_id"], "bob")

    def test_signing_out_in_the_viewer_ends_only_that_browser(self):
        alice = self.viewer_sign_in("alice")
        self.viewer_sign_in("bob")
        self.assertEqual(self.http.post("/api/auth/logout").json()["status"], "signed_out")
        self.assertEqual(self.http.get("/api/auth/me").status_code, 401)
        self.http.cookies.set(main.SESSION_COOKIE, alice)
        self.assertEqual(self.http.get("/api/auth/me").json()["user_id"], "alice")
        self.assertTrue(self.http.get("/api/auth/status").json()["authenticated"])


def _v2_database(path):
    """A real version-2 database as an earlier release left it, with data in every touched table."""
    real = notifications.MIGRATIONS
    notifications.MIGRATIONS = real[:2]
    try:
        old = notifications.Store(path)
    finally:
        notifications.MIGRATIONS = real
    db = old.db
    db.execute("INSERT INTO notification_events (id, site_id, type, severity, created_at, last_at, state, status, dedup_key)"
               " VALUES ('ntf_a', 'siteA', 'int.sync_failed', 'warning', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z',"
               " 'failed', 'active', 'siteA||int.sync_failed|failed')")
    db.execute("INSERT INTO notification_events (id, site_id, type, severity, created_at, last_at, state, status, dedup_key)"
               " VALUES ('ntf_b', 'siteB', 'alarm.critical', 'critical', '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z',"
               " '@a1', 'resolved', 'siteB|AHU|alarm.critical|@a1')")
    db.execute("INSERT INTO notification_recipients (id, event_id, user_id, channel, delivery_status, opened_at)"
               " VALUES ('rcp_ntf_a', 'ntf_a', '#project:siteA', 'inapp', 'delivered', '2026-10-01T01:00:00Z')")
    db.execute("INSERT INTO notification_recipients (id, event_id, user_id, channel, delivery_status, dismissed_at)"
               " VALUES ('rcp_ntf_b', 'ntf_b', '#project:siteB', 'inapp', 'delivered', '2026-10-02T01:00:00Z')")
    db.executemany("INSERT INTO notification_preferences (user_id, type, enabled) VALUES (?, ?, ?)",
                   [("#project:siteA", "alarm.critical", 1), ("#project:siteA", "*", 0), ("#project:siteB", "report.ready", 0)])
    db.execute("INSERT INTO eko_role_mapping (user_id, eko_role, updated_at) VALUES ('alice', 'engineer', 'x')")
    db.execute("INSERT INTO alarm_acknowledgements (id, site_id, alarm_id, occurrence_id, user_id, acknowledged_at)"
               " VALUES ('ack1', 'siteB', '@a1', '@a1', 'alice', '2026-10-02T00:30:00Z')")
    old.close()


def _snapshot(path):
    db = sqlite3.connect(path)
    try:
        q = lambda sql: sorted(tuple(r) for r in db.execute(sql))   # noqa: E731
        return {
            "versions": q("SELECT version FROM schema_migrations"),
            "events": q("SELECT id, site_id, type, status, dedup_key FROM notification_events"),
            "recipients": q("SELECT id, event_id, user_id, opened_at, dismissed_at FROM notification_recipients"),
            "acks": q("SELECT id, site_id, alarm_id, user_id FROM alarm_acknowledgements"),
            "tables": q("SELECT name FROM sqlite_master WHERE type = 'table'"),
            "pref_cols": [r[1] for r in db.execute("PRAGMA table_info(notification_preferences)")],
        }
    finally:
        db.close()


class Migration3Tests(unittest.TestCase):
    def setUp(self):
        self.path = os.path.join(tempfile.mkdtemp(prefix="eko-mig3-"), "n.sqlite3")
        self.real = notifications.MIGRATIONS

    def tearDown(self):
        notifications.MIGRATIONS = self.real

    def backups(self):
        return glob.glob(self.path + ".v*.bak")

    def test_existing_data_is_kept_with_shared_project_visibility_and_a_backup(self):
        _v2_database(self.path)
        before = _snapshot(self.path)
        store = notifications.Store(self.path)
        try:
            after = _snapshot(self.path)
            self.assertEqual(after["versions"], [(1,), (2,), (3,), (4,)])
            for key in ("events", "recipients", "acks"):
                self.assertEqual(after[key], before[key], key + " kept exactly")
            self.assertEqual(sorted(tuple(r) for r in store.db.execute("SELECT event_id, kind, value FROM notification_audience")),
                             [("ntf_a", "project", "siteA"), ("ntf_b", "project", "siteB")])
            # still listed for the project, read/dismissed state as it was
            [item] = store.list_notifications("alice", "siteA")["items"]
            self.assertEqual((item["id"], item["opened_at"]), ("ntf_a", "2026-10-01T01:00:00Z"))
            self.assertEqual(store.list_notifications("alice", "siteB")["items"], [], "dismissed stays dismissed")
            # preferences moved to their project's site; the master toggle with them
            self.assertEqual(store.get_preferences("alice", "siteA"), {"master_enabled": False, "types": {"alarm.critical": True}})
            self.assertEqual(store.get_preferences("alice", "siteB")["types"], {"report.ready": False})
            self.assertEqual(store.get_preferences("alice", "siteC"), {"master_enabled": True, "types": {}}, "another site's toggles do not apply")
            self.assertEqual(after["pref_cols"], ["user_id", "site_id", "type", "enabled"])
            self.assertEqual([tuple(r) for r in store.db.execute("SELECT site_id, user_id, eko_role FROM eko_role_mapping")],
                             [("", "alice", "engineer")], "a role with no known site is kept, scoped to no site")
            # the backup is the database exactly as it was before
            [backup] = self.backups()
            self.assertEqual(backup, store.backup_path)
            self.assertIn(".v2-", backup)
            self.assertEqual(_snapshot(backup), before)
        finally:
            store.close()

    def test_running_again_changes_nothing_and_makes_no_second_backup(self):
        _v2_database(self.path)
        notifications.Store(self.path).close()
        once = _snapshot(self.path)
        for _ in range(2):
            notifications.Store(self.path).close()
        self.assertEqual(_snapshot(self.path), once)
        self.assertEqual(len(self.backups()), 1)
        db = sqlite3.connect(self.path)
        self.assertEqual(db.execute("SELECT count(*) FROM notification_audience").fetchone()[0], 2)
        db.close()

    def test_a_new_database_needs_no_backup(self):
        notifications.Store(self.path).close()
        self.assertEqual(self.backups(), [])
        self.assertEqual(_snapshot(self.path)["versions"], [(1,), (2,), (3,), (4,)])

    def test_a_failing_migration_leaves_the_database_as_it_was_and_can_be_retried(self):
        _v2_database(self.path)
        before = _snapshot(self.path)
        v3 = dict(self.real)[3]
        notifications.MIGRATIONS = self.real[:2] + [(3, v3 + "\nINSERT INTO no_such_table VALUES (1);\n")]
        with self.assertRaises(sqlite3.Error):
            notifications.Store(self.path)
        self.assertEqual(_snapshot(self.path), before, "no table, row or version of v3 is left behind")
        notifications.MIGRATIONS = self.real
        store = notifications.Store(self.path)          # fixed: the same database migrates normally
        store.close()
        self.assertEqual(_snapshot(self.path)["versions"], [(1,), (2,), (3,), (4,)])

    def test_a_failed_backup_stops_the_migration(self):
        _v2_database(self.path)
        before = _snapshot(self.path)
        real = notifications.Store._backup

        def refuse(self, version):
            raise OSError("disk full")
        notifications.Store._backup = refuse
        try:
            with self.assertRaises(OSError):
                notifications.Store(self.path)
        finally:
            notifications.Store._backup = real
        self.assertEqual(_snapshot(self.path), before)

    def test_a_new_event_is_for_its_whole_project(self):
        store = notifications.Store(self.path)
        try:
            eid = store.condition("siteA", "int.sync_failed", True, severity="warning", source_kind="integration",
                                  source_ref="fin-workorders")
            self.assertEqual([tuple(r) for r in store.db.execute("SELECT event_id, kind, value FROM notification_audience")],
                             [(eid, "project", "siteA")])
        finally:
            store.close()

    @unittest.skipUnless(os.name == "posix", "POSIX file modes; Windows relies on the folder's ACL")
    def test_the_database_its_folder_and_its_backup_are_owner_only(self):
        _v2_database(self.path)
        store = notifications.Store(self.path)
        store.close()
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(store.backup_path).st_mode & 0o777, 0o600)
        fresh = os.path.join(tempfile.mkdtemp(prefix="eko-mig3-"), "new", "n.sqlite3")
        notifications.Store(fresh).close()
        self.assertEqual(os.stat(os.path.dirname(fresh)).st_mode & 0o777, 0o700)


if __name__ == "__main__":
    unittest.main()
