"""The FIN alarm pipeline on Zinc text, end to end: parse_zinc_csv -> attach_alarm_details ->
FinScramClient._build_realtime -> alarm_is_open -> _flatten_alarms -> /api/fin/alarms, and the
/api/fin/alarm-history parser.

The fixtures are SYNTHETIC. They use only the column names this code reads (alarm, active,
message, priority, sourceRef, dispatcher, occurred, id) and the grid tags seen in a real empty
answer (pollHandle, resultCount, totalRecordCount). No real FIN alarm row has been captured yet;
the acknowledgement column below is a placeholder, not FIN's confirmed name.
"""
import os
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
        notifications._store.update_preferences(notifications.project_recipient(site), types={"alarm.critical": on})

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
        self.assertEqual(notifications._store.unread_count(notifications.project_recipient(SITE), SITE), 2)

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
            r = self.http.put(base + "/preferences", headers=h, json={"types": {"alarm.critical": True}})
            self.assertEqual(r.status_code, 200, r.text)
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
            site = main.BASE_CONFIG["project_name"]
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
