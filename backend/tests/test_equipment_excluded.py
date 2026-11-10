"""The equipment list's name rule (main._flatten_equip): ENERGY / USAGE / CALC records stay out of `equipment` for every project, as before.
What the rule leaves out is only collected, in the same shape, when a caller asks for it (the payload's separate `excluded` key, read by the
EKO Hospital Live Twin alone).

Run from backend/:   python -m unittest tests.test_equipment_excluded
"""
import os
import sys
import unittest
from copy import deepcopy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import main  # noqa: E402


def _eq(name, fin_id, bim=""):
    return {"name": name, "bimId": bim or fin_id, "finId": fin_id, "equipId": "", "alarms": [], "tags": ["equip", "meter"] if "ENERGY" in name else ["ahu"],
            "system": "", "points": [{"navName": "kW", "currentValue": "12.5", "kind": "Number", "unit": "kW", "reporting": True, "bool": None}]}


REALTIME = {
    "LEVEL-01": {"hvac": [_eq("AHU_01", "p:ekoHospital:r:a1", "2wLf9$IGsICFYFjFAcUnf2"), _eq("GF_ENERGY", "p:ekoHospital:r:m1")], "cctv": []},
    "ROOF": {"hvac": [_eq("RF_ENERGY", "p:ekoHospital:r:m4"), _eq("KPI_CALCULATION", "p:ekoHospital:r:k1"), _eq("WATER_USAGE_TOTAL", "p:x:r:u1")], "cctv": []},
    "Unknown Floor": {"hvac": [_eq("CHILLER_01", "p:ekoHospital:r:c1")], "cctv": [_eq("CCTV_01", "p:ekoHospital:r:v1")]},
}


class ExcludedEquipment(unittest.TestCase):
    def test_equipment_list_is_unchanged(self):
        before = main._flatten_equip(deepcopy(REALTIME))
        side: list = []
        after = main._flatten_equip(deepcopy(REALTIME), side)
        self.assertEqual(before, after, "asking for the excluded records changes nothing in the list")
        self.assertEqual([e["name"] for e in after], ["AHU_01", "CHILLER_01", "CCTV_01"])
        self.assertFalse(any(x in e["name"] for e in after for x in ("ENERGY", "USAGE", "CALC")))

    def test_excluded_records_are_collected_in_the_same_shape(self):
        side: list = []
        listed = main._flatten_equip(deepcopy(REALTIME), side)
        self.assertEqual([e["name"] for e in side], ["GF_ENERGY", "RF_ENERGY", "KPI_CALCULATION", "WATER_USAGE_TOTAL"])
        self.assertEqual(set(side[0]), set(listed[0]), "same fields as a listed record")
        self.assertEqual((side[0]["floor"], side[0]["finId"]), ("LEVEL-01", "p:ekoHospital:r:m1"))

    def test_no_side_list_means_no_collection(self):
        self.assertEqual(len(main._flatten_equip(deepcopy(REALTIME), None)), 3)


if __name__ == "__main__":
    unittest.main()
