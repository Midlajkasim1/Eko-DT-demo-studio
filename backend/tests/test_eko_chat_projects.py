"""Eko-Chat on more than one project: Marsa Al Arab (config.json's own site) and EKO HOSPITAL (FIN project ekoHospital).

Run from backend/:   python -m unittest tests.test_eko_chat_projects
Chat is open to the signed-in, validated project: the same checks as every notification route (FIN connection, this browser's own
session, X-Eko-Project against the project the backend serves, the project the session signed in for), then chat.allowed_projects
only when an operator sets it. Each project is read through its own settings, never another's. Fake FIN, a throwaway notification
database, no model, no network. The Hospital's mappings here are the ones this suite gives it; no real Hospital point is named.
"""
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import main  # noqa: E402
from chat_support import PROJECT_A, wait_for  # noqa: E402
from fake_fin import FakeFinClient  # noqa: E402
from test_eko_chat_metrics import NOW, day_samples, hist, iso  # noqa: E402
from test_eko_chat_rules import RULES, RulesBase  # noqa: E402
import eko_chat  # noqa: E402

# config.json's own site: its FIN mappings (bands 250/150, six distribution boards) come from config.json, not from these settings
MARSA = dict(PROJECT_A, finProjectName="marsaAlArab")
MARSA_ID = "proj-marsa"
# EKO HOSPITAL: its own FIN project on its own server, with bands of its own (priority 200 is critical here, a warning at Marsa)
HOSPITAL = {"finProjectName": "ekoHospital", "finBaseUrl": "https://10.207.200.85", "finDisplayName": "EKO HOSPITAL",
            "finSeverityBands": {"order": "desc", "critical": 180, "warning": 100}}
HOSPITAL_ID = "proj-hospital"
DEFAULT_CHAT = dict(RULES)      # no allowed_projects: nothing narrows chat to a project


class ProjectChatBase(RulesBase):
    def open(self, settings, project_id, cfg=DEFAULT_CHAT):
        """Sign in for this project and wait for its equipment read; the chat config is set after the sign-in (which rebuilds CONFIG)."""
        self.login(settings, project_id)
        wait_for(lambda: self.tool("find_equipment").get("available"))
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(cfg)

    def quiet(self):
        """Stop polling and let the app's loop finish the cancellation, so a poll cannot write into what the test sets up next."""
        main._cancel_polling()
        self.http.get("/api/fin/status")

    def frozen(self, settings, project_id, **caches):
        self.open(settings, project_id)
        self.quiet()
        patches = [mock.patch.object(eko_chat, "_site_now", return_value=NOW)]
        patches += [mock.patch.object(main, name, value) for name, value in caches.items()]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def error(self, response):
        detail = response.json()["detail"]
        return response.status_code, detail["error"]

    def narrowed(self, allowed):
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT, allowed_projects=allowed)


class AccessTests(ProjectChatBase):
    def test_marsa_uses_chat(self):
        self.open(MARSA, MARSA_ID)
        body = self.ok("list all assets")
        self.assertEqual(body["project"], {"id": MARSA_ID, "name": "marsaAlArab"})
        self.assertEqual(body["tool_calls"][0]["name"], "find_equipment")
        self.assertEqual(self.http.get("/api/chat/stats").status_code, 200)

    def test_the_hospital_uses_chat_on_its_own_project(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.assertEqual((main.client.project_name, main.client.base_url), ("ekoHospital", "https://10.207.200.85"))
        body = self.ok("list all assets")
        self.assertEqual(body["project"], {"id": HOSPITAL_ID, "name": "ekoHospital"})
        self.assertEqual(sorted(r[0] for r in body["card"]["rows"]), ["EQ-1", "MTR-1", "PMU-1"])
        self.assertEqual(self.http.get("/api/chat/stats").status_code, 200)

    def test_the_operators_list_can_still_narrow_chat_to_some_projects(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        cases = [(["ekoHospital"], 200), (["marsaAlArab", "ekoHospital"], 200),
                 (["marsaAlArab"], 403),                 # a project that is not listed
                 ([], 403),                              # a list that names nobody admits nobody
                 ("ekoHospital", 403), ({"ekoHospital": True}, 403)]   # not a list: nothing is guessed from it
        for allowed, status in cases:
            with self.subTest(allowed=allowed):
                self.narrowed(allowed)
                r = self.ask("list all assets")
                self.assertEqual(r.status_code, status, r.text)
                if status == 403:
                    self.assertEqual(r.json()["detail"]["error"], "project_not_supported")
                    self.assertNotIn("EQ-1", r.text)
                    self.assertEqual(self.http.get("/api/chat/stats").status_code, 403)

    def test_a_wrong_or_missing_project_header_is_refused_and_nothing_is_read(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        r = self.http.post("/api/chat", json={"message": "list all assets"}, headers={"X-Eko-Project": MARSA_ID})
        self.assertEqual(self.error(r), (409, "project_mismatch"))
        self.assertNotIn("EQ-1", r.text)
        del self.http.headers["X-Eko-Project"]
        self.assertEqual(self.error(self.ask("list all assets")), (400, "project_required"))
        self.assertEqual(self.http.get("/api/chat/stats").status_code, 400)

    def test_a_hospital_session_that_fin_did_not_validate_is_refused(self):
        with mock.patch.object(FakeFinClient, "unknown_projects", {"ekoHospital"}):   # this server has no such project
            self.login(HOSPITAL, HOSPITAL_ID)
            main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT)
            self.assertFalse(main.PROJECT_CHECK["validated"])
            r = self.ask("list all assets")
            self.assertEqual(self.error(r), (409, "project_not_validated"))
            self.assertNotIn("EQ-1", r.text)
            self.assertEqual(self.http.get("/api/chat/stats").status_code, 409)

    def test_a_session_for_another_project_is_refused(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        hospital_cookies = list(self.http.cookies.jar)
        self.http.cookies.clear()
        self.open(MARSA, MARSA_ID)            # the backend now serves Marsa; this browser has Marsa's own session
        self.assertEqual(self.ask("list all assets").status_code, 200)
        self.http.cookies.clear()
        for c in hospital_cookies:
            self.http.cookies.jar.set_cookie(c)
        r = self.ask("list all assets")       # a dashboard that is on Marsa, with the session it signed in for the Hospital
        self.assertEqual(self.error(r), (409, "session_project_mismatch"))
        self.assertNotIn("EQ-1", r.text)

    def test_no_session_and_no_backend_connection_are_refused(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        cookies = list(self.http.cookies.jar)
        self.http.cookies.clear()
        self.assertEqual(self.error(self.ask("list all assets")), (401, "session_required"))
        for c in cookies:
            self.http.cookies.jar.set_cookie(c)
        self.assertEqual(self.ask("list all assets").status_code, 200)
        self.http.post("/api/fin/logout")
        self.assertEqual(self.error(self.ask("list all assets")), (401, "fin_not_connected"))

    def test_a_project_switch_moves_chat_to_the_new_project_only(self):
        self.open(MARSA, MARSA_ID)
        r = self.http.post("/api/fin/project-settings", json={"settings": HOSPITAL, "project_id": HOSPITAL_ID})
        self.assertEqual(r.status_code, 200, r.text)
        self.http.headers["X-Eko-Project"] = HOSPITAL_ID
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT)
        wait_for(lambda: self.tool("find_equipment").get("available"))
        self.assertEqual(self.ok("list all assets")["project"], {"id": HOSPITAL_ID, "name": "ekoHospital"})
        r = self.http.post("/api/chat", json={"message": "list all assets"}, headers={"X-Eko-Project": MARSA_ID})
        self.assertEqual(self.error(r), (409, "project_mismatch"))


class ShippedAllowlistTests(ProjectChatBase):
    """config.json's own chat block, as shipped (chat switched on for the test only): Marsa and the Hospital, nobody else."""

    def shipped(self):
        import json
        with open(os.path.join(HERE, "..", "config.json"), encoding="utf-8") as f:
            return json.load(f)["chat"]

    def use_shipped(self):
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(self.shipped(), enabled=True)

    def test_the_shipped_allowlist_names_marsa_and_the_hospital_and_keeps_the_other_chat_settings(self):
        chat = self.shipped()
        self.assertEqual(chat["allowed_projects"], ["marsaAlArab", "ekoHospital"])
        self.assertEqual((chat["enabled"], chat["provider"], chat["fast_router"], chat["max_concurrent_llm"], chat["timeout_s"]),
                         (False, "rules", True, 2, 60))   # chat stays off until an operator switches it on
        self.assertEqual(chat["api_key_env"], "EKO_CHAT_API_KEY")
        self.assertNotIn("api_key", chat)

    def test_marsa_and_the_hospital_pass_and_every_other_project_is_a_403(self):
        for settings, pid, name, status in ((MARSA, MARSA_ID, "marsaAlArab", 200), (HOSPITAL, HOSPITAL_ID, "ekoHospital", 200),
                                            (PROJECT_A, "proj-A", "projA", 403), (dict(HOSPITAL, finProjectName="ekoHospital2"), "proj-H2", "ekoHospital2", 403),
                                            (dict(HOSPITAL, finProjectName="ekohospital"), "proj-H3", "ekohospital", 403)):   # names are exact
            with self.subTest(project=name):
                self.http.post("/api/fin/logout")
                main.SESSIONS.clear()
                self.login(settings, pid)
                wait_for(lambda: self.tool("find_equipment").get("available"))
                self.use_shipped()
                r = self.ask("list all assets")
                self.assertEqual(r.status_code, status, r.text)
                if status == 403:
                    self.assertEqual(r.json()["detail"]["error"], "project_not_supported")
                    self.assertNotIn("EQ-1", r.text)
                    self.assertEqual(self.http.get("/api/chat/stats").status_code, 403)
                else:
                    self.assertEqual(r.json()["project"]["name"], name)

    def test_the_allowlist_does_not_replace_the_session_checks(self):
        self.login(HOSPITAL, HOSPITAL_ID)
        wait_for(lambda: self.tool("find_equipment").get("available"))
        self.use_shipped()
        r = self.http.post("/api/chat", json={"message": "list all assets"}, headers={"X-Eko-Project": MARSA_ID})
        self.assertEqual(self.error(r), (409, "project_mismatch"))     # a listed project, but not the one this dashboard is serving
        self.http.cookies.clear()
        self.assertEqual(self.error(self.ask("list all assets")), (401, "session_required"))


class MappingTests(ProjectChatBase):
    def test_the_hospital_alarms_are_graded_by_its_own_bands_and_marsa_by_its_own(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.assertEqual(main.CONFIG["severity_bands"], HOSPITAL["finSeverityBands"])
        crit = self.ok("Show critical alerts")
        self.assertEqual([r[:3] for r in crit["card"]["rows"]], [["EQ-1", "critical", "High temperature"]])
        self.assertIn("There are no open warning alarms.", self.ok("show warning alarms")["answer"])
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        self.open(MARSA, MARSA_ID)            # config.json's bands (250/150): the same priority 200 is a warning
        self.assertEqual(main.CONFIG["severity_bands"]["critical"], 250)
        self.assertIn("There are no open critical alarms.", self.ok("Show critical alerts")["answer"])
        self.assertEqual([r[:2] for r in self.ok("show warning alarms")["card"]["rows"]], [["EQ-1", "warning"]])

    def test_the_hospital_equipment_is_what_fin_returned_for_it(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        body = self.ok("What is the status of EQ-1?")
        self.assertEqual(body["tool_calls"][0]["name"], "get_equipment_status")
        self.assertIn("EQ-1", body["answer"])
        self.assertEqual(body["project"]["name"], "ekoHospital")

    def test_marsas_mappings_never_reach_the_hospital(self):
        self.open(MARSA, MARSA_ID)
        marsa_boards = [b["name"] for b in main.CONFIG["power_boards"]]
        self.assertEqual(marsa_boards, ["MCC 1", "MCC 2", "Kitchen SMDB", "LVFP", "ATS", "Sump pump"])
        self.assertTrue(main.CONFIG["live_point_ids"])
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        self.open(HOSPITAL, HOSPITAL_ID)
        for block in ("live_point_ids", "power_endpoints", "equipment_classes", "meter_profile"):
            self.assertEqual(main.CONFIG[block], {}, block)
        self.assertEqual(main.CONFIG["power_boards"], [])
        self.assertEqual(main.CONFIG["workorder_expr"], "")
        self.assertEqual(main._chat_view().power_boards, [])
        self.assertEqual(main._chat_view().project_name, "ekoHospital")

    def test_marsas_distribution_boards_are_not_answered_for_the_hospital(self):
        # the same hourly history under Marsa's own history keys: Marsa ranks its boards, the Hospital has none mapped
        history = {"Hourly_EC_MCC1_his": hist(day_samples(NOW, range(0, 10), lambda h: 5.0)),
                   "Hourly_EC_MCC2_his": hist(day_samples(NOW, range(0, 10), lambda h: 9.0))}
        caches = dict(cached_power_history=history, cached_power_history_at=iso())
        self.frozen(MARSA, MARSA_ID, **caches)
        body = self.ok("Which equipment is consuming the most energy?")
        self.assertIn("Highest energy today by distribution board: MCC 2 (90 kWh)", body["answer"])
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        self.frozen(HOSPITAL, HOSPITAL_ID, **caches)
        body = self.ok("Which equipment is consuming the most energy?")
        self.assertIn("no distribution board is mapped for this project", body["answer"])
        self.assertNotIn("MCC", body["answer"])
        self.assertIsNone(body["card"])

    def test_what_the_hospital_has_not_mapped_is_reported_not_guessed(self):
        self.frozen(HOSPITAL, HOSPITAL_ID, cached_power_data={"timestamp": iso()}, cached_power_history={}, cached_power_history_at=iso())
        self.assertIn("no live point mapped for it (iaq_index)", self.ok("What is the current IAQ index?")["answer"])
        self.assertIn("returned no hourly energy series for this project", self.ok("What is the energy consumption today?")["answer"])
        self.assertIn("returned no hourly energy series", str(self.tool("get_energy", period="today")))
        month = self.ok("What is the energy consumption this month?")["answer"]
        self.assertIn("no live point mapped for it (current_month)", month)

    def test_the_hospital_equipment_discovery_does_not_depend_on_a_mapping(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        found = self.tool("find_equipment")
        self.assertTrue(found["available"])
        self.assertEqual(found["project"], {"id": HOSPITAL_ID, "name": "ekoHospital"})
        self.assertEqual(sorted(e["name"] for e in main.cached_equip_data["equipment"]), ["EQ-1", "MTR-1", "PMU-1"])


class IsolationTests(ProjectChatBase):
    def test_notifications_in_chat_are_the_signed_in_projects_own(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.quiet()
        self.store.condition("ekoHospital", "alarm.critical", True, severity="critical", source_kind="alarm", source_ref="@h1",
                             asset_id="HOSP-1", state="@h1")
        self.store.condition("marsaAlArab", "alarm.critical", True, severity="critical", source_kind="alarm", source_ref="@m1",
                             asset_id="MARSA-9", state="@m1")
        body = self.ok("Show recent notifications")
        self.assertEqual(body["card"]["total"], 1)
        self.assertIn("HOSP-1", str(body))
        self.assertNotIn("MARSA-9", str(body))

    def test_a_hospital_user_cannot_read_or_change_a_marsa_notification(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.quiet()
        marsa_note = self.store.condition("marsaAlArab", "alarm.critical", True, severity="critical", source_kind="alarm", source_ref="@m1",
                                          asset_id="MARSA-9", state="@m1")
        self.assertTrue(marsa_note)
        base = f"{main.NOTIF_BASE}/notifications/{marsa_note}"
        self.assertEqual(self.http.get(base).status_code, 404)
        self.assertEqual(self.http.post(base + "/opened").status_code, 404)
        self.assertEqual(self.http.post(base + "/dismiss").status_code, 404)
        self.assertEqual(self.store.unread_count("u", "marsaAlArab"), 1)        # untouched
        self.assertEqual(self.http.get(main.NOTIF_BASE + "/notifications").json()["items"], [])
        # and the notification routes keep the same session and project checks as chat
        del self.http.headers["X-Eko-Project"]
        self.assertEqual(self.http.get(main.NOTIF_BASE + "/notifications").status_code, 400)

    def test_the_chat_caches_are_the_active_projects_after_a_switch(self):
        self.open(MARSA, MARSA_ID)
        marsa_view = main._chat_view()
        self.assertEqual((marsa_view.project_id, marsa_view.project_name), (MARSA_ID, "marsaAlArab"))
        self.assertEqual(len(marsa_view.power_boards), 6)
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        self.open(HOSPITAL, HOSPITAL_ID)
        view = main._chat_view()
        self.assertEqual((view.project_id, view.project_name, view.power_boards), (HOSPITAL_ID, "ekoHospital", []))
        # the Marsa dashboard's chat and the shipped config are untouched by the Hospital's sign-in
        self.assertEqual(len(main.BASE_CONFIG["power_boards"]), 6)
        self.assertEqual(main.BASE_CONFIG["project_name"], "marsaAlArab")


if __name__ == "__main__":
    unittest.main()
