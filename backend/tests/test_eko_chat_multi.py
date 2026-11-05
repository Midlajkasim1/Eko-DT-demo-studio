"""Eko-Chat Phase 1: several questions in one message, each answered (or said not to be) and none dropped.

Run from backend/:   python -m unittest tests.test_eko_chat_multi
A compound message is split by eko_chat_router.plan_parts() into at most four questions, each routed by the SAME route() as a single question and run
through the same execute() / direct_text() / grounding check, on the request's pinned view. Every part gets a result: answered, unavailable, unsupported
or failed. Fake FIN, a throwaway notification database, scripted models: nothing here reaches a model server.
"""
import contextlib
import io
import json
import os
import sys
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_context as ctx_mod  # noqa: E402
import eko_chat_llm  # noqa: E402
import eko_chat_router as router  # noqa: E402
from chat_support import parse_sse  # noqa: E402
from test_eko_chat_scope import ScopeBase, Scripted  # noqa: E402

SINGLE_KEYS = {"answer", "answer_source", "route", "grounded", "tool_calls", "card", "model", "project", "timestamp"}
ARABIC_QUESTION = "كم عدد الأصول في المبنى؟"


def texts(plan):
    return [p["text"] for p in plan["parts"]]


def rules(plan):
    return [p["decision"]["rule"] if p["decision"] else None for p in plan["parts"]]


class SplitterTests(unittest.TestCase):
    """plan_parts(): text in, questions out. No FIN, no tool, no model."""

    def test_a_single_question_is_not_split(self):
        for q in ("How many assets are there?", "Show equipment list", "show open alarms", "What is the humidity?", "list ahus", "status of AHU_01",
                  "Show critical alerts", "what can you do", "hello", ""):
            self.assertIsNone(router.plan_parts(q), q)

    def test_two_independent_questions(self):
        plan = router.plan_parts("How many assets are there and how many AHUs are in alarm?")
        self.assertEqual(texts(plan), ["How many assets are there", "how many AHUs are in alarm"])
        self.assertEqual(rules(plan), ["equipment.count", "equipment.in_alarm.count"])
        self.assertEqual(plan["parts"][1]["decision"]["parameters"], {"type": "ahu", "in_alarm": True})
        self.assertEqual(plan["overflow"], [])

    def test_three_independent_questions(self):
        plan = router.plan_parts("Show notifications, humidity and CO2.")
        self.assertEqual(texts(plan), ["Show notifications", "humidity", "CO2"])
        self.assertEqual(rules(plan), ["notifications.list", "env.humidity", "env.co2"])

    def test_four_questions_are_the_most_and_the_rest_are_listed_not_dropped(self):
        plan = router.plan_parts("Show notifications. Show unread count. What is the humidity? Show CO2. List alarms.")
        self.assertEqual(router.MAX_PARTS, 4)
        self.assertEqual(len(plan["parts"]), 4)
        self.assertEqual(plan["overflow"], ["List alarms"])
        exactly_four = router.plan_parts("Show notifications. Show unread count. What is the humidity? Show CO2.")
        self.assertEqual((len(exactly_four["parts"]), exactly_four["overflow"]), (4, []))

    def test_sentences_are_split_at_the_end_of_a_sentence(self):
        plan = router.plan_parts("Show equipment list. Then show open alarms.")
        self.assertEqual(texts(plan), ["Show equipment list", "show open alarms"])
        self.assertEqual(rules(plan), ["equipment.list.read", "alarms.list"])
        self.assertEqual(rules(router.plan_parts("Show equipment list!\nShow open alarms")), ["equipment.list.read", "alarms.list"])
        self.assertEqual(rules(router.plan_parts("1. how many assets are there? 2. show open alarms")), ["equipment.count", "alarms.list"])
        self.assertIsNone(router.plan_parts("Show equipment list.Show open alarms"), "no space after the full stop: not a sentence boundary")

    def test_and_and_commas_split_only_between_whole_words(self):
        self.assertEqual(texts(router.plan_parts("list ahus and fcus")), ["list ahus", "fcus"])
        self.assertEqual(router.plan_parts("list ahus and fcus")["parts"][1]["interpreted_as"], "list fcus")
        self.assertEqual(texts(router.plan_parts("how many alarms are open, how many notifications are unread")), ["how many alarms are open", "how many notifications are unread"])
        self.assertEqual(texts(router.plan_parts("show open alarms & show notifications")), ["show open alarms", "show notifications"])
        # "and" inside a word or a name, a number with a comma, a decimal: nothing to split
        for q in ("show androids", "Tom and Jerry", "1,000 and 2,000 assets", "version 3.5 is fine", "e.g. show alarms"):
            self.assertIsNone(router.plan_parts(q), q)

    def test_a_shared_verb_is_carried_to_the_pieces_that_follow(self):
        plan = router.plan_parts("Show notifications, humidity and CO2")
        self.assertEqual([p["interpreted_as"] for p in plan["parts"]], [None, None, None])        # each routes on its own words
        plan = router.plan_parts("list ahus and fcus")
        self.assertEqual(plan["parts"][1]["decision"]["parameters"], {"type": "fcu"})

    def test_words_that_are_not_equipment_types_do_not_become_type_filters(self):
        for q in ("show humidity", "show iaq", "show energy", "list warnings"):
            d = router.route(q)
            self.assertNotEqual((d.get("rule") or "").split(".")[:2], ["equipment", "type"], (q, d))

    def test_ordering_is_the_order_asked(self):
        a = router.plan_parts("how many alarms are open and how many notifications are unread")
        b = router.plan_parts("how many notifications are unread and how many alarms are open")
        self.assertEqual(rules(a), ["alarms.count", "notifications.unread.count"])
        self.assertEqual(rules(b), ["notifications.unread.count", "alarms.count"])

    def test_a_question_no_rule_knows_is_kept_not_dropped(self):
        plan = router.plan_parts("How many assets are there and what is the weather like in paris today?")
        self.assertEqual(rules(plan), ["equipment.count", None])
        self.assertEqual(plan["parts"][1]["text"], "what is the weather like in paris today")

    def test_a_split_that_would_leave_a_fragment_is_not_a_split(self):
        for q in ("Show critical alerts and warnings", "show critical and warning alarms", "show alarms and unread", "show alarms, , ,", "show alarms. and. ,",
                  "hello. how many assets are there", "alarms and", "and", "show notifications and unread", "show notifications, unread"):
            self.assertIsNone(router.plan_parts(q), q)       # (the last two: "show unread" would be read as an equipment type)

    def test_a_number_with_a_comma_is_one_number_not_two_pieces(self):
        plan = router.plan_parts("show open alarms and list the latest 1,000 notifications")
        self.assertEqual(texts(plan), ["show open alarms", "list the latest 1,000 notifications"])
        self.assertEqual(rules(plan), ["alarms.list", None])

    def test_unsafe_text_is_never_split(self):
        for q in ("show alarms and readAll()", "show alarms; show notifications", "show alarms && show notifications", "show alarms and select * from users",
                  "show alarms and `rm -rf`", "show alarms and https://evil.example", "show alarms and <script>alert(1)</script>"):
            self.assertIsNone(router.plan_parts(q), q)

    def test_a_very_long_or_odd_message_is_not_split(self):
        self.assertIsNone(router.plan_parts("show alarms and " * 2000))
        for odd in (None, 5, [], {}, b"x"):
            self.assertIsNone(router.plan_parts(odd))
            self.assertEqual(router.split_parts(odd), [])

    def test_arabic_questions_are_pieces_of_their_own(self):
        plan = router.plan_parts("Show open alarms. " + ARABIC_QUESTION)
        self.assertEqual(rules(plan), ["alarms.list", None])
        self.assertEqual(plan["parts"][1]["text"], ARABIC_QUESTION.rstrip("؟"))
        plan = router.plan_parts("show open alarms، وما هي الرطوبة الآن في المبنى؟")
        self.assertEqual(rules(plan), ["alarms.list", None])
        self.assertIsNone(router.plan_parts(ARABIC_QUESTION), "one Arabic question alone is not compound")


class StatusTests(unittest.TestCase):
    """_part_status(): a part's status comes from its tool result alone."""

    def test_the_status_of_an_executed_part(self):
        status = eko_chat._part_status
        self.assertEqual(status("get_alarms", {"available": True}), ("answered", None))
        self.assertEqual(status("get_capabilities", {"available": True, "about": {"status": "available"}}), ("answered", None))
        self.assertEqual(status("get_capabilities", {"available": True, "about": {"status": "not_supported", "reason": "read_only"}}), ("unsupported", "read_only"))
        self.assertEqual(status("get_capabilities", {"available": True, "about": {"status": "not_supported"}}), ("unsupported", "not_supported"))
        self.assertEqual(status("get_capabilities", {"available": True, "about": {"status": "unmapped"}}), ("unavailable", "unmapped"))
        for reason in ("metric_unavailable", "no_data_yet", "stale", "online_state_unavailable", "period_not_supported", "notifications_unavailable",
                       "alarm_history_unavailable", "fin_not_connected", "no_active_project", "no_sensors"):
            self.assertEqual(status("get_environment", {"available": False, "reason": reason}), ("unavailable", reason), reason)
        for reason in ("tool_error", "invalid_arguments", "unknown_tool", "something_new", None):
            self.assertEqual(status("get_environment", {"available": False, "reason": reason})[0], "failed", reason)
        self.assertEqual(status("get_environment", {"available": False, "reason": r"C:\secret"})[1], "tool_error", "a reason the browser may not be told is not passed on")


class MultiBase(ScopeBase):
    def setUp(self):
        super().setUp()
        spy = eko_chat.run_tool                    # ScopeBase's: it records (tool, project) in self.ran and runs the real one
        patch = mock.patch.object(router, "run_tool", spy)   # the rules call run_tool through the router's own import
        patch.start()
        self.addCleanup(patch.stop)
        self.provider("rules")
        self.ran.clear()

    def multi(self, message, **extra):
        r = self.ask(message, **extra)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["route"], "multi", body)
        return body

    def statuses(self, body):
        return [p["status"] for p in body["parts"]]


class AnsweredTests(MultiBase):
    def test_a_single_question_is_answered_exactly_as_before(self):
        for q in ("How many assets are there?", "show open alarms", "Show equipment list", "show notifications"):
            body = self.ok(q)
            self.assertEqual(set(body), SINGLE_KEYS, q)
            self.assertEqual((body["route"], body["answer_source"]), ("direct", "code"), q)
            self.assertNotIn("parts", body)
            self.assertNotIn("multi", body)
        self.assertEqual(self.ok("what is the weather like in paris today")["route"], "unsupported")
        self.assertEqual(self.ok("Show critical alerts and warnings")["route"], "unsupported")

    def test_two_independent_questions_equipment_count_and_alarm_count(self):
        total = self.tool("find_equipment")["total"]
        self.ran.clear()
        body = self.multi("How many assets are there and how many AHUs are in alarm?")
        self.assertEqual(self.statuses(body), ["answered", "answered"])
        first, second = body["parts"]
        self.assertEqual(first["question"], "How many assets are there")
        self.assertEqual(first["facts"]["total"], total)
        self.assertIn(f"Equipment items: {total}.", first["answer"])
        self.assertEqual((second["question"], second["facts"]["total"], second["facts"]["filter"]), ("how many AHUs are in alarm", 1, {"type": "ahu", "in_alarm": True}))
        self.assertIn("EQ-1", second["answer"])
        self.assertEqual(body["multi"], {"count": 2, "answered": 2, "status": "complete", "needs_planner": False})
        self.assertEqual([t for t, _ in self.ran], ["find_equipment", "find_equipment"])

    def test_two_independent_questions_equipment_list_and_open_alarms(self):
        body = self.multi("Show equipment list. Then show open alarms.")
        self.assertEqual(self.statuses(body), ["answered", "answered"])
        self.assertEqual([p["tool"] for p in body["parts"]], ["find_equipment", "get_alarms"])
        self.assertEqual([p["rule"] for p in body["parts"]], ["equipment.list.read", "alarms.list"])
        self.assertIn("EQ-1", body["parts"][0]["answer"])
        self.assertEqual(body["parts"][1]["facts"]["counts"], {"critical": 1, "warning": 0, "info": 0})
        self.assertIn("High temperature", body["parts"][1]["answer"])
        self.assertIsNotNone(body["parts"][0]["card"])
        self.assertIsNotNone(body["parts"][1]["card"])

    def test_two_independent_questions_notifications_and_the_unread_count(self):
        body = self.multi("Show notifications. Show unread count.")
        self.assertEqual(self.statuses(body), ["answered", "answered"])
        self.assertEqual([p["tool"] for p in body["parts"]], ["get_notifications", "get_notifications"])
        self.assertEqual(body["parts"][1]["facts"]["filter"], {"view": "unread"})
        self.assertEqual(body["parts"][1]["facts"]["unread"], 0)
        self.assertEqual(body["parts"][0]["source"], "Eko-DT notification store")
        body = self.multi("how many alarms are open and how many notifications are unread?")
        self.assertEqual(self.statuses(body), ["answered", "answered"])

    def test_three_independent_questions_notifications_humidity_and_co2(self):
        body = self.multi("Show notifications, humidity and CO2.")
        self.assertEqual(self.statuses(body), ["answered", "unavailable", "unavailable"])
        self.assertEqual([p["question"] for p in body["parts"]], ["Show notifications", "humidity", "CO2"])
        self.assertEqual(body["multi"], {"count": 3, "answered": 1, "status": "partial", "needs_planner": False})

    def test_humidity_and_co2_that_are_not_mapped_are_unavailable_and_nothing_is_made_up(self):
        body = self.multi("What is the humidity and co2?")
        self.assertEqual(self.statuses(body), ["unavailable", "unavailable"])
        humidity, co2 = body["parts"]
        for part in (humidity, co2):
            self.assertEqual(part["reason"], "metric_unavailable")
            self.assertEqual(part["facts"]["readings"], [], "no value was read, so none is given")
            self.assertEqual(part["tool"], "get_environment")
        self.assertIn("ra_co2", co2["answer"])
        self.assertIn("Dashboard Settings", co2["answer"], "the missing mapping is named")
        self.assertEqual(co2["missing"][0]["mapping"], "finLivePoints")
        self.assertNotRegex(humidity["answer"], r"\d")
        self.assertFalse(any(c["available"] for c in body["tool_calls"]))

    def test_one_supported_and_one_unavailable(self):
        body = self.multi("show open alarms and humidity")
        self.assertEqual(self.statuses(body), ["answered", "unavailable"])
        self.assertEqual(body["parts"][1]["question"], "humidity")
        self.assertEqual(body["multi"]["status"], "partial")
        self.assertIn("EQ-1", body["parts"][0]["answer"])

    def test_one_supported_and_one_unsupported(self):
        body = self.multi("show open alarms and then switch to dark mode please")
        self.assertEqual(self.statuses(body), ["answered", "unsupported"])
        theme = body["parts"][1]
        self.assertEqual((theme["tool"], theme["facts"]["capability"]["status"]), ("get_capabilities", "not_supported"))
        self.assertIn("not supported", theme["answer"].lower())
        self.assertEqual([t for t, _ in self.ran], ["get_alarms", "get_capabilities"], "the request to change the theme ran nothing that changes anything")

    def test_a_question_the_rules_do_not_know_is_reported_for_the_planner_not_guessed(self):
        body = self.multi("How many assets are there and what is the weather like in paris today?")
        self.assertEqual(self.statuses(body), ["answered", "unsupported"])
        part = body["parts"][1]
        self.assertEqual((part["reason"], part["question"]), ("needs_planner", "what is the weather like in paris today"))
        self.assertNotIn("facts", part)
        self.assertTrue(body["multi"]["needs_planner"])
        self.assertEqual([t for t, _ in self.ran], ["find_equipment"], "no tool was run for the question nothing routes")

    def test_a_clarification_inside_a_compound_message_is_asked_back(self):
        body = self.multi("show open alarms and what is the temperature now please")
        self.assertEqual(self.statuses(body), ["answered", "unsupported"])
        self.assertEqual(body["parts"][1]["reason"], "clarification")
        self.assertIn("Which temperature do you mean?", body["parts"][1]["answer"])

    def test_the_answers_come_in_the_order_asked(self):
        a = self.multi("how many alarms are open and how many notifications are unread")
        b = self.multi("how many notifications are unread and how many alarms are open")
        self.assertEqual([p["rule"] for p in a["parts"]], ["alarms.count", "notifications.unread.count"])
        self.assertEqual([p["rule"] for p in b["parts"]], ["notifications.unread.count", "alarms.count"])
        positions = [b["answer"].index(f"**{i}. ") for i in (1, 2)]
        self.assertEqual(positions, sorted(positions))
        self.assertLess(b["answer"].index("unread"), b["answer"].index("Open alarms"))

    def test_the_composed_answer_is_headed_markdown_for_clients_that_do_not_draw_parts(self):
        body = self.multi("Show equipment list. Then show open alarms. Then humidity? Then show CO2.")
        lines = body["answer"].split("\n\n")
        self.assertTrue(lines[0].startswith("**1. Show equipment list**"), lines[0])
        self.assertEqual([ln for ln in body["answer"].split("\n") if ln.startswith("**")],
                         ["**1. Show equipment list**", "**2. show open alarms**", "**3. humidity**", "**4. show CO2**"])
        self.assertIn("*Unavailable.*", body["answer"])
        self.assertNotIn("*Unavailable.* Equipment", body["answer"])

    def test_every_part_carries_its_question_status_answer_facts_and_where_it_was_read(self):
        body = self.multi("Show equipment list. Then show open alarms.")
        for part in body["parts"]:
            self.assertLessEqual({"question", "status", "answer", "tool", "rule", "facts", "as_of", "source", "card"}, set(part))
            self.assertIn(part["status"], eko_chat.PART_STATUSES)
            self.assertTrue(part["as_of"])
            self.assertEqual(part["source"], "FIN")
            self.assertIn(part["tool"], eko_chat.TOOLS)
        self.assertEqual(body["answer_source"], "code")
        self.assertIsNone(body["model"])
        self.assertEqual(body["project"], {"id": "proj-hospital", "name": "ekoHospital"})

    def test_a_part_whose_sentence_cannot_be_checked_against_its_data_is_failed_not_shown(self):
        with mock.patch.object(router, "direct_text", lambda out, rule="": "There are 9999 assets."):
            body = self.multi("Show equipment list. Then show open alarms.")
        self.assertEqual(self.statuses(body), ["failed", "failed"])
        self.assertEqual([p["reason"] for p in body["parts"]], ["direct_ungrounded"] * 2)
        self.assertNotIn("9999", body["answer"])
        self.assertIn(eko_chat.NOT_VERIFIED, body["parts"][0]["answer"])

    def test_one_part_failing_does_not_take_the_others_down(self):
        real = router.execute
        n = []

        def flaky(decision, view):
            n.append(1)
            if len(n) == 1:
                raise RuntimeError("secret internal detail C:\\db\\x")
            return real(decision, view)
        with mock.patch.object(router, "execute", flaky):
            body = self.multi("Show equipment list. Then show open alarms.")
        self.assertEqual(self.statuses(body), ["failed", "answered"])
        self.assertEqual(body["parts"][0]["reason"], "internal_error")
        self.assertNotIn("secret", json.dumps(body))
        self.assertNotIn("RuntimeError", json.dumps(body))


class LimitTests(MultiBase):
    QUESTIONS = ["Show notifications.", "Show unread count.", "What is the humidity?", "Show CO2.", "List alarms."]

    def test_five_questions_answer_four_and_say_so_for_the_fifth(self):
        body = self.multi(" ".join(self.QUESTIONS))
        self.assertEqual(len(body["parts"]), 5)
        self.assertEqual(self.statuses(body), ["answered", "answered", "unavailable", "unavailable", "unsupported"])
        last = body["parts"][4]
        self.assertEqual((last["question"], last["reason"]), ("List alarms", "limit_exceeded"))
        self.assertIn("at most 4 questions", last["answer"])
        self.assertNotIn("tool", last)
        self.assertEqual(body["multi"]["count"], 5)
        self.assertEqual(len(self.ran), 4, "only four questions ran a tool")

    def test_no_question_is_silently_dropped(self):
        for message, count in (("How many assets are there and how many AHUs are in alarm?", 2), ("Show notifications, humidity and CO2", 3),
                               (" ".join(self.QUESTIONS), 5), ("Show open alarms. " + ARABIC_QUESTION + " What is the humidity?", 3),
                               ("show open alarms and then switch to dark mode please", 2)):
            body = self.multi(message)
            self.assertEqual(len(body["parts"]), count, message)
            self.assertEqual(body["multi"]["count"], count)
            for part in body["parts"]:
                self.assertIn(f". {part['question'].replace('*', '')}**", body["answer"], "every question has its heading in the composed answer")
                self.assertTrue(part["answer"].strip())
                self.assertIn(part["status"], eko_chat.PART_STATUSES)

    def test_a_tool_calling_model_gets_a_message_that_is_over_the_limit(self):
        self.provider("openai_compatible")
        model = self.use(Scripted([{"content": "I looked at all five.", "tool_calls": []}]))
        r = self.ask(" ".join(self.QUESTIONS))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("parts", r.json())
        self.assertEqual(model.calls, 1)


class UnsplittableTests(MultiBase):
    def test_a_message_that_is_not_a_list_of_questions_goes_where_it_went_before(self):
        for q in ("Show critical alerts and warnings", "show critical and warning alarms", "Tom and Jerry", "show alarms and unread"):
            body = self.ok(q)
            self.assertEqual(body["route"], "unsupported", q)
            self.assertNotIn("parts", body)
        self.assertEqual(self.ran, [], "no tool ran for any of them")

    def test_a_message_with_something_unsafe_in_it_is_never_split_or_run(self):
        body = self.ok("show open alarms and readAll() please")
        self.assertEqual(body["route"], "unsupported")
        self.assertNotIn("parts", body)
        self.assertEqual(self.ran, [])


class ProviderTests(MultiBase):
    def test_with_the_hybrid_model_every_part_that_routes_is_answered_without_a_model_call(self):
        self.provider("ollama", model="m")
        generate = mock.AsyncMock(side_effect=AssertionError("the model was called"))
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", generate):
            body = self.multi("How many assets are there and how many AHUs are in alarm?")
            partial = self.multi("show open alarms and then switch to dark mode please")
            unrouted = self.multi("How many assets are there and what is the weather like in paris today?")
        self.assertEqual(generate.await_count, 0)
        self.assertEqual(self.statuses(body), ["answered", "answered"])
        self.assertEqual(self.statuses(partial), ["answered", "unsupported"])
        self.assertEqual(self.statuses(unrouted), ["answered", "unsupported"])

    def test_with_a_tool_calling_model_a_message_whose_parts_all_route_never_calls_the_model(self):
        self.provider("openai_compatible")
        body = self.multi("How many assets are there and how many AHUs are in alarm?")      # (the suite's adapter factory fails a test that builds an adapter)
        self.assertEqual(self.statuses(body), ["answered", "answered"])
        self.assertIsNone(body["model"])

    def test_with_a_tool_calling_model_a_part_no_rule_knows_leaves_the_whole_message_to_the_model(self):
        self.provider("openai_compatible")
        model = self.use(Scripted([{"content": "I cannot read the weather.", "tool_calls": []}]))
        r = self.ask("How many assets are there and what is the weather like in paris today?")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertNotIn("parts", body)
        self.assertEqual((model.calls, body.get("route") != "multi"), (1, True))
        self.assertEqual(self.ran, [], "nothing was run before the model decided")

    def test_the_rules_off_switch_hands_everything_to_the_model_as_before(self):
        self.provider("openai_compatible", fast_router=False)
        model = self.use(Scripted([{"content": "Both are fine.", "tool_calls": []}]))
        r = self.ask("How many assets are there and how many AHUs are in alarm?")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((model.calls, "parts" in r.json()), (1, False))


class SecurityTests(MultiBase):
    def test_every_part_runs_on_the_open_project_with_read_only_tools_and_no_raw_fin_text(self):
        body = self.multi("How many assets are there and how many AHUs are in alarm? Show open alarms. Show notifications.")
        self.assertEqual({p for _, p in self.ran}, {"ekoHospital"})
        self.assertTrue(set(t for t, _ in self.ran) <= set(eko_chat.TOOLS))
        for name, spec in eko_chat.TOOLS.items():
            self.assertFalse(any(w in name for w in ("write", "set_", "update", "delete", "create", "commit")), name)
        dump = json.dumps(body)
        for raw in ("@p:", "p:ekoHospital", "readAll", "hisRead", "eval("):
            self.assertNotIn(raw, dump)

    def test_the_session_and_project_guard_runs_again_before_every_part(self):
        asked = []
        real = eko_chat.DataView(authenticated=True, project_id="p1", project_name="ekoHospital")
        pinned = ctx_mod.pinned_view_fn(lambda: real, ctx_mod.ProjectContext("p1", "ekoHospital", None, None), lambda: asked.append(1))
        body = eko_chat.try_multi("How many assets are there and how many AHUs are in alarm?", pinned)
        self.assertEqual(len(body["parts"]), 2)
        self.assertEqual(len(asked), 2, "once per part")

    def test_a_project_change_after_the_first_part_stops_the_request_and_shows_nothing(self):
        self.stop_polling()
        self.ran.clear()
        run = eko_chat.run_tool                       # ScopeBase's spy

        def switching(name, args, view):
            out = run(name, args, view)
            if len(self.ran) == 1:
                self.switch("all")                    # another user's project switch lands between the first part and the second
            return out
        with mock.patch.object(router, "run_tool", switching):
            r = self.ask("Show equipment list. Then show open alarms. Then show notifications.")
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "project_changed"))
        self.assertEqual([t for t, _ in self.ran], ["find_equipment"], "the second part never ran")
        for key in ("answer", "parts", "card", "multi"):
            self.assertNotIn(key, r.json())
        self.assertNotIn("EQ-1", r.text)
        self.assertNotIn("OTHER-PROJECT", r.text)
        self.assertEqual({p for _, p in self.ran}, {"ekoHospital"})

    def test_each_way_the_project_can_change_between_two_parts_is_caught(self):
        for how, status, error in (("id", 409, "project_changed"), ("name", 409, "project_changed"), ("site", 409, "project_changed"),
                                   ("all", 409, "project_changed"), ("logout", 401, "session_required")):
            with self.subTest(how):
                self.open_again()
                run = eko_chat.run_tool

                def switching(name, args, view, how=how, run=run):
                    out = run(name, args, view)
                    if len(self.ran) == 1:
                        self.switch(how)
                    return out
                with mock.patch.object(router, "run_tool", switching):
                    r = self.ask("Show equipment list. Then show open alarms.")
                self.assertEqual((r.status_code, r.json()["detail"]["error"]), (status, error), r.text)
                self.assertEqual(len(self.ran), 1)

    def open_again(self):
        from test_eko_chat_projects import HOSPITAL, HOSPITAL_ID
        self.open(HOSPITAL, HOSPITAL_ID)
        self.provider("rules")
        self.stop_polling()
        self.ran.clear()

    def test_a_streamed_request_whose_project_changes_is_refused_before_any_event_and_shows_no_parts(self):
        self.stop_polling()
        self.ran.clear()
        run = eko_chat.run_tool

        def switching(name, args, view):
            out = run(name, args, view)
            if len(self.ran) == 1:
                self.switch("id")
            return out
        with mock.patch.object(router, "run_tool", switching):
            r = self.ask("Show equipment list. Then show open alarms.", stream=True)
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "project_changed"))     # the rules answer is built before the stream starts, so nothing was sent
        self.assertEqual(parse_sse(r.text), [], "no event was sent")
        for key in ("parts", "answer", "multi", "card"):
            self.assertNotIn(key, r.json())
        self.assertNotIn("EQ-1", r.text)
        self.assertEqual(len(self.ran), 1)

    def test_a_session_that_ended_before_the_request_is_refused_and_nothing_runs(self):
        self.http.cookies.clear()
        r = self.ask("Show equipment list. Then show open alarms.")
        self.assertIn(r.status_code, (401, 403, 409))
        self.assertNotIn("parts", r.text)
        self.assertEqual(self.ran, [])


class DeadlineTests(MultiBase):
    def test_a_part_that_would_start_after_the_deadline_is_not_run_and_the_answered_ones_are_kept(self):
        self.provider("rules", request_deadline_s=0.5)
        run = eko_chat.run_tool

        def slow(name, args, view):
            out = run(name, args, view)
            if len(self.ran) == 1:
                time.sleep(0.7)                       # the first part used up the whole budget
            return out
        with mock.patch.object(router, "run_tool", slow):
            body = self.multi("Show equipment list. Then show open alarms. Then show notifications.")
        self.assertEqual(self.statuses(body), ["answered", "failed", "failed"])
        self.assertEqual([p.get("reason") for p in body["parts"]], [None, "request_timeout", "request_timeout"])
        self.assertIn("time limit", body["parts"][1]["answer"])
        self.assertIn("EQ-1", body["parts"][0]["answer"], "what was read before the deadline is kept")
        self.assertEqual(len(self.ran), 1, "no tool started after the deadline")
        self.assertEqual(body["multi"], {"count": 3, "answered": 1, "status": "partial", "needs_planner": False})
        self.assertEqual(len(body["parts"]), 3, "the parts that did not run are still reported")

    def test_a_part_the_rules_do_not_know_is_also_timed_out_not_dropped(self):
        deadline = ctx_mod.Deadline(1, t0=time.perf_counter() - 5)
        pinned = lambda: eko_chat.DataView(authenticated=True, project_id="p", project_name="n")      # noqa: E731
        body = eko_chat.try_multi("How many assets are there and what is the weather like in paris today?", pinned, None, deadline)
        self.assertEqual(self.statuses(body), ["failed", "failed"])
        self.assertEqual(self.ran, [])

    def test_the_rules_are_not_stopped_by_a_deadline_they_meet(self):
        self.provider("rules", request_deadline_s=30)
        self.assertEqual(self.statuses(self.multi("Show equipment list. Then show open alarms.")), ["answered", "answered"])


class StreamingTests(MultiBase):
    def test_a_streamed_multi_answer_is_start_tools_and_a_done_that_carries_the_parts(self):
        events = parse_sse(self.ask("How many assets are there and how many AHUs are in alarm?", stream=True).text)
        names = [e for e, _ in events]
        self.assertEqual(names[0], "start")
        self.assertEqual(events[0][1]["route"], "multi")
        self.assertEqual(names[-1], "done")
        self.assertNotIn("token", names, "the answer is complete, so it arrives whole")
        self.assertEqual(names.count("tool"), 4, "a running and a completed event for each part's tool")
        done = events[-1][1]
        self.assertEqual((done["route"], done["answer_source"], done["grounded"]), ("multi", "code", True))
        self.assertEqual([p["question"] for p in done["parts"]], ["How many assets are there", "how many AHUs are in alarm"])
        self.assertEqual(done["multi"], {"count": 2, "answered": 2, "status": "complete", "needs_planner": False})
        self.assertEqual(done["project"], {"id": "proj-hospital", "name": "ekoHospital"})
        self.assertTrue(done["answer"].startswith("**1. How many assets are there**"))
        plain = self.multi("How many assets are there and how many AHUs are in alarm?")
        self.assertEqual([(p["question"], p["status"], p["answer"]) for p in done["parts"]], [(p["question"], p["status"], p["answer"]) for p in plain["parts"]])

    def test_a_streamed_single_answer_is_as_before(self):
        events = parse_sse(self.ask("show open alarms", stream=True).text)
        done = events[-1][1]
        self.assertEqual((events[-1][0], done["route"]), ("done", "direct"))
        self.assertNotIn("parts", done)
        self.assertNotIn("multi", done)

    def test_the_tool_events_of_a_failed_part_say_why_in_the_browsers_own_codes(self):
        events = parse_sse(self.ask("Show notifications, humidity and CO2", stream=True).text)
        tools = [d for e, d in events if e == "tool" and d["status"] != "running"]
        self.assertEqual([(t["tool"], t["status"]) for t in tools], [("get_notifications", "completed"), ("get_environment", "failed"), ("get_environment", "failed")])
        self.assertTrue(all(t["reason"] in eko_chat.SAFE_REASONS for t in tools if t["status"] == "failed"))


class ArabicTests(MultiBase):
    def test_an_arabic_question_among_the_parts_comes_back_as_written_and_is_reported(self):
        body = self.multi("Show open alarms. " + ARABIC_QUESTION)
        self.assertEqual(self.statuses(body), ["answered", "unsupported"])
        self.assertEqual(body["parts"][1]["question"], ARABIC_QUESTION.rstrip("؟"))
        self.assertEqual(body["parts"][1]["reason"], "needs_planner")
        self.assertIn(ARABIC_QUESTION.rstrip("؟"), body["answer"])
        self.assertEqual(self.ran and [t for t, _ in self.ran], ["get_alarms"])

    def test_the_arabic_text_is_not_escaped_into_ascii_in_a_stream_either(self):
        r = self.ask("Show open alarms. " + ARABIC_QUESTION, stream=True)
        events = parse_sse(r.text)
        done = events[-1][1]
        self.assertEqual(done["parts"][1]["question"], ARABIC_QUESTION.rstrip("؟"))
        self.assertIn(ARABIC_QUESTION.rstrip("؟"), r.text)
        self.assertNotIn("\\u0643", r.text)

    def test_arabic_comma_and_question_mark_separate_questions(self):
        body = self.multi("show open alarms، وما هي الرطوبة الآن في المبنى؟")
        self.assertEqual(self.statuses(body), ["answered", "unsupported"])
        self.assertEqual(len(body["parts"]), 2)


class DiagnosticsTests(MultiBase):
    def test_the_summary_line_says_the_rules_answered_several_questions_and_no_model_was_called(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.multi("How many assets are there and how many AHUs are in alarm?")
        result = [ln for ln in buf.getvalue().splitlines() if "CHAT_RESULT" in ln]
        self.assertEqual(len(result), 1, buf.getvalue())
        self.assertIn("mode=RULES_ONLY", result[0])
        self.assertIn("handler=multi", result[0])
        self.assertIn("rule=multi.2", result[0])
        self.assertIn("llm_called=false", result[0])
        self.assertNotIn("assets", result[0], "no question text in the diagnostics")


if __name__ == "__main__":
    unittest.main()
