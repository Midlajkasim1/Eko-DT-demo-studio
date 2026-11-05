"""Alarm lifecycle notifications: a critical alarm raised, acknowledged, cleared and raised again, per FIN project.

Run from backend/:   python -m unittest tests.test_notifications_alarm_lifecycle
Fake FIN responses and a throwaway notification database; nothing is read from or written to a real FIN.
"""
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import main  # noqa: E402
import notifications  # noqa: E402
from chat_support import PROJECT_A, PROJECT_B  # noqa: E402
from test_eko_chat_rules import RulesBase  # noqa: E402

A, B = "projA", "projB"
T0 = datetime(2026, 11, 5, 8, 0, tzinfo=timezone.utc)
BASE = main.NOTIF_BASE


def alarm(fin_id, source="AHU-1", message="Supply air too hot", severity="critical", occurred="2026-11-05T07:55:00"):
    """One alarm as the backend's _flatten_alarms produces it (only the fields the notifications read)."""
    return {"id": fin_id, "source": source, "message": message, "severity": severity, "occurred": occurred, "priority": 250}


class Lifecycle(RulesBase):
    AUTO_SUPERUSER = False   # these tests say who is a superuser, and where
    def gate(self, project="enabled", site_on=True, site=A):
        """Both critical-alarm gates: the project's own setting, and the site's baseline toggle."""
        p = mock.patch.object(main, "_critical_project_gate", return_value=project)
        p.start()
        self.addCleanup(p.stop)
        self.store.update_project_preferences(site, types={"alarm.critical": site_on})

    def poll(self, alarms, site=A, read_ok=True, now=T0):
        main._note_critical_alarms(site, alarms, read_ok, now)

    def rows(self, site=A, type_=None):
        return [e for e in self.store.events(site) if type_ is None or e["type"] == type_]

    def listed(self, site=A, user="u"):
        return self.store.list_notifications(user, site, limit=100)["items"]


class RaisedTests(Lifecycle):
    def test_a_critical_alarm_raises_one_notification_keyed_by_its_fin_id(self):
        self.gate()
        self.poll([alarm("@a1")])
        (row,) = self.rows(type_="alarm.critical")
        self.assertEqual((row["state"], row["source_ref"], row["asset_id"], row["status"]), ("@a1", "@a1", "AHU-1", "active"))
        self.assertEqual(self.listed()[0]["params"]["message"], "Supply air too hot")

    def test_polling_and_reconnecting_never_duplicate_it(self):
        self.gate()
        for n in range(5):
            self.poll([alarm("@a1")], now=T0 + timedelta(seconds=30 * n))
        self.assertEqual(len(self.rows()), 1)
        self.store.db.close()   # a restart: the state is the database's, not the process's
        self.store = notifications.Store(self.store.path)
        self.poll([alarm("@a1")], now=T0 + timedelta(minutes=5))
        self.assertEqual(len(self.rows()), 1)

    def test_only_critical_alarms_with_an_id_are_notified(self):
        self.gate()
        self.poll([alarm("@w1", severity="warning"), alarm("@i1", severity="info"), alarm(None)])
        self.assertEqual(self.rows(), [])

    def test_off_by_default_in_every_gate_state(self):
        for project, site_on in (("not_configured", True), ("disabled", True), ("enabled", False)):
            with self.subTest(project=project, site_on=site_on):
                self.gate(project, site_on)
                self.poll([alarm("@a1")])
                self.assertEqual(self.rows(), [])

    def test_a_project_with_no_toggle_saved_is_off(self):
        with mock.patch.object(main, "_critical_project_gate", return_value="enabled"):
            self.poll([alarm("@a1")])
        self.assertEqual(self.rows(), [])

    def test_a_failed_read_changes_nothing(self):
        self.gate()
        self.poll([alarm("@a1")])
        self.poll([], read_ok=False, now=T0 + timedelta(minutes=1))
        self.assertEqual([r["status"] for r in self.rows()], ["active"])
        self.assertEqual(self.rows(type_="alarm.cleared"), [])


class ClearedAndReraisedTests(Lifecycle):
    def test_a_cleared_alarm_resolves_its_notification_and_says_so_once(self):
        self.gate()
        self.poll([alarm("@a1")])
        for n in range(3):
            self.poll([], now=T0 + timedelta(hours=2, seconds=30 * n))
        (raised,) = self.rows(type_="alarm.critical")
        self.assertEqual(raised["status"], "resolved")
        (cleared,) = self.rows(type_="alarm.cleared")
        item = next(i for i in self.listed() if i["type"] == "alarm.cleared")
        self.assertEqual((item["params"]["alarm_id"], item["params"]["asset"], item["params"]["alarm"], item["params"]["dur"]),
                         ("@a1", "AHU-1", "Supply air too hot", "2h"))
        self.assertEqual(item["source"], {"kind": "alarm", "id": "@a1"})
        self.assertEqual(cleared["status"], "resolved")

    def test_an_alarm_that_returns_within_a_day_is_reraised_once(self):
        self.gate()
        self.poll([alarm("@a1")])
        self.poll([], now=T0 + timedelta(hours=1))
        for n in range(3):   # FIN issues the returning alarm a new id
            self.poll([alarm("@a2")], now=T0 + timedelta(hours=2, seconds=30 * n))
        (again,) = self.rows(type_="alarm.reraised")
        item = next(i for i in self.listed() if i["type"] == "alarm.reraised")
        self.assertEqual((item["params"]["alarm_id"], item["params"]["previous_alarm_id"], item["severity"]), ("@a2", "@a1", "warning"))
        self.assertEqual(again["status"], "resolved")
        self.assertEqual(len(self.rows(type_="alarm.critical")), 2)

    def test_the_same_fin_id_coming_back_is_reraised_too(self):
        self.gate()
        self.poll([alarm("@a1")])
        self.poll([], now=T0 + timedelta(hours=1))
        self.poll([alarm("@a1")], now=T0 + timedelta(hours=2))
        self.assertEqual(len(self.rows(type_="alarm.reraised")), 1)

    def test_a_return_after_a_day_or_of_another_condition_is_a_new_alarm_not_a_reraise(self):
        self.gate()
        self.poll([alarm("@a1")])
        self.poll([], now=T0 + timedelta(hours=1))
        self.poll([alarm("@a2")], now=T0 + timedelta(hours=26))
        self.poll([alarm("@a3", message="Another fault")], now=T0 + timedelta(hours=27))
        self.assertEqual(self.rows(type_="alarm.reraised"), [])

    def test_nothing_lifecycle_is_created_while_the_gate_is_off(self):
        self.gate()
        self.poll([alarm("@a1")])
        self.gate(site_on=False)   # switched off while the alarm is open
        self.poll([], now=T0 + timedelta(hours=1))
        self.assertEqual(self.rows(type_="alarm.cleared"), [])
        self.assertEqual(self.rows(type_="alarm.critical")[0]["status"], "resolved")   # the leftover row still resolves

    def test_a_user_can_hide_the_lifecycle_types_for_themselves(self):
        self.gate()
        self.poll([alarm("@a1")])
        self.poll([], now=T0 + timedelta(hours=1))
        self.store.update_preferences("u", A, types={"alarm.cleared": False})
        self.assertNotIn("alarm.cleared", {i["type"] for i in self.listed()})
        self.assertIn("alarm.cleared", {i["type"] for i in self.listed(user="other")})


class AcknowledgementTests(Lifecycle):
    def open_project(self, settings=PROJECT_A, project_id="proj-A", site=A, role="superuser", alarms=None, gate=True):
        self.login(settings, project_id)
        self.ready()
        main._cancel_polling()
        self.http.get("/api/fin/status")   # let the loop finish cancelling, so a poll cannot overwrite what is set up below
        if role:
            self.store.map_role(site, "u", role, "operator")
        if gate:
            self.gate(site=site)
        caches = {"alarms": alarms if alarms is not None else [alarm("@a1")]}
        p = mock.patch.object(main, "cached_alarm_data", caches)
        p.start()
        self.addCleanup(p.stop)

    def ack(self, alarm_id="@a1", **body):
        return self.http.post(BASE + "/alarm-acknowledgements", json=body or {"alarm_id": alarm_id})

    def test_acknowledging_records_it_and_links_the_alarms_notification(self):
        self.open_project()
        self.poll([alarm("@a1")])
        r = self.ack()
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual((body["notified"], body["fin_acknowledged"], body["acknowledgement"]["user_id"]), (True, False, "u"))
        item = next(i for i in self.listed() if i["type"] == "alarm.ack_recorded")
        p = item["params"]
        self.assertEqual((p["alarm_id"], p["asset"], p["alarm"], p["user"], p["project"]),
                         ("@a1", "AHU-1", "Supply air too hot", "u", A))
        self.assertEqual(p["at"], body["acknowledgement"]["acknowledged_at"])
        original = next(e for e in self.listed() if e["type"] == "alarm.critical")
        self.assertEqual((original["params"]["acknowledged_by"], original["params"]["ack_notification_id"]), ("u", item["id"]))
        self.assertEqual(p["critical_notification_id"], original["id"])
        # the FIN-side state is untouched and the Eko record says so
        row = self.store.db.execute("SELECT user_id, role, fin_sync_status FROM alarm_acknowledgements").fetchone()
        self.assertEqual(tuple(row), ("u", "superuser", "not_sent"))
        self.assertEqual(self.store.db.execute("SELECT action, actor_id FROM notification_audit_log"
                                               " WHERE action = 'alarm.acknowledged'").fetchone()[1], "u")

    def test_the_link_survives_the_next_polls(self):
        self.open_project()
        self.poll([alarm("@a1")])
        self.ack()
        self.poll([alarm("@a1")], now=T0 + timedelta(minutes=1))
        original = next(e for e in self.listed() if e["type"] == "alarm.critical")
        self.assertEqual(original["params"]["acknowledged_by"], "u")

    def test_a_repeat_acknowledgement_changes_nothing(self):
        self.open_project()
        self.poll([alarm("@a1")])
        first = self.ack().json()
        again = self.ack().json()
        self.assertFalse(again["acknowledgement"]["recorded"])
        self.assertEqual(again["notification_id"], first["notification_id"])
        self.assertEqual(len(self.rows(type_="alarm.ack_recorded")), 1)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM alarm_acknowledgements").fetchone()[0], 1)

    def test_the_equipment_and_message_come_from_fin_not_from_the_request(self):
        self.open_project()
        r = self.http.post(BASE + "/alarm-acknowledgements", json={"alarm_id": "@a1", "asset": "FAKE-9", "message": "forged"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.rows(type_="alarm.ack_recorded"), [])

    def test_an_alarm_fin_does_not_report_open_cannot_be_acknowledged(self):
        self.open_project()
        self.assertEqual(self.ack("@nope").status_code, 404)
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM alarm_acknowledgements").fetchone()[0], 0)

    def test_bad_bodies_are_refused(self):
        self.open_project()
        for body in ({}, {"alarm_id": ""}, {"alarm_id": 5}, {"alarm_id": "x" * 600}):
            self.assertEqual(self.http.post(BASE + "/alarm-acknowledgements", json=body).status_code, 400, body)
        self.assertEqual(self.http.post(BASE + "/alarm-acknowledgements", content="nope").status_code, 400)

    def test_only_a_superuser_may_acknowledge(self):
        for role in (None, "technician"):
            with self.subTest(role=role):
                self.open_project(role=role)
                self.assertEqual(self.ack().status_code, 403)
                self.assertEqual(self.rows(type_="alarm.ack_recorded"), [])
                self.http.post("/api/fin/logout")
                main.SESSIONS.clear()

    def test_it_needs_a_session_and_the_open_project(self):
        self.open_project()
        keep = self.http.headers.pop("X-Eko-Project")
        self.assertEqual(self.ack().status_code, 400)
        self.http.headers["X-Eko-Project"] = "proj-B"
        self.assertEqual(self.ack().status_code, 409)
        self.http.headers["X-Eko-Project"] = keep
        self.http.cookies.clear()
        self.assertEqual(self.ack().status_code, 401)
        self.assertEqual(self.rows(), [])

    def test_a_non_critical_acknowledgement_is_recorded_without_a_notification(self):
        self.open_project(alarms=[alarm("@w1", severity="warning")])
        body = self.ack("@w1").json()
        self.assertEqual((body["acknowledgement"]["recorded"], body["notified"]), (True, False))
        self.assertEqual(self.rows(type_="alarm.ack_recorded"), [])
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM alarm_acknowledgements").fetchone()[0], 1)

    def test_with_critical_alarm_notifications_off_it_is_recorded_without_a_notification(self):
        self.open_project(gate=False)
        body = self.ack().json()
        self.assertEqual((body["acknowledgement"]["recorded"], body["notified"]), (True, False))
        self.assertEqual(self.rows(), [])

    def stored(self):
        return self.http.get(BASE + "/alarm-acknowledgements").json()["items"]

    def test_the_acknowledgement_is_still_there_after_a_reload(self):
        self.open_project()
        self.assertEqual(self.stored(), [])
        done = self.ack().json()["acknowledgement"]
        # a reload: a new page asks again, with the same session and nothing else remembered
        (item,) = self.stored()
        self.assertEqual((item["alarm_id"], item["user_id"], item["acknowledged_at"]), ("@a1", "u", done["acknowledged_at"]))
        self.assertEqual((item["recorded_in"], item["fin_acknowledged"], item["fin_sync_status"]), ("eko-dt", False, "not_sent"))
        self.assertEqual(self.stored(), self.stored())   # reading it again changes nothing

    def test_a_stored_acknowledgement_survives_a_restart_of_the_backend(self):
        self.open_project()
        self.ack()
        self.store.db.close()
        self.store = notifications.Store(self.store.path)
        self.assertEqual([i["alarm_id"] for i in self.stored()], ["@a1"])

    def test_only_acknowledgements_of_alarms_fin_still_reports_open_come_back(self):
        self.open_project(alarms=[alarm("@a1", occurred="2026-11-05T07:00:00")])
        self.ack()
        with mock.patch.object(main, "cached_alarm_data", {"alarms": []}):   # cleared in FIN
            self.assertEqual(self.stored(), [])
        with mock.patch.object(main, "cached_alarm_data", {"alarms": [alarm("@a1", occurred="2026-11-05T09:00:00")]}):   # came back: a new occurrence
            self.assertEqual(self.stored(), [])

    def test_another_projects_acknowledgement_is_never_listed(self):
        self.open_project()
        self.store.record_acknowledgement(B, "@a1", "2026-11-05T07:55:00", "someone", "superuser", asset_id="AHU-1",
                                          params={}, notify=False)
        self.assertEqual(self.stored(), [])

    def test_fin_stays_unacknowledged_in_every_answer(self):
        self.open_project()
        self.poll([alarm("@a1")])
        posted = self.ack().json()
        self.assertIs(posted["fin_acknowledged"], False)
        self.assertTrue(all(i["fin_acknowledged"] is False for i in self.stored()))
        # the alarm FIN reports is exactly what FIN reported: nothing in it says acknowledged, and no write went out
        self.assertEqual(main.cached_alarm_data["alarms"], [alarm("@a1")])
        self.assertEqual(self.store.db.execute("SELECT DISTINCT fin_sync_status FROM alarm_acknowledgements").fetchall()[0][0], "not_sent")

    def test_a_failed_request_records_and_shows_nothing_anywhere(self):
        self.open_project()
        self.poll([alarm("@a1")])
        requests = [("a body that is not an object", lambda: self.http.post(BASE + "/alarm-acknowledgements", json=["@a1"])),
                    ("an alarm FIN does not report", lambda: self.ack("@nope")),
                    ("no id", lambda: self.http.post(BASE + "/alarm-acknowledgements", json={}))]
        for label, send in requests:
            with self.subTest(label):
                self.assertIn(send().status_code, (400, 404))
        self.http.cookies.clear()
        self.assertEqual(self.ack().status_code, 401)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM alarm_acknowledgements").fetchone()[0], 0)
        self.assertEqual(self.rows(type_="alarm.ack_recorded"), [])
        self.assertNotIn("acknowledged_by", self.rows(type_="alarm.critical")[0]["params_json"])

    def test_a_new_occurrence_of_the_same_alarm_can_be_acknowledged_again(self):
        self.open_project(alarms=[alarm("@a1", occurred="2026-11-05T07:00:00")])
        self.assertTrue(self.ack().json()["acknowledgement"]["recorded"])
        with mock.patch.object(main, "cached_alarm_data", {"alarms": [alarm("@a1", occurred="2026-11-05T09:00:00")]}):
            self.assertTrue(self.ack().json()["acknowledgement"]["recorded"])


READ_ROUTES = (("GET", "/notifications"), ("GET", "/notifications/{id}"), ("POST", "/notifications/{id}/opened"),
               ("POST", "/notifications/{id}/dismiss"), ("DELETE", "/notifications/{id}/dismiss"),
               ("POST", "/notifications/opened-all"), ("POST", "/notifications/dismiss-opened"),
               ("GET", "/preferences"), ("PUT", "/preferences"), ("GET", "/alarm-acknowledgements"))


class ReadAccessTests(Lifecycle):
    """Notifications are for superusers of the project: the server's role mapping decides, on every route the bell uses."""

    def sign_in(self, role=None, settings=PROJECT_A, project_id="proj-A", site=A):
        if role:
            self.store.map_role(site, "u", role, "operator")
        self.gate(site=site)
        self.poll([alarm("@a1")], site=site)
        self.login(settings, project_id)
        self.ready()
        main._cancel_polling()
        self.http.get("/api/fin/status")
        return self.store.events(site)[0]["id"]

    def call(self, method, path, note_id):
        body = {"types": {}} if (method, path) == ("PUT", "/preferences") else None
        return self.http.request(method, BASE + path.replace("{id}", note_id), json=body)

    def test_a_signed_in_user_who_is_not_a_superuser_is_refused_everywhere(self):
        for role in (None, "technician", "engineer", "executive"):
            with self.subTest(role=role):
                note_id = self.sign_in(role)
                for method, path in READ_ROUTES:
                    r = self.call(method, path, note_id)
                    self.assertEqual(r.status_code, 403, (role, method, path, r.text))
                    self.assertEqual(r.json()["error"]["code"], "forbidden")
                    self.assertNotIn("AHU-1", r.text)   # nothing of the notification is in the refusal
                # and none of those calls changed anything: no read state, no preference
                self.assertEqual(self.store.unread_count("u", A), 1)
                self.assertEqual(self.store.db.execute("SELECT count(*) FROM notification_preferences WHERE user_id = 'u'").fetchone()[0], 0)
                self.http.post("/api/fin/logout")
                main.SESSIONS.clear()
                self.store.db.execute("DELETE FROM eko_role_mapping")

    def test_a_superuser_reads_and_acts_on_their_projects_notifications(self):
        note_id = self.sign_in("superuser")
        listed = self.http.get(BASE + "/notifications")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([i["id"] for i in listed.json()["items"]], [note_id])
        self.assertEqual(listed.json()["unread_count"], 1)
        self.assertEqual(self.http.get(BASE + f"/notifications/{note_id}").status_code, 200)
        self.assertEqual(self.http.post(BASE + f"/notifications/{note_id}/opened").status_code, 200)
        self.assertEqual(self.http.get(BASE + "/notifications").json()["unread_count"], 0)
        self.assertEqual(self.http.get(BASE + "/preferences").status_code, 200)
        self.assertEqual(self.http.put(BASE + "/preferences", json={"types": {"alarm.cleared": False}}).status_code, 200)
        self.assertEqual(self.http.get(BASE + "/alarm-acknowledgements").json(), {"items": []})

    def test_the_session_and_project_checks_still_come_first(self):
        note_id = self.sign_in("superuser")
        keep = self.http.headers["X-Eko-Project"]
        del self.http.headers["X-Eko-Project"]
        self.assertEqual(self.call("GET", "/notifications", note_id).status_code, 400)
        self.http.headers["X-Eko-Project"] = "proj-B"
        self.assertEqual(self.call("GET", "/notifications", note_id).status_code, 409)
        self.http.headers["X-Eko-Project"] = keep
        self.http.cookies.clear()
        for method, path in READ_ROUTES:
            self.assertEqual(self.call(method, path, note_id).status_code, 401, (method, path))

    def test_being_a_superuser_of_one_project_gives_no_access_to_another(self):
        self.store.map_role(A, "u", "superuser", "operator")   # only A
        self.gate(site=A)
        self.store.update_project_preferences(B, types={"alarm.critical": True})
        self.poll([alarm("@a1")], site=A)
        self.poll([alarm("@b1")], site=B)
        self.login(PROJECT_B, "proj-B")
        self.assertEqual(self.http.get(BASE + "/notifications").status_code, 403)
        self.assertEqual(self.http.get(BASE + "/alarm-acknowledgements").status_code, 403)
        self.store.map_role(B, "u", "superuser", "operator")
        items = self.http.get(BASE + "/notifications").json()["items"]
        self.assertEqual([i["source"]["id"] for i in items], ["@b1"])   # B's own, never A's

    def test_polling_by_a_user_who_is_not_a_superuser_reads_nothing_and_writes_nothing(self):
        note_id = self.sign_in(None)
        for _ in range(3):   # the bell polls every 30 s
            self.assertEqual(self.http.get(BASE + "/notifications?limit=100").status_code, 403)
            self.assertEqual(self.http.get(BASE + "/preferences").status_code, 403)
        self.assertEqual(self.store.unread_count("u", A), 1)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM notification_recipients WHERE user_id = 'u'").fetchone()[0], 0)
        self.assertTrue(note_id)

    def test_eko_chat_stays_open_to_the_project_but_its_notifications_tool_is_not(self):
        self.sign_in(None)
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = {"enabled": True, "provider": "rules", "planner": False}
        assets = self.http.post("/api/chat", json={"message": "List all assets"})
        self.assertEqual(assets.status_code, 200, assets.text)
        notes = self.http.post("/api/chat", json={"message": "Show recent notifications"})
        self.assertEqual(notes.status_code, 200, notes.text)
        self.assertNotIn("AHU-1", notes.text)
        self.assertNotIn("Supply air too hot", notes.text)
        self.assertIsNone((notes.json().get("card") or {}).get("total"))
        self.store.map_role(A, "u", "superuser", "operator")
        again = self.http.post("/api/chat", json={"message": "Show recent notifications"})
        self.assertEqual(again.json()["card"]["total"], 1)


class IsolationTests(Lifecycle):
    def test_two_projects_get_independent_notifications(self):
        self.gate(site=A)
        self.store.update_project_preferences(B, types={"alarm.critical": True})
        self.poll([alarm("@a1", source="AHU-A")], site=A)
        self.poll([alarm("@b1", source="AHU-B"), alarm("@b2", source="AHU-C")], site=B)
        self.assertEqual([i["source"]["id"] for i in self.listed(A)], ["@a1"])
        self.assertEqual(sorted(i["source"]["id"] for i in self.listed(B)), ["@b1", "@b2"])
        self.poll([], site=A, now=T0 + timedelta(hours=1))   # A's alarm clears; B's are untouched
        self.assertEqual(len(self.rows(B, "alarm.cleared")), 0)
        self.assertEqual({r["status"] for r in self.rows(B, "alarm.critical")}, {"active"})
        self.assertEqual(len(self.rows(A, "alarm.cleared")), 1)

    def test_an_acknowledgement_in_one_project_is_not_seen_in_the_other(self):
        self.gate(site=A)
        self.store.update_project_preferences(B, types={"alarm.critical": True})
        self.poll([alarm("@x1")], site=A)
        self.poll([alarm("@x1")], site=B)   # the same FIN id on another project is another alarm
        self.store.record_acknowledgement(A, "@x1", "occ", "u", "superuser", asset_id="AHU-1", params={"alarm": "m", "asset": "AHU-1"},
                                          notify=True)
        self.assertIn("alarm.ack_recorded", {i["type"] for i in self.listed(A)})
        self.assertNotIn("alarm.ack_recorded", {i["type"] for i in self.listed(B)})
        self.assertNotIn("acknowledged_by", next(i for i in self.listed(B) if i["type"] == "alarm.critical")["params"])

    def test_the_bell_after_a_project_switch_shows_only_the_new_projects_rows(self):
        self.gate(site=A)
        self.poll([alarm("@a1")], site=A)
        for site in (A, B):
            self.store.map_role(site, "u", "superuser", "operator")
        self.login(PROJECT_A, "proj-A")
        self.assertEqual([i["source"]["id"] for i in self.http.get(BASE + "/notifications").json()["items"]], ["@a1"])
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        self.login(PROJECT_B, "proj-B")
        self.assertEqual(self.http.get(BASE + "/notifications").json()["items"], [])
        self.http.headers["X-Eko-Project"] = "proj-A"   # a dashboard left on the old project is refused, not served the new one
        self.assertEqual(self.http.get(BASE + "/notifications").status_code, 409)

    def test_the_lifecycle_routes_refuse_a_visitor_with_no_session(self):
        self.gate()
        self.poll([alarm("@a1")])
        self.http.cookies.clear()
        self.assertEqual(self.http.get(BASE + "/notifications").status_code, 401)


class UnchangedTypesTests(Lifecycle):
    def test_sync_failure_is_still_one_row_while_it_fails_and_resolves_after(self):
        with mock.patch.object(main, "client", SimpleNamespace(project_name=A)):
            for _ in range(3):
                main._note_workorder_sync("FIN timed out")
            (row,) = self.rows(type_="int.sync_failed")
            self.assertEqual(row["status"], "active")
            self.assertEqual(self.listed()[0]["params"], {"system": "FIN", "reason": "FIN timed out"})
            main._note_workorder_sync("FIN unreachable")   # a changed reason updates the same row
            self.assertEqual(self.listed()[0]["params"]["reason"], "FIN unreachable")
            main._note_workorder_sync("")
        self.assertEqual(self.rows(type_="int.sync_failed")[0]["status"], "resolved")

    def test_read_and_dismissed_state_is_per_user_for_every_alarm_type(self):
        self.gate()
        self.poll([alarm("@a1")])
        self.poll([], now=T0 + timedelta(hours=1))
        ids = [i["id"] for i in self.listed()]
        self.assertEqual(self.store.unread_count("u", A), len(ids))
        self.store.mark_opened("u", A, ids[0])
        self.assertEqual(self.store.unread_count("u", A), len(ids) - 1)
        self.assertEqual(self.store.unread_count("v", A), len(ids))
        self.store.mark_all_opened("u", A)
        self.assertEqual(self.store.unread_count("u", A), 0)
        self.assertEqual(self.store.unread_count("v", A), len(ids))


if __name__ == "__main__":
    unittest.main()
