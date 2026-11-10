"""GET /api/fin/documents: the O&M and warranty catalogue of the signed-in user's own, validated project.

Run from backend/:   python -m unittest tests.test_fin_documents
The audit found the route open to anyone (no session) and choosing its catalogue by the backend's mutable PROJECT_NAME. It now needs the same session
and project checks as the notification and chat routes, and lists only what belongs to the project the session signed in for and FIN validated.
`om-warranty.json` is the Marsa catalogue: every manual in it is a record of FIN project marsaAlArab. The repo has no catalogue for EKO HOSPITAL, so the
Hospital's list is empty; that is what the code and the current configuration support, nothing is invented for it. Fake FIN, no network.
"""
import json
import os
import re
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import main  # noqa: E402
from chat_support import PROJECT_A, ChatTestBase  # noqa: E402
from fake_fin import FakeFinClient  # noqa: E402

MARSA = dict(PROJECT_A, finProjectName="marsaAlArab")
HOSPITAL = {"finProjectName": "ekoHospital", "finBaseUrl": "https://10.207.200.85", "finDisplayName": "EKO HOSPITAL"}
REF = re.compile(r"@p:([A-Za-z0-9_]+):r:")


def refs_of(body):
    return [REF.match(d["ref"]).group(1) for fam in body["families"] for kind in ("om", "warranty") for d in [fam.get(kind)] if d]


class DocumentsTests(ChatTestBase):
    def test_the_authorised_project_gets_its_own_catalogue(self):
        self.login(MARSA, "proj-marsa")
        r = self.http.get("/api/fin/documents")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertGreater(len(body["families"]), 0)
        self.assertGreater(len(refs_of(body)), 0)
        self.assertEqual(set(refs_of(body)), {"marsaAlArab"})
        self.assertEqual(r.headers["X-Eko-Project"], "proj-marsa")                       # stamped for the project it was read for, as before
        for fam in body["families"]:
            for kind in ("om", "warranty"):
                if fam.get(kind):
                    self.assertTrue(fam[kind]["url"].startswith("/api/fin/file?ref="), fam[kind])

    def test_without_a_session_nothing_is_listed(self):
        self.login(MARSA, "proj-marsa")
        self.http.cookies.clear()
        r = self.http.get("/api/fin/documents")
        self.assertEqual(r.status_code, 401)
        self.assertNotIn("families", r.text)
        self.assertNotIn("marsaAlArab", r.text)

    def test_without_the_backend_connected_to_fin_nothing_is_listed(self):
        self.login(MARSA, "proj-marsa")
        self.http.post("/api/fin/logout")
        r = self.http.get("/api/fin/documents")
        self.assertEqual(r.status_code, 401)
        self.assertNotIn("families", r.text)

    def test_a_session_for_another_project_is_refused_the_catalogue(self):
        self.login(MARSA, "proj-marsa")
        marsa_cookies = list(self.http.cookies.jar)
        self.http.cookies.clear()
        self.login(HOSPITAL, "proj-hospital")                      # the backend now serves the Hospital
        self.http.cookies.clear()
        for c in marsa_cookies:                                    # a browser still holding the session it signed in with for Marsa
            self.http.cookies.jar.set_cookie(c)
        r = self.http.get("/api/fin/documents")
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("signed in for another project", r.json()["detail"])
        self.assertNotIn("families", r.text)
        self.assertNotIn("marsaAlArab", r.text)

    def test_the_hospital_is_listed_nothing_it_does_not_have(self):
        self.login(HOSPITAL, "proj-hospital")
        r = self.http.get("/api/fin/documents")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(refs_of(body), [])
        self.assertNotIn("marsaAlArab", json.dumps(body))
        self.assertEqual(body, {"families": []})                   # the only catalogue configured is Marsa's: the Hospital has none

    def test_the_catalogue_follows_the_validated_session_project_not_the_mutable_global(self):
        self.login(HOSPITAL, "proj-hospital")
        with mock.patch.object(main, "PROJECT_NAME", "marsaAlArab"):        # a global that drifted to the other project
            body = self.http.get("/api/fin/documents").json()
        self.assertEqual(body, {"families": []})
        self.login(MARSA, "proj-marsa")
        with mock.patch.object(main, "PROJECT_NAME", "ekoHospital"):
            body = self.http.get("/api/fin/documents").json()
        self.assertGreater(len(refs_of(body)), 0)
        self.assertEqual(set(refs_of(body)), {"marsaAlArab"})

    def test_a_project_fin_did_not_validate_is_listed_nothing(self):
        with mock.patch.object(FakeFinClient, "unknown_projects", {"ekoHospital"}):
            self.login(HOSPITAL, "proj-hospital")
            r = self.http.get("/api/fin/documents")
        self.assertEqual(r.status_code, 409)
        self.assertIn("not validated", r.json()["detail"])
        self.assertNotIn("families", r.text)

    def test_the_file_route_keeps_its_own_protections(self):
        marsa_ref = refs_of_catalogue_first_ref()
        self.login(HOSPITAL, "proj-hospital")
        r = self.http.get("/api/fin/file", params={"ref": marsa_ref})        # another project's manual, asked for by a Hospital session
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.http.get("/api/fin/file", params={"ref": "@p:ekoHospital:r:00000000-00000000"}).status_code, 404)
        self.assertEqual(self.http.get("/api/fin/file", params={"ref": "not a ref"}).status_code, 404)
        self.http.cookies.clear()
        self.assertEqual(self.http.get("/api/fin/file", params={"ref": marsa_ref}).status_code, 401)

    def test_load_documents_only_lists_the_project_it_is_given(self):
        self.assertEqual(main.load_documents("ekoHospital"), {"families": []})
        self.assertEqual(main.load_documents("someOtherProject"), {"families": []})
        self.assertEqual(set(refs_of(main.load_documents("marsaAlArab"))), {"marsaAlArab"})
        with mock.patch.object(main, "PROJECT_NAME", "marsaAlArab"):
            self.assertEqual(set(refs_of(main.load_documents())), {"marsaAlArab"})        # no argument: the active project, as before


def refs_of_catalogue_first_ref():
    with open(os.path.join(HERE, "..", "om-warranty.json"), encoding="utf-8") as f:
        raw = json.load(f)
    for fam in raw["families"]:
        for kind in ("om", "warranty"):
            if isinstance(fam.get(kind), dict) and fam[kind].get("ref"):
                return fam[kind]["ref"]
    raise AssertionError("the shipped catalogue has no manual")


if __name__ == "__main__":
    unittest.main()
