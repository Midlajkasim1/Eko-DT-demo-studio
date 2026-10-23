"""Phase 3 of per-user notifications: read, dismissed and preference state belongs to the signed-in
user on one site. The user and the site come from the server-side session only; the site's shared
(pre-user) state is the baseline every user starts from and is never written by a user.

Also migration 4 (an audit trail of the inherited state) with its backup, run on copies of
databases as earlier releases left them."""
import glob
import os
import shutil
import sqlite3
import sys
import tempfile
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
GOOD_WO_READ = 'ver:"3.0"\nequipment,work_orders\n7,123\n'


def sync_event(store, site, state, minutes=0):
    return store.condition(site, "int.sync_failed", True, state=state, now=T0 + timedelta(minutes=minutes), **SYNC)


def ids(page):
    return [i["id"] for i in page["items"]]


class UserStateStoreTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="eko-ustate-")
        self.store = notifications.Store(os.path.join(self.dir, "n.sqlite3"))
        self.a = sync_event(self.store, "siteA", "a", 0)
        self.b = sync_event(self.store, "siteA", "b", 1)
        self.other_site = sync_event(self.store, "siteB", "c", 2)

    def tearDown(self):
        self.store.close()

    def baseline(self):
        return sorted(tuple(r) for r in self.store.db.execute(
            "SELECT event_id, opened_at, dismissed_at FROM notification_recipients WHERE user_id LIKE '#project:%'"))

    # ── two users, one project ──
    def test_a_user_sees_the_whole_project_unread_until_they_act(self):
        for user in ("alice", "bob"):
            self.assertEqual(sorted(ids(self.store.list_notifications(user, "siteA"))), sorted([self.a, self.b]))
            self.assertEqual(self.store.unread_count(user, "siteA"), 2)

    def test_opening_is_this_users_alone(self):
        self.assertIsNotNone(self.store.mark_opened("alice", "siteA", self.a, now=T0)["opened_at"])
        self.assertEqual(self.store.unread_count("alice", "siteA"), 1)
        self.assertEqual(self.store.unread_count("bob", "siteA"), 2, "bob's count did not move")
        self.assertIsNone(self.store.get_notification("bob", "siteA", self.a)["opened_at"])
        self.assertEqual(ids(self.store.list_notifications("bob", "siteA", view="read")), [])
        self.assertEqual(ids(self.store.list_notifications("alice", "siteA", view="read")), [self.a])

    def test_dismissing_and_undoing_is_this_users_alone(self):
        self.store.dismiss("alice", "siteA", self.a)
        self.assertEqual(ids(self.store.list_notifications("alice", "siteA")), [self.b])
        self.assertEqual(sorted(ids(self.store.list_notifications("bob", "siteA"))), sorted([self.a, self.b]))
        self.store.dismiss("bob", "siteA", self.a)
        self.assertIsNone(self.store.undismiss("alice", "siteA", self.a)["dismissed_at"])
        self.assertEqual(sorted(ids(self.store.list_notifications("alice", "siteA"))), sorted([self.a, self.b]))
        self.assertEqual(ids(self.store.list_notifications("bob", "siteA")), [self.b], "bob's dismiss stays his")

    def test_bulk_actions_are_this_users_alone(self):
        self.assertEqual(self.store.mark_all_opened("alice", "siteA"), 2)
        self.assertEqual(self.store.mark_all_opened("alice", "siteA"), 0)
        self.assertEqual(self.store.unread_count("bob", "siteA"), 2)
        self.assertEqual(self.store.dismiss_opened("alice", "siteA"), 2)
        self.assertEqual(self.store.list_notifications("alice", "siteA")["items"], [])
        self.assertEqual(len(self.store.list_notifications("bob", "siteA")["items"]), 2)
        self.assertEqual(self.store.mark_all_opened("bob", "siteA"), 2)

    def test_repeating_an_action_changes_nothing_and_is_recorded_once_per_user(self):
        first = self.store.mark_opened("alice", "siteA", self.a, now=T0)["opened_at"]
        self.assertEqual(self.store.mark_opened("alice", "siteA", self.a, now=T0 + timedelta(hours=1))["opened_at"], first)
        self.store.mark_opened("bob", "siteA", self.a, now=T0 + timedelta(hours=2))
        history = [tuple(r) for r in self.store.db.execute(
            "SELECT user_id, status FROM notification_delivery_history WHERE event_id = ? ORDER BY user_id", (self.a,))]
        self.assertEqual(history, [("alice", "opened"), ("bob", "opened")], "who did what stays on record")

    def test_the_shared_baseline_row_is_never_written_by_a_user(self):
        before = self.baseline()
        self.store.mark_opened("alice", "siteA", self.a)
        self.store.dismiss("bob", "siteA", self.b)
        self.store.mark_all_opened("alice", "siteA")
        self.store.dismiss_opened("bob", "siteA")
        self.assertEqual(self.baseline(), before)

    # ── two projects ──
    def test_another_site_is_invisible_and_unchangeable(self):
        self.assertIsNone(self.store.get_notification("alice", "siteA", self.other_site))
        self.assertIsNone(self.store.mark_opened("alice", "siteA", self.other_site))
        self.assertIsNone(self.store.dismiss("alice", "siteA", self.other_site))
        self.assertIsNone(self.store.undismiss("alice", "siteA", self.other_site))
        self.assertEqual(self.store.unread_count("alice", "siteB"), 1)
        self.assertEqual(self.store.unread_count("alice", "siteA"), 2)

    def test_the_same_user_name_on_two_sites_has_two_independent_states(self):
        self.store.mark_opened("alice", "siteA", self.a)
        self.store.dismiss("alice", "siteB", self.other_site)
        self.assertEqual(self.store.unread_count("alice", "siteB"), 0)
        self.assertEqual(self.store.unread_count("alice", "siteA"), 1)
        self.assertEqual(self.store.list_notifications("alice", "siteB")["items"], [])
        self.store.update_preferences("alice", "siteA", types={"report.ready": False})
        self.assertEqual(self.store.get_preferences("alice", "siteB")["types"], {})

    # ── a notification only some users were sent (direct delivery) stays theirs ──
    def test_a_direct_delivery_is_visible_to_that_user_only(self):
        self.store.db.execute("INSERT INTO notification_events (id, site_id, type, severity, created_at, last_at, state, status,"
                              " dedup_key) VALUES ('ntf_direct', 'siteA', 'wo.assigned', 'info', 'x', 'x', 's', 'active', 'k')")
        self.store.db.execute("INSERT INTO notification_recipients (id, event_id, user_id, channel, delivery_status)"
                              " VALUES ('r1', 'ntf_direct', 'alice', 'inapp', 'delivered')")
        self.assertIn("ntf_direct", ids(self.store.list_notifications("alice", "siteA")))
        self.assertNotIn("ntf_direct", ids(self.store.list_notifications("bob", "siteA")))
        self.assertIsNone(self.store.mark_opened("bob", "siteA", "ntf_direct"))

    # ── identity input ──
    def test_a_user_id_in_the_reserved_baseline_namespace_is_refused_everywhere(self):
        for call in (lambda u: self.store.list_notifications(u, "siteA"), lambda u: self.store.unread_count(u, "siteA"),
                     lambda u: self.store.mark_opened(u, "siteA", self.a), lambda u: self.store.dismiss(u, "siteA", self.a),
                     lambda u: self.store.mark_all_opened(u, "siteA"), lambda u: self.store.get_preferences(u, "siteA"),
                     lambda u: self.store.update_preferences(u, "siteA", master_enabled=False)):
            with self.assertRaises(ValueError):
                call("#project:siteA")
        for bad in ("", "  ", None, 7):
            with self.assertRaises(ValueError):
                self.store.unread_count(bad, "siteA")
        with self.assertRaises(ValueError):
            self.store.unread_count("alice", "bad site!")
        self.assertEqual(self.baseline(), sorted([(self.a, None, None), (self.b, None, None), (self.other_site, None, None)]))

    # ── preferences ──
    def test_preferences_are_per_user_and_site(self):
        self.store.update_preferences("alice", "siteA", types={"report.ready": False}, master_enabled=False)
        self.assertEqual(self.store.get_preferences("alice", "siteA"), {"master_enabled": False, "types": {"report.ready": False}})
        self.assertEqual(self.store.get_preferences("bob", "siteA"), {"master_enabled": True, "types": {}})
        self.assertEqual(self.store.get_preferences("alice", "siteB"), {"master_enabled": True, "types": {}})
        self.assertFalse(self.store.wants("alice", "siteA", "wo.assigned", default=True))
        self.assertTrue(self.store.wants("bob", "siteA", "wo.assigned", default=True))

    def test_the_sites_baseline_preferences_are_inherited_and_a_users_own_win(self):
        self.store.update_project_preferences("siteA", types={"report.ready": False, "alarm.critical": True})
        self.assertEqual(self.store.get_preferences("alice", "siteA")["types"], {"report.ready": False, "alarm.critical": True})
        self.store.update_preferences("alice", "siteA", types={"report.ready": True})
        self.assertEqual(self.store.get_preferences("alice", "siteA")["types"], {"report.ready": True, "alarm.critical": True})
        self.assertEqual(self.store.get_preferences("bob", "siteA")["types"], {"report.ready": False, "alarm.critical": True})
        self.assertEqual(self.store.get_preferences("bob", "siteB")["types"], {})

    def test_a_users_preference_never_changes_whether_the_site_creates_critical_alarms(self):
        self.assertFalse(self.store.project_wants("siteA", "alarm.critical", default=False))
        self.store.update_preferences("alice", "siteA", types={"alarm.critical": True})
        self.assertFalse(self.store.project_wants("siteA", "alarm.critical", default=False))
        self.store.update_project_preferences("siteA", types={"alarm.critical": True})
        self.assertTrue(self.store.project_wants("siteA", "alarm.critical", default=False))
        self.store.update_preferences("bob", "siteA", types={"alarm.critical": False}, master_enabled=False)
        self.assertTrue(self.store.project_wants("siteA", "alarm.critical", default=False), "bob's choice is bob's")
        self.assertFalse(self.store.project_wants("siteB", "alarm.critical", default=False))
        self.store.update_project_preferences("siteA", master_enabled=False)
        self.assertFalse(self.store.project_wants("siteA", "alarm.critical", default=False))

    def test_a_failed_preference_save_keeps_the_old_ones(self):
        self.store.update_preferences("alice", "siteA", types={"report.ready": False})
        with self.assertRaises(ValueError):
            self.store.update_preferences("alice", "siteA", types={"report.ready": True, "int.sync_failed": "yes"})
        self.assertEqual(self.store.get_preferences("alice", "siteA")["types"], {"report.ready": False})


# ── the HTTP API: identity from the session cookie only ─────────────────────────────────────────

class ApiHelpers:
    """Two browsers on one test client (each its own cookie jar), the fake FIN client, a throwaway store."""
    OTHER = "ellisdonDemo"

    def setUp(self):
        self.MARSA = main.BASE_CONFIG["project_name"]
        self._real_client, self._real_store = main.FinScramClient, notifications._store
        main.FinScramClient = FakeFinClient
        FakeFinClient.slow_realtime = False
        FakeFinClient.missing_points = set()

        async def good_read(_self, endpoint, is_text=False):
            return GOOD_WO_READ
        FakeFinClient.fetch_api = good_read
        main.SESSIONS.clear()
        notifications._store = notifications.Store(os.path.join(tempfile.mkdtemp(prefix="eko-ustate-api-"), "n.sqlite3"))
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

    def browser(self, token=None):
        self.http.cookies.clear()
        if token:
            self.http.cookies.set(main.SESSION_COOKIE, token)

    def sign_in(self, user, fin_project=None, project_id="proj-marsa"):
        self.browser()
        r = self.http.post("/api/fin/login", json={"username": user, "password": "pw-" + user,
                                                   "settings": {"finProjectName": fin_project or self.MARSA}, "project_id": project_id})
        self.assertEqual(r.status_code, 200, r.text)
        return self.http.cookies.get(main.SESSION_COOKIE)

    def call(self, method, path, project="proj-marsa", **kw):
        headers = kw.pop("headers", {})
        headers["X-Eko-Project"] = project
        return self.http.request(method, main.NOTIF_BASE + path, headers=headers, **kw)

    def page(self, project="proj-marsa", **params):
        r = self.call("GET", "/notifications", project=project, params=params)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def event(self, site, state):
        return self.http.portal.call(lambda: sync_event(notifications.store(), site, state))

    def assert_error(self, r, status, code):
        self.assertEqual(r.status_code, status, r.text)
        self.assertEqual(r.json()["error"]["code"], code)


class UserStateApiTests(ApiHelpers, unittest.TestCase):
    def test_two_users_in_one_project_keep_separate_read_and_dismissed_state(self):
        a, b = self.event(self.MARSA, "a"), self.event(self.MARSA, "b")
        alice, bob = self.sign_in("alice"), self.sign_in("bob")
        self.browser(alice)
        self.assertEqual((self.page()["unread_count"], self.page()["scope"]), (2, "user"))
        self.assertIsNotNone(self.call("POST", f"/notifications/{a}/opened").json()["opened_at"])
        self.assertIsNotNone(self.call("POST", f"/notifications/{b}/dismiss").json()["dismissed_at"])
        self.assertEqual(self.page()["unread_count"], 0)
        self.browser(bob)
        self.assertEqual(self.page()["unread_count"], 2)
        self.assertEqual(sorted(i["id"] for i in self.page()["items"]), sorted([a, b]))
        self.assertTrue(all(i["opened_at"] is None and i["dismissed_at"] is None for i in self.page()["items"]))
        self.assertEqual(self.call("POST", "/notifications/opened-all").json(), {"updated": 2})
        self.browser(alice)
        self.assertEqual([i["id"] for i in self.page()["items"]], [a])
        self.assertEqual(self.page()["unread_count"], 0)
        self.assertEqual(self.call("DELETE", f"/notifications/{b}/dismiss").json()["dismissed_at"], None)
        self.browser(bob)
        self.assertEqual(self.page(view="unread")["unread_count"], 0, "bob read both; alice's Undo did not touch him")

    def test_preferences_round_trip_per_user(self):
        alice, bob = self.sign_in("alice"), self.sign_in("bob")
        self.browser(alice)
        r = self.call("PUT", "/preferences", json={"types": {"report.ready": False}, "master_enabled": False})
        site = {"critical_alarms": False}
        self.assertEqual(r.json(), {"master_enabled": False, "types": {"report.ready": False}, "site": site})
        self.browser(bob)
        self.assertEqual(self.call("GET", "/preferences").json(), {"master_enabled": True, "types": {}, "site": site})
        self.call("PUT", "/preferences", json={"types": {"report.ready": True}})
        self.browser(alice)
        self.assertEqual(self.call("GET", "/preferences").json(), {"master_enabled": False, "types": {"report.ready": False}, "site": site})

    def test_the_user_comes_from_the_session_never_from_the_request(self):
        a = self.event(self.MARSA, "a")
        alice, bob = self.sign_in("alice"), self.sign_in("bob")
        self.browser(alice)
        forged = {"X-Eko-User": "bob", "X-User-Id": "bob", "X-Remote-User": "bob", "X-Eko-Role": "admin"}
        self.call("POST", f"/notifications/{a}/opened", headers=dict(forged), params={"user_id": "bob", "user": "bob"})
        self.call("PUT", "/preferences", headers=dict(forged), json={"master_enabled": False})
        self.assert_error(self.call("PUT", "/preferences", json={"user_id": "bob", "master_enabled": True}), 400, "invalid_input")
        self.assert_error(self.call("PUT", "/preferences", json={"role": "admin"}), 400, "invalid_input")
        self.browser(bob)
        self.assertEqual(self.page()["unread_count"], 1, "the forged opened-by-bob request opened it for alice only")
        self.assertTrue(self.call("GET", "/preferences").json()["master_enabled"])
        users = self.http.portal.call(lambda: {r[0] for r in notifications.store().db.execute(
            "SELECT user_id FROM notification_recipients WHERE user_id NOT LIKE '#project:%'")})
        self.assertEqual(users, {"alice"})

    def test_a_user_with_the_reserved_name_cannot_reach_the_shared_baseline(self):
        a = self.event(self.MARSA, "a")
        evil = self.sign_in("#project:" + self.MARSA)
        self.browser(evil)
        for method, path in (("GET", "/notifications"), ("GET", "/preferences"), ("POST", f"/notifications/{a}/opened"),
                             ("POST", "/notifications/opened-all"), ("PUT", "/preferences")):
            kw = {"json": {"master_enabled": False}} if method == "PUT" else {}
            self.assert_error(self.call(method, path, **kw), 400, "invalid_input")
        base = self.http.portal.call(lambda: notifications.store().db.execute(
            "SELECT opened_at FROM notification_recipients WHERE event_id = ?", (a,)).fetchall())
        self.assertEqual([tuple(r) for r in base], [(None,)])

    def test_unauthenticated_and_wrong_project_sessions_get_clear_errors(self):
        a = self.event(self.MARSA, "a")
        theirs = self.event(self.OTHER, "a")
        alice = self.sign_in("alice")
        self.browser()
        self.assert_error(self.call("GET", "/notifications"), 401, "session_required")
        self.assert_error(self.call("POST", f"/notifications/{a}/opened"), 401, "session_required")
        self.assert_error(self.call("PUT", "/preferences", json={}), 401, "session_required")
        self.browser(alice)
        self.assert_error(self.call("GET", "/notifications", project="proj-other"), 409, "project_mismatch")
        self.assert_error(self.call("GET", f"/notifications/{theirs}"), 404, "not_found")
        # the backend moves to another project (another user signs in there): alice's session is for the old one
        bob = self.sign_in("bob", fin_project=self.OTHER, project_id="proj-other")
        self.browser(alice)
        self.assert_error(self.call("GET", "/notifications", project="proj-other"), 409, "session_project_mismatch")
        self.assert_error(self.call("POST", f"/notifications/{theirs}/opened", project="proj-other"), 409, "session_project_mismatch")
        self.assert_error(self.call("GET", "/preferences", project="proj-other"), 409, "session_project_mismatch")
        self.browser(bob)
        self.assertEqual([i["id"] for i in self.page(project="proj-other")["items"]], [theirs])
        self.assert_error(self.call("POST", f"/notifications/{a}/opened", project="proj-other"), 404, "not_found")
        self.assertEqual(self.http.portal.call(lambda: notifications.store().get_notification("alice", self.MARSA, a))["opened_at"], None)


class CriticalAlarmSiteVsUserTests(ApiHelpers, unittest.TestCase):
    """Whether the SITE creates critical-alarm notifications (config.json critical_alarm_sites plus the
    site's own alarm.critical toggle) is separate from each user's own alarm.critical preference."""
    ALARMS = [{"id": "@a1", "severity": "critical", "source": "AHU-01", "message": "Supply temp high",
               "occurred": "2026-10-16T08:00:00Z", "priority": 250}]

    def setUp(self):
        super().setUp()
        self._sites = main.BASE_CONFIG.get("critical_alarm_sites")

    def tearDown(self):
        main.BASE_CONFIG.pop("critical_alarm_sites", None)
        if self._sites is not None:
            main.BASE_CONFIG["critical_alarm_sites"] = self._sites
        super().tearDown()

    def site_config(self, listed):
        if listed:
            main.BASE_CONFIG["critical_alarm_sites"] = [self.MARSA]
        else:
            main.BASE_CONFIG.pop("critical_alarm_sites", None)

    def site_toggle(self, on):
        self.http.portal.call(lambda: notifications.store().update_project_preferences(self.MARSA, types={"alarm.critical": on}))

    def poll(self):
        self.http.portal.call(lambda: main._note_critical_alarms(self.MARSA, self.ALARMS, True))

    def created(self):
        return self.http.portal.call(lambda: [r for r in notifications.store().events(self.MARSA) if r["type"] == "alarm.critical"])

    def prefs(self, token):
        self.browser(token)
        r = self.call("GET", "/preferences")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_site_disabled_and_user_preference_enabled_creates_nothing_and_says_so(self):
        alice = self.sign_in("alice")
        self.site_config(True)                                  # listed in config.json, but the site's own toggle is off
        self.browser(alice)
        put = self.call("PUT", "/preferences", json={"types": {"alarm.critical": True}}).json()
        self.assertEqual((put["types"], put["site"]), ({"alarm.critical": True}, {"critical_alarms": False}))
        self.poll()
        self.assertEqual(self.created(), [], "a personal opt-in does not switch the site on")
        self.site_config(False)                                 # toggle on but not listed in config.json: still off
        self.site_toggle(True)
        self.poll()
        self.assertEqual(self.created(), [])
        self.assertEqual(self.prefs(alice)["site"], {"critical_alarms": False})
        self.assertEqual(self.prefs(alice)["types"], {"alarm.critical": True}, "the user's own choice is kept")

    def test_site_enabled_and_user_preference_disabled_still_creates_for_the_site(self):
        alice = self.sign_in("alice")
        self.site_config(True)
        self.site_toggle(True)
        self.browser(alice)
        put = self.call("PUT", "/preferences", json={"types": {"alarm.critical": False}}).json()
        self.assertEqual((put["types"], put["site"]), ({"alarm.critical": False}, {"critical_alarms": True}))
        self.poll()
        self.assertEqual(len(self.created()), 1, "one user's opt-out never switches the site off")
        self.assertTrue(self.http.portal.call(lambda: notifications.store().project_wants(self.MARSA, "alarm.critical", False)))

    def test_site_enabled_and_user_preference_enabled(self):
        alice = self.sign_in("alice")
        self.site_config(True)
        self.site_toggle(True)
        self.browser(alice)
        self.call("PUT", "/preferences", json={"types": {"alarm.critical": True}})
        self.poll()
        self.assertEqual(len(self.created()), 1)
        got = self.prefs(alice)
        self.assertEqual((got["types"], got["site"]), ({"alarm.critical": True}, {"critical_alarms": True}))

    def test_two_users_choose_independently_and_neither_moves_the_site(self):
        alice, bob = self.sign_in("alice"), self.sign_in("bob")
        self.site_config(True)
        self.site_toggle(True)
        self.assertEqual(self.prefs(alice)["types"], {"alarm.critical": True}, "starts from the site's baseline")
        self.assertEqual(self.prefs(bob)["types"], {"alarm.critical": True})
        self.browser(alice)
        self.call("PUT", "/preferences", json={"types": {"alarm.critical": False}})
        self.assertEqual(self.prefs(alice)["types"], {"alarm.critical": False})
        self.assertEqual(self.prefs(bob)["types"], {"alarm.critical": True}, "bob is unaffected")
        self.assertEqual(self.prefs(bob)["site"], {"critical_alarms": True})
        self.browser(bob)
        self.call("PUT", "/preferences", json={"types": {"alarm.critical": False}, "master_enabled": False})
        self.assertEqual(self.prefs(alice)["master_enabled"], True)
        self.assertEqual(self.prefs(bob)["site"], {"critical_alarms": True}, "both opted out; the site is still on")

    def test_the_site_part_cannot_be_written_from_a_request(self):
        alice = self.sign_in("alice")
        self.browser(alice)
        for body in ({"site": {"critical_alarms": True}}, {"critical_alarms": True}, {"types": {"alarm.critical": True}, "site": True},
                     {"site_id": "other"}, {"project": "x"}):
            self.assert_error(self.call("PUT", "/preferences", json=body, headers={"X-Eko-Site": "other"}), 400, "invalid_input")
        self.assertEqual(self.prefs(alice)["site"], {"critical_alarms": False})
        self.assertFalse(self.http.portal.call(lambda: notifications.store().project_wants(self.MARSA, "alarm.critical", False)))

    def test_an_unreadable_site_status_is_null_never_assumed_on(self):
        alice = self.sign_in("alice")
        self.site_config(True)
        self.site_toggle(True)
        real = notifications.Store.project_wants

        def broken(self_, *a, **k):
            raise notifications.StoreError(notifications.STORE_FAILED)
        notifications.Store.project_wants = broken
        try:
            got = self.prefs(alice)
        finally:
            notifications.Store.project_wants = real
        self.assertEqual(got["site"], {"critical_alarms": None})
        self.assertEqual(got["master_enabled"], True, "the user's own preferences are still answered")

    def test_unauthenticated_and_wrong_project_requests_never_reach_the_site_status(self):
        alice = self.sign_in("alice")
        self.browser()
        for method in ("GET", "PUT"):
            r = self.call(method, "/preferences", json={})
            self.assert_error(r, 401, "session_required")
            self.assertNotIn("critical_alarms", r.text)
        self.browser(alice)
        self.assert_error(self.call("GET", "/preferences", project="proj-other"), 409, "project_mismatch")
        self.assert_error(self.call("PUT", "/preferences", project="proj-other", json={}), 409, "project_mismatch")
        bob = self.sign_in("bob", fin_project=self.OTHER, project_id="proj-other")   # the backend moves to another project
        self.browser(alice)
        for method in ("GET", "PUT"):
            r = self.call(method, "/preferences", project="proj-other", json={})
            self.assert_error(r, 409, "session_project_mismatch")
            self.assertNotIn("critical_alarms", r.text)
        self.browser(bob)
        self.assertEqual(self.call("GET", "/preferences", project="proj-other").json()["site"], {"critical_alarms": False})


class OptOutStoreTests(unittest.TestCase):
    """A user who switched critical alarms off: the server leaves them out of the list, its pages, the unread
    count and the bulk actions, all by one rule. 150 other notifications and 60 critical alarms, interleaved."""
    SYNC_N, CRIT_N = 150, 60
    template = None

    @classmethod
    def setUpClass(cls):
        cls.base = tempfile.mkdtemp(prefix="eko-optout-")
        cls.template = os.path.join(cls.base, "template.sqlite3")
        store = notifications.Store(cls.template)
        n = 0
        for i in range(cls.SYNC_N + cls.CRIT_N):
            critical = i % 7 in (1, 4, 6) and n < cls.CRIT_N
            n += critical
            at = T0 + timedelta(minutes=i)
            if critical:
                store.condition("siteA", "alarm.critical", True, severity="critical", source_kind="alarm", source_ref=f"@a{i}",
                                asset_id="AHU-01", state=f"@a{i}", now=at)
            else:
                sync_event(store, "siteA", f"s{i}", i)
        sync_event(store, "siteB", "other-site", 5)
        store.close()

    def setUp(self):
        self.path = os.path.join(tempfile.mkdtemp(prefix="eko-optout-t-"), "n.sqlite3")
        shutil.copy(self.template, self.path)
        self.store = notifications.Store(self.path)

    def tearDown(self):
        self.store.close()

    def walk(self, user, site="siteA", **kw):
        """Every page of a list, following next_cursor (limit 100 as the bell asks): (items, page sizes)."""
        items, sizes, cursor = [], [], None
        while True:
            page = self.store.list_notifications(user, site, limit=100, cursor=cursor, **kw)
            items += page["items"]
            sizes.append(len(page["items"]))
            cursor = page["next_cursor"]
            if not cursor:
                return items, sizes

    def critical(self, items):
        return [i for i in items if i["type"] == "alarm.critical"]

    def test_the_site_made_them_and_the_user_has_not_opted_out_so_everything_is_listed(self):
        items, sizes = self.walk("alice")
        self.assertEqual((len(items), sizes, len(self.critical(items))), (210, [100, 100, 10], 60))
        self.assertEqual(self.store.unread_count("alice", "siteA"), 210)
        self.store.update_preferences("alice", "siteA", types={"alarm.critical": True})      # opted in: the same
        self.assertEqual(self.store.unread_count("alice", "siteA"), 210)
        self.assertEqual(len(self.walk("alice")[0]), 210)

    def test_an_opted_out_user_gets_pages_and_a_count_that_leave_the_critical_alarms_out(self):
        self.store.update_preferences("alice", "siteA", types={"alarm.critical": False})
        items, sizes = self.walk("alice")
        self.assertEqual((len(items), sizes), (150, [100, 50]), "full pages of what is shown; the last page is the short one")
        self.assertEqual(self.critical(items), [])
        self.assertEqual(len({i["id"] for i in items}), 150, "no row repeated or skipped across the pages")
        self.assertEqual(self.store.unread_count("alice", "siteA"), 150, "the count is of the same rows, however many pages")
        self.assertEqual(len(self.walk("alice", view="unread")[0]), 150)
        self.assertEqual(self.walk("alice", view="read")[0], [])
        self.assertEqual(self.walk("alice", type_="alarm.critical")[0], [], "not reachable by asking for the type either")
        self.assertEqual(self.walk("alice", severity="critical")[0], [])

    def test_the_other_user_in_the_project_and_the_site_setting_are_untouched(self):
        self.store.update_project_preferences("siteA", types={"alarm.critical": True})
        self.store.update_preferences("alice", "siteA", types={"alarm.critical": False})
        self.assertEqual(self.store.unread_count("bob", "siteA"), 210)
        self.assertEqual((len(self.walk("bob")[0]), self.walk("bob")[1]), (210, [100, 100, 10]))
        self.assertTrue(self.store.project_wants("siteA", "alarm.critical", default=False), "the site still creates them")
        self.assertEqual(self.store.get_preferences("bob", "siteA")["types"], {"alarm.critical": True})
        self.assertEqual(self.store.unread_count("alice", "siteA"), 150)
        self.assertEqual(self.store.unread_count("alice", "siteB"), 1, "another site is its own")

    def test_a_users_own_choice_wins_over_the_sites_baseline_both_ways(self):
        self.store.update_project_preferences("siteA", types={"alarm.critical": False})
        self.assertEqual(self.store.unread_count("alice", "siteA"), 150, "the site's baseline says off")
        self.store.update_preferences("alice", "siteA", types={"alarm.critical": True})
        self.assertEqual(self.store.unread_count("alice", "siteA"), 210, "alice opted in over it")
        self.assertEqual(self.store.unread_count("bob", "siteA"), 150)
        self.store.update_project_preferences("siteA", types={"alarm.critical": True})
        self.store.update_preferences("bob", "siteA", types={"alarm.critical": False})
        self.assertEqual((self.store.unread_count("bob", "siteA"), self.store.unread_count("carol", "siteA")), (150, 210))

    def test_the_master_switch_off_also_hides_them_and_only_them(self):
        self.store.update_preferences("alice", "siteA", master_enabled=False)
        items, _ = self.walk("alice")
        self.assertEqual((len(items), self.store.unread_count("alice", "siteA")), (150, 150))
        self.assertEqual(len(self.walk("alice", type_="int.sync_failed")[0]), 150, "other types are never hidden here")

    def test_mark_all_read_and_dismiss_read_never_touch_the_hidden_notifications(self):
        self.store.update_preferences("alice", "siteA", types={"alarm.critical": False})
        crit_ids = {i["id"] for i in self.critical(self.walk("bob")[0])}
        self.assertEqual(len(crit_ids), 60)
        history_before = self.store.db.execute("SELECT count(*) FROM notification_delivery_history").fetchone()[0]
        self.assertEqual(self.store.mark_all_opened("alice", "siteA"), 150)
        self.assertEqual(self.store.unread_count("alice", "siteA"), 0)
        self.assertEqual(self.store.mark_all_opened("alice", "siteA"), 0, "nothing left that she can see")
        touched = self.store.db.execute(
            "SELECT count(*) FROM notification_recipients WHERE user_id = 'alice' AND event_id IN (%s)" % ",".join("?" * 60), list(crit_ids)).fetchone()[0]
        history = self.store.db.execute(
            "SELECT count(*) FROM notification_delivery_history WHERE event_id IN (%s)" % ",".join("?" * 60), list(crit_ids)).fetchone()[0]
        self.assertEqual((touched, history), (0, 0), "no row and no history were made for notifications she cannot see")
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM notification_delivery_history").fetchone()[0], history_before + 150)
        self.assertEqual(self.store.dismiss_opened("alice", "siteA"), 150)
        self.assertEqual(self.store.list_notifications("alice", "siteA")["items"], [])
        self.assertEqual(self.store.unread_count("bob", "siteA"), 210, "bob's state is untouched")
        self.assertEqual(len(self.walk("bob")[0]), 210)
        # opting back in: the critical alarms are exactly as they were, unread and not dismissed
        self.store.update_preferences("alice", "siteA", types={"alarm.critical": True})
        items, _ = self.walk("alice")
        self.assertEqual(len(items), 60)
        self.assertTrue(all(i["type"] == "alarm.critical" and i["opened_at"] is None and i["dismissed_at"] is None for i in items))
        self.assertEqual(self.store.unread_count("alice", "siteA"), 60)

    def test_a_hidden_notification_cannot_be_read_opened_dismissed_or_undone_by_id(self):
        self.store.update_preferences("alice", "siteA", types={"alarm.critical": False})
        hidden = self.critical(self.walk("bob")[0])[0]["id"]
        self.assertIsNone(self.store.get_notification("alice", "siteA", hidden))
        self.assertIsNone(self.store.mark_opened("alice", "siteA", hidden))
        self.assertIsNone(self.store.dismiss("alice", "siteA", hidden))
        self.assertIsNone(self.store.undismiss("alice", "siteA", hidden))
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM notification_recipients WHERE user_id = 'alice'").fetchone()[0], 0)
        self.assertIsNotNone(self.store.get_notification("bob", "siteA", hidden))
        self.assertIsNotNone(self.store.mark_opened("bob", "siteA", hidden)["opened_at"])

    def test_existing_state_and_history_are_not_changed_by_hiding(self):
        self.store.mark_opened("alice", "siteA", self.critical(self.walk("alice")[0])[0]["id"])
        snap = lambda: [tuple(r) for r in self.store.db.execute(  # noqa: E731
            "SELECT event_id, user_id, opened_at, dismissed_at FROM notification_recipients ORDER BY event_id, user_id")]
        before = snap()
        self.store.update_preferences("alice", "siteA", types={"alarm.critical": False})
        self.walk("alice")
        self.store.unread_count("alice", "siteA")
        self.assertEqual(snap(), before, "listing and counting write nothing")
        self.store.update_preferences("alice", "siteA", types={"alarm.critical": True})
        self.assertEqual(snap(), before)


class OptOutApiTests(ApiHelpers, unittest.TestCase):
    """The same through the HTTP API, with the site's creation rule in play: critical alarms are created by the
    site (config.json + its own toggle), and a user's preference only narrows what that user sees."""
    ALARMS = [{"id": f"@c{i}", "severity": "critical", "source": f"AHU-{i:02d}", "message": "Supply temp high",
               "occurred": "2026-10-16T08:00:00Z", "priority": 250} for i in range(60)]

    def setUp(self):
        super().setUp()
        self._sites = main.BASE_CONFIG.get("critical_alarm_sites")

    def tearDown(self):
        main.BASE_CONFIG.pop("critical_alarm_sites", None)
        if self._sites is not None:
            main.BASE_CONFIG["critical_alarm_sites"] = self._sites
        super().tearDown()

    def seed(self, site_listed, site_toggle):
        """120 other notifications, then the site's own critical-alarm creation under the given settings."""
        def work():
            store = notifications.store()
            for i in range(120):
                sync_event(store, self.MARSA, f"s{i}", i)
            if site_toggle:
                store.update_project_preferences(self.MARSA, types={"alarm.critical": True})
            main._note_critical_alarms(self.MARSA, self.ALARMS, True)
        if site_listed:
            main.BASE_CONFIG["critical_alarm_sites"] = [self.MARSA]
        else:
            main.BASE_CONFIG.pop("critical_alarm_sites", None)
        self.http.portal.call(work)

    def walk(self, token):
        self.browser(token)
        items, sizes, cursor, counts = [], [], None, set()
        while True:
            params = {"limit": 100, **({"cursor": cursor} if cursor else {})}
            page = self.call("GET", "/notifications", params=params).json()
            items += page["items"]
            sizes.append(len(page["items"]))
            counts.add(page["unread_count"])
            cursor = page["next_cursor"]
            if not cursor:
                return items, sizes, counts

    def opt(self, token, on):
        self.browser(token)
        self.assertEqual(self.call("PUT", "/preferences", json={"types": {"alarm.critical": on}}).status_code, 200)

    def test_site_enabled_user_disabled_across_pages(self):
        alice, bob = self.sign_in("alice"), self.sign_in("bob")
        self.seed(True, True)
        self.opt(alice, False)
        items, sizes, counts = self.walk(alice)
        self.assertEqual((len(items), sizes, counts), (120, [100, 20], {120}))
        self.assertFalse([i for i in items if i["type"] == "alarm.critical"])
        items, sizes, counts = self.walk(bob)
        self.assertEqual((len(items), sizes, counts), (180, [100, 80], {180}), "bob still sees the 60 the site created")
        self.assertEqual(self.http.portal.call(lambda: notifications.store().project_wants(self.MARSA, "alarm.critical", False)), True)

    def test_site_enabled_user_enabled(self):
        alice = self.sign_in("alice")
        self.seed(True, True)
        self.opt(alice, True)
        items, sizes, counts = self.walk(alice)
        self.assertEqual((len(items), sizes, counts), (180, [100, 80], {180}))
        self.assertEqual(len([i for i in items if i["type"] == "alarm.critical"]), 60)

    def test_site_disabled_creates_none_whatever_the_user_prefers(self):
        alice = self.sign_in("alice")
        self.opt(alice, True)
        for listed, toggle in ((True, False), (False, True), (False, False)):
            self.http.portal.call(lambda: notifications.store().db.execute("DELETE FROM notification_events"))
            self.seed(listed, toggle)
            items, sizes, counts = self.walk(alice)
            self.assertEqual((len(items), counts), (120, {120}), (listed, toggle))
            self.assertFalse([i for i in items if i["type"] == "alarm.critical"], "the user's opt-in did not make the site create them")

    def test_mark_all_read_and_dismiss_read_leave_hidden_alarms_and_the_other_user_alone(self):
        alice, bob = self.sign_in("alice"), self.sign_in("bob")
        self.seed(True, True)
        self.opt(alice, False)
        self.browser(alice)
        self.assertEqual(self.call("POST", "/notifications/opened-all").json(), {"updated": 120})
        self.assertEqual(self.call("GET", "/notifications").json()["unread_count"], 0)
        self.assertEqual(self.call("POST", "/notifications/dismiss-opened").json(), {"updated": 120})
        self.assertEqual(self.walk(alice)[0], [])
        history = self.http.portal.call(lambda: notifications.store().db.execute(
            "SELECT count(*) FROM notification_delivery_history h JOIN notification_events e ON e.id = h.event_id"
            " WHERE e.type = 'alarm.critical'").fetchone()[0])
        self.assertEqual(history, 0, "no history was written for notifications alice could not see")
        self.assertEqual(self.walk(bob)[2], {180}, "bob's state is untouched")
        self.opt(alice, True)
        items, _, counts = self.walk(alice)
        self.assertEqual((len(items), counts), (60, {60}), "back on: the 60 alarms are unread and not dismissed")
        self.assertTrue(all(i["opened_at"] is None and i["dismissed_at"] is None for i in items))

    def test_unauthenticated_and_wrong_project_requests_are_refused(self):
        alice = self.sign_in("alice")
        self.seed(True, True)
        self.browser()
        for method, path in (("GET", "/notifications"), ("POST", "/notifications/opened-all"), ("POST", "/notifications/dismiss-opened")):
            self.assert_error(self.call(method, path), 401, "session_required")
        self.browser(alice)
        for method, path in (("GET", "/notifications"), ("POST", "/notifications/opened-all"), ("POST", "/notifications/dismiss-opened")):
            self.assert_error(self.call(method, path, project="proj-other"), 409, "project_mismatch")
        self.sign_in("bob", fin_project=self.OTHER, project_id="proj-other")      # the backend serves another project now
        self.browser(alice)
        for method, path in (("GET", "/notifications"), ("POST", "/notifications/opened-all"), ("POST", "/notifications/dismiss-opened")):
            self.assert_error(self.call(method, path, project="proj-other"), 409, "session_project_mismatch")
        self.assertEqual(self.http.portal.call(lambda: notifications.store().unread_count("alice", self.MARSA)), 180, "nothing was changed")


# ── migration 4 on copies of earlier databases ──────────────────────────────────────────────────

def _v3_database(path):
    """A real version-3 database as the previous release left it: shared state for two sites."""
    real = notifications.MIGRATIONS
    notifications.MIGRATIONS = real[:3]
    try:
        old = notifications.Store(path)
    finally:
        notifications.MIGRATIONS = real
    db = old.db
    for eid, site, at in (("ntf_1", "siteA", 1), ("ntf_2", "siteA", 2), ("ntf_3", "siteA", 3), ("ntf_4", "siteB", 4)):
        db.execute("INSERT INTO notification_events (id, site_id, type, severity, created_at, last_at, state, status, dedup_key)"
                   " VALUES (?, ?, 'int.sync_failed', 'warning', ?, ?, 's', 'active', ?)",
                   (eid, site, f"2026-10-0{at}T00:00:00Z", f"2026-10-0{at}T00:00:00Z", f"k-{eid}"))
        db.execute("INSERT INTO notification_audience (event_id, kind, value) VALUES (?, 'project', ?)", (eid, site))
    db.execute("INSERT INTO notification_recipients (id, event_id, user_id, channel, delivery_status, opened_at)"
               " VALUES ('r1', 'ntf_1', '#project:siteA', 'inapp', 'delivered', '2026-10-01T01:00:00Z')")
    db.execute("INSERT INTO notification_recipients (id, event_id, user_id, channel, delivery_status, dismissed_at)"
               " VALUES ('r2', 'ntf_2', '#project:siteA', 'inapp', 'delivered', '2026-10-02T01:00:00Z')")
    db.execute("INSERT INTO notification_recipients (id, event_id, user_id, channel, delivery_status)"
               " VALUES ('r3', 'ntf_3', '#project:siteA', 'inapp', 'delivered')")
    db.execute("INSERT INTO notification_recipients (id, event_id, user_id, channel, delivery_status, opened_at, dismissed_at)"
               " VALUES ('r4', 'ntf_4', '#project:siteB', 'inapp', 'delivered', '2026-10-04T01:00:00Z', '2026-10-04T02:00:00Z')")
    db.executemany("INSERT INTO notification_preferences (user_id, site_id, type, enabled) VALUES (?, ?, ?, ?)",
                   [("#project:siteA", "siteA", "alarm.critical", 1), ("#project:siteA", "siteA", "*", 1),
                    ("#project:siteB", "siteB", "report.ready", 0)])
    db.execute("INSERT INTO alarm_acknowledgements (id, site_id, alarm_id, occurrence_id, user_id, acknowledged_at)"
               " VALUES ('ack1', 'siteB', '@a1', '@a1', 'alice', '2026-10-02T00:30:00Z')")
    db.execute("INSERT INTO notification_audit_log (id, site_id, actor_id, action, occurred_at) VALUES ('aud1', 'siteA', 'x', 'earlier', 'x')")
    db.execute("INSERT INTO notification_delivery_history (id, event_id, user_id, channel, status, occurred_at)"
               " VALUES ('d1', 'ntf_1', '#project:siteA', 'inapp', 'opened', '2026-10-01T01:00:00Z')")
    old.close()


TABLES = ("notification_events", "notification_recipients", "notification_audience", "notification_preferences",
          "alarm_acknowledgements", "notification_delivery_history", "eko_role_mapping", "alarm_shelving")


def _tables(path):
    db = sqlite3.connect(path)
    try:
        return {t: sorted(tuple(r) for r in db.execute(f"SELECT * FROM {t}")) for t in TABLES} | {
            "versions": sorted(tuple(r) for r in db.execute("SELECT version FROM schema_migrations"))}
    finally:
        db.close()


class Migration4Tests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="eko-mig4-")
        self.original = os.path.join(self.dir, "original.sqlite3")
        _v3_database(self.original)
        self.path = os.path.join(self.dir, "copy.sqlite3")        # the migration only ever runs on a copy here
        shutil.copy(self.original, self.path)
        self.real = notifications.MIGRATIONS

    def tearDown(self):
        notifications.MIGRATIONS = self.real

    def backups(self):
        return sorted(glob.glob(self.path + ".v*.bak"))

    def audit(self, store):
        return {r["site_id"]: r["details_json"] for r in store.db.execute(
            "SELECT site_id, details_json FROM notification_audit_log WHERE action = 'notifications.per_user_state'")}

    def test_existing_state_is_kept_exactly_and_backed_up_first(self):
        before = _tables(self.path)
        store = notifications.Store(self.path)
        try:
            after = _tables(self.path)
            self.assertEqual(after.pop("versions"), [(1,), (2,), (3,), (4,)])
            before.pop("versions")
            self.assertEqual(after, before, "no notification, recipient, preference, acknowledgement or history row changed")
            [backup] = self.backups()
            self.assertEqual(backup, store.backup_path)
            self.assertIn(".v3-", backup)
            self.assertEqual(_tables(backup), _tables(self.original), "the backup is the database as it was")
            self.assertEqual(_tables(self.original)["versions"], [(1,), (2,), (3,)], "the original file was never touched")
        finally:
            store.close()

    def test_every_user_starts_from_the_shared_state_and_diverges_alone(self):
        store = notifications.Store(self.path)
        try:
            for user in ("alice", "bob"):
                page = store.list_notifications(user, "siteA")
                self.assertEqual(ids(page), ["ntf_3", "ntf_1"], "the dismissed one stays dismissed")
                opened = {i["id"]: i["opened_at"] for i in page["items"]}
                self.assertEqual(opened, {"ntf_3": None, "ntf_1": "2026-10-01T01:00:00Z"}, "read stays read")
                self.assertEqual(store.unread_count(user, "siteA"), 1)
            self.assertEqual(store.list_notifications("alice", "siteB")["items"], [])
            # alice undoes the shared dismissal for herself and opens the third: bob sees none of it
            store.undismiss("alice", "siteA", "ntf_2")
            store.mark_opened("alice", "siteA", "ntf_3")
            self.assertEqual(ids(store.list_notifications("alice", "siteA")), ["ntf_3", "ntf_2", "ntf_1"])
            self.assertEqual(store.unread_count("alice", "siteA"), 1)   # ntf_2 comes back unread
            self.assertEqual(ids(store.list_notifications("bob", "siteA")), ["ntf_3", "ntf_1"])
            self.assertEqual(store.unread_count("bob", "siteA"), 1)
            self.assertIsNone(store.get_notification("bob", "siteA", "ntf_3")["opened_at"])
            # the preferences of the shared recipient are every user's starting point, the site's gate
            self.assertEqual(store.get_preferences("bob", "siteA"), {"master_enabled": True, "types": {"alarm.critical": True}})
            self.assertEqual(store.get_preferences("bob", "siteB")["types"], {"report.ready": False})
            self.assertTrue(store.project_wants("siteA", "alarm.critical", default=False))
            store.update_preferences("alice", "siteA", types={"alarm.critical": False})
            self.assertTrue(store.project_wants("siteA", "alarm.critical", default=False), "alice's choice is not the site's")
            self.assertEqual(store.get_preferences("bob", "siteA")["types"], {"alarm.critical": True})
        finally:
            store.close()

    def test_the_inherited_state_is_recorded_per_site_in_the_audit_trail(self):
        store = notifications.Store(self.path)
        try:
            audit = self.audit(store)
            self.assertEqual(audit, {
                "siteA": '{"baseline_notifications":3,"baseline_opened":1,"baseline_dismissed":1,"baseline_preferences":2}',
                "siteB": '{"baseline_notifications":1,"baseline_opened":1,"baseline_dismissed":1,"baseline_preferences":1}'})
            self.assertEqual(store.db.execute("SELECT count(*) FROM notification_audit_log WHERE id = 'aud1'").fetchone()[0], 1,
                             "the earlier audit history is kept")
        finally:
            store.close()

    def test_running_again_changes_nothing_and_makes_no_second_backup(self):
        notifications.Store(self.path).close()
        once = _tables(self.path)
        db = sqlite3.connect(self.path)
        audit = db.execute("SELECT count(*) FROM notification_audit_log").fetchone()[0]
        db.close()
        for _ in range(2):
            notifications.Store(self.path).close()
        self.assertEqual(_tables(self.path), once)
        self.assertEqual(len(self.backups()), 1)
        db = sqlite3.connect(self.path)
        self.assertEqual(db.execute("SELECT count(*) FROM notification_audit_log").fetchone()[0], audit)
        db.close()

    def test_forcing_the_data_step_twice_does_not_duplicate_the_audit_rows(self):
        store = notifications.Store(self.path)
        try:
            n = store.db.execute("SELECT count(*) FROM notification_audit_log").fetchone()[0]
            store.db.executescript(dict(self.real)[4])
            self.assertEqual(store.db.execute("SELECT count(*) FROM notification_audit_log").fetchone()[0], n)
        finally:
            store.close()

    def test_a_failing_migration_leaves_the_copy_exactly_as_it_was_and_can_be_retried(self):
        before = _tables(self.path)
        notifications.MIGRATIONS = self.real[:3] + [(4, dict(self.real)[4] + "\nINSERT INTO no_such_table VALUES (1);\n")]
        with self.assertRaises(sqlite3.Error):
            notifications.Store(self.path)
        self.assertEqual(_tables(self.path), before, "no audit row and no version 4 is left behind")
        notifications.MIGRATIONS = self.real
        notifications.Store(self.path).close()
        self.assertEqual(_tables(self.path)["versions"], [(1,), (2,), (3,), (4,)])

    def test_a_failed_backup_stops_the_migration(self):
        before = _tables(self.path)
        real = notifications.Store._backup

        def refuse(self, version):
            raise OSError("disk full")
        notifications.Store._backup = refuse
        try:
            with self.assertRaises(OSError):
                notifications.Store(self.path)
        finally:
            notifications.Store._backup = real
        self.assertEqual(_tables(self.path), before)

    def test_an_older_database_walks_through_every_version_with_one_backup(self):
        old = os.path.join(self.dir, "v2.sqlite3")
        notifications.MIGRATIONS = self.real[:2]
        s = notifications.Store(old)
        s.db.execute("INSERT INTO notification_events (id, site_id, type, severity, created_at, last_at, state, status, dedup_key)"
                     " VALUES ('ntf_x', 'siteA', 'int.sync_failed', 'warning', 'x', 'x', 's', 'active', 'kx')")
        s.db.execute("INSERT INTO notification_recipients (id, event_id, user_id, channel, delivery_status, opened_at)"
                     " VALUES ('rx', 'ntf_x', '#project:siteA', 'inapp', 'delivered', '2026-10-01T01:00:00Z')")
        s.close()
        notifications.MIGRATIONS = self.real
        store = notifications.Store(old)
        try:
            self.assertEqual([r[0] for r in store.db.execute("SELECT version FROM schema_migrations ORDER BY version")], [1, 2, 3, 4])
            self.assertEqual(len(glob.glob(old + ".v*.bak")), 1)
            self.assertEqual(store.list_notifications("alice", "siteA")["items"][0]["opened_at"], "2026-10-01T01:00:00Z")
        finally:
            store.close()


if __name__ == "__main__":
    unittest.main()
