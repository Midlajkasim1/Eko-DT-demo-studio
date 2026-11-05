"""Eko-Chat Phase 3: timeout and partial-result replies follow the language of the request.

Run from backend/:   python -m unittest tests.test_eko_chat_arabic_partial
When the user asks for Arabic (Arabic letters in the question, or an explicit request such as "in Arabic"), the planner's own replies are Arabic: the timeout
reply, a partial answer (deadline, planning limit, model stopped) with the sentences that report what was read, and the fixed replies for a model that is
down or not understood. Equipment IDs, numbers and units (AHU_01, 24.0, °C, ppm, kW) are exactly the tool results'. English requests keep their English text.
Scripted models, fake caches: nothing here reaches a model server or FIN.
"""
import asyncio
import json
import os
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_context as ctx_mod  # noqa: E402
import eko_chat_llm  # noqa: E402
import eko_chat_planner as planner  # noqa: E402
import eko_chat_text_ar as ar  # noqa: E402
import test_eko_chat_planner as tp  # noqa: E402     (the module, not its test classes: the loader would run them again here)
from test_eko_chat_planner import ALL_TOOLS, ARABIC_Q, CFG, Scripted, ahu_view, call, calls, eq, iso, make_view, plan, pt, say  # noqa: E402
from test_eko_chat_projects import ProjectChatBase  # noqa: E402

ARABIC_LETTERS = planner._ARABIC
SLOW = 5


async def slow():
    await asyncio.sleep(SLOW)


def closed():
    eko_chat_llm.BREAKER["until"] = 0.0


def results_text(reply_calls, view):
    return [json.dumps(eko_chat.run_tool(c["name"], c["arguments"], view), default=str, ensure_ascii=False) for c in reply_calls]


class ArabicTextTests(unittest.TestCase):
    """direct_text_ar: the sentence for a tool result, in Arabic, from the result's own values."""

    def render(self, name, args, view=None):
        view = view or ahu_view()
        result = eko_chat.run_tool(name, args, view)
        return ar.direct_text_ar({"intent": name, "parameters": args, "result": result}), result

    def test_every_tool_has_an_arabic_sentence_with_only_values_from_its_result(self):
        for name, args in ALL_TOOLS:
            with self.subTest(name):
                text, result = self.render(name, args)
                self.assertTrue(result["available"], result)
                self.assertTrue(ARABIC_LETTERS.search(text), text)
                self.assertEqual(eko_chat._ungrounded(text, [json.dumps(result, default=str, ensure_ascii=False)]), [], text)
                self.assertEqual(planner.english_words(text, [json.dumps(result, default=str, ensure_ascii=False)], ""), [], text)

    def test_ids_numbers_and_units_are_the_results_own(self):
        text, _ = self.render("get_equipment_status", {"equipment": "AHU_01"})
        self.assertIn("AHU_01", text)
        text, _ = self.render("calculate_metric", {"metric": "co2", "op": "max", "type": "ahu"})
        self.assertIn("600 ppm", text)
        self.assertIn("AHU_01", text)
        text, _ = self.render("calculate_metric", {"metric": "temperature", "op": "top", "type": "ahu", "limit": 2})
        self.assertIn("1. AHU_01 24 °C", text)
        self.assertIn("2. AHU_02 20 °C", text)
        text, _ = self.render("compare_equipment", {"equipment_a": "AHU_01", "equipment_b": "AHU_02"})
        self.assertIn("AHU_01", text)
        self.assertIn("AHU_02", text)
        self.assertIn("°C", text)
        self.assertIn("20%", text)
        text, _ = self.render("get_energy", {"period": "today"})
        self.assertIn("kWh", text)

    def test_power_keeps_its_unit(self):
        view = make_view(items=[eq("FCU-01", [pt("Fan Power", "1.5 kW", "kW")], type_="fcu"), eq("FCU-02", [pt("Fan Power", "2.0 kW", "kW")], type_="fcu")])
        text, _ = self.render("calculate_metric", {"metric": "power", "op": "sum", "type": "fcu"}, view)
        self.assertIn("3.5 kW", text)

    def test_what_could_not_be_read_is_said_in_arabic_with_the_missing_mapping(self):
        text, result = self.render("get_environment", {"metric": "iaq"})
        self.assertFalse(result["available"])
        self.assertTrue(ARABIC_LETTERS.search(text))
        self.assertIn("iaq_index", text)
        self.assertNotIn("no live point", text)
        stale = make_view(equipment={"timestamp": iso(30), "equipment": [eq("AHU_01")]})
        text, _ = self.render("get_equipment_status", {"equipment": "AHU_01"}, stale)
        self.assertIn("قديمة", text)

    def test_an_unknown_name_is_reported_with_the_name_as_written(self):
        text, _ = self.render("get_equipment_status", {"equipment": "AHU_77"})
        self.assertIn("AHU_77", text)
        self.assertTrue(ARABIC_LETTERS.search(text))
        text, _ = self.render("compare_equipment", {"equipment_a": "AHU_01", "equipment_b": "AHU_77"})
        self.assertIn("AHU_77", text)

    def test_no_result_is_ever_translated_into_a_different_number(self):
        for name, args in ALL_TOOLS:
            text, result = self.render(name, args)
            self.assertEqual(eko_chat._numbers(text).count("nan"), 0)
            self.assertNotIn("None", text, name)


class ArabicTimeoutTests(unittest.TestCase):
    def test_the_timeout_reply_is_arabic_and_says_how_many_seconds(self):
        reply = plan(Scripted([say("late")], hooks={0: slow}), ARABIC_Q, ahu_view(), deadline=ctx_mod.Deadline(0.3))
        self.assertEqual((reply["route"], reply["tool_calls"]), ("timeout", []))
        self.assertEqual(reply["answer"], ar.timeout_text(ctx_mod.Deadline(0.3)))
        self.assertTrue(ARABIC_LETTERS.search(reply["answer"]))
        self.assertIn("0.3", reply["answer"])
        self.assertEqual(planner.english_words(reply["answer"], [], ""), [])

    def test_an_arabic_question_without_the_word_arabic_gets_the_same(self):
        reply = plan(Scripted([say("late")], hooks={0: slow}), "اشرح حالة AHU_01", ahu_view(), deadline=ctx_mod.Deadline(0.3))
        self.assertEqual(reply["answer"], ar.timeout_text(ctx_mod.Deadline(0.3)))

    def test_an_english_request_keeps_the_english_timeout_text(self):
        deadline = ctx_mod.Deadline(0.3)
        reply = plan(Scripted([say("late")], hooks={0: slow}), "explain the open situation in detail", ahu_view(), deadline=deadline)
        self.assertEqual(reply["answer"], ctx_mod.timeout_text(deadline))
        self.assertFalse(ARABIC_LETTERS.search(reply["answer"]))

    def test_a_model_call_that_times_out_is_reported_in_arabic_and_starts_the_cool_down(self):
        eko_chat_llm.BREAKER["until"] = 0.0
        self.addCleanup(lambda: eko_chat_llm.BREAKER.update(until=0.0))
        reply = plan(Scripted([eko_chat.LLMError("llm_timeout", "x", 504)]), ARABIC_Q, ahu_view())
        self.assertEqual(reply["route"], "unsupported")
        self.assertTrue(reply["answer"].startswith(ar.LLM_DOWN_AR))
        self.assertTrue(ARABIC_LETTERS.search(reply["answer"]))
        self.assertGreater(eko_chat_llm.BREAKER["until"], time.monotonic())
        english = plan(Scripted([eko_chat.LLMError("llm_timeout", "x", 504)]), "explain the open situation in detail", ahu_view())
        self.assertTrue(english["answer"].startswith(eko_chat_llm.LLM_DOWN))


class ArabicPartialTests(unittest.TestCase):
    def setUp(self):
        eko_chat_llm.BREAKER["until"] = 0.0
        self.addCleanup(lambda: eko_chat_llm.BREAKER.update(until=0.0))

    def test_a_partial_answer_at_the_deadline_is_arabic_with_what_was_read(self):
        view = ahu_view()
        model = Scripted([calls(("get_equipment_status", {"equipment": "AHU_01"}), ("get_alarms", {"equipment": "AHU_01"})), say("late")], hooks={1: slow})
        reply = plan(model, ARABIC_Q, view, deadline=ctx_mod.Deadline(0.5))
        self.assertEqual((reply["route"], reply.get("partial"), reply["answer_source"]), ("llm_planner", True, "code"))
        self.assertTrue(reply["answer"].startswith(ar.partial_prefix("deadline", 0.5)))
        self.assertIn("AHU_01", reply["answer"])
        known = results_text(reply["tool_calls"], view)
        body = reply["answer"][len(ar.partial_prefix("deadline", 0.5)):]            # (the seconds of the time limit are the request's, not a reading)
        self.assertEqual(planner.english_words(reply["answer"], known, ""), [], reply["answer"])
        self.assertEqual(eko_chat._ungrounded(body, known), [])
        self.assertEqual([t["name"] for t in reply["tool_calls"]], ["get_equipment_status", "get_alarms"])

    def test_a_partial_answer_at_the_planning_limit_is_arabic(self):
        view = ahu_view()
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), call("get_alarms"), call("get_capabilities")])
        reply = plan(model, ARABIC_Q, view, cfg=dict(CFG, planner={"max_rounds": 3}))
        self.assertEqual((reply["route"], reply.get("partial")), ("llm_planner", True))
        self.assertTrue(reply["answer"].startswith(ar.partial_prefix("limit", 3)))
        self.assertIn("3", ar.partial_prefix("limit", 3))
        self.assertIn("AHU_01", reply["answer"])
        self.assertEqual(planner.english_words(reply["answer"], results_text(reply["tool_calls"], view), ""), [])

    def test_a_partial_answer_when_the_model_stops_is_arabic(self):
        view = ahu_view()
        reply = plan(Scripted([call("get_equipment_status", equipment="AHU_01"), eko_chat.LLMError("llm_unavailable", "x", 502)]), ARABIC_Q, view)
        self.assertEqual((reply["route"], reply.get("partial")), ("llm_planner", True))
        self.assertTrue(reply["answer"].startswith(ar.partial_prefix("stopped", 0)))
        self.assertIn("AHU_01", reply["answer"])
        self.assertGreater(eko_chat_llm.BREAKER["until"], time.monotonic())

    def test_the_partial_answer_keeps_the_ids_numbers_and_units_of_the_readings(self):
        view = ahu_view()
        model = Scripted([calls(("calculate_metric", {"metric": "temperature", "op": "top", "type": "ahu", "limit": 2}),
                                ("calculate_metric", {"metric": "co2", "op": "max", "type": "ahu"})), say("late")], hooks={1: slow})
        reply = plan(model, ARABIC_Q, view, deadline=ctx_mod.Deadline(0.5))
        for needle in ("1. AHU_01 24 °C", "2. AHU_02 20 °C", "600 ppm"):
            self.assertIn(needle, reply["answer"])

    def test_only_the_last_few_reads_are_reported_as_in_english(self):
        view = ahu_view()
        model = Scripted([call("get_capabilities"), call("get_alarms"), call("get_equipment_status", equipment="AHU_01"), call("get_hvac_status")])
        reply = plan(model, ARABIC_Q, view, cfg=dict(CFG, planner={"max_rounds": 4}))
        self.assertTrue(reply.get("partial"))
        self.assertNotIn("إمكانيات", reply["answer"])                                # the first read is not among the last three

    def test_a_partial_answer_to_an_english_request_is_unchanged(self):
        view = ahu_view()
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), call("get_alarms"), call("get_capabilities")])
        reply = plan(model, "explain AHU_01 in detail please", view, cfg=dict(CFG, planner={"max_rounds": 3}))
        self.assertTrue(reply["answer"].startswith("This answer is incomplete: the planning limit of 3 rounds was reached."))
        self.assertFalse(ARABIC_LETTERS.search(reply["answer"]))
        stopped = plan(Scripted([call("get_alarms"), eko_chat.LLMError("llm_timeout", "x", 504)]), "explain the alarms in detail", view)
        closed()
        self.assertTrue(stopped["answer"].startswith("This answer is incomplete: the language model stopped answering."))
        late = plan(Scripted([call("get_alarms"), say("late")], hooks={1: slow}), "explain the alarms in detail", view, deadline=ctx_mod.Deadline(0.5))
        self.assertTrue(late["answer"].startswith("This answer is incomplete: the time limit of 0.5 seconds was reached."))


class ArabicFixedReplyTests(unittest.TestCase):
    def setUp(self):
        eko_chat_llm.BREAKER["until"] = 0.0
        self.addCleanup(lambda: eko_chat_llm.BREAKER.update(until=0.0))

    def test_a_model_that_is_down_is_told_in_arabic_with_what_can_still_be_asked(self):
        for code in ("llm_unavailable", "llm_model_missing", "llm_http_error", "llm_invalid_response"):
            eko_chat_llm.BREAKER["until"] = 0.0
            reply = plan(Scripted([eko_chat.LLMError(code, "x", 502)]), ARABIC_Q, ahu_view())
            self.assertEqual(reply["answer"], ar.LLM_DOWN_AR + ar.HELP_AR, code)
        self.assertIn("AHU-01", ar.HELP_AR)                                         # the example is an equipment ID, left as it is

    def test_an_empty_model_answer_and_a_round_limit_with_nothing_read_are_arabic(self):
        reply = plan(Scripted([say("")]), ARABIC_Q, ahu_view())
        self.assertEqual(reply["answer"], ar.NOT_UNDERSTOOD_AR + ar.HELP_AR)
        reply = plan(Scripted([call("find_equipment", type="electrical")]), "اعرض كل شيء", ahu_view(), cfg=dict(CFG, planner={"max_rounds": 2}))
        self.assertEqual(reply["answer"], ar.rounds_text(2) + ar.HELP_AR)
        self.assertIn("2", ar.rounds_text(2))

    def test_the_cool_down_reply_is_arabic_too(self):
        plan(Scripted([eko_chat.LLMError("llm_unavailable", "x", 502)]), ARABIC_Q, ahu_view())
        model = Scripted([say("never")])
        reply = plan(model, ARABIC_Q, ahu_view())
        self.assertEqual((model.seen, reply["answer"]), ([], ar.LLM_DOWN_AR + ar.HELP_AR))

    def test_english_requests_keep_every_english_reply(self):
        reply = plan(Scripted([eko_chat.LLMError("llm_unavailable", "x", 502)]), "explain the alarms in detail", ahu_view())
        self.assertEqual(reply["answer"], eko_chat_llm.LLM_DOWN + eko_chat.HELP_TEXT)
        closed()
        reply = plan(Scripted([say("")]), "explain the alarms in detail", ahu_view())
        self.assertEqual(reply["answer"], eko_chat_llm.NOT_UNDERSTOOD + eko_chat.HELP_TEXT)


class ArabicEndpointTests(ProjectChatBase):
    start, model = tp.PlannerEndpoint.start, tp.PlannerEndpoint.model      # the planner endpoint's fixtures, without its tests

    def setUp(self):
        super().setUp()
        eko_chat_llm.BREAKER["until"] = 0.0
        self.addCleanup(lambda: eko_chat_llm.BREAKER.update(until=0.0))
        self.addCleanup(self.http.cookies.clear)

    def deadline(self, seconds):
        import main
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(main.CONFIG["chat"], request_deadline_s=seconds)

    def test_the_timeout_through_the_endpoint_is_arabic(self):
        self.start(items=ahu_view().equipment["equipment"])
        self.deadline(0.5)
        self.model([say("late")], hooks={0: slow})
        body = self.ok(ARABIC_Q)
        self.assertEqual((body["route"], body["tool_calls"]), ("timeout", []))
        self.assertEqual(body["answer"], ar.timeout_text(ctx_mod.Deadline(0.5)))
        self.assertEqual(body["project"]["name"], "ekoHospital")

    def test_the_partial_answer_through_the_endpoint_is_arabic_and_in_the_stream_too(self):
        self.start(items=ahu_view().equipment["equipment"])
        self.deadline(0.8)
        self.model([call("get_equipment_status", equipment="AHU_01"), say("late")], hooks={1: slow})
        body = self.ok(ARABIC_Q)
        self.assertTrue(body["answer"].startswith(ar.partial_prefix("deadline", 0.8)))
        self.assertIn("AHU_01", body["answer"])
        self.assertIs(body["partial"], True)

    def test_an_english_request_through_the_endpoint_is_unchanged(self):
        self.start(items=ahu_view().equipment["equipment"])
        self.deadline(0.5)
        self.model([say("late")], hooks={0: slow})
        body = self.ok("explain the open situation in detail")
        self.assertEqual(body["answer"], ctx_mod.timeout_text(ctx_mod.Deadline(0.5)))


if __name__ == "__main__":
    unittest.main()
