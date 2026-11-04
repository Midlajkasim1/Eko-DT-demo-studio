"""Eko-Chat equipment lists and counts: "read the equipment list", "total assets", and the type filter only when the user writes one.

Run from backend/:   python -m unittest tests.test_eko_chat_inventory
Reported on EKO HOSPITAL: "read the equipment list" was answered as "No equipment of type electrical was found" (a filter nobody wrote) and
"total assets" as "I could not tell what to look up". The rules now know those phrasings, and a filter chosen by a model must be a word of
the question. Everything is read from the open project's live caches, which these tests fill through the fake FIN client or set themselves;
no count or name here is the code's. Fake FIN, a throwaway notification database, a scripted stand-in for a model, no network.
"""
import asyncio
import os
import sys
import unittest
from datetime import datetime
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import eko_chat  # noqa: E402
import eko_chat_llm  # noqa: E402
import eko_chat_router  # noqa: E402
import main  # noqa: E402
from test_eko_chat_projects import HOSPITAL, HOSPITAL_ID, MARSA, MARSA_ID, ProjectChatBase  # noqa: E402

LIST_ALL = ["read the equipment list", "Read the equipment list.", "list equipment", "show all assets", "display all equipment",
            "show me the equipment list", "get the equipment list", "view all equipment", "equipment list", "list of all equipment",
            "can you read the equipment list please", "show all the assets in this project"]
COUNT = ["total assets", "total equipment", "how many assets", "asset count", "equipment count", "number of assets", "count of equipment",
         "what is the total number of assets", "how many assets in total", "count the equipment"]


def item(name, **kw):
    return {"name": name, "floor": "L1", "type": "ahu", "category": "hvac", "tags": ["ahu"], "inAlarm": False, "alarms": [], "points": [], **kw}


def cache(*names):
    return {"timestamp": datetime.now().isoformat(), "equipment": [item(n) for n in names]}


class RouterTests(unittest.TestCase):
    """The rules alone: no project, no FIN."""

    def decide(self, q):
        return eko_chat_router.route(q)

    def test_every_phrasing_of_the_whole_list_is_a_direct_unfiltered_list(self):
        for q in LIST_ALL:
            with self.subTest(q):
                d = self.decide(q)
                self.assertEqual((d["route"], d["intent"], d["parameters"]), ("direct", "find_equipment", {}))

    def test_every_phrasing_of_the_count_is_a_direct_unfiltered_count(self):
        for q in COUNT:
            with self.subTest(q):
                d = self.decide(q)
                self.assertEqual((d["route"], d["intent"], d["parameters"]), ("direct", "find_equipment", {}))

    def test_a_type_written_in_the_question_is_the_only_filter(self):
        for q, kind in (("list electrical equipment", "electrical"), ("list all electrical equipment", "electrical"),
                        ("show me the electrical assets", "electrical"), ("read the HVAC equipment list", "hvac"), ("show hvac equipment", "hvac"),
                        ("how many electrical assets", "electrical"), ("list ahus", "ahu"), ("what AHUs do we have", "ahu"),
                        ("how many fcus are there", "fcu")):
            with self.subTest(q):
                d = self.decide(q)
                self.assertEqual((d["route"], d["parameters"]), ("direct", {"type": kind}))

    def test_no_type_is_ever_made_up_for_a_question_that_names_none(self):
        for q in LIST_ALL + COUNT:
            self.assertNotIn("type", self.decide(q)["parameters"], q)
            self.assertNotIn("electrical", str(self.decide(q)).lower(), q)

    def test_words_that_are_not_types_do_not_become_a_filter(self):
        for q in ("show critical equipment", "list faulty equipment", "list all offline assets", "show running equipment"):
            with self.subTest(q):
                d = self.decide(q)
                self.assertEqual(d["route"], "llm_fallback", d)

    def test_other_total_questions_are_still_not_swallowed(self):
        for q in ("total energy", "total power consumption", "show total alarms", "what is the total number of alarms",
                  "list electrical equipment and alarms", "total assets and alarms"):
            with self.subTest(q):
                self.assertEqual(self.decide(q)["route"], "llm_fallback")

    def test_the_existing_equipment_questions_are_unchanged(self):
        for q, rule in (("list equipment", "equipment.list"), ("what equipment do we have", "equipment.available"),
                        ("how many assets", "equipment.count"), ("list ahus", "equipment.type.list"),
                        ("list equipment in alarm", "equipment.in_alarm.list"), ("what is the status of EQ-1", "equipment.status_of")):
            self.assertEqual(self.decide(q).get("rule"), rule, q)


class HospitalListAndCountTests(ProjectChatBase):
    def hospital(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        return sorted(e["name"] for e in main.cached_equip_data["equipment"])

    def test_every_list_phrasing_returns_all_of_the_hospitals_equipment_unfiltered(self):
        names = self.hospital()
        self.assertEqual(names, ["EQ-1", "MTR-1", "PMU-1"])               # what the fake FIN read put in the live cache
        for q in LIST_ALL:
            with self.subTest(q):
                body = self.ok(q)
                self.assertEqual(body["project"], {"id": HOSPITAL_ID, "name": "ekoHospital"})
                self.assertEqual([(t["name"], t["arguments"]) for t in body["tool_calls"]], [("find_equipment", {})])
                self.assertEqual(sorted(r[0] for r in body["card"]["rows"]), names)
                self.assertEqual(body["card"]["total"], len(names))
                self.assertNotIn("type", str(body["card"]["filters"]).lower())
                self.assertNotIn("electrical", str(body).lower())
                self.assertNotIn("No equipment of type", body["answer"])

    def test_every_count_phrasing_is_the_number_of_items_in_the_live_cache(self):
        names = self.hospital()
        for q in COUNT:
            with self.subTest(q):
                body = self.ok(q)
                self.assertEqual(body["tool_calls"][0]["arguments"], {})
                self.assertIn(f"Equipment items: {len(names)}.", body["answer"])
                self.assertEqual(body["card"]["total"], len(names))

    def test_the_count_follows_the_data_and_is_not_a_constant(self):
        self.hospital()
        main._cancel_polling()
        self.http.get("/api/fin/status")
        for count in (0, 1, 7, 120):
            with self.subTest(count=count), mock.patch.object(main, "cached_equip_data", cache(*[f"HOSP-{i:03d}" for i in range(count)])):
                for q in ("total assets", "how many assets", "asset count", "total equipment"):
                    body = self.ok(q)
                    self.assertIn(f"Equipment items: {count}.", body["answer"], q)
                    self.assertEqual(body["card"]["total"], count, q)

    def test_before_the_first_fin_read_nothing_is_counted(self):
        self.hospital()
        main._cancel_polling()
        self.http.get("/api/fin/status")
        with mock.patch.object(main, "cached_equip_data", {}):
            for q in ("total assets", "read the equipment list"):
                self.assertIn("has not read this data from FIN yet", self.ok(q)["answer"], q)

    def test_an_explicit_type_still_filters_and_says_so(self):
        self.hospital()
        none = self.ok("list electrical equipment")
        self.assertEqual(none["tool_calls"][0]["arguments"], {"type": "electrical"})
        self.assertEqual(none["answer"], "No equipment of type electrical was found in this project's data.")
        self.assertEqual(none["card"]["total"], 0)
        ahu = self.ok("list all ahu equipment")                              # EQ-1 is the only AHU in the fake FIN read
        self.assertEqual(ahu["tool_calls"][0]["arguments"], {"type": "ahu"})
        self.assertEqual([r[0] for r in ahu["card"]["rows"]], ["EQ-1"])
        self.assertEqual(self.ok("how many ahu assets")["card"]["total"], 1)
        self.assertEqual(self.ok("read the equipment list")["card"]["total"], 3)   # and without a type it is all of it

    def test_the_hospital_never_gets_marsas_equipment(self):
        self.open(MARSA, MARSA_ID)
        main._cancel_polling()
        self.http.get("/api/fin/status")
        with mock.patch.object(main, "cached_equip_data", cache("MARSA-ONLY-AHU-1", "MARSA-ONLY-AHU-2")):
            self.assertIn("Equipment items: 2.", self.ok("total assets")["answer"])
            self.assertIn("MARSA-ONLY-AHU-1", str(self.ok("read the equipment list")))
        self.http.post("/api/fin/logout")
        main.SESSIONS.clear()
        names = self.hospital()                                              # the sign-in for the Hospital starts from empty caches
        for q in LIST_ALL[:3] + COUNT[:3]:
            body = self.ok(q)
            self.assertNotIn("MARSA", str(body), q)
            self.assertEqual(body["project"]["name"], "ekoHospital", q)
        self.assertIn(f"Equipment items: {len(names)}.", self.ok("total equipment")["answer"])


class ScriptedModel:
    """Stands in for a language model: returns its scripted replies in order and keeps what it was sent."""
    name = model = "scripted"

    def __init__(self, *replies):
        self.replies, self.sent = list(replies), []

    async def complete(self, messages, tools):
        self.sent.append([dict(m) for m in messages])
        return self.replies.pop(0)


def call(tool_name, /, **args):
    return {"content": None, "tool_calls": [{"id": f"c-{tool_name}", "name": tool_name, "arguments": args}]}


def say(text):
    return {"content": text, "tool_calls": []}


class ModelChosenFilterTests(ProjectChatBase):
    """A filter the model picked must be a word of the question; the router no longer sends these questions to a model, but others still go."""

    def converse(self, question, *replies):
        model = ScriptedModel(*replies)
        result = asyncio.run(eko_chat.converse(model, question, main._chat_view))
        return model, result

    def test_a_type_the_user_did_not_write_is_refused_and_the_model_asks_again_without_it(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        model, result = self.converse("pull up the full inventory",
                                      call("find_equipment", type="electrical"), call("find_equipment"), say("There are 3 equipment items."))
        first, second = result["tool_calls"]
        self.assertEqual((first["arguments"], first["available"], first["reason"]), ({"type": "electrical"}, False, "invalid_arguments"))
        self.assertEqual((second["arguments"], second["available"]), ({}, True))
        self.assertIn("type is not in the question", str(model.sent[1][-1]))            # what the model was told
        self.assertEqual(result["card"]["total"], 3)
        self.assertNotIn("type", str(result["card"]["filters"]).lower())
        self.assertTrue(result["grounded"])

    def test_the_refused_filter_never_reaches_the_equipment_data(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        with mock.patch.object(eko_chat, "run_tool", wraps=eko_chat.run_tool) as run:
            self.converse("pull up the full inventory", call("find_equipment", type="electrical", floor="L9", name="zzz"),
                          say("I could not list the equipment."))
        self.assertEqual(run.call_count, 0)

    def test_a_type_the_user_wrote_is_accepted(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        _, result = self.converse("list electrical equipment", call("find_equipment", type="electrical"), say("No electrical equipment was found."))
        self.assertEqual([(t["arguments"], t["available"]) for t in result["tool_calls"]], [({"type": "electrical"}, True)])
        _, result = self.converse("list the AHUs", call("find_equipment", type="ahu"), say("There is 1 AHU."))
        self.assertEqual(result["card"]["total"], 1)

    def test_floor_name_and_hvac_type_follow_the_same_rule(self):
        self.open(HOSPITAL, HOSPITAL_ID)
        for question, tool, args, refused in (
                ("show every unit", "find_equipment", {"floor": "L1"}, True), ("show every unit", "find_equipment", {"name": "EQ"}, True),
                ("show every unit on L1", "find_equipment", {"floor": "L1"}, False), ("which are online", "get_hvac_status", {"type": "ahu"}, True),
                ("which AHUs are online", "get_hvac_status", {"type": "ahu"}, False)):
            with self.subTest(question=question, args=args):
                _, result = self.converse(question, call(tool, **args), say("Done."))
                self.assertEqual(result["tool_calls"][0].get("reason") == "invalid_arguments", refused, result["tool_calls"])

    def test_a_filter_that_is_not_text_is_refused_too(self):
        self.assertEqual(eko_chat.unasked_filters("find_equipment", {"type": 5}, "list 5"), ["type"])
        self.assertEqual(eko_chat.unasked_filters("find_equipment", {"type": ["ahu"]}, "ahu"), ["type"])

    def test_the_helper_asks_only_about_the_narrowing_filters_of_these_tools(self):
        ask = eko_chat.unasked_filters
        self.assertEqual(ask("find_equipment", {"type": "AHU"}, "list AHUs"), [])
        self.assertEqual(ask("find_equipment", {"type": "electrical"}, "read the equipment list"), ["type"])
        self.assertEqual(ask("find_equipment", {"type": ""}, "read the equipment list"), [])
        self.assertEqual(ask("find_equipment", {"in_alarm": True, "limit": 5}, "x"), [])
        self.assertEqual(ask("get_alarms", {"severity": "critical"}, "x"), ["severity"])       # (a severity the question does not say: see test_eko_chat_alarms)
        self.assertEqual(ask("get_alarms", {"severity": "critical"}, "show critical alarms"), [])
        self.assertEqual(ask("get_alarms", {"equipment": "AHU_01", "limit": 5}, "x"), [])       # the item and the limit are not narrowing filters of this kind
        self.assertEqual(ask(None, {"type": "x"}, "y"), [])
        self.assertEqual(ask("find_equipment", None, "y"), [])

    def test_the_tool_text_no_longer_invites_a_guessed_type(self):
        text = eko_chat.TOOLS["find_equipment"]["parameters"]["properties"]["type"]["description"]
        self.assertIn("Only when the user wrote", text)
        self.assertIn("pass no filter", eko_chat.TOOLS["find_equipment"]["description"])

    def test_the_hybrid_mode_still_asks_instead_of_applying_a_type_the_user_did_not_write(self):
        status, decision = eko_chat_llm.to_decision({"intent": "list_equipment", "type": "electrical"}, "pull up the full inventory")
        self.assertEqual((status, decision), ("clarification", None))
        status, decision = eko_chat_llm.to_decision({"intent": "list_equipment", "type": "electrical"}, "list electrical equipment")
        self.assertEqual((status, decision["parameters"]), ("ok", {"type": "electrical"}))
        status, decision = eko_chat_llm.to_decision({"intent": "list_equipment"}, "pull up the full inventory")
        self.assertEqual((status, decision["parameters"]), ("ok", {}))


if __name__ == "__main__":
    unittest.main()
