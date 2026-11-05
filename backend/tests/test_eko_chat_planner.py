"""Eko-Chat Phase 3: the LLM planner. A local model (Ollama) plans which read-only tools to call, reads their results, and explains them.

Run from backend/:   python -m unittest tests.test_eko_chat_planner
The model is scripted (or, for the wire format, answered by an httpx MockTransport); nothing here reaches a model server or FIN. Every tool call the model
makes is validated against the existing allowlist and schemas, runs on the request's pinned project, and every number, equipment name and severity in the
model's final answer must come from the tool results or the question.
"""
import asyncio
import dataclasses
import json
import os
import sys
import time
import unittest
from datetime import datetime, timedelta
from unittest import mock

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_context as ctx_mod  # noqa: E402
import eko_chat_llm  # noqa: E402
import eko_chat_planner as planner  # noqa: E402
import main  # noqa: E402
from chat_support import parse_sse  # noqa: E402
from test_eko_chat_metrics import day_samples, hist  # noqa: E402
from test_eko_chat_points import NOW, eq, iso, pt  # noqa: E402
from test_eko_chat_projects import DEFAULT_CHAT, HOSPITAL, HOSPITAL_ID, MARSA, MARSA_ID, ProjectChatBase  # noqa: E402

CFG = {"provider": "ollama", "model": "qwen3:8b", "planner": {"max_rounds": 4}}
QUESTION = "Deep dive on the ahu AHU-01 against AHU-02: humidity, CO2 and anything critical"      # no rule knows it; it names what the calls below use


def call(name, **args):
    return {"content": None, "tool_calls": [{"id": f"c-{name}", "name": name, "arguments": args}]}


def calls(*pairs):
    return {"content": None, "tool_calls": [{"id": f"c{i}", "name": n, "arguments": a} for i, (n, a) in enumerate(pairs)]}


def say(text):
    return {"content": text, "tool_calls": []}


class Scripted:
    """A model that returns its scripted replies in order, and keeps what it was asked."""
    name = model = "qwen3:8b"

    def __init__(self, replies, hooks=None):
        self.replies, self.hooks, self.seen, self.tools_seen = list(replies), hooks or {}, [], []

    async def complete(self, messages, tools):
        i = len(self.seen)
        self.seen.append(json.loads(json.dumps(messages, default=str)))
        self.tools_seen.append([t["function"]["name"] for t in tools])
        hook = self.hooks.get(i)
        if hook is not None:
            got = hook()
            if asyncio.iscoroutine(got):
                await got
        if isinstance(self.replies[min(i, len(self.replies) - 1)], Exception):
            raise self.replies[min(i, len(self.replies) - 1)]
        return self.replies[min(i, len(self.replies) - 1)]


def fleet():
    return [
        eq("AHU-01", [pt("Room Humidity", "40%", "%"), pt("Room CO2", "600 ppm", "ppm"), pt("Return Air Temp", "24.0", "°C")], fin_id="e1",
           alarms=[{"alarm": "High temperature", "priority": 200}]),
        eq("AHU-02", [pt("Room Humidity", "50%", "%"), pt("Room CO2", "800 ppm", "ppm"), pt("Return Air Temp", "20.0", "°C")], fin_id="e2"),
        eq("FCU-01", [pt("Room Temp", "22.0", "°C")], type_="fcu"),
    ]


def records():
    row = {"source": "AHU-01", "source_id": "e1", "message": "High temperature", "priority": 200, "severity": "critical", "state": "open"}
    return [dict(row, occurred="2026-10-28T09:00:00", open=True), dict(row, occurred="2026-10-27T09:00:00", open=False)]


def make_view(project=("proj-h", "ekoHospital"), items=None, **kw):
    alarms = {"timestamp": iso(), "counts": {"critical": 1, "warning": 0, "info": 0, "total": 1},
              "alarms": [{"source": "AHU-01", "source_id": "e1", "message": "High temperature", "severity": "critical", "priority": 200,
                          "occurred": "2026-10-28T09:00:00", "state": "open"}]}
    base = dict(authenticated=True, project_id=project[0], project_name=project[1], equipment={"timestamp": iso(), "equipment": items or fleet()},
                alarms=alarms, power={"timestamp": iso()}, facility={"onlineNames": ["AHU-01"], "totalEquipment": 3, "onlineEquipment": 1},
                alarm_records=records, site_now=NOW, scope=("u", "ekoHospital"), mapped={"finSeverityBands": True},
                power_history={"Hourly_Energy_Consumption_his": hist(day_samples(NOW, range(0, 10)))}, power_history_at=iso(),
                notifications=lambda user, site, **f: {"items": [], "more": False, "unread": 0})
    base.update(kw)
    return eko_chat.DataView(**base)


def plan(model, message=QUESTION, view=None, cfg=None, deadline=None, view_fn=None):
    """planner_reply over a scripted model; returns the reply."""
    view = view or make_view()
    with mock.patch.object(planner, "OllamaPlannerAdapter", lambda c: model):
        return asyncio.run(planner.planner_reply(cfg or CFG, message, view_fn or (lambda: view), None, False, None, None, deadline))


def tools_of(reply):
    return [t["name"] for t in reply["tool_calls"]]


# ─── The Ollama wire ─────────────────────────────────────────────────────────

class OllamaWireTests(unittest.TestCase):
    def adapter(self, handler, **cfg):
        patch = mock.patch.object(eko_chat, "HTTP_TRANSPORT", httpx.MockTransport(handler))
        patch.start()
        self.addCleanup(patch.stop)
        return planner.OllamaPlannerAdapter(dict({"model": "qwen3:8b"}, **cfg))

    def complete(self, a, messages=None, tools=None):
        return asyncio.run(a.complete(messages or [{"role": "user", "content": "hi"}], tools or eko_chat.tool_definitions()))

    def test_the_request_is_ollamas_chat_with_native_tools_and_a_local_model(self):
        sent = {}

        def handler(request):
            sent["url"], sent["body"] = str(request.url), json.loads(request.content)
            return httpx.Response(200, json={"message": {"role": "assistant", "content": "ok"}, "prompt_eval_count": 7, "eval_count": 3})
        out = self.complete(self.adapter(handler))
        self.assertEqual(sent["url"], "http://localhost:11434/api/chat")
        b = sent["body"]
        self.assertEqual((b["model"], b["stream"], b["think"]), ("qwen3:8b", False, False))
        self.assertEqual(b["options"]["temperature"], 0)
        self.assertEqual((b["options"]["num_ctx"], b["options"]["num_predict"]), (planner.DEFAULT_NUM_CTX, planner.DEFAULT_MAX_TOKENS))
        self.assertEqual(sorted(t["function"]["name"] for t in b["tools"]), sorted(eko_chat.TOOLS))
        self.assertEqual(len(b["tools"]), 13)
        self.assertEqual(out, {"content": "ok", "tool_calls": [], "usage": {"prompt_tokens": 7, "completion_tokens": 3}})

    def test_tool_calls_come_back_with_their_arguments_as_objects(self):
        def handler(request):
            return httpx.Response(200, json={"message": {"role": "assistant", "content": "", "tool_calls": [
                {"function": {"name": "search_points", "arguments": {"metric": "co2"}}},
                {"function": {"name": "get_alarms", "arguments": "{\"severity\": \"critical\"}"}}]}})
        out = self.complete(self.adapter(handler))
        self.assertEqual([(c["name"], c["arguments"]) for c in out["tool_calls"]], [("search_points", {"metric": "co2"}), ("get_alarms", "{\"severity\": \"critical\"}")])
        self.assertEqual([c["id"] for c in out["tool_calls"]], ["call_0", "call_1"])

    def test_the_conversation_is_sent_in_ollamas_shape(self):
        sent = {}

        def handler(request):
            sent["body"] = json.loads(request.content)
            return httpx.Response(200, json={"message": {"role": "assistant", "content": "x"}})
        messages = [{"role": "system", "content": "s"}, {"role": "user", "content": "q"},
                    {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "get_alarms", "arguments": "{\"severity\": \"critical\"}"}}]},
                    {"role": "tool", "tool_call_id": "c1", "content": "{\"available\": true}"}]
        self.complete(self.adapter(handler), messages)
        m = sent["body"]["messages"]
        self.assertEqual(m[2], {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "get_alarms", "arguments": {"severity": "critical"}}}]})
        self.assertEqual(m[3], {"role": "tool", "tool_name": "get_alarms", "content": "{\"available\": true}"})

    def test_a_server_that_fails_is_a_coded_error_with_nothing_else_in_it(self):
        cases = [(lambda r: (_ for _ in ()).throw(httpx.ReadTimeout("slow")), "llm_timeout"), (lambda r: (_ for _ in ()).throw(httpx.ConnectError("no")), "llm_unavailable"),
                 (lambda r: httpx.Response(404, text="model not found"), "llm_model_missing"), (lambda r: httpx.Response(500, text="boom secret"), "llm_http_error"),
                 (lambda r: httpx.Response(200, text="not json"), "llm_invalid_response"),
                 (lambda r: httpx.Response(200, json={"message": {"content": "x", "tool_calls": "no"}}), "llm_invalid_response"),
                 (lambda r: httpx.Response(200, json={"message": {"content": 5}}), "llm_invalid_response")]
        for handler, code in cases:
            with self.subTest(code):
                with self.assertRaises(eko_chat.LLMError) as ctx:
                    self.complete(self.adapter(handler))
                self.assertEqual(ctx.exception.code, code)
                self.assertNotIn("secret", ctx.exception.message)

    def test_the_server_must_be_on_this_machine_and_the_model_name_plain(self):
        for cfg in ({"base_url": "http://10.0.0.5:11434"}, {"base_url": "ftp://localhost"}, {"model": "bad name;rm"}):
            with self.assertRaises(ValueError):
                planner.OllamaPlannerAdapter(dict({"model": "qwen3:8b"}, **cfg))
        planner.OllamaPlannerAdapter({"model": "qwen3:8b", "base_url": "http://10.0.0.5:11434", "allow_remote_llm": True})
        self.assertEqual(planner.OllamaPlannerAdapter({"model": "qwen3:8b", "base_url": "http://localhost:11434/v1"}).base_url, "http://localhost:11434")


# ─── Settings ────────────────────────────────────────────────────────────────

class SettingsTests(unittest.TestCase):
    def test_the_planner_is_on_for_ollama_unless_switched_off(self):
        self.assertEqual(planner.settings({"provider": "ollama"})["max_rounds"], planner.DEFAULT_ROUNDS)
        for cfg in ({"provider": "ollama", "planner": False}, {"provider": "ollama", "planner": {"enabled": False}}, {"provider": "rules"},
                    {"provider": "openai_compatible"}, {}, None):
            self.assertIsNone(planner.settings(cfg), cfg)

    def test_the_round_limit_is_configurable_and_bounded(self):
        for given, expected in ((2, 2), (1, 1), (8, 8), (9, planner.DEFAULT_ROUNDS), (0, planner.DEFAULT_ROUNDS), ("3", planner.DEFAULT_ROUNDS), (True, planner.DEFAULT_ROUNDS),
                                (None, planner.DEFAULT_ROUNDS)):
            self.assertEqual(planner.settings({"provider": "ollama", "planner": {"max_rounds": given}})["max_rounds"], expected, given)

    def test_the_environment_can_switch_it_off_or_set_the_rounds(self):
        off = eko_chat_llm.effective({"provider": "ollama"}, {"LLM_PLANNER": "false"})
        self.assertIsNone(planner.settings(off))
        on = eko_chat_llm.effective({"provider": "ollama", "planner": False}, {"LLM_PLANNER": "true", "LLM_PLANNER_MAX_ROUNDS": "6"})
        self.assertEqual(planner.settings(on)["max_rounds"], 6)
        self.assertEqual(planner.settings(eko_chat_llm.effective({"provider": "ollama"}, {"LLM_PLANNER_MAX_ROUNDS": "99"}))["max_rounds"], planner.DEFAULT_ROUNDS)
        self.assertEqual(planner.settings(eko_chat_llm.effective({"provider": "ollama"}, {}))["max_rounds"], planner.DEFAULT_ROUNDS)


# ─── The planning loop ───────────────────────────────────────────────────────

ALL_TOOLS = [("get_building_snapshot", {}), ("find_equipment", {"type": "ahu"}), ("get_equipment_status", {"equipment": "AHU-01"}), ("get_alarms", {"severity": "critical"}),
             ("get_environment", {"metric": "humidity"}), ("get_energy", {"period": "today"}), ("get_capabilities", {}), ("get_hvac_status", {"type": "ahu"}),
             ("get_notifications", {"view": "unread"}), ("search_points", {"metric": "co2", "type": "ahu"}),
             ("calculate_metric", {"metric": "humidity", "op": "average", "type": "ahu"}),
             ("compare_equipment", {"equipment_a": "AHU-01", "equipment_b": "AHU-02"}), ("get_alarm_history", {"period": "today"})]


class EveryToolTests(unittest.TestCase):
    def test_the_list_covers_every_registered_tool(self):
        self.assertEqual({n for n, _ in ALL_TOOLS}, set(eko_chat.TOOLS))
        self.assertEqual(len(ALL_TOOLS), 13)

    def test_the_model_is_offered_all_thirteen_tools_and_nothing_else(self):
        model = Scripted([say("Nothing to look up.")])
        plan(model, "hello there my friend")
        self.assertEqual(sorted(model.tools_seen[0]), sorted(eko_chat.TOOLS))

    def test_each_tool_can_be_planned_run_and_explained(self):
        for name, args in ALL_TOOLS:
            with self.subTest(name):
                model = Scripted([call(name, **args), say("I read it from the building data.")])
                reply = plan(model)
                self.assertEqual(tools_of(reply), [name])
                self.assertTrue(reply["tool_calls"][0]["available"], reply["tool_calls"])
                self.assertEqual((reply["route"], reply["answer_source"], reply["grounded"]), ("llm_planner", "llm", True))
                self.assertEqual(reply["answer"], "I read it from the building data.")
                self.assertEqual(reply["card"]["tool"], name)
                self.assertEqual(len(model.seen), 2)
                tool_message = model.seen[1][-1]
                self.assertEqual(tool_message["role"], "tool")
                self.assertTrue(json.loads(tool_message["content"])["available"])


class PlanningTests(unittest.TestCase):
    def test_several_calls_in_one_round_are_all_run_and_answered(self):
        model = Scripted([calls(("search_points", {"metric": "co2", "type": "ahu"}), ("get_alarms", {"severity": "critical"})),
                          say("2 AHUs report CO2, and 1 critical alarm is open on AHU-01.")])
        reply = plan(model)
        self.assertEqual(tools_of(reply), ["search_points", "get_alarms"])
        self.assertEqual(reply["answer"], "2 AHUs report CO2, and 1 critical alarm is open on AHU-01.")
        self.assertEqual([m["role"] for m in model.seen[1][-2:]], ["tool", "tool"])
        self.assertEqual(reply["card"]["tool"], "get_alarms")                      # the card is the newest successful read

    def test_the_next_call_follows_from_the_result_before_it(self):
        model = Scripted([call("find_equipment", type="ahu"), call("get_equipment_status", equipment="AHU-02"),
                          say("AHU-02 has 3 of 3 points reporting.")])
        reply = plan(model, "list the ahu units and then the points of the second one")
        self.assertEqual(tools_of(reply), ["find_equipment", "get_equipment_status"])
        self.assertTrue(all(t["available"] for t in reply["tool_calls"]))
        self.assertIn("AHU-02", model.seen[1][-1]["content"])                      # the first result went back to the model before it chose the second call
        self.assertEqual(len(model.seen), 3)

    def test_a_name_that_only_an_earlier_result_holds_is_allowed_a_name_from_nowhere_is_not(self):
        model = Scripted([call("find_equipment", type="ahu"), call("get_equipment_status", equipment="AHU-02"), call("get_equipment_status", equipment="AHU-77"),
                          say("AHU-02 reports.")])
        reply = plan(model, "list the ahu units and then dig into them")
        by = [(t["arguments"]["equipment"] if t["arguments"] and "equipment" in t["arguments"] else None, t["available"], t.get("reason")) for t in reply["tool_calls"]]
        self.assertEqual(by[1], ("AHU-02", True, None))
        self.assertEqual(by[2], ("AHU-77", False, "invalid_arguments"))
        self.assertIn("not in the question", json.dumps(model.seen[3][-1]))

    def test_a_filter_the_user_did_not_write_is_refused_and_the_model_asks_again_without_it(self):
        model = Scripted([call("find_equipment", type="electrical"), call("find_equipment"), say("There are 3 equipment items.")])
        reply = plan(model, "show me everything that is installed")
        self.assertEqual([t["available"] for t in reply["tool_calls"]], [False, True])
        self.assertEqual(reply["tool_calls"][0]["reason"], "invalid_arguments")
        self.assertEqual(reply["answer"], "There are 3 equipment items.")

    def test_an_invented_tool_name_and_bad_arguments_are_fed_back_never_run(self):
        find = mock.Mock()
        with mock.patch.dict(eko_chat.TOOLS["find_equipment"], {"fn": find}):
            model = Scripted([calls(("delete_everything", {}), ("get_alarms", {"severity": "urgent"}), ("get_alarms", {"extra": 1}), ("find_equipment", {"limit": 500})),
                              say("I could not read that.")])
            reply = plan(model)
        self.assertEqual([t["reason"] for t in reply["tool_calls"]], ["unknown_tool", "invalid_arguments", "invalid_arguments", "invalid_arguments"])
        self.assertEqual([t["available"] for t in reply["tool_calls"]], [False] * 4)
        self.assertNotIn("delete_everything", eko_chat.TOOLS)
        self.assertEqual(find.call_count, 0)                                       # schema-invalid calls never reach the tool itself
        self.assertEqual(model.seen[1][-4]["role"], "tool")

    def test_a_call_with_no_name_or_unparseable_arguments_is_malformed(self):
        model = Scripted([{"content": None, "tool_calls": [{"id": "a", "name": None, "arguments": {}}, {"id": "b", "name": "get_alarms", "arguments": "{not json"}]},
                          say("Nothing was read.")])
        reply = plan(model)
        self.assertEqual([t["reason"] for t in reply["tool_calls"]], ["malformed_tool_call", "invalid_arguments"])

    def test_too_many_calls_in_one_step_are_answered_not_run(self):
        many = calls(*[("get_capabilities", {})] * (planner.MAX_CALLS_PER_ROUND + 3))
        model = Scripted([many, say("Done.")])
        reply = plan(model)
        ok = [t for t in reply["tool_calls"] if t["available"]]
        self.assertEqual((len(ok), len(reply["tool_calls"])), (planner.MAX_CALLS_PER_ROUND, planner.MAX_CALLS_PER_ROUND + 3))
        self.assertEqual(reply["tool_calls"][-1]["reason"], "invalid_arguments")

    def test_nothing_that_changes_anything_is_offered(self):
        names = " ".join(eko_chat.TOOLS)
        for word in ("write", "set_", "ack", "delete", "update", "create", "control"):
            self.assertNotIn(word, names)
        self.assertEqual({t for t in eko_chat.TOOLS if t.startswith(("get_", "find_", "search_", "calculate_", "compare_"))}, set(eko_chat.TOOLS))


class GroundingTests(unittest.TestCase):
    def test_the_final_explanation_is_the_models_own_words_when_every_value_is_in_the_results(self):
        model = Scripted([call("calculate_metric", metric="humidity", op="average", type="ahu"),
                          say("The two AHUs average 45 % humidity, from 2 readings, as of the latest FIN read.")])
        reply = plan(model, "what is the humidity across the ahu units, explained")
        self.assertEqual((reply["answer_source"], reply["grounded"]), ("llm", True))
        self.assertIn("45 %", reply["answer"])

    def test_a_number_the_tools_did_not_return_is_refused_once_and_then_replaced(self):
        model = Scripted([call("calculate_metric", metric="humidity", op="average", type="ahu"), say("The average humidity is 52 %."),
                          say("It is still 52 %, I am sure.")])
        reply = plan(model, "what is the humidity across the ahu units")
        self.assertEqual((reply["grounded"], reply["answer_source"]), (True, "code"))
        self.assertEqual(reply["answer"], eko_chat.UNGROUNDED_FALLBACK)
        self.assertIn("52", model.seen[2][-1]["content"])                           # the model was told which number was not in the data
        self.assertEqual(len(model.seen), 3)

    def test_the_model_may_correct_itself_after_one_refusal(self):
        model = Scripted([call("calculate_metric", metric="humidity", op="average", type="ahu"), say("The average humidity is 52 %."), say("The average humidity is 45 %.")])
        reply = plan(model, "what is the humidity across the ahu units")
        self.assertEqual((reply["answer_source"], reply["answer"]), ("llm", "The average humidity is 45 %."))

    def test_the_models_own_arithmetic_is_refused(self):
        model = Scripted([calls(("search_points", {"metric": "co2", "type": "ahu"}), ("calculate_metric", {"metric": "co2", "op": "max", "type": "ahu"})),
                          say("CO2 is 600 ppm and 800 ppm, so the sum is 1400 ppm."), say("The sum is 1400 ppm.")])
        reply = plan(model, "add up the co2 of the ahu units")
        self.assertEqual(reply["answer"], eko_chat.UNGROUNDED_FALLBACK)

    def test_an_equipment_name_that_is_in_no_result_and_not_in_the_question_is_refused(self):
        model = Scripted([call("get_alarms", severity="critical"), say("AHU-09 has a critical alarm."), say("AHU-09 has a critical alarm.")])
        reply = plan(model, "any critical alarms right now, explained")
        self.assertEqual(reply["answer"], eko_chat.UNGROUNDED_FALLBACK)
        self.assertIn("AHU-09", model.seen[2][-1]["content"])

    def test_a_name_written_differently_is_not_the_same_item(self):
        model = Scripted([call("get_alarms", severity="critical"), say("AHU-1 has a critical alarm."), say("AHU-1 has a critical alarm.")])
        self.assertEqual(plan(model, "any critical alarms right now, explained")["answer"], eko_chat.UNGROUNDED_FALLBACK)

    def test_a_severity_no_alarm_carries_is_refused(self):
        model = Scripted([call("get_alarms"), say("There is 1 warning alarm on AHU-01."), say("There is 1 warning alarm on AHU-01.")])
        reply = plan(model, "what alarms are open, explained")
        self.assertEqual(reply["answer"], eko_chat.UNGROUNDED_FALLBACK)
        ok = Scripted([call("get_alarms"), say("There is 1 critical alarm on AHU-01.")])
        self.assertEqual(plan(ok, "what alarms are open, explained")["answer_source"], "llm")

    def test_arabic_indic_digits_do_not_slip_past_the_number_check(self):
        model = Scripted([call("calculate_metric", metric="humidity", op="average", type="ahu"), say("متوسط الرطوبة ٥٢ ٪"), say("متوسط الرطوبة ٥٢ ٪")])
        self.assertEqual(plan(model, "ما هي الرطوبة في وحدات ahu")["answer"], planner.UNGROUNDED_AR)
        fine = Scripted([call("calculate_metric", metric="humidity", op="average", type="ahu"), say("متوسط الرطوبة ٤٥ ٪ من قراءتين")])
        reply = plan(fine, "ما هي الرطوبة في وحدات ahu")
        self.assertEqual((reply["answer_source"], reply["answer"]), ("llm", "متوسط الرطوبة ٤٥ ٪ من قراءتين"))

    def test_an_arabic_decimal_mark_does_not_split_a_number_into_two_that_the_data_holds(self):
        # 45 and 2 are both in the result (the average and the sample count), 45.2 is not: "٤٥٫٢" must be read as one number
        model = Scripted([call("calculate_metric", metric="humidity", op="average", type="ahu"), say("متوسط الرطوبة ٤٥٫٢ ٪"), say("متوسط الرطوبة ٤٥٫٢ ٪")])
        self.assertEqual(plan(model, "ما هي الرطوبة في وحدات ahu")["answer"], planner.UNGROUNDED_AR)
        self.assertEqual(eko_chat._numbers("٤٥٫٢ و ١٬٠٠٠"), ["45.2", "1000"])

    def test_an_answer_with_no_tool_may_not_bring_numbers_or_names_of_its_own(self):
        model = Scripted([say("AHU-01 is at 23 degrees."), say("AHU-01 is at 23 degrees.")])
        self.assertEqual(plan(model, "how is the building doing")["answer"], eko_chat.UNGROUNDED_FALLBACK)
        fine = Scripted([say("I need a little more detail: which equipment do you mean?")])
        reply = plan(fine, "how is it doing")
        self.assertEqual((reply["answer_source"], reply["tool_calls"]), ("llm", []))

    def test_numbers_in_the_question_may_be_repeated(self):
        model = Scripted([call("get_alarms"), say("For the last 3 days I can only read the latest alarm read: 1 alarm is open.")])
        self.assertEqual(plan(model, "alarms for the last 3 days")["answer_source"], "llm")


class UnavailableTests(unittest.TestCase):
    def test_a_missing_mapping_is_reported_by_the_code_when_the_model_does_not_name_it(self):
        model = Scripted([call("get_environment", metric="iaq"), say("I could not find the air quality index.")])
        reply = plan(model, "what is the air quality, explained")
        self.assertFalse(reply["tool_calls"][0]["available"])
        self.assertEqual(reply["tool_calls"][0]["missing"], [{"mapping": "finLivePoints", "key": "iaq_index"}])
        self.assertTrue(reply["answer"].startswith("I could not find the air quality index."))
        self.assertIn("Not available:", reply["answer"])
        self.assertIn("iaq_index", reply["answer"])

    def test_a_model_that_names_the_mapping_is_not_repeated(self):
        model = Scripted([call("get_environment", metric="iaq"), say("The IAQ index is not available: map iaq_index under Live Points.")])
        reply = plan(model, "what is the air quality, explained")
        self.assertNotIn("Not available:", reply["answer"])

    def test_unavailable_data_is_reported_even_when_the_model_says_nothing_about_it(self):
        stale = make_view(equipment={"timestamp": iso(30), "equipment": fleet()})
        model = Scripted([call("search_points", metric="co2"), say("Here is what I found.")])
        reply = plan(model, "which equipment has co2, explained", stale)
        self.assertEqual(reply["tool_calls"][0]["reason"], "stale")
        self.assertIn("Not available:", reply["answer"])
        self.assertIn("too old", reply["answer"])

    def test_the_arabic_footer_is_arabic(self):
        model = Scripted([call("get_environment", metric="iaq"), say("لم أجد المؤشر.")])
        reply = plan(model, "ما هو مؤشر جودة الهواء؟")
        self.assertIn("غير متاح", reply["answer"])
        self.assertIn("iaq_index", reply["answer"])

    def test_a_model_side_mistake_is_not_reported_as_missing_data(self):
        model = Scripted([call("get_alarms", severity="urgent"), call("get_alarms"), say("1 critical alarm is open on AHU-01.")])
        reply = plan(model, "what alarms are open, explained")
        self.assertNotIn("Not available:", reply["answer"])


class FailureTests(unittest.TestCase):
    def setUp(self):
        eko_chat_llm.BREAKER["until"] = 0.0
        self.addCleanup(lambda: eko_chat_llm.BREAKER.update(until=0.0))

    def test_a_model_that_is_down_gives_the_rules_fallback_reply(self):
        for code in ("llm_unavailable", "llm_timeout", "llm_model_missing", "llm_http_error", "llm_invalid_response"):
            with self.subTest(code):
                eko_chat_llm.BREAKER["until"] = 0.0
                reply = plan(Scripted([eko_chat.LLMError(code, "x", 502)]))
                self.assertEqual((reply["route"], reply["tool_calls"]), ("unsupported", []))
                self.assertTrue(reply["answer"].startswith(eko_chat_llm.LLM_DOWN))
                self.assertIn("equipment", reply["answer"])                                # the help text: what the rules can still answer

    def test_an_outage_starts_the_cool_down_and_the_next_question_makes_no_model_call(self):
        plan(Scripted([eko_chat.LLMError("llm_unavailable", "x", 502)]))
        self.assertGreater(eko_chat_llm.BREAKER["until"], time.monotonic())
        model = Scripted([say("never asked")])
        reply = plan(model)
        self.assertEqual((model.seen, reply["route"]), ([], "unsupported"))

    def test_an_error_after_a_tool_ran_keeps_what_was_read_and_starts_the_cool_down(self):
        reply = plan(Scripted([call("get_alarms"), eko_chat.LLMError("llm_timeout", "x", 504)]))
        self.assertEqual((reply["route"], reply.get("partial"), reply["answer_source"]), ("llm_planner", True, "code"))
        self.assertTrue(reply["answer"].startswith("This answer is incomplete: the language model stopped answering."))
        self.assertIn("Open alarms", reply["answer"])
        self.assertGreater(eko_chat_llm.BREAKER["until"], time.monotonic())

    def test_an_empty_answer_is_not_an_answer(self):
        reply = plan(Scripted([say("")]))
        self.assertEqual(reply["route"], "unsupported")
        self.assertTrue(reply["answer"].startswith(eko_chat_llm.NOT_UNDERSTOOD))

    def test_a_model_that_never_stops_calling_tools_ends_at_the_round_limit_with_what_it_read(self):
        model = Scripted([call("get_capabilities"), call("get_alarms"), call("get_capabilities")])
        reply = plan(model, cfg=dict(CFG, planner={"max_rounds": 3}))
        self.assertEqual(len(model.seen), 3)
        self.assertEqual((reply["route"], reply.get("partial"), reply["answer_source"]), ("llm_planner", True, "code"))
        self.assertIn("planning limit of 3 rounds", reply["answer"])
        self.assertIn("Open alarms", reply["answer"])
        self.assertEqual(tools_of(reply), ["get_capabilities", "get_alarms", "get_capabilities"])

    def test_the_round_limit_with_nothing_read_is_a_plain_reply(self):
        model = Scripted([call("find_equipment", type="electrical")])
        reply = plan(model, "show me everything", cfg=dict(CFG, planner={"max_rounds": 2}))
        self.assertEqual(len(model.seen), 2)
        self.assertEqual(reply["route"], "unsupported")
        self.assertIn("2 rounds", reply["answer"])

    def test_one_round_is_enough_for_a_direct_answer_and_a_limit_of_one_stops_after_one_call(self):
        model = Scripted([call("get_alarms"), say("1 critical alarm.")])
        reply = plan(model, cfg=dict(CFG, planner={"max_rounds": 1}))
        self.assertEqual(len(model.seen), 1)
        self.assertTrue(reply.get("partial"))

    def test_the_grounding_correction_does_not_use_up_a_round(self):
        model = Scripted([call("get_alarms"), say("There are 9 alarms."), say("There is 1 critical alarm.")])
        reply = plan(model, cfg=dict(CFG, planner={"max_rounds": 2}))
        self.assertEqual((reply["answer_source"], len(model.seen)), ("llm", 3))

    def test_the_overall_deadline_cancels_a_model_call_and_reports_what_was_read(self):
        async def slow():
            await asyncio.sleep(5)
        model = Scripted([call("get_alarms"), say("late")], hooks={1: slow})
        t0 = time.perf_counter()
        reply = plan(model, deadline=ctx_mod.Deadline(0.3))
        self.assertLess(time.perf_counter() - t0, 3)
        self.assertEqual((reply.get("partial"), reply["route"]), (True, "llm_planner"))
        self.assertIn("time limit", reply["answer"])

    def test_the_deadline_with_nothing_read_is_a_timeout_reply(self):
        async def slow():
            await asyncio.sleep(5)
        reply = plan(Scripted([say("late")], hooks={0: slow}), deadline=ctx_mod.Deadline(0.2))
        self.assertEqual(reply["route"], "timeout")
        self.assertEqual(reply["tool_calls"], [])

    def test_no_tool_starts_after_the_deadline(self):
        ran = []
        deadline = ctx_mod.Deadline(60)

        def expire():
            deadline.t0 -= 120
        real = eko_chat.run_tool
        with mock.patch.object(eko_chat, "run_tool", lambda n, a, v: (ran.append(n), real(n, a, v))[1]):
            model = Scripted([calls(("get_alarms", {}), ("get_capabilities", {})), say("x")])
            first = model.complete

            async def complete(messages, tools):
                out = await first(messages, tools)
                expire()
                return out
            model.complete = complete
            reply = plan(model, deadline=deadline)
        self.assertEqual(ran, [])
        self.assertEqual(reply["route"], "timeout")


class ProjectScopeTests(unittest.TestCase):
    def test_every_tool_call_runs_on_the_requests_own_project_and_a_change_abandons_it(self):
        ran = []
        real = eko_chat.run_tool

        def spy(name, args, view):
            ran.append((name, view.project_name))
            return real(name, args, view)
        state = {"calls": 0}

        def view_fn():
            state["calls"] += 1
            if state["calls"] == 2:
                raise ctx_mod.ProjectChanged()
            return make_view()
        with mock.patch.object(eko_chat, "run_tool", spy):
            model = Scripted([calls(("get_alarms", {}), ("get_capabilities", {})), say("x")])
            with self.assertRaises(ctx_mod.ProjectChanged):
                plan(model, view_fn=view_fn)
        self.assertEqual(ran, [("get_alarms", "ekoHospital")])                      # the second call never ran, on any project

    def test_a_session_that_ended_between_steps_is_reported_as_that_not_as_a_project_change(self):
        state = {"n": 0}

        def view_fn():
            state["n"] += 1
            if state["n"] == 2:
                raise ctx_mod.ProjectChanged("session_expired", "ended", 401)
            return make_view()
        with self.assertRaises(ctx_mod.ProjectChanged) as ctx:
            plan(Scripted([calls(("get_alarms", {}), ("get_capabilities", {})), say("x")]), view_fn=view_fn)
        self.assertEqual((ctx.exception.code, ctx.exception.status), ("session_expired", 401))

    def test_two_projects_are_planned_from_their_own_data_only(self):
        hospital = make_view(items=[eq("AHU-H1", [pt("Room Humidity", "61%", "%")])])
        marsa = make_view(project=("proj-m", "marsaAlArab"), items=[eq("AHU-M1", [pt("Room Humidity", "35%", "%")])])
        script = lambda: Scripted([call("calculate_metric", metric="humidity", op="max"), say("The highest humidity is 35 %.")])      # noqa: E731
        self.assertEqual(plan(script(), "highest humidity, explained", hospital)["answer_source"], "code")     # 35 is not Hospital data
        self.assertEqual(plan(script(), "highest humidity, explained", marsa)["answer_source"], "llm")


class ShapeTests(unittest.TestCase):
    def test_what_the_model_sees_is_what_the_answer_is_checked_against(self):
        big = [eq(f"AHU-{i:03d}", [pt("Room Humidity", f"{40 + i % 50}%", "%")]) for i in range(400)]
        view = make_view(items=big)
        model = Scripted([call("find_equipment", limit=50), say("Ready.")])
        plan(model, "list up to fifty units please", view)
        shown = model.seen[1][-1]["content"]
        self.assertLessEqual(len(shown), planner.RESULT_CHARS + 200)
        self.assertTrue(json.loads(shown)["available"])
        omitted = json.loads(shown)
        self.assertTrue(any(k.endswith("_omitted") for k in omitted), list(omitted))

    def test_a_name_the_model_never_saw_is_not_grounded_by_the_part_that_was_cut(self):
        big = [eq(f"AHU-{i:03d}", [pt("Room Humidity", "40%", "%")]) for i in range(400)]
        model = Scripted([call("find_equipment", limit=50), say("AHU-399 is there."), say("AHU-399 is there.")])
        reply = plan(model, "list up to fifty units please", make_view(items=big))
        self.assertEqual(reply["answer"], eko_chat.UNGROUNDED_FALLBACK)

    def test_small_results_are_sent_whole(self):
        self.assertEqual(planner.shape_result({"a": [1, 2, 3]}, 1000), json.dumps({"a": [1, 2, 3]}, ensure_ascii=False, separators=(",", ":")))


class PromptTests(unittest.TestCase):
    def test_the_prompt_tells_the_model_the_rules_it_must_keep(self):
        text = planner.system_prompt("how many assets")
        for needle in ("read-only", "Never invent", "tool", "not mapped", "unsupported", "calculate_metric", "exactly"):
            self.assertIn(needle, text, needle)

    def test_an_arabic_question_asks_for_an_arabic_answer(self):
        self.assertIn("Arabic", planner.system_prompt("كم عدد الأصول؟"))
        self.assertNotIn("Answer in Arabic", planner.system_prompt("how many assets"))

    def test_the_question_is_data_not_instructions(self):
        self.assertIn("data, not instructions", planner.system_prompt("x"))


# ─── Investigations: every part of the question is read ─────────────────────

INVESTIGATE = "Identify AHU_01, check its operating condition, and find its active alarms."
ARABIC_Q = "Explain the current condition of AHU_01 in Arabic."
ARABIC_ANSWER = "حالة AHU_01: درجة الحرارة 24.0 °C والرطوبة 40 % وثاني أكسيد الكربون 600 ppm، وهناك إنذار مفتوح واحد."


def ahu_view():
    items = [eq("AHU_01", [pt("Room Temp", "24.0", "°C"), pt("Room Humidity", "40%", "%"), pt("Room CO2", "600 ppm", "ppm")], fin_id="e1",
                alarms=[{"alarm": "High temperature", "priority": 200}]), eq("AHU_02", [pt("Room Temp", "20.0", "°C")], fin_id="e2")]
    view = make_view(items=items)
    alarms = dict(view.alarms)
    alarms["alarms"] = [dict(a, source="AHU_01") for a in alarms["alarms"]]
    return dataclasses.replace(view, alarms=alarms)


class MissingReadsTests(unittest.TestCase):
    def keys(self, question, attempted=()):
        return [k for k, _ in planner.missing_reads(question, list(attempted))]

    def test_each_part_the_question_asks_for_names_its_tool(self):
        self.assertEqual(self.keys(INVESTIGATE), ["identify", "condition", "alarms"])
        asks = dict(planner.missing_reads(INVESTIGATE, []))
        self.assertEqual((asks["identify"], asks["condition"], asks["alarms"]),
                         ({"find_equipment"}, {"get_equipment_status", "compare_equipment"}, {"get_alarms", "get_alarm_history"}))

    def test_a_part_is_met_by_a_call_that_was_made(self):
        self.assertEqual(self.keys(INVESTIGATE, ["get_equipment_status"]), ["identify", "alarms"])
        self.assertEqual(self.keys(INVESTIGATE, ["find_equipment", "get_equipment_status", "get_alarms"]), [])
        self.assertEqual(self.keys(INVESTIGATE, ["get_equipment_status", "get_alarm_history", "find_equipment"]), [])

    def test_the_status_of_the_equipment_does_not_stand_in_for_its_alarms(self):
        self.assertIn("alarms", self.keys("Show me the alarms of AHU_01 and its status", ["get_equipment_status"]))

    def test_a_named_item_always_needs_some_read(self):
        self.assertEqual(self.keys(ARABIC_Q), ["condition"])
        self.assertEqual(self.keys("Tell me about AHU_01 in Arabic"), ["any"])
        self.assertEqual(self.keys("Tell me about AHU_01 in Arabic", ["get_alarms"]), [])

    def test_a_question_that_names_no_equipment_asks_only_for_what_it_says(self):
        self.assertEqual(self.keys("what is the status of the building"), [])         # the building's overview, not an item's condition
        self.assertEqual(self.keys("explain the alarms in detail"), ["alarms"])
        self.assertEqual(self.keys("explain the alarms in detail", ["get_building_snapshot"]), [])
        for q in ("hello there my friend", "how is it doing", "", "what can you do"):
            self.assertEqual(self.keys(q), [], q)

    def test_arabic_words_count(self):
        self.assertEqual(self.keys("ما هي الإنذارات المفتوحة على AHU_01؟"), ["alarms"])
        self.assertEqual(self.keys("اشرح حالة AHU_01"), ["condition"])


class InvestigationLoopTests(unittest.TestCase):
    def test_a_model_that_reads_only_one_part_is_asked_once_for_the_others(self):
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), say("AHU_01 reports 3 points."),
                          calls(("find_equipment", {"name": "AHU_01"}), ("get_alarms", {})),
                          say("AHU_01 is an ahu on L1; its condition: 3 points reporting; active alarms: 1 critical High temperature.")])
        reply = plan(model, INVESTIGATE, ahu_view())
        self.assertEqual(tools_of(reply), ["get_equipment_status", "find_equipment", "get_alarms"])
        self.assertTrue(all(t["available"] for t in reply["tool_calls"]), reply["tool_calls"])
        self.assertEqual((reply["answer_source"], reply["route"]), ("llm", "llm_planner"))
        nudge = model.seen[2][-1]
        self.assertEqual(nudge["role"], "user")
        self.assertIn("identify the equipment", nudge["content"])
        self.assertIn("find_equipment", nudge["content"])
        self.assertIn("get_alarms", nudge["content"])
        self.assertNotIn("operating condition", nudge["content"])                   # that part was read
        self.assertEqual(len(model.seen), 4)

    def test_the_results_of_all_three_reads_go_back_to_the_model_before_its_final_answer(self):
        model = Scripted([calls(("find_equipment", {"name": "AHU_01"}), ("get_equipment_status", {"equipment": "AHU_01"}), ("get_alarms", {})),
                          say("AHU_01 is an ahu on L1 with 3 of 3 points reporting and 1 critical High temperature alarm.")])
        reply = plan(model, INVESTIGATE, ahu_view())
        self.assertEqual(len(model.seen), 2)                                       # nothing was missing: no extra step
        back = [json.loads(m["content"]) for m in model.seen[1] if m["role"] == "tool"]
        self.assertEqual(len(back), 3)
        self.assertTrue(all(b["available"] for b in back))
        self.assertEqual(tools_of(reply), ["find_equipment", "get_equipment_status", "get_alarms"])

    def test_one_nudge_does_not_use_up_a_round(self):
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), say("Done."), calls(("find_equipment", {"name": "AHU_01"}), ("get_alarms", {})),
                          say("AHU_01 has 1 alarm.")])
        reply = plan(model, INVESTIGATE, ahu_view(), cfg=dict(CFG, planner={"max_rounds": 3}))
        self.assertEqual((reply.get("partial"), reply["answer_source"], len(model.seen)), (None, "llm", 4))

    def test_a_part_still_not_read_after_the_nudge_is_said_not_hidden(self):
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), say("AHU_01 reports 3 points."), say("AHU_01 reports 3 points.")])
        reply = plan(model, INVESTIGATE, ahu_view())
        self.assertEqual(len(model.seen), 3)                                       # one nudge, not a loop
        self.assertTrue(reply["answer"].startswith("AHU_01 reports 3 points."))
        self.assertIn("Not checked:", reply["answer"])
        self.assertIn("identify the equipment", reply["answer"])
        self.assertIn("the alarms", reply["answer"])
        self.assertNotIn("operating condition", reply["answer"].split("Not checked:")[1])
        self.assertNotIn("get_alarms", reply["answer"])                            # no tool name reaches the user

    def test_an_answer_written_without_reading_anything_is_never_shown(self):
        model = Scripted([say("AHU_01 is in an abnormal state with open alarms."), say("AHU_01 is in an abnormal state with open alarms.")])
        reply = plan(model, INVESTIGATE, ahu_view())
        self.assertEqual((reply["tool_calls"], reply["answer_source"], reply["route"]), ([], "code", "llm_planner"))
        self.assertNotIn("abnormal", reply["answer"])
        self.assertIn("could not read", reply["answer"])
        self.assertEqual(len(model.seen), 2)

    def test_the_model_may_read_after_the_nudge_and_then_answer(self):
        model = Scripted([say("AHU_01 is fine."), calls(("find_equipment", {"name": "AHU_01"}), ("get_equipment_status", {"equipment": "AHU_01"}), ("get_alarms", {})),
                          say("AHU_01 is an ahu with 3 of 3 points reporting and 1 critical alarm.")])
        reply = plan(model, INVESTIGATE, ahu_view())
        self.assertEqual((reply["answer_source"], len(reply["tool_calls"])), ("llm", 3))

    def test_a_read_that_failed_still_counts_as_read_and_is_reported_not_nudged(self):
        stale = make_view(equipment={"timestamp": iso(30), "equipment": [eq("AHU_01")]})
        model = Scripted([calls(("find_equipment", {"name": "AHU_01"}), ("get_equipment_status", {"equipment": "AHU_01"}), ("get_alarms", {})), say("Nothing to report.")])
        reply = plan(model, INVESTIGATE, stale)
        self.assertEqual(len(model.seen), 2)
        self.assertIn("Not available:", reply["answer"])

    def test_a_call_the_schema_refused_does_not_count_as_a_read(self):
        model = Scripted([call("get_alarms", severity="urgent"), say("No alarms."), say("No alarms.")])
        reply = plan(model, "explain the alarms in detail", ahu_view())
        self.assertEqual((reply["answer_source"], reply["tool_calls"][0]["reason"]), ("code", "invalid_arguments"))
        self.assertNotIn("No alarms", reply["answer"])                              # nothing was read: the model's claim is not shown
        self.assertIn("could not read", reply["answer"])

    def test_the_prompt_says_to_read_each_part_and_that_no_tool_stands_in_for_another(self):
        text = planner.system_prompt(INVESTIGATE)
        for needle in ("find_equipment", "get_equipment_status", "get_alarms", "separate tool", "not a substitute", "never whether"):
            self.assertIn(needle, text, needle)


class ArabicTests(unittest.TestCase):
    def test_an_arabic_request_is_found_in_english_and_in_arabic(self):
        for q in (ARABIC_Q, "answer in arabic please", "Explain AHU_01 بالعربي", "اشرح حالة AHU_01", "باللغة العربية من فضلك", "كم عدد الأصول؟"):
            self.assertTrue(planner.wants_arabic(q), q)
        for q in ("Explain the condition of AHU_01", "status of Marsa Al Arab", "", None):
            self.assertFalse(planner.wants_arabic(q), q)

    def test_the_prompt_asks_for_a_whole_answer_in_arabic_for_every_such_request(self):
        for q in (ARABIC_Q, "اشرح حالة AHU_01"):
            text = planner.system_prompt(q)
            self.assertIn("ENTIRE answer in Arabic", text, q)
            self.assertIn("equipment IDs", text)
        self.assertNotIn("in Arabic", planner.system_prompt("Explain the condition of AHU_01"))

    def test_an_english_answer_to_an_arabic_request_is_refused_once(self):
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), say("AHU_01 is running normally and has one open alarm today."), say(ARABIC_ANSWER)])
        reply = plan(model, ARABIC_Q, ahu_view())
        self.assertEqual((reply["answer_source"], reply["answer"]), ("llm", ARABIC_ANSWER))
        self.assertIn("language", model.seen[2][-1]["content"])
        self.assertIn("Arabic", model.seen[2][-1]["content"])

    def test_an_answer_that_stays_in_english_is_replaced_by_an_arabic_notice(self):
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), say("AHU_01 is running normally and has one open alarm today."),
                          say("AHU_01 is running normally and has one open alarm today.")])
        reply = plan(model, ARABIC_Q, ahu_view())
        self.assertEqual(reply["answer_source"], "code")
        self.assertTrue(planner._ARABIC.search(reply["answer"]))
        self.assertNotIn("running normally", reply["answer"])
        self.assertNotEqual(reply["answer"], eko_chat.UNGROUNDED_FALLBACK)

    def test_ids_abbreviations_units_numbers_and_words_from_the_results_stay_as_they_are(self):
        ok = "الوحدة AHU_01 (نوع ahu): الحرارة 24.0 °C، الرطوبة 40 %، CO2 600 ppm، والإنذار المفتوح: High temperature."
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), say(ok)])
        reply = plan(model, ARABIC_Q, ahu_view())
        self.assertEqual((reply["answer_source"], reply["answer"]), ("llm", ok))
        self.assertEqual(planner.english_words("AHU_01 FCU-02 CO2 ppm kWh °C", [], ""), [])

    def test_a_changed_equipment_id_is_refused_in_arabic_too(self):
        bad = "حالة AHU_10: الحرارة 24.0 °C."
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), say(bad), say(bad)])
        self.assertEqual(plan(model, ARABIC_Q, ahu_view())["answer_source"], "code")

    def test_what_the_code_adds_is_arabic_for_an_arabic_request(self):
        model = Scripted([call("get_environment", metric="iaq"), say("لم أجد المؤشر.")])
        reply = plan(model, "اشرح مؤشر جودة الهواء")
        self.assertIn("غير متاح:", reply["answer"])
        self.assertIn("iaq_index", reply["answer"])
        self.assertNotIn("no live point", reply["answer"])
        stale = make_view(equipment={"timestamp": iso(30), "equipment": fleet()})
        reply = plan(Scripted([call("search_points", metric="co2"), say("لا شيء.")]), "ابحث عن حساسات CO2 بالعربي", stale)
        self.assertIn("قديمة", reply["answer"])
        self.assertFalse(planner.english_words(reply["answer"].split("غير متاح:")[1], [], ""), reply["answer"])

    def test_nothing_after_the_model_changes_the_language_or_the_text(self):
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), say(ARABIC_ANSWER)])
        reply = plan(model, ARABIC_Q, ahu_view())
        self.assertEqual(reply["answer"], ARABIC_ANSWER)                          # no footer, no translation, no rewrite
        self.assertEqual(planner.finalize(ARABIC_ANSWER, [], ARABIC_Q, []), ARABIC_ANSWER)

    def test_a_unit_the_model_wrote_as_an_arabic_word_is_written_as_the_data_writes_it(self):
        said = "الرطوبة 40% والحرارة 24.0°م وثاني أكسيد الكربون 600 جزء في المليون وهناك 3 درجة مئوية و 2.5 كيلوواط ساعة و 4 كيلو واط."
        fixed = planner.finalize(said, [], ARABIC_Q, [])
        self.assertEqual(fixed, "الرطوبة 40% والحرارة 24.0°C وثاني أكسيد الكربون 600 ppm وهناك 3 °C و 2.5 kWh و 4 kW.")
        self.assertEqual(planner.finalize("الحرارة 24.0°س", [], ARABIC_Q, []), "الحرارة 24.0°C")
        for same in ("الرطوبة 40% والحرارة 24.0 °C و 600 ppm", "°مع", "المنزل", "درجة الحرارة"):
            self.assertEqual(planner.finalize(same, [], ARABIC_Q, []), same, same)         # words that only look like one are left alone

    def test_the_unit_rule_runs_only_for_an_arabic_request_and_never_touches_ids(self):
        said = "AHU_01 600 جزء في المليون"
        self.assertEqual(planner.finalize(said, [], "Explain AHU_01", []), said)
        self.assertEqual(planner.finalize("AHU_01 600 جزء في المليون", [], ARABIC_Q, []), "AHU_01 600 ppm")

    def test_the_whole_answer_is_otherwise_the_models_own_when_a_unit_is_fixed(self):
        said = "حالة AHU_01: الحرارة 24.0 °م والرطوبة 40 % وثاني أكسيد الكربون 600 جزء في المليون."
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), say(said)])
        reply = plan(model, ARABIC_Q, ahu_view())
        self.assertEqual((reply["answer_source"], reply["answer"]), ("llm", "حالة AHU_01: الحرارة 24.0 °C والرطوبة 40 % وثاني أكسيد الكربون 600 ppm."))

    def test_an_english_request_is_not_held_to_arabic(self):
        model = Scripted([call("get_equipment_status", equipment="AHU_01"), say("AHU_01 has 3 of 3 points reporting.")])
        self.assertEqual(plan(model, "Explain the current condition of AHU_01", ahu_view())["answer_source"], "llm")


# ─── Through the endpoint ────────────────────────────────────────────────────

class PlannerEndpoint(ProjectChatBase):
    def setUp(self):
        super().setUp()
        eko_chat_llm.BREAKER["until"] = 0.0
        self.addCleanup(lambda: eko_chat_llm.BREAKER.update(until=0.0))
        self.addCleanup(self.http.cookies.clear)

    def start(self, settings=HOSPITAL, project_id=HOSPITAL_ID, items=None, **chat):
        self.frozen(settings, project_id, cached_equip_data={"timestamp": datetime.now().isoformat(), "equipment": items or fleet()})
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = {**DEFAULT_CHAT, "provider": "ollama", "model": "qwen3:8b", "planner": {"max_rounds": 4}, **chat}

    def model(self, replies, hooks=None):
        m = Scripted(replies, hooks)
        patch = mock.patch.object(planner, "OllamaPlannerAdapter", lambda c: m)
        patch.start()
        self.addCleanup(patch.stop)
        return m

    def test_a_question_the_rules_know_is_answered_without_the_model(self):
        self.start()
        m = self.model([say("never")])
        body = self.ok("how many assets are there")
        self.assertEqual((body["route"], m.seen), ("direct", []))

    def test_a_question_only_the_planner_understands_is_planned_run_and_explained(self):
        self.start()
        m = self.model([calls(("search_points", {"metric": "co2", "type": "ahu"}), ("get_alarms", {"severity": "critical"})),
                        say("Both AHUs report CO2, and AHU-01 has 1 critical alarm.")])
        body = self.ok(QUESTION)
        self.assertEqual((body["route"], body["answer_source"], body["model"]), ("llm_planner", "llm", "qwen3:8b"))
        self.assertEqual(body["answer"], "Both AHUs report CO2, and AHU-01 has 1 critical alarm.")
        self.assertEqual([t["name"] for t in body["tool_calls"]], ["search_points", "get_alarms"])
        self.assertEqual(body["project"], {"id": HOSPITAL_ID, "name": "ekoHospital"})
        self.assertEqual(body["card"]["tool"], "get_alarms")
        self.assertEqual(len(m.seen), 2)

    def test_the_stream_carries_the_tools_and_the_final_answer(self):
        self.start()
        self.model([call("get_alarms", severity="critical"), say("AHU-01 has 1 critical alarm.")])
        events = parse_sse(self.ask(QUESTION, stream=True).text)
        names = [e for e, _ in events]
        self.assertEqual((names[0], names[-1]), ("start", "done"))
        done = events[-1][1]
        self.assertEqual((done["answer"], done["answer_source"], done["route"]), ("AHU-01 has 1 critical alarm.", "llm", "llm_planner"))
        self.assertIn({"tool": "get_alarms", "status": "completed"}, [d for e, d in events if e == "tool"])

    def test_a_message_with_a_part_no_rule_knows_goes_to_the_planner_whole(self):
        self.start()
        m = self.model([calls(("get_alarms", {"severity": "critical"}), ("find_equipment", {})), say("There is 1 critical alarm, and the equipment total is 3.")])
        body = self.ok("how many assets are there and explain the critical alarm situation in detail")
        self.assertEqual((body["route"], len(m.seen)), ("llm_planner", 2))
        self.assertNotIn("needs_planner", json.dumps(body))
        self.assertEqual([t["name"] for t in body["tool_calls"]], ["get_alarms", "find_equipment"])

    def test_a_message_whose_parts_all_have_rules_is_still_answered_by_them(self):
        self.start()
        m = self.model([say("never")])
        body = self.ok("how many assets are there and how many AHUs are in alarm")
        self.assertEqual((body["route"], m.seen), ("multi", []))

    def test_a_write_or_unsupported_request_is_refused_by_code_before_any_model_call(self):
        self.start()
        m = self.model([say("Sure, I turned it off.")])
        for q in ("turn off AHU-01", "please change the theme to dark mode", "set the setpoint of AHU-01 to 22", "average temperature last week"):
            with self.subTest(q):
                body = self.ok(q)
                self.assertEqual(body["route"], "unsupported", body)
                self.assertEqual(body["tool_calls"][0]["name"], "get_capabilities")
        self.assertEqual(m.seen, [])

    def test_a_compound_message_with_a_write_in_it_still_reaches_the_planner_which_has_no_write_tool(self):
        self.start()
        m = self.model([call("get_alarms"), say("1 critical alarm is open. I cannot change anything.")])
        body = self.ok("explain the open alarms in detail and also switch AHU-01 off")
        self.assertEqual(body["route"], "llm_planner")
        self.assertEqual([t["name"] for t in body["tool_calls"]], ["get_alarms"])

    def test_a_model_that_is_down_leaves_the_rules_working(self):
        self.start()
        self.model([eko_chat.LLMError("llm_unavailable", "x", 502)])
        r = self.ask(QUESTION)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["answer"].startswith(eko_chat_llm.LLM_DOWN))
        self.assertIn("Equipment items: 3.", self.ok("how many assets do we have")["answer"])

    def test_the_old_one_intent_path_is_still_there_when_the_planner_is_off(self):
        self.start(planner=False)
        m = self.model([say("never")])
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock(return_value={
                "content": json.dumps({"intent": "get_environment", "metric": "humidity"}), "usage": {}})) as gen:
            body = self.ok("tell me about the moisture situation in detail")
        self.assertEqual((body["route"], m.seen), ("llm_intent", []))
        gen.assert_awaited_once()

    def test_a_project_switch_during_planning_abandons_the_request_and_shows_nothing(self):
        self.start()

        def switch():
            main.PROJECT_NAME = "someOtherProject"
        self.addCleanup(lambda: setattr(main, "PROJECT_NAME", "ekoHospital"))
        m = self.model([call("get_alarms"), say("AHU-01 has 1 critical alarm.")], hooks={1: switch})
        r = self.ask(QUESTION)
        self.assertEqual(r.status_code, 409, r.text)
        self.assertEqual(r.json()["detail"]["error"], "project_changed")
        self.assertNotIn("AHU-01", r.text)
        self.assertEqual(len(m.seen), 2)

    def test_a_session_that_ends_during_planning_is_a_401_and_shows_nothing(self):
        self.start()
        m = self.model([call("get_alarms"), say("AHU-01 has 1 critical alarm.")], hooks={1: lambda: main.SESSIONS.clear()})
        r = self.ask(QUESTION)
        self.assertEqual(r.status_code, 401, r.text)
        self.assertNotIn("AHU-01", r.text)

    def test_without_a_session_the_model_is_never_called(self):
        self.start()
        m = self.model([say("never")])
        self.http.cookies.clear()
        self.assertEqual(self.ask(QUESTION).status_code, 401)
        self.assertEqual(m.seen, [])

    def test_a_wrong_project_header_is_refused_before_the_model(self):
        self.start()
        m = self.model([say("never")])
        r = self.http.post("/api/chat", json={"message": QUESTION}, headers={"X-Eko-Project": MARSA_ID})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(m.seen, [])

    def test_the_planner_reads_the_open_projects_data_not_another(self):
        self.start()
        self.model([call("calculate_metric", metric="humidity", op="max"), say("The highest humidity is 50 %, on AHU-02.")])
        body = self.ok("what is the peak moisture in detail, explained")
        self.assertEqual((body["answer_source"], body["project"]["name"]), ("llm", "ekoHospital"))

    def test_an_arabic_question_is_planned_and_answered_in_arabic(self):
        self.start()
        m = self.model([call("get_alarms"), say("يوجد إنذار حرج واحد مفتوح على AHU-01.")])
        body = self.ok("اشرح لي حالة الإنذارات المفتوحة بالتفصيل")
        self.assertEqual((body["route"], body["answer_source"]), ("llm_planner", "llm"))
        self.assertIn("Arabic", m.seen[0][0]["content"])

    def test_the_investigation_question_reads_all_three_parts_and_answers_once(self):
        self.start(items=ahu_view().equipment["equipment"])
        m = self.model([call("get_equipment_status", equipment="AHU_01"), say("AHU_01 reports 3 points."),
                        calls(("find_equipment", {"name": "AHU_01"}), ("get_alarms", {"equipment": "AHU_01"})),
                        say("AHU_01 is an ahu on L1 with 3 of 3 points reporting; its alarm list was read.")])
        body = self.ok(INVESTIGATE)
        self.assertEqual([t["name"] for t in body["tool_calls"]], ["get_equipment_status", "find_equipment", "get_alarms"])
        self.assertEqual((body["route"], body["answer_source"]), ("llm_planner", "llm"))
        self.assertTrue(all(t["available"] for t in body["tool_calls"]), body["tool_calls"])
        self.assertEqual(len(m.seen), 4)
        self.assertEqual(body["project"], {"id": HOSPITAL_ID, "name": "ekoHospital"})

    def test_the_arabic_request_is_answered_from_the_equipments_own_data_in_arabic(self):
        self.start(items=ahu_view().equipment["equipment"])
        m = self.model([say("AHU_01 is running normally."), call("get_equipment_status", equipment="AHU_01"), say(ARABIC_ANSWER)])
        body = self.ok(ARABIC_Q)
        self.assertEqual([t["name"] for t in body["tool_calls"]], ["get_equipment_status"])
        self.assertEqual((body["answer"], body["answer_source"]), (ARABIC_ANSWER, "llm"))
        self.assertIn("ENTIRE answer in Arabic", m.seen[0][0]["content"])           # the request was recognised although the question is in English
        self.assertNotIn("running normally", body["answer"])

    def test_an_arabic_answer_written_without_reading_is_not_shown_through_the_endpoint(self):
        self.start(items=ahu_view().equipment["equipment"])
        self.model([say("الوحدة AHU_01 في حالة غير طبيعية."), say("الوحدة AHU_01 في حالة غير طبيعية.")])
        body = self.ok(ARABIC_Q)
        self.assertEqual((body["tool_calls"], body["answer_source"]), ([], "code"))
        self.assertNotIn("غير طبيعية", body["answer"])

    def test_the_diagnostics_line_says_the_planner_answered(self):
        self.start()
        self.model([call("get_alarms"), say("1 critical alarm is open.")])
        with mock.patch("builtins.print") as out:
            self.ok(QUESTION)
        lines = " ".join(str(c.args[0]) for c in out.call_args_list if c.args)
        self.assertIn("handler=planner", lines)
        self.assertIn("mode=LLM_USED", lines)
        self.assertNotIn("AHU-01", lines)


if __name__ == "__main__":
    unittest.main()
