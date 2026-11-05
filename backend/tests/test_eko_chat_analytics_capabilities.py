"""Eko-Chat Phase 2: the capability registry after the analytics tools: available, partially available, missing mapping and not supported, per project.

Run from backend/:   python -m unittest tests.test_eko_chat_analytics_capabilities
A capability is `available` when its tool answers it, `partial` when it answers it with a stated limit (the alarm records are those of FIN's latest read,
a metric has no point in this project's equipment), `unmapped` when the project has nothing it needs, `not_supported` when nothing answers it. Everything
about a project comes from its own mapping names and its own equipment points, never from another project and never a point ID.
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_capabilities as caps  # noqa: E402
import main  # noqa: E402
from test_eko_chat_points import eq, pt, view  # noqa: E402
from test_eko_chat_projects import HOSPITAL, HOSPITAL_ID, MARSA, MARSA_ID, ProjectChatBase  # noqa: E402

ALL = {"equipment": 4, "metrics": {m: {"label": m.title(), "points": 3, "with_readings": 3} for m in ("temperature", "humidity", "co2", "power")}}


def row(rows, cid):
    return next(r for r in rows if r["id"] == cid)


def covered(**points):
    out = {"equipment": 4, "metrics": {m: {"label": m.upper() if m == "co2" else m.title(), "points": 0, "with_readings": 0} for m in ALL["metrics"]}}
    for m, n in points.items():
        out["metrics"][m].update(points=n, with_readings=n)
    return out


class RegistryTests(unittest.TestCase):
    def test_the_four_statuses(self):
        self.assertEqual((caps.AVAILABLE, caps.PARTIAL, caps.UNMAPPED, caps.NOT_SUPPORTED), ("available", "partial", "unmapped", "not_supported"))

    def test_the_new_capabilities_name_their_tools(self):
        expected = {"equipment.compare": "compare_equipment", "points.search": "search_points", "analytics.metric": "calculate_metric",
                    "alarms.history_summary": "get_alarm_history"}
        for cid, tool in expected.items():
            self.assertEqual(caps.get(cid)["tool"], tool, cid)
            self.assertIn(tool, eko_chat.TOOLS)

    def test_what_is_not_built_is_still_said_not_supported(self):
        c = caps.get("analytics.point_history")
        self.assertEqual((c["status"], c["reason"]), (caps.NOT_SUPPORTED, "planned"))
        self.assertIn("stored point history is not read", c["note"])

    def test_the_alarm_summary_is_partial_whatever_the_mapping(self):
        rows = caps.evaluate({"finSeverityBands": True})
        r = row(rows, "alarms.history_summary")
        self.assertEqual(r["status"], caps.PARTIAL)
        self.assertTrue(any("not an archive" in m for m in r["limitations"]))
        self.assertFalse(any("severity" in m.lower() for m in r["limitations"]))

    def test_without_severity_bands_the_alarm_summary_says_it_has_no_severity_breakdown(self):
        r = row(caps.evaluate({"finSeverityBands": False}), "alarms.history_summary")
        self.assertEqual(r["status"], caps.PARTIAL)
        self.assertTrue(any("No severity bands are mapped" in m and "breakdown" in m for m in r["limitations"]), r["limitations"])

    def test_every_metric_present_is_available(self):
        rows = caps.evaluate({}, [], ALL)
        for cid in ("points.search", "analytics.metric"):
            r = row(rows, cid)
            self.assertEqual((r["status"], r["limitations"]), (caps.AVAILABLE, []), cid)

    def test_a_metric_with_no_point_makes_it_partial_and_names_the_metric(self):
        cov = covered(temperature=3, humidity=2)
        r = row(caps.evaluate({}, [], cov), "analytics.metric")
        self.assertEqual(r["status"], caps.PARTIAL)
        self.assertEqual(r["limitations"], ["No equipment point in this project is named like CO2, Power, so those cannot be calculated."])

    def test_no_point_for_any_metric_is_a_missing_mapping_naming_each(self):
        r = row(caps.evaluate({}, [], covered()), "points.search")
        self.assertEqual(r["status"], caps.UNMAPPED)
        self.assertEqual([m["key"] for m in r["missing"]], ["temperature", "humidity", "co2", "power"])
        self.assertTrue(all(m["mapping"] == "equipmentPoints" for m in r["missing"]))
        self.assertIn("no point name contains co2", caps.where(r["missing"][2]))

    def test_unread_equipment_claims_nothing(self):
        r = row(caps.evaluate({}, [], None), "analytics.metric")
        self.assertEqual((r["status"], r["limitations"], r["missing"]), (caps.AVAILABLE, [], []))

    def test_points_that_exist_but_report_nothing_are_said_not_hidden(self):
        cov = covered(temperature=3, humidity=2, co2=1, power=1)
        cov["metrics"]["co2"]["with_readings"] = 0
        r = row(caps.evaluate({}, [], cov), "analytics.metric")
        self.assertEqual(r["status"], caps.AVAILABLE)
        self.assertEqual(r["limitations"], ["CO2 has points, but none has a usable reading in the latest read."])

    def test_the_summary_counts_every_status_and_every_area(self):
        rows = caps.evaluate({"finSeverityBands": True}, [], covered(temperature=1))
        s = caps.summary(rows)
        self.assertEqual(sum(s["counts"].values()), len(caps.CAPABILITIES))
        self.assertEqual(set(s["counts"]), {"available", "partial", "unmapped", "not_supported"})
        self.assertGreaterEqual(s["counts"]["partial"], 2)
        for a in s["areas"]:
            self.assertEqual(sum(a[k] for k in ("available", "partial", "unmapped", "not_supported")), sum(1 for r in rows if r["area"] == a["area"]))
        self.assertIn("analytics", {a["area"] for a in s["areas"]})

    def test_a_missing_mapping_wins_over_partial(self):
        rows = caps.evaluate({}, [], None)
        self.assertEqual(row(rows, "environment.iaq")["status"], caps.UNMAPPED)


class ToolTests(unittest.TestCase):
    def test_the_report_is_built_from_this_projects_own_equipment_points(self):
        hospital = view([eq("AHU-H1", [pt("Room Humidity", "61%", "%"), pt("Room Temp", "22", "°C")])])
        rows = eko_chat.run_tool("get_capabilities", {}, hospital)["capabilities"]
        r = row(rows, "analytics.metric")
        self.assertEqual(r["status"], "partial")
        self.assertIn("CO2, Power", r["limitations"][0])
        marsa = view([eq("AHU-M1", [pt("Room Humidity", "35%", "%"), pt("Room Temp", "22", "°C"), pt("Room CO2", "600 ppm", "ppm"), pt("Fan Power", "1 kW", "kW")])],
                     project=("proj-m", "marsaAlArab"))
        self.assertEqual(row(eko_chat.run_tool("get_capabilities", {}, marsa)["capabilities"], "analytics.metric")["status"], "available")

    def test_a_stale_or_unread_cache_is_not_taken_for_missing_points(self):
        old = view([eq("AHU-H1", [])], ts="2020-01-01T00:00:00")
        r = row(eko_chat.run_tool("get_capabilities", {}, old)["capabilities"], "analytics.metric")
        self.assertEqual((r["status"], r["limitations"], r["read"]), ("available", [], "stale"))

    def test_the_point_coverage_is_in_the_report_with_counts_and_no_point_names(self):
        out = eko_chat.run_tool("get_capabilities", {}, view([eq("AHU-H1", [pt("Room Humidity", "61%", "%"), pt("Room Humidity 2", "—", "%", reporting=False)])]))
        self.assertEqual(out["point_coverage"]["metrics"]["humidity"], {"label": "Humidity", "points": 2, "with_readings": 1})
        self.assertEqual(out["point_coverage"]["equipment"], 1)
        self.assertNotIn("Room Humidity", json.dumps(out))

    def test_one_capability_asked_about_carries_its_limits(self):
        out = eko_chat.run_tool("get_capabilities", {"about": "alarms.history_summary"}, view([eq("A-1")], mapped={"finSeverityBands": False}))
        self.assertEqual(out["about"]["status"], "partial")
        self.assertTrue(any("breakdown" in m for m in out["about"]["limitations"]))


class ChatTests(ProjectChatBase):
    def equipment(self, items):
        from datetime import datetime
        return {"timestamp": datetime.now().isoformat(), "equipment": items}

    def test_what_can_you_do_says_what_is_partial_and_why_for_the_hospital(self):
        self.frozen(HOSPITAL, HOSPITAL_ID, cached_equip_data=self.equipment([eq("AHU-H1", [pt("Room Humidity", "61%", "%")])]))
        body = self.ok("What can you do?")
        a = body["answer"]
        self.assertIn("Partly available:", a)
        self.assertIn("Calculations over equipment points", a)
        self.assertIn("No equipment point in this project is named like Temperature, CO2, Power", a)
        self.assertIn("not an archive", a)
        self.assertEqual(body["card"]["columns"], ["area", "available", "partial", "unmapped", "not_supported"])
        self.assertEqual(sum(sum(r[1:]) for r in body["card"]["rows"]), len(caps.CAPABILITIES))

    def test_a_marsa_with_its_points_is_not_told_the_hospitals_gaps(self):
        pts = [pt("Room Humidity", "35%", "%"), pt("Room Temp", "22", "°C"), pt("Room CO2", "600 ppm", "ppm"), pt("Fan Power", "1 kW", "kW")]
        self.frozen(MARSA, MARSA_ID, cached_equip_data=self.equipment([eq("AHU-M1", pts)]))
        a = self.ok("What can you do?")["answer"]
        self.assertNotIn("No equipment point in this project is named like", a)

    def test_the_unavailable_list_names_the_partial_ones(self):
        self.frozen(HOSPITAL, HOSPITAL_ID, cached_equip_data=self.equipment([eq("AHU-H1", [pt("Room Humidity", "61%", "%")])]))
        body = self.ok("what is not available")
        self.assertIn("Partly available:", body["answer"])

    def test_one_capability_is_answered_with_its_status(self):
        self.frozen(HOSPITAL, HOSPITAL_ID, cached_equip_data=self.equipment([eq("AHU-H1", [pt("Room Humidity", "61%", "%")])]))
        out = self.ok("alarm history for last month")
        self.assertEqual(out["route"], "unsupported")
        self.assertIn("is partly available", out["answer"])
        self.assertEqual(out["card"]["rows"][0][1], "partial")

    def test_a_question_about_point_history_is_not_supported_and_says_why(self):
        self.frozen(HOSPITAL, HOSPITAL_ID, cached_equip_data=self.equipment([eq("AHU-H1", [pt("Room Humidity", "61%", "%")])]))
        out = self.ok("average temperature last week")
        self.assertEqual(out["card"]["rows"][0][1], "not_supported")
        self.assertIn("stored point history is not read", out["answer"])
        self.assertIn("over a past period is not supported yet", out["answer"])
        self.assertEqual(out["tool_calls"][0]["arguments"], {"about": "analytics.point_history"})      # no calculation was started for it


if __name__ == "__main__":
    unittest.main()
