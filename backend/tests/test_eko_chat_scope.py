"""Eko-Chat Phase 0: the project a request was validated for stays the project it runs on, and the whole request has one deadline.

Run from backend/:   python -m unittest tests.test_eko_chat_scope
The audit found (1) project context rebuilt from the backend's globals at every tool call, so a project switch between two steps of one request
silently mixed two projects; (2) no overall deadline (4 model rounds of 60 s each). Fake FIN, throwaway notification database, scripted models:
nothing here reaches a model server.
"""
import asyncio
import dataclasses
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
import eko_chat_trace as trace_mod  # noqa: E402
import main  # noqa: E402
from chat_support import parse_sse  # noqa: E402
from test_eko_chat_projects import DEFAULT_CHAT, HOSPITAL, HOSPITAL_ID, MARSA, MARSA_ID, ProjectChatBase  # noqa: E402

QUESTION = "pull up the full inventory"                  # no rule knows it: the model path answers


def call(tool, **args):
    return {"content": None, "tool_calls": [{"id": f"c-{tool}", "name": tool, "arguments": args}]}


class Scripted:
    """A model that returns its scripted replies in order; hooks[i]() runs inside the model's i-th call (it may sleep, or switch the project)."""
    name = model = "scripted"

    def __init__(self, replies, hooks=None):
        self.replies, self.hooks, self.calls, self.cancelled = list(replies), hooks or {}, 0, False

    async def complete(self, messages, tools):
        i = self.calls
        self.calls += 1
        hook = self.hooks.get(i)
        if hook is not None:
            try:
                got = hook()
                if asyncio.iscoroutine(got):
                    await got
            except asyncio.CancelledError:
                self.cancelled = True
                raise
        return self.replies[min(i, len(self.replies) - 1)]


def sleeper(seconds):
    async def hook():
        await asyncio.sleep(seconds)
    return hook


class ScopeBase(ProjectChatBase):
    def setUp(self):
        super().setUp()
        eko_chat_llm.BREAKER["until"] = 0.0
        self.addCleanup(lambda: eko_chat_llm.BREAKER.update(until=0.0))
        self.open(HOSPITAL, HOSPITAL_ID)
        self.addCleanup(self.http.cookies.clear)
        self.ran = []                       # (tool, the project name of the view it ran on), in order
        real = eko_chat.run_tool

        def spy(name, args, view):
            self.ran.append((name, view.project_name))
            return real(name, args, view)
        patch = mock.patch.object(eko_chat, "run_tool", spy)
        patch.start()
        self.addCleanup(patch.stop)

    def provider(self, provider="openai_compatible", **extra):
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT, **{"provider": provider, "model": "scripted", **extra})

    def use(self, model):
        patch = mock.patch.object(eko_chat, "get_adapter", return_value=model)
        patch.start()
        self.addCleanup(patch.stop)
        return model

    def switch(self, how):
        """What another user's project switch looks like to a request that is already running."""
        if how == "id":
            main.ACTIVE_PROJECT_ID = "proj-OTHER"
        elif how == "name":
            main.PROJECT_NAME = "otherFin"
        elif how == "site":
            main.client.project_name = "otherFin"
        elif how == "all":
            main.ACTIVE_PROJECT_ID, main.PROJECT_NAME, main.client.project_name = "proj-OTHER", "otherFin", "otherFin"
            main.cached_equip_data = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"), "equipment": [
                {"name": "OTHER-PROJECT-AHU", "floor": "L9", "type": "ahu", "category": "hvac", "tags": [], "inAlarm": False, "alarms": [], "points": []}]}
        elif how == "logout":
            main.SESSIONS.clear()

    def stop_polling(self):
        main._cancel_polling()
        self.http.get("/api/fin/status")


class ContextUnitTests(unittest.TestCase):
    CTX = ctx_mod.ProjectContext(project_id="studio-1", project_name="ekoHospital", user="u", site="ekoHospital")

    def view(self, **kw):
        return eko_chat.DataView(authenticated=kw.pop("authenticated", True), project_id=kw.pop("project_id", "studio-1"),
                                 project_name=kw.pop("project_name", "ekoHospital"), **kw)

    def test_the_context_is_immutable_and_keeps_the_studio_id_apart_from_the_fin_name(self):
        with self.assertRaises(dataclasses.FrozenInstanceError):
            self.CTX.project_name = "marsaAlArab"
        self.assertEqual((self.CTX.project_id, self.CTX.project_name), ("studio-1", "ekoHospital"))
        self.assertNotEqual(self.CTX.project_id, self.CTX.project_name)

    def test_the_pinned_view_carries_the_contexts_own_project_and_scope(self):
        fn = ctx_mod.pinned_view_fn(lambda: self.view(scope=("someone-else", "otherFin")), self.CTX)
        v = fn()
        self.assertEqual((v.project_id, v.project_name, v.scope), ("studio-1", "ekoHospital", ("u", "ekoHospital")))

    def test_every_way_the_live_project_can_differ_is_refused(self):
        for label, view in (("another studio id", self.view(project_id="studio-2")), ("another fin name", self.view(project_name="marsaAlArab")),
                            ("no studio id", self.view(project_id=None)), ("not authenticated", self.view(authenticated=False))):
            with self.subTest(label), self.assertRaises(ctx_mod.ProjectChanged) as caught:
                ctx_mod.pinned_view_fn(lambda v=view: v, self.CTX)()
            self.assertEqual((caught.exception.code, caught.exception.status), ("project_changed", 409))

    def test_the_guard_is_asked_again_before_every_single_view(self):
        asked = []
        fn = ctx_mod.pinned_view_fn(lambda: self.view(), self.CTX, lambda: asked.append(1))
        for _ in range(3):
            fn()
        self.assertEqual(len(asked), 3)

        def refuse():
            raise ctx_mod.ProjectChanged()
        built = []
        with self.assertRaises(ctx_mod.ProjectChanged):
            ctx_mod.pinned_view_fn(lambda: built.append(1) or self.view(), self.CTX, refuse)()
        self.assertEqual(built, [], "no view is built once the guard refuses")

    def test_a_guard_rejection_on_re_check_becomes_the_matching_safe_error(self):
        from fastapi import HTTPException
        for status, error, code, expect in ((401, "session_required", "session_required", 401), (401, "session_expired", "session_expired", 401),
                                            (401, "fin_not_connected", "fin_not_connected", 401), (409, "project_mismatch", "project_changed", 409),
                                            (409, "session_project_mismatch", "project_changed", 409), (403, "project_not_supported", "project_changed", 409)):
            got = ctx_mod.ProjectChanged.from_http(HTTPException(status_code=status, detail={"error": error, "message": "secret detail"}))
            self.assertEqual((got.code, got.status), (code, expect), error)
            self.assertNotIn("secret", got.message)

    def test_the_deadline_comes_from_the_config_and_a_bad_value_never_switches_it_off(self):
        for value, seconds in ((30, 30.0), (1.5, 1.5), (600, 600.0), (0.5, 0.5), (None, 90.0), ("30", 90.0), (True, 90.0), (0, 90.0), (-5, 90.0),
                               (0.1, 90.0), (601, 90.0), (float("inf"), 90.0), ([30], 90.0)):
            self.assertEqual(ctx_mod.Deadline.from_config({"request_deadline_s": value}).seconds, seconds, value)
        self.assertEqual(ctx_mod.Deadline.from_config({}).seconds, 90.0)
        self.assertEqual(ctx_mod.Deadline.from_config(None).seconds, 90.0)

    def test_the_deadline_counts_from_the_requests_arrival(self):
        d = ctx_mod.Deadline(10, t0=time.perf_counter() - 9.5)
        self.assertTrue(0.0 < d.remaining() <= 0.5)
        self.assertFalse(d.expired())
        self.assertTrue(ctx_mod.Deadline(10, t0=time.perf_counter() - 11).expired())

    def test_within_stops_what_runs_past_the_deadline_and_cleans_up(self):
        state = {"cancelled": False, "done": False}

        async def slow():
            try:
                await asyncio.sleep(5)
                state["done"] = True
            except asyncio.CancelledError:
                state["cancelled"] = True
                raise

        async def run():
            started = time.perf_counter()
            with self.assertRaises(ctx_mod.DeadlineExceeded):
                await ctx_mod.within(ctx_mod.Deadline(0.3), slow())
            return time.perf_counter() - started
        took = asyncio.run(run())
        self.assertLess(took, 1.5)
        self.assertEqual(state, {"cancelled": True, "done": False})

    def test_within_does_not_start_work_after_the_deadline_and_passes_results_before_it(self):
        ran = []

        async def work():
            ran.append(1)
            return "ok"

        async def run():
            self.assertEqual(await ctx_mod.within(ctx_mod.Deadline(5), work()), "ok")
            self.assertEqual(await ctx_mod.within(None, work()), "ok")
            with self.assertRaises(ctx_mod.DeadlineExceeded):
                await ctx_mod.within(ctx_mod.Deadline(1, t0=time.perf_counter() - 2), work())
        with warnings_as_errors():
            asyncio.run(run())
        self.assertEqual(len(ran), 2, "the third coroutine was closed, never run")

    def test_a_timeout_of_the_awaitables_own_is_not_renamed_a_deadline(self):
        async def own_timeout():
            raise asyncio.TimeoutError()

        async def run():
            with self.assertRaises(asyncio.TimeoutError):
                await ctx_mod.within(ctx_mod.Deadline(60), own_timeout())
        asyncio.run(run())


class warnings_as_errors:
    """'coroutine was never awaited' must not be hidden."""
    def __enter__(self):
        import warnings
        self._cm = warnings.catch_warnings()
        self._cm.__enter__()
        warnings.simplefilter("error", RuntimeWarning)

    def __exit__(self, *exc):
        return self._cm.__exit__(*exc)


class PinnedProjectTests(ScopeBase):
    def test_a_normal_request_runs_every_step_on_its_own_project(self):
        self.provider()
        self.stop_polling()
        self.use(Scripted([{"content": None, "tool_calls": [{"id": "1", "name": "find_equipment", "arguments": {}},
                                                           {"id": "2", "name": "get_alarms", "arguments": {}}]},
                           {"content": "Three items; one alarm.", "tool_calls": []}]))
        r = self.ask(QUESTION)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["project"], {"id": HOSPITAL_ID, "name": "ekoHospital"})
        self.assertEqual(self.ran, [("find_equipment", "ekoHospital"), ("get_alarms", "ekoHospital")])

    def test_rules_and_the_hybrid_model_answer_for_the_open_project_as_before(self):
        self.provider("ollama", model="m")
        reply = {"content": json.dumps({"intent": "list_equipment"}), "usage": {}}
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", mock.AsyncMock(return_value=reply)):
            for q in ("Read the equipment list.", "how warm is it inside right now"):
                r = self.ask(q)
                self.assertEqual((r.status_code, r.json()["project"]), (200, {"id": HOSPITAL_ID, "name": "ekoHospital"}), q)

    def test_a_project_change_between_two_tool_calls_stops_the_request_and_shows_nothing(self):
        self.provider()
        self.stop_polling()
        model = self.use(Scripted([call("find_equipment"), call("get_alarms"), {"content": "Done.", "tool_calls": []}],
                                  hooks={1: lambda: self.switch("id")}))          # the switch lands while the model decides on the second call
        r = self.ask(QUESTION)
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "project_changed"))
        self.assertEqual([t for t, _ in self.ran], ["find_equipment"], "the second tool never ran")
        self.assertEqual(model.calls, 2, "no third model round was made")
        for key in ("answer", "card"):
            self.assertNotIn(key, r.json())
        self.assertNotIn("Equipment items", r.text)

    def test_each_way_the_project_can_change_is_caught(self):
        for how, status, error in (("id", 409, "project_changed"), ("name", 409, "project_changed"), ("site", 409, "project_changed"),
                                   ("all", 409, "project_changed"), ("logout", 401, "session_required")):
            with self.subTest(how):
                self.open(HOSPITAL, HOSPITAL_ID)          # (a fresh sign-in for each way: the previous one's project was moved)
                self.provider()
                self.stop_polling()
                self.ran.clear()                          # (open() reads the equipment itself, through the same spy)
                self.use(Scripted([call("find_equipment"), call("get_alarms"), {"content": "Done.", "tool_calls": []}], hooks={1: lambda h=how: self.switch(h)}))
                r = self.ask(QUESTION)
                self.assertEqual((r.status_code, r.json()["detail"]["error"]), (status, error), r.text)
                self.assertEqual([t for t, _ in self.ran], ["find_equipment"])

    def test_the_other_projects_data_is_never_read_or_shown_when_the_globals_move(self):
        self.provider()
        self.stop_polling()
        self.use(Scripted([call("find_equipment"), call("find_equipment"), {"content": "Done.", "tool_calls": []}], hooks={1: lambda: self.switch("all")}))
        r = self.ask(QUESTION)
        self.assertEqual(r.status_code, 409)
        self.assertNotIn("OTHER-PROJECT", r.text)
        self.assertNotIn("otherFin", r.text)
        self.assertEqual(self.ran, [("find_equipment", "ekoHospital")])
        self.assertNotIn("otherFin", [p for _, p in self.ran])

    def test_the_streamed_request_ends_with_a_project_changed_event_and_no_answer(self):
        self.provider()
        self.stop_polling()
        self.use(Scripted([call("find_equipment"), call("get_alarms"), {"content": "Done.", "tool_calls": []}], hooks={1: lambda: self.switch("id")}))
        events = parse_sse(self.ask(QUESTION, stream=True).text)
        names = [e for e, _ in events]
        self.assertEqual(names[-1], "error")
        self.assertEqual(events[-1][1]["error"], "project_changed")
        self.assertNotIn("done", names)
        self.assertNotIn("token", names)
        self.assertEqual([t for t, _ in self.ran], ["find_equipment"])

    def test_the_hybrid_model_deciding_while_the_project_changes_is_stopped_before_its_tool_runs(self):
        self.provider("ollama", model="m")

        async def generate(_client, system, user, schema=None):
            self.switch("id")
            return {"content": json.dumps({"intent": "list_equipment"}), "usage": {}}
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", generate):
            r = self.ask("how warm is it inside right now")
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "project_changed"))
        self.assertEqual(self.ran, [])
        self.assertNotIn("Equipment items", r.text)

    def test_the_rules_answer_for_a_request_whose_project_changed_before_they_ran_is_refused(self):
        self.provider("rules")

        def drift(message):
            self.switch("id")                         # the guard and the capture saw the open project; the rules' own read comes after the switch
            return None
        with mock.patch.object(eko_chat, "clarification_reply", drift):
            r = self.ask("Read the equipment list.")
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "project_changed"))

    def test_the_diagnostics_say_the_request_was_stopped_for_the_project(self):
        self.provider()
        self.stop_polling()
        self.use(Scripted([call("find_equipment"), call("get_alarms")], hooks={1: lambda: self.switch("id")}))
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.ask(QUESTION)
        lines = [ln for ln in buf.getvalue().splitlines() if "CHAT_RESULT" in ln]
        self.assertEqual(len(lines), 1)
        self.assertIn("fallback_reason=project_changed", lines[0])
        self.assertNotIn("otherFin", buf.getvalue())

    def test_the_session_and_project_guard_still_rejects_at_the_start(self):
        self.provider()
        q = {"message": QUESTION}
        r = self.http.post("/api/chat", json=q, headers={"X-Eko-Project": "someone-else"})
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "project_mismatch"))
        self.narrowed(["marsaAlArab"])
        r = self.http.post("/api/chat", json=q)
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (403, "project_not_supported"))
        self.provider()
        self.http.cookies.clear()
        r = self.http.post("/api/chat", json=q)
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (401, "session_required"))
        self.assertEqual(self.ran, [])


class DeadlineTests(ScopeBase):
    def test_the_deadline_covers_all_the_model_rounds_not_each_one(self):
        self.provider(request_deadline_s=1.0)
        self.stop_polling()
        model = self.use(Scripted([call("find_equipment"), call("get_alarms"), call("find_equipment", limit=1), {"content": "All done.", "tool_calls": []}],
                                  hooks={i: sleeper(0.4) for i in range(4)}))       # four rounds of 0.4 s: 1.6 s, against a 1.0 s deadline
        started = time.perf_counter()
        r = self.ask(QUESTION)
        took = time.perf_counter() - started
        body = r.json()
        self.assertEqual(r.status_code, 200, r.text)
        self.assertLess(took, 1.6, "stopped at the deadline, not after every round")
        self.assertLess(model.calls, 4, "no round was started that the deadline could not cover")
        self.assertTrue(body["partial"])
        self.assertTrue(body["answer"].startswith("This answer is incomplete: the time limit of 1 seconds was reached."), body["answer"])
        self.assertNotIn("All done", body["answer"])

    def test_what_the_tools_had_read_is_kept_and_said_by_code(self):
        self.provider(request_deadline_s=0.8)
        self.stop_polling()
        self.use(Scripted([call("find_equipment"), {"content": "never written", "tool_calls": []}], hooks={1: sleeper(10)}))
        r = self.ask(QUESTION)
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertIn("Equipment items: 3.", body["answer"])                     # the verified tool result, in the code's words
        self.assertEqual([(t["name"], t["available"]) for t in body["tool_calls"]], [("find_equipment", True)])
        self.assertEqual(body["card"]["tool"], "find_equipment")
        self.assertEqual((body["grounded"], body["partial"]), (True, True))
        self.assertNotIn("never written", r.text)
        self.assertEqual(body["project"], {"id": HOSPITAL_ID, "name": "ekoHospital"})

    def test_a_model_call_that_hangs_is_cancelled_and_nothing_is_made_up(self):
        self.provider(request_deadline_s=0.6)
        model = self.use(Scripted([{"content": "never", "tool_calls": []}], hooks={0: sleeper(30)}))
        started = time.perf_counter()
        r = self.ask(QUESTION)
        took = time.perf_counter() - started
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (504, "request_timeout"))
        self.assertIn("not answered within 0.6 seconds", r.json()["detail"]["message"])
        self.assertLess(took, 2.5)
        self.assertTrue(model.cancelled, "the model call was cancelled, not left running")
        self.assertEqual(eko_chat.LLM_GATE.active, 0, "its slot was released")
        for key in ("answer", "card", "partial"):
            self.assertNotIn(key, r.json())
        self.assertEqual(self.ran, [])

    def test_tools_that_ran_are_kept_and_the_rest_of_the_round_is_not_run(self):
        self.provider(request_deadline_s=0.6)
        self.stop_polling()
        real = eko_chat.run_tool                     # (the spy of setUp: it records the call)
        seen = []

        def slow_first(name, args, view):
            seen.append(name)
            if len(seen) == 1:
                time.sleep(0.8)                      # the first tool alone uses up the deadline
            return real(name, args, view)
        self.use(Scripted([{"content": None, "tool_calls": [{"id": "1", "name": "find_equipment", "arguments": {}},
                                                           {"id": "2", "name": "get_alarms", "arguments": {}}]},
                           {"content": "never", "tool_calls": []}]))
        with mock.patch.object(eko_chat, "run_tool", slow_first):
            body = self.ask(QUESTION).json()
        self.assertEqual([t for t, _ in self.ran], ["find_equipment"], "the second tool of the round did not run")
        self.assertTrue(body["partial"])
        self.assertIn("Equipment items: 3.", body["answer"])

    def test_a_failed_read_is_never_offered_as_a_partial_result(self):
        self.provider(request_deadline_s=0.6)
        self.stop_polling()
        self.use(Scripted([call("get_environment", metric="iaq"), {"content": "never", "tool_calls": []}], hooks={1: sleeper(10)}))
        with mock.patch.object(main, "cached_power_data", {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")}), \
                mock.patch.object(eko_chat, "_site_now", return_value=__import__("datetime").datetime.now()):
            r = self.ask(QUESTION)
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (504, "request_timeout"))      # unmapped IAQ is not a result to keep
        self.assertNotIn("IAQ", r.text)

    def test_the_streamed_request_gets_a_partial_done_or_a_timeout_error(self):
        self.provider(request_deadline_s=0.8)
        self.stop_polling()
        self.use(Scripted([call("find_equipment"), {"content": "never", "tool_calls": []}], hooks={1: sleeper(10)}))
        events = parse_sse(self.ask(QUESTION, stream=True).text)
        self.assertEqual(events[-1][0], "done")
        self.assertTrue(events[-1][1]["partial"])
        self.assertIn("Equipment items: 3.", events[-1][1]["answer"])
        self.use(Scripted([{"content": "never", "tool_calls": []}], hooks={0: sleeper(10)}))
        events = parse_sse(self.ask(QUESTION, stream=True).text)
        self.assertEqual((events[-1][0], events[-1][1]["error"]), ("error", "request_timeout"))
        self.assertNotIn("done", [e for e, _ in events])

    def test_the_hybrid_model_is_cancelled_at_the_deadline_without_opening_the_cool_down(self):
        self.provider("ollama", model="m", request_deadline_s=0.6)
        state = {"cancelled": False}

        async def hang(_client, system, user, schema=None):
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                state["cancelled"] = True
                raise
        started = time.perf_counter()
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", hang):
            r = self.ask("how warm is it inside right now")
        self.assertEqual(r.status_code, 200)
        self.assertLess(time.perf_counter() - started, 2.5)
        body = r.json()
        self.assertEqual((body["route"], body["tool_calls"], body["card"]), ("timeout", [], None))
        self.assertIn("not answered within 0.6 seconds", body["answer"])
        self.assertTrue(state["cancelled"])
        self.assertEqual(eko_chat_llm.BREAKER["until"], 0.0, "a slow request is not an outage of the model server")
        self.assertEqual(eko_chat.LLM_GATE.active, 0)

    def test_a_slow_summary_does_not_cost_the_answer_that_is_already_verified(self):
        self.provider("ollama", model="m", request_deadline_s=1.2)
        self.stop_polling()
        calls = []

        async def generate(_client, system, user, schema=None):
            calls.append(system[:20])
            if len(calls) == 1:
                return {"content": json.dumps({"intent": "explain_conditions"}), "usage": {}}
            await asyncio.sleep(30)                  # the optional second call (the summary) hangs
        with mock.patch.object(eko_chat_llm.OllamaClient, "generate", generate):
            body = self.ask("explain how the building is doing").json()
        self.assertEqual(len(calls), 2)
        self.assertEqual(body["route"], "llm_intent")
        self.assertEqual(body["answer_source"], "code")
        self.assertTrue(body["answer"])

    def test_the_rules_are_not_slowed_or_stopped_by_a_short_deadline(self):
        self.provider("rules", request_deadline_s=0.5)
        r = self.ask("Read the equipment list.")
        self.assertEqual((r.status_code, r.json()["route"]), (200, "direct"))

    def test_the_diagnostics_name_the_deadline(self):
        self.provider(request_deadline_s=0.6)
        self.use(Scripted([{"content": "never", "tool_calls": []}], hooks={0: sleeper(30)}))
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.ask(QUESTION)
        result = [ln for ln in buf.getvalue().splitlines() if "CHAT_RESULT" in ln]
        self.assertEqual(len(result), 1)
        self.assertIn("mode=LLM_FALLBACK", result[0])
        self.assertIn("fallback_reason=request_timeout", result[0])
        self.assertEqual(trace_mod.MODES[trace_mod.LLM_FALLBACK] >= 1, True)


if __name__ == "__main__":
    unittest.main()
