"""The FIN alarm pipeline on Zinc text, end to end: parse_zinc_csv -> attach_alarm_details ->
FinScramClient._build_realtime -> alarm_is_open -> _flatten_alarms -> /api/fin/alarms, and the
/api/fin/alarm-history parser.

The fixtures are SYNTHETIC. They use only the column names this code reads (alarm, active,
message, priority, sourceRef, dispatcher, occurred, id) and the grid tags seen in a real empty
answer (pollHandle, resultCount, totalRecordCount). No real FIN alarm row has been captured yet;
the acknowledgement column below is a placeholder, not FIN's confirmed name.
"""
import os
import sqlite3
import sys
import time
import unittest
from datetime import datetime, timedelta
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from fake_fin import FakeFinClient  # noqa: E402
import main  # noqa: E402
import notifications  # noqa: E402
from fin_client import FinScramClient, alarm_is_open, parse_zinc_csv  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

BANDS = {"order": "desc", "critical": 250, "warning": 150}   # the shape config.json uses at Marsa
HEADER = "id,alarm,active,message,priority,sourceRef,dispatcher,occurred"


def grid(*rows, meta=""):
    return f'ver:"3.0"{meta}\n{HEADER}\n' + "".join(r + "\n" for r in rows)


def row(n, active="M", message="Supply temp high", priority=250, when="2026-10-20T08:00:00+04:00 Dubai"):
    return f'@a{n} "Alarm {n}",M,{active},"{message}",{priority},@e{n} "AHU-0{n}","CONTROL",{when}'


EMPTY = 'ver:"3.0" pollHandle:"h-1" resultCount:0 totalRecordCount:0\nempty\n'   # the shape FIN returned


def flatten(text, bands=BANDS):
    """The realtime path exactly: _build_realtime stores the parsed rows, _flatten_alarms reads them."""
    holder = type("Holder", (), {})()
    FinScramClient._build_realtime(holder, "", "", text)
    return main._flatten_alarms(holder.last_alarm_rows, bands)


class AlarmPipelineTests(unittest.TestCase):
    def test_an_empty_alarm_grid_is_zero_alarms(self):
        out = flatten(EMPTY)
        self.assertEqual(out["alarms"], [])
        self.assertEqual(out["counts"], {"critical": 0, "warning": 0, "info": 0, "total": 0})

    def test_an_active_alarm_is_listed_with_its_fields(self):
        out = flatten(grid(row(1), meta=" resultCount:1 totalRecordCount:1"))
        self.assertEqual(out["counts"]["total"], 1)
        a = out["alarms"][0]
        self.assertEqual((a["source"], a["message"], a["priority"], a["severity"], a["dispatcher"], a["diagnosed"]),
                         ("AHU-01", "Supply temp high", 250, "critical", "CONTROL", True))
        self.assertTrue(a["occurred"].startswith("2026-10-20T08:00:00"))

    def test_an_acknowledged_active_alarm_stays_listed(self):
        # placeholder column name: acknowledgement must not hide an alarm that is still active
        text = (f'ver:"3.0"\n{HEADER},ackPlaceholder\n' + row(1) + ',M\n')
        self.assertEqual(flatten(text)["counts"]["total"], 1)

    def test_cleared_alarms_are_not_listed(self):
        text = grid(row(1, active=""), row(2, message="Return to normal"), row(3))
        out = flatten(text)
        self.assertEqual([a["source"] for a in out["alarms"]], ["AHU-03"])
        self.assertFalse(alarm_is_open(parse_zinc_csv(text)[0]))

    def test_severity_follows_the_configured_bands(self):
        out = flatten(grid(row(1, priority=250), row(2, priority=150), row(3, priority=50)))
        self.assertEqual(sorted((a["source"], a["severity"]) for a in out["alarms"]),
                         [("AHU-01", "critical"), ("AHU-02", "warning"), ("AHU-03", "info")])
        self.assertEqual(out["counts"], {"critical": 1, "warning": 1, "info": 1, "total": 3})
        ungraded = flatten(grid(row(1, priority=250)), bands={})   # no bands: never graded on another site's numbers
        self.assertEqual(ungraded["alarms"][0]["severity"], "info")

    def test_newest_first(self):
        out = flatten(grid(row(1, when="2026-10-19T08:00:00+04:00 Dubai"), row(2, when="2026-10-20T08:00:00+04:00 Dubai")))
        self.assertEqual([a["source"] for a in out["alarms"]], ["AHU-02", "AHU-01"])

    def test_error_grids_and_unexpected_answers_are_zero_alarms_never_invented(self):
        for text in ('ver:"3.0" err dis:"Unknown func"\nempty\n',
                     'ver:"3.0" err dis:"bad message, with a comma" errTrace:"x"\nempty\n',   # the parser takes this line as a header
                     "<!DOCTYPE html><title>Sign in</title>", "", None, "   \n"):
            out = flatten(text)
            self.assertEqual((out["alarms"], out["counts"]["total"]), ([], 0), repr(text))


class AlarmIdentityTests(unittest.TestCase):
    def test_the_fin_alarm_id_is_kept_and_never_made_up(self):
        out = flatten(grid(row(1)))
        self.assertEqual(out["alarms"][0]["id"], "@a1")
        no_id = 'ver:"3.0"\nalarm,active,message,priority,sourceRef\nM,M,"x",250,@e1 "AHU-01"\n'
        self.assertIsNone(flatten(no_id)["alarms"][0]["id"])

    def test_the_read_is_ok_only_for_a_non_error_zinc_grid(self):
        for text, ok in ((EMPTY, True), (grid(row(1)), True), ("\ufeff" + EMPTY, True), (None, False), ("", False),
                         ('ver:"3.0" err dis:"x"\nempty\n', False), ("<html>", False)):
            holder = type("Holder", (), {})()
            FinScramClient._build_realtime(holder, "", "", text)
            self.assertIs(holder.last_alarm_read_ok, ok, repr(text))


SITE, OTHER = "marsaAlArab", "ellisdonDemo"


def critical(fin_id, source="AHU-01", severity="critical", message="Supply temp high"):
    return {"id": fin_id, "source": source, "severity": severity, "message": message, "occurred": "2026-10-20T08:00:00", "priority": 250}


class CriticalAlarmTriggerTests(unittest.TestCase):
    """main._note_critical_alarms on a throwaway store: the site setting and the project toggle,
    both off by default; one row per open critical FIN alarm; resolved when FIN stops reporting it."""

    def setUp(self):
        import tempfile
        self._store, self._sites = notifications._store, main.BASE_CONFIG.get("critical_alarm_sites")
        notifications._store = notifications.Store(os.path.join(tempfile.mkdtemp(prefix="eko-alarm-"), "n.sqlite3"))
        main.BASE_CONFIG.pop("critical_alarm_sites", None)

    def tearDown(self):
        notifications._store.close()
        notifications._store = self._store
        if self._sites is None:
            main.BASE_CONFIG.pop("critical_alarm_sites", None)
        else:
            main.BASE_CONFIG["critical_alarm_sites"] = self._sites

    def allow(self, *sites):
        main.BASE_CONFIG["critical_alarm_sites"] = list(sites)

    def toggle(self, site, on):
        notifications._store.update_project_preferences(site, types={"alarm.critical": on})

    def rows(self, site=SITE):
        return [r for r in notifications._store.events(site) if r["type"] == "alarm.critical"]

    def poll(self, alarms, site=SITE, ok=True):
        main._note_critical_alarms(site, alarms, ok)

    def test_off_by_default_and_needs_both_the_site_setting_and_the_toggle(self):
        self.poll([critical("@a1")])
        self.assertEqual(self.rows(), [])                          # neither on
        self.allow(SITE)
        self.poll([critical("@a1")])
        self.assertEqual(self.rows(), [])                          # site on, toggle still off
        self.allow()
        self.toggle(SITE, True)
        self.poll([critical("@a1")])
        self.assertEqual(self.rows(), [])                          # toggle on, site off
        self.allow(SITE)
        self.poll([critical("@a1")])
        self.assertEqual(len(self.rows()), 1)                      # both on

    def test_one_row_per_open_critical_alarm_across_polls(self):
        self.allow(SITE)
        self.toggle(SITE, True)
        alarms = [critical("@a1"), critical("@a2", source="AHU-02"), critical("@w1", severity="warning"),
                  critical(None, source="AHU-09")]                   # a warning, and an alarm FIN sent no id for
        for _ in range(5):
            self.poll(alarms)
        rows = self.rows()
        self.assertEqual(sorted((r["state"], r["asset_id"], r["status"]) for r in rows),
                         [("@a1", "AHU-01", "active"), ("@a2", "AHU-02", "active")])
        self.assertEqual({r["severity"] for r in rows}, {"critical"})
        self.assertEqual(notifications._store.unread_count("alice", SITE), 2)

    def test_resolved_when_fin_stops_reporting_it_and_a_recurrence_is_new(self):
        self.allow(SITE)
        self.toggle(SITE, True)
        self.poll([critical("@a1")])
        first = self.rows()[0]["id"]
        self.poll([])                                               # FIN no longer reports it
        self.assertEqual([r["status"] for r in self.rows()], ["resolved"])
        self.poll([critical("@a1")])                                # it comes back
        rows = {r["id"]: r["status"] for r in self.rows()}
        self.assertEqual(rows[first], "resolved")
        self.assertEqual(sorted(rows.values()), ["active", "resolved"])

    def test_a_failed_read_resolves_nothing(self):
        self.allow(SITE)
        self.toggle(SITE, True)
        self.poll([critical("@a1")])
        self.poll([], ok=False)                                     # the read failed: not "all clear"
        self.assertEqual([r["status"] for r in self.rows()], ["active"])

    def test_turning_the_setting_off_still_lets_open_rows_resolve(self):
        self.allow(SITE)
        self.toggle(SITE, True)
        self.poll([critical("@a1")])
        self.allow()                                                # site setting off while it is open
        self.poll([critical("@a1")])
        self.assertEqual([r["status"] for r in self.rows()], ["active"])
        self.poll([])
        self.assertEqual([r["status"] for r in self.rows()], ["resolved"])

    def test_each_project_keeps_its_own_alarm_notifications(self):
        self.allow(SITE)                                            # only Marsa allows it
        self.toggle(SITE, True)
        self.toggle(OTHER, True)
        self.poll([critical("@a1")], site=SITE)
        self.poll([critical("@b1")], site=OTHER)
        self.assertEqual([r["state"] for r in self.rows(SITE)], ["@a1"])
        self.assertEqual(self.rows(OTHER), [])                       # not allowed there
        self.allow(SITE, OTHER)
        self.poll([critical("@b1")], site=OTHER)
        self.poll([], site=OTHER)                                   # clearing OTHER's alarm
        self.assertEqual([r["status"] for r in self.rows(SITE)], ["active"], "never touches Marsa's")
        self.assertEqual([r["status"] for r in self.rows(OTHER)], ["resolved"])


def rec(fin_id, src="e1", message="Supply temp high", when="2026-10-20T08:00:00+04:00 Dubai", priority=250, active="M",
        dispatcher="CONTROL"):
    """One FIN alarm record. Records of one condition share source/message/dispatcher, not their id."""
    source = f'@{src} "AHU-{src}"' if src else ""
    return f'@{fin_id} "Alarm {fin_id}",M,{active},"{message}",{priority},{source},"{dispatcher}",{when}'


EQUIP = 'ver:"3.0"\nid,navName,equip,floorRef\n@e1 "AHU-e1","AHU-e1",M,@f1 "Basement"\n@e2 "AHU-e2","AHU-e2",M,@f1 "Basement"\n'
T1, T2, T3 = ("2026-10-20T08:00:00+04:00 Dubai", "2026-10-20T08:30:00+04:00 Dubai", "2026-10-20T09:00:00+04:00 Dubai")


def equip_alarm_counts(text):
    """The equipment path: _build_realtime's per-equipment alarm lists, which drive inAlarm and the counts."""
    holder = type("Holder", (), {})()
    floors = FinScramClient._build_realtime(holder, "", EQUIP, text)
    return {eq["name"]: len(eq["alarms"])
            for cat in floors.get("Basement", {}).values() if isinstance(cat, list) for eq in cat}


class AlarmDedupTests(unittest.TestCase):
    """One logical alarm per open condition, whatever FIN re-sends: the alarm list, the equipment
    counts and the notification store all count the same alarms."""

    def test_the_reported_case_a_reissued_record_is_not_a_second_alarm(self):
        # the AHU has three records, one open; a later poll brings another open record of the same alarm
        first = grid(rec("a1", active="", when=T1), rec("a2", message="Return to normal", when=T1), rec("a3", when=T2))
        later = grid(rec("a1", active="", when=T1), rec("a2", message="Return to normal", when=T1), rec("a3", when=T2),
                     rec("a4", when=T3))
        for text in (first, later):
            out = flatten(text)
            self.assertEqual([(a["id"], a["source"]) for a in out["alarms"]], [("@a3", "AHU-e1")])
            self.assertEqual(out["counts"]["total"], 1)
            self.assertEqual(equip_alarm_counts(text), {"AHU-e1": 1, "AHU-e2": 0})

    def test_the_same_payload_any_number_of_times_gives_the_same_alarms(self):
        text = grid(rec("a1"), rec("a1"), rec("a2", message="Filter dirty"))   # the same record twice in one answer
        outs = [flatten(text) for _ in range(5)]
        self.assertEqual({len(o["alarms"]) for o in outs}, {2})
        self.assertEqual({tuple(sorted(a["id"] for a in o["alarms"])) for o in outs}, {("@a1", "@a2")})

    def test_distinct_alarms_on_one_ahu_stay_separate(self):
        out = flatten(grid(rec("a1", message="Supply temp high"), rec("a2", message="Filter dirty"),
                           rec("a3", message="Supply fan trip"), rec("a4", message="Filter dirty", dispatcher="CONNECTOR")))
        self.assertEqual(out["counts"]["total"], 4, "a different message or dispatcher is a different alarm")
        self.assertEqual(equip_alarm_counts(grid(rec("a1"), rec("a2", message="Filter dirty"))), {"AHU-e1": 2, "AHU-e2": 0})

    def test_the_same_alarm_on_two_pieces_of_equipment_is_two_alarms(self):
        text = grid(rec("a1", src="e1"), rec("a2", src="e2"))
        self.assertEqual(sorted(a["source"] for a in flatten(text)["alarms"]), ["AHU-e1", "AHU-e2"])
        self.assertEqual(equip_alarm_counts(text), {"AHU-e1": 1, "AHU-e2": 1})

    def test_records_with_no_source_are_merged_only_by_their_own_id(self):
        out = flatten(grid(rec("a1", src=""), rec("a2", src=""), rec("a2", src="")))
        self.assertEqual(sorted(a["id"] for a in out["alarms"]), ["@a1", "@a2"])

    def test_a_change_updates_the_alarm_and_keeps_its_id_and_first_time(self):
        out = flatten(grid(rec("a1", when=T1, priority=150), rec("a4", when=T3, priority=250, message="Supply  TEMP high")))
        [a] = out["alarms"]
        self.assertEqual((a["id"], a["occurred"][:19]), ("@a1", "2026-10-20T08:00:00"), "the occurrence: the first record")
        self.assertEqual((a["priority"], a["severity"]), (250, "critical"), "the newest record's priority")
        self.assertEqual(out["counts"], {"critical": 1, "warning": 0, "info": 0, "total": 1})
        # the order FIN lists them in does not matter
        self.assertEqual(flatten(grid(rec("a4", when=T3), rec("a1", when=T1)))["alarms"][0]["id"], "@a1")

    def test_a_cleared_alarm_that_comes_back_is_a_new_occurrence(self):
        out = flatten(grid(rec("a1", when=T1, active=""), rec("a2", when=T3)))
        self.assertEqual([(a["id"], a["occurred"][:19]) for a in out["alarms"]], [("@a2", "2026-10-20T09:00:00")])


class AlarmDedupNotificationTests(unittest.TestCase):
    """The persisted side: alarm.critical rows in the notification store, fed by the deduplicated list."""

    setUp = CriticalAlarmTriggerTests.setUp
    tearDown = CriticalAlarmTriggerTests.tearDown
    allow = CriticalAlarmTriggerTests.allow
    toggle = CriticalAlarmTriggerTests.toggle
    rows = CriticalAlarmTriggerTests.rows
    poll = CriticalAlarmTriggerTests.poll

    def feed(self, text, site=SITE):
        self.allow(SITE, OTHER)
        self.toggle(site, True)
        self.poll(flatten(text)["alarms"], site=site)

    def test_repeated_and_reissued_records_keep_one_row(self):
        for text in [grid(rec("a1", when=T1))] * 3 + [grid(rec("a1", when=T1), rec("a4", when=T3))] * 3:
            self.feed(text)
        self.assertEqual([(r["state"], r["status"]) for r in self.rows()], [("@a1", "active")])

    def test_each_project_keeps_its_own_row_for_the_same_payload(self):
        text = grid(rec("a1"), rec("a4", when=T3))
        for _ in range(3):
            self.feed(text, SITE)
            self.feed(text, OTHER)
        self.assertEqual([r["state"] for r in self.rows(SITE)], ["@a1"])
        self.assertEqual([r["state"] for r in self.rows(OTHER)], ["@a1"])

    def test_a_reactivation_resolves_the_old_occurrence_and_opens_a_new_one(self):
        self.feed(grid(rec("a1", when=T1)))
        self.feed(grid(rec("a1", when=T1, active=""), rec("a2", when=T3)))
        self.assertEqual(sorted((r["state"], r["status"]) for r in self.rows()), [("@a1", "resolved"), ("@a2", "active")])

    def test_an_acknowledgement_keyed_by_the_alarm_id_still_matches_after_reissued_records(self):
        db = notifications._store.db
        self.feed(grid(rec("a1", when=T1)))
        alarm_id = flatten(grid(rec("a1", when=T1)))["alarms"][0]["id"]
        db.execute("INSERT INTO alarm_acknowledgements (id, site_id, alarm_id, occurrence_id, user_id, acknowledged_at)"
                   " VALUES ('ack1', ?, ?, ?, 'u1', '2026-10-20T08:05:00Z')", (SITE, alarm_id, alarm_id))
        for _ in range(3):
            text = grid(rec("a1", when=T1), rec("a4", when=T3))
            self.feed(text)
            self.assertEqual([a["id"] for a in flatten(text)["alarms"]], [alarm_id], "the acknowledged id is still the alarm's")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM alarm_acknowledgements").fetchone()[0], 1, "sync never touches it")

    def test_the_store_refuses_a_second_active_row_for_one_alarm(self):
        # the atomic guard under the poller: a unique index on the active dedup key, not an in-memory check
        self.feed(grid(rec("a1")))
        [row] = self.rows()
        db = notifications._store.db
        cols = [c[1] for c in db.execute("PRAGMA table_info(notification_events)")]
        pick = ", ".join("id || '-copy'" if c == "id" else c for c in cols)
        with self.assertRaises(sqlite3.IntegrityError) as err:
            db.execute(f"INSERT INTO notification_events ({', '.join(cols)}) SELECT {pick} FROM notification_events WHERE id = ?",
                       (row["id"],))
        self.assertIn("dedup_key", str(err.exception))


def wait_for(fn, timeout=6.0):
    end = time.time() + timeout
    while time.time() < end:
        value = fn()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("timed out")


class GridFin(FakeFinClient):
    """The fake FIN client, but its alarm rows come through the real Zinc parsing path."""
    alarms_text = EMPTY
    history_text = EMPTY

    async def fetch_realtime_data(self, endpoints):
        floors = await super().fetch_realtime_data(endpoints)
        FinScramClient._build_realtime(self, "", "", GridFin.alarms_text)
        return floors

    async def fetch_api(self, endpoint, is_text=False):
        if ".alarms(" in unquote(endpoint):   # main.py percent-encodes the expression
            return GridFin.history_text
        return 'ver:"3.0"\nequipment,work_orders\n7,123\n'


class AlarmRoutesTests(unittest.TestCase):
    def setUp(self):
        self._real = main.FinScramClient
        main.FinScramClient = GridFin
        FakeFinClient.slow_realtime = False
        GridFin.alarms_text = GridFin.history_text = EMPTY
        self.http = TestClient(main.app)
        self.http.__enter__()

    def tearDown(self):
        self.http.post("/api/fin/logout")
        self.http.__exit__(None, None, None)
        main.FinScramClient = self._real
        main.apply_project_settings(None)

    def login(self):
        r = self.http.post("/api/fin/login", json={"username": "u", "password": "p",
                                                   "settings": {"finProjectName": main.BASE_CONFIG["project_name"]},
                                                   "project_id": "proj-site"})
        self.assertEqual(r.status_code, 200, r.text)

    def test_api_alarms_is_empty_for_an_empty_grid(self):
        self.login()
        body = wait_for(lambda: self.http.get("/api/fin/alarms").json().get("timestamp") and self.http.get("/api/fin/alarms").json())
        self.assertEqual((body["alarms"], body["counts"]["total"]), ([], 0))

    def test_api_alarms_lists_an_active_alarm_through_the_real_parser(self):
        GridFin.alarms_text = grid(row(1), row(2, active=""))
        self.login()
        alarms = wait_for(lambda: self.http.get("/api/fin/alarms").json().get("alarms"))
        self.assertEqual([(a["source"], a["severity"]) for a in alarms], [("AHU-01", "critical")])

    def test_history_counts_every_alarm_record_by_day_cleared_ones_too(self):
        today = datetime.now().strftime("%Y-%m-%d")
        yday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        GridFin.history_text = grid(row(1, when=f"{today}T08:00:00+04:00 Dubai"),
                                    row(2, active="", priority=150, when=f"{today}T09:00:00+04:00 Dubai"),
                                    row(3, priority=50, when=f"{yday}T10:00:00+04:00 Dubai"))
        self.login()
        h = self.http.get("/api/fin/alarm-history?days=30").json()
        self.assertTrue(h["retained"])
        self.assertEqual({d["date"]: (d["critical"], d["warning"], d["info"]) for d in h["byDay"]},
                         {today: (1, 1, 0), yday: (0, 0, 1)})

    def test_a_critical_fin_alarm_reaches_the_notification_api_once_and_resolves(self):
        import tempfile
        held, sites = notifications._store, main.BASE_CONFIG.get("critical_alarm_sites")
        self.http.portal.call(lambda: setattr(notifications, "_store", notifications.Store(
            os.path.join(tempfile.mkdtemp(prefix="eko-alarm-api-"), "n.sqlite3"))))
        main.BASE_CONFIG["critical_alarm_sites"] = [main.BASE_CONFIG["project_name"]]
        try:
            self.login()
            base, h = main.NOTIF_BASE, {"X-Eko-Project": "proj-site"}
            site = main.BASE_CONFIG["project_name"]
            # the site's own switch (no route sets it yet); a user's preference is not that switch
            r = self.http.put(base + "/preferences", headers=h, json={"types": {"alarm.critical": True}})
            self.assertEqual(r.status_code, 200, r.text)
            self.http.portal.call(lambda: notifications.store().update_project_preferences(site, types={"alarm.critical": True}))
            GridFin.alarms_text = grid(row(1), row(2, priority=150))          # one critical, one warning
            self.login()                                                       # a new poll at once
            items = wait_for(lambda: [i for i in self.http.get(base + "/notifications", headers=h).json()["items"]
                                      if i["type"] == "alarm.critical"])
            self.assertEqual(len(items), 1)
            self.assertEqual((items[0]["source"], items[0]["severity"], items[0]["asset_id"], items[0]["params"]["message"]),
                             ({"kind": "alarm", "id": "@a1"}, "critical", "AHU-01", "Supply temp high"))
            self.login()                                                       # polls again: still one row
            again = [i for i in self.http.get(base + "/notifications", headers=h).json()["items"] if i["type"] == "alarm.critical"]
            self.assertEqual([i["id"] for i in again], [items[0]["id"]])
            GridFin.alarms_text = EMPTY                                       # FIN clears it
            self.login()
            wait_for(lambda: self.http.portal.call(lambda: [r["status"] for r in notifications.store().events(site)
                                                             if r["type"] == "alarm.critical"]) == ["resolved"])
        finally:
            main.BASE_CONFIG.pop("critical_alarm_sites", None)
            if sites is not None:
                main.BASE_CONFIG["critical_alarm_sites"] = sites
            self.http.portal.call(lambda: (notifications._store.close(), setattr(notifications, "_store", held)))

    def test_history_is_not_retained_for_an_empty_grid(self):
        self.login()
        h = self.http.get("/api/fin/alarm-history?days=30").json()
        self.assertEqual((h["retained"], h["byDay"], sum(h["last24"])), (False, [], 0))


if __name__ == "__main__":
    unittest.main()
