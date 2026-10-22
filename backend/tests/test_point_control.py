"""Point control: which FIN points the dashboard may write, and the write endpoint.

Run from backend/:   python -m unittest discover -s tests -v
No FIN server needed: the endpoint tests use a stand-in client.
"""
import asyncio
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from point_control import control_for, encode_value, equipment_class  # noqa: E402

POLICY = {
    "enabled": True,
    "write_level": 8,
    "equipment": {"fcu": ["setpoint", "status"], "vav": ["setpoint", "status"],
                  "ahu": ["setpoint"], "mahu": ["setpoint"], "fahu": ["setpoint"]},
    "status_points": ["Start_Stop", "Start/Stop"],
    "setpoint_ranges": {"°C": {"min": 16, "max": 30, "step": 0.5}},
}


def sp(**extra):
    return {"navName": "Space_Temp_SP", "writable": True, "pointKind": "Number", "sp": True, "unit": "°C",
            "writeLevel": 17, **extra}


def start_stop(**extra):
    return {"navName": "Start/Stop", "writable": True, "pointKind": "Bool", "enum": "STOP,START", **extra}


class EquipmentClassTest(unittest.TestCase):
    def test_names(self):
        self.assertEqual(equipment_class("FCU-L3-02", [], POLICY), "fcu")
        self.assertEqual(equipment_class("VAV-L2-04", [], POLICY), "vav")
        self.assertEqual(equipment_class("MAHU-ANC09-BF-01", [], POLICY), "mahu")
        self.assertEqual(equipment_class("FAHU-ANC09-BF-01", [], POLICY), "fahu")
        self.assertEqual(equipment_class("AHU-ANC09-GF-01", [], POLICY), "ahu")
        self.assertIsNone(equipment_class("CHILLER-L3-01", [], POLICY))
        self.assertIsNone(equipment_class("ILIANA ECO-ANC09-BF-01", [], POLICY))

    def test_most_specific_tag_wins(self):
        self.assertEqual(equipment_class("Unit 7", ["ahu", "fahu"], POLICY), "fahu")

    def test_class_left_out_of_the_policy(self):
        self.assertIsNone(equipment_class("FCU-1", [], {**POLICY, "equipment": {"ahu": ["setpoint"]}}))


class ControlForTest(unittest.TestCase):
    def test_fcu_setpoint_uses_the_unit_range(self):
        ctl = control_for(sp(), "fcu", POLICY)
        self.assertEqual((ctl["role"], ctl["min"], ctl["max"], ctl["step"], ctl["manual"]), ("setpoint", 16, 30, 0.5, False))

    def test_point_range_wins_over_the_unit_range(self):
        ctl = control_for(sp(minVal="18°C", maxVal="26°C"), "fcu", POLICY)
        self.assertEqual((ctl["min"], ctl["max"]), (18, 26))

    def test_manual_when_the_write_level_holds_it(self):
        self.assertTrue(control_for(sp(writeLevel=8.0), "fcu", POLICY)["manual"])

    def test_status_on_fcu_and_vav_only(self):
        ctl = control_for(start_stop(), "fcu", POLICY)
        self.assertEqual([o["label"] for o in ctl["options"]], ["STOP", "START"])
        self.assertIsNotNone(control_for(start_stop(), "vav", POLICY))
        self.assertIsNone(control_for(start_stop(), "ahu", POLICY))

    def test_refused(self):
        self.assertIsNone(control_for(sp(writable=False), "fcu", POLICY))
        self.assertIsNone(control_for(sp(unit="Pa"), "ahu", POLICY))            # no safe range known
        self.assertIsNone(control_for(sp(navName="Fire_Damper_SP"), "ahu", POLICY))
        self.assertIsNone(control_for({"navName": "Status", "writable": True, "pointKind": "Bool"}, "fcu", POLICY))
        self.assertIsNone(control_for(sp(), None, POLICY))
        self.assertIsNone(control_for(sp(), "fcu", {**POLICY, "enabled": False}))


class EncodeValueTest(unittest.TestCase):
    def test_setpoint(self):
        ctl = control_for(sp(), "fcu", POLICY)
        self.assertEqual(encode_value(ctl, 23.5), "23.5°C")
        self.assertEqual(encode_value(ctl, "22"), "22°C")
        for bad in (35, 15.5, "abc", None, ""):
            with self.assertRaises(ValueError):
                encode_value(ctl, bad)

    def test_status(self):
        ctl = control_for(start_stop(), "fcu", POLICY)
        self.assertEqual((encode_value(ctl, True), encode_value(ctl, False)), ("T", "F"))
        with self.assertRaises(ValueError):
            encode_value(ctl, 1)


try:
    import main  # noqa: E402
    from fastapi.testclient import TestClient  # noqa: E402
except ImportError:   # the backend's packages are not installed: the policy tests above still run
    main = None


class StubFin:
    """Records writes and answers read-backs from a small in-memory point table."""
    is_authenticated = True
    username = "operator"
    project_name = "ekoMedical"

    def __init__(self, records, write_error=""):
        self.records, self.write_error, self.writes = records, write_error, []

    async def write_point(self, point_id, level, value, who):
        self.writes.append((point_id, level, value, who))
        if self.write_error:
            return False, self.write_error
        rec = self.records[point_id]
        rec["writeLevel"] = 17.0 if value is None else float(level)
        if value is not None:
            rec["curVal"] = value
        return True, ""

    async def read_point(self, point_id):
        return dict(self.records[point_id])

    async def close(self):
        pass


@unittest.skipIf(main is None, "backend packages not installed")
class PointWriteEndpointTest(unittest.TestCase):
    def setUp(self):
        self._sleep = asyncio.sleep
        asyncio.sleep = lambda *_a, **_k: self._sleep(0)
        self._client, self._cache, self._config = main.client, main.cached_equip_data, main.CONFIG
        main.CONFIG = {**main.CONFIG, "point_control": POLICY}
        points = [dict(sp(id="p:x:r:sp", currentValue="18°C")), dict(start_stop(id="p:x:r:ss", currentValue="START")),
                  {"id": "p:x:r:st", "navName": "Space_Temp", "pointKind": "Number", "unit": "°C", "currentValue": "21°C"}]
        main.cached_equip_data = {"equipment": [{"name": "FCU-L3-02", "tags": [], "points": main._with_control("FCU-L3-02", [], points)}]}
        self.fin = StubFin({"p:x:r:sp": {"curVal": "18°C", "writeLevel": 17.0}, "p:x:r:ss": {"curVal": "T", "writeLevel": 17.0}})
        main.client = self.fin
        self.http = TestClient(main.app)

    def tearDown(self):
        asyncio.sleep = self._sleep
        main.client, main.cached_equip_data, main.CONFIG = self._client, self._cache, self._config

    def write(self, **body):
        return self.http.post("/api/fin/point-write", json=body)

    def test_setpoint_written_at_the_manual_level_and_confirmed(self):
        res = self.write(point_id="p:x:r:sp", value=23.5)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(self.fin.writes, [("p:x:r:sp", 8, "23.5°C", "EKO Digital Twin (operator)")])
        body = res.json()
        self.assertTrue(body["confirmed"])
        self.assertTrue(body["control"]["manual"])
        self.assertEqual(main.cached_equip_data["equipment"][0]["points"][0]["currentValue"], body["currentValue"])

    def test_status_and_return_to_auto(self):
        self.assertEqual(self.write(point_id="p:x:r:ss", value=False).status_code, 200)
        self.assertEqual(self.fin.writes[-1][2], "F")
        res = self.write(point_id="p:x:r:ss", action="auto")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.fin.writes[-1][2], None)
        self.assertFalse(res.json()["control"]["manual"])

    def test_refusals_never_reach_fin(self):
        self.assertEqual(self.write(point_id="p:x:r:st", value=20).status_code, 403)    # read-only sensor
        self.assertEqual(self.write(point_id="p:x:r:sp", value=40).status_code, 422)    # out of range
        self.assertEqual(self.write(point_id="p:x:r:zz", value=20).status_code, 404)    # not live
        self.assertEqual(self.write(point_id="p:x:r:sp", value=20, action="emergency").status_code, 400)
        self.assertEqual(self.fin.writes, [])

    def test_fin_refusal_is_reported(self):
        self.fin.write_error = "FIN answered 400: Attest-Key header required"
        res = self.write(point_id="p:x:r:sp", value=22)
        self.assertEqual(res.status_code, 502)
        self.assertIn("Attest-Key", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()
