"""Eko-Chat Phase 2: cross-equipment point search, metric analytics, equipment comparison and alarm-record summaries, as tools.

Run from backend/:   python -m unittest tests.test_eko_chat_points
The tools run over a DataView built here, the way main.py builds one from the FIN caches: no app, no FIN, no model, no network. Every value
asserted is copied from, or calculated from, the points the test put in the cache; nothing is estimated.
"""
import os
import sys
import unittest
from datetime import datetime, timedelta
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import eko_chat  # noqa: E402
import eko_chat_analytics as an  # noqa: E402

NOW = datetime(2026, 10, 28, 10, 30)


def iso(minutes_ago=0):
    return (datetime.now() - timedelta(minutes=minutes_ago)).isoformat()


def pt(name, value, unit="", reporting=True, **kw):
    return dict({"navName": name, "currentValue": value, "unit": unit, "reporting": reporting}, **kw)


def eq(name, points=(), type_="ahu", floor="L1", alarms=(), fin_id=""):
    return {"name": name, "floor": floor, "type": type_, "category": "hvac", "tags": [type_], "inAlarm": bool(alarms),
            "alarms": list(alarms), "finId": fin_id, "points": list(points)}


def view(items, ts=None, project=("proj-h", "ekoHospital"), **kw):
    cache = {"timestamp": ts or iso(), "equipment": items}
    return eko_chat.DataView(authenticated=True, project_id=project[0], project_name=project[1], equipment=cache,
                             alarms=kw.pop("alarms", {"timestamp": iso(), "alarms": [], "counts": {}}), site_now=NOW, **kw)


def run(name, v, **args):
    return eko_chat.run_tool(name, args, v)


class FleetMixin:
    def fleet(self):
        return [
            eq("AHU-01", [pt("Room Humidity", "40%", "%"), pt("Room CO2", "600 ppm", "ppm"), pt("Supply Air Temp", "14.0", "°C"), pt("Return Air Temp", "24.0", "°C")]),
            eq("AHU-02", [pt("Room Humidity", "50%", "%"), pt("Room CO2", "800"), pt("Return Air Temp", "27.0", "°C")]),
            eq("AHU-03", [pt("Room Humidity", "—", "%", reporting=False), pt("Return Air Temp", "21.0", "°C")]),
            eq("FCU-01", [pt("Room Temp", "22.0", "°C"), pt("Room Temp SP", "22", "°C")], type_="fcu"),
            eq("FCU-02", [pt("Room Temp", "70.0", "°F")], type_="fcu"),
            eq("EF-01", [pt("Run Status", "On")], type_="fan"),
        ]


class PointIndexTests(FleetMixin, unittest.TestCase):
    def test_one_cache_is_scanned_once_however_many_questions_read_it(self):
        v = view(self.fleet())
        with mock.patch.object(an, "classify", wraps=an.classify) as spy:
            run("calculate_metric", v, metric="humidity", op="average")
            first = spy.call_count
            run("calculate_metric", v, metric="humidity", op="max")
            run("search_points", v, metric="humidity")
        self.assertGreater(first, 0)
        self.assertEqual(spy.call_count, first, "the second and third question must not rescan the points")

    def test_a_new_read_is_a_new_scan_and_nothing_stale_is_served(self):
        a = view(self.fleet())
        self.assertEqual(run("calculate_metric", a, metric="humidity", op="average")["value"], 45.0)
        b = view([eq("AHU-01", [pt("Room Humidity", "60%", "%")])])
        self.assertEqual(run("calculate_metric", b, metric="humidity", op="average")["value"], 60.0)
        self.assertEqual(run("calculate_metric", a, metric="humidity", op="average")["value"], 45.0)

    def test_two_projects_never_share_an_index(self):
        h = view([eq("AHU-01", [pt("Room Humidity", "40%", "%")])], project=("proj-h", "ekoHospital"))
        m = view([eq("AHU-01", [pt("Room Humidity", "70%", "%")])], project=("proj-m", "marsaAlArab"))
        self.assertEqual(run("calculate_metric", h, metric="humidity", op="average")["value"], 40.0)
        self.assertEqual(run("calculate_metric", m, metric="humidity", op="average")["value"], 70.0)
        # the same cache object seen under another project is not served from the first project's index
        shared = {"timestamp": iso(), "equipment": [eq("AHU-01", [pt("Room Humidity", "40%", "%")])]}
        one = eko_chat.DataView(authenticated=True, project_id="proj-h", project_name="ekoHospital", equipment=shared)
        two = eko_chat.DataView(authenticated=True, project_id="proj-m", project_name="marsaAlArab", equipment=shared)
        self.assertIsNot(eko_chat._point_index(one), eko_chat._point_index(two))

    def test_the_memo_is_bounded(self):
        for i in range(20):
            eko_chat._point_index(view([eq("A", [pt("Room Humidity", f"{40 + i}%", "%")])], project=(f"p{i}", f"n{i}")))
        self.assertLessEqual(len(an.INDEX_MEMO), an.MAX_INDEXES)


class SearchPointsTests(FleetMixin, unittest.TestCase):
    def test_equipment_with_humidity_readings(self):
        out = run("search_points", view(self.fleet()), metric="humidity")
        self.assertTrue(out["available"])
        self.assertEqual((out["total"], out["with_readings"], out["equipment_scanned"]), (3, 2, 6))
        self.assertEqual([i["name"] for i in out["items"]], ["AHU-01", "AHU-02", "AHU-03"])
        self.assertEqual(out["items"][0]["points"], [{"point": "Room Humidity", "value": 40.0, "unit": "%", "reading": True}])

    def test_a_point_without_a_reading_is_listed_as_such_and_counted(self):
        out = run("search_points", view(self.fleet()), metric="humidity")
        ahu3 = out["items"][2]["points"][0]
        self.assertEqual((ahu3["reading"], ahu3["value"], ahu3["note"]), (False, None, "not_reporting"))
        self.assertEqual((out["points_matched"], out["points_with_reading"], out["excluded"]), (3, 2, {"not_reporting": 1}))

    def test_a_type_narrows_the_search(self):
        out = run("search_points", view(self.fleet()), metric="temperature", type="fcu")
        self.assertEqual([i["name"] for i in out["items"]], ["FCU-01", "FCU-02"])
        self.assertEqual(out["scope"], {"type": "fcu"})

    def test_ahus_with_co2(self):
        out = run("search_points", view(self.fleet()), metric="co2", type="ahu")
        self.assertEqual([i["name"] for i in out["items"]], ["AHU-01", "AHU-02"])

    def test_the_result_is_limited_and_says_so(self):
        many = [eq(f"AHU-{i:03d}", [pt("Room Humidity", "40%", "%")]) for i in range(120)]
        out = run("search_points", view(many), metric="humidity", limit=10)
        self.assertEqual((out["total"], out["returned"], out["truncated"], len(out["items"])), (120, 10, True, 10))
        default = run("search_points", view(many), metric="humidity")
        self.assertEqual((default["returned"], default["truncated"]), (eko_chat.DEFAULT_LIMIT, True))

    def test_each_item_shows_a_few_points_not_all_of_them(self):
        many_points = [pt(f"Zone {i} Temp", "21", "°C") for i in range(30)]
        out = run("search_points", view([eq("AHU-01", many_points)]), metric="temperature")
        item = out["items"][0]
        self.assertEqual((len(item["points"]), item["points_more"]), (eko_chat.POINTS_PER_ITEM, 30 - eko_chat.POINTS_PER_ITEM))

    def test_no_point_with_that_name_is_said_and_where_the_live_point_stands(self):
        v = view([eq("AHU-01", [pt("Run Status", "On")])], mapped={"finLivePoints": ["iaq_index"], "finEndpoints": []})
        out = run("search_points", v, metric="co2")
        self.assertTrue(out["available"])
        self.assertEqual((out["total"], out["items"], out["equipment_scanned"]), (0, [], 1))
        self.assertEqual(out["mapping"], {"live_point": "ra_co2", "mapped": False})

    def test_a_mapped_live_point_is_reported_as_mapped(self):
        v = view([eq("AHU-01", [])], mapped={"finLivePoints": ["ra_co2"]})
        self.assertEqual(run("search_points", v, metric="co2")["mapping"], {"live_point": "ra_co2", "mapped": True})
        self.assertEqual(run("search_points", view([eq("AHU-01", [])]), metric="co2")["mapping"], {"live_point": "ra_co2", "mapped": None})

    def test_an_empty_collection_is_a_result_not_an_error(self):
        out = run("search_points", view([]), metric="humidity")
        self.assertEqual((out["available"], out["total"], out["equipment_scanned"], out["items"]), (True, 0, 0, []))
        out = run("search_points", view([eq("AHU-01", [])]), metric="humidity")
        self.assertEqual((out["total"], out["points_matched"]), (0, 0))

    def test_a_setpoint_is_not_a_temperature_reading(self):
        out = run("search_points", view(self.fleet()), metric="temperature", type="fcu")
        fcu1 = out["items"][0]["points"]
        self.assertEqual([p["point"] for p in fcu1], ["Room Temp", "Room Temp SP"])
        self.assertEqual((fcu1[1]["reading"], fcu1[1]["note"]), (False, "setpoint"))

    def test_arguments_are_checked(self):
        v = view(self.fleet())
        for args in ({}, {"metric": "pressure"}, {"metric": "co2", "limit": 0}, {"metric": "co2", "limit": 999}, {"metric": "co2", "extra": 1},
                     {"metric": "co2", "type": ""}):
            self.assertEqual(run("search_points", v, **args)["reason"], "invalid_arguments", args)

    def test_an_unread_stale_or_signed_out_cache_is_said(self):
        self.assertEqual(run("search_points", view(self.fleet(), ts=iso(30)), metric="co2")["reason"], "stale")
        empty = eko_chat.DataView(authenticated=True, project_id="p", project_name="n")
        self.assertEqual(run("search_points", empty, metric="co2")["reason"], "no_data_yet")
        out = eko_chat.DataView(authenticated=False, project_id="p", project_name="n")
        self.assertEqual(run("search_points", out, metric="co2")["reason"], "fin_not_connected")


class CalculateMetricTests(FleetMixin, unittest.TestCase):
    def test_average_humidity_leaves_out_the_point_that_does_not_report(self):
        out = run("calculate_metric", view(self.fleet()), metric="humidity", op="average")
        self.assertEqual((out["value"], out["unit"], out["samples"], out["equipment_count"]), (45.0, "%", 2, 2))
        self.assertEqual((out["points_matched"], out["excluded"]), (3, {"not_reporting": 1}))

    def test_sample_count_and_time_range_come_with_every_answer(self):
        stamp = iso()
        out = run("calculate_metric", view(self.fleet(), ts=stamp), metric="co2", op="average")
        self.assertEqual((out["value"], out["samples"], out["as_of"]), (700.0, 2, stamp))
        self.assertEqual((out["time_range"]["from"], out["time_range"]["to"]), (stamp, stamp))
        self.assertIn("not a history", out["time_range"]["basis"])

    def test_minimum_maximum_and_count_name_where_they_are(self):
        v = view(self.fleet())
        top = run("calculate_metric", v, metric="temperature", op="max", type="ahu")
        self.assertEqual((top["value"], top["at"]), (27.0, {"equipment": "AHU-02", "point": "Return Air Temp"}))
        low = run("calculate_metric", v, metric="temperature", op="min", type="ahu")
        self.assertEqual((low["value"], low["at"]["equipment"]), (14.0, "AHU-01"))
        n = run("calculate_metric", v, metric="temperature", op="count", type="ahu")
        self.assertEqual((n["value"], n["samples"]), (4, 4))

    def test_a_type_limits_what_is_calculated(self):
        out = run("calculate_metric", view(self.fleet()), metric="temperature", op="average", type="fcu")
        self.assertEqual((out["value"], out["samples"], out["scope"]), (22.0, 1, {"type": "fcu"}))

    def test_a_setpoint_and_another_unit_are_left_out_and_counted(self):
        out = run("calculate_metric", view(self.fleet()), metric="temperature", op="average", type="fcu")
        self.assertEqual(out["excluded"], {"setpoint": 1, "unit_mismatch": 1})
        self.assertEqual(out["other_units"], {"°F": 1})

    def test_a_stale_or_faulty_reading_is_left_out_and_named(self):
        items = [eq("AHU-01", [pt("Room CO2", "600", "ppm"), pt("RA CO2", "900", "ppm", status="stale"), pt("Zone CO2", "950", "ppm", status="fault")])]
        out = run("calculate_metric", view(items), metric="co2", op="average")
        self.assertEqual((out["value"], out["samples"], out["excluded"]), (600.0, 1, {"stale": 1, "bad_status": 1}))
        self.assertEqual(out["stale_points"], ["AHU-01 · RA CO2"])

    def test_an_implausible_and_a_non_numeric_value_are_left_out(self):
        items = [eq("AHU-01", [pt("Room CO2", "600", "ppm"), pt("RA CO2", "99999", "ppm"), pt("Zone CO2", "n/a", "ppm")])]
        out = run("calculate_metric", view(items), metric="co2", op="max")
        self.assertEqual((out["value"], out["excluded"]), (600.0, {"out_of_range": 1, "non_numeric": 1}))

    def test_a_point_with_no_unit_takes_the_metrics_unit_and_says_so(self):
        out = run("calculate_metric", view(self.fleet()), metric="co2", op="average")
        self.assertEqual((out["unit"], out["assumed_unit"]), ("ppm", 1))
        self.assertNotIn("assumed_unit", run("calculate_metric", view(self.fleet()), metric="humidity", op="average"))

    def test_the_sum_of_a_sum_metric_and_the_refusal_to_sum_the_rest(self):
        fcus = [eq("FCU-01", [pt("Fan Power", "1.5 kW", "kW")], type_="fcu"), eq("FCU-02", [pt("Fan Power", "2.0 kW", "kW")], type_="fcu")]
        out = run("calculate_metric", view(fcus), metric="power", op="sum", type="fcu")
        self.assertEqual((out["available"], out["value"], out["unit"], out["samples"]), (True, 3.5, "kW", 2))
        refused = run("calculate_metric", view(self.fleet()), metric="humidity", op="sum")
        self.assertEqual((refused["available"], refused["reason"]), (False, "not_additive"))

    def test_top_n_ranks_one_value_per_equipment(self):
        out = run("calculate_metric", view(self.fleet()), metric="temperature", op="top", type="ahu", limit=2)
        self.assertEqual([(i["rank"], i["equipment"], i["value"], i["point"]) for i in out["items"]],
                         [(1, "AHU-02", 27.0, "Return Air Temp"), (2, "AHU-01", 24.0, "Return Air Temp")])
        self.assertEqual((out["samples"], out["equipment_count"], out["order"]), (4, 3, "highest"))     # four readings, ranked one per equipment
        low = run("calculate_metric", view(self.fleet()), metric="temperature", op="top", type="ahu", limit=1, order="lowest")
        self.assertEqual([(i["equipment"], i["value"]) for i in low["items"]], [("AHU-01", 14.0)])

    def test_the_default_size_of_a_ranking_is_bounded(self):
        many = [eq(f"AHU-{i:03d}", [pt("Room CO2", str(500 + i), "ppm")]) for i in range(60)]
        out = run("calculate_metric", view(many), metric="co2", op="top")
        self.assertEqual(len(out["items"]), eko_chat.DEFAULT_TOP)
        self.assertEqual(run("calculate_metric", view(many), metric="co2", op="top", limit=50)["items"][0]["rank"], 1)
        self.assertLessEqual(len(run("calculate_metric", view(many), metric="co2", op="top", limit=50)["items"]), an.MAX_TOP)

    def test_a_ranking_cut_by_the_ceiling_says_so(self):
        many = [eq(f"AHU-{i:03d}", [pt("Room CO2", str(500 + i), "ppm")]) for i in range(60)]
        out = run("calculate_metric", view(many), metric="co2", op="top", limit=50)
        self.assertEqual((len(out["items"]), out["ranked_equipment"], out["truncated"]), (an.MAX_TOP, 60, True))
        small = run("calculate_metric", view(many[:3]), metric="co2", op="top")
        self.assertEqual((small["ranked_equipment"], small["truncated"]), (3, False))

    def test_a_sum_says_it_adds_points_and_is_not_a_metered_total(self):
        fcus = [eq("FCU-01", [pt("Fan Power", "1.5 kW", "kW")], type_="fcu"), eq("FCU-02", [pt("Fan Power", "2.0 kW", "kW")], type_="fcu")]
        out = run("calculate_metric", view(fcus), metric="power", op="sum", type="fcu")
        self.assertIn("not a metered total", out["note"])
        self.assertNotIn("note", run("calculate_metric", view(fcus), metric="power", op="max", type="fcu"))

    def test_a_zero_reading_counts(self):
        items = [eq("AHU-01", [pt("Room CO2", "400", "ppm")]), eq("AHU-02", [pt("Fan Power", "0 kW", "kW")])]
        self.assertEqual(run("calculate_metric", view(items), metric="power", op="average")["value"], 0.0)

    def test_nothing_to_calculate_is_said_with_what_was_left_out(self):
        items = [eq("AHU-01", [pt("Room CO2", "—", "ppm", reporting=False), pt("RA CO2", "x", "ppm", status="stale")])]
        out = run("calculate_metric", view(items), metric="co2", op="average")
        self.assertEqual((out["available"], out["reason"], out["excluded"]), (False, "no_sensors", {"not_reporting": 1, "stale": 1}))
        self.assertIn("2 points", out["message"])
        self.assertNotIn("value", out)

    def test_no_point_with_that_name_and_an_empty_collection_are_said_plainly(self):
        out = run("calculate_metric", view([eq("AHU-01", [pt("Run Status", "On")])]), metric="humidity", op="average")
        self.assertEqual((out["available"], out["reason"]), (False, "no_sensors"))
        self.assertIn("No equipment point", out["message"])
        self.assertEqual(run("calculate_metric", view([]), metric="humidity", op="average")["reason"], "no_sensors")
        self.assertEqual(run("calculate_metric", view(self.fleet()), metric="humidity", op="average", type="pump")["reason"], "no_sensors")

    def test_arguments_are_checked(self):
        v = view(self.fleet())
        for args in ({}, {"metric": "humidity"}, {"metric": "humidity", "op": "median"}, {"metric": "pressure", "op": "max"},
                     {"metric": "co2", "op": "top", "order": "middle"}, {"metric": "co2", "op": "top", "limit": 0}, {"metric": "co2", "op": "max", "x": 1}):
            self.assertEqual(run("calculate_metric", v, **args)["reason"], "invalid_arguments", args)

    def test_old_unread_and_signed_out_data_is_not_calculated(self):
        self.assertEqual(run("calculate_metric", view(self.fleet(), ts=iso(30)), metric="co2", op="max")["reason"], "stale")
        self.assertEqual(run("calculate_metric", eko_chat.DataView(authenticated=True, project_id="p", project_name="n"), metric="co2", op="max")["reason"], "no_data_yet")
        self.assertEqual(run("calculate_metric", eko_chat.DataView(authenticated=False, project_id="p", project_name="n"), metric="co2", op="max")["reason"],
                         "fin_not_connected")


class CompareEquipmentTests(unittest.TestCase):
    def pair(self):
        return view([
            eq("AHU_01", [pt("Room Temp", "24.0", "°C"), pt("Supply Fan Speed", "0", "%"), pt("Room CO2", "600", "ppm"), pt("Only A", "1", "kW"),
                          pt("Mode", "Auto", ""), pt("Filter", "5", "Pa")], fin_id="e1",
               alarms=[{"alarm": "High temperature", "priority": 200}]),
            eq("AHU_02", [pt("Room Temp", "20.0", "°C"), pt("Supply Fan Speed", "60", "%"), pt("Room CO2", "700 ppm", "ppm"), pt("Only B", "2", "kW"),
                          pt("Mode", "Hand", ""), pt("Filter", "5", "kPa")], fin_id="e2"),
            eq("AHU_10", [pt("Room Temp", "30.0", "°C")]),
        ])

    def test_the_two_units_are_compared_point_by_point(self):
        out = run("compare_equipment", self.pair(), equipment_a="AHU_01", equipment_b="AHU_02")
        self.assertTrue(out["found"])
        self.assertEqual([e["name"] for e in out["equipment"]], ["AHU_01", "AHU_02"])
        rows = {r["point"]: r for r in out["comparison"]["items"]}
        self.assertEqual((rows["Room Temp"]["a"], rows["Room Temp"]["b"], rows["Room Temp"]["difference"], rows["Room Temp"]["percent_difference"]),
                         (24.0, 20.0, 4.0, 20.0))
        self.assertEqual(rows["Room CO2"]["difference"], -100.0)
        self.assertEqual(out["basis"], "difference is the first equipment minus the second")

    def test_a_zero_denominator_is_a_stated_gap(self):
        out = run("compare_equipment", self.pair(), equipment_a="AHU_02", equipment_b="AHU_01")
        row = next(r for r in out["comparison"]["items"] if r["point"] == "Supply Fan Speed")
        self.assertEqual((row["a"], row["b"], row["difference"], row["percent_difference"], row["percent_note"]), (60.0, 0.0, 60.0, None, "zero_denominator"))

    def test_what_cannot_be_compared_is_listed_with_the_reason(self):
        out = run("compare_equipment", self.pair(), equipment_a="AHU_01", equipment_b="AHU_02")["comparison"]
        reasons = {r["point"]: r["reason"] for r in out["not_comparable"]}
        self.assertEqual(reasons, {"Mode": "non_numeric", "Filter": "unit_mismatch"})
        self.assertEqual((out["only_in_a"], out["only_in_b"]), (["Only A"], ["Only B"]))
        self.assertEqual(out["compared"], 3)

    def test_open_alarms_of_both_are_counted_and_listed(self):
        out = run("compare_equipment", self.pair(), equipment_a="AHU_01", equipment_b="AHU_02")
        self.assertEqual((out["alarms"]["a"]["open"], out["alarms"]["b"]["open"]), (1, 0))
        self.assertEqual(out["alarms"]["a"]["items"], [{"message": "High temperature", "priority": 200}])

    def test_the_alarm_focus_leaves_the_points_out(self):
        out = run("compare_equipment", self.pair(), equipment_a="AHU_01", equipment_b="AHU_02", focus="alarms")
        self.assertEqual((out["focus"], out["alarms"]["a"]["open"]), ("alarms", 1))
        self.assertNotIn("comparison", out)

    def test_a_name_is_matched_exactly_never_to_the_nearest(self):
        out = run("compare_equipment", self.pair(), equipment_a="AHU_1", equipment_b="AHU_02")
        self.assertEqual((out["available"], out["found"], out["reason"]), (True, False, "not_found"))
        self.assertEqual(out["unfound"], [{"side": "a", "equipment": "AHU_1", "reason": "not_found", "candidates": ["AHU_01", "AHU_10"]}])
        self.assertNotIn("comparison", out)

    def test_both_missing_are_both_said(self):
        out = run("compare_equipment", self.pair(), equipment_a="XYZ_1", equipment_b="XYZ_2")
        self.assertEqual([u["side"] for u in out["unfound"]], ["a", "b"])

    def test_two_items_with_one_name_are_ambiguous_not_chosen(self):
        v = view([eq("AHU-01", floor="L1"), eq("AHU-01", floor="L2"), eq("AHU-02")])
        out = run("compare_equipment", v, equipment_a="AHU-01", equipment_b="AHU-02")
        self.assertEqual((out["found"], out["unfound"][0]["reason"], out["unfound"][0]["candidates"]), (False, "ambiguous", ["AHU-01 (L1)", "AHU-01 (L2)"]))

    def test_one_item_is_not_compared_with_itself(self):
        out = run("compare_equipment", self.pair(), equipment_a="AHU_01", equipment_b="ahu-01")
        self.assertEqual((out["found"], out["reason"]), (False, "same_equipment"))

    def test_the_point_list_is_limited_and_says_so(self):
        a = eq("A-1", [pt(f"Point {i:02d}", str(i), "") for i in range(40)])
        b = eq("A-2", [pt(f"Point {i:02d}", str(i + 1), "") for i in range(40)])
        out = run("compare_equipment", view([a, b]), equipment_a="A-1", equipment_b="A-2")["comparison"]
        self.assertEqual((out["compared"], out["returned"], out["truncated"], len(out["items"])), (40, eko_chat.MAX_COMPARE_POINTS, True, eko_chat.MAX_COMPARE_POINTS))

    def test_a_stale_or_not_reporting_point_is_not_compared(self):
        a = eq("A-1", [pt("Temp", "20", "°C", status="stale"), pt("Hum", "—", "%", reporting=False), pt("Co2", "600", "ppm")])
        b = eq("A-2", [pt("Temp", "21", "°C"), pt("Hum", "50", "%"), pt("Co2", "700", "ppm")])
        out = run("compare_equipment", view([a, b]), equipment_a="A-1", equipment_b="A-2")["comparison"]
        self.assertEqual([r["point"] for r in out["items"]], ["Co2"])
        self.assertEqual({r["point"]: r["reason"] for r in out["not_comparable"]}, {"Temp": "stale", "Hum": "not_reporting"})

    def test_arguments_are_checked_and_old_data_is_not_compared(self):
        v = self.pair()
        for args in ({}, {"equipment_a": "AHU_01"}, {"equipment_a": "AHU_01", "equipment_b": "AHU_02", "focus": "x"},
                     {"equipment_a": "AHU_01", "equipment_b": "AHU_02", "extra": 1}, {"equipment_a": "", "equipment_b": "AHU_02"}):
            self.assertEqual(run("compare_equipment", v, **args)["reason"], "invalid_arguments", args)
        old = view([eq("A-1"), eq("A-2")], ts=iso(30))
        self.assertEqual(run("compare_equipment", old, equipment_a="A-1", equipment_b="A-2")["reason"], "stale")


def rec(day, severity="info", open_=False, source="AHU-01", hour=9, message="High temperature"):
    return {"source": source, "source_id": None, "message": message, "priority": 100, "severity": severity,
            "occurred": f"{day}T{hour:02d}:00:00+04:00", "state": "open" if open_ else "closed", "open": open_}


class AlarmHistoryTests(unittest.TestCase):
    def records(self):
        return [rec("2026-10-28", "critical", True), rec("2026-10-28", "warning", False, "AHU-02"), rec("2026-10-27", "info", False),
                rec("2026-10-27", "critical", False, "AHU-02"), rec("2026-10-20", "warning", False)]

    def v(self, records, mapped=None, open_alarms=0, **kw):
        alarms = {"timestamp": iso(), "alarms": [{"source": "X"} for _ in range(open_alarms)], "counts": {"total": open_alarms}}
        return view([eq("AHU-01")], alarms=alarms, alarm_records=(lambda: records), mapped={"finSeverityBands": True} if mapped is None else mapped, **kw)

    def test_the_records_of_the_latest_read_are_counted_open_and_cleared(self):
        out = run("get_alarm_history", self.v(self.records()))
        self.assertTrue(out["available"])
        self.assertEqual((out["total"], out["open"], out["cleared"]), (5, 1, 4))
        self.assertEqual((out["coverage"]["from"], out["coverage"]["to"], out["coverage"]["records_in_read"]), ("2026-10-20", "2026-10-28", 5))
        self.assertIn("not an archive", out["scope"])

    def test_the_count_is_by_day_over_the_days_the_read_holds(self):
        out = run("get_alarm_history", self.v(self.records()))
        self.assertEqual(out["by_day"], [{"date": "2026-10-28", "total": 2}, {"date": "2026-10-27", "total": 2}, {"date": "2026-10-20", "total": 1}])

    def test_the_severity_breakdown_exists_only_when_severity_bands_are_mapped(self):
        mapped = run("get_alarm_history", self.v(self.records()))
        self.assertEqual((mapped["severity_mapped"], mapped["by_severity"]), (True, {"critical": 2, "warning": 2, "info": 1}))
        unmapped = run("get_alarm_history", self.v(self.records(), mapped={"finSeverityBands": False}))
        self.assertEqual((unmapped["severity_mapped"], unmapped["by_severity"]), (False, None))
        self.assertIn("No severity bands", unmapped["severity_note"])
        unknown = run("get_alarm_history", self.v(self.records(), mapped={}))
        self.assertEqual((unknown["severity_mapped"], unknown["by_severity"]), (False, None))
        asked = run("get_alarm_history", self.v(self.records(), mapped={"finSeverityBands": False}), severity="critical")
        self.assertEqual((asked["available"], asked["reason"]), (False, "metric_unavailable"))
        self.assertEqual(asked["missing"], [{"mapping": "finSeverityBands", "key": None}])

    def test_a_period_counts_only_its_own_days(self):
        v = self.v(self.records())
        self.assertEqual(run("get_alarm_history", v, period="today")["total"], 2)
        self.assertEqual(run("get_alarm_history", v, period="yesterday")["total"], 2)
        self.assertEqual(run("get_alarm_history", v, period="last_7_days")["total"], 4)
        today = run("get_alarm_history", v, period="today")
        self.assertEqual(today["range_requested"], {"from": "2026-10-28", "to": "2026-10-28"})
        self.assertFalse(today["outside_coverage"])

    def test_a_period_the_read_does_not_reach_is_said_and_nothing_is_claimed_for_it(self):
        v = self.v([rec("2026-10-28", "critical", True), rec("2026-10-28", "info")])
        out = run("get_alarm_history", v, period="last_7_days")
        self.assertEqual((out["total"], out["outside_coverage"]), (2, True))
        self.assertIn("starts on 2026-10-28", out["coverage_note"])
        self.assertTrue(run("get_alarm_history", v, period="last_30_days")["outside_coverage"])
        self.assertFalse(run("get_alarm_history", v, period="today")["outside_coverage"])

    def test_current_open_alarms_are_never_used_as_history(self):
        out = run("get_alarm_history", self.v([], open_alarms=7))
        self.assertEqual((out["available"], out["total"], out["open"], out["cleared"]), (True, 0, 0, 0))
        self.assertIsNone(out["coverage"])
        self.assertIn("holds no alarm records", out["coverage_note"])
        self.assertEqual(out["by_day"], [])

    def test_no_record_source_is_unavailable(self):
        v = view([eq("AHU-01")], alarm_records=None)
        out = run("get_alarm_history", v)
        self.assertEqual((out["available"], out["reason"]), (False, "alarm_history_unavailable"))

    def test_a_full_read_may_be_cut_and_says_so(self):
        full = [rec("2026-10-28") for _ in range(eko_chat.ALARM_RECORDS_CAP)]
        self.assertTrue(run("get_alarm_history", self.v(full))["coverage"]["may_be_truncated"])
        self.assertFalse(run("get_alarm_history", self.v(self.records()))["coverage"]["may_be_truncated"])

    def test_records_without_a_date_are_counted_apart(self):
        recs = self.records() + [dict(rec("2026-10-28"), occurred=None), dict(rec("2026-10-28"), occurred="soon")]
        out = run("get_alarm_history", self.v(recs))
        self.assertEqual((out["total"], out["coverage"]["undated"], out["coverage"]["from"]), (7, 2, "2026-10-20"))
        self.assertEqual(run("get_alarm_history", self.v(recs), period="today")["total"], 2)

    def test_the_most_active_sources_and_one_equipment(self):
        out = run("get_alarm_history", self.v(self.records()))
        self.assertEqual(out["top_sources"][:2], [{"source": "AHU-01", "total": 3}, {"source": "AHU-02", "total": 2}])
        one = run("get_alarm_history", self.v(self.records()), equipment="AHU-02")
        self.assertEqual((one["total"], one["by_severity"]), (2, {"critical": 1, "warning": 1, "info": 0}))

    def test_arguments_are_checked(self):
        v = self.v(self.records())
        for args in ({"period": "last_year"}, {"severity": "urgent"}, {"extra": 1}, {"limit": 0}):
            self.assertEqual(run("get_alarm_history", v, **args)["reason"], "invalid_arguments", args)

    def test_a_stale_alarm_cache_is_not_summarised(self):
        alarms = {"timestamp": iso(30), "alarms": [], "counts": {}}
        v = view([eq("AHU-01")], alarms=alarms, alarm_records=lambda: self.records())
        self.assertEqual(run("get_alarm_history", v)["reason"], "stale")


class AskedFilterTests(unittest.TestCase):
    """A model may narrow a Phase 2 tool only with words the user wrote, as it may for the older tools."""

    def test_a_type_or_name_the_user_did_not_write_is_refused(self):
        ask = eko_chat.unasked_filters
        self.assertEqual(ask("calculate_metric", {"metric": "co2", "op": "max", "type": "ahu"}, "highest co2"), ["type"])
        self.assertEqual(ask("calculate_metric", {"metric": "co2", "op": "max", "type": "ahu"}, "highest co2 of the ahus"), [])
        self.assertEqual(ask("search_points", {"metric": "co2", "type": "fcu"}, "find equipment with co2 sensors"), ["type"])
        self.assertEqual(ask("compare_equipment", {"equipment_a": "AHU-01", "equipment_b": "AHU-02"}, "compare AHU-01 and AHU-02"), [])
        self.assertEqual(ask("compare_equipment", {"equipment_a": "AHU-01", "equipment_b": "AHU-02"}, "compare AHU-01 and the other one"), ["equipment_b"])
        self.assertEqual(ask("get_alarm_history", {"severity": "critical", "equipment": "AHU-01"}, "alarm history"), ["severity", "equipment"])
        self.assertEqual(ask("get_alarm_history", {"severity": "critical"}, "critical alarm history"), [])


class EnvironmentOnAnalyticsTests(unittest.TestCase):
    """The humidity and CO2 averages of get_environment are the analytics module's: same answer as before, plus what it rests on."""

    def reading(self, points, metric="humidity"):
        out = run("get_environment", view([eq("AHU-01", points)]), metric=metric)
        return out, (out["readings"][0] if out.get("available") else None)

    def test_the_average_is_unchanged_and_now_carries_its_samples_and_time(self):
        out, got = self.reading([pt("Room Humidity", "48", "%"), pt("RA Humid", "52 %", "%"), pt("Old Humid", "70", "%", reporting=False), pt("Bad Humid", "300", "%")])
        self.assertEqual((got["value"], got["unit"], got["points"], got["min"], got["max"], got["ignored_points"]), (50.0, "%", 2, 48.0, 52.0, 1))
        self.assertEqual((got["samples"], got["excluded"]), (2, {"not_reporting": 1, "out_of_range": 1}))
        self.assertEqual((got["time_range"]["from"], got["time_range"]["to"]), (got["as_of"], got["as_of"]))
        self.assertEqual(got["source"], "2 equipment points whose name contains 'humid'")

    def test_a_setpoint_is_not_averaged_in(self):
        _, got = self.reading([pt("Room Humidity", "40", "%"), pt("Room Humidity SP", "55", "%")])
        self.assertEqual((got["value"], got["points"], got["excluded"]), (40.0, 1, {"setpoint": 1}))

    def test_a_stale_or_faulty_reading_is_not_averaged_in(self):
        _, got = self.reading([pt("Room CO2", "600", "ppm"), pt("RA CO2", "1500", "ppm", status="stale"), pt("Zone CO2", "1700", "ppm", status="down")], "co2")
        self.assertEqual((got["value"], got["points"], got["excluded"], got["ignored_points"]), (600.0, 1, {"stale": 1, "bad_status": 1}, 2))

    def test_another_unit_is_not_mixed_in(self):
        _, got = self.reading([pt("Room CO2", "600", "ppm"), pt("RA CO2", "40", "%")], "co2")
        self.assertEqual((got["value"], got["unit"], got["excluded"]), (600.0, "ppm", {"unit_mismatch": 1}))

    def test_no_usable_point_is_said_as_before(self):
        out, _ = self.reading([pt("Room Humidity", "—", "%", reporting=False)])
        self.assertEqual(out["reason"], "metric_unavailable")
        self.assertIn("no equipment point named *humid* is reporting", out["message"])
        out, _ = self.reading([pt("Room Humidity", "300", "%")])
        self.assertIn("no reporting equipment point named *humid* has a plausible value", out["message"])


class ToolRegistryTests(unittest.TestCase):
    def test_the_new_tools_are_registered_with_strict_schemas(self):
        for name in ("search_points", "calculate_metric", "compare_equipment", "get_alarm_history"):
            self.assertIn(name, eko_chat.TOOLS)
            self.assertIs(eko_chat.TOOLS[name]["parameters"]["additionalProperties"], False, name)

    def test_the_tool_set_is_exactly_the_old_ones_and_the_four_new_ones(self):
        self.assertEqual(set(eko_chat.TOOLS), {"get_building_snapshot", "find_equipment", "get_equipment_status", "get_alarms", "get_environment", "get_energy",
                                               "get_capabilities", "get_hvac_status", "get_notifications", "search_points", "calculate_metric",
                                               "compare_equipment", "get_alarm_history"})

    def test_the_tools_only_read_the_view(self):
        v = view([eq("AHU-01", [pt("Room CO2", "600", "ppm")])])
        before = repr(v.equipment)
        for name, args in (("search_points", {"metric": "co2"}), ("calculate_metric", {"metric": "co2", "op": "max"}),
                           ("compare_equipment", {"equipment_a": "AHU-01", "equipment_b": "AHU-02"}), ("get_alarm_history", {})):
            run(name, v, **args)
        self.assertEqual(repr(v.equipment), before)


if __name__ == "__main__":
    unittest.main()
