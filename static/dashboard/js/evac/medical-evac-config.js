/* ============================================================================
   EVACUATION ENGINE, CONFIGURATION: Demo Medical Centre (E2). Every assumption
   the evacuation plan rests on, with its value (v) and a note saying where it
   comes from. The timings are the team's evacuation planner's, kept as they are
   (estimates for an operations lead to replace with drill figures).
   The graph itself is built from the model by the site generator and stored in
   the site data (security.evacGraph); the graph's own assumptions are listed here.
   ============================================================================ */
(function(root){
  'use strict';
  const A = 'assumption, to confirm with the facilities team';
  const cfg = {
    /* --------------------------- the graph (built from the model) --------------------------- */
    walkSpeedMs: { v: 1.1, note: 'movement speed along the routes, metres per second, the planner\'s corridor timings (about 0.8 s a metre)' },
    dwell: { v: { Ward: 30, Circulation: 5, Stairwell: 10, Exit: 20, 'Ambulance-Bay': 60, Elevator: 20 }, note: 'seconds spent in a space on the way through (a room: getting out of it), the planner\'s values scaled to single rooms' },
    waypointSpacingM: { v: 8, note: 'corridor points every 8 m along a long space, so a route through it follows its length' },
    longSpaceM: { v: 16, note: 'a space longer than this gets corridor points' },
    doorTouchM: { v: 0.45, note: 'a door joins the spaces whose floor outlines are within this distance of it' },
    stretcherDoorMm: { v: 1000, note: 'doors at least this wide take a bed or trolley; narrower doors are walking and wheelchair only, ' + A },
    assumedDoorM: { v: 0.6, note: 'a room with no door element in the model is joined to a corridor or lobby it touches, ' + A },
    openingM: { v: 0.25, note: 'corridors, lobbies and vestibules whose outlines meet (within this distance) are joined: an opening with no door element' },
    openPlanM: { v: 3.0, note: 'an open bay still cut off (the open floor between bays is not a space in the model) joins a reachable space within this distance, ' + A },
    /* E10: the walkable floor. Each level's spaces are rasterised into a grid; movement between two spaces only through a door from the model
       (or an opening, a lift or a stair); each link's length is its walked path on that grid (the site generator's walk step) */
    gridCellM: { v: 0.3, note: 'the walkable grid\'s cell size, metres' },
    defaultDoorWidthM: { v: 0.9, note: 'a door whose width the model does not give is taken as this wide, ' + A },
    openingBridgeM: { v: 0.6, note: 'where two corridors meet, or a lift or stair opens on a lobby, with no door element: the floor between them is walkable this far around the meeting point' },
    /* E12: the open floor of the dialysis unit. The model has the treatment stations as spaces (open bays: no wall across the front and
       none between neighbours) but no space for the floor between them, so the generator joined each bay to the bay beside it. */
    unitFloor: { v: { unit: 'Haemodialysis Satellite Unit', minWidthM: 0.9, minOpenM: 0.7, aisleSpacingM: 2.7, minAreaM2: 4 },
      note: 'E12: the walkable floor of the unit, derived: inside the unit\'s outline in the model, not in any space and not in a wall; strips narrower than 0.9 m are left out (wall cavities). A space opens onto it wherever its outline has no wall from the model for 0.7 m or more (an open bay\'s front, or a door). Aisle points about 2.7 m apart carry the routes along it. ' + A },
    liftCycleS: { v: 110, note: 'a lift car\'s round trip, seconds, the planner\'s bed lift' },
    liftCapacity: { v: 8, note: 'people per car (one bed per trip), the planner\'s value' },
    stairSecondsPerFloor: { v: 45, note: 'one floor down by stair, the planner\'s value' },
    exits: { v: [
      { match: 'Entry vestibule 09-C.029.01.01', type: 'Ambulance-Bay', access: ['stretcher', 'wheelchair', 'ambulatory'], docks: 2, note: 'the main entrance on Level 1: ambulances load at its forecourt, two at a time' },
      { match: 'Entry vestibule 09-C.002.01', type: 'Exit', access: ['wheelchair', 'ambulatory'], note: 'the Level 2 entrance at grade: vans and buses' }],
      note: 'which exits a vehicle can load at; every other exterior door is walk-out only, ' + A },
    floorRank: { v: { L1: 0, L2: 1, L3: 2 }, note: 'the floors from the ground up (Level 1 is the entrance level)' },
    gradeLevels: { v: ['L1', 'L2'], note: 'levels whose exterior doors lead to the ground (the site slopes: Level 2 has entrances at grade); a Level 3 door opens on the roof, not to safety' },
    /* ------------------------------------ people ------------------------------------ */
    people: {
      assistMobility: { v: { Wheelchair: 0.6, Bedbound: 0.4 }, note: 'a patient who needs help to leave (the hospital system\'s flag) moves in a wheelchair or on a bed, this mix, ' + A },
      inSessionEquipment: { v: 'Dialysis circuit (iv)', note: 'a patient on dialysis is disconnected before moving; costed as the planner\'s IV preparation (60 s), ' + A },
      isolatedEquipment: { v: 'Isolation', note: 'contact isolation: the planner\'s isolation preparation (240 s)' },
      acuity: { v: { assist: 'High-Dependency', occ: 'Stable-Bedbound', walking: 'Ambulatory' }, note: 'acuity from the bed state; no clinical data is read, ' + A },
      transfer: { v: { midDialysis: true, onABed: true, flagged: true }, note: 'who takes a vehicle in an outpatient centre: a patient mid-dialysis (disconnected and sent on to another unit), a patient who moves on a bed, and a patient the hospital feed flags as needing help; visitors and walking outpatients go to the assembly point and are not bused (E6: open question 75, answered by the browser audit of E2)' },
      visitorsAreWalking: { v: true, note: 'people in waiting and treatment rooms who are not on a bed walk out and need no vehicle (the planner\'s "walking unless flagged")' },
      specialty: { v: 'General', note: 'the bed type needed at the receiving facility' }
    },
    /* ------------------------------ transport and receiving ------------------------------ */
    vehicles: { v: [
      ['T01', 'Ambulance', 1, 'stretcher', 'Maintenance'], ['T02', 'Ambulance', 1, 'stretcher', 'Available'], ['T03', 'Ambulance', 1, 'stretcher', 'Dispatched'], ['T04', 'Ambulance', 1, 'stretcher', 'Dispatched'],
      ['T05', 'Ambulance', 1, 'stretcher', 'Available'], ['T06', 'Ambulance', 1, 'stretcher', 'Available'], ['T07', 'Ambulance', 1, 'stretcher', 'Available'], ['T08', 'Ambulance', 1, 'stretcher', 'Available'],
      ['T09', 'Patient transport bus', 12, 'ambulatory', 'Available'], ['T10', 'Patient transport bus', 12, 'ambulatory', 'Available'],
      ['T11', 'Wheelchair van', 4, 'wheelchair', 'Dispatched'], ['T12', 'Wheelchair van', 4, 'wheelchair', 'Dispatched'], ['T13', 'Wheelchair van', 4, 'wheelchair', 'Available'],
      ['T14', 'Wheelchair van', 4, 'wheelchair', 'Available'], ['T15', 'Wheelchair van', 4, 'wheelchair', 'Available'], ['T16', 'Wheelchair van', 4, 'wheelchair', 'Available']],
      note: 'the planner\'s default fleet (16 vehicles, 11 available), generic names; the site\'s emergency plan replaces it' },
    facilities: { v: [
      ['RF01', 'Receiving facility 1', 'General hospital', 14, { General: 40, ICU: 8 }], ['RF02', 'Receiving facility 2', 'Specialist hospital', 20, { General: 30, ICU: 15 }],
      ['RF03', 'Receiving facility 3', 'General hospital', 22, { General: 35, ICU: 6 }], ['RF05', 'Receiving facility 5', 'General hospital', 40, { General: 50, ICU: 10 }]],
      note: 'the planner\'s default receiving facilities (travel minutes, free beds), fictional and generic; the site\'s emergency plan replaces them' },
    mutualAid: { v: [], note: 'vehicles arriving later (minute, count, mode): none, as the planner; the largest lever on the headline' },
    /* -------------------------------------- fire -------------------------------------- */
    smokePenalty: { v: 3.0, note: 'smoke makes a space three times as slow to pass, the planner\'s judgement, not a measurement' },
    smokeSpread: { v: 1, note: 'graph steps the smoke reaches from the room of origin, the planner\'s default' },
    scenarioOrigin: { v: 'Radiography with control 02-C.009.02', note: 'the demo scenario\'s first detector: Level 2, Diagnostic Imaging' }
  };
  if(typeof module !== 'undefined') module.exports = cfg;
  root.EKO_EVAC_CFG = cfg;
})(typeof window !== 'undefined' ? window : globalThis);
