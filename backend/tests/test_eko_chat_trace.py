"""Eko-Chat call diagnostics: LLM_CALL_STARTED / LLM_CALL_COMPLETED / CHAT_RESULT, and the RULES_ONLY / LLM_USED / LLM_FALLBACK modes.

Run from backend/:   python -m unittest tests.test_eko_chat_trace
The lines are read from the server's standard output while real requests run against the real endpoint (fake FIN, throwaway notification
database). The language model is a mock that records its calls; nothing here reaches a model server. Routing is not under test here (the other
suites are): these tests only check that what is logged is true, and that nothing secret is.
"""
import contextlib
import io
import json
import os
import re
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_llm  # noqa: E402
import eko_chat_trace as trace_mod  # noqa: E402
import main  # noqa: E402
from chat_support import parse_sse  # noqa: E402
from test_eko_chat_projects import DEFAULT_CHAT, HOSPITAL, HOSPITAL_ID, ProjectChatBase  # noqa: E402

MODEL = "qwen3.5:4b"


def parse(line):
    """'[eko-chat] CHAT_RESULT mode=RULES_ONLY ...' -> ('CHAT_RESULT', {'mode': 'RULES_ONLY', ...})"""
    body = line[len("[eko-chat] "):].split()
    return body[0], dict(p.split("=", 1) for p in body[1:])


class TraceBase(ProjectChatBase):
    def setUp(self):
        super().setUp()
        eko_chat_llm.BREAKER["until"] = 0.0
        self.addCleanup(lambda: eko_chat_llm.BREAKER.update(until=0.0))
        self.open(HOSPITAL, HOSPITAL_ID)

    def provider(self, provider, **extra):
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT, provider=provider, **extra)

    def logged(self, question, stream=False):
        """(response, [(event, fields), ...]) for one request: only the [eko-chat] lines it wrote."""
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            r = self.ask(question, stream=stream) if stream else self.ask(question)
        lines = [parse(ln) for ln in buf.getvalue().splitlines() if ln.startswith("[eko-chat] ")]
        return r, lines

    @staticmethod
    def result(lines):
        results = [f for e, f in lines if e == "CHAT_RESULT"]
        assert len(results) == 1, f"exactly one CHAT_RESULT per request, got {len(results)}: {lines}"
        return results[0]

    @staticmethod
    def events(lines):
        return [e for e, _ in lines]


def model_says(intent, **kw):
    return mock.AsyncMock(return_value={"content": json.dumps({"intent": intent, **kw}), "usage": {}})


class RulesOnlyTests(TraceBase):
    def test_a_question_the_rules_answer_never_calls_a_model_and_says_why(self):
        for provider in ("rules", "ollama"):
            self.provider(provider, model=MODEL)
            with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock()) as gen:
                for q, rule, tool in (("Read the equipment list.", "equipment.list.read", "find_equipment"),
                                      ("What can you do?", "capabilities.overview", "get_capabilities"),
                                      ("What information is unavailable in this project?", "capabilities.unavailable", "get_capabilities")):
                    with self.subTest(provider=provider, q=q):
                        r, lines = self.logged(q)
                        self.assertEqual(r.status_code, 200)
                        done = self.result(lines)
                        self.assertEqual((done["mode"], done["handler"], done["rule"], done["tool"], done["llm_called"], done["llm_calls"]),
                                         (trace_mod.RULES_ONLY, "rules", rule, tool, "false", "0"))
                        self.assertEqual(done["llm_skipped"], "provider_rules" if provider == "rules" else "rules_matched")
                        skipped = [f for e, f in lines if e == "LLM_CALL_SKIPPED"]
                        self.assertEqual([f["reason"] for f in skipped], [done["llm_skipped"]])
                        self.assertNotIn("LLM_CALL_STARTED", self.events(lines))
            gen.assert_not_awaited()

    def test_a_clarification_and_a_not_supported_answer_are_rules_too(self):
        self.provider("ollama", model=MODEL)
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock()) as gen:
            _, lines = self.logged("What is the current temperature?")
            self.assertEqual((self.result(lines)["mode"], self.result(lines)["handler"]), (trace_mod.RULES_ONLY, "clarification"))
            _, lines = self.logged("What is the outdoor temperature?")
            done = self.result(lines)
            self.assertEqual((done["mode"], done["handler"], done["tool"]), (trace_mod.RULES_ONLY, "topic", "get_capabilities"))
        gen.assert_not_awaited()

    def test_the_provider_rules_help_reply_is_rules_only(self):
        self.provider("rules")
        _, lines = self.logged("tell me a joke")
        done = self.result(lines)
        self.assertEqual((done["mode"], done["handler"], done["provider"], done["model"], done["llm_skipped"]),
                         (trace_mod.RULES_ONLY, "help", "rules", "-", "provider_rules"))

    def test_an_unsafe_question_is_not_sent_to_a_model_and_the_log_says_so(self):
        self.provider("ollama", model=MODEL)
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock()) as gen:
            _, lines = self.logged("select * from alarms; drop table alarms")
        gen.assert_not_awaited()
        done = self.result(lines)
        self.assertEqual((done["mode"], done["llm_skipped"], done["llm_called"]), (trace_mod.RULES_ONLY, "unsafe_or_empty_question", "false"))

    def test_a_streamed_request_logs_the_same_once(self):
        self.provider("ollama", model=MODEL)
        r, lines = self.logged("list equipment", stream=True)
        self.assertEqual(parse_sse(r.text)[-1][0], "done")
        self.assertEqual((self.result(lines)["mode"], self.result(lines)["rule"]), (trace_mod.RULES_ONLY, "equipment.list"))


class LlmUsedTests(TraceBase):
    QUESTION = "how warm is it inside right now"          # no rule knows it

    def test_the_model_reads_the_question_and_picks_a_tool(self):
        self.provider("ollama", model=MODEL)
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", model_says("get_environment", metric="temperature")) as gen:
            r, lines = self.logged(self.QUESTION)
        gen.assert_awaited_once()
        self.assertEqual(r.json()["route"], "llm_intent")
        self.assertEqual(self.events(lines), ["LLM_CALL_STARTED", "LLM_CALL_COMPLETED", "TOOL_RESULT", "CHAT_RESULT"])
        started, completed, tool, done = (f for _, f in lines)
        self.assertEqual((started["stage"], started["provider"], started["model"]), ("interpret", "ollama", MODEL))
        self.assertEqual((completed["provider"], completed["model"], completed["tool_selected"], completed["tool"], completed["outcome"]),
                         ("ollama", MODEL, "yes", "get_environment", "ok"))
        self.assertGreaterEqual(int(completed["ms"]), 0)
        self.assertEqual((tool["tool"], tool["available"], tool["reason"]), ("get_environment", "false", "metric_unavailable"))   # unmapped, and said so
        self.assertEqual((done["mode"], done["handler"], done["tool"], done["rule"], done["llm_called"], done["llm_calls"]),
                         (trace_mod.LLM_USED, "llm_intent", "get_environment", "llm.get_environment", "true", "1"))
        self.assertEqual(done["fallback_reason"], "-")

    def test_the_model_name_logged_is_the_one_in_use(self):
        self.provider("ollama", model="custom-model:7b")
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", model_says("list_equipment")):
            _, lines = self.logged(self.QUESTION)
        self.assertEqual({f["model"] for _, f in lines if "model" in f}, {"custom-model:7b"})
        with mock.patch.dict(os.environ, {"OLLAMA_MODEL": "env-model:3b"}), mock.patch.object(eko_chat_llm.OllamaClient, "generate", model_says("list_equipment")):
            _, lines = self.logged(self.QUESTION)           # the environment wins over config.json, as for the call itself
        self.assertEqual({f["model"] for _, f in lines if "model" in f}, {"env-model:3b"})

    def test_a_streamed_hybrid_request_is_logged_once(self):
        self.provider("ollama", model=MODEL)
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", model_says("list_equipment")):
            r, lines = self.logged(self.QUESTION, stream=True)
        self.assertEqual(parse_sse(r.text)[-1][0], "done")
        self.assertEqual(self.result(lines)["mode"], trace_mod.LLM_USED)
        self.assertEqual(self.events(lines).count("LLM_CALL_STARTED"), 1)

    def test_the_tool_calling_provider_logs_each_model_round_and_the_tools_it_chose(self):
        class Model:
            name, model = "openai_compatible", "gpt-test"

            def __init__(self):
                self.replies = [{"content": None, "tool_calls": [{"id": "1", "name": "find_equipment", "arguments": {}}]},
                                {"content": "There are 3 equipment items.", "tool_calls": []}]

            async def complete(self, messages, tools):
                return self.replies.pop(0)

        for stream in (False, True):
            self.provider("openai_compatible", model="gpt-test")
            with mock.patch.object(eko_chat, "get_adapter", return_value=Model()):
                r, lines = self.logged("pull up the full inventory", stream=stream)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(self.events(lines), ["LLM_CALL_STARTED", "LLM_CALL_COMPLETED", "TOOL_RESULT", "LLM_CALL_STARTED", "LLM_CALL_COMPLETED", "CHAT_RESULT"])
            first, second = [f for e, f in lines if e == "LLM_CALL_COMPLETED"]
            self.assertEqual((first["tool_selected"], first["tool"], second["tool_selected"], second["tool"]), ("yes", "find_equipment", "no", "-"))
            done = self.result(lines)
            self.assertEqual((done["mode"], done["handler"], done["provider"], done["model"], done["llm_calls"]),
                             (trace_mod.LLM_USED, "llm_tools", "openai_compatible", "gpt-test", "2"))


class LlmFallbackTests(TraceBase):
    QUESTION = "how warm is it inside right now"

    def fallback(self, **extra):
        self.provider("ollama", **{"model": MODEL, **extra})

    def test_a_model_that_picks_no_tool_is_a_fallback(self):
        self.fallback()
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", model_says("unsupported")):
            r, lines = self.logged("chchanggechanggfrgr")
        self.assertEqual(r.json()["route"], "unsupported")
        completed = [f for e, f in lines if e == "LLM_CALL_COMPLETED"][0]
        self.assertEqual((completed["tool_selected"], completed["tool"], completed["outcome"]), ("no", "-", "unsupported"))
        done = self.result(lines)
        self.assertEqual((done["mode"], done["handler"], done["fallback_reason"], done["llm_called"]), (trace_mod.LLM_FALLBACK, "help", "model_unsupported", "true"))

    def test_the_topic_reply_after_a_model_that_gave_up_is_still_a_fallback_and_says_who_answered(self):
        self.fallback()
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", model_says("unsupported")):
            _, lines = self.logged("Change to dark mode.")
        done = self.result(lines)
        self.assertEqual((done["mode"], done["handler"], done["tool"], done["fallback_reason"]), (trace_mod.LLM_FALLBACK, "topic", "get_capabilities", "model_unsupported"))

    def test_a_model_that_cannot_be_reached_is_logged_as_failed_and_then_skipped_during_the_cool_down(self):
        self.fallback()
        down = mock.AsyncMock(side_effect=eko_chat.LLMError("llm_unavailable", "down"))
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", down):
            r, lines = self.logged(self.QUESTION)
            self.assertEqual(self.events(lines), ["LLM_CALL_STARTED", "LLM_CALL_FAILED", "CHAT_RESULT"])
            failed = [f for e, f in lines if e == "LLM_CALL_FAILED"][0]
            self.assertEqual((failed["code"], failed["provider"], failed["model"]), ("llm_unavailable", "ollama", MODEL))
            done = self.result(lines)
            self.assertEqual((done["mode"], done["fallback_reason"], done["llm_called"], done["llm_calls"]), (trace_mod.LLM_FALLBACK, "llm_unavailable", "true", "0"))
            _, lines = self.logged(self.QUESTION)             # the breaker is open: the model is not called at all
        self.assertEqual(down.await_count, 1)
        self.assertNotIn("LLM_CALL_STARTED", self.events(lines))
        done = self.result(lines)
        self.assertEqual((done["mode"], done["fallback_reason"], done["llm_called"]), (trace_mod.LLM_FALLBACK, "llm_cooldown", "false"))

    def test_a_timeout_and_a_missing_model_are_named(self):
        self.fallback()
        for code in ("llm_timeout", "llm_model_missing", "llm_http_error"):
            eko_chat_llm.BREAKER["until"] = 0.0
            with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock(side_effect=eko_chat.LLMError(code, "x"))):
                _, lines = self.logged(self.QUESTION)
            self.assertEqual(self.result(lines)["fallback_reason"], code)

    def test_an_answer_that_is_not_json_or_names_no_known_intent_is_a_fallback(self):
        self.fallback()
        for content, reason in (("not json", "llm_invalid_output"), (json.dumps({"intent": "drop_everything"}), "llm_invalid_output"),
                                (json.dumps({"intent": "clarification_required"}), "model_clarification")):
            with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock(return_value={"content": content, "usage": {}})):
                _, lines = self.logged(self.QUESTION)
            done = self.result(lines)
            self.assertEqual((done["mode"], done["fallback_reason"]), (trace_mod.LLM_FALLBACK, reason), content)

    def test_a_model_that_is_not_configured_is_a_fallback_without_a_call(self):
        self.fallback(model="not a valid model name!")
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock()) as gen:
            _, lines = self.logged(self.QUESTION)
        gen.assert_not_awaited()
        done = self.result(lines)
        self.assertEqual((done["mode"], done["fallback_reason"], done["llm_called"]), (trace_mod.LLM_FALLBACK, "llm_not_configured", "false"))
        self.assertEqual(done["model"], "-")                         # an invalid name is never echoed

    def test_the_tool_calling_provider_failing_is_a_fallback(self):
        class Down:
            name, model = "openai_compatible", "gpt-test"

            async def complete(self, messages, tools):
                raise eko_chat.LLMError("llm_unavailable", "down")

        self.provider("openai_compatible", model="gpt-test")
        with mock.patch.object(eko_chat, "get_adapter", return_value=Down()):
            r, lines = self.logged("pull up the full inventory")
        self.assertEqual(r.status_code, 502)
        self.assertEqual(self.events(lines), ["LLM_CALL_STARTED", "LLM_CALL_FAILED", "CHAT_RESULT"])
        done = self.result(lines)
        self.assertEqual((done["mode"], done["handler"], done["fallback_reason"]), (trace_mod.LLM_FALLBACK, "llm_tools", "llm_unavailable"))

    def test_a_provider_that_cannot_be_built_is_a_fallback_without_a_call(self):
        self.provider("openai_compatible", model="gpt-test")
        with mock.patch.object(eko_chat, "get_adapter", return_value=None):
            r, lines = self.logged("pull up the full inventory")
        self.assertEqual(r.status_code, 503)
        done = self.result(lines)
        self.assertEqual((done["mode"], done["fallback_reason"], done["llm_called"]), (trace_mod.LLM_FALLBACK, "llm_not_configured", "false"))


class SafetyTests(TraceBase):
    def test_nothing_secret_or_about_the_project_reaches_the_log(self):
        self.provider("ollama", model=MODEL, base_url="http://user:hunter2@localhost:11434", api_key_env="MY_SECRET_ENV_NAME")
        cookie = self.http.cookies.get(main.SESSION_COOKIE) or "no-cookie-found"
        secret_question = "how warm is it inside right now password=hunter2"
        with mock.patch.dict(os.environ, {"MY_SECRET_ENV_NAME": "sk-TESTSECRET123"}), \
                mock.patch.object(eko_chat_llm.OllamaClient, "generate", model_says("get_environment", metric="temperature")):
            _, ok_lines = self.logged(secret_question)
            _, rule_lines = self.logged("Read the equipment list.")
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock(side_effect=eko_chat.LLMError("llm_unavailable", "down http://user:hunter2@x"))):
            eko_chat_llm.BREAKER["until"] = 0.0
            _, down_lines = self.logged(secret_question)
        text = json.dumps([ok_lines, rule_lines, down_lines])
        for secret in ("hunter2", "sk-TESTSECRET123", "MY_SECRET_ENV_NAME", "user:", "localhost:11434", cookie, "inside", "warm", "password", "equipment list",
                       "EQ-1", "PMU-1", "ekoHospital", "proj-hospital", "10.207.200.85", ":r:", "p:", "avg_zone_temp"):
            self.assertNotIn(secret, text, secret)

    def test_values_are_cut_to_plain_names_and_cannot_forge_a_line(self):
        self.assertEqual(trace_mod._plain("get_environment"), "get_environment")
        self.assertEqual(trace_mod._plain("a,b"), "a,b")
        for bad in ("p:ekoHospital:r:3181ee6e", "two words", "line\n[eko-chat] CHAT_RESULT mode=LLM_USED", "x" * 200, "", None, "a=b", "https://x/y"):
            self.assertEqual(trace_mod._plain(bad), "-", repr(bad))
        self.assertEqual(trace_mod._model("qwen3.5:4b"), "qwen3.5:4b")
        self.assertEqual(trace_mod._model("library/model:7b"), "library/model:7b")
        for bad in ("p:x:r:abc", "bad name", "m\n[eko-chat] x", "x" * 200, "", None, "-p:ekoHospital:r:1"):
            self.assertEqual(trace_mod._model(bad), "-", repr(bad))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            trace_mod.emit("CHAT_RESULT", mode="x\n[eko-chat] CHAT_RESULT mode=LLM_USED", tool="p:abc:r:def")
        self.assertEqual(buf.getvalue().count("\n"), 1)
        self.assertEqual(buf.getvalue().strip(), "[eko-chat] CHAT_RESULT       mode=- tool=-")

    def test_diagnostics_can_be_switched_off_and_the_counters_stay(self):
        self.provider("rules", diagnostics=False)
        before = dict(trace_mod.MODES)
        r, lines = self.logged("list equipment")
        self.assertEqual((r.status_code, lines), (200, []))
        self.assertEqual(trace_mod.MODES[trace_mod.RULES_ONLY], before[trace_mod.RULES_ONLY] + 1)

    def test_a_broken_stdout_does_not_break_a_request(self):
        self.provider("rules")
        with mock.patch("builtins.print", side_effect=OSError("closed")):
            r = self.ask("list equipment")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Equipment items: 3.", r.json()["answer"])

    def test_the_stats_endpoint_counts_the_modes_and_the_calls(self):
        self.provider("ollama", model=MODEL)
        before = self.http.get("/api/chat/stats").json()
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", model_says("list_equipment")):
            self.logged("how warm is it inside right now")
        self.logged("list equipment")
        down = mock.AsyncMock(side_effect=eko_chat.LLMError("llm_unavailable", "down"))
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", down):
            self.logged("how warm is it inside right now")
        after = self.http.get("/api/chat/stats").json()
        delta = lambda key, name: after[key][name] - before[key][name]   # noqa: E731
        self.assertEqual([delta("modes", m) for m in (trace_mod.RULES_ONLY, trace_mod.LLM_USED, trace_mod.LLM_FALLBACK)], [1, 1, 1])
        self.assertEqual([delta("llm_calls", c) for c in ("started", "completed", "failed")], [2, 1, 1])
        self.assertNotIn("how warm", json.dumps(after))
        self.http.cookies.clear()
        self.assertEqual(self.http.get("/api/chat/stats").status_code, 401)           # still behind the same guard


class SameAnswersTests(TraceBase):
    def test_the_answers_are_the_same_with_the_diagnostics_on_or_off(self):
        answers = {}
        for diagnostics in (True, False):
            self.provider("ollama", model=MODEL, diagnostics=diagnostics)
            with mock.patch.object(eko_chat_llm.OllamaClient, "generate", model_says("get_environment", metric="temperature")):
                answers[diagnostics] = [self.ok(q) for q in ("Read the equipment list.", "how warm is it inside right now", "What is the current temperature?")]
        strip = lambda body: {k: v for k, v in body.items() if k != "timestamp"}   # noqa: E731
        self.assertEqual([strip(b) for b in answers[True]], [strip(b) for b in answers[False]])


if __name__ == "__main__":
    unittest.main()
