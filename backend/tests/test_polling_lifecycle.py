"""The shared FIN connection's lifecycle: restarting polling never leaves two sets of loops running, and sign-ins, project
switches and sign-outs that overlap in time are applied one at a time, each with its own project (a session never gets
another sign-in's project, the client and the served project agree afterwards, and exactly one polling set runs).

The FIN client is the fake one; FIN's answers are slowed with sleeps so that the operations genuinely overlap."""
import asyncio
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from fake_fin import FakeFinClient  # noqa: E402  (sets EKO_NOTIFICATION_DB before main can write)
import main  # noqa: E402
from starlette.requests import Request  # noqa: E402
from starlette.responses import Response  # noqa: E402
from test_notification_user_state import ApiHelpers  # noqa: E402  (not a TestCase: only its helpers come in)

LOOPS = ("realtime_loop", "live_loop")


def fake_request(token=None):
    headers = [(b"cookie", f"{main.SESSION_COOKIE}={token}".encode())] if token else []
    return Request({"type": "http", "method": "POST", "path": "/", "headers": headers, "query_string": b"",
                    "scheme": "http", "server": ("testserver", 80), "client": ("127.0.0.1", 1)})


def token_of(response):
    cookie = response.headers["set-cookie"]
    return cookie.split("=", 1)[1].split(";", 1)[0]


class PollingLifecycleTests(ApiHelpers, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self._auth, self._probe = FakeFinClient.authenticate, FakeFinClient.fetch_probe

    def tearDown(self):
        FakeFinClient.authenticate, FakeFinClient.fetch_probe = self._auth, self._probe
        super().tearDown()

    # ── helpers: run on the app's own event loop ──
    def run_app(self, fn, *args):
        return self.http.portal.call(fn, *args)

    def loops_alive(self):
        async def count():
            await asyncio.sleep(0.05)   # let a cancelled loop finish being cancelled
            return sorted(t.get_coro().__name__ for t in asyncio.all_tasks()
                          if not t.done() and getattr(t.get_coro(), "__name__", "") in LOOPS)
        return self.run_app(count)

    def slow_fin(self, auth_delay, probe_delay=0.2):
        """Sign-ins by 'slow' take auth_delay; every other takes 0.01s. Every validation read takes probe_delay."""
        real_auth, real_probe = self._auth, self._probe

        async def authenticate(self_, username, password):
            await asyncio.sleep(auth_delay if username == "slow" else 0.01)
            return await real_auth(self_, username, password)

        async def probe(self_, endpoint):
            await asyncio.sleep(probe_delay)
            return await real_probe(self_, endpoint)
        FakeFinClient.authenticate, FakeFinClient.fetch_probe = authenticate, probe

    def watch_validation(self):
        """How many project validations (each part way through changing the shared connection) are in progress at once."""
        real, stats = main._validate_project, {"now": 0, "max": 0}

        async def spy(c):
            stats["now"] += 1
            stats["max"] = max(stats["max"], stats["now"])
            try:
                return await real(c)
            finally:
                stats["now"] -= 1
        main._validate_project = spy
        self.addCleanup(lambda: setattr(main, "_validate_project", real))
        return stats

    async def do_login(self, user, project, project_id):
        request, response = fake_request(), Response()
        body = main.LoginRequest(username=user, password="p", settings={"finProjectName": project}, project_id=project_id)
        await main.login(body, request, response)
        return token_of(response)

    # ── polling ──
    def test_restarting_polling_never_leaves_two_sets_running_and_leaves_other_tasks_alone(self):
        self.sign_in("alice")
        self.assertEqual(self.loops_alive(), sorted(LOOPS), "one set after the sign-in")

        async def restart_three_times():
            bystander = asyncio.create_task(asyncio.sleep(3600))
            first = list(main.polling_tasks)
            for _ in range(3):
                main._start_polling()
            await asyncio.sleep(0.05)
            out = {"first_set_stopped": all(t.cancelled() or t.done() for t in first), "bystander_alive": not bystander.done(),
                   "held": len(main.polling_tasks)}
            bystander.cancel()
            return out
        out = self.run_app(restart_three_times)
        self.assertEqual(out, {"first_set_stopped": True, "bystander_alive": True, "held": 2})
        self.assertEqual(self.loops_alive(), sorted(LOOPS), "still exactly one set after three restarts")

    # ── sign-ins that overlap ──
    def test_two_overlapping_sign_ins_each_keep_their_own_project_and_one_polling_set_runs(self):
        self.slow_fin(auth_delay=0.15)
        overlap = self.watch_validation()

        async def both():
            # 'fast' is accepted first and is still validating its project when 'slow' is accepted
            fast = asyncio.create_task(self.do_login("fast", self.OTHER, "proj-fast"))
            slow = asyncio.create_task(self.do_login("slow", self.MARSA, "proj-slow"))
            return await asyncio.gather(fast, slow)
        fast_token, slow_token = self.run_app(both)
        sessions = {v["user_id"]: v["site"] for v in main.SESSIONS.values()}
        self.assertEqual(sessions, {"fast": self.OTHER, "slow": self.MARSA}, "each session names the project ITS sign-in was for")
        self.assertEqual((main.client.project_name, main.PROJECT_NAME, main.ACTIVE_PROJECT_ID, main.POLL_OWNER),
                         (self.MARSA, self.MARSA, "proj-slow", "slow"), "the last sign-in to be applied owns the shared connection, whole")
        self.assertEqual(self.loops_alive(), sorted(LOOPS), "exactly one polling set")
        self.assertNotEqual(fast_token, slow_token)
        self.assertEqual(overlap["max"], 1, "the two sign-ins changed the shared connection one at a time")

    def test_a_sign_in_and_a_project_switch_that_overlap_leave_one_coherent_state(self):
        alice = self.sign_in("alice")
        self.slow_fin(auth_delay=0.01, probe_delay=0.25)
        overlap = self.watch_validation()

        async def both():
            switch = asyncio.create_task(main.set_project_settings(
                main.ProjectSettingsRequest(settings={"finProjectName": self.OTHER}, project_id="proj-switched"), fake_request(alice)))
            await asyncio.sleep(0.05)   # the switch holds the shared connection and is waiting on FIN
            login = asyncio.create_task(self.do_login("bob", self.MARSA, "proj-bob"))
            return await asyncio.gather(switch, login)
        switched, _bob = self.run_app(both)
        self.assertEqual(switched["status"], "success")
        self.assertEqual((main.client.project_name, main.PROJECT_NAME, main.ACTIVE_PROJECT_ID, main.POLL_OWNER),
                         (self.MARSA, self.MARSA, "proj-bob", "bob"), "the sign-in that came second was applied after the switch, whole")
        self.assertEqual(self.loops_alive(), sorted(LOOPS), "exactly one polling set")
        users = sorted(v["user_id"] for v in main.SESSIONS.values())
        self.assertEqual(users, ["alice", "bob"], "no session was lost or invented")
        self.assertEqual(overlap["max"], 1, "the sign-in and the project switch changed the shared connection one at a time")

    def test_a_sign_out_waits_for_a_sign_in_that_is_part_way_through(self):
        alice = self.sign_in("alice")
        self.slow_fin(auth_delay=0.01, probe_delay=0.25)

        async def both():
            login = asyncio.create_task(self.do_login("bob", self.OTHER, "proj-bob"))
            await asyncio.sleep(0.1)   # bob is installed and validating
            out = asyncio.create_task(main.logout(fake_request(alice), Response()))
            return await asyncio.gather(login, out)
        _tok, signed_out = self.run_app(both)
        self.assertEqual(signed_out["status"], "signed_out", "bob is signed in, so the shared connection stays")
        self.assertTrue(main.client and main.client.is_authenticated and main.client.project_name == self.OTHER)
        self.assertEqual(self.loops_alive(), sorted(LOOPS))

    def test_a_sign_in_that_ends_while_it_waits_closes_its_unused_client_and_changes_nothing(self):
        self.sign_in("alice")
        closed, real_close = [], FakeFinClient.close

        async def close(self_):
            closed.append(self_)
            await real_close(self_)
        FakeFinClient.close = close
        try:
            before = (main.client, main.PROJECT_NAME, list(main.SESSIONS))

            async def scenario():
                held = asyncio.Event()

                async def hold():
                    async with main._fin_lock():
                        held.set()
                        await asyncio.sleep(0.5)
                holder = asyncio.create_task(hold())
                await held.wait()
                waiting = asyncio.create_task(self.do_login("bob", self.OTHER, "proj-bob"))
                await asyncio.sleep(0.1)   # bob is accepted by FIN and queued behind the holder
                waiting.cancel()           # his request ends (the browser went away)
                try:
                    await waiting
                except asyncio.CancelledError:
                    pass
                await holder
            self.run_app(scenario)
            self.assertEqual((main.client, main.PROJECT_NAME, list(main.SESSIONS)), before, "nothing shared changed")
            self.assertEqual(len(closed), 1, "his unused FIN client was closed, not leaked")
            self.assertIsNot(closed[0], main.client)
        finally:
            FakeFinClient.close = real_close


if __name__ == "__main__":
    unittest.main()
