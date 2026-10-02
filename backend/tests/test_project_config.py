"""Per-project FIN configuration in the backend.

Run from backend/:   python -m unittest discover -s tests -v
No FIN server needed: FinScramClient is replaced by tests/fake_fin.py.
"""
import json
import os
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import main  # noqa: E402
from fake_fin import FakeFinClient  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Two projects that disagree on every Data Mapping block
PROJECT_A = {
    "finLivePoints": {"total_power": "p:{project}:r:111"},
    "finEndpoints": {"A_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:1,today())"},
    "finEquipmentClasses": {"system_tags": ["ahu"], "meter_tags": ["meter"], "type_priority": ["ahu"]},
    "finMeterProfile": {"prefix": "PMU", "point_map": {"active_power": ["active power"]}},
    "finSeverityBands": {"order": "desc", "critical": 250, "warning": 150},   # priority 200 -> warning
}
PROJECT_B = {
    "finLivePoints": {"total_power": "p:{project}:r:222"},
    "finEndpoints": {"B_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:2,today())"},
    "finEquipmentClasses": {"system_tags": ["fcu"], "meter_tags": ["meter"], "type_priority": ["fcu"]},
    "finMeterProfile": {"prefix": "MTR", "point_map": {"active_power": ["active power"]}},
    "finSeverityBands": {"order": "asc", "critical": 300, "warning": 250},    # priority 200 -> critical
}


def wait_for(fn, timeout=6.0):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(0.05)
    raise AssertionError(f"timed out; last value: {last!r}")


class ProjectConfigTests(unittest.TestCase):
    def setUp(self):
        self._real_client = main.FinScramClient
        self._real_project_json = main.PROJECT_JSON
        main.FinScramClient = FakeFinClient
        FakeFinClient.slow_realtime = False
        self.http = TestClient(main.app)
        self.http.__enter__()

    def tearDown(self):
        self.http.post("/api/fin/logout")
        self.http.__exit__(None, None, None)
        main.FinScramClient = self._real_client
        main.PROJECT_JSON = self._real_project_json
        main.apply_project_settings(None)

    def login(self, settings, project_id):
        r = self.http.post("/api/fin/login", json={
            "username": "u", "password": "p", "settings": settings, "project_id": project_id})
        self.assertEqual(r.status_code, 200, r.text)

    def switch(self, settings, project_id):
        r = self.http.post("/api/fin/project-settings", json={"settings": settings, "project_id": project_id})
        self.assertEqual(r.status_code, 200, r.text)

    def get(self, path):
        return self.http.get(path).json()

    def power(self, expected):
        return wait_for(lambda: (self.get("/api/fin/power-live").get("total_power") == expected) or None)

    def observed(self):
        """What the backend API returns now, for every Data Mapping block."""
        equip = wait_for(lambda: self.get("/api/fin/equip-live").get("equipment"))
        return {
            "total_power": self.get("/api/fin/power-live").get("total_power"),
            "history_keys": sorted(wait_for(lambda: self.get("/api/fin/power-history") or None)),
            "eq1_type": next(e["type"] for e in equip if e["name"] == "EQ-1"),
            "meters": sorted(wait_for(lambda: self.get("/api/fin/pmu-live") or None)),
            "severity": wait_for(lambda: self.get("/api/fin/alarms").get("alarms"))[0]["severity"],
        }

    def assert_serves_a(self):
        self.power(111)
        self.assertEqual(self.observed(), {
            "total_power": 111.0, "history_keys": ["A_his"], "eq1_type": "ahu",
            "meters": ["PMU-1"], "severity": "warning"})
        cfg = self.get("/api/fin/project-settings")
        self.assertEqual(cfg["project_id"], "proj-A")
        self.assertEqual(cfg["config"]["live_point_ids"], PROJECT_A["finLivePoints"])
        self.assertTrue(all(v == "project" for v in cfg["source"].values()))

    def assert_serves_b(self):
        self.power(222)
        self.assertEqual(self.observed(), {
            "total_power": 222.0, "history_keys": ["B_his"], "eq1_type": "other",
            "meters": ["MTR-1"], "severity": "critical"})
        cfg = self.get("/api/fin/project-settings")
        self.assertEqual(cfg["project_id"], "proj-B")
        self.assertEqual(cfg["config"]["live_point_ids"], PROJECT_B["finLivePoints"])

    # --- isolation: all five blocks, A -> B -> A -> B ---------------------------------

    def test_a_b_a_b_every_block_follows_the_project(self):
        self.login(PROJECT_A, "proj-A")
        self.assert_serves_a()
        self.switch(PROJECT_B, "proj-B")
        self.assert_serves_b()
        self.switch(PROJECT_A, "proj-A")
        self.assert_serves_a()
        self.switch(PROJECT_B, "proj-B")
        self.assert_serves_b()

    def test_a_never_sees_b_values_in_config(self):
        self.login(PROJECT_A, "proj-A")
        cfg = self.get("/api/fin/project-settings")["config"]
        self.assertNotIn("B_his", cfg["power_endpoints"])
        self.assertEqual(cfg["severity_bands"]["order"], "desc")
        self.assertEqual(cfg["meter_profile"]["prefix"], "PMU")

    # --- fallback to config.json ------------------------------------------------------

    def test_project_without_mappings_falls_back_to_defaults_not_previous_project(self):
        self.login(PROJECT_A, "proj-A")
        self.switch({}, "proj-empty")            # e.g. a normal project with no Data Mapping
        cfg = self.get("/api/fin/project-settings")
        self.assertEqual(cfg["project_id"], "proj-empty")
        self.assertTrue(all(v == "default" for v in cfg["source"].values()))
        base = main.BASE_CONFIG
        self.assertEqual(cfg["config"]["live_point_ids"], base["live_point_ids"])
        self.assertEqual(cfg["config"]["severity_bands"], base["severity_bands"])
        self.assertNotEqual(cfg["config"]["live_point_ids"], PROJECT_A["finLivePoints"])

    def test_block_level_override_leaves_other_blocks_on_defaults(self):
        self.login({"finSeverityBands": PROJECT_B["finSeverityBands"]}, "proj-sev")
        cfg = self.get("/api/fin/project-settings")
        self.assertEqual(cfg["source"]["severity_bands"], "project")
        for block in ("live_point_ids", "power_endpoints", "equipment_classes", "meter_profile"):
            self.assertEqual(cfg["source"][block], "default")
            self.assertEqual(cfg["config"][block], main.BASE_CONFIG[block])

    def test_invalid_values_are_ignored(self):
        merged = main.merge_project_settings(main.BASE_CONFIG, {
            "finLivePoints": ["not", "a", "dict"], "finProjectName": "   ", "finInterval": "fast",
            "finSeverityBands": {}, "weatherApiKey": "SECRET", "navButtons": [1]})
        self.assertEqual(merged, main.BASE_CONFIG)

    # --- session / identity -----------------------------------------------------------

    def test_project_settings_endpoints_need_a_session(self):
        self.assertEqual(self.http.get("/api/fin/project-settings").status_code, 401)
        self.assertEqual(self.http.post("/api/fin/project-settings", json={"settings": {}}).status_code, 401)

    def test_backend_reports_which_project_it_serves(self):
        self.login(PROJECT_A, "proj-A")
        self.assertEqual(self.get("/api/fin/config")["project_id"], "proj-A")
        self.switch(PROJECT_B, "proj-B")
        self.assertEqual(self.get("/api/fin/config")["project_id"], "proj-B")

    def test_switch_clears_rows_read_for_the_previous_project(self):
        self.login(PROJECT_A, "proj-A")
        wait_for(lambda: main.client.last_point_rows)
        FakeFinClient.slow_realtime = True        # the new project's first poll will not land
        self.switch(PROJECT_B, "proj-B")
        self.assertEqual(main.client.last_point_rows, [])
        self.assertEqual(main.client.last_alarm_rows, [])
        self.assertEqual(self.get("/api/fin/equip-live").get("equipment", []), [])

    def test_server_url_change_asks_for_a_new_sign_in(self):
        self.login(PROJECT_A, "proj-A")
        r = self.http.post("/api/fin/project-settings", json={
            "settings": {"finBaseUrl": "https://other-fin"}, "project_id": "p"}).json()
        self.assertTrue(r["reconnect_required"])

    # --- exported bundle --------------------------------------------------------------

    def test_bundled_project_json_is_applied_at_startup(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "project.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"projectId": "proj-B", "apiSettings": PROJECT_B}, f)
            main.PROJECT_JSON = path
            with TestClient(main.app) as fresh:
                cfg = fresh.get("/api/fin/config")
                self.assertEqual(cfg.json()["project_id"], "proj-B")
                self.assertEqual(main.CONFIG["live_point_ids"], PROJECT_B["finLivePoints"])

    def test_missing_bundle_uses_config_json(self):
        main.PROJECT_JSON = os.path.join(tempfile.gettempdir(), "definitely-missing-project.json")
        with TestClient(main.app) as fresh:
            self.assertIsNone(fresh.get("/api/fin/config").json()["project_id"])
            self.assertEqual(main.CONFIG["live_point_ids"], main.BASE_CONFIG["live_point_ids"])


if __name__ == "__main__":
    unittest.main()
