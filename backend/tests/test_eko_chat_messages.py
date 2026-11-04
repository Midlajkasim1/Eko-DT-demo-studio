"""Eko-Chat messages: every failed read is told in words (never "an internal error" for "not mapped"), the temperature is asked back before any
model, and "what is unavailable in this project" is answered from the project's own capability report.

Run from backend/:   python -m unittest tests.test_eko_chat_messages
Reported on EKO HOSPITAL (hybrid mode): "What can you do?" and "Change to dark mode." got the generic reply; "What is the current temperature?" ended
with "Could not read get_environment: an internal error" (metric_unavailable was not a reason the browser may be told); "What information is unavailable in
this project?" had no rule. Fake FIN, a throwaway notification database, no network; the language model is replaced by a mock that records its calls.
"""
import json
import os
import re
import sys
import unittest
from datetime import datetime
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_capabilities as caps  # noqa: E402
import eko_chat_llm  # noqa: E402
import eko_chat_router  # noqa: E402
import main  # noqa: E402
from chat_support import parse_sse  # noqa: E402
from test_eko_chat_projects import DEFAULT_CHAT, HOSPITAL, HOSPITAL_ID, MARSA, MARSA_ID, ProjectChatBase  # noqa: E402

JS = os.path.join(HERE, "..", "..", "static", "dashboard", "js", "i18n")
TEN = ["alarm_history_unavailable", "ambiguous", "direct_rejected", "direct_ungrounded", "metric_unavailable", "no_sensors",
       "notifications_failed", "notifications_unavailable", "online_state_unavailable", "period_not_supported"]
ARABIC = re.compile(r"[\u0600-\u06FF]")
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def table(lang):
    """{key: value} of the dashboard's translation file (the values are plain strings on one line each)."""
    with open(os.path.join(JS, f"{lang}.js"), encoding="utf-8") as f:
        return {k: v.encode().decode("unicode_escape").encode("latin-1", "ignore").decode("utf-8", "ignore") if "\\u" in v else v
                for k, v in re.findall(r'^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$', f.read(), re.M)}


EN, AR = table("en"), table("ar")


class ReasonCodeTests(unittest.TestCase):
    def test_the_ten_reasons_the_browser_was_told_were_an_internal_error_are_now_known(self):
        for code in TEN:
            self.assertIn(code, eko_chat.SAFE_REASONS, code)
            self.assertEqual(eko_chat._safe_reason(code), code)
        for bad in ("something_else", None, 5, "", ["metric_unavailable"], "C:\\db\\secret"):
            self.assertEqual(eko_chat._safe_reason(bad), "tool_error")

    def test_every_reason_a_tool_can_return_is_one_the_browser_may_be_told(self):
        with open(os.path.join(HERE, "..", "eko_chat.py"), encoding="utf-8") as f:
            source = f.read()
        codes = set(re.findall(r'_unavailable\(\s*"([a-z_]+)"', source)) | set(re.findall(r'"reason": "([a-z_]+)"', source))
        self.assertTrue(set(TEN) <= codes | set(TEN))
        self.assertEqual(sorted(c for c in codes if c not in eko_chat.SAFE_REASONS), [], "a reason the UI would call an internal error")

    def test_each_reason_has_an_english_and_an_arabic_text_and_only_tool_error_is_an_error(self):
        for code in sorted(eko_chat.SAFE_REASONS):
            en, ar = EN.get(f"ai.reason.{code}"), AR.get(f"ai.reason.{code}")
            self.assertTrue(en, f"en {code}")
            self.assertTrue(ar and ARABIC.search(ar), f"ar {code}")
            if code != "tool_error":
                self.assertNotIn("internal error", en.lower(), code)
        self.assertEqual(EN["ai.reason.metric_unavailable"], "not available for this project")
        self.assertEqual(EN["ai.reason.tool_error"], "an internal error")

    def test_every_tool_has_a_name_in_both_languages(self):
        self.assertEqual(len(eko_chat.TOOLS), 9)
        for tool in eko_chat.TOOLS:
            self.assertTrue(EN.get(f"ai.toolName.{tool}"), f"en {tool}")
            self.assertTrue(AR.get(f"ai.toolName.{tool}") and ARABIC.search(AR[f"ai.toolName.{tool}"]), f"ar {tool}")
        for tool in ("get_environment", "get_energy", "get_hvac_status", "get_notifications", "get_capabilities"):
            self.assertIn(f"ai.toolName.{tool}", EN)

    def test_the_mapping_names_have_labels_and_the_not_mapped_line_has_its_text(self):
        for block in caps.MAPPING_LABEL:
            self.assertTrue(EN.get(f"ai.mapping.{block}"), block)
            self.assertTrue(ARABIC.search(AR.get(f"ai.mapping.{block}", "")), block)
        self.assertEqual(EN["ai.mapping.finLivePoints"], caps.MAPPING_LABEL["finLivePoints"])
        for lang in (EN, AR):
            self.assertIn("{list}", lang["ai.tool.notMapped"])

    def test_the_two_languages_use_the_same_placeholders(self):
        keys = [k for k in EN if k.startswith(("ai.reason.", "ai.mapping.", "ai.tool.", "ai.toolName.", "ai.card.h.capabilit", "ai.card.i.capabilit"))]
        self.assertGreater(len(keys), 40)
        for k in keys:
            self.assertEqual(set(PLACEHOLDER.findall(EN[k])), set(PLACEHOLDER.findall(AR[k])), k)

    def test_a_missing_name_list_holds_names_only(self):
        clean = eko_chat._clean_missing
        self.assertEqual(clean([{"mapping": "finLivePoints", "key": "iaq_index"}, {"mapping": "power_boards", "key": None}]),
                         [{"mapping": "finLivePoints", "key": "iaq_index"}, {"mapping": "power_boards", "key": None}])
        junk = [{"mapping": "finLivePoints", "key": "p:ekoHospital:r:3181ee6e-67dac181"},       # a point ID
                {"mapping": "finLivePoints", "key": "password=abc"}, {"mapping": "nope", "key": "x"}, {"mapping": "finEndpoints", "key": 5},
                {"mapping": "finEndpoints", "key": "x" * 80}, "text", None, 5, {"key": "x"}]
        self.assertEqual(clean(junk), [])
        self.assertEqual(clean(None), [])
        self.assertEqual(len(clean([{"mapping": "finLivePoints", "key": f"k{i}"} for i in range(20)])), 6)


class FailedReadTests(ProjectChatBase):
    """A read that fails for want of a mapping says so: in the tool event, in the answer, in both modes."""

    def fresh_power(self):
        """The live read has happened (with no live point mapped it holds only its timestamp), so the answer is about the mapping, not about timing."""
        main._cancel_polling()
        self.http.get("/api/fin/status")
        for patch in (mock.patch.object(main, "cached_power_data", {"timestamp": datetime.now().isoformat()}),
                      mock.patch.object(eko_chat, "_site_now", return_value=datetime.now())):     # (this machine has no tz database: not what is tested)
            patch.start()
            self.addCleanup(patch.stop)

    def events(self, question):
        r = self.ask(question, stream=True)
        events = parse_sse(r.text)
        return [d for e, d in events if e == "tool" and d["status"] != "running"], events[-1][1]

    def test_the_unmapped_temperature_names_the_two_entries_instead_of_an_internal_error(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.fresh_power()
        tools, done = self.events("What is the indoor temperature?")
        self.assertEqual(tools, [{"tool": "get_environment", "status": "failed", "reason": "metric_unavailable",
                                  "missing": [{"mapping": "finLivePoints", "key": "avg_zone_temp"}, {"mapping": "finLivePoints", "key": "avg_zone_temp_sp"}]}])
        self.assertNotIn("tool_error", json.dumps(tools))
        self.assertEqual(done["tool_calls"], tools)

    def test_the_unmapped_answer_names_each_key_once(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.fresh_power()
        answer = self.ok("What is the indoor temperature?")["answer"]
        self.assertEqual(answer.count("avg_zone_temp)"), 1)
        self.assertEqual(answer.count("avg_zone_temp_sp)"), 1)
        self.assertNotIn("Live Points: avg_zone_temp", answer)                         # the key is not repeated after the place to map it
        self.assertEqual(answer.count("Dashboard Settings > Data Mapping > Live Points"), 2)
        self.assertIn("no live point mapped for it (avg_zone_temp); map it under Dashboard Settings > Data Mapping > Live Points;", answer)

    def test_the_other_unmapped_reads_say_what_they_need(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.fresh_power()
        names = lambda tools: [(m["mapping"], m["key"]) for m in tools[0]["missing"]]   # noqa: E731
        tools, _ = self.events("What is the current IAQ index?")
        self.assertEqual((tools[0]["reason"], names(tools)), ("metric_unavailable", [("finLivePoints", "iaq_index")]))
        tools, _ = self.events("What is the energy consumption this month?")
        self.assertEqual(names(tools), [("finLivePoints", "current_month")])
        with mock.patch.object(main, "cached_power_history", {}), mock.patch.object(main, "cached_power_history_at", datetime.now().isoformat()), \
                mock.patch.object(eko_chat, "_site_now", return_value=datetime.now()):
            tools, _ = self.events("What is the energy consumption today?")
            self.assertEqual(names(tools), [("finEndpoints", "Hourly_Energy_Consumption_his"), ("finEndpoints", "Total_Power_Consumption_his")])
            tools, _ = self.events("Which equipment is consuming the most energy?")
            self.assertEqual(names(tools), [("power_boards", None)])

    def test_a_read_that_failed_for_another_reason_carries_no_mapping_names(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        with mock.patch.object(main, "cached_equip_data", {}):
            tools, _ = self.events("list equipment")
        self.assertEqual(tools, [{"tool": "find_equipment", "status": "failed", "reason": "no_data_yet"}])

    def test_a_tool_that_raises_is_an_internal_error_without_the_exception(self):
        self.open(HOSPITAL, HOSPITAL_ID)

        def boom(args, view):
            raise RuntimeError("secret=abc123 C:\\db\\path password")
        with mock.patch.dict(eko_chat.TOOLS["find_equipment"], {"fn": boom}):
            body = self.ok("list equipment")
            tools, done = self.events("list equipment")
        self.assertEqual(body["answer"], "This data could not be read right now.")
        self.assertEqual(tools, [{"tool": "find_equipment", "status": "failed", "reason": "tool_error"}])
        everything = json.dumps([body, tools, done])
        for leaked in ("RuntimeError", "secret", "abc123", "password", "C:\\\\db"):
            self.assertNotIn(leaked, everything)

    def test_the_hybrid_path_carries_the_same_names(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.fresh_power()
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT, provider="ollama")
        reply = {"content": json.dumps({"intent": "get_environment", "metric": "temperature"}), "usage": {}}
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock(return_value=reply)) as gen:
            tools, done = self.events("how warm is it inside right now")
            body = self.ok("how warm is it inside right now")
        self.assertEqual(gen.await_count, 2)                                       # the rules did not know it: the model read it
        self.assertEqual((tools[0]["reason"], [m["key"] for m in tools[0]["missing"]]), ("metric_unavailable", ["avg_zone_temp", "avg_zone_temp_sp"]))
        self.assertEqual(body["route"], "llm_intent")
        self.assertEqual(body["answer"].count("avg_zone_temp)"), 1)


class ToolCallingPathTests(ProjectChatBase):
    """The tool-calling provider (openai_compatible) builds its own tool events: it carries the same names."""

    def test_the_tool_calling_path_tells_a_failed_read_the_same_way(self):
        import asyncio

        class Model:
            name = model = "scripted"

            def __init__(self):
                self.replies = [{"content": None, "tool_calls": [{"id": "c1", "name": "get_environment", "arguments": {"metric": "temperature"}}]},
                                {"content": "I could not read the temperature.", "tool_calls": []}]

            async def complete(self, messages, tools):
                return self.replies.pop(0)

        self.open(HOSPITAL, HOSPITAL_ID)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        with mock.patch.object(main, "cached_power_data", {"timestamp": datetime.now().isoformat()}), \
                mock.patch.object(eko_chat, "_site_now", return_value=datetime.now()):
            async def run():
                return [ev async for ev in eko_chat.conversation(Model(), "how warm is it inside", main._chat_view)]
            events = asyncio.run(run())
        failed = [d for kind, d in events if kind == "tool" and d["status"] == "failed"]
        self.assertEqual(failed, [{"tool": "get_environment", "status": "failed", "reason": "metric_unavailable",
                                   "missing": [{"mapping": "finLivePoints", "key": "avg_zone_temp"}, {"mapping": "finLivePoints", "key": "avg_zone_temp_sp"}]}])
        result = events[-1][1]
        self.assertEqual([t["missing"] for t in eko_chat._browser_trace(result["tool_calls"])][0][0], {"mapping": "finLivePoints", "key": "avg_zone_temp"})


class TemperatureTests(ProjectChatBase):
    BARE = ("What is the current temperature?", "temperature", "show the temp", "what's the temperature now", "tell me the current temp")

    def hybrid(self):
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT, provider="ollama")

    def test_a_bare_temperature_is_asked_back_in_rules_mode(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        for q in self.BARE:
            with self.subTest(q):
                body = self.ok(q)
                self.assertEqual((body["route"], body["tool_calls"], body["card"]), ("clarification", [], None))
                self.assertIn("Which temperature do you mean?", body["answer"])
                self.assertIn("indoor", body["answer"])
                self.assertIn("Outdoor and supply-air temperatures are not read", body["answer"])

    def test_a_bare_temperature_is_asked_back_in_hybrid_mode_and_the_model_is_not_asked(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.hybrid()
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock()) as gen:
            for q in self.BARE:
                body = self.ok(q)
                self.assertEqual((body["route"], body["tool_calls"]), ("clarification", []), q)
                events = parse_sse(self.ask(q, stream=True).text)
                self.assertEqual([e for e, _ in events if e == "tool"], [], q)
                self.assertIn("Which temperature do you mean?", events[-1][1]["answer"], q)
        gen.assert_not_awaited()

    def test_the_clarification_is_the_same_for_marsa(self):
        self.open(MARSA, MARSA_ID)
        self.assertEqual(self.ok("What is the current temperature?")["route"], "clarification")

    def test_an_explicit_indoor_temperature_uses_the_mapped_metric(self):
        for q in ("What is the indoor temperature?", "what is the average zone temperature", "current indoor temperature", "average building temperature"):
            d = eko_chat_router.route(q)
            self.assertEqual((d["route"], d["intent"], d["parameters"]), ("direct", "get_environment", {"metric": "temperature"}), q)
        self.open(MARSA, MARSA_ID)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        with mock.patch.object(main, "cached_power_data", {"timestamp": datetime.now().isoformat(), "avg_zone_temp": 22.5, "avg_zone_temp_sp": 22.0}):
            body = self.ok("What is the indoor temperature?")
        self.assertEqual(body["tool_calls"][0]["name"], "get_environment")
        self.assertIn("Average zone temperature: 22.5", body["answer"])

    def test_an_explicit_indoor_temperature_is_answered_by_rules_in_hybrid_mode_too(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.hybrid()
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock()) as gen:
            body = self.ok("What is the indoor temperature?")
        gen.assert_not_awaited()
        self.assertEqual((body["route"], body["tool_calls"][0]["name"], body["tool_calls"][0]["reason"]), ("direct", "get_environment", "metric_unavailable"))
        self.assertIn("avg_zone_temp", body["answer"])

    def test_an_outdoor_or_supply_air_temperature_is_said_not_to_be_read_before_any_model(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        cases = (("What is the outdoor temperature?", "environment.outdoor_temperature", "Outdoor temperature is not supported yet"),
                 ("what is the outside temperature", "environment.outdoor_temperature", "Outdoor weather is not read"),
                 ("What is the supply air temperature?", "environment.supply_air_temperature", "Supply-air temperature is not supported yet"),
                 ("supply-air temp of AHU-01", "environment.supply_air_temperature", "status of AHU-01"))
        for mode in ("rules", "ollama"):
            main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT, provider=mode)
            with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock()) as gen:
                for q, cid, words in cases:
                    with self.subTest(mode=mode, q=q):
                        body = self.ok(q)
                        self.assertEqual([(t["name"], t["arguments"]) for t in body["tool_calls"]], [("get_capabilities", {"about": cid})])
                        self.assertIn(words, body["answer"])
                        self.assertNotIn("Average zone temperature", body["answer"])        # never the indoor value under another name
            gen.assert_not_awaited()

    def test_with_the_fast_router_off_everything_still_goes_to_the_model(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT, provider="ollama", fast_router=False)
        reply = {"content": json.dumps({"intent": "unsupported"}), "usage": {}}
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock(return_value=reply)) as gen:
            self.ok("What is the current temperature?")
        gen.assert_awaited()


class UnavailableQuestionTests(ProjectChatBase):
    ASKED = ("What information is unavailable in this project?", "What is not mapped?", "Which data is missing?", "What features are unsupported?",
             "What cannot you access in this project?", "Show unavailable capabilities.", "what is unavailable", "what is missing",
             "what don't you support", "list the unmapped data", "are there any missing mappings", "which features are not supported")

    def test_every_phrasing_is_a_direct_unavailable_report(self):
        for q in self.ASKED:
            with self.subTest(q):
                d = eko_chat_router.route(q)
                self.assertEqual((d["route"], d["intent"], d["parameters"]), ("direct", "get_capabilities", {"show": "unavailable"}))

    def test_the_questions_that_are_not_about_what_is_unavailable_are_not_taken(self):
        for q in ("what can you do", "what is available", "what is mapped", "list equipment", "what is the status of AHU-01", "what is not working",
                  "which equipment is not running", "what is the weather"):
            self.assertNotEqual(eko_chat_router.route(q).get("parameters", {}).get("show"), "unavailable", q)

    def test_the_hospital_is_told_what_is_unmapped_unsupported_and_read_only(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        for q in self.ASKED:
            with self.subTest(q):
                body = self.ok(q)
                self.assertEqual(body["route"], "direct")
                self.assertEqual([(t["name"], t["arguments"]) for t in body["tool_calls"]], [("get_capabilities", {"show": "unavailable"})])
                a = body["answer"]
                self.assertNotIn("could not tell", a)
                self.assertIn("In ekoHospital, 7 things the assistant can answer are not available because nothing is mapped for them", a)
                self.assertIn("Indoor air quality index (map Dashboard Settings > Data Mapping > Live Points: iaq_index)", a)
                self.assertIn("Energy consumption today (map Dashboard Settings > Data Mapping > Endpoints: Hourly_Energy_Consumption_his; "
                              "Dashboard Settings > Data Mapping > Endpoints: Total_Power_Consumption_his)", a)
                self.assertIn("Not supported yet: Outdoor temperature, Supply-air temperature, Compare energy between periods", a)
                self.assertIn("Never done by Eko-Chat (it is read-only): Acknowledgements of notifications, Change equipment", a)
                self.assertIn("No equipment classes are mapped", a)
                self.assertNotIn("Equipment list", a)                                        # what works is not listed as unavailable

    def test_the_card_lists_only_what_is_unavailable(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        card = self.ok("What information is unavailable in this project?")["card"]
        counts = self.tool("get_capabilities")["counts"]
        self.assertEqual(card["columns"], ["capability", "status", "data", "needs"])
        self.assertEqual(card["total"], counts["unmapped"] + counts["not_supported"])
        self.assertEqual({r[1] for r in card["rows"]} - {"unmapped", "not_supported"}, set())
        self.assertIn(["Indoor air quality index", "unmapped", "live", "Dashboard Settings > Data Mapping > Live Points: iaq_index"], card["rows"])
        self.assertEqual(card["headline"]["key"], "capabilitiesUnavailable")
        self.assertEqual(card["tool"], "get_capabilities")

    def test_the_hybrid_mode_answers_the_same_questions_by_rules_and_never_asks_the_model(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        rules = {q: self.ok(q)["answer"] for q in self.ASKED}
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT, provider="ollama")
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock()) as gen:
            for q in self.ASKED:
                body = self.ok(q)
                self.assertEqual((body["route"], body["answer"]), ("direct", rules[q]), q)
                events = parse_sse(self.ask(q, stream=True).text)
                self.assertEqual(events[-1][1]["tool_calls"], [{"tool": "get_capabilities", "status": "completed"}], q)
        gen.assert_not_awaited()

    def test_marsa_and_the_hospital_get_their_own_reports(self):
        self.open(MARSA, MARSA_ID)
        marsa = self.ok("What information is unavailable in this project?")
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        self.open(HOSPITAL, HOSPITAL_ID)
        hospital = self.ok("What information is unavailable in this project?")
        self.assertIn("In marsaAlArab, nothing the assistant can answer is missing a mapping.", marsa["answer"])
        self.assertNotIn("Indoor air quality", marsa["answer"])
        self.assertNotIn("Hourly_Energy_Consumption_his", marsa["answer"])
        self.assertIn("Not supported yet:", marsa["answer"])                                # what no project has, both are told
        self.assertIn("In ekoHospital, 7 things", hospital["answer"])
        self.assertNotIn("marsaAlArab", hospital["answer"])
        self.assertEqual(marsa["project"]["name"], "marsaAlArab")
        self.assertEqual(hospital["project"]["name"], "ekoHospital")
        self.assertNotIn(":r:", json.dumps([marsa, hospital]))

    def test_what_a_project_maps_is_not_reported_missing(self):
        self.open(dict(HOSPITAL, finLivePoints={"iaq_index": "p:{project}:r:abc", "comfort_compliance": "p:{project}:r:def"},
                       finEndpoints={"Total_Power_Consumption_his": "x"}), HOSPITAL_ID)
        a = self.ok("which data is missing")["answer"]
        self.assertIn("In ekoHospital, 3 things", a)
        self.assertNotIn("Indoor air quality", a)
        self.assertNotIn("Comfort compliance", a)
        self.assertNotIn("Energy consumption today", a)
        self.assertIn("Average zone temperature (map", a)
        self.assertIn("Energy consumption this month (map Dashboard Settings > Data Mapping > Live Points: current_month)", a)
        self.assertNotIn("abc", a)
        self.assertNotIn("def", a)

    def test_a_project_without_severity_bands_is_told_its_limit(self):
        self.open({k: v for k, v in HOSPITAL.items() if k != "finSeverityBands"}, HOSPITAL_ID)
        self.assertIn("No severity bands are mapped, so every alarm is graded info", self.ok("what is not mapped")["answer"])

    def test_stale_and_unread_data_is_reported_with_it(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        with mock.patch.object(main, "cached_equip_data", {}), mock.patch.object(main, "cached_power_history_at", None):
            a = self.ok("what is unavailable")["answer"]
        self.assertIn("Data state:", a)
        self.assertIn("equipment has not been read from FIN yet", a)

    def test_the_tool_checks_its_new_argument(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.assertEqual(self.tool("get_capabilities", show="everything")["reason"], "invalid_arguments")
        full, narrowed = self.tool("get_capabilities", show="all"), self.tool("get_capabilities", show="unavailable")
        self.assertEqual(full["counts"], narrowed["counts"])
        self.assertGreater(len(full["capabilities"]), len(narrowed["capabilities"]))
        self.assertNotIn("show", full)
        self.assertEqual(self.tool("get_capabilities", show="unavailable", about="equipment.list")["about"]["id"], "equipment.list")
        status, d = eko_chat_llm.to_decision({"intent": "get_capabilities", "show": "unavailable"}, "what is unavailable")
        self.assertEqual((status, d["parameters"]), ("ok", {"show": "unavailable"}))
        self.assertEqual(eko_chat_llm.to_decision({"intent": "get_capabilities", "show": "x"}, "q")[0], "clarification")

    def test_the_same_session_and_project_checks_apply(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        q = {"message": "What information is unavailable in this project?"}
        r = self.http.post("/api/chat", json=q, headers={"X-Eko-Project": MARSA_ID})
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "project_mismatch"))
        self.http.cookies.clear()
        r = self.http.post("/api/chat", json=q)
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (401, "session_required"))
        self.assertNotIn("iaq_index", r.text)


class SameBehaviourTests(ProjectChatBase):
    def test_the_earlier_answers_are_unchanged(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        self.assertIn("I can answer 12 kinds of question", self.ok("What can you do?")["answer"])
        self.assertIn("is not supported yet", self.ok("Change to dark mode.")["answer"])
        self.assertIn("Equipment items: 3.", self.ok("how many assets do we have")["answer"])
        self.assertEqual(self.ok("tell me a joke")["route"], "unsupported")

    def test_nothing_that_changes_anything_is_reachable_from_the_new_tool(self):
        self.assertFalse({"write", "ack", "set", "delete"} & {w for n in eko_chat.TOOLS for w in re.split(r"[_ ]", n)})
        self.assertEqual(set(eko_chat.TOOLS["get_capabilities"]["parameters"]["properties"]), {"about", "show"})


if __name__ == "__main__":
    unittest.main()
