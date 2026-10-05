"""A stand-in for FinScramClient so the backend can be exercised without a FIN server.

Its data is arranged so each Data Mapping block visibly changes the backend's API output:

* live points   - the value of a point is the number after the last ":" of its ID
                  ("p:{project}:r:111" reads 111), so /power-live shows which ID was read
* endpoints     - /power-history is keyed by the configured endpoint names
* equipment     - EQ-1 is tagged "ahu"; its reported type depends on type_priority
* meter profile - PMU-1 and MTR-1 both exist; only the one matching the prefix is returned
* severity      - one open alarm of priority 200; its severity depends on the bands
"""
import asyncio

ALARM_ROW = {
    "alarm": True, "active": True, "message": "High temperature", "priority": 200,
    "sourceRef": {"val": "@e1", "dis": "EQ-1"}, "dispatcher": "CONTROL",
    "occurred": "2026-01-01T00:00:00",
}


def _equipment():
    def meter(name):
        return {"name": name, "bimId": name, "alarms": [], "tags": ["meter"],
                "points": [{"navName": "active power", "currentValue": "12.5", "reporting": True}]}
    return {"L1": {"cctv": [], "hvac": [
        {"name": "EQ-1", "bimId": "EQ-1", "alarms": [{"alarm": "High temperature", "priority": 200}],
         "tags": ["ahu"], "points": [{"navName": "supply temp", "currentValue": "14", "reporting": True}]},
        meter("PMU-1"), meter("MTR-1"),
    ]}}


class FakeFinClient:
    slow_realtime = False   # True: the first realtime read never returns during a test
    # Names the fake FIN server does not know: reading them fails like an unknown project does
    unknown_projects: set = set()
    # Point IDs (with {project} resolved) that do not exist in the fake project. Every other ID does.
    missing_points: set = set()
    # Set to a status code to make every probe answer it (e.g. 500 for "cannot tell")
    probe_status = None

    def __init__(self, base_url, project_name):
        self.base_url = base_url.rstrip("/")
        self.project_name = project_name
        self.client = None
        self.auth_headers = {}
        self.is_authenticated = False
        self.last_alarm_rows = []
        self.last_point_rows = []

    async def authenticate(self, username, password):
        self.is_authenticated = True
        return True

    async def close(self):
        pass

    async def fetch_realtime_data(self, endpoints):
        if FakeFinClient.slow_realtime:
            await asyncio.sleep(3600)
        self.last_alarm_rows = [dict(ALARM_ROW)]
        self.last_point_rows = [{"id": {"val": "@p:x:r:1", "dis": "pt"}, "his": True, "navName": "pt"}]
        return _equipment()

    async def fetch_probe(self, endpoint):
        """The read-only probe the backend uses for validation, answered from the settings above."""
        if FakeFinClient.probe_status:
            return FakeFinClient.probe_status, ""
        if self.project_name == "ghost" or self.project_name in FakeFinClient.unknown_projects:
            return 404, ""
        if "filter=equip" in endpoint:
            return 200, 'ver:"3.0"\nid,dis\n@e1,"EQ-1"\n'
        if "readById" in endpoint:
            from urllib.parse import unquote
            pid = unquote(endpoint).split("readById(@", 1)[1].rstrip(")")
            # browser tests cannot reach the class attributes, so an ID ending ":999" never exists
            if pid in FakeFinClient.missing_points or pid.endswith(":999"):
                return 200, 'ver:"3.0" err dis:"UnknownRecErr"\nempty\n'
            return 200, 'ver:"3.0"\nid,curVal\n@' + pid + ',1\n'
        return 404, ""

    async def fetch_live_point(self, point_id_template):
        tail = point_id_template.rsplit(":", 1)[-1]
        return float(tail) if tail.replace(".", "", 1).isdigit() else None

    async def fetch_power_histories(self, endpoints):
        return {name: {} for name in endpoints}
