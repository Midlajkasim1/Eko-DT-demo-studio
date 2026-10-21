"""Equipment point values on Zinc text, through the realtime path the poller uses:
parse_zinc_csv -> FinScramClient._build_realtime -> the points the 3D internals and asset panel read.

The grids are SYNTHETIC (point names from the MAHU-ANC09-BF-01 FIN page, values chosen per case);
no real FIN points grid has been captured in this repo.
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from fin_client import FinScramClient, parse_zinc_csv  # noqa: E402

EQUIP = 'ver:"3.0"\nid,navName,equip,floorRef\n@e1 "MAHU-ANC09-BF-01","MAHU-ANC09-BF-01",M,@f1 "Basement"\n'


def points(*rows):
    head = 'ver:"3.0"\nid,navName,equipRef,curVal,his,unit\n'
    return head + "".join(
        f'@p{i} "MAHU-ANC09-BF-01 {nav}","{nav}",@e1 "MAHU-ANC09-BF-01",{cur},{his},{unit}\n'
        for i, (nav, cur, his, unit) in enumerate(rows)
    )


def read(*rows):
    holder = type("Holder", (), {})()
    floors = FinScramClient._build_realtime(holder, points(*rows), EQUIP, "")
    [eq] = floors["Basement"]["hvac"]
    return {p["navName"]: p for p in eq["points"]}


class ZincNull(unittest.TestCase):
    def test_zinc_null_and_not_available_parse_as_no_value(self):
        [row] = parse_zinc_csv('ver:"3.0"\nid,a,b,c\n@x,N,NA,"N"\n')
        self.assertIsNone(row["a"])
        self.assertIsNone(row["b"])
        self.assertEqual(row["c"], "N", 'a quoted "N" is text')

    def test_a_null_reading_is_shown_as_missing_never_as_the_letter_n(self):
        pts = read(("SA_TEMP", "N", "M", ""), ("PRE_FILTER", "NA", "M", ""))
        for nav in ("SA_TEMP", "PRE_FILTER"):
            self.assertEqual(pts[nav]["currentValue"], "—", nav)
            self.assertFalse(pts[nav]["reporting"], nav)
            self.assertEqual(pts[nav]["kind"], "Null", nav)

    def test_a_null_point_that_is_not_historized_is_left_out(self):
        self.assertNotIn("SF_TRIP_ALARM", read(("SF_TRIP_ALARM", "N", "", "")))


class StatusValues(unittest.TestCase):
    def test_booleans_arrive_as_on_off(self):
        pts = read(("FA_DAMPER_STS", "T", "M", ""), ("SF_VFD_RUN_STS", "F", "M", ""))
        self.assertEqual((pts["FA_DAMPER_STS"]["currentValue"], pts["FA_DAMPER_STS"]["kind"]), ("On", "Bool"))
        self.assertEqual((pts["SF_VFD_RUN_STS"]["currentValue"], pts["SF_VFD_RUN_STS"]["kind"]), ("Off", "Bool"))

    def test_numbers_keep_their_reading(self):
        pts = read(("COOLING_VALVE_POS", "40", "M", "%"), ("SA_TEMP", "18.25", "M", "°C"))
        self.assertEqual(pts["COOLING_VALVE_POS"]["currentValue"], "40%")
        self.assertEqual(pts["SA_TEMP"]["currentValue"], "18.25°C")


if __name__ == "__main__":
    unittest.main()
