"""FIN project discovery (GET /api/sys/eval?expr=...) and per-project resources.

Run from backend/:   python -m unittest discover -s tests -v
FinScramClient is replaced by tests/fake_fin.py, so no FIN server is needed.
"""
import copy
import os
import re
import sys
import unittest
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import main  # noqa: E402
from fake_fin import FakeFinClient  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

EXPR = "secureEval(projs())"      # the expression the FIN Host page evaluates
IDS = ["adnocWarsan", "ellisdonDemo", "khaznaDataCenter", "marsaAlArab"]
A = {"finProjectName": "marsaAlArab", "finLivePoints": {"total_power": "p:{project}:r:111"}}
B = {"finProjectName": "ellisdonDemo", "finLivePoints": {"total_power": "p:{project}:r:222"}}

GRID = (
    'ver:"3.0"\n'
    'id,type,dis,route,routeStatus,readRoutes,readRouteStatus,created,doc,version,routeErr,backup,'
    'name hidden,projMeta hidden,mod hidden\n'
    '@p:adnocWarsan,"local","adnocWarsan"' + ',' * 12 + '\n'
    '@p:ellisdonDemo,"local","ellisdonDemo"' + ',' * 12 + '\n'
    '@p:khaznaDataCenter,"local","KHAZNA DATA CENTER"' + ',' * 12 + '\n'
    '@p:marsaAlArab,"local","marsaAlArab"' + ',' * 12 + '\n'
)


class FinProjectDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self._real_client = main.FinScramClient
        self._real_discovery = copy.deepcopy(main.BASE_CONFIG.get("project_discovery"))
        main.FinScramClient = FakeFinClient
        main.BASE_CONFIG["project_discovery"] = {"method": "GET", "endpoint": "/api/sys/eval", "expr": EXPR}
        self._reset_fake()
        self.http = TestClient(main.app)
        self.http.__enter__()

    def tearDown(self):
        self.http.post("/api/fin/logout")
        self.http.__exit__(None, None, None)
        main.FinScramClient = self._real_client
        main.BASE_CONFIG["project_discovery"] = self._real_discovery
        main.apply_project_settings(None)
        self._reset_fake()

    @staticmethod
    def _reset_fake():
        FakeFinClient.probe_log = []
        FakeFinClient.discovery_log = []
        FakeFinClient.discovery_status = None
        FakeFinClient.discovery_unreachable = False
        FakeFinClient.unknown_projects = set()
        FakeFinClient.probe_status = None
        FakeFinClient.projects_text = GRID

    def login(self, settings=None, project_id="A"):
        r = self.http.post("/api/fin/login", json={
            "username": "u", "password": "p", "settings": A if settings is None else settings, "project_id": project_id})
        self.assertEqual(r.status_code, 200, r.text)

    def projects(self, expect=200):
        r = self.http.get("/api/fin/projects")
        self.assertEqual(r.status_code, expect, r.text)
        return r.json()

    # ── discovery ──

    def test_projects_are_discovered_with_ids_and_display_names(self):
        self.login()
        body = self.projects()
        self.assertEqual([p["id"] for p in body["projects"]], IDS)
        # display name -> identifier: the dropdown shows the name and stores the id
        self.assertEqual({p["id"]: p["name"] for p in body["projects"]}, {
            "adnocWarsan": "adnocWarsan", "ellisdonDemo": "ellisdonDemo",
            "khaznaDataCenter": "KHAZNA DATA CENTER", "marsaAlArab": "marsaAlArab"})

    def test_discovery_is_a_get_with_the_expression_as_a_query_parameter(self):
        self.login()
        self.projects()
        (_, endpoint, params), = FakeFinClient.discovery_log
        self.assertEqual(endpoint, "/api/sys/eval")
        self.assertEqual(params, {"expr": "secureEval(projs())"})

    def test_a_non_get_method_in_config_is_refused_without_calling_fin(self):
        main.BASE_CONFIG["project_discovery"] = {"method": "POST", "endpoint": "/api/sys/eval", "expr": EXPR}
        self.login()
        self.assertIn("not configured", self.projects(expect=503)["detail"])
        self.assertEqual(FakeFinClient.discovery_log, [])

    def test_response_carries_no_credentials(self):
        self.login()
        text = str(self.projects()).lower()
        for secret in ("authorization", "cookie", "scram", "password", "handshake"):
            self.assertNotIn(secret, text)

    def test_only_project_records_are_listed(self):
        FakeFinClient.projects_text = (
            'ver:"3.0"\nid,type,dis\n@u:bob,"x","Bob"\n@p:marsaAlArab,"local","MARSA"\n'
            '@p:marsaAlArab,"local","MARSA again"\n')
        self.login()
        self.assertEqual(self.projects()["projects"], [{"id": "marsaAlArab", "name": "MARSA"}])

    def test_empty_project_list(self):
        FakeFinClient.projects_text = 'ver:"3.0"\nid,type,dis\n'
        self.login()
        self.assertEqual(self.projects()["projects"], [])

    def test_fin_failures_are_reported_not_hidden(self):
        self.login()
        FakeFinClient.discovery_status = 500
        self.assertIn("500", self.projects(expect=502)["detail"])
        FakeFinClient.discovery_status = 403
        self.assertEqual(self.projects(expect=403)["detail"], "FIN did not allow this account to read project list.")
        FakeFinClient.discovery_status = None
        FakeFinClient.discovery_unreachable = True
        self.assertEqual(self.projects(expect=502)["detail"], "FIN could not be reached.")
        FakeFinClient.discovery_unreachable = False
        FakeFinClient.projects_text = 'ver:"3.0" err dis:"denied"\nempty\n'
        self.assertIn("error", self.projects(expect=502)["detail"])

    def test_not_configured_until_the_request_is_set(self):
        main.BASE_CONFIG["project_discovery"] = {"method": "GET", "endpoint": "/api/sys/eval", "expr": ""}
        self.login()
        self.assertIn("not configured", self.projects(expect=503)["detail"])
        self.assertEqual(FakeFinClient.discovery_log, [])      # nothing was sent to FIN

    def test_discovery_needs_a_session(self):
        self.assertEqual(self.http.get("/api/fin/projects").status_code, 401)
        self.assertEqual(self.http.get("/api/fin/resources?project=marsaAlArab").status_code, 401)

    def test_discovery_does_not_change_the_project_the_session_serves(self):
        self.login()
        self.projects()
        st = self.http.get("/api/fin/status").json()
        self.assertEqual((st["project_name"], st["project_id"]), ("marsaAlArab", "A"))

    def test_shipped_config_has_no_hardcoded_project_list(self):
        with open(main.CONFIG_PATH, encoding="utf-8") as handle:
            cfg = main.json.load(handle)
        text = main.json.dumps(cfg["project_discovery"])
        for pid in IDS:
            self.assertNotIn(pid, text)
        self.assertEqual(cfg["project_discovery"], {**cfg["project_discovery"],
                                                    "method": "GET", "endpoint": "/api/sys/eval", "expr": EXPR})

    # ── per-project resources ──

    def test_resources_belong_to_the_selected_project_only(self):
        self.login(A, "A")                                         # the session serves marsaAlArab
        res = self.http.get("/api/fin/resources?project=ellisdonDemo").json()
        self.assertEqual(res["project"], "ellisdonDemo")
        self.assertEqual([r["id"] for r in res["resources"]], ["p:ellisdonDemo:r:111", "p:ellisdonDemo:r:222"])
        # stored as {project}, so the same mapping resolves to whichever project it is saved in
        self.assertEqual([r["ref"] for r in res["resources"]], ["p:{project}:r:111", "p:{project}:r:222"])
        first = res["resources"][0]
        self.assertEqual((first["name"], first["equip"], first["unit"], first["his"]), ("Total Power", "EQ-1", "kW", True))
        self.assertNotIn("marsaAlArab", str(res))
        # asking about another project did not move the session
        self.assertEqual(self.http.get("/api/fin/status").json()["project_name"], "marsaAlArab")

    def test_mapping_schema_lists_each_blocks_keys_and_no_values(self):
        schema = self.http.get("/api/fin/mapping-schema").json()
        base = main.BASE_CONFIG
        self.assertEqual(schema["finLivePoints"], list(base["live_point_ids"]))
        self.assertEqual(schema["finEndpoints"], list(base["power_endpoints"]))
        self.assertEqual(schema["finEquipmentClasses"], ["system_tags", "meter_tags", "type_priority"])
        self.assertEqual(schema["finMeterProfile"], list(base["meter_profile"]["point_map"]))
        self.assertTrue(all(schema[f] for f in schema))
        # names only: not one point ID, endpoint, tag, alias, prefix or severity value
        text = main.json.dumps(schema)
        for value in ("p:{project}", "hisRead", "/api/", "ahu", "kwh", '"PMU"', "250", "desc", "_comment"):
            self.assertNotIn(value, text)

    def test_mapping_schema_names_config_json_site_but_verifies_nothing_without_a_session(self):
        schema = self.http.get("/api/fin/mapping-schema").json()
        self.assertEqual(schema["standardProfile"], main.BASE_CONFIG["project_name"])   # a name, not a verification
        self.assertNotIn("standardProject", schema)                                      # no session: nothing verified
        main.PROJECT_MAPPINGS_DYNAMIC = True
        try:
            self.assertNotIn("standardProfile", self.http.get("/api/fin/mapping-schema").json())
        finally:
            main.PROJECT_MAPPINGS_DYNAMIC = False

    def test_mapping_schema_is_the_same_whichever_project_is_open(self):
        before = self.http.get("/api/fin/mapping-schema").json()
        self.login(B, "B")
        self.assertEqual(self.http.get("/api/fin/mapping-schema").json(), before)

    def test_resources_carry_points_only(self):
        self.login(A, "A")
        self.assertEqual(set(self.http.get("/api/fin/resources?project=ellisdonDemo").json()),
                         {"project", "resources", "truncated"})

    def test_resource_requests_carry_the_selected_projects_identifier(self):
        self.login(A, "A")
        FakeFinClient.probe_log = []
        self.http.get("/api/fin/resources?project=ellisdonDemo")
        self.http.get("/api/fin/resources?project=marsaAlArab")
        eps = [unquote(ep) for _, ep in FakeFinClient.probe_log]
        self.assertTrue(eps[0].startswith("/api/ellisdonDemo/eval"), eps)
        self.assertTrue(eps[1].startswith("/api/marsaAlArab/eval"), eps)

    def test_resources_for_unknown_or_malformed_project(self):
        self.login()
        self.assertEqual(self.http.get("/api/fin/resources?project=ghost").status_code, 404)
        self.assertEqual(self.http.get("/api/fin/resources?project=a/../b").status_code, 400)
        self.assertEqual(self.http.get("/api/fin/resources?project=").status_code, 400)

    # ── a project's mapping is checked against its own project ──

    def test_a_b_a_validation_uses_each_projects_identifier(self):
        def validate(settings, pid):
            self.http.post("/api/fin/validate-mapping", json={"project_id": pid, "blocks": {"finLivePoints": settings["finLivePoints"]}})

        self.login(A, "A")
        validate(A, "A")
        self.http.post("/api/fin/project-settings", json={"settings": B, "project_id": "B"})
        validate(B, "B")
        self.http.post("/api/fin/project-settings", json={"settings": A, "project_id": "A"})
        validate(A, "A")
        # the validated points only (sign-in also reads one of config.json's records: main._serves_standard_site)
        reads = [(p, unquote(ep)) for p, ep in FakeFinClient.probe_log
                 if "readById" in unquote(ep) and re.search(r":r:(111|222)\)", unquote(ep))]
        self.assertEqual([p for p, _ in reads], ["marsaAlArab", "ellisdonDemo", "marsaAlArab"])
        self.assertIn("/api/marsaAlArab/eval?expr=readById(@p:marsaAlArab:r:111)", reads[0][1])
        self.assertIn("/api/ellisdonDemo/eval?expr=readById(@p:ellisdonDemo:r:222)", reads[1][1])
        self.assertIn("/api/marsaAlArab/eval?expr=readById(@p:marsaAlArab:r:111)", reads[2][1])

    def test_project_with_no_fin_configuration_stays_unconfigured(self):
        self.login({}, "N")
        st = self.http.get("/api/fin/status").json()
        self.assertEqual((st["project_name"], st["project_source"]), ("", "unset"))
        self.projects()                                            # the list is still there to choose from
        self.assertEqual(self.http.get("/api/fin/status").json()["project_name"], "")


class ParseFinProjectsTests(unittest.TestCase):
    """The parser on the real shape of the secureEval(projs()) answer: the header below is the one
    captured from the FIN Host, and the ids and `dis` values are the confirmed ones. Cells after
    `dis` were not captured, so they are left empty here."""

    HEADER = ('id,type,dis,route,routeStatus,readRoutes,readRouteStatus,created,doc,version,routeErr,backup,'
              'name hidden,projMeta hidden,mod hidden')
    TAIL = ',' * 12      # the 12 columns after `dis`

    def grid(self, rows):
        return 'ver:"3.0"\n' + self.HEADER + "\n" + "".join(f'@p:{pid},"local","{dis}"{self.TAIL}\n' for pid, dis in rows)

    CONFIRMED = [("adnocWarsan", "adnocWarsan"), ("ellisdonDemo", "ellisdonDemo"),
                 ("khaznaDataCenter", "KHAZNA DATA CENTER"), ("marsaAlArab", "marsaAlArab")]

    def test_ids_and_dis_names_from_the_real_header(self):
        got = main.parse_fin_projects(self.grid(self.CONFIRMED))
        self.assertEqual([(p["id"], p["name"]) for p in got], self.CONFIRMED)

    def test_name_comes_from_dis_not_from_type_or_the_hidden_name_column(self):
        text = ('ver:"3.0"\n' + self.HEADER + '\n@p:khaznaDataCenter,"local","KHAZNA DATA CENTER"' + ',' * 8 +
                ',"hidden internal name",,\n')
        (project,) = main.parse_fin_projects(text)
        self.assertEqual(project, {"id": "khaznaDataCenter", "name": "KHAZNA DATA CENTER"})

    def test_empty_dis_lists_the_identifier_not_an_invented_name(self):
        (project,) = main.parse_fin_projects(self.grid([("marsaAlArab", "")]))
        self.assertEqual(project, {"id": "marsaAlArab", "name": "marsaAlArab"})

    def test_a_nested_grid_in_a_cell_cannot_add_or_split_rows(self):
        text = (self.grid(self.CONFIRMED[:1]) +
                '@p:marsaAlArab,"local","marsaAlArab"' + ',' * 11 + ',<<ver:"3.0"\nid,x\n@p:ghost,"n"\n>>\n')
        self.assertEqual([p["id"] for p in main.parse_fin_projects(text)], ["adnocWarsan", "marsaAlArab"])

    def test_ids_are_never_taken_from_names(self):
        got = {p["name"]: p["id"] for p in main.parse_fin_projects(self.grid(self.CONFIRMED))}
        self.assertEqual(got["KHAZNA DATA CENTER"], "khaznaDataCenter")


if __name__ == "__main__":
    unittest.main()
