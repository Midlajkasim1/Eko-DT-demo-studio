"""Eko-Chat Phase 1: the capability registry, get_capabilities, what-can-you-do, counts by class, and honest answers for what is unmapped or
not supported (themes and navigation, comparisons, work orders, writes).

Run from backend/:   python -m unittest tests.test_eko_chat_capabilities
Everything about a project comes from its own Data Mapping names (never a point ID). Fake FIN, a throwaway notification database, no model,
no network; the one model test replaces the model client with one that is down.
"""
import json
import os
import sys
import unittest
from datetime import datetime, timedelta
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_capabilities as caps  # noqa: E402
import eko_chat_llm  # noqa: E402
import eko_chat_router  # noqa: E402
import main  # noqa: E402
from eko_chat import DataView  # noqa: E402
from test_eko_chat_projects import DEFAULT_CHAT, HOSPITAL, HOSPITAL_ID, MARSA, MARSA_ID, ProjectChatBase  # noqa: E402

with open(os.path.join(HERE, "..", "config.json"), encoding="utf-8") as _f:
    SHIPPED = json.load(_f)
MARSA_MAPPED = {"finLivePoints": [k for k in SHIPPED["live_point_ids"] if not k.startswith("_")],
                "finEndpoints": [k for k in SHIPPED["power_endpoints"] if not k.startswith("_")],
                "finEquipmentClasses": True, "finMeterProfile": True, "finSeverityBands": True}
NOTHING_MAPPED = {"finLivePoints": [], "finEndpoints": [], "finEquipmentClasses": False, "finMeterProfile": False, "finSeverityBands": False}


def by_id(rows):
    return {r["id"]: r for r in rows}


class RegistryTests(unittest.TestCase):
    def test_ids_are_unique_and_every_row_is_well_formed(self):
        self.assertEqual(len(caps.IDS), len(set(caps.IDS)))
        for c in caps.CAPABILITIES:
            self.assertIn(c["area"], caps.AREAS, c["id"])
            self.assertTrue(c["label"], c["id"])
            if c.get("status") == caps.NOT_SUPPORTED:
                self.assertIn(c["reason"], ("planned", "read_only"), c["id"])
                self.assertNotIn("tool", c, c["id"])
            else:
                self.assertIn(c["tool"], eko_chat.TOOLS, c["id"])

    def test_every_chat_tool_belongs_to_a_capability(self):
        self.assertEqual({c.get("tool") for c in caps.CAPABILITIES} - {None}, set(eko_chat.TOOLS))

    def test_what_a_capability_needs_is_a_real_mapping_name_of_the_shipped_site(self):
        live, endpoints = set(SHIPPED["live_point_ids"]), set(SHIPPED["power_endpoints"])
        for c in caps.CAPABILITIES:
            for group in c.get("needs") or []:     # a group may offer a legacy alias (Total_Power_Consumption_his): one of them is the site's own
                names = {"live": live, "endpoint": endpoints}
                named = [a for a in group if a[0] in names]
                if named:
                    self.assertTrue(any(a[1] in names[a[0]] for a in named), (c["id"], named))

    def test_the_registry_asks_for_what_the_environment_tool_reads(self):
        for metric, keys in eko_chat.ENV_LIVE.items():
            needs = {a[1] for g in caps._BY_ID[f"environment.{metric}"].get("needs") or [] for a in g if a[0] == "live"}
            self.assertEqual(needs, {k for k, *_ in keys} if metric != "co2" else {"ra_co2"}, metric)
        self.assertEqual(caps.ENERGY_SERIES, eko_chat.ENERGY_SERIES)

    def test_a_capability_reads_a_cache_the_tool_reports(self):
        states = eko_chat._read_states(DataView(authenticated=True, project_id="p", project_name="x"))
        for c in caps.CAPABILITIES:
            if c.get("reads"):
                self.assertIn(c["reads"], states, c["id"])

    def test_every_not_yet_supported_item_has_a_message_and_a_reason(self):
        planned = [c for c in caps.CAPABILITIES if c.get("reason") == "planned"]
        self.assertGreaterEqual(len(planned), 8)
        for c in caps.CAPABILITIES:
            if c.get("reason") == "read_only":
                self.assertTrue(c.get("note"), c["id"])


class EvaluateTests(unittest.TestCase):
    def test_a_fully_mapped_site_has_every_tool_capability_available(self):
        rows = caps.evaluate(MARSA_MAPPED, SHIPPED["power_boards"])
        self.assertEqual({r["id"] for r in rows if r["status"] == caps.UNMAPPED}, set())
        self.assertEqual(by_id(rows)["energy.boards"]["status"], caps.AVAILABLE)
        # the one limit a fully mapped site still has: the alarm records are those of FIN's latest read, not an archive (Phase 2: partial)
        self.assertEqual({r["id"]: r["status"] for r in rows if r["limitations"]}, {"alarms.history_summary": caps.PARTIAL})

    def test_a_project_with_nothing_mapped_names_exactly_what_is_missing(self):
        rows = by_id(caps.evaluate(NOTHING_MAPPED, []))
        need = lambda i: [(m["mapping"], m["key"]) for m in rows[i]["missing"]]   # noqa: E731
        self.assertEqual(need("environment.iaq"), [("finLivePoints", "iaq_index")])
        self.assertEqual(need("environment.comfort"), [("finLivePoints", "comfort_compliance")])
        self.assertEqual(need("energy.month"), [("finLivePoints", "current_month")])
        self.assertEqual(need("energy.today"), [("finEndpoints", "Hourly_Energy_Consumption_his"), ("finEndpoints", "Total_Power_Consumption_his")])
        self.assertEqual(need("energy.boards"), [("power_boards", None), ("power_boards", "history series in finEndpoints")])
        self.assertEqual(need("environment.temperature"), [("finLivePoints", "avg_zone_temp"), ("finLivePoints", "avg_zone_temp_sp")])
        # what needs no mapping stays available, and the missing mapping only limits what it limits
        for i in ("equipment.list", "equipment.count", "equipment.status", "alarms.open", "notifications.list", "hvac.online", "environment.humidity",
                  "environment.co2", "building.snapshot", "assistant.capabilities"):
            self.assertEqual(rows[i]["status"], caps.AVAILABLE, i)
        self.assertIn("No severity bands are mapped", " ".join(rows["alarms.open"]["limitations"]))
        self.assertIn("No equipment classes are mapped", " ".join(rows["hvac.online"]["limitations"]))

    def test_a_partial_mapping_is_partial(self):
        mapped = dict(NOTHING_MAPPED, finLivePoints=["iaq_index", "_comment"], finEndpoints=["Total_Power_Consumption_his"], finSeverityBands=True)
        rows = by_id(caps.evaluate(mapped, [{"name": "MCC 1", "history": "Hourly_EC_MCC1_his"}]))
        self.assertEqual(rows["environment.iaq"]["status"], caps.AVAILABLE)
        self.assertEqual(rows["energy.today"]["status"], caps.AVAILABLE)           # either series will do
        self.assertEqual(rows["alarms.open"]["limitations"], [])
        self.assertEqual([(m["mapping"], m["key"]) for m in rows["energy.boards"]["missing"]], [("power_boards", "history series in finEndpoints")])
        mapped["finEndpoints"].append("Hourly_EC_MCC1_his")
        self.assertEqual(by_id(caps.evaluate(mapped, [{"name": "MCC 1", "history": "Hourly_EC_MCC1_his"}]))["energy.boards"]["status"], caps.AVAILABLE)

    def test_not_supported_items_are_never_available_and_never_missing_a_mapping(self):
        for r in caps.evaluate(MARSA_MAPPED, SHIPPED["power_boards"]):
            if r["status"] == caps.NOT_SUPPORTED:
                self.assertEqual((r["missing"], r["tool"]), ([], None), r["id"])

    def test_bad_input_is_treated_as_nothing_mapped(self):
        for bad in (None, "x", [], {"finLivePoints": "iaq_index"}, {"finLivePoints": 5}):
            rows = by_id(caps.evaluate(bad, "nope"))
            self.assertEqual(rows["environment.iaq"]["status"], caps.UNMAPPED, bad)

    def test_the_report_holds_names_only_never_a_point_id(self):
        text = json.dumps(caps.evaluate(MARSA_MAPPED, SHIPPED["power_boards"]))
        self.assertNotIn(":r:", text)
        self.assertNotIn("p:{project}", text)

    def test_where_to_map_it_is_stated_in_the_dashboard_settings_words(self):
        self.assertEqual(caps.where({"mapping": "finLivePoints", "key": "iaq_index"}), "Dashboard Settings > Data Mapping > Live Points: iaq_index")
        self.assertIn("Endpoints", caps.where({"mapping": "finEndpoints", "key": None}))
        self.assertIn("power_boards", caps.where({"mapping": "power_boards", "key": None}))

    def test_summary_counts_add_up(self):
        rows = caps.evaluate(NOTHING_MAPPED, [])
        s = caps.summary(rows)
        self.assertEqual(sum(s["counts"].values()), len(rows))
        self.assertEqual(sum(sum(a[k] for k in (caps.AVAILABLE, caps.PARTIAL, caps.UNMAPPED, caps.NOT_SUPPORTED)) for a in s["areas"]), len(rows))


class RouterTests(unittest.TestCase):
    def decide(self, q):
        return eko_chat_router.route(q)

    def test_what_can_you_do_in_its_many_phrasings(self):
        for q in ("what can you do", "What can you do?", "what can you answer", "what can you help me with", "what can I ask", "what can i ask you about",
                  "what questions can I ask", "help", "capabilities", "what data is available", "which data is mapped for this project",
                  "what information do you have", "what is available for this project", "what is mapped", "show me your capabilities",
                  "what are your capabilities", "what do you support", "can you tell me what can you do"):
            with self.subTest(q):
                d = self.decide(q)
                self.assertEqual((d["route"], d["intent"], d["parameters"]), ("direct", "get_capabilities", {}))

    def test_the_count_of_one_class_in_its_many_phrasings(self):
        for q, kind in (("Give me the total number of AHUs.", "ahu"), ("total number of fcus", "fcu"), ("total AHUs", "ahu"), ("AHU count", "ahu"),
                        ("count the ahus", "ahu"), ("number of vavs", "vav"), ("what is the total number of FCUs", "fcu"),
                        ("how many AHUs are there", "ahu"), ("how many electrical assets", "electrical")):
            with self.subTest(q):
                d = self.decide(q)
                self.assertEqual((d["route"], d["intent"], d["parameters"]), ("direct", "find_equipment", {"type": kind}))

    def test_the_whole_count_in_its_many_phrasings_has_no_type(self):
        for q in ("How many assets do we have?", "how many equipment do we have?", "total assets", "asset count", "number of assets", "total equipment"):
            self.assertEqual(self.decide(q)["parameters"], {}, q)

    def test_totals_of_other_things_are_not_equipment_counts(self):
        for q in ("total energy", "total alarms", "number of alarms", "total power", "total water", "total cost", "gas count", "total notifications"):
            with self.subTest(q):
                d = self.decide(q)
                self.assertNotEqual((d.get("intent"), "type" in d.get("parameters", {})), ("find_equipment", True), d)

    def test_the_questions_of_the_brief_that_have_an_answer_are_answered_by_rules(self):
        for q, rule in (("Read the equipment list.", "equipment.list.read"), ("Show me all assets.", "equipment.list"),
                        ("Are there any active alarms?", "alarms.any"), ("Show critical alarms.", "alarms.list")):
            self.assertEqual(self.decide(q).get("rule"), rule, q)

    def test_a_question_that_asks_for_something_unsupported_is_not_taken_by_the_rules(self):
        for q in ("Compare today's energy with yesterday.", "Change the theme to light mode.", "Open the alarm dashboard.", "turn off AHU-01",
                  "Compare energy this month with last month"):
            self.assertEqual(self.decide(q)["route"], "llm_fallback", q)       # a model, when there is one, still gets it

    def test_the_capability_a_question_names_is_found(self):
        for q, cid in (("Compare today's energy with yesterday.", "energy.compare"), ("compare energy this month with last month", "energy.compare"),
                       ("Change the theme to light mode.", "studio.theme"), ("Switch back to dark mode.", "studio.theme"), ("use dark theme", "studio.theme"),
                       ("Open the alarm dashboard.", "studio.navigate"), ("go to the energy page", "studio.navigate"),
                       ("turn off AHU-01", "control.write"), ("set the setpoint to 22", "control.write"), ("acknowledge all alarms", "control.write"),
                       ("stop the chiller", "control.write"), ("show energy trend", "energy.trend"), ("energy consumption last week", "energy.trend"),
                       ("alarm history for last month", "alarms.history_summary"), ("water consumption today", "utilities.water_gas"),
                       ("show work orders", "maintenance.workorders"), ("open the warranty documents", "documents.om"),
                       ("show the meter readings", "meters.power"), ("apply a filter", "studio.filter")):
            with self.subTest(q):
                self.assertEqual(eko_chat_router.unsupported_topic(q), cid)

    def test_a_question_with_an_answer_names_no_unsupported_capability_by_accident(self):
        for q in ("list equipment", "show critical alarms", "what is the energy consumption today", "status of AHU-01", "how many assets do we have",
                  "show recent notifications", "what is the weather today", "who are you"):
            self.assertIsNone(eko_chat_router.unsupported_topic(q), q)

    def test_unsafe_text_names_no_capability_and_asks_nothing(self):
        for q in ("select * from alarms; drop table alarms", "readAll(point) and set theme", "http://x/theme", "", None, 5, "x" * 3000):
            self.assertIsNone(eko_chat_router.unsupported_topic(q))
            self.assertIsNone(eko_chat_router.clarification_for(q))

    def test_a_bare_temperature_is_asked_back_not_guessed(self):
        for q in ("What is the current temperature?", "temperature", "show the temp", "what's the temperature now"):
            self.assertIn("Which temperature do you mean?", eko_chat_router.clarification_for(q) or "", q)
        for q in ("what is the indoor temperature", "average zone temperature", "what is the humidity"):
            self.assertIsNone(eko_chat_router.clarification_for(q), q)


class CapabilityReportTests(ProjectChatBase):
    def test_the_hospital_is_told_what_it_can_and_cannot_ask(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        body = self.ok("What can you do?")
        self.assertEqual([t["name"] for t in body["tool_calls"]], ["get_capabilities"])
        self.assertEqual(body["project"], {"id": HOSPITAL_ID, "name": "ekoHospital"})
        a = body["answer"]
        self.assertIn("For ekoHospital", a)
        self.assertIn("read-only", a)
        self.assertIn("Indoor air quality index (needs iaq_index)", a)                       # nothing is mapped for it, and which entry it needs
        self.assertIn("Energy consumption today (needs Hourly_Energy_Consumption_his, Total_Power_Consumption_his)", a)
        self.assertIn("Not supported yet:", a)
        self.assertIn("Compare energy between periods", a)
        self.assertIn("No equipment classes are mapped", a)                                  # the limit on the HVAC count, said once
        self.assertNotIn("No severity bands are mapped", a)                                  # the Hospital settings of this suite do map bands
        card = body["card"]
        self.assertEqual(card["tool"], "get_capabilities")
        self.assertEqual(card["columns"], ["area", "available", "partial", "unmapped", "not_supported"])      # Phase 2 added the partial column
        self.assertEqual(sum(sum(r[1:]) for r in card["rows"]), len(caps.CAPABILITIES))

    def test_a_project_without_severity_bands_is_told_its_alarms_are_not_graded(self):
        settings = {k: v for k, v in HOSPITAL.items() if k != "finSeverityBands"}
        self.open(settings, HOSPITAL_ID)
        self.assertIn("No severity bands are mapped, so every alarm is graded info", self.ok("what can you do")["answer"])
        self.assertIn("There are no open critical alarms.", self.ok("Show critical alerts")["answer"])    # nothing is graded critical

    def test_marsa_has_what_its_own_mappings_give_it(self):
        self.open(MARSA, MARSA_ID)
        body = self.ok("what can you do")
        self.assertEqual(body["project"]["name"], "marsaAlArab")
        self.assertNotIn("nothing is mapped", body["answer"])
        self.assertNotIn("No severity bands are mapped", body["answer"])
        result = self.tool("get_capabilities")
        self.assertEqual(result["counts"]["unmapped"], 0)
        self.assertEqual(by_id(result["capabilities"])["energy.boards"]["status"], "available")

    def test_the_two_projects_do_not_share_a_report(self):
        self.open(MARSA, MARSA_ID)
        marsa = by_id(self.tool("get_capabilities")["capabilities"])
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        self.open(HOSPITAL, HOSPITAL_ID)
        hospital = by_id(self.tool("get_capabilities")["capabilities"])
        for i in ("environment.iaq", "energy.today", "energy.boards"):
            self.assertEqual((marsa[i]["status"], hospital[i]["status"]), ("available", "unmapped"), i)
        self.assertNotIn(":r:", json.dumps(self.tool("get_capabilities")))

    def test_the_mapping_names_come_from_the_active_project_not_the_shipped_file(self):
        self.open(dict(HOSPITAL, finLivePoints={"iaq_index": "p:{project}:r:abc"}), HOSPITAL_ID)
        rows = by_id(self.tool("get_capabilities")["capabilities"])
        self.assertEqual(rows["environment.iaq"]["status"], "available")
        self.assertEqual(rows["environment.comfort"]["status"], "unmapped")
        self.assertNotIn("abc", json.dumps(self.tool("get_capabilities")))                 # the name, never the point

    def test_one_capability_can_be_asked_about(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        result = self.tool("get_capabilities", about="environment.iaq")
        self.assertEqual((result["about"]["status"], result["about"]["data"]), ("unmapped", "live"))
        self.assertNotIn("capabilities", result)
        self.assertEqual(self.tool("get_capabilities", about="equipment.list")["about"]["status"], "available")
        self.assertEqual(self.tool("get_capabilities", about="no.such")["reason"], "invalid_arguments")
        self.assertEqual(self.tool("get_capabilities", extra=1)["reason"], "invalid_arguments")

    def test_data_kinds_and_freshness_are_told_apart(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        old = (datetime.now() - timedelta(minutes=30)).isoformat()
        with mock.patch.object(main, "cached_power_data", {"timestamp": old}), mock.patch.object(main, "cached_equip_data", {}), \
                mock.patch.object(main, "cached_power_history_at", None), \
                mock.patch.object(main, "cached_alarm_data", {"timestamp": datetime.now().isoformat()}):
            r = self.tool("get_capabilities")
            rows = by_id(r["capabilities"])
            self.assertEqual({k: v["state"] for k, v in r["reads"].items()},
                             {"equipment": "not_read", "alarms": "fresh", "power": "stale", "history": "not_read", "store": "stored"})
            self.assertEqual((rows["equipment.list"]["data"], rows["equipment.list"]["read"]), ("live", "not_read"))
            self.assertEqual((rows["alarms.open"]["data"], rows["alarms.open"]["read"]), ("live", "fresh"))
            self.assertEqual((rows["energy.today"]["data"], rows["energy.today"]["status"]), ("historical", "unmapped"))
            self.assertEqual((rows["notifications.list"]["data"], rows["notifications.list"]["read"]), ("stored", "stored"))
            text = self.ok("what can you do")["answer"]
            self.assertIn("Data state:", text)
            self.assertIn("power is stale", text)
            self.assertIn("equipment has not been read from FIN yet", text)

    def test_without_fin_or_a_project_nothing_is_reported(self):
        for view, reason in ((DataView(authenticated=False, project_id="p", project_name="x"), "fin_not_connected"),
                             (DataView(authenticated=True, project_id=None, project_name=""), "no_active_project")):
            self.assertEqual(eko_chat.run_tool("get_capabilities", {}, view)["reason"], reason)


class UnavailableAnswerTests(ProjectChatBase):
    """What is unmapped says which Data Mapping entry it needs; what is not supported says so; nothing is invented."""

    def test_an_unmapped_reading_names_the_entry_to_map(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        patch = mock.patch.object(eko_chat, "_site_now", return_value=datetime.now())     # this machine has no tz database: not what is tested
        patch.start()
        self.addCleanup(patch.stop)
        self.assertIn("no live point mapped for it (iaq_index); map it under Dashboard Settings > Data Mapping > Live Points",
                      self.ok("What is the current IAQ index?")["answer"])
        self.assertIn("(current_month); map it under Dashboard Settings > Data Mapping > Live Points",
                      self.ok("What is the energy consumption this month?")["answer"])

    def test_an_unmapped_energy_series_names_the_entries_and_where(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        with mock.patch.object(main, "cached_power_history", {}), mock.patch.object(main, "cached_power_history_at", datetime.now().isoformat()),                 mock.patch.object(eko_chat, "_site_now", return_value=datetime.now()):
            answer = self.ok("What is the energy consumption today?")["answer"]
        self.assertIn("returned no hourly energy series", answer)
        self.assertIn("No energy series is mapped: add Hourly_Energy_Consumption_his or Total_Power_Consumption_his under "
                      "Dashboard Settings > Data Mapping > Endpoints", answer)

    def test_a_mapped_series_that_fin_left_empty_is_not_called_unmapped(self):
        self.open(dict(HOSPITAL, finEndpoints={"Total_Power_Consumption_his": "x"}), HOSPITAL_ID)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        with mock.patch.object(main, "cached_power_history", {}), mock.patch.object(main, "cached_power_history_at", datetime.now().isoformat()),                 mock.patch.object(eko_chat, "_site_now", return_value=datetime.now()):
            answer = self.ok("What is the energy consumption today?")["answer"]
        self.assertIn("returned no hourly energy series", answer)
        self.assertNotIn("No energy series is mapped", answer)

    def test_a_question_that_asks_for_something_unsupported_is_answered_with_the_real_reason(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        for q, cid, words in (("Compare today's energy with yesterday.", "energy.compare", "Compare energy between periods is not supported yet"),
                              ("Change the theme to light mode.", "studio.theme", "Change the theme (light, dark or auto) is not supported yet"),
                              ("Switch back to dark mode.", "studio.theme", "not supported yet"),
                              ("Open the alarm dashboard.", "studio.navigate", "Open Studio pages is not supported yet"),
                              ("show work orders", "maintenance.workorders", "Work orders is not supported yet"),
                              ("water consumption today", "utilities.water_gas", "Water and gas consumption is not supported yet"),
                              ("alarm history for last month", "alarms.history_summary", "is partly available")):
            with self.subTest(q):
                body = self.ok(q)
                self.assertEqual(body["route"], "unsupported")
                self.assertEqual([(t["name"], t["arguments"]) for t in body["tool_calls"]], [("get_capabilities", {"about": cid})])
                self.assertIn(words, body["answer"])
                # Phase 2: the alarm records of the latest read can be summarised, so that capability is partial; the rest are still not supported
                self.assertEqual(body["card"]["rows"][0][1], "partial" if cid == "alarms.history_summary" else "not_supported")

    def test_a_request_to_change_something_is_refused_as_read_only_and_runs_no_tool_that_changes_anything(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        before = list(main.cached_equip_data["equipment"])
        for q in ("turn off AHU-01", "set the setpoint to 22", "acknowledge all alarms", "stop the chiller", "change the project settings"):
            with self.subTest(q):
                body = self.ok(q)
                self.assertEqual([t["name"] for t in body["tool_calls"]], ["get_capabilities"])
                self.assertIn("Eko-Chat is read-only", body["answer"])
        self.assertEqual(main.cached_equip_data["equipment"], before)

    def test_an_ambiguous_temperature_is_asked_back_with_no_tool_run(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        body = self.ok("What is the current temperature?")
        self.assertEqual((body["route"], body["tool_calls"], body["card"]), ("clarification", [], None))
        self.assertIn("Which temperature do you mean?", body["answer"])
        self.assertIn("indoor temperature", body["answer"])

    def test_an_unrelated_question_stays_out_of_scope_and_points_to_what_is_supported(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        for q in ("What's the weather today?", "Who won the match last night?", "tell me a joke"):
            body = self.ok(q)
            self.assertEqual((body["route"], body["tool_calls"], body["card"]), ("unsupported", [], None), q)
            self.assertIn("this project's live FIN data", body["answer"])
            self.assertIn("what can you do", body["answer"])

    def test_the_streamed_answer_is_the_same(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        from chat_support import parse_sse
        for q in ("what can you do", "Compare today's energy with yesterday."):
            events = parse_sse(self.ask(q, stream=True).text)
            self.assertEqual((events[0][0], events[-1][0]), ("start", "done"), q)
            self.assertEqual(events[-1][1]["tool_calls"], [{"tool": "get_capabilities", "status": "completed"}], q)
            self.assertEqual(events[-1][1]["answer"], self.ok(q)["answer"], q)


class AccessTests(ProjectChatBase):
    def test_the_new_questions_need_the_same_session_and_project_as_every_other(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        q = {"message": "what can you do"}
        self.assertEqual(self.http.post("/api/chat", json=q).status_code, 200)
        r = self.http.post("/api/chat", json=q, headers={"X-Eko-Project": MARSA_ID})
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "project_mismatch"))
        self.narrowed(["marsaAlArab"])
        r = self.http.post("/api/chat", json=q)
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (403, "project_not_supported"))
        self.narrowed(["marsaAlArab", "ekoHospital"])
        self.http.cookies.clear()
        r = self.http.post("/api/chat", json=q)
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (401, "session_required"))
        for blocked in ("Compare today's energy with yesterday.", "turn off AHU-01"):
            self.assertEqual(self.http.post("/api/chat", json={"message": blocked}).status_code, 401)

    def test_chat_still_has_to_be_enabled(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = {"enabled": False, "provider": "rules"}
        for q in ("what can you do", "Compare today's energy with yesterday."):
            self.assertEqual(self.http.post("/api/chat", json={"message": q}).status_code, 503, q)


class ModelModeTests(ProjectChatBase):
    def tearDown(self):
        eko_chat_llm.BREAKER["until"] = 0.0
        super().tearDown()

    def hybrid(self):
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT, provider="ollama")

    def test_the_hybrid_intent_for_capabilities_is_allowed(self):
        status, d = eko_chat_llm.to_decision({"intent": "get_capabilities"}, "what can you do")
        self.assertEqual((status, d["intent"], d["parameters"]), ("ok", "get_capabilities", {}))
        status, d = eko_chat_llm.to_decision({"intent": "get_capabilities", "about": "energy.compare"}, "can you compare energy")
        self.assertEqual((status, d["parameters"]), ("ok", {"about": "energy.compare"}))
        self.assertEqual(eko_chat_llm.to_decision({"intent": "get_capabilities", "about": "delete.everything"}, "x")[0], "clarification")
        self.assertEqual(eko_chat_llm.to_decision({"intent": "get_capabilities", "type": "ahu"}, "x")[0], "invalid")

    def test_when_the_model_is_down_what_is_unsupported_is_still_said_plainly(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.hybrid()
        down = mock.AsyncMock(side_effect=eko_chat.LLMError("llm_unavailable", "down"))
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", down):
            named = self.ok("Compare today's energy with yesterday.")
            self.assertEqual(named["route"], "unsupported")
            self.assertIn("not supported yet", named["answer"])
            self.assertEqual(named["tool_calls"][0]["name"], "get_capabilities")
            other = self.ok("tell me a story about the building")                       # names no capability: the model-down reply, unchanged
            self.assertIn("The language model is not available right now", other["answer"])
            self.assertEqual(other["tool_calls"], [])
            direct = self.ok("what can you do")                                          # the rules answer without the model at all
            self.assertEqual(direct["route"], "direct")

    def test_a_model_that_does_answer_is_not_pre_empted(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.hybrid()
        reply = {"content": json.dumps({"intent": "list_equipment"}), "usage": {}}
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock(return_value=reply)):
            body = self.ok("Compare today's energy with yesterday.")
        self.assertEqual(body["route"], "llm_intent")


class SameBehaviourTests(ProjectChatBase):
    """What worked before still works, with the same answers."""

    def test_the_earlier_questions_are_unchanged(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        for q, tool, text in (("list equipment", "find_equipment", "Equipment items: 3."), ("how many assets", "find_equipment", "Equipment items: 3."),
                              ("Show critical alerts", "get_alarms", "alarms"), ("show recent notifications", "get_notifications", "no notifications")):
            body = self.ok(q)
            self.assertEqual(body["tool_calls"][0]["name"], tool, q)
            self.assertIn(text, body["answer"], q)

    def test_the_tool_list_the_model_sees_now_includes_the_capability_tool_and_nothing_that_writes(self):
        names = {t["function"]["name"] for t in eko_chat.tool_definitions()}
        self.assertEqual(names, set(eko_chat.TOOLS))
        self.assertIn("get_capabilities", names)
        self.assertFalse({n for n in names if any(w in n for w in ("write", "set", "ack", "control", "delete", "eval"))})


if __name__ == "__main__":
    unittest.main()
