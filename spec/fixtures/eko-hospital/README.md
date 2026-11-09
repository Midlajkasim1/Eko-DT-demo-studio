Saved EKO Hospital FIN exports (6 Nov 2026), the reference for the Live Twin mapping (static/dashboard/js/layouts/hospital-twin-map.js) and its tests.

- equipment.json: the Studio backend's equipment payload as FIN gave it: 64 equipment with name, FIN id, floor, type tags, BIM id and every live point
  (value, kind, unit, bool, enum, historised, alarm point). PRIMARY reference. Equipment named ENERGY / USAGE / CALC is not in it: the backend leaves it out.
- history-points.json: the historised points, 167 points on 38 equipment. Supplementary: names and units only.
- alarms.json: the open alarms, 10 on 9 equipment, with FIN equipment ids and states. Each alarm's `history` holds cleared records (Return to normal).

They are a snapshot. They do not prove that FIN is reachable now or still says the same. BIM ids in equipment.json keep FIN's Zinc escape (\$ for $).
