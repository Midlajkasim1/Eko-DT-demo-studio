"""Eko-Chat building-performance questions: indoor environment (IAQ, CO2, temperature, humidity), energy over a period, and HVAC online state.

Run from backend/:   python -m unittest tests.test_eko_chat_metrics
Every value comes from the caches the backend fills from FIN; here the caches are set by the test (polling stopped), the way FIN would
fill them. Fake FIN session, throwaway notification database, no model, no network.
"""
import os
import sys
import unittest
from datetime import datetime, timedelta
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_router  # noqa: E402
import main  # noqa: E402
from fin_client import AM_PM_LOOKUP, MONTHS_ORDER  # noqa: E402
from test_eko_chat import PROJECT_A  # noqa: E402
from test_eko_chat_rules import RULES, RulesBase  # noqa: E402

NOW = datetime(2026, 10, 28, 10, 30)      # the site clock in these tests: hours 00..09 are complete, 10 is open


def iso(minutes_ago=0):
    return (datetime.now() - timedelta(minutes=minutes_ago)).isoformat()


def hist(samples):
    """A FIN hourly series as the backend caches it: year > month > "month d" > "1 pm". samples: {datetime: value}."""
    out = {}
    for when, value in samples.items():
        day = out.setdefault(str(when.year), {}).setdefault(MONTHS_ORDER[when.month - 1], {})
        day.setdefault(f"{MONTHS_ORDER[when.month - 1]} {when.day}", {})[AM_PM_LOOKUP[when.hour]] = None if value is None else str(value)
    return out


def day_samples(day, hours, value=lambda h: 100.0 + h):
    return {datetime(day.year, day.month, day.day, h): value(h) for h in hours}


def point(name, value, unit="", reporting=True):
    return {"navName": name, "currentValue": value, "unit": unit, "reporting": reporting}


class MetricBase(RulesBase):
    def frozen(self, cfg=RULES, **caches):
        """Sign in, stop polling, then put these caches where the poll would have left them."""
        self.start(cfg=cfg)
        main._cancel_polling()
        patches = [mock.patch.object(eko_chat, "_site_now", return_value=NOW)]
        for name, value in caches.items():
            patches.append(mock.patch.object(main, name, value))
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def power(self, **live):
        return {"timestamp": iso(), **live}

    def equipment(self, items):
        return {"timestamp": iso(), "equipment": items}


class EnvironmentTests(MetricBase):
    def test_iaq_is_the_mapped_index_with_no_invented_label(self):
        self.frozen(cached_power_data=self.power(iaq_index=82.37))
        stamp = main.cached_power_data["timestamp"]
        for q in ("What is the current IAQ index?", "What is the current indoor air quality?", "iaq"):
            body = self.ok(q)
            self.assertEqual((body["route"], body["tool_calls"][0]["name"]), ("direct", "get_environment"), q)
            self.assertIn("IAQ index: 82.4", body["answer"], q)
            self.assertIn(f"Updated {stamp}", body["answer"], q)
            self.assertIn("No classification", body["answer"], q)
            for label in ("good", "poor", "moderate", "healthy", "unhealthy"):
                self.assertNotIn(label, body["answer"].lower(), (q, label))
            self.assertEqual(body["card"]["rows"], [["IAQ index", 82.4, ""]])

    def test_a_metric_the_project_does_not_map_or_fin_did_not_answer_is_named(self):
        self.frozen(cached_power_data=self.power(ra_co2=None))
        mapped = self.ok("What is the current IAQ index?")
        self.assertIn("this project has no live point mapped for it (iaq_index)", mapped["answer"])
        self.assertIsNone(mapped["card"])
        empty = self.ok("What is the current CO2 level?")
        self.assertIn("FIN returned no value for it", empty["answer"])
        self.assertIn("no equipment point named *co2* is reporting", empty["answer"])

    def test_co2_reports_the_live_point_and_the_sensor_average_with_counts(self):
        eq = [{"name": "AHU-1", "points": [point("RA CO2", "600 ppm", "ppm"), point("Room CO2", "700", "ppm"), point("Old CO2", "800", "ppm", reporting=False),
                                           point("Bad CO2", "9000", "ppm")]}]
        self.frozen(cached_power_data=self.power(ra_co2=640.0), cached_equip_data=self.equipment(eq))
        body = self.ok("What is the current CO2 level?")
        rows = {r[0]: r[1:] for r in body["card"]["rows"]}
        self.assertEqual(rows["Return-air CO2"], [640.0, "ppm"])
        self.assertEqual(rows["Average CO2 of equipment points"], [650.0, "ppm"])
        self.assertIn("average of 2 points, 600 to 700", body["answer"])        # the unreported and the implausible point are not in it

    def test_one_source_down_still_answers_with_the_other_and_says_what_is_missing(self):
        eq = [{"name": "AHU-1", "points": [point("Room CO2", "700", "ppm")]}]
        self.frozen(cached_power_data=self.power(ra_co2=None), cached_equip_data=self.equipment(eq))
        answer = self.ok("What is the current CO2 level?")["answer"]
        self.assertIn("Average CO2 of equipment points: 700 ppm", answer)
        self.assertIn("Not available: Return-air CO2: FIN returned no value for it", answer)

    def test_temperature_is_the_zone_average_and_names_its_setpoint(self):
        self.frozen(cached_power_data=self.power(avg_zone_temp=23.46, avg_zone_temp_sp=22.0))
        answer = self.ok("What is the current indoor temperature?")["answer"]
        self.assertIn("Average zone temperature: 23.5 °C", answer)
        self.assertIn("Average zone temperature setpoint: 22 °C", answer)

    def test_a_bare_temperature_question_is_not_taken_for_the_indoor_one(self):
        self.assertEqual(eko_chat_router.route("What is the temperature?")["route"], "llm_fallback")

    def test_an_implausible_value_is_refused_with_the_range_it_broke(self):
        self.frozen(cached_power_data=self.power(avg_zone_temp=99.0, comfort_compliance=120.0))
        self.assertIn("outside the plausible range 10–50", self.ok("What is the current indoor temperature?")["answer"])
        self.assertIn("outside the plausible range 0–100", self.ok("What is the comfort index?")["answer"])

    def test_humidity_comes_only_from_the_equipment_points_that_report_it(self):
        eq = [{"name": "FCU-1", "points": [point("Room Humidity", "48", "%"), point("RA Humid", "52 %", "%")]}]
        self.frozen(cached_power_data=self.power(), cached_equip_data=self.equipment(eq))
        self.assertIn("Average Humidity of equipment points: 50 %", self.ok("What is the current humidity level?")["answer"])
        with mock.patch.object(main, "cached_equip_data", self.equipment([{"name": "FCU-1", "points": []}])):
            self.assertIn("no equipment point named *humid* is reporting", self.ok("What is the current humidity level?")["answer"])

    def test_old_or_unread_data_is_not_served_as_current(self):
        self.frozen(cached_power_data={"timestamp": iso(30), "iaq_index": 80.0})
        self.assertIn("older than", self.ok("What is the current IAQ index?")["answer"])
        with mock.patch.object(main, "cached_power_data", {}):
            self.assertIn("has not read this data from FIN yet", self.ok("What is the current IAQ index?")["answer"])


class EnergyTests(MetricBase):
    def today(self, samples, age=0, **extra):
        return {"cached_power_history": {"Hourly_Energy_Consumption_his": hist(samples)}, "cached_power_history_at": iso(age), **extra}

    def test_today_is_the_sum_of_the_hourly_samples_from_midnight(self):
        samples = day_samples(NOW, range(0, 11))                        # 00:00..10:00 = 100+h
        self.frozen(**self.today(samples=samples), cached_power_data=self.power(hourly_energy=999.0))
        expected = round(sum(100.0 + h for h in range(11)), 1)
        for q in ("What is the energy consumption today?", "How much energy have we used today?", "What is today's energy usage?"):
            body = self.ok(q)
            self.assertEqual((body["route"], body["tool_calls"][0]["name"]), ("direct", "get_energy"), q)
            self.assertIn(f"Energy consumption today (2026-10-28): {expected:g} kWh", body["answer"], q)
            self.assertIn("10 of 10 hours reported", body["answer"], q)
            self.assertIn("including the current hour", body["answer"], q)
            self.assertNotIn("999", body["answer"], q)                    # the instantaneous reading is never mistaken for the energy
        self.assertEqual(body["card"]["rows"], [["Energy consumption", expected, "kWh", "10 of 10"]])

    def test_a_missing_hour_and_a_counter_reset_are_named_not_counted(self):
        samples = day_samples(NOW, range(0, 10))
        del samples[datetime(2026, 10, 28, 3)]                         # FIN has no sample for 03:00
        samples[datetime(2026, 10, 28, 5)] = -20.0                     # a meter reset reads as a negative step
        self.frozen(**self.today(samples=samples))
        body = self.ok("What is the energy consumption today?")
        expected = round(sum(100.0 + h for h in range(10) if h not in (3, 5)), 1)
        self.assertIn(f"{expected:g} kWh", body["answer"])
        self.assertIn("8 of 10 hours reported", body["answer"])
        self.assertIn("Not counted, no reading: 03:00", body["answer"])
        self.assertIn("Not counted, negative sample: 05:00", body["answer"])
        result = eko_chat.run_tool("get_energy", {"period": "today"}, main._chat_view())
        self.assertFalse(result["complete"])

    def test_yesterday_is_the_whole_previous_day_and_does_not_borrow_todays_hours(self):
        yesterday = NOW - timedelta(days=1)
        samples = {**day_samples(yesterday, range(24), lambda h: 10.0), **day_samples(NOW, range(0, 11), lambda h: 1000.0)}
        self.frozen(**self.today(samples=samples))
        body = self.ok("What was the energy consumption yesterday?")
        self.assertIn("Energy consumption yesterday (2026-10-27): 240 kWh, 24 of 24 hours reported", body["answer"])
        self.assertNotIn("through", body["answer"])

    def test_the_first_minutes_of_the_day_have_no_complete_hour_yet(self):
        with mock.patch.object(eko_chat, "_site_now", return_value=datetime(2026, 10, 28, 0, 15)):
            result = eko_chat.run_tool("get_energy", {"period": "today"}, eko_chat.DataView(
                authenticated=True, project_id="p", project_name="x", power_history=self.today(samples={datetime(2026, 10, 28, 0): 12.5})["cached_power_history"],
                power_history_at=iso()))
        self.assertEqual((result["value"], result["hours_expected"], result["hours_reported"], result["includes_open_hour"]), (12.5, 0, 0, True))

    def test_month_is_fins_own_month_to_date_point(self):
        self.frozen(cached_power_data=self.power(current_month=12345.678))
        body = self.ok("What is the total energy consumption this month?")
        self.assertIn("Energy consumption this month (2026-10): 12345.7 kWh, FIN's month-to-date reading", body["answer"])
        with mock.patch.object(main, "cached_power_data", self.power(current_month=None)):
            self.assertIn("FIN returned no value for it", self.ok("What is the energy consumption this month?")["answer"])
        with mock.patch.object(main, "cached_power_data", self.power(current_month=-5.0)):
            self.assertIn("outside the plausible range", self.ok("What is the energy consumption this month?")["answer"])

    def test_no_history_is_reported_not_estimated(self):
        self.frozen(cached_power_history={}, cached_power_history_at=iso())
        self.assertIn("returned no hourly energy series", self.ok("What is the energy consumption today?")["answer"])
        self.frozen(cached_power_history={"Hourly_Energy_Consumption_his": hist({datetime(2026, 9, 1, 5): 10.0})}, cached_power_history_at=iso())
        self.assertIn("no usable sample for 2026-10-28", self.ok("What is the energy consumption today?")["answer"])
        with mock.patch.object(main, "cached_power_history_at", None):
            self.assertIn("has not read this data from FIN yet", self.ok("What is the energy consumption today?")["answer"])

    def test_old_history_is_not_served_as_current(self):
        self.frozen(**self.today(samples=day_samples(NOW, range(0, 10)), age=30))
        self.assertIn("too old to be shown as current", self.ok("What is the energy consumption today?")["answer"])

    def test_the_unit_is_kwh_and_current_power_is_still_the_existing_snapshot_answer(self):
        self.frozen(**self.today(samples=day_samples(NOW, range(0, 10))), cached_power_data=self.power(total_power=111.0))
        self.assertIn(" kWh", self.ok("What is the energy consumption today?")["answer"])
        body = self.ok("What is the current power consumption?")
        self.assertEqual(body["tool_calls"][0]["name"], "get_building_snapshot")

    BOARDS = [{"name": "MCC 1", "live": "mcc1", "history": "H_MCC1"}, {"name": "MCC 2", "live": "mcc2", "history": "H_MCC2"},
              {"name": "ATS", "live": "ats", "history": "H_ATS"}]

    def test_the_biggest_consumer_is_ranked_by_distribution_board_and_says_so(self):
        history = {"H_MCC1": hist(day_samples(NOW, range(0, 10), lambda h: 5.0)), "H_MCC2": hist(day_samples(NOW, range(0, 10), lambda h: 9.0))}
        self.frozen(cached_power_history=history, cached_power_history_at=iso())
        with mock.patch.dict(main.CONFIG, {"power_boards": self.BOARDS}):
            for q in ("Which equipment is consuming the most energy?", "What uses the most energy?", "what is the biggest energy consumer"):
                body = self.ok(q)
                self.assertEqual(body["tool_calls"][0]["arguments"], {"by": "board", "period": "today"}, q)
                self.assertIn("Highest energy today by distribution board: MCC 2 (90 kWh)", body["answer"], q)
                self.assertIn("not individual equipment", body["answer"], q)
                self.assertIn("No data: ATS", body["answer"], q)
        self.assertEqual([r[:2] for r in body["card"]["rows"]], [["MCC 2", 90.0], ["MCC 1", 50.0]])

    def test_without_mapped_boards_equipment_energy_is_reported_unavailable(self):
        self.frozen(cached_power_history={}, cached_power_history_at=iso())
        with mock.patch.dict(main.CONFIG, {"power_boards": []}):
            answer = self.ok("Which equipment is consuming the most energy?")["answer"]
        self.assertIn("measured per distribution board only", answer)
        self.assertIn("Individual equipment (AHU, FCU) energy is not measured", answer)

    def test_the_shipped_board_mapping_matches_the_dashboards_own(self):
        import json
        with open(os.path.join(HERE, "..", "config.json"), encoding="utf-8") as f:
            cfg = json.load(f)
        for board in cfg["power_boards"]:
            self.assertIn(board["live"], cfg["live_point_ids"], board)
            self.assertIn(board["history"], cfg["power_endpoints"], board)


class HvacTests(MetricBase):
    FLEET = [{"name": "AHU-1", "floor": "L1", "type": "ahu", "tags": ["ahu"], "category": "hvac", "isSystem": True, "inAlarm": False},
             {"name": "AHU-2", "floor": "L1", "type": "ahu", "tags": ["ahu"], "category": "hvac", "isSystem": True, "inAlarm": True},
             {"name": "FCU-1", "floor": "L2", "type": "fcu", "tags": ["fcu"], "category": "hvac", "isSystem": True, "inAlarm": False},
             {"name": "PMU-1", "floor": "L1", "type": "meter", "tags": ["meter"], "category": "hvac", "isSystem": False, "inAlarm": False}]
    FACILITY = {"onlineNames": ["AHU-1", "FCU-1"], "onlineEquipment": 2, "totalEquipment": 3}

    def go(self):
        self.frozen(cached_equip_data=self.equipment(self.FLEET), cached_facility=self.FACILITY,
                    cached_alarm_data={"timestamp": iso(), "alarms": [], "counts": {"critical": 0, "warning": 0, "info": 0, "total": 4}})

    def test_which_ahus_are_online_names_both_sides_and_only_systems(self):
        self.go()
        body = self.ok("Which AHUs are online?")
        self.assertEqual(body["tool_calls"][0]["arguments"], {"type": "ahu"})
        self.assertIn("Online ahu: 1 of 2. Online: AHU-1. Offline: AHU-2.", body["answer"])
        self.assertEqual(body["card"]["rows"], [["AHU-1", "online"], ["AHU-2", "offline"]])

    def test_running_is_reported_as_online_with_its_definition(self):
        self.go()
        answer = self.ok("How many HVAC systems are running?")["answer"]
        self.assertIn("HVAC systems online: 2 of 3; 1 in alarm. Open alarms: 4.", answer)       # the meter is not an HVAC system
        self.assertIn("Run/stop state is not read", answer)
        self.assertIn("Offline: AHU-2", answer)
        self.assertIn("HVAC systems online: 2 of 3", self.ok("What is the current status of the HVAC system?")["answer"])
        self.assertIn("Online fcu: 1 of 1", self.ok("How many FCUs are online?")["answer"])

    def test_a_class_with_no_systems_and_a_missing_online_list_are_said_plainly(self):
        self.go()
        self.assertIn("No ef systems are recorded", self.ok("Which EFs are online?")["answer"])
        with mock.patch.object(main, "cached_facility", {"onlineEquipment": 2}):
            self.assertIn("Which systems are online is not available", self.ok("Which AHUs are online?")["answer"])


class AccessTests(MetricBase):
    QUESTIONS = ("What is the current IAQ index?", "What is the energy consumption today?", "Which AHUs are online?")

    def test_every_new_question_needs_the_users_own_session_and_the_open_project(self):
        self.frozen(cached_power_data=self.power(iaq_index=80.0), cached_facility=HvacTests.FACILITY)
        for q in self.QUESTIONS:
            self.assertEqual(self.ask(q).status_code, 200, q)
        self.http.cookies.clear()
        for q in self.QUESTIONS:
            r = self.ask(q)
            self.assertEqual(r.status_code, 401, q)
            self.assertNotIn("80", r.text)
        self.assertEqual(self.http.post("/api/chat", json={"message": self.QUESTIONS[0]}, headers={"X-Eko-Project": "proj-B"}).status_code, 401)

    def test_another_project_gets_nothing(self):
        self.frozen(cfg={"enabled": True, "provider": "rules", "allowed_projects": ["someOtherProject"]}, cached_power_data=self.power(iaq_index=80.0))
        r = self.ask(self.QUESTIONS[0])
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (403, "project_not_supported"))
        self.assertNotIn("80", r.text)
        wrong = self.http.post("/api/chat", json={"message": self.QUESTIONS[0]}, headers={"X-Eko-Project": "proj-B"})
        self.assertEqual(wrong.status_code, 409)

    def test_no_model_is_involved_and_all_tools_stay_read_only(self):
        self.frozen(cached_power_data=self.power(iaq_index=80.0))
        self.assertEqual(self.ok("What is the current IAQ index?")["model"], None)   # RulesBase fails the test if an adapter or the network is touched
        for name in ("get_environment", "get_energy", "get_hvac_status"):
            params = eko_chat.TOOLS[name]["parameters"]
            self.assertIs(params["additionalProperties"], False)
            self.assertTrue(set(params["properties"]) <= {"metric", "period", "by", "type"})


class ExistingBehaviourTests(MetricBase):
    def test_equipment_alarm_and_notification_questions_are_unchanged(self):
        self.start()
        for q, tool in (("List all assets", "find_equipment"), ("What is the status of EQ-1?", "get_equipment_status"),
                        ("Show critical alerts", "get_alarms"), ("Show recent notifications", "get_notifications"),
                        ("Which equipment has active alarms?", "find_equipment"), ("Show the latest open alarms", "get_alarms"),
                        ("Show unacknowledged notifications", "get_notifications")):
            self.assertEqual(self.ok(q)["tool_calls"][0]["name"], tool, q)
        self.assertIn("does not record acknowledgements", self.ok("Which notifications have been acknowledged?")["answer"])

    def test_questions_that_only_mention_these_words_are_not_hijacked(self):
        for q in ("Why is the energy consumption high today?", "Compare energy this month with last month", "What is the weather today?",
                  "Which AHU has the most alarms today?", "What will the CO2 be tomorrow?"):
            self.assertEqual(eko_chat_router.route(q)["route"], "llm_fallback", q)


if __name__ == "__main__":
    unittest.main()
