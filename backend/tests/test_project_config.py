"""Per-project FIN configuration in the backend.

Run from backend/:   python -m unittest discover -s tests -v
No FIN server needed: FinScramClient is replaced by tests/fake_fin.py.
"""
import json
import os
import re
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
# per-project mappings are tested on FIN projects other than config.json's own site, which is
# served config.json's standard mappings while main.PROJECT_MAPPINGS_DYNAMIC is off
PROJECT_A = {
    "finProjectName": "adnocWarsan",
    "finLivePoints": {"total_power": "p:{project}:r:111"},
    "finEndpoints": {"A_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:1,today())"},
    "finEquipmentClasses": {"system_tags": ["ahu"], "meter_tags": ["meter"], "type_priority": ["ahu"]},
    "finMeterProfile": {"prefix": "PMU", "point_map": {"active_power": ["active power"]}},
    "finSeverityBands": {"order": "desc", "critical": 250, "warning": 150},   # priority 200 -> warning
}
PROJECT_B = {
    "finProjectName": "ellisdonDemo",
    "finLivePoints": {"total_power": "p:{project}:r:222"},
    "finEndpoints": {"B_his": "/api/{project}/eval?expr=hisRead(@p:{project}:r:2,today())"},
    "finEquipmentClasses": {"system_tags": ["fcu"], "meter_tags": ["meter"], "type_priority": ["fcu"]},
    "finMeterProfile": {"prefix": "MTR", "point_map": {"active_power": ["active power"]}},
    "finSeverityBands": {"order": "asc", "critical": 300, "warning": 250},    # priority 200 -> critical
}


BLOCKS = ("live_point_ids", "power_endpoints", "equipment_classes", "meter_profile", "severity_bands")


# /power-live always carries these, read from equipment rather than from a live-point mapping
DERIVED_LIVE = {"timestamp", "carbon_emission", "avg_temp", "avg_hum", "avg_co2", "unit", "fdd", "facilityServices"}


def live_points(payload: dict) -> dict:
    """The live-point values in a /power-live answer (one per mapped key)."""
    return {k: v for k, v in payload.items() if k not in DERIVED_LIVE}


def site_ids() -> set:
    """Every point ID config.json's own site mappings name (live points and history endpoints)."""
    text = json.dumps([main.BASE_CONFIG["live_point_ids"], main.BASE_CONFIG["power_endpoints"]])
    return set(re.findall(r"r:([0-9a-f]{8}-[0-9a-f]{8})", text))


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
        FakeFinClient.missing_points = set()
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

    def runtime(self):
        """Everything the polling loops serve, once the first realtime poll has landed."""
        equip = wait_for(lambda: self.get("/api/fin/equip-live").get("equipment"))
        alarms = wait_for(lambda: self.get("/api/fin/alarms").get("alarms"))
        time.sleep(0.2)                           # one live poll after the switch
        return {
            "power_live": self.get("/api/fin/power-live"),
            "history": self.get("/api/fin/power-history"),
            "meters": self.get("/api/fin/pmu-live"),
            "eq1_type": next(e["type"] for e in equip if e["name"] == "EQ-1"),
            "severity": alarms[0]["severity"],
            "config": self.get("/api/fin/project-settings"),
        }

    def assert_no_site_values(self, served):
        text = json.dumps(served)
        leaked = [i for i in site_ids() if i in text]
        self.assertEqual(leaked, [], "config.json site point IDs reached a Studio project")

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

    # --- Studio projects: only their own mappings, never config.json's -----------------

    def assert_not_configured(self, cfg, blocks):
        for block in blocks:
            self.assertEqual(cfg["source"][block], "not_configured", block)
            self.assertEqual(cfg["config"][block], {}, block)

    def test_new_project_with_no_mappings_gets_no_site_values(self):
        self.login({"finProjectName": "khaznaDataCenter"}, "proj-new")
        served = self.runtime()
        self.assert_not_configured(served["config"], BLOCKS)
        self.assertEqual(live_points(served["power_live"]), {})        # no live point is read
        self.assertEqual(served["history"], {})           # no history endpoint is read
        self.assertEqual(served["meters"], {})            # no meter prefix, so no meters
        self.assertEqual(served["eq1_type"], "other")     # no type_priority to classify with
        self.assertEqual(served["severity"], "info")      # no bands: not graded on a site's numbers
        self.assert_no_site_values(served)

    # --- config.json's own site: standard mappings while PROJECT_MAPPINGS_DYNAMIC is off --------

    def assert_standard(self, cfg):
        for block in BLOCKS:
            self.assertEqual((cfg["source"][block], cfg["config"][block]), ("default", main.BASE_CONFIG[block]), block)

    def test_per_project_mappings_are_off(self):
        self.assertIs(main.PROJECT_MAPPINGS_DYNAMIC, False)

    def test_default_site_project_is_served_the_standard_mappings(self):
        # saved, partial and empty blocks alike: none of them replaces config.json's mapping
        for pid, settings in (("proj-none", {}), ("proj-partial", {"finLivePoints": {"total_power": "p:{project}:r:111"}}),
                              ("proj-empty", {"finLivePoints": {}, "finEndpoints": {}})):
            self.login({"finProjectName": main.BASE_CONFIG["project_name"], **settings}, pid)
            cfg = self.get("/api/fin/project-settings")
            self.assertEqual((cfg["project_id"], cfg["project_name"]), (pid, main.BASE_CONFIG["project_name"]))
            self.assert_standard(cfg)
        # the live loop polls config.json's keys (the fake FIN answers none of its IDs: null, never 0)
        live = wait_for(lambda: self.get("/api/fin/power-live").get("timestamp") and self.get("/api/fin/power-live"))
        self.assertIsNone(live["iaq_index"])
        self.assertTrue({"iaq_index", "comfort_compliance", "total_water", "total_gas", "hourly_energy"} <= set(live))

    def test_name_typed_at_sign_in_also_gets_the_standard_mappings(self):
        r = self.http.post("/api/fin/login", json={"username": "u", "password": "p", "project_id": "proj-typed",
                                                   "project_name": main.BASE_CONFIG["project_name"], "settings": {}})
        self.assertEqual(r.status_code, 200, r.text)
        self.assert_standard(self.get("/api/fin/project-settings"))

    def test_a_new_server_address_keeps_the_standard_mappings(self):
        # the FIN server's IP/URL changes: the site is recognised by its project and records, not its address
        for url in ("https://10.10.90.21", "https://fin.client.example:8443"):
            r = self.http.post("/api/fin/login", json={"username": "u", "password": "p", "server_url": url, "project_id": "proj-ip",
                                                       "settings": {"finProjectName": main.BASE_CONFIG["project_name"]}})
            self.assertEqual(r.status_code, 200, r.text)
            self.assert_standard(self.get("/api/fin/project-settings"))
            self.assertEqual(self.get("/api/fin/status")["server_url"], url)   # the session's server, not config.json's

    def test_same_name_without_the_sites_records_gets_no_site_mappings(self):
        # another tenant's "marsaAlArab": config.json's point records do not exist there
        name = main.BASE_CONFIG["project_name"]
        FakeFinClient.missing_points = {v.replace("{project}", name) for v in main.BASE_CONFIG["live_point_ids"].values()
                                        if isinstance(v, str)}
        self.login({"finProjectName": name, "finBaseUrl": "https://fin.other.example"}, "proj-elsewhere")
        served = self.runtime()
        self.assert_not_configured(served["config"], BLOCKS)
        self.assertEqual(live_points(served["power_live"]), {})
        self.assert_no_site_values(served)

    def test_switching_site_other_site_never_mixes_mappings(self):
        site = {"finProjectName": main.BASE_CONFIG["project_name"]}
        self.login(site, "proj-site")
        for settings, pid in ((PROJECT_B, "proj-B"), (site, "proj-site")):
            self.switch(settings, pid)
            cfg = self.get("/api/fin/project-settings")
            if pid == "proj-B":
                self.assertEqual(cfg["config"]["live_point_ids"], PROJECT_B["finLivePoints"])   # B's own, no Marsa IDs
            else:
                self.assert_standard(cfg)

    # --- mapping-schema: the standard profile is reported only once this server verified it ------

    def schema(self):
        return self.get("/api/fin/mapping-schema")

    def test_schema_reports_the_standard_profile_verified_on_this_server(self):
        self.login({"finProjectName": main.BASE_CONFIG["project_name"]}, "proj-site")
        s = self.schema()
        self.assertEqual((s.get("standardProject"), s.get("standardProjectId")), (main.BASE_CONFIG["project_name"], "proj-site"))
        self.assert_standard(self.get("/api/fin/project-settings"))                    # and it is what is served

    def test_schema_does_not_verify_the_same_name_on_another_tenant(self):
        # config.json's records are not on this server: same name, another site
        name = main.BASE_CONFIG["project_name"]
        FakeFinClient.missing_points = {v.replace("{project}", name) for v in main.BASE_CONFIG["live_point_ids"].values()
                                        if isinstance(v, str)}
        self.login({"finProjectName": name, "finBaseUrl": "https://fin.other.example"}, "proj-elsewhere")
        s = self.schema()
        self.assertNotIn("standardProject", s)
        self.assertNotIn("standardProjectId", s)
        self.assertEqual(s["standardProfile"], name)                                     # still named, for messages
        self.assert_not_configured(self.get("/api/fin/project-settings"), BLOCKS)        # and not served config.json's

    def test_schema_verification_follows_the_session(self):
        site = {"finProjectName": main.BASE_CONFIG["project_name"]}
        self.login(site, "proj-site")
        self.assertEqual(self.schema().get("standardProjectId"), "proj-site")
        self.switch(PROJECT_B, "proj-B")                                                 # another project: not verified
        self.assertNotIn("standardProject", self.schema())
        self.switch(site, "proj-site")                                                   # back, verified again
        self.assertEqual(self.schema().get("standardProjectId"), "proj-site")
        self.http.post("/api/fin/login", json={"username": "u", "password": "p"})        # a sign-in without the project
        self.assertNotIn("standardProject", self.schema())
        self.login(site, "proj-site")
        self.http.post("/api/fin/logout")
        self.assertNotIn("standardProject", self.schema())

    def test_dynamic_on_restores_per_project_mappings(self):
        main.PROJECT_MAPPINGS_DYNAMIC = True
        try:
            self.login({"finProjectName": main.BASE_CONFIG["project_name"]}, "proj-dyn")
            self.assert_not_configured(self.get("/api/fin/project-settings"), BLOCKS)
        finally:
            main.PROJECT_MAPPINGS_DYNAMIC = False

    def test_project_with_only_live_points(self):
        self.login({"finProjectName": "khaznaDataCenter", "finLivePoints": PROJECT_A["finLivePoints"]}, "proj-live")
        self.power(111)                                   # its own live point works
        served = self.runtime()
        self.assertEqual(served["config"]["source"]["live_point_ids"], "project")
        self.assertEqual(served["config"]["config"]["live_point_ids"], PROJECT_A["finLivePoints"])
        self.assert_not_configured(served["config"], [b for b in BLOCKS if b != "live_point_ids"])
        self.assertEqual((served["history"], served["meters"], served["severity"]), ({}, {}, "info"))
        self.assert_no_site_values(served)

    def test_partial_projects_a_b_a_never_fall_back_to_each_other(self):
        a = {"finProjectName": "khaznaDataCenter", "finLivePoints": PROJECT_A["finLivePoints"]}
        b = {"finProjectName": "ellisdonDemo", "finEndpoints": PROJECT_B["finEndpoints"],
             "finSeverityBands": PROJECT_B["finSeverityBands"]}
        self.login(a, "proj-A")
        for settings, pid in ((a, "proj-A"), (b, "proj-B"), (a, "proj-A")):
            self.switch(settings, pid)
            cfg = self.get("/api/fin/project-settings")
            self.assertEqual(cfg["project_id"], pid)
            own = {main.PROJECT_DICT_SETTINGS[k] for k in settings if k in main.PROJECT_DICT_SETTINGS}
            for block in BLOCKS:
                if block in own:
                    self.assertEqual(cfg["source"][block], "project", (pid, block))
                else:
                    self.assertEqual((cfg["source"][block], cfg["config"][block]), ("not_configured", {}), (pid, block))
            if pid == "proj-A":
                self.power(111)
                self.assertEqual(self.runtime()["history"], {})          # B's endpoints never reach A
            else:
                self.assertEqual(wait_for(lambda: sorted(self.get("/api/fin/power-history")) or None), ["B_his"])
                time.sleep(0.2)
                self.assertEqual(live_points(self.get("/api/fin/power-live")), {})    # A's live points never reach B

    def test_switching_to_an_unmapped_project_clears_the_previous_projects_mappings(self):
        self.login(PROJECT_A, "proj-A")
        self.assert_serves_a()
        self.switch({}, "proj-empty")             # e.g. a normal project with no Data Mapping
        cfg = self.get("/api/fin/project-settings")
        self.assertEqual(cfg["project_id"], "proj-empty")
        self.assert_not_configured(cfg, BLOCKS)

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

    def test_data_answers_are_stamped_with_the_project_they_were_polled_for(self):
        # the dashboard drops an answer stamped for another project (it can outlive a switch)
        paths = ("/api/fin/power-live", "/api/fin/equip-live", "/api/fin/power-history",
                 "/api/fin/pmu-live", "/api/fin/alarms", "/api/fin/documents", "/api/fin/workorders")
        self.login(PROJECT_A, "proj-A")
        for p in paths:
            self.assertEqual(self.http.get(p).headers.get(main.PROJECT_HEADER), "proj-A", p)
        self.switch(PROJECT_B, "proj-B")
        for p in paths:
            self.assertEqual(self.http.get(p).headers.get(main.PROJECT_HEADER), "proj-B", p)
        self.assert_serves_b()   # the stamp does not change the payload

    def test_work_orders_stay_with_their_own_site(self):
        # config.json's work-order query reads its own site's table: another project never runs it
        self.login({"finProjectName": main.BASE_CONFIG["project_name"]}, "proj-site")
        self.assertEqual(main.CONFIG["workorder_expr"], main.BASE_CONFIG["workorder_expr"])
        main.cached_workorders = {"orders": [{"id": "1", "equipment": "7"}], "error": ""}
        self.switch(PROJECT_A, "proj-A")
        self.assertEqual(main.CONFIG["workorder_expr"], "")
        self.assertEqual(self.get("/api/fin/workorders")["orders"], [])

    def test_manuals_are_only_listed_for_their_own_fin_project(self):
        def refs():
            fams = self.get("/api/fin/documents")["families"]
            return [f[k]["ref"] for f in fams for k in ("om", "warranty") if k in f]
        self.login({"finProjectName": main.BASE_CONFIG["project_name"]}, "proj-site")
        site_refs = refs()
        self.assertTrue(site_refs and all(r.startswith("@p:" + main.BASE_CONFIG["project_name"] + ":r:") for r in site_refs))
        self.switch({"finProjectName": "khaznaDataCenter"}, "proj-K")
        self.assertEqual(refs(), [], "another FIN project is not offered config.json's site manuals")
        r = self.http.get("/api/fin/file", params={"ref": site_refs[0]})
        self.assertEqual(r.status_code, 404, "nor can it open one through its own session")

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

    def test_bundled_project_keeps_config_json_for_blocks_it_does_not_set(self):
        # an exported backend ships config.json as the site's own configuration
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "project.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"projectId": "proj-sev", "apiSettings": {"finSeverityBands": PROJECT_B["finSeverityBands"]}}, f)
            main.PROJECT_JSON = path
            with TestClient(main.app) as fresh:
                self.assertEqual(main.CONFIG["severity_bands"], PROJECT_B["finSeverityBands"])
                for block in ("live_point_ids", "power_endpoints", "equipment_classes", "meter_profile"):
                    self.assertEqual(main.CONFIG[block], main.BASE_CONFIG[block], block)
                # the bundled sign-in page sends no settings, so that configuration stays in force
                fresh.post("/api/fin/login", json={"username": "u", "password": "p"})
                cfg = fresh.get("/api/fin/project-settings").json()
                self.assertEqual(cfg["source"]["severity_bands"], "project")
                for block in ("live_point_ids", "power_endpoints", "equipment_classes", "meter_profile"):
                    self.assertEqual((cfg["source"][block], cfg["config"][block]), ("default", main.BASE_CONFIG[block]))
                fresh.post("/api/fin/logout")

    def test_default_site_without_a_project_uses_config_json(self):
        main.apply_project_settings(None)
        self.http.post("/api/fin/login", json={"username": "u", "password": "p"})
        cfg = self.get("/api/fin/project-settings")
        self.assertTrue(all(v == "default" for v in cfg["source"].values()))
        for block in BLOCKS:
            self.assertEqual(cfg["config"][block], main.BASE_CONFIG[block])

    def test_missing_bundle_uses_config_json(self):
        main.PROJECT_JSON = os.path.join(tempfile.gettempdir(), "definitely-missing-project.json")
        with TestClient(main.app) as fresh:
            self.assertIsNone(fresh.get("/api/fin/config").json()["project_id"])
            self.assertEqual(main.CONFIG["live_point_ids"], main.BASE_CONFIG["live_point_ids"])


if __name__ == "__main__":
    unittest.main()
