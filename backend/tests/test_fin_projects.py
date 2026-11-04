"""FIN project discovery: GET /api/fin/projects and the grid parser behind it (parse_fin_projects).

The route asks FIN for the project list with GET {project_discovery.endpoint}?expr={project_discovery.expr}, read from
config.json, over the signed-in session. These tests use the fake FIN client, so no request leaves the process, and the
project identifiers in them are made up: the code under test must not know any project by name.

Run from backend/:  python -m unittest tests.test_fin_projects   (or: python -m pytest tests)
"""
import copy
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from chat_support import PROJECT_A, ChatTestBase  # noqa: E402
from fake_fin import FakeFinClient  # noqa: E402
import main  # noqa: E402
from fin_client import parse_fin_projects  # noqa: E402

# The column header FIN's project grid has; `dis` is the display name, `name` is a hidden internal column
HEADER = ('ver:"3.0"\n'
          'id,type,dis,route,routeStatus,readRoutes,readRouteStatus,created,doc,version,routeErr,backup,'
          'name hidden,projMeta hidden,mod hidden\n')
TAIL = ',' * 12   # the cells after `dis`


def grid(*rows):
    return HEADER + "".join(f"{r}{TAIL}\n" for r in rows)


def project_row(pid, dis):
    return f'@p:{pid},"local","{dis}"'


class ParserTests(unittest.TestCase):
    """parse_fin_projects on FIN's project grid."""

    def test_ids_and_display_names_come_from_the_id_and_dis_columns(self):
        text = grid(project_row("siteAlpha", "Site Alpha"), project_row("siteBeta", "SITE BETA DATA CENTER"))
        self.assertEqual(parse_fin_projects(text), [
            {"id": "siteAlpha", "name": "Site Alpha"},
            {"id": "siteBeta", "name": "SITE BETA DATA CENTER"},
        ])

    def test_any_well_formed_id_is_discovered_without_being_known_to_the_code(self):
        # hospital-style ids, with the characters a FIN project name may carry; none of these exists anywhere in the code
        ids = ["hospitalMain", "hospital_roof", "hospital.wing-2", "Hosp123"]
        found = parse_fin_projects(grid(*[project_row(i, i.upper()) for i in ids]))
        self.assertEqual(sorted(p["id"] for p in found), sorted(ids))
        self.assertEqual({p["id"]: p["name"] for p in found}["hospital.wing-2"], "HOSPITAL.WING-2")

    def test_projects_are_sorted_by_display_name_ignoring_case(self):
        text = grid(project_row("idC", "charlie"), project_row("idA", "Bravo"), project_row("idB", "alpha"))
        self.assertEqual([p["id"] for p in parse_fin_projects(text)], ["idB", "idA", "idC"])

    def test_a_project_seen_twice_is_listed_once_with_its_first_name(self):
        text = grid(project_row("siteAlpha", "First"), project_row("siteBeta", "Beta"), project_row("siteAlpha", "Second"))
        self.assertEqual(parse_fin_projects(text), [{"id": "siteBeta", "name": "Beta"}, {"id": "siteAlpha", "name": "First"}])

    def test_an_empty_display_name_falls_back_to_the_id_never_a_made_up_name(self):
        found = parse_fin_projects(grid(project_row("siteAlpha", ""), '@p:siteBeta,"local"'))
        self.assertEqual({p["id"]: p["name"] for p in found}, {"siteAlpha": "siteAlpha", "siteBeta": "siteBeta"})

    def test_a_whitespace_only_display_name_also_falls_back_to_the_id(self):
        self.assertEqual(parse_fin_projects(grid(project_row("siteAlpha", "   "))), [{"id": "siteAlpha", "name": "siteAlpha"}])

    def test_the_name_in_the_ref_is_used_when_the_dis_cell_is_empty(self):
        found = parse_fin_projects(grid('@p:siteAlpha "Alpha From Ref","local",""'))
        self.assertEqual(found, [{"id": "siteAlpha", "name": "Alpha From Ref"}])

    def test_rows_that_are_not_projects_are_ignored(self):
        text = grid(project_row("siteAlpha", "Alpha"), '@r:notAProject,"local","Other"', '"just text"', "@p:bad/id,\"local\",\"Bad\"")
        self.assertEqual([p["id"] for p in parse_fin_projects(text)], ["siteAlpha"])

    def test_crlf_line_endings_are_accepted(self):
        text = grid(project_row("siteAlpha", "Alpha"), project_row("siteBeta", "Beta")).replace("\n", "\r\n")
        self.assertEqual([p["id"] for p in parse_fin_projects(text)], ["siteAlpha", "siteBeta"])

    def test_an_empty_answer_has_no_projects(self):
        self.assertEqual(parse_fin_projects(""), [])
        self.assertEqual(parse_fin_projects(None), [])
        self.assertEqual(parse_fin_projects(HEADER), [])


class DiscoveryRouteTests(ChatTestBase):
    """GET /api/fin/projects over the fake FIN client."""

    def setUp(self):
        super().setUp()
        self._discovery = (copy.deepcopy(main.BASE_CONFIG.get("project_discovery")), copy.deepcopy(main.CONFIG.get("project_discovery")))
        self._fake = {k: getattr(FakeFinClient, k) for k in ("projects_text", "discovery_status", "discovery_unreachable")}
        FakeFinClient.discovery_status = None
        FakeFinClient.discovery_unreachable = False
        FakeFinClient.discovery_log.clear()
        self.login(PROJECT_A, "projA")
        FakeFinClient.discovery_log.clear()   # the sign-in's own reads are not the discovery under test

    def tearDown(self):
        for k, v in self._fake.items():
            setattr(FakeFinClient, k, v)
        FakeFinClient.discovery_log.clear()
        main.BASE_CONFIG["project_discovery"], main.CONFIG["project_discovery"] = self._discovery
        super().tearDown()

    def set_discovery(self, cfg):
        """Replace config.json's project_discovery (None removes it) for this test."""
        for target in (main.BASE_CONFIG, main.CONFIG):
            if cfg is None:
                target.pop("project_discovery", None)
            else:
                target["project_discovery"] = copy.deepcopy(cfg)

    def get(self):
        return self.http.get("/api/fin/projects")

    # 1. a successful GET discovery with the configured expression
    def test_discovery_is_a_get_of_secureEval_projs_on_the_configured_endpoint(self):
        FakeFinClient.projects_text = grid(project_row("siteAlpha", "Site Alpha"))
        r = self.get()
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(FakeFinClient.discovery_log, [("projA", "/api/sys/eval", {"expr": "secureEval(projs())"})])
        self.assertEqual(main.CONFIG["project_discovery"]["method"], "GET")

    def test_the_shipped_config_asks_for_secureEval_projs(self):
        cfg = self._discovery[1]
        self.assertEqual((cfg["method"], cfg["endpoint"], cfg["expr"]), ("GET", "/api/sys/eval", "secureEval(projs())"))

    def test_the_endpoint_and_expression_are_read_from_the_config(self):
        self.set_discovery({"method": "get", "endpoint": "/api/sys/eval", "expr": "projs()"})
        self.assertEqual(self.get().status_code, 200)
        self.assertEqual(FakeFinClient.discovery_log, [("projA", "/api/sys/eval", {"expr": "projs()"})])

    # 2. + 3. ids and names reach the client, for projects the code has never heard of
    def test_the_answer_lists_ids_and_display_names_and_the_fin_server(self):
        FakeFinClient.projects_text = grid(project_row("siteAlpha", "Site Alpha"), project_row("siteBeta", "SITE BETA"))
        body = self.get().json()
        self.assertEqual(body["projects"], [{"id": "siteAlpha", "name": "Site Alpha"}, {"id": "siteBeta", "name": "SITE BETA"}])
        self.assertEqual(body["server_url"], main.client.base_url)

    def test_a_hospital_style_project_is_discovered_next_to_another_site(self):
        FakeFinClient.projects_text = grid(project_row("hospitalMain", "Main Hospital"), project_row("siteAlpha", "Site Alpha"))
        found = {p["id"]: p["name"] for p in self.get().json()["projects"]}
        self.assertEqual(found, {"hospitalMain": "Main Hospital", "siteAlpha": "Site Alpha"})

    def test_the_shipped_config_names_no_project_to_discover(self):
        # discovery is by what FIN answers, so neither the endpoint nor the expression may carry a project id
        cfg = self._discovery[1]
        self.assertNotIn("{project}", cfg["endpoint"] + cfg["expr"])
        self.assertEqual(sorted(k for k in cfg if not k.startswith("_")), ["endpoint", "expr", "method"])

    # 7. duplicates and empty display names through the route
    def test_duplicates_and_empty_names_are_handled_in_the_answer(self):
        FakeFinClient.projects_text = grid(
            project_row("siteAlpha", "Site Alpha"), project_row("siteAlpha", "Again"), project_row("siteBeta", ""))
        found = self.get().json()["projects"]
        self.assertEqual({p["id"]: p["name"] for p in found}, {"siteAlpha": "Site Alpha", "siteBeta": "siteBeta"})
        self.assertEqual(len(found), 2)

    # 4. FIN refuses
    def test_a_fin_403_is_a_403_and_not_a_401(self):
        # 401 would tell the browser its Eko-DT session ended, which it has not
        for status in (401, 403):
            FakeFinClient.discovery_status = status
            r = self.get()
            self.assertEqual(r.status_code, 403, (status, r.text))
            self.assertIn("project list", r.json()["detail"])

    def test_other_fin_errors_are_a_502_naming_the_status(self):
        for status in (500, 503):
            FakeFinClient.discovery_status = status
            r = self.get()
            self.assertEqual(r.status_code, 502, (status, r.text))
            self.assertIn(str(status), r.json()["detail"])

    def test_a_fin_404_is_a_404(self):
        FakeFinClient.discovery_status = 404
        self.assertEqual(self.get().status_code, 404)

    def test_a_fin_error_grid_is_a_502(self):
        FakeFinClient.projects_text = 'ver:"3.0" err dis:"Unknown func: projs"\nempty\n'
        r = self.get()
        self.assertEqual(r.status_code, 502, r.text)
        self.assertEqual(r.json()["detail"], "FIN returned an error for the project list.")

    # 5. FIN down
    def test_an_unreachable_fin_is_a_502(self):
        FakeFinClient.discovery_unreachable = True
        r = self.get()
        self.assertEqual(r.status_code, 502, r.text)
        self.assertEqual(r.json()["detail"], "FIN could not be reached.")

    # 6. missing or invalid project_discovery configuration: a 503 before any request to FIN
    def test_a_missing_or_invalid_discovery_config_is_a_503_and_asks_fin_nothing(self):
        bad = {
            "missing": None,
            "empty": {},
            "no endpoint": {"method": "GET", "expr": "secureEval(projs())"},
            "blank endpoint": {"method": "GET", "endpoint": "  ", "expr": "secureEval(projs())"},
            "no expr": {"method": "GET", "endpoint": "/api/sys/eval"},
            "blank expr": {"method": "GET", "endpoint": "/api/sys/eval", "expr": ""},
            "POST is not supported": {"method": "POST", "endpoint": "/api/sys/eval", "expr": "secureEval(projs())"},
            "not an object": "GET /api/sys/eval",
        }
        for label, cfg in bad.items():
            with self.subTest(label):
                self.set_discovery(cfg)
                FakeFinClient.discovery_log.clear()
                r = self.get()
                self.assertEqual(r.status_code, 503, r.text)
                self.assertIn("project_discovery", r.json()["detail"])
                self.assertEqual(FakeFinClient.discovery_log, [])

    def test_a_missing_method_defaults_to_get(self):
        self.set_discovery({"endpoint": "/api/sys/eval", "expr": "secureEval(projs())"})
        self.assertEqual(self.get().status_code, 200)
        self.assertEqual(len(FakeFinClient.discovery_log), 1)

    # the route is for signed-in users, and read-only
    def test_without_a_session_nothing_is_asked_of_fin(self):
        self.http.cookies.clear()
        r = self.get()
        self.assertEqual(r.status_code, 401, r.text)
        self.assertEqual(FakeFinClient.discovery_log, [])

    def test_discovery_only_reads(self):
        for method in ("post", "put", "delete", "patch"):
            self.assertEqual(getattr(self.http, method)("/api/fin/projects").status_code, 405, method)
        self.assertEqual(FakeFinClient.discovery_log, [])


if __name__ == "__main__":
    unittest.main()
