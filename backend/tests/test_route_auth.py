"""Who may reach the shared FIN connection: the data, configuration and FIN-passthrough routes need a browser of their own
signed in (its session cookie), not merely a backend that somebody else connected; a failed sign-in changes nothing shared;
FIN credentials go only to the FIN server; one user's refused request does not end everybody's session; a project switch
stops the old polling before the served project changes. The routes meant to be public stay public.

The FIN client is the fake one (any password signs in unless a test says otherwise)."""
import asyncio
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from fake_fin import FakeFinClient  # noqa: E402  (sets EKO_NOTIFICATION_DB before main can write)
import main  # noqa: E402
from fin_client import FinScramClient  # noqa: E402
from test_notification_user_state import ApiHelpers  # noqa: E402  (not a TestCase: only its helpers come in)

POINT = "@p:x:r:1"
# (method, path, body): every one of these must refuse a browser with no session of its own
PROTECTED = [
    ("GET", "/api/fin/workorders", None), ("GET", "/api/fin/equip-live", None), ("GET", "/api/fin/power-live", None),
    ("GET", "/api/fin/power-history", None), ("GET", "/api/fin/pmu-live", None), ("GET", "/api/fin/alarms", None),
    ("GET", "/api/fin/building-info", None), ("GET", "/api/fin/his-points", None),
    ("GET", "/api/fin/point-history?id=p:x:r:1", None), ("GET", "/api/fin/alarm-history", None),
    ("GET", "/api/fin/eval?expr=readAll(point)", None), ("GET", "/api/fin/file?ref=" + POINT, None),
    ("GET", "/api/fin/projects", None), ("GET", "/api/fin/resources?project=someProject", None),
    ("GET", "/api/fin/project-settings", None),
    ("POST", "/api/fin/project-settings", {"settings": {"finProjectName": "elsewhere"}, "project_id": "proj-evil"}),
    ("POST", "/api/fin/validate-mapping", {"project_id": None, "blocks": {}}),
]
PUBLIC = ["/api/fin/status", "/api/auth/status", "/api/fin/config", "/api/fin/mapping-schema", "/api/fin/documents", "/login"]


class RouteAuthTests(ApiHelpers, unittest.TestCase):
    def anonymous(self, method, path, body=None):
        self.browser()
        return self.http.request(method, path, json=body) if body is not None else self.http.request(method, path)

    def test_every_protected_route_refuses_a_browser_with_no_session_even_while_fin_is_connected(self):
        alice = self.sign_in("alice")
        self.assertTrue(main.client and main.client.is_authenticated, "FIN is connected, for alice")
        before = (main.PROJECT_NAME, main.ACTIVE_PROJECT_ID, id(main.CONFIG))
        for method, path, body in PROTECTED:
            r = self.anonymous(method, path, body)
            self.assertEqual(r.status_code, 401, f"{method} {path}: {r.status_code} {r.text[:120]}")
        self.assertEqual((main.PROJECT_NAME, main.ACTIVE_PROJECT_ID, id(main.CONFIG)), before,
                         "an anonymous project-settings request changed the served project")
        # the same routes answer the signed-in browser (what they answer is not this test's business, only that it is not a 401)
        self.browser(alice)
        for method, path, body in PROTECTED:
            if method == "GET":
                self.assertNotEqual(self.http.request(method, path).status_code, 401, f"{method} {path} refused alice")

    def test_a_made_up_or_expired_cookie_is_no_session(self):
        self.sign_in("alice")
        self.browser("not-a-real-token")
        for method, path, body in PROTECTED[:6]:
            self.assertEqual(self.http.request(method, path).status_code, 401, path)

    def test_the_routes_meant_to_be_public_stay_public(self):
        self.sign_in("alice")
        for path in PUBLIC:
            r = self.anonymous("GET", path)
            self.assertNotIn(r.status_code, (401, 403), f"{path} should stay public: {r.status_code}")

    def test_a_failed_sign_in_changes_nothing_shared(self):
        alice = self.sign_in("alice")
        real = FakeFinClient.authenticate

        async def refuse(self_, username, password):
            return password != "wrong" and await real(self_, username, password)
        FakeFinClient.authenticate = refuse
        try:
            held = (main.client, main.PROJECT_NAME, main.ACTIVE_PROJECT_ID, main.FIN_SERVER_URL, id(main.CONFIG),
                    main.POLL_OWNER, dict(main.PROJECT_CHECK), len(main.SESSIONS), list(main.polling_tasks))
            r = self.anonymous("POST", "/api/fin/login", {
                "username": "mallory", "password": "wrong", "server_url": "https://elsewhere.example",
                "settings": {"finProjectName": self.OTHER}, "project_id": "proj-evil"})
            self.assertEqual(r.status_code, 401, r.text)
            now = (main.client, main.PROJECT_NAME, main.ACTIVE_PROJECT_ID, main.FIN_SERVER_URL, id(main.CONFIG),
                   main.POLL_OWNER, dict(main.PROJECT_CHECK), len(main.SESSIONS), list(main.polling_tasks))
            self.assertEqual(now, held, "a failed sign-in must not touch the shared client, project, configuration, sessions or polling")
            self.assertTrue(main.client.is_authenticated)
            self.assertTrue(main.polling_tasks and not any(t.done() for t in main.polling_tasks), "polling kept running")
            self.browser(alice)
            self.assertEqual(self.call("GET", "/notifications").status_code, 200, "alice still has her notifications")
            self.assertEqual(self.http.get("/api/fin/alarms").status_code, 200, "and her live data")
        finally:
            FakeFinClient.authenticate = real

    def test_fin_credentials_go_only_to_the_fin_server(self):
        c = FinScramClient("https://fin.example:8443/", "proj")
        c.auth_headers = {"Authorization": "scram secret-token"}
        seen = []

        class Resp:
            status_code, text = 200, "ver:\"3.0\"\nx\n1\n"

            def json(self):
                return {}

        async def get(url, headers=None):
            seen.append((url, dict(headers or {})))
            return Resp()
        c.client.get = get
        try:
            self.assertIsNone(asyncio.run(c.fetch_api("https://evil.example/steal", is_text=True)))
            self.assertIsNone(asyncio.run(c.fetch_api("http://fin.example:8443/api/x", is_text=True)), "another scheme is another server")
            self.assertEqual(asyncio.run(c.fetch_probe("https://fin.example:9999/api/x")), (None, None), "another port too")
            self.assertEqual(seen, [], "nothing was sent")
            self.assertIsNotNone(asyncio.run(c.fetch_api("/api/proj/eval?expr=a", is_text=True)))
            self.assertIsNotNone(asyncio.run(c.fetch_api("https://FIN.example:8443/api/proj/y", is_text=True)))
            self.assertEqual([u for u, _ in seen], ["https://fin.example:8443/api/proj/eval?expr=a", "https://FIN.example:8443/api/proj/y"])
            self.assertTrue(all(h.get("Authorization") == "scram secret-token" for _, h in seen))
        finally:
            asyncio.run(c.close())

    def test_one_users_request_refused_by_fin_does_not_end_the_shared_session(self):
        alice = self.sign_in("alice")
        self.browser(alice)
        FakeFinClient.probe_status = 403
        try:
            r = self.http.get("/api/fin/eval?expr=readAll(point)")
            self.assertEqual(r.status_code, 403, r.text)
            self.assertEqual(self.http.get("/api/fin/point-history?id=p:x:r:1").status_code, 403)
        finally:
            FakeFinClient.probe_status = None
        self.assertTrue(main.client.is_authenticated, "FIN refusing one expression is that request's answer, not a sign-out for everybody")
        self.assertFalse(any(t.done() for t in main.polling_tasks), "polling kept running")
        self.assertEqual(self.http.get("/api/fin/alarms").status_code, 200)

    def test_a_project_switch_stops_the_old_polling_before_the_served_project_changes(self):
        alice = self.sign_in("alice")
        old = main.client.project_name
        seen, real = [], main._cancel_polling

        def spy():
            seen.append(main.client.project_name)
            real()
        main._cancel_polling = spy
        try:
            self.browser(alice)
            r = self.http.post("/api/fin/project-settings", json={"settings": {"finProjectName": self.OTHER}, "project_id": "proj-other"})
            self.assertEqual(r.status_code, 200, r.text)
        finally:
            main._cancel_polling = real
        self.assertEqual(seen[0], old, "polling was stopped while the client still named the OLD project")
        self.assertEqual(main.client.project_name, self.OTHER)
        self.assertTrue(main.polling_tasks and not any(t.done() for t in main.polling_tasks), "polling runs again for the new project")


if __name__ == "__main__":
    unittest.main()
