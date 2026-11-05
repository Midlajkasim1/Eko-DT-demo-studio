"""Eko-Chat Phase 2: the deterministic calculations (sum, average, minimum, maximum, count, difference, percentage difference, top N).

Run from backend/:   python -m unittest tests.test_eko_chat_analytics
Pure functions over point readings: no FIN, no network, no model, no backend. Python does the arithmetic, never a model; a unit is kept and two
units are never combined; a value that is missing, not a number, stale or out of range is left out and counted; nothing is estimated.
"""
import math
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import eko_chat_analytics as an  # noqa: E402
from eko_chat_analytics import Reading  # noqa: E402


def r(value, unit="°C", equipment="AHU-01", point="Room Temp"):
    return Reading(value, unit, equipment, point)


class ParseTests(unittest.TestCase):
    def test_a_displayed_value_is_a_number_and_a_unit(self):
        self.assertEqual(an.parse_number("21.5°C"), (21.5, "°C"))
        self.assertEqual(an.parse_number("600 ppm"), (600.0, "ppm"))
        self.assertEqual(an.parse_number("45%"), (45.0, "%"))
        self.assertEqual(an.parse_number("14", "°C"), (14.0, "°C"))
        self.assertEqual(an.parse_number(7), (7.0, ""))
        self.assertEqual(an.parse_number("-3.5"), (-3.5, ""))

    def test_the_same_unit_written_two_ways_is_one_unit(self):
        self.assertEqual(an.canonical_unit("degC"), "°C")
        self.assertEqual(an.canonical_unit("℃"), "°C")
        self.assertEqual(an.canonical_unit("%RH"), "%")
        self.assertEqual(an.canonical_unit(" PPM "), "ppm")
        self.assertEqual(an.canonical_unit(None), "")

    def test_what_is_not_a_number_is_not_a_reading(self):
        for raw in ("On", "Off", "—", "", None, "N/A", "Auto", True, False, float("nan"), float("inf"), "12 34", "1.2.3", {}, []):
            self.assertIsNone(an.parse_number(raw), repr(raw))

    def test_a_unit_that_disagrees_with_the_point_is_refused_not_guessed(self):
        self.assertIsNone(an.parse_number("70°F", "°C"))
        self.assertEqual(an.parse_number("21 °C", "°C"), (21.0, "°C"))


class AggregateTests(unittest.TestCase):
    def test_sum_average_minimum_maximum_and_count(self):
        rows = [r(20.0), r(22.0), r(27.0)]
        self.assertEqual(an.aggregate(rows, "sum")["value"], 69.0)
        self.assertEqual(an.aggregate(rows, "average")["value"], 23.0)
        self.assertEqual(an.aggregate(rows, "min")["value"], 20.0)
        self.assertEqual(an.aggregate(rows, "max")["value"], 27.0)
        out = an.aggregate(rows, "count")
        self.assertEqual((out["value"], out["samples"]), (3, 3))
        for op in ("sum", "average", "min", "max"):
            got = an.aggregate(rows, op)
            self.assertEqual((got["ok"], got["unit"], got["samples"]), (True, "°C", 3), op)

    def test_the_unit_is_kept(self):
        self.assertEqual(an.aggregate([r(600, "ppm"), r(700, "ppm")], "average")["unit"], "ppm")

    def test_the_average_is_exact_where_float_addition_drifts(self):
        self.assertEqual(an.aggregate([r(0.1), r(0.2), r(0.3)], "sum")["value"], 0.6)
        self.assertEqual(an.aggregate([r(0.1)] * 10, "sum")["value"], 1.0)

    def test_the_witness_of_a_minimum_and_a_maximum_is_named(self):
        rows = [r(20.0, equipment="AHU-01", point="A"), r(27.0, equipment="AHU-02", point="B"), r(22.0, equipment="AHU-03", point="C")]
        self.assertEqual(an.aggregate(rows, "max")["at"], {"equipment": "AHU-02", "point": "B"})
        self.assertEqual(an.aggregate(rows, "min")["at"], {"equipment": "AHU-01", "point": "A"})

    def test_a_tie_names_the_first_by_name_not_by_chance(self):
        rows = [r(5.0, equipment="B", point="x"), r(5.0, equipment="A", point="x")]
        self.assertEqual(an.aggregate(rows, "max")["at"]["equipment"], "A")
        self.assertEqual(an.aggregate(list(reversed(rows)), "max")["at"]["equipment"], "A")

    def test_no_samples_is_said_not_zero(self):
        for op in ("sum", "average", "min", "max"):
            self.assertEqual(an.aggregate([], op), {"ok": False, "reason": "no_valid_samples"}, op)
        self.assertEqual(an.aggregate([], "count"), {"ok": True, "op": "count", "value": 0, "unit": "", "samples": 0})

    def test_two_units_are_never_combined(self):
        rows = [r(20.0, "°C"), r(70.0, "°F"), r(21.0, "°C")]
        for op in ("sum", "average", "min", "max"):
            got = an.aggregate(rows, op)
            self.assertEqual((got["ok"], got["reason"], got["units"]), (False, "unit_conflict", {"°C": 2, "°F": 1}), op)

    def test_a_reading_with_no_unit_is_not_mixed_with_one_that_has_a_unit(self):
        got = an.aggregate([r(20.0, "°C"), r(21.0, "")], "average")
        self.assertEqual((got["ok"], got["reason"]), (False, "unit_conflict"))
        self.assertEqual(an.aggregate([r(20.0, ""), r(22.0, "")], "average")["value"], 21.0)

    def test_a_count_does_not_need_one_unit(self):
        got = an.aggregate([r(20.0, "°C"), r(70.0, "°F")], "count")
        self.assertEqual((got["ok"], got["value"], got["units"]), (True, 2, {"°C": 1, "°F": 1}))

    def test_an_unknown_operation_is_refused(self):
        self.assertEqual(an.aggregate([r(1.0)], "median")["reason"], "bad_operation")

    def test_a_non_finite_value_is_never_summed(self):
        got = an.aggregate([r(1.0), r(float("nan")), r(float("inf")), r(3.0)], "sum")
        self.assertEqual((got["value"], got["samples"]), (4.0, 2))


class DifferenceTests(unittest.TestCase):
    def test_difference_and_percentage_difference(self):
        d = an.difference(r(24.0), r(20.0))
        self.assertEqual((d["ok"], d["difference"], d["unit"]), (True, 4.0, "°C"))
        p = an.percent_difference(r(24.0), r(20.0))
        self.assertEqual((p["ok"], p["percent"], p["difference"]), (True, 20.0, 4.0))
        self.assertEqual(an.percent_difference(r(15.0), r(20.0))["percent"], -25.0)

    def test_the_percentage_is_relative_to_the_second_value_and_its_size(self):
        self.assertEqual(an.percent_difference(r(-5.0), r(-10.0))["percent"], 50.0)        # against |b|, not b

    def test_a_zero_denominator_is_a_stated_gap_not_a_number_or_an_error(self):
        p = an.percent_difference(r(5.0), r(0.0))
        self.assertEqual(p, {"ok": False, "reason": "zero_denominator", "difference": 5.0, "unit": "°C"})
        self.assertEqual(an.percent_difference(r(0.0), r(0.0))["reason"], "zero_denominator")
        self.assertEqual(an.difference(r(5.0), r(0.0))["difference"], 5.0)

    def test_two_units_have_no_difference(self):
        for fn in (an.difference, an.percent_difference):
            self.assertEqual(fn(r(20.0, "°C"), r(70.0, "°F"))["reason"], "unit_mismatch", fn.__name__)

    def test_a_missing_value_has_no_difference(self):
        for fn in (an.difference, an.percent_difference):
            self.assertEqual(fn(None, r(1.0))["reason"], "missing_value", fn.__name__)
            self.assertEqual(fn(r(1.0), None)["reason"], "missing_value", fn.__name__)
            self.assertEqual(fn(r(float("nan")), r(1.0))["reason"], "missing_value", fn.__name__)

    def test_a_tiny_float_denominator_does_not_divide(self):
        self.assertEqual(an.percent_difference(r(1.0), r(1e-15))["reason"], "zero_denominator")


class TopNTests(unittest.TestCase):
    ROWS = [r(21.0, equipment="AHU-03"), r(27.0, equipment="AHU-01"), r(24.0, equipment="AHU-02"), r(19.0, equipment="AHU-04")]

    def test_the_highest_first(self):
        got = an.top_n(self.ROWS, 2)
        self.assertEqual([x["equipment"] for x in got["items"]], ["AHU-01", "AHU-02"])
        self.assertEqual([x["rank"] for x in got["items"]], [1, 2])
        self.assertEqual((got["samples"], got["unit"]), (4, "°C"))

    def test_the_lowest_first(self):
        got = an.top_n(self.ROWS, 3, highest=False)
        self.assertEqual([x["value"] for x in got["items"]], [19.0, 21.0, 24.0])

    def test_ties_keep_a_fixed_order(self):
        rows = [r(5.0, equipment="B"), r(5.0, equipment="A"), r(5.0, equipment="C")]
        self.assertEqual([x["equipment"] for x in an.top_n(rows, 3)["items"]], ["A", "B", "C"])

    def test_n_is_bounded_and_positive(self):
        self.assertEqual(len(an.top_n(self.ROWS * 20, 500)["items"]), an.MAX_TOP)
        self.assertEqual(len(an.top_n(self.ROWS, 0)["items"]), 1)
        self.assertEqual(len(an.top_n(self.ROWS, -4)["items"]), 1)
        self.assertEqual(len(an.top_n(self.ROWS, 10)["items"]), 4)          # fewer rows than asked: all of them, no padding

    def test_nothing_to_rank_and_mixed_units(self):
        self.assertEqual(an.top_n([], 3), {"ok": False, "reason": "no_valid_samples"})
        got = an.top_n([r(1.0, "°C"), r(2.0, "°F")], 1)
        self.assertEqual((got["ok"], got["reason"]), (False, "unit_conflict"))


class StatusTests(unittest.TestCase):
    def test_stale_and_faulty_readings_are_told_apart_from_good_ones(self):
        for status in (None, "", "ok", "OK", " ok "):
            self.assertIsNone(an.status_problem(status), repr(status))
        self.assertEqual(an.status_problem("stale"), "stale")
        self.assertEqual(an.status_problem("Stale"), "stale")
        for status in ("fault", "down", "disabled", "unknown", "remoteFault", "remoteDown"):
            self.assertEqual(an.status_problem(status), "bad_status", status)


class ClassifyTests(unittest.TestCase):
    SPEC = an.METRICS["humidity"]

    def point(self, **kw):
        return dict({"navName": "Room Humidity", "currentValue": "48%", "unit": "%", "reporting": True}, **kw)

    def test_a_good_point_is_a_reading(self):
        reading, why = an.classify(self.point(), "AHU-01", self.SPEC)
        self.assertEqual((reading, why), (Reading(48.0, "%", "AHU-01", "Room Humidity"), None))

    def test_each_way_a_point_is_left_out_has_its_own_name(self):
        cases = {"not_reporting": self.point(reporting=False), "stale": self.point(status="stale"), "bad_status": self.point(status="fault"),
                 "non_numeric": self.point(currentValue="Auto", unit=""), "out_of_range": self.point(currentValue="140%"),
                 "setpoint": self.point(navName="Room Humidity SP"), "unit_mismatch": self.point(currentValue="48 ppm", unit="ppm")}
        for expected, p in cases.items():
            reading, why = an.classify(p, "AHU-01", self.SPEC)
            self.assertEqual((reading, why), (None, expected), expected)

    def test_a_point_without_a_unit_takes_the_metrics_unit_and_is_counted_as_assumed(self):
        reading, why = an.classify(self.point(currentValue="48", unit=""), "AHU-01", self.SPEC)
        self.assertEqual((reading.value, reading.unit, why), (48.0, "%", "assumed_unit"))

    def test_a_zero_is_a_reading(self):
        reading, why = an.classify({"navName": "Fan Power", "currentValue": "0 kW", "unit": "kW", "reporting": True}, "FCU-01", an.METRICS["power"])
        self.assertEqual((reading.value, reading.unit, why), (0.0, "kW", None))
        reading, why = an.classify(self.point(currentValue="0%"), "AHU-01", an.METRICS["power"])
        self.assertEqual((reading, why), (None, "unit_mismatch"))          # 0 % is not kW: the unit decides, not the zero

    def test_setpoints_are_found_by_flag_or_by_name(self):
        for name in ("Room Temp SP", "Room Temp Setpoint", "Room Temp Set Point", "Temp_SP", "SP Temp", "Zone Temp Stpt"):
            self.assertTrue(an.is_setpoint({"navName": name}), name)
        self.assertTrue(an.is_setpoint({"navName": "Room Temp", "sp": True}))
        for name in ("Room Temp", "Supply Air Temp", "Spa Room Temp", "RA Humid", "Wsp Temp"):
            self.assertFalse(an.is_setpoint({"navName": name}), name)


class MetricNameTests(unittest.TestCase):
    def test_a_point_is_matched_by_the_words_of_its_name(self):
        m = an.METRICS
        self.assertTrue(an.name_matches(m["humidity"], "Room Humidity"))
        self.assertTrue(an.name_matches(m["humidity"], "RA Humid"))
        self.assertTrue(an.name_matches(m["co2"], "Room CO2"))
        self.assertTrue(an.name_matches(m["co2"], "RA_CO2_PPM"))
        self.assertTrue(an.name_matches(m["temperature"], "Supply Air Temp"))
        self.assertFalse(an.name_matches(m["temperature"], "Template Mode"))             # a word, not a fragment of one
        self.assertFalse(an.name_matches(m["temperature"], "Attempt Count"))
        self.assertFalse(an.name_matches(m["power"], "Power Factor"))                    # not a quantity of power
        self.assertTrue(an.name_matches(m["power"], "Active Power"))

    def test_only_power_is_additive(self):
        self.assertEqual({k for k, v in an.METRICS.items() if v["additive"]}, {"power"})
        self.assertTrue(math.isfinite(an.METRICS["power"]["bounds"][1]))


if __name__ == "__main__":
    unittest.main()
