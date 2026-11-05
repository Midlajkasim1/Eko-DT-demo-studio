"""Shared base for the Eko-Chat backend tests (test_eko_chat_rules, test_eko_chat_metrics).

The real backend app (main.app) with the fake FIN client from fake_fin.py: any password signs in, and the project it signs in for is
the one in the settings sent with the login. Not a test module itself; it holds only the helpers those tests share.
"""
import copy
import json
import os
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from fake_fin import FakeFinClient  # noqa: E402  (sets EKO_NOTIFICATION_DB before main can write)
import eko_chat  # noqa: E402
import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Two Studio projects with the same fake FIN data and different alarm bands: FIN priority 200 is a warning under A and critical under B
PROJECT_A = {"finProjectName": "projA", "finSeverityBands": {"order": "desc", "critical": 250, "warning": 150}}
PROJECT_B = {"finProjectName": "projB", "finSeverityBands": {"order": "desc", "critical": 100, "warning": 50}}


def wait_for(predicate, timeout=5.0):
    """Poll until predicate() is truthy; the FIN reads run on the app's own loop, so a test waits for their caches."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.02)
    raise AssertionError("timed out waiting for the FIN caches")


def parse_sse(text):
    """A Server-Sent Events body -> [(event, data)], data parsed from its JSON."""
    out = []
    for block in text.replace("\r\n", "\n").split("\n\n"):
        event, data = "message", []
        for line in block.split("\n"):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].lstrip())
        if data:
            out.append((event, json.loads("\n".join(data))))
    return out


class ChatTestBase(unittest.TestCase):
    """The app on a test client, the fake FIN client, and a signed-in browser (user "u") per login()."""

    def setUp(self):
        self._real_client = main.FinScramClient
        self._real_chat = (copy.deepcopy(main.BASE_CONFIG.get("chat")), copy.deepcopy(main.CONFIG.get("chat")))
        main.FinScramClient = FakeFinClient
        FakeFinClient.slow_realtime = False
        main.SESSIONS.clear()
        self.http = TestClient(main.app)
        self.http.__enter__()

    def tearDown(self):
        main._cancel_polling()
        main.watchers.clear()
        main.SESSIONS.clear()
        self.http.cookies.clear()
        self.http.__exit__(None, None, None)
        main.FinScramClient = self._real_client
        main.apply_project_settings(None)
        main.BASE_CONFIG["chat"], main.CONFIG["chat"] = self._real_chat

    # Notifications (the bell, and Eko-Chat's notifications tool) are for superusers of the project; the role is the operator's
    # server-side mapping, so the tests that read them map "u" as one. A test of the refusal sets this False.
    AUTO_SUPERUSER = True

    def login(self, settings, project_id):
        """Sign in as "u" for this Studio project, then open a dashboard for it so the FIN reads start."""
        r = self.http.post("/api/fin/login", json={"username": "u", "password": "pw", "settings": settings, "project_id": project_id})
        self.assertEqual(r.status_code, 200, r.text)
        if self.AUTO_SUPERUSER:
            import notifications
            notifications.store().map_role(main.client.project_name, "u", "superuser", "operator")
        self.http.headers["X-Eko-Project"] = project_id   # the open project, as the dashboard's own calls send it
        self.assertEqual(self.http.post("/api/fin/watch", json={}).status_code, 200)

    def ready(self):
        """Wait until the first equipment, alarm and facility reads have landed in the caches."""
        wait_for(lambda: main.cached_equip_data.get("equipment") and main.cached_alarm_data and main.cached_facility)

    def set_chat(self, cfg):
        # the signed-in project may use chat unless the test names others; the tests that probe the guard set the config themselves
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = {"allowed_projects": [main.PROJECT_NAME], **cfg}

    def tool(self, name, **args):
        """A chat tool run over the current caches, outside any request."""
        return eko_chat.run_tool(name, args, main._chat_view())
