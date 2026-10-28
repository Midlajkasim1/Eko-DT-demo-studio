"""Rule-based Eko-Chat (chat.provider = "rules"): intents answered from the backend's FIN caches and the notification store,
no language model, one project (Marsa Al Arab unless chat.allowed_projects says otherwise).

Run from backend/:   python -m unittest tests.test_eko_chat_rules
Fake FIN, a throwaway notification database, and a model adapter that fails the test if anything builds or calls it.
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import main  # noqa: E402
import notifications  # noqa: E402
from test_eko_chat import PROJECT_A, PROJECT_B, ChatTestBase, parse_sse, wait_for  # noqa: E402

RULES = {"enabled": True, "provider": "rules"}
SITE = "projA"


def no_model(cfg):
    raise AssertionError("a language model adapter was built")


class RulesBase(ChatTestBase):
    def setUp(self):
        super().setUp()
        main.SESSIONS.clear()   # a session left by an earlier test would keep the shared FIN client connected after a sign-out
        self.addCleanup(main.SESSIONS.clear)
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.store = notifications.Store(os.path.join(self.tmp.name, "n.db"))
        for p in (mock.patch.object(notifications, "store", side_effect=lambda: self.store),
                  mock.patch.object(eko_chat.httpx, "AsyncClient", side_effect=AssertionError("network call")),
                  mock.patch.dict(eko_chat.ADAPTER_FACTORIES, {"rules": no_model, "openai_compatible": no_model})):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(lambda: self.store.db.close())

    def start(self, settings=PROJECT_A, project_id="proj-A", cfg=RULES):
        self.login(settings, project_id)
        self.ready()
        self.set_chat(cfg)

    def ask(self, message, **extra):
        return self.http.post("/api/chat", json={"message": message, **extra})

    def ok(self, message):
        r = self.ask(message)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()


class EquipmentTests(RulesBase):
    def test_the_list_and_count_come_from_the_fin_equipment_read(self):
        self.start()
        records = main.cached_equip_data["equipment"]          # what the FIN client's realtime read returned
        names = sorted(e["name"] for e in records)
        self.assertEqual(names, ["EQ-1", "MTR-1", "PMU-1"])
        for q in ("List all assets", "Show me the equipment.", "What equipment is available in this project?"):
            body = self.ok(q)
            self.assertEqual(body["tool_calls"][0]["name"], "find_equipment")
            self.assertEqual(body["card"]["total"], len(records), q)
            self.assertEqual(sorted(r[0] for r in body["card"]["rows"]), names, q)
            self.assertTrue(all(n in body["answer"] for n in names), body["answer"])
        body = self.ok("How many equipment assets are available?")
        self.assertIn("Equipment items: 3.", body["answer"])
        self.assertEqual(body["card"]["total"], 3)

    def test_a_long_list_is_limited_and_says_so(self):
        self.start()
        now = datetime.now().isoformat()
        many = [{"name": f"AHU-{i:03d}", "floor": "L1", "type": "ahu", "category": "hvac", "inAlarm": False, "alarms": [], "points": []}
                for i in range(120)]
        with mock.patch.object(main, "cached_equip_data", {"timestamp": now, "equipment": many}):
            body = self.ok("list all assets")
        self.assertIn("Equipment items: 120.", body["answer"])
        self.assertIn("Showing 20 of 120.", body["answer"])
        self.assertEqual((body["card"]["total"], len(body["card"]["rows"]), body["card"]["truncated"]), (120, 20, True))

    def test_the_reported_failure_a_realistic_list_is_answered_not_sent_to_the_help_reply(self):
        """'and N more' was worked out from the 20 rows returned: a number in no tool result, so the grounding check threw the
        whole answer away and the help text came back. Names with no digits make it fail every time, whatever the size."""
        self.start()
        now = datetime.now().isoformat()
        for n in (3, 7, 25, 40, 250):
            many = [{"name": f"Pump {chr(65 + i % 26)}{chr(97 + i // 26)}", "floor": "L1", "type": "pump", "category": "hvac",
                     "inAlarm": False, "alarms": [], "points": []} for i in range(n)]
            with mock.patch.object(main, "cached_equip_data", {"timestamp": now, "equipment": many}):
                for q in ("What equipment is available in this project?", "List all equipment.", "Show available equipment.",
                          "How many equipment items are there?", "Show the equipment in this project."):
                    body = self.ok(q)
                    self.assertEqual(body["route"], "direct", (n, q, body["answer"]))
                    self.assertTrue(body["answer"].startswith(f"Equipment items: {n}."), (n, q, body["answer"]))
                    self.assertEqual(body["card"]["total"], n)
                    self.assertEqual(len(body["card"]["rows"]), min(n, 20))
                    if n > 20:
                        self.assertIn(f"Showing 20 of {n}.", body["answer"])
                    self.assertNotRegex(body["answer"], r"and \d+ more")

    def test_a_matched_question_whose_answer_fails_its_check_is_not_called_unsupported(self):
        self.start()
        with mock.patch.object(eko_chat, "_ungrounded", return_value=["99"]):
            body = self.ok("list all assets")
        self.assertEqual(body["route"], "unsupported")
        self.assertIn("could not be checked", body["answer"])
        self.assertNotIn("I can answer", body["answer"])

    def test_the_equipment_is_the_signed_in_projects_own_read(self):
        self.start()
        self.assertEqual(sorted(r[0] for r in self.ok("list all assets")["card"]["rows"]), ["EQ-1", "MTR-1", "PMU-1"])
        self.assertEqual(self.ok("list all assets")["project"]["name"], "projA")

    def test_status_is_the_equipment_record_and_an_unknown_one_is_not_invented(self):
        self.start()
        body = self.ok("What is the status of EQ-1?")
        self.assertIn("EQ-1: open alarms 1; points reporting 1 of 1.", body["answer"])
        self.assertEqual(body["card"]["rows"], [["supply temp", "14", "", ""]])
        gone = self.ok("What is the status of AHU-99?")
        self.assertIn("No equipment named AHU-99 was found.", gone["answer"])
        self.assertEqual(gone["card"]["rows"], [])

    def test_equipment_with_alarms_and_online_systems(self):
        self.start()
        self.assertIn("Equipment currently in alarm (1): EQ-1.", self.ok("Which equipment has active alarms?")["answer"])
        online = self.ok("Which equipment is online?")["answer"]
        fac = main.cached_facility
        self.assertIn(f"Systems online: {fac['onlineEquipment']} of {fac['totalEquipment']}", online)
        self.assertIn("no per-item online flag", online)   # a list of online items is never made up


class AlarmTests(RulesBase):
    def test_critical_uses_the_configured_bands_not_a_direction_assumed_in_code(self):
        self.start()                                  # bands 250/150, desc: priority 200 is a warning
        self.assertIn("There are no open critical alarms.", self.ok("Show critical alerts")["answer"])
        warn = self.ok("show warning alarms")
        self.assertEqual([r[:2] for r in warn["card"]["rows"]], [["EQ-1", "warning"]])
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        self.start(PROJECT_B, "proj-B")               # bands 100/50 desc: the same priority 200 is critical
        crit = self.ok("Show critical alerts")
        self.assertEqual([r[:3] for r in crit["card"]["rows"]], [["EQ-1", "critical", "High temperature"]])
        self.assertIn("Open critical alarms: 1.", crit["answer"])

    def test_latest_alarms_and_alerts_are_the_open_alarm_list(self):
        self.start()
        for q in ("Show the latest alarms", "Show the latest alerts", "how many alerts are open"):
            body = self.ok(q)
            self.assertEqual(body["tool_calls"][0]["name"], "get_alarms", q)
            self.assertEqual(body["card"]["total"], 1, q)


def eq(name, floor="L1", kind="ahu", tags=None, **extra):
    return dict({"name": name, "floor": floor, "type": kind, "category": "hvac", "tags": tags if tags is not None else [kind],
                 "inAlarm": False, "alarms": [], "points": []}, **extra)


class LookupTests(RulesBase):
    """Equipment by name and by class (AHU, FCU, EF), from the open project's own equipment read; close matches are offered, never chosen."""
    def fleet(self, items):
        return mock.patch.object(main, "cached_equip_data", {"timestamp": datetime.now().isoformat(), "equipment": items})

    def test_equipment_named_an_exact_name_is_that_item(self):
        self.start()
        with self.fleet([eq("AHU-1"), eq("AHU-10"), eq("FCU-1", kind="fcu")]):
            for q in ("Show equipment named AHU-1", "show equipment AHU-1", "find the asset called AHU-1"):
                body = self.ok(q)
                self.assertEqual(body["tool_calls"][0]["name"], "get_equipment_status", q)
                self.assertTrue(body["answer"].startswith("AHU-1: open alarms 0"), (q, body["answer"]))

    def test_a_name_that_is_only_close_is_offered_not_chosen(self):
        self.start()
        with self.fleet([eq("AHU-01"), eq("AHU-10"), eq("FCU-1", kind="fcu")]):
            body = self.ok("Show equipment named AHU-1")
        self.assertIn("No equipment named AHU-1 was found.", body["answer"])
        self.assertIn("AHU-01", body["answer"])
        self.assertIn("AHU-10", body["answer"])
        self.assertNotIn("open alarms", body["answer"])          # neither one was picked
        self.assertEqual(sorted(r[0] for r in body["card"]["rows"]), ["AHU-01", "AHU-10"])

    def test_two_items_with_the_same_name_are_ambiguous(self):
        self.start()
        with self.fleet([eq("AHU-1", floor="L1"), eq("AHU_1", floor="L2")]):
            body = self.ok("Show equipment named AHU-1")
        self.assertIn("More than one equipment item matches AHU-1.", body["answer"])
        self.assertNotIn("open alarms", body["answer"])
        self.assertEqual(len(body["card"]["rows"]), 2)

    def test_no_such_equipment_invents_nothing(self):
        self.start()
        with self.fleet([eq("AHU-1")]):
            body = self.ok("Show equipment named PMP-77")
        self.assertIn("No equipment named PMP-77 was found.", body["answer"])
        self.assertEqual(body["card"]["rows"], [])

    def test_a_class_by_its_abbreviation(self):
        self.start()
        fleet = [eq("AHU-1"), eq("AHU-2"), eq("FCU-1", kind="fcu"), eq("EF-01", kind="fan", tags=["fan"]), eq("EF-02", kind="fan", tags=["fan"]),
                 eq("EFFLUENT-PUMP", kind="pump", tags=["pump"])]
        with self.fleet(fleet):
            for q, names in (("What AHUs do we have?", ["AHU-1", "AHU-2"]), ("List all FCUs", ["FCU-1"]), ("show ahu", ["AHU-1", "AHU-2"]),
                             ("How many EF are there?", ["EF-01", "EF-02"]), ("Which fcus are available in this project?", ["FCU-1"])):
                body = self.ok(q)
                self.assertEqual(body["tool_calls"][0]["name"], "find_equipment", q)
                self.assertEqual(sorted(r[0] for r in body["card"]["rows"]), names, q)
                kind = body["card"]["filters"][0]["value"]
                self.assertTrue(body["answer"].startswith(f"Equipment of type {kind}: {len(names)}."), (q, body["answer"]))

    def test_a_class_the_project_does_not_have_says_so(self):
        self.start()
        with self.fleet([eq("AHU-1")]):
            body = self.ok("What chillers do we have?")
        self.assertIn("No equipment of type chiller was found", body["answer"])
        self.assertEqual(body["card"]["total"], 0)

    def test_words_that_are_not_a_class_do_not_become_one(self):
        self.start()
        for q in ("what alarms do we have", "show help", "list notifications please"):
            body = self.ok(q)
            self.assertNotIn("Equipment of type", body["answer"], q)
            self.assertNotIn("No equipment of type", body["answer"], q)

    def test_the_selected_project_phrasings_list_the_equipment(self):
        self.start()
        for q in ("List all equipment in the currently selected project.", "Show the equipment in this project.", "show equipment from the current project"):
            body = self.ok(q)
            self.assertEqual((body["route"], body["card"]["total"]), ("direct", 3), q)

    def test_the_lookup_reads_only_the_open_projects_equipment(self):
        self.start()
        self.assertEqual(sorted(r[0] for r in self.ok("What AHUs do we have?")["card"]["rows"]), ["EQ-1"])
        self.assertEqual(self.ok("Show equipment named EQ-1")["project"]["name"], "projA")
        self.http.cookies.clear()
        r = self.ask("What AHUs do we have?")
        self.assertEqual(r.status_code, 401)
        self.assertNotIn("EQ-1", r.text)

    def test_an_empty_or_unread_equipment_cache_is_reported(self):
        self.start()
        with self.fleet([]):
            self.assertIn("No equipment of type ahu was found", self.ok("What AHUs do we have?")["answer"])
            self.assertIn("No equipment named AHU-1 was found.", self.ok("Show equipment named AHU-1")["answer"])
        with mock.patch.object(main, "cached_equip_data", {}):
            for q in ("What AHUs do we have?", "Show equipment named AHU-1"):
                self.assertIn("has not read this data from FIN yet", self.ok(q)["answer"], q)


class LatestAlarmTests(RulesBase):
    """'Latest alarms' are the newest alarm records of FIN's last alarm read, open or cleared; 'latest open alarms' is the open list."""
    ROWS = [
        {"alarm": True, "active": True, "message": "High temperature", "priority": 300, "sourceRef": {"val": "@e1", "dis": "AHU-1"}, "occurred": "2026-01-02T08:00:00"},
        {"alarm": True, "active": None, "message": "Return to normal", "priority": 300, "sourceRef": {"val": "@e2", "dis": "FCU-9"}, "occurred": "2026-01-03T09:00:00"},
        {"alarm": True, "active": None, "message": "Low flow", "priority": 160, "sourceRef": {"val": "@e3", "dis": "PMP-2"}, "occurred": "2026-01-01T07:00:00"},
    ]

    def frozen(self, rows=None, cfg=RULES):
        self.start(cfg=cfg)
        main._cancel_polling()
        main.client.last_alarm_rows = list(self.ROWS if rows is None else rows)

    def test_latest_alarms_include_cleared_records_and_say_so(self):
        self.frozen()
        body = self.ok("Show the latest alarms")
        rows = body["card"]["rows"]
        self.assertEqual([(r[0], r[1], r[5]) for r in rows], [("FCU-9", "critical", False), ("AHU-1", "critical", True), ("PMP-2", "warning", False)])
        self.assertEqual(body["card"]["columns"][-1], "open")
        self.assertEqual(body["card"]["headline"]["key"], "alarmRecords")
        self.assertIn("open or cleared", body["answer"])
        self.assertIn("not a full alarm archive", body["answer"])

    def test_latest_open_alarms_is_the_open_list_only(self):
        self.frozen()
        body = self.ok("Show the latest open alarms")
        self.assertEqual(body["card"]["headline"]["key"], "alarms")
        self.assertEqual([r[0] for r in body["card"]["rows"]], ["EQ-1"])        # the cache's open alarms, none of the cleared ones

    def test_severity_filter_and_limit_use_the_configured_bands(self):
        self.frozen()
        crit = self.ok("show latest critical alerts")
        self.assertEqual({r[1] for r in crit["card"]["rows"]}, {"critical"})
        self.assertEqual(len(crit["card"]["rows"]), 2)
        one = self.ok("Show the most recent alarm")
        self.assertEqual([r[0] for r in one["card"]["rows"]], ["FCU-9"])
        self.assertEqual(one["card"]["total"], 3)

    def test_no_records_is_said_plainly(self):
        self.frozen(rows=[])
        self.assertIn("holds no alarm records", self.ok("Show the latest alarms")["answer"])

    def test_without_a_history_source_it_is_unavailable_not_the_open_list(self):
        self.start()
        view = main._chat_view()
        no_history = eko_chat.run_tool("get_alarms", {"history": True}, eko_chat.DataView(**{**view.__dict__, "alarm_records": None}))
        self.assertEqual((no_history["available"], no_history["reason"]), (False, "alarm_history_unavailable"))

    def test_existing_open_alarm_questions_are_unchanged(self):
        self.frozen()
        for q, rule in (("Show critical alerts", "alarms.list"), ("What are the current open alarms?", "alarms.list"),
                        ("how many alerts are open", "alarms.count"), ("show warning alarms", "alarms.list")):
            body = self.ok(q)
            self.assertFalse(body["card"]["headline"]["key"] == "alarmRecords", q)


class NotificationLimitTests(RulesBase):
    def seed(self, n=3):
        self.start()
        return [self.store.condition(SITE, "alarm.critical", True, severity="critical", source_kind="alarm", source_ref=f"@a{i}",
                                     asset_id=f"AHU-{i}", state=f"@a{i}") for i in range(1, n + 1)]

    def test_every_phrasing_of_one_recent_notification_is_answered_with_one(self):
        self.seed()
        for q in ("recent one notification", "Show me one recent notification", "Show the latest notification",
                  "Get the most recent notification", "show a recent notification", "give me the newest notification"):
            body = self.ok(q)
            self.assertEqual(body["tool_calls"][0]["name"], "get_notifications", q)
            self.assertEqual(body["card"]["total"], 1, q)
            self.assertEqual(body["route"], "direct", q)

    def test_a_requested_number_is_respected_and_the_plural_is_not_limited_to_one(self):
        self.seed(4)
        self.assertEqual(self.ok("show 2 recent notifications")["card"]["total"], 2)
        self.assertEqual(self.ok("last 3 notifications")["card"]["total"], 3)
        self.assertEqual(self.ok("Show recent notifications")["card"]["total"], 4)

    def test_unread_with_a_limit_and_the_acknowledgement_rule_still_hold(self):
        ids = self.seed()
        self.store.mark_opened("u", SITE, ids[0])
        unread = self.ok("Show unread notifications")
        self.assertEqual((unread["card"]["total"], {r[4] for r in unread["card"]["rows"]}), (2, {False}))
        self.assertEqual(self.ok("show one unread notification")["card"]["total"], 1)
        self.assertIn("does not record acknowledgements", self.ok("Show unacknowledged notifications")["answer"])

    def test_the_records_are_this_projects_for_this_user_and_none_are_made_up(self):
        self.start()
        self.assertIn("You have no notifications", self.ok("Show the latest notification")["answer"])
        self.store.condition("otherProject", "alarm.critical", True, severity="critical", source_kind="alarm", source_ref="@z", asset_id="ZZZ-9", state="@z")
        self.assertNotIn("ZZZ-9", str(self.ok("recent one notification")))


class NotificationTests(RulesBase):
    def seed(self):
        self.start()
        ids = [self.store.condition(SITE, "alarm.critical", True, severity="critical", source_kind="alarm", source_ref=f"@a{i}",
                                    asset_id=f"AHU-{i}", state=f"@a{i}") for i in (1, 2, 3)]
        self.assertTrue(all(ids))
        return ids

    def test_recent_unread_and_read_come_from_the_store(self):
        ids = self.seed()
        self.store.mark_opened("u", SITE, ids[0])
        body = self.ok("Show recent notifications")
        self.assertEqual(body["tool_calls"][0]["name"], "get_notifications")
        self.assertEqual(body["card"]["total"], 3)
        self.assertEqual(sorted(r[4] for r in body["card"]["rows"]), [False, False, True])
        self.assertIn("Notifications listed: 3, 2 unread.", body["answer"])
        unread = self.ok("Show unread notifications")
        self.assertEqual((unread["card"]["total"], {r[4] for r in unread["card"]["rows"]}), (2, {False}))

    def test_acknowledgement_is_never_claimed(self):
        ids = self.seed()
        self.store.mark_opened("u", SITE, ids[0])
        for q in ("Which notifications have been acknowledged?", "Show unacknowledged notifications"):
            body = self.ok(q)
            self.assertIn("does not record acknowledgements", body["answer"], q)
            self.assertIn("1 have been opened and 2 are unread", body["answer"], q)
            self.assertNotRegex(body["answer"].lower(), r"\b\d+ (?:notifications? )?(?:have been |were |are )?acknowledged", q)
        self.assertFalse(eko_chat.run_tool("get_notifications", {}, main._chat_view())["available"])   # no scope outside a request

    def test_no_notifications_is_said_plainly(self):
        self.start()
        self.assertIn("You have no notifications on this project.", self.ok("Show recent notifications")["answer"])

    def test_another_users_state_and_another_project_are_not_shown(self):
        ids = self.seed()
        self.store.condition("otherProject", "alarm.critical", True, severity="critical", source_kind="alarm", source_ref="@z",
                             asset_id="ZZZ-9", state="@z")
        body = self.ok("notifications")
        self.assertEqual(body["card"]["total"], 3)
        self.assertNotIn("ZZZ-9", str(body))
        self.assertEqual(len(ids), 3)

    def test_a_store_fault_is_a_plain_unavailable_answer(self):
        self.start()
        with mock.patch.object(self.store, "list_notifications", side_effect=notifications.StoreError("secret path C:\\db")):
            body = self.ok("Show recent notifications")
        self.assertIn("could not be read", body["answer"])
        self.assertNotIn("secret", str(body))


class FailureTests(RulesBase):
    def test_empty_fin_reads_are_reported_not_filled_in(self):
        self.start()
        with mock.patch.object(main, "cached_equip_data", {}), mock.patch.object(main, "cached_alarm_data", {}):
            for q in ("list all assets", "Show critical alerts", "What is the status of EQ-1?"):
                body = self.ok(q)
                self.assertIn("has not read this data from FIN yet", body["answer"], q)
                self.assertIsNone(body["card"], q)
        fresh = {"timestamp": datetime.now().isoformat(), "equipment": [], "alarms": [], "counts": {}}
        with mock.patch.object(main, "cached_equip_data", fresh), mock.patch.object(main, "cached_alarm_data", fresh):
            self.assertIn("Equipment items: 0.", self.ok("list all assets")["answer"])
            self.assertIn("There are no open alarms.", self.ok("Show the latest open alarms")["answer"])

    def test_stale_data_is_not_served_as_current(self):
        self.start()
        old = {"timestamp": "2020-01-01T00:00:00", "equipment": main.cached_equip_data["equipment"]}
        with mock.patch.object(main, "cached_equip_data", old):
            self.assertIn("too old", self.ok("list all assets")["answer"])

    def test_without_a_fin_session_nothing_is_answered_and_nothing_leaks(self):
        self.start()
        self.http.post("/api/fin/logout")
        r = self.ask("list all assets")
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (401, "fin_not_connected"))
        for word in ("password", "Authorization", "scram", "eko_session", "token"):
            self.assertNotIn(word.lower(), r.text.lower())
        view = eko_chat.DataView(authenticated=False, project_id=None, project_name="")
        self.assertIn("no authenticated FIN session", eko_chat.try_direct("list all assets", lambda: view)["answer"])

    def test_the_caches_cannot_be_read_before_the_guard(self):
        self.start()
        self.http.cookies.clear()
        r = self.ask("list all assets")
        self.assertEqual(r.status_code, 401)
        self.assertNotIn("EQ-1", r.text)


class UnsupportedTests(RulesBase):
    def test_an_unknown_question_gets_the_supported_topics_and_no_data(self):
        self.start()
        for q in ("What's the weather?", "Why is the HVAC having problems?", "Show me the current status of this equipment.", "Show critical alerts and warnings"):
            body = self.ok(q)
            self.assertEqual((body["route"], body["answer_source"], body["tool_calls"], body["card"], body["model"]),
                             ("unsupported", "code", [], None, None), q)
            for topic in ("equipment", "alarms", "notifications"):
                self.assertIn(topic, body["answer"], q)
            self.assertNotIn("EQ-1", body["answer"])

    def test_the_fast_router_switch_does_not_bring_a_model_back(self):
        self.start(cfg=dict(RULES, fast_router=False))
        self.assertEqual(self.ok("list all assets")["route"], "direct")
        self.assertEqual(self.ok("tell me a story")["route"], "unsupported")


class ProjectTests(RulesBase):
    def test_only_the_configured_project_may_use_chat(self):
        marsa = dict(PROJECT_A, finProjectName="marsaAlArab")
        cfg = {"enabled": True, "provider": "rules"}
        self.login(marsa, "proj-M")   # config.json's own project: its FIN mappings are config.json's, so only the equipment read is awaited
        wait_for(lambda: self.tool("find_equipment").get("available"))
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = cfg                  # no allowed_projects: config.json's project_name rules
        self.assertEqual(main.BASE_CONFIG["project_name"], "marsaAlArab")
        self.assertEqual(self.ask("list all assets").status_code, 200)
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        self.login(PROJECT_B, "proj-B")                                       # another project, validly signed in
        wait_for(lambda: self.tool("find_equipment").get("available"))
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = cfg
        r = self.ask("list all assets")
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (403, "project_not_supported"))
        self.assertNotIn("EQ-1", r.text)
        self.assertEqual(self.http.get("/api/chat/stats").status_code, 403)

    def test_the_header_of_another_project_is_still_a_conflict(self):
        self.start()
        r = self.http.post("/api/chat", json={"message": "list all assets"}, headers={"X-Eko-Project": "proj-B"})
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "project_mismatch"))


class ContractTests(RulesBase):
    KEYS = {"answer", "answer_source", "route", "grounded", "tool_calls", "card", "model", "project", "timestamp"}

    def test_the_json_and_card_shape_the_frontend_reads_is_unchanged(self):
        self.start()
        for q in ("list all assets", "Show the latest alarms", "Show recent notifications", "tell me a story"):
            body = self.ok(q)
            self.assertEqual(set(body), self.KEYS, q)
            self.assertEqual(set(body["project"]), {"id", "name"})
            if body["card"]:
                self.assertTrue({"tool", "project", "as_of", "headline", "interpreted_as", "columns", "rows", "total", "filters", "truncated"}
                                <= set(body["card"]), q)
                self.assertTrue(all(len(r) == len(body["card"]["columns"]) for r in body["card"]["rows"]), q)

    def test_the_stream_is_start_tool_done_with_the_answer_whole_in_done(self):
        self.start()
        for q, route in (("list all assets", "direct"), ("tell me a story", "unsupported")):
            r = self.ask(q, stream=True)
            self.assertEqual(r.headers["content-type"].split(";")[0], "text/event-stream")
            events = parse_sse(r.text)
            self.assertEqual(events[0][0], "start")
            self.assertEqual(events[-1][0], "done")
            self.assertEqual(events[-1][1]["route"], route)
            self.assertTrue(events[-1][1]["answer"])
            self.assertEqual({e for e, _ in events} - {"start", "tool", "done"}, set())

    def test_the_configured_provider_is_the_rules_one(self):
        import json   # enabled is the operator's switch and is not asserted here
        with open(os.path.join(HERE, "..", "config.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["chat"]["provider"], "rules")


if __name__ == "__main__":
    unittest.main()
