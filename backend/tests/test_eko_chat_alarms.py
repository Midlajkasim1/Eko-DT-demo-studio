"""Eko-Chat alarms on one equipment item, and the equipment list's types: regression tests for the EKO HOSPITAL report.

Run from backend/:   python -m unittest tests.test_eko_chat_alarms
Reported: the equipment list showed AHU_01 with 2 open alarms, while "I noticed AHU_01 has alarms. What should I investigate first?" answered with no
alarm records; and every item showed type "other". Two causes, reproduced here with the real model's own choice of arguments replaced by a mock:
  1. the model picked get_alarms {severity: "critical"} (nobody said it) and dropped AHU_01, and Hospital maps no severity bands, so nothing is critical;
  2. the equipment list counts an alarm by the id of the record it is on, the alarm tool matched the equipment name as text against the alarm's display name.
The type is "other" because the project maps no Equipment Classes; FIN's own tags are listed, nothing is guessed. Fake FIN, throwaway notification database.
"""
import json
import os
import sys
import unittest
from copy import deepcopy
from datetime import datetime
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_llm  # noqa: E402
import main  # noqa: E402
from chat_support import parse_sse  # noqa: E402
from fake_fin import ALARM_ROW  # noqa: E402
from test_eko_chat_projects import DEFAULT_CHAT, HOSPITAL, HOSPITAL_ID, ProjectChatBase  # noqa: E402

NO_BANDS = {k: v for k, v in HOSPITAL.items() if k != "finSeverityBands"}      # the Hospital as reported: no severity bands, no equipment classes
AHU_ID = "@p:ekoHospital:r:3260abd5-07a0a7b6"          # a FIN record id as the real server writes it: nothing a name could match
QUESTION = "I noticed AHU_01 has alarms. What should I investigate first?"
JS = os.path.join(HERE, "..", "..", "static", "dashboard", "js", "i18n")


def alarm(message, priority, source, **kw):
    return {**ALARM_ROW, "id": {"val": f"@a-{message[:4]}"}, "message": message, "priority": priority, "sourceRef": source, **kw}


class AlarmBase(ProjectChatBase):
    BANDS = {"order": "desc", "critical": 180, "warning": 100}

    def setUp(self):
        super().setUp()
        self.open(NO_BANDS, HOSPITAL_ID)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        self.addCleanup(self.http.cookies.clear)

    def install(self, source, tags=("equip", "ahu", "hvac"), extra_rows=(), project_bands=None):
        """AHU_01 with two open alarms, FCU_07 with none, as the poll would have left them; `source` is how FIN names the alarm's source."""
        rows = [alarm("Filter dirty", 100, source), alarm("Fan failure", 200, source), *extra_rows]
        equipment = main._flatten_equip({"L3": {"hvac": [
            {"name": "AHU_01", "bimId": "AHU_01", "finId": AHU_ID.lstrip("@"), "tags": list(tags), "points": [],
             "alarms": [{"alarm": r["message"], "priority": r["priority"]} for r in rows if r["sourceRef"].get("val") == AHU_ID]},
            {"name": "FCU_07", "bimId": "FCU_07", "finId": "r:fcu07", "tags": ["equip", "fcu"], "alarms": [], "points": []}]}})
        main.client.last_alarm_rows = deepcopy(rows)
        for patch in (mock.patch.object(main, "cached_equip_data", {"timestamp": datetime.now().isoformat(), "equipment": equipment}),
                      mock.patch.object(main, "cached_alarm_data", main._flatten_alarms(rows, project_bands or main.CONFIG.get("severity_bands", {})))):
            patch.start()
            self.addCleanup(patch.stop)

    def alarms_of(self, question="show alarms on AHU_01"):
        body = self.ok(question)
        return body, [(a[0], a[1], a[2]) for a in (body["card"] or {}).get("rows", [])]


class MatchingTests(AlarmBase):
    SHAPES = {"the display name is the equipment name": {"val": AHU_ID, "dis": "AHU_01"},
              "the display name is another spelling": {"val": AHU_ID, "dis": "EKO HOSPITAL L3 AHU_1"},
              "the display name is missing": {"val": AHU_ID},
              "the display name is the equipment's path": {"val": AHU_ID, "dis": "ekoHospital L3 AHU 01 Air Handler"}}

    def test_the_alarm_tool_finds_what_the_equipment_list_counts_whatever_the_alarms_display_name(self):
        for shape, source in self.SHAPES.items():
            with self.subTest(shape):
                self.install(source)
                listed = {r[0]: r[4] for r in self.ok("Read the equipment list")["card"]["rows"]}
                self.assertEqual(listed, {"AHU_01": 2, "FCU_07": 0})
                body, rows = self.alarms_of()
                self.assertEqual(body["card"]["total"], listed["AHU_01"], "the same alarms the equipment list counts")
                self.assertEqual({(r[0], r[2]) for r in rows}, {("AHU_01", "Filter dirty"), ("AHU_01", "Fan failure")})
                self.assertEqual({r[1] for r in rows}, {"info"})                  # graded by what the project maps: nothing, so info
                self.assertIn("Fan failure", body["answer"])
                self.assertIn("Filter dirty", body["answer"])

    def test_the_equipment_is_named_as_the_equipment_list_names_it_and_no_fin_id_is_shown(self):
        self.install({"val": AHU_ID})
        for q in ("show alarms on AHU_01", "show the open alarms"):
            body = self.ok(q)
            text = json.dumps(body)
            self.assertNotIn(":r:", text, q)
            self.assertNotIn("3260abd5", text, q)
            self.assertNotIn("source_id", text, q)
            self.assertIn("AHU_01 (info)", body["answer"], q)

    def test_the_name_still_matches_when_the_alarm_names_it_and_the_spelling_differs_by_padding(self):
        self.install({"val": "@r:other", "dis": "AHU_01"})                         # not the record id the equipment list uses: matched by name, as before
        self.assertEqual(self.alarms_of()[0]["card"]["total"], 2)
        self.install({"val": AHU_ID, "dis": "x"})
        self.assertEqual(self.alarms_of("show alarms on AHU_1")[0]["card"]["total"], 2)       # AHU_1 and AHU_01 are the same unit to the equipment lookup

    def test_other_equipment_and_unknown_records_are_not_taken(self):
        stranger = alarm("Pump trip", 150, {"val": "@p:ekoHospital:r:00000000-11111111"})
        self.install({"val": AHU_ID, "dis": "AHU_01"}, extra_rows=[stranger])
        body, rows = self.alarms_of()
        self.assertEqual(body["card"]["total"], 2)
        self.assertNotIn("Pump trip", body["answer"])
        self.assertEqual(self.alarms_of("show alarms on FCU_07")[0]["card"]["total"], 0)
        self.assertEqual(self.ok("show the open alarms")["card"]["total"], 3)

    def test_the_latest_alarm_records_are_matched_the_same_way(self):
        cleared = alarm("Return to normal", 200, {"val": AHU_ID}, active=False, state="normal")
        self.install({"val": AHU_ID}, extra_rows=[cleared])
        result = self.tool("get_alarms", equipment="AHU_01", history=True)         # (no rule words "latest alarms on <item>": the tool is what is asked)
        self.assertEqual((result["history"], result["total"]), (True, 3))
        self.assertEqual({a["source"] for a in result["alarms"]}, {"AHU_01"})
        self.assertEqual({a["open"] for a in result["alarms"]}, {True, False})
        self.assertNotIn(":r:", json.dumps(result))
        self.assertEqual(self.tool("get_alarms", equipment="FCU_07", history=True)["total"], 0)

    def test_the_alarm_cache_carries_the_record_id_for_matching_only(self):
        self.install({"val": AHU_ID, "dis": "AHU_01"})
        self.assertEqual({a["source_id"] for a in main.cached_alarm_data["alarms"]}, {AHU_ID.lstrip("@")})
        self.assertEqual({a["source_id"] for a in main._chat_alarm_records()}, {AHU_ID.lstrip("@")})
        self.assertEqual(set(eko_chat._alarm_view(main.cached_alarm_data["alarms"][0])) & {"source_id", "id"}, set())

    def test_alarms_the_equipment_list_counts_but_the_read_cannot_match_are_said_not_hidden(self):
        self.install({"val": AHU_ID})
        with mock.patch.object(main, "cached_alarm_data", {"timestamp": datetime.now().isoformat(), "alarms": [], "counts": {"critical": 0, "warning": 0, "info": 0, "total": 0}}):
            body = self.ok("show alarms on AHU_01")
            self.assertEqual(self.tool("get_alarms", equipment="AHU_01")["equipment_record_open_alarms"], 2)
            self.assertNotIn("equipment_record_open_alarms", self.tool("get_alarms", equipment="FCU_07"))      # nothing to reconcile for an item with no alarms
        self.assertIn("The equipment list shows 2 open alarms for AHU_01", body["answer"])
        self.assertIn("cannot be shown", body["answer"])
        self.assertNotIn("There are no open alarms", body["answer"])


class ModelChosenSeverityTests(AlarmBase):
    def hybrid(self, reply):
        main.BASE_CONFIG["chat"] = main.CONFIG["chat"] = dict(DEFAULT_CHAT, provider="ollama", model="qwen3.5:4b")
        return mock.patch.object(eko_chat_llm.OllamaClient, "generate",
                                 mock.AsyncMock(return_value={"content": json.dumps(reply), "usage": {}}))

    def test_the_reported_question_with_the_arguments_the_model_chose(self):
        self.install({"val": AHU_ID})
        with self.hybrid({"intent": "get_alarms", "severity": "critical", "limit": 5}) as gen:
            body = self.ok(QUESTION)
        gen.assert_awaited_once()
        call = body["tool_calls"][0]
        self.assertEqual((call["name"], call["arguments"]), ("get_alarms", {"limit": 5, "equipment": "AHU_01"}))   # no severity nobody said; the item the user named
        self.assertEqual(body["card"]["total"], 2)
        for words in ("Filter dirty", "Fan failure", "AHU_01 (info)", "No severity bands are mapped"):
            self.assertIn(words, body["answer"])
        self.assertNotIn("no open critical", body["answer"])

    def test_a_severity_the_user_wrote_is_kept(self):
        self.install({"val": AHU_ID}, project_bands=self.BANDS)
        with self.hybrid({"intent": "get_alarms", "severity": "critical", "equipment": "AHU_01"}):
            body = self.ok("I noticed AHU_01 has critical alarms")
        self.assertEqual(body["tool_calls"][0]["arguments"], {"severity": "critical", "equipment": "AHU_01"})

    def test_a_fragment_of_another_word_is_not_a_severity(self):
        for question, kept in (("what information do you have on AHU_01 alarms", False), ("AHU_01 has warnings", True), ("AHU_01 has info alarms", True)):
            for severity in ("info", "warning"):
                status, d = eko_chat_llm.to_decision({"intent": "get_alarms", "severity": severity}, question)
                self.assertEqual(status, "ok")
                self.assertEqual("severity" in d["parameters"], kept and severity in question, (question, severity))

    def test_the_item_is_taken_from_the_question_only_when_it_names_exactly_one(self):
        ask = lambda q, **kw: eko_chat_llm.to_decision({"intent": "get_alarms", **kw}, q)[1]["parameters"]   # noqa: E731
        self.assertEqual(ask(QUESTION), {"equipment": "AHU_01"})
        self.assertEqual(ask("any alarms on the AHU_01 or AHU_02?"), {})                                          # two items: nothing is chosen for the user
        self.assertEqual(ask("any alarms at all?"), {})
        self.assertEqual(ask("alarms on ahu_01", equipment="AHU_01"), {"equipment": "AHU_01"})                    # the model's own value is kept
        self.assertEqual(eko_chat_llm.to_decision({"intent": "get_alarms", "equipment": "AHU_09"}, QUESTION)[0], "clarification")   # an invented item still is

    def test_the_tool_calling_path_refuses_a_severity_nobody_wrote_and_the_model_asks_again(self):
        import asyncio

        class Model:
            name = model = "scripted"

            def __init__(self):
                self.replies = [{"content": None, "tool_calls": [{"id": "1", "name": "get_alarms", "arguments": {"severity": "critical", "equipment": "AHU_01"}}]},
                                {"content": None, "tool_calls": [{"id": "2", "name": "get_alarms", "arguments": {"equipment": "AHU_01"}}]},
                                {"content": "AHU_01 has 2 open alarms.", "tool_calls": []}]

            async def complete(self, messages, tools):
                return self.replies.pop(0)

        self.install({"val": AHU_ID})

        async def run():
            return [ev async for ev in eko_chat.conversation(Model(), QUESTION, main._chat_view)][-1][1]
        result = asyncio.run(run())
        first, second = result["tool_calls"]
        self.assertEqual((first["available"], first["reason"]), (False, "invalid_arguments"))
        self.assertEqual((second["available"], second["arguments"]), (True, {"equipment": "AHU_01"}))
        self.assertEqual(result["card"]["total"], 2)

    def test_what_the_rules_answer_is_unchanged(self):
        self.install({"val": AHU_ID}, project_bands=self.BANDS)
        main.CONFIG["severity_bands"] = dict(self.BANDS)
        body = self.ok("show critical alarms")
        self.assertEqual((body["tool_calls"][0]["name"], body["tool_calls"][0]["arguments"]), ("get_alarms", {"severity": "critical"}))
        self.assertIn("Fan failure", body["answer"])


class GradingNoteTests(AlarmBase):
    def test_a_project_with_no_severity_bands_is_not_told_there_is_nothing_critical(self):
        self.install({"val": AHU_ID})
        body = self.ok("show critical alarms")
        self.assertIn("There are no open critical alarms.", body["answer"])
        self.assertIn("No severity bands are mapped for this project, so every alarm is graded info and none is graded critical or warning.", body["answer"])

    def test_a_project_that_maps_bands_gets_no_note(self):
        self.open(HOSPITAL, HOSPITAL_ID)                       # this settings fixture maps bands (critical 180, warning 100)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        self.install({"val": AHU_ID}, project_bands=self.BANDS)
        body = self.ok("show alarms on AHU_01")
        self.assertNotIn("No severity bands", body["answer"])
        self.assertEqual({r[1] for r in body["card"]["rows"]}, {"warning", "critical"})          # priority 100 and 200 against the project's bands 100 / 180


class EquipmentTypeTests(AlarmBase):
    def test_without_mapped_classes_the_type_is_fins_own_marker_and_the_tags_and_the_reason_are_shown(self):
        self.install({"val": AHU_ID})
        body = self.ok("Read the equipment list")
        self.assertEqual(body["card"]["columns"], ["name", "floor", "type", "in_alarm", "open_alarms", "tags"])
        rows = {r[0]: r for r in body["card"]["rows"]}
        self.assertEqual((rows["AHU_01"][2], rows["AHU_01"][5]), ("ahu", "equip, ahu, hvac"))          # FIN's own markers, as FIN sends them
        self.assertEqual((rows["FCU_07"][2], rows["FCU_07"][5]), ("fcu", "equip, fcu"))
        self.assertIn("No equipment types are mapped for this project", body["answer"])
        self.assertIn("each item's own FIN tags are listed", body["answer"])

    def test_nothing_is_classified_from_a_name_or_a_tag_the_project_did_not_map(self):
        self.install({"val": AHU_ID}, tags=())                                                       # an item FIN sent with no markers at all
        rows = {r[0]: r for r in self.ok("Read the equipment list")["card"]["rows"]}
        self.assertEqual((rows["AHU_01"][2], rows["AHU_01"][5]), ("other", ""))                      # not "ahu", though the name says so

    def test_a_project_that_maps_its_classes_gets_its_types_and_no_note(self):
        self.open(dict(HOSPITAL, finEquipmentClasses={"type_priority": ["ahu", "fcu"], "system_tags": ["ahu", "fcu"]}), HOSPITAL_ID)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        self.install({"val": AHU_ID})
        body = self.ok("Read the equipment list")
        self.assertEqual({r[0]: r[2] for r in body["card"]["rows"]}, {"AHU_01": "ahu", "FCU_07": "fcu"})
        self.assertNotIn("No equipment types are mapped", body["answer"])

    def test_the_type_filter_still_finds_the_unit_by_its_own_marker(self):
        self.install({"val": AHU_ID})
        body = self.ok("list ahu equipment")
        self.assertEqual([r[0] for r in body["card"]["rows"]], ["AHU_01"])
        self.assertEqual(self.ok("how many ahu assets")["card"]["total"], 1)

    def test_the_tags_are_markers_only(self):
        item = eko_chat._summary({"name": "X", "tags": ["ahu", "p:ekoHospital:r:abc", "two words", "ok_1", 5, None, "a" * 40, *[f"t{i}" for i in range(20)]]})
        self.assertEqual(item["tags"][:2], ["ahu", "ok_1"])
        self.assertEqual(len(item["tags"]), 8)

    def test_the_tags_column_has_a_label_in_both_languages(self):
        for lang in ("en", "ar"):
            with open(os.path.join(JS, f"{lang}.js"), encoding="utf-8") as f:
                self.assertIn('"ai.card.c.tags":', f.read(), lang)


class SafetyTests(AlarmBase):
    def test_the_streamed_answer_is_the_same_and_carries_no_id(self):
        self.install({"val": AHU_ID})
        r = self.ask("show alarms on AHU_01", stream=True)
        events = parse_sse(r.text)
        self.assertEqual(events[-1][0], "done")
        self.assertEqual(events[-1][1]["answer"], self.ok("show alarms on AHU_01")["answer"])
        self.assertNotIn(":r:", r.text)

    def test_the_same_session_and_project_checks_apply(self):
        self.install({"val": AHU_ID})
        r = self.http.post("/api/chat", json={"message": QUESTION}, headers={"X-Eko-Project": "someone-else"})
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "project_mismatch"))
        self.http.cookies.clear()
        r = self.http.post("/api/chat", json={"message": QUESTION})
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (401, "session_required"))
        self.assertNotIn("Fan failure", r.text)


if __name__ == "__main__":
    unittest.main()
