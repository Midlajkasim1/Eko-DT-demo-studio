"""FIN project validation and Data Mapping validation.

Run from backend/:   python -m unittest discover -s tests -v
FinScramClient is replaced by tests/fake_fin.py, so no FIN server is needed. The fake answers
readById / read?filter=equip from FakeFinClient.missing_points / unknown_projects.
"""
import os
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import main  # noqa: E402
from fake_fin import FakeFinClient  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

PROJECT_A = {
    "finProjectName": "projA",
    "finLivePoints": {"total_power": "p:{project}:r:111", "temperature": "p:{project}:r:112"},
    "finEndpoints": {"A_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:1,today())"},
    "finEquipmentClasses": {"system_tags": ["ahu"]},
    "finMeterProfile": {"prefix": "PMU", "point_map": {"active_power": ["active power"], "voltage": ["volts"]}},
    "finSeverityBands": {"order": "desc", "critical": 250, "warning": 150},
}
PROJECT_B = {
    "finProjectName": "projB",
    "finLivePoints": {"total_power": "p:{project}:r:222"},
    "finEndpoints": {"B_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:2,today())"},
    "finMeterProfile": {"prefix": "MTR", "point_map": {"active_power": ["active power"]}},
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


class MappingValidationTests(unittest.TestCase):
    def setUp(self):
        self._real_client = main.FinScramClient
        main.FinScramClient = FakeFinClient
        FakeFinClient.slow_realtime = False
        FakeFinClient.unknown_projects = set()
        FakeFinClient.missing_points = set()
        FakeFinClient.probe_status = None
        FakeFinClient.probe_log = []
        self.http = TestClient(main.app)
        self.http.__enter__()

    def tearDown(self):
        self.http.post("/api/fin/logout")
        self.http.__exit__(None, None, None)
        main.FinScramClient = self._real_client
        main.apply_project_settings(None)
        FakeFinClient.unknown_projects = set()
        FakeFinClient.missing_points = set()
        FakeFinClient.probe_status = None

    def login(self, settings, project_id, **extra):
        r = self.http.post("/api/fin/login", json={
            "username": "u", "password": "p", "settings": settings, "project_id": project_id, **extra})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def switch(self, settings, project_id):
        r = self.http.post("/api/fin/project-settings", json={"settings": settings, "project_id": project_id})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def validate(self, project_id, blocks, expect=200):
        r = self.http.post("/api/fin/validate-mapping", json={"project_id": project_id, "blocks": blocks})
        self.assertEqual(r.status_code, expect, r.text)
        return r.json()

    def status(self):
        return self.http.get("/api/fin/status").json()

    # ── connection / project validation ──

    def test_valid_project_is_reported_validated(self):
        body = self.login(PROJECT_A, "A")
        self.assertIs(body["project_validated"], True)
        st = self.status()
        self.assertTrue(st["connected"])
        self.assertIs(st["project_validated"], True)
        self.assertEqual(st["project_id"], "A")

    def test_unknown_project_signs_in_but_is_not_validated(self):
        FakeFinClient.unknown_projects = {"projA"}
        body = self.login(PROJECT_A, "A")
        self.assertIs(body["project_validated"], False)
        st = self.status()
        self.assertTrue(st["connected"])                    # the session itself is fine
        self.assertIs(st["project_validated"], False)       # but the project is not usable

    def test_error_grid_from_fin_is_not_validated(self):
        FakeFinClient.probe_status = 500
        self.assertIs(self.login(PROJECT_A, "A")["project_validated"], False)

    def test_no_validation_state_without_a_session(self):
        st = self.status()
        self.assertFalse(st["connected"])
        self.assertIsNone(st["project_validated"])
        self.http.post("/api/fin/logout")
        self.login(PROJECT_A, "A")
        self.http.post("/api/fin/logout")
        self.assertIsNone(self.status()["project_validated"])

    def test_project_name_source_is_reported_not_invented(self):
        # typed at sign-in
        self.assertEqual(self.login(PROJECT_A, "A", project_name="typed")["project_source"], "request")
        self.assertEqual(self.status()["project_name"], "typed")
        # the open project's own name
        self.assertEqual(self.switch(PROJECT_A, "A")["project_source"], "project")
        self.assertEqual(self.status()["project_name"], "projA")
        # a project that sets none is unconfigured: the config.json site is not substituted for it
        self.assertEqual(self.switch({}, "C")["project_source"], "unset")
        self.assertEqual(self.status()["project_name"], "")

    def test_switching_project_revalidates(self):
        FakeFinClient.unknown_projects = {"projB"}
        self.login(PROJECT_A, "A")
        self.assertIs(self.status()["project_validated"], True)
        self.assertIs(self.switch(PROJECT_B, "B")["project_validated"], False)
        self.assertIs(self.switch(PROJECT_A, "A")["project_validated"], True)

    # ── mapping validation ──

    def test_endpoint_needs_a_session(self):
        self.validate("A", {}, expect=401)

    def test_valid_and_missing_points(self):
        self.login(PROJECT_A, "A")
        FakeFinClient.missing_points = {"p:projA:r:112"}
        res = self.validate("A", {k: PROJECT_A[k] for k in ("finLivePoints", "finEndpoints")})
        live = res["blocks"]["finLivePoints"]
        self.assertEqual(live["items"]["total_power"]["status"], "valid")
        self.assertEqual(live["items"]["temperature"]["status"], "not_found")
        self.assertEqual(live["status"], "not_found")
        self.assertEqual(res["blocks"]["finEndpoints"]["items"]["A_his"]["status"], "valid")
        self.assertFalse(res["valid"])

    def test_endpoint_point_missing(self):
        self.login(PROJECT_A, "A")
        FakeFinClient.missing_points = {"p:projA:r:1"}
        res = self.validate("A", {"finEndpoints": PROJECT_A["finEndpoints"]})
        self.assertEqual(res["blocks"]["finEndpoints"]["items"]["A_his"]["status"], "not_found")

    def test_all_valid(self):
        self.login(PROJECT_A, "A")
        res = self.validate("A", {"finLivePoints": PROJECT_A["finLivePoints"]})
        self.assertTrue(res["valid"])
        self.assertEqual(res["blocks"]["finLivePoints"]["status"], "valid")

    def test_fin_failure_is_cannot_validate_not_not_found(self):
        self.login(PROJECT_A, "A")
        FakeFinClient.probe_status = 500
        res = self.validate("A", {"finLivePoints": PROJECT_A["finLivePoints"]})
        self.assertEqual(res["blocks"]["finLivePoints"]["status"], "cannot_validate")
        self.assertTrue(res["valid"])   # nothing was proven missing

    def test_value_that_is_not_a_point_id_cannot_be_validated(self):
        self.login(PROJECT_A, "A")
        res = self.validate("A", {
            "finLivePoints": {"x": "p:{project}:r:1;drop"},
            "finEndpoints": {"y": "/api/{project}/eval?expr=readAll(point)"},
        })
        self.assertEqual(res["blocks"]["finLivePoints"]["items"]["x"]["status"], "cannot_validate")
        self.assertEqual(res["blocks"]["finEndpoints"]["items"]["y"]["status"], "cannot_validate")

    def test_no_project_mapping_is_not_configured_and_defaults_are_not_returned(self):
        self.login({}, "C")
        res = self.validate("C", {})
        for name, block in res["blocks"].items():
            self.assertEqual(block["status"], "not_configured", name)
            self.assertEqual(block["items"], {}, name)           # nothing from config.json
            self.assertTrue(block["backend_default"], name)      # but the UI is told a default applies
        self.assertNotIn("p:", str(res))                         # no point ID of the default config
        # empty values are the same as no mapping
        res = self.validate("C", {"finLivePoints": {}, "finEndpoints": None})
        self.assertEqual(res["blocks"]["finLivePoints"]["status"], "not_configured")

    def test_project_that_sets_a_block_is_not_backend_default(self):
        self.login(PROJECT_B, "B")
        res = self.validate("B", {})
        self.assertFalse(res["blocks"]["finLivePoints"]["backend_default"])
        self.assertTrue(res["blocks"]["finSeverityBands"]["backend_default"])

    def test_meter_profile_validated_against_equipment(self):
        self.login(PROJECT_A, "A")
        wait_for(lambda: self.http.get("/api/fin/building-info").json().get("Building_Info"))
        res = self.validate("A", {"finMeterProfile": PROJECT_A["finMeterProfile"]})
        items = res["blocks"]["finMeterProfile"]["items"]
        self.assertEqual(items["prefix"]["status"], "valid")           # PMU-1 exists
        self.assertEqual(items["active_power"]["status"], "valid")
        self.assertEqual(items["voltage"]["status"], "not_found")      # no point matches "volts"
        res = self.validate("A", {"finMeterProfile": {"prefix": "ZZZ", "point_map": {"active_power": ["active power"]}}})
        self.assertEqual(res["blocks"]["finMeterProfile"]["items"]["prefix"]["status"], "not_found")

    def test_meter_profile_before_first_read_cannot_be_validated(self):
        FakeFinClient.slow_realtime = True
        self.login(PROJECT_A, "A")
        res = self.validate("A", {"finMeterProfile": PROJECT_A["finMeterProfile"]})
        self.assertEqual(res["blocks"]["finMeterProfile"]["status"], "cannot_validate")

    def test_policy_blocks_have_nothing_to_check_against(self):
        self.login(PROJECT_A, "A")
        res = self.validate("A", {k: PROJECT_A[k] for k in ("finEquipmentClasses", "finSeverityBands")})
        self.assertEqual(res["blocks"]["finEquipmentClasses"]["status"], "cannot_validate")
        self.assertEqual(res["blocks"]["finSeverityBands"]["status"], "cannot_validate")

    # ── a project's FIN configuration is its own: no default site, no other project's name ──

    def test_project_with_no_fin_name_is_unconfigured_not_the_default_site(self):
        body = self.login({}, "C")                       # nothing saved for this project
        self.assertEqual(body["project"], "")
        self.assertIsNone(body["project_validated"])     # not checked: there is nothing to check
        self.assertEqual(body["project_source"], "unset")
        st = self.status()
        self.assertTrue(st["connected"])                 # signing in is a separate fact
        self.assertEqual((st["project_name"], st["display_name"], st["project_source"]), ("", "", "unset"))
        self.assertNotIn(main.BASE_CONFIG["project_name"], str(st))
        self.assertNotIn(main.BASE_CONFIG["display_name"], str(st))
        self.assertTrue(main.polling_tasks == [])        # nothing is polled for it
        self.assertEqual(FakeFinClient.probe_log, [])    # and FIN was not asked anything

    def test_unset_project_cannot_validate_its_points(self):
        self.login({}, "C")
        res = self.validate("C", {"finLivePoints": {"total_power": "p:{project}:r:111"}})
        item = res["blocks"]["finLivePoints"]["items"]["total_power"]
        self.assertEqual(item["status"], "cannot_validate")
        self.assertEqual(FakeFinClient.probe_log, [])

    def test_a_b_unset_a_each_has_its_own_fin_project(self):
        self.login(PROJECT_A, "A")
        self.assertEqual(self.status()["project_name"], "projA")
        self.switch(PROJECT_B, "B")
        self.assertEqual(self.status()["project_name"], "projB")
        self.switch({}, "C")
        self.assertEqual(self.status()["project_name"], "")
        self.switch(PROJECT_A, "A")
        self.assertEqual(self.status()["project_name"], "projA")
        self.assertEqual(self.status()["project_source"], "project")

    def test_name_typed_at_sign_in_survives_a_sync_of_that_project_only(self):
        self.login({"finLivePoints": {"total_power": "p:{project}:r:1"}}, "A", project_name="typedA")
        self.assertEqual(self.status()["project_name"], "typedA")
        # another setting of the same project changes: the session keeps the name it signed in with
        again = self.switch({"finLivePoints": {"total_power": "p:{project}:r:2"}}, "A")
        self.assertEqual((again["project"], again["project_source"]), ("typedA", "request"))
        # it never reaches another project, and is gone when coming back
        self.assertEqual(self.switch(PROJECT_B, "B")["project"], "projB")
        self.assertEqual(self.switch({}, "C")["project"], "")
        self.assertEqual(self.switch({}, "A")["project"], "")

    def test_fin_requests_carry_the_selected_projects_identifier(self):
        a = {**PROJECT_A, "finProjectName": "marsaAlArab", "finLivePoints": {"t": "p:{project}:r:111"}}
        b = {**PROJECT_B, "finProjectName": "ellisdonDemo", "finLivePoints": {"t": "p:{project}:r:222"}}
        self.login(a, "A")
        self.validate("A", {"finLivePoints": a["finLivePoints"]})
        self.switch(b, "B")
        self.validate("B", {"finLivePoints": b["finLivePoints"]})
        from urllib.parse import unquote
        calls = [(proj, unquote(ep)) for proj, ep in FakeFinClient.probe_log]
        mars = [ep for proj, ep in calls if proj == "marsaAlArab"]
        ellis = [ep for proj, ep in calls if proj == "ellisdonDemo"]
        self.assertTrue(mars and ellis)
        self.assertTrue(all(ep.startswith("/api/marsaAlArab/") for ep in mars), mars)
        self.assertTrue(all(ep.startswith("/api/ellisdonDemo/") for ep in ellis), ellis)
        self.assertIn("readById(@p:marsaAlArab:r:111)", " ".join(mars))
        self.assertIn("readById(@p:ellisdonDemo:r:222)", " ".join(ellis))
        self.assertFalse(any("ellisdonDemo" in ep for ep in mars))
        self.assertFalse(any("marsaAlArab" in ep for ep in ellis))

    def test_valid_not_found_and_cannot_validate_for_a_real_project_name(self):
        s = {"finProjectName": "ellisdonDemo",
             "finLivePoints": {"ok": "p:{project}:r:222", "gone": "p:{project}:r:999", "odd": "p:{project}:r:1;x"}}
        self.login(s, "B")
        items = self.validate("B", {"finLivePoints": s["finLivePoints"]})["blocks"]["finLivePoints"]["items"]
        self.assertEqual({k: v["status"] for k, v in items.items()},
                         {"ok": "valid", "gone": "not_found", "odd": "cannot_validate"})


    # ── isolation ──

    def test_a_b_a_validation_follows_the_active_project(self):
        FakeFinClient.missing_points = {"p:projA:r:112"}   # only A's temperature is missing
        self.login(PROJECT_A, "A")
        a = self.validate("A", {"finLivePoints": PROJECT_A["finLivePoints"]})
        self.assertEqual(a["blocks"]["finLivePoints"]["items"]["temperature"]["status"], "not_found")
        self.assertEqual(a["project_name"], "projA")

        self.switch(PROJECT_B, "B")
        b = self.validate("B", {"finLivePoints": PROJECT_B["finLivePoints"]})
        self.assertEqual(b["blocks"]["finLivePoints"]["items"], {"total_power": {"status": "valid"}})
        self.assertEqual(b["project_name"], "projB")
        self.assertTrue(b["valid"])                       # A's invalid mapping does not leak into B

        self.switch(PROJECT_A, "A")
        a2 = self.validate("A", {"finLivePoints": PROJECT_A["finLivePoints"]})
        self.assertEqual(a2["blocks"]["finLivePoints"]["items"]["temperature"]["status"], "not_found")

    def test_other_projects_mappings_are_refused(self):
        self.login(PROJECT_B, "B")
        # the backend serves B; a request about A must not be answered with B's FIN project
        self.validate("A", {"finLivePoints": PROJECT_A["finLivePoints"]}, expect=409)
        self.validate(None, {"finLivePoints": PROJECT_A["finLivePoints"]}, expect=409)

    def test_validation_changes_nothing(self):
        self.login(PROJECT_A, "A")
        before = (main.PROJECT_NAME, dict(main.CONFIG["live_point_ids"]), list(main.ACTIVE_OVERRIDES))
        self.validate("A", {"finLivePoints": {"zzz": "p:{project}:r:999"}})
        self.assertEqual(before, (main.PROJECT_NAME, dict(main.CONFIG["live_point_ids"]), list(main.ACTIVE_OVERRIDES)))

    def test_normal_project_does_not_inherit_a_fin_projects_mappings(self):
        self.login(PROJECT_A, "A")
        self.switch({}, "N")                              # a normal project has no FIN settings
        res = self.validate("N", {})
        self.assertTrue(all(b["status"] == "not_configured" for b in res["blocks"].values()))
        self.assertNotIn("projA", str(res["blocks"]))


if __name__ == "__main__":
    unittest.main()
