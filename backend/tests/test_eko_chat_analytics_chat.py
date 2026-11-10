"""Eko-Chat Phase 2 through the chat endpoint: comparison, cross-equipment point search, analytics and alarm-record questions, alone and in a
message of several questions.

Run from backend/:   python -m unittest tests.test_eko_chat_analytics_chat
Rules route the question, the Phase 2 tools answer it from the FIN caches the test sets (polling stopped), and the sentence is written by code
and checked against the tool result. Fake FIN, throwaway notification database, no model, no network.
"""
import os
import sys
import time
import unittest
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_context as ctx_mod  # noqa: E402
import eko_chat_router as router  # noqa: E402
import main  # noqa: E402
from test_eko_chat_metrics import MetricBase  # noqa: E402
from test_eko_chat_points import eq, pt, view  # noqa: E402
from test_eko_chat_projects import HOSPITAL, HOSPITAL_ID, MARSA, MARSA_ID, ProjectChatBase  # noqa: E402


def fleet():
    return [
        eq("AHU_01", [pt("Room Temp", "24.0", "°C"), pt("Room Humidity", "40%", "%"), pt("Room CO2", "600 ppm", "ppm")], fin_id="e1",
           alarms=[{"alarm": "High temperature", "priority": 200}]),
        eq("AHU_02", [pt("Room Temp", "20.0", "°C"), pt("Room Humidity", "50%", "%"), pt("Room CO2", "800 ppm", "ppm")], fin_id="e2"),
        eq("FCU-01", [pt("Room Temp", "22.0", "°C"), pt("Room Humidity", "30%", "%")], type_="fcu"),
        eq("FCU-02", [pt("Room Temp", "26.0", "°C")], type_="fcu"),
    ]


def rec_row(day, active, message="High temperature", source="AHU_01", hour=9):
    return {"alarm": True, "active": active, "message": message if active else "Return to normal", "priority": 200,
            "sourceRef": {"val": "@e1", "dis": source}, "occurred": f"{day}T{hour:02d}:00:00", "state": "open" if active else "closed"}


class RouteTests(unittest.TestCase):
    def decide(self, q):
        return router.route(q)

    def test_the_comparison_of_two_named_items(self):
        for q in ("Compare AHU_01 and AHU_02.", "compare AHU_01 with AHU_02", "Please compare AHU_01 to AHU_02", "AHU_01 vs AHU_02", "AHU_01 versus AHU_02",
                  "What is the difference between AHU_01 and AHU_02?", "How does AHU_01 compare to AHU_02?", "Compare the status of AHU_01 and AHU_02",
                  "compare the current status of AHU_01 and AHU_02"):
            d = self.decide(q)
            self.assertEqual((d["route"], d["intent"], d["parameters"]), ("direct", "compare_equipment", {"equipment_a": "AHU_01", "equipment_b": "AHU_02"}), q)

    def test_the_order_asked_is_the_order_compared(self):
        self.assertEqual(self.decide("compare AHU_02 and AHU_01")["parameters"], {"equipment_a": "AHU_02", "equipment_b": "AHU_01"})

    def test_three_names_or_a_lone_name_are_not_a_comparison(self):
        self.assertEqual(self.decide("compare AHU_01 and AHU_02 and AHU_03")["route"], "llm_fallback")
        self.assertNotEqual(self.decide("compare AHU_01")["route"], "direct")
        self.assertEqual(self.decide("status of AHU_01 and AHU_02")["route"], "llm_fallback")       # two names and no comparison: unchanged

    def test_which_unit_has_the_highest_or_lowest(self):
        d = self.decide("Which AHU has the highest temperature?")
        self.assertEqual((d["intent"], d["parameters"]), ("calculate_metric", {"metric": "temperature", "op": "top", "type": "ahu", "limit": 1, "order": "highest"}))
        d = self.decide("which fcu has the lowest humidity")
        self.assertEqual(d["parameters"], {"metric": "humidity", "op": "top", "type": "fcu", "limit": 1, "order": "lowest"})
        d = self.decide("which equipment has the highest CO2")
        self.assertEqual(d["parameters"], {"metric": "co2", "op": "top", "limit": 1, "order": "highest"})

    def test_top_n(self):
        self.assertEqual(self.decide("top 3 AHUs by CO2")["parameters"], {"metric": "co2", "op": "top", "type": "ahu", "limit": 3, "order": "highest"})
        self.assertEqual(self.decide("show the top five fcus by temperature")["parameters"],
                         {"metric": "temperature", "op": "top", "type": "fcu", "limit": 5, "order": "highest"})
        self.assertEqual(self.decide("rank the ahus by humidity")["parameters"], {"metric": "humidity", "op": "top", "type": "ahu", "order": "highest"})

    def test_highest_lowest_total_and_count_of_a_metric(self):
        cases = {"highest temperature": ("max", None), "What is the lowest humidity?": ("min", None), "show the maximum CO2": ("max", None),
                 "maximum co2 across the ahus": ("max", "ahu"), "average humidity of the ahus": ("average", "ahu"), "total power of the fcus": ("sum", "fcu"),
                 "minimum temperature of the fcus": ("min", "fcu")}
        for q, (op, kind) in cases.items():
            d = self.decide(q)
            self.assertEqual((d["route"], d["intent"], d["parameters"].get("op"), d["parameters"].get("type")), ("direct", "calculate_metric", op, kind), q)

    def test_a_building_wide_sum_is_not_routed(self):
        for q in ("total power", "what is the sum of power", "sum power"):
            self.assertNotEqual(self.decide(q)["route"], "direct", q)      # nested meters would be added twice: a sum is asked for one class
        self.assertEqual(self.decide("total power of the fcus")["parameters"], {"metric": "power", "op": "sum", "type": "fcu"})

    def test_a_plain_average_of_the_indoor_metrics_stays_with_the_environment_rules(self):
        for q, metric in (("average humidity", "humidity"), ("What is the average CO2?", "co2"), ("average temperature", "temperature")):
            d = self.decide(q)
            self.assertEqual((d["intent"], d["parameters"]), ("get_environment", {"metric": metric}), q)

    def test_point_search(self):
        for q, metric, kind in (("Find equipment with humidity readings", "humidity", None), ("List AHUs with CO2 measurements", "co2", "ahu"),
                                ("find equipment with temperature points", "temperature", None), ("which equipment has humidity sensors", "humidity", None),
                                ("which ahus have co2 sensors", "co2", "ahu"), ("show fcus with temperature readings", "temperature", "fcu"),
                                ("how many ahus have co2 sensors", "co2", "ahu")):
            d = self.decide(q)
            self.assertEqual((d["route"], d["intent"]), ("direct", "search_points"), q)
            self.assertEqual((d["parameters"]["metric"], d["parameters"].get("type")), (metric, kind), q)

    def test_alarm_record_summaries(self):
        cases = {"alarm history": "all", "show the alarm summary": "all", "alarm statistics": "all", "alarm history for today": "today",
                 "How many alarms were raised today?": "today", "how many alarms were triggered yesterday": "yesterday",
                 "alarm summary for the last 7 days": "last_7_days", "alarm history for the last thirty days": "last_30_days",
                 "how many alarms were raised this month": "this_month", "show the alarm breakdown by severity": "all"}
        for q, period in cases.items():
            d = self.decide(q)
            self.assertEqual((d["route"], d["intent"], d["parameters"].get("period", "all")), ("direct", "get_alarm_history", period), q)

    def test_open_alarm_questions_still_mean_open_alarms(self):
        for q, rule in (("how many alarms are open", "alarms.count"), ("show critical alarms", "alarms.list"), ("any active alarms", "alarms.any")):
            self.assertEqual(self.decide(q)["rule"], rule, q)

    def test_questions_phase_2_does_not_take(self):
        for q in ("alarm history for last month", "average temperature last week", "turn off AHU_01", "set the temperature to 22", "why is the humidity high",
                  "predict the highest temperature tomorrow", "select highest from temperature", "highest"):
            self.assertNotEqual(self.decide(q)["route"], "direct", q)

    def test_raw_fin_or_sql_text_is_never_routed(self):
        for q in ("compare AHU_01 and AHU_02; drop table x", "readAll(point) highest temperature", "highest temperature http://x"):
            self.assertEqual(self.decide(q)["route"], "llm_fallback", q)

    def test_a_clarification_for_two_unnamed_units(self):
        for q in ("Compare the current status of two FCUs", "compare two ahus", "compare the status of both fcus"):
            self.assertIn("Name the two", router.clarification_for(q) or "", q)
        self.assertIsNone(router.clarification_for("compare AHU_01 and AHU_02"))

    def test_a_question_about_the_history_of_a_point_names_the_capability(self):
        for q in ("average temperature last week", "humidity trend", "what was the CO2 yesterday", "highest temperature over the last month"):
            self.assertEqual(router.unsupported_topic(q), "analytics.point_history", q)
        for q in ("highest temperature", "average humidity", "energy trend"):
            self.assertNotEqual(router.unsupported_topic(q), "analytics.point_history", q)


class SplitTests(unittest.TestCase):
    def texts(self, q):
        plan = router.plan_parts(q)
        return [(p["text"], p["decision"]["intent"] if p["decision"] else None, p["interpreted_as"]) for p in plan["parts"]]

    def test_a_comparison_keeps_its_and(self):
        got = self.texts("Compare AHU_01 and AHU_02 and list their alarms")
        self.assertEqual([g[:2] for g in got], [("Compare AHU_01 and AHU_02", "compare_equipment"), ("list their alarms", "compare_equipment")])
        self.assertEqual(got[1][2], "list alarms on AHU_01 and AHU_02")

    def test_their_alarms_are_those_of_the_two_compared_items_only(self):
        plan = router.plan_parts("Compare AHU_01 and AHU_02 and show their alarms")
        self.assertEqual(plan["parts"][1]["decision"]["parameters"], {"equipment_a": "AHU_01", "equipment_b": "AHU_02", "focus": "alarms"})

    def test_its_alarms_are_those_of_the_one_item_just_named(self):
        plan = router.plan_parts("Show the status of AHU_01 and list its alarms")
        self.assertEqual([(p["decision"]["intent"], p["decision"]["parameters"]) for p in plan["parts"]],
                         [("get_equipment_status", {"equipment": "AHU_01"}), ("get_alarms", {"equipment": "AHU_01"})])

    def test_their_alarms_with_nothing_before_it_is_not_guessed(self):
        plan = router.plan_parts("How many assets are there and list their alarms")
        self.assertIsNone(plan["parts"][1]["decision"])

    def test_the_highest_and_the_lowest(self):
        got = self.texts("Show the highest temperature and lowest humidity")
        self.assertEqual([g[:2] for g in got], [("Show the highest temperature", "calculate_metric"), ("lowest humidity", "calculate_metric")])

    def test_a_shared_average_reaches_the_second_metric(self):
        got = self.texts("Show average humidity and CO2")
        self.assertEqual([g[1] for g in got], ["get_environment", "get_environment"])

    def test_an_operation_is_shared_with_a_bare_second_metric(self):
        got = self.texts("Show the highest temperature and humidity")
        self.assertEqual([g[1] for g in got], ["calculate_metric", "calculate_metric"])
        self.assertEqual(got[1][2], "Show the highest humidity")


class ChatBase(MetricBase):
    def chat(self, q):
        return self.ok(q)

    def with_fleet(self, items=None, **more):
        self.frozen(cached_equip_data=self.equipment(items if items is not None else fleet()), **more)


class ComparisonChatTests(ChatBase):
    def test_two_units_side_by_side(self):
        self.with_fleet()
        body = self.chat("Compare AHU_01 and AHU_02.")
        self.assertEqual((body["route"], body["tool_calls"][0]["name"]), ("direct", "compare_equipment"))
        a = body["answer"]
        self.assertIn("AHU_01 compared with AHU_02", a)
        self.assertIn("Room Temp 24 vs 20 °C (difference 4, 20%)", a)
        self.assertIn("Open alarms: AHU_01 1, AHU_02 0", a)
        self.assertEqual(body["card"]["tool"], "compare_equipment")
        self.assertEqual(body["card"]["columns"], ["point", "first", "second", "unit", "difference", "percent"])
        self.assertEqual(body["card"]["rows"][0][0], "Room CO2")

    def test_the_answer_states_only_what_the_data_holds(self):
        self.with_fleet([eq("AHU_01", [pt("Room Temp", "24.0", "°C")]), eq("AHU_02", [pt("Supply Temp", "14.0", "°C")])])
        a = self.chat("Compare AHU_01 and AHU_02")["answer"]
        self.assertIn("0 common numeric points", a)
        self.assertNotIn("Room Temp 24", a)

    def test_an_unknown_name_is_said_with_close_matches_and_nothing_is_compared(self):
        self.with_fleet()
        a = self.chat("Compare AHU_01 and AHU_9")["answer"]
        self.assertIn("No equipment named AHU_9 was found", a)
        self.assertNotIn("compared with", a)

    def test_two_unnamed_units_are_asked_back(self):
        self.with_fleet()
        body = self.chat("Compare the current status of two FCUs")
        self.assertEqual((body["route"], body["tool_calls"]), ("clarification", []))
        self.assertIn("Name the two", body["answer"])


class AnalyticsChatTests(ChatBase):
    def test_which_ahu_has_the_highest_temperature(self):
        self.with_fleet()
        body = self.chat("Which AHU has the highest temperature?")
        self.assertEqual(body["tool_calls"][0]["name"], "calculate_metric")
        self.assertIn("AHU_01 24 °C", body["answer"])
        self.assertIn("2 readings on 2 equipment items", body["answer"])
        self.assertNotIn("FCU", body["answer"])

    def test_the_average_of_the_ahus_has_its_sample_count_and_read_time(self):
        self.with_fleet()
        stamp = main.cached_equip_data["timestamp"]
        a = self.chat("average humidity of the ahus")["answer"]
        self.assertIn("Average Humidity for ahu: 45 %", a)
        self.assertIn("2 readings on 2 equipment items", a)
        self.assertIn(stamp, a)
        self.assertIn("no history", a)

    def test_highest_and_lowest(self):
        self.with_fleet()
        self.assertIn("Highest Temperature: 26 °C", self.chat("highest temperature")["answer"])
        high = self.chat("highest temperature")
        self.assertIn("FCU-02", high["answer"])
        self.assertIn("Lowest Humidity: 30 %", self.chat("What is the lowest humidity?")["answer"])

    def test_a_sum_is_worded_as_the_points_added_up(self):
        fcus = [eq("FCU-01", [pt("Fan Power", "1.5 kW", "kW")], type_="fcu"), eq("FCU-02", [pt("Fan Power", "2.0 kW", "kW")], type_="fcu")]
        self.with_fleet(fcus)
        a = self.chat("total power of the fcus")["answer"]
        self.assertIn("Total Power for fcu: 3.5 kW", a)
        self.assertIn("not a metered total", a)

    def test_top_three(self):
        self.with_fleet()
        a = self.chat("top 3 ahus by co2")["answer"]
        self.assertIn("1. AHU_02 800 ppm", a)
        self.assertIn("2. AHU_01 600 ppm", a)
        self.assertNotIn("; 3. ", a)

    def test_a_metric_nobody_reports_is_unavailable_and_says_what_was_checked(self):
        self.with_fleet([eq("AHU_01", [pt("Run Status", "On")])])
        body = self.chat("highest humidity")
        self.assertEqual((body["tool_calls"][0]["name"], body["tool_calls"][0]["available"], body["tool_calls"][0]["reason"]),
                         ("calculate_metric", False, "no_sensors"))
        self.assertIn("No equipment point name matches Humidity", body["answer"])
        self.assertIsNone(body["card"])

    def test_readings_in_two_units_are_not_mixed(self):
        self.with_fleet([eq("AHU_01", [pt("Room Temp", "24.0", "°C")]), eq("AHU_02", [pt("Room Temp", "70.0", "°F")])])
        a = self.chat("highest temperature")["answer"]
        self.assertIn("Highest Temperature: 24 °C", a)
        self.assertIn("from 1 reading on 1 equipment item", a)          # the Fahrenheit point is not one of the readings
        self.assertIn("1 in °F", a)

    def test_old_data_is_not_calculated(self):
        self.with_fleet()
        main.cached_equip_data["timestamp"] = (datetime.now() - timedelta(minutes=30)).isoformat()
        self.assertIn("too old", self.chat("highest temperature")["answer"])


class PointSearchChatTests(ChatBase):
    def test_equipment_with_humidity_readings(self):
        self.with_fleet()
        a = self.chat("Find equipment with humidity readings")["answer"]
        self.assertIn("3 equipment items have Humidity points", a)
        self.assertIn("3 with a usable reading", a)
        for n in ("AHU_01", "AHU_02", "FCU-01"):
            self.assertIn(n, a)

    def test_ahus_with_co2(self):
        self.with_fleet()
        body = self.chat("List AHUs with CO2 measurements")
        self.assertEqual(body["card"]["tool"], "search_points")
        self.assertEqual(sorted({r[0] for r in body["card"]["rows"]}), ["AHU_01", "AHU_02"])
        self.assertIn("2 equipment items have CO2 points of type ahu", body["answer"])

    def test_points_that_match_but_do_not_report_are_counted_not_hidden(self):
        self.with_fleet([eq("AHU_01", [pt("Room Humidity", "—", "%", reporting=False)]), eq("AHU_02", [pt("Room Humidity", "50%", "%")])])
        a = self.chat("find equipment with humidity points")["answer"]
        self.assertIn("1 with a usable reading", a)
        self.assertIn("1 of 2 matching points have no usable reading (1 not reporting)", a)

    def test_no_such_point_is_said(self):
        self.with_fleet([eq("AHU_01", [pt("Run Status", "On")])])
        a = self.chat("find equipment with co2 sensors")["answer"]
        self.assertIn("No equipment point name matches CO2", a)
        self.assertIn("Equipment checked: 1", a)


class AlarmRecordChatTests(ChatBase):
    def rows(self):
        return [rec_row("2026-10-28", True), rec_row("2026-10-28", False, hour=7), rec_row("2026-10-27", False, source="AHU_02")]

    def test_the_records_of_the_latest_read_are_summarised_not_the_open_list(self):
        self.with_fleet()
        main.client.last_alarm_rows = self.rows()
        body = self.chat("alarm history")
        self.assertEqual(body["tool_calls"][0]["name"], "get_alarm_history")
        a = body["answer"]
        self.assertIn("Alarm records in FIN's latest read: 3 (1 open, 2 cleared)", a)
        self.assertIn("covers 2026-10-27 to 2026-10-28", a)
        self.assertIn("not an archive", a)
        self.assertIn("By severity: 0 critical, 3 warning, 0 info", a)

    def test_a_day_counts_only_that_day(self):
        self.with_fleet()
        main.client.last_alarm_rows = self.rows()
        self.assertIn("for today: 2 (1 open, 1 cleared)", self.chat("how many alarms were raised today")["answer"])
        self.assertIn("for yesterday: 1 (0 open, 1 cleared)", self.chat("how many alarms were raised yesterday")["answer"])

    def test_a_period_the_read_does_not_reach_says_so(self):
        self.with_fleet()
        main.client.last_alarm_rows = self.rows()
        a = self.chat("alarm summary for the last seven days")["answer"]
        self.assertIn("starts on 2026-10-27", a)

    def test_no_records_never_falls_back_to_the_open_alarms(self):
        self.with_fleet(cached_alarm_data={"timestamp": datetime.now().isoformat(), "counts": {"critical": 4, "warning": 0, "info": 0, "total": 4},
                                           "alarms": [{"source": "AHU_01", "severity": "critical", "message": "x"}] * 4})
        main.client.last_alarm_rows = []
        a = self.chat("alarm history")["answer"]
        self.assertIn("holds no alarm records", a)
        self.assertNotIn("4", a)


class MultipartChatTests(ChatBase):
    def parts(self, q):
        body = self.chat(q)
        self.assertEqual(body["route"], "multi", body["answer"])
        return body, body["parts"]

    def test_compare_and_list_their_alarms(self):
        self.with_fleet()
        body, parts = self.parts("Compare AHU_01 and AHU_02 and list their alarms")
        self.assertEqual([p["status"] for p in parts], ["answered", "answered"])
        self.assertEqual([p["tool"] for p in parts], ["compare_equipment", "compare_equipment"])
        self.assertIn("compared with", parts[0]["answer"])
        self.assertIn("AHU_01: 1 open alarm", parts[1]["answer"])
        self.assertIn("AHU_02: 0 open alarms", parts[1]["answer"])
        self.assertEqual(parts[1]["interpreted_as"], "list alarms on AHU_01 and AHU_02")
        self.assertEqual(body["multi"], {"count": 2, "answered": 2, "status": "complete", "needs_planner": False})

    def test_the_highest_temperature_and_the_lowest_humidity(self):
        self.with_fleet()
        _, parts = self.parts("Show the highest temperature and lowest humidity")
        self.assertEqual([p["status"] for p in parts], ["answered", "answered"])
        self.assertIn("Highest Temperature: 26 °C", parts[0]["answer"])
        self.assertIn("Lowest Humidity: 30 %", parts[1]["answer"])
        self.assertEqual(parts[0]["facts"]["samples"], 4)

    def test_average_humidity_and_co2_with_their_samples(self):
        self.with_fleet()
        _, parts = self.parts("Show average humidity and CO2")
        self.assertEqual([p["status"] for p in parts], ["answered", "answered"])
        self.assertIn("average of 3 points, 30 to 50", parts[0]["answer"])
        self.assertIn("average of 2 points, 600 to 800", parts[1]["answer"])

    def test_each_part_has_its_own_accurate_status(self):
        self.with_fleet([eq("AHU_01", [pt("Room Humidity", "40%", "%")]), eq("AHU_02", [pt("Room Humidity", "50%", "%")])])
        body, parts = self.parts("Show the highest temperature, list AHUs with humidity readings and compare AHU_01 and AHU_9")
        self.assertEqual([p["status"] for p in parts], ["unavailable", "answered", "unavailable"])
        self.assertEqual([p.get("reason") for p in parts], ["no_sensors", None, "not_found"])
        self.assertEqual(body["multi"]["status"], "partial")
        self.assertEqual(body["multi"]["answered"], 1)

    def test_an_unsupported_part_is_reported_and_the_rest_still_answered(self):
        self.with_fleet()
        _, parts = self.parts("Show the highest temperature and turn off AHU_01")
        self.assertEqual([p["status"] for p in parts], ["answered", "unsupported"])

    def test_four_parts_are_the_most(self):
        self.with_fleet()
        body, parts = self.parts("highest temperature. lowest humidity. highest co2. alarm history. list ahus with co2 sensors")
        self.assertEqual(len(parts), 5)
        self.assertEqual(parts[4]["reason"], "limit_exceeded")
        self.assertEqual(parts[4]["status"], "unsupported")


class DeadlineAndPinTests(unittest.TestCase):
    def test_no_analytics_part_starts_after_the_deadline(self):
        v = view(fleet())
        late = ctx_mod.Deadline(1.0, t0=time.perf_counter() - 10)
        out = eko_chat.try_multi("Show the highest temperature and lowest humidity", lambda: v, {}, late)
        self.assertEqual([(p["status"], p["reason"]) for p in out["parts"]], [("failed", "request_timeout")] * 2)

    def test_a_part_that_ran_before_the_deadline_keeps_its_answer(self):
        v = view(fleet())
        deadline = ctx_mod.Deadline(0.1)

        def view_fn():
            time.sleep(0.2)            # the budget ends while the first part is being read
            return v
        out = eko_chat.try_multi("Show the highest temperature and lowest humidity", view_fn, {}, deadline)
        self.assertEqual([p["status"] for p in out["parts"]], ["answered", "failed"])
        self.assertEqual(out["parts"][1]["reason"], "request_timeout")

    def test_a_project_change_between_two_parts_abandons_the_request(self):
        v = view(fleet())
        calls = []

        def view_fn():
            calls.append(1)
            if len(calls) == 2:
                raise ctx_mod.ProjectChanged()
            return v
        with self.assertRaises(ctx_mod.ProjectChanged):
            eko_chat.try_multi("Show the highest temperature and lowest humidity", view_fn, {}, None)


class ProjectChatTests(ProjectChatBase):
    def equipment(self, items):
        return {"timestamp": datetime.now().isoformat(), "equipment": items}

    def test_the_hospital_is_read_through_its_own_caches(self):
        self.frozen(HOSPITAL, HOSPITAL_ID, cached_equip_data=self.equipment([eq("AHU-H1", [pt("Room Humidity", "61%", "%")])]))
        body = self.ok("highest humidity")
        self.assertEqual(body["project"], {"id": HOSPITAL_ID, "name": "ekoHospital"})
        self.assertIn("Highest Humidity: 61 %", body["answer"])

    def test_no_reading_of_one_project_reaches_another(self):
        self.frozen(HOSPITAL, HOSPITAL_ID, cached_equip_data=self.equipment([eq("AHU-H1", [pt("Room Humidity", "61%", "%")])]))
        self.assertIn("61 %", self.ok("highest humidity")["answer"])
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        self.http.cookies.clear()
        self.frozen(MARSA, MARSA_ID, cached_equip_data=self.equipment([eq("AHU-M1", [pt("Room Humidity", "35%", "%")])]))
        body = self.ok("highest humidity")
        self.assertEqual(body["project"]["name"], "marsaAlArab")
        self.assertIn("35 %", body["answer"])
        self.assertNotIn("61 %", body["answer"])
        self.assertNotIn("AHU-H1", str(body))

    def test_a_hospital_without_co2_points_or_a_mapped_co2_point_is_told_exactly_that(self):
        self.frozen(HOSPITAL, HOSPITAL_ID, cached_equip_data=self.equipment([eq("AHU-H1", [pt("Room Humidity", "61%", "%")])]))
        a = self.ok("List AHUs with CO2 measurements")["answer"]
        self.assertIn("No equipment point name matches CO2 on ahu equipment", a)
        self.assertIn("live point ra_co2 is not mapped for this project", a)
        unavailable = self.ok("highest co2")
        self.assertEqual(unavailable["tool_calls"][0]["reason"], "no_sensors")


if __name__ == "__main__":
    unittest.main()
