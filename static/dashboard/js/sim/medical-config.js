/* ============================================================================
   BUILDING DATA ENGINE, CONFIGURATION: Demo Medical Centre (E1).
   Every assumption the engine uses sits here, once, with its value (v) and a
   note saying where it comes from. Nothing in js/sim/medical-engine.js holds a
   number of its own that is not derived from this file or from the model.
   Times are relative to the load minute ("ago", in hours or days) so the demo
   tells the same story on any day; weather is keyed by calendar date.
   handoff/building-data-engine.md lists every entry in its assumptions table.
   ============================================================================ */
(function(root){
  'use strict';
  const A = 'assumption, to confirm with the operator';
  const cfg = {
    seed: { v: 182, note: 'the engine seed: the same seed gives the same numbers' },
    historyDays: { v: 400, note: 'hourly history kept for the benchmark, the forecast and its backtest (the brief asks for 400 days)' },
    forecastDays: { v: 60, note: 'daily inputs prepared for the forecast horizon' },

    /* ------------------------------- weather ------------------------------- */
    climate: {
      meanC: { v: [19.6, 20.9, 23.6, 27.7, 32.1, 33.9, 35.9, 36.2, 33.7, 30.2, 25.6, 21.4], note: 'monthly mean dry bulb, Dubai, approximate, replace with the site weather feed' },
      swingC: { v: [7.0, 7.2, 7.6, 8.4, 9.6, 9.4, 8.6, 8.3, 8.6, 8.5, 7.9, 7.2], note: 'monthly mean daily range (max minus min), approximate, replace with the site weather feed' },
      rhPct: { v: [65, 63, 60, 52, 47, 52, 52, 56, 61, 61, 62, 66], note: 'monthly mean relative humidity, approximate, replace with the site weather feed' },
      peakHour: { v: 15, note: 'hour of the daily maximum temperature, approximate' },
      dayNoiseC: { v: 1.3, note: 'day to day scatter of the daily mean (one standard deviation), seeded' },
      hourNoiseC: { v: 0.35, note: 'hour to hour scatter, seeded' },
      cddBaseC: { v: 24, note: 'cooling degree day base, as the verification normalisation uses (prove.normalisation.baseC)' }
    },

    /* ------------------------------- schedule ------------------------------ */
    schedule: {
      open: { v: [[7, 21], [7, 21], [7, 21], [7, 21], [7, 21], [8, 14], [7, 21]], note: 'clinic opening hours by weekday, Sunday first, ' + A },
      dialysisSessions: { v: [3, 3, 3, 3, 3, 0, 2], note: 'dialysis sessions per day by weekday, Sunday first, ' + A },
      sessionHours: { v: [[6, 10], [11, 15], [16, 20]], note: 'dialysis session times (start, end), ' + A },
      dialysisStations: { v: 24, note: 'the model\'s 24 nurse call bed connectors in Haemodialysis, one per station' },
      stationsUsed: { v: 0.83, note: 'share of stations booked in a session, ' + A },
      imagingHours: { v: [8, 18], note: 'Diagnostic Imaging and the Orthopaedic Assessment Centre, booked hours, ' + A },
      level2Places: { v: 17, note: 'Level 2 bed and trolley places from the hospital system feed (D182, open question 71)' },
      level2Used: { v: 0.7, note: 'share of Level 2 places in use during booked hours, ' + A },
      peoplePeak: { v: 520, note: 'people in the building at the weekday peak, staff and visitors, ' + A },
      staffNight: { v: 22, note: 'staff on site outside opening hours, ' + A }
    },

    /* ------------------------------- equipment ----------------------------- */
    /* the units come from the model map (handoff/hospital-model-map.md): five real AHUs, three air-cooled chillers,
       four condensing boilers, the generator, the UPS. AHU-6 is modelled as a unit heater and "AHU-7" does not exist. */
    ahus: { v: [
      { id: 'AHU-1', kw: 37, serves: 'L1', note: 'Level 1, west' }, { id: 'AHU-2', kw: 37, serves: 'L1', note: 'Level 1, Haemodialysis' },
      { id: 'AHU-3&4 (1)', kw: 30, serves: 'L2' }, { id: 'AHU-3&4 (2)', kw: 30, serves: 'L2' }, { id: 'AHU-5', kw: 22, serves: 'L3' }],
      note: 'fan rated kW, demo values; the level each unit serves is a DEMO MAPPING (the model assigns no system to the units, open question 63)' },
    fanSetback: { v: 0.7, note: 'fan speed outside opening hours as a share of rated (night setback), ' + A },
    fanDay: { v: 0.8, note: 'fan load in opening hours as a share of rated, demo value' },
    chillers: { v: ['Air-cooled chiller 1', 'Air-cooled chiller 2', 'Air-cooled chiller 3'], note: 'the model\'s air-cooled chillers' },
    copRated: { v: 3.2, note: 'air-cooled chiller COP at 35 °C outdoor, typical for the type, demo value' },
    copSlope: { v: 0.045, note: 'COP change per kelvin of outdoor temperature (better when cooler), typical for air-cooled chillers' },
    envelopeKwPerK: { v: 13, note: 'envelope heat gain per kelvin above the indoor set point, demo calibration' },
    ventKwPerK: { v: 6, note: 'fresh air sensible load per kelvin in opening hours (night: a third), demo calibration' },
    latentFactor: { v: 0.6, note: 'extra cooling load per unit of outdoor humidity above 50 percent, demo calibration' },
    indoorC: { v: 23, note: 'indoor cooling set point used for the loads' },
    coolBaseKw: { v: 290, note: 'process cooling around the clock (IT and communications rooms, imaging equipment), kW thermal, demo calibration' },
    peopleKw: { v: 0.11, note: 'heat gain per person, kW (sensible and latent)' },
    gainShare: { v: { light: 0.6, med: 0.7, dial: 0.4, ahu: 0.5 }, note: 'share of each load that ends as heat in the cooled space (the rest leaves with return and exhaust air), demo calibration' },
    lightingKw: { v: { L1: 96, L2: 84, L3: 30 }, note: 'lighting and small power per level at full use, kW, demo values' },
    lightingNight: { v: 0.62, note: 'lighting and small power outside opening hours as a share of full, ' + A },
    stationKw: { v: 1.15, note: 'one dialysis machine running, kW, typical' },
    waterPlantKw: { v: [22, 38], note: 'dialysis water treatment plant, kW idle and during sessions (the plant room load in the D182 critical loads)' },
    medicalKw: { v: [44, 64], note: 'imaging and medical equipment, kW outside and in booked hours, demo values' },
    hotWaterKw: { v: [24, 40, 18], note: 'heating hot water, kW: night, day, extra in the cooler months (Dec to Feb), condensing boilers, demo values' },
    growthPctYr: { v: 3, note: 'load growth per year (more sessions), so last year reads about 3 percent lower, ' + A },
    meterNoise: { v: 0.025, note: 'hour to hour scatter of the metered loads (one standard deviation), seeded' },
    demandRatio: { v: 1.06, note: 'peak 15-minute demand over the peak hourly mean, typical' },
    contractKw: { v: 850, note: 'the site\'s contracted capacity (D182 demo value)' },
    floorAreaM2: { v: 9400, note: 'conditioned floor area for the EUI (D182 demo value)' },
    budgetSavingPct: { v: 3, note: 'E8: the budget rule. Each month\'s budget is the same month last year from the engine, less this saving target, rounded to a whole MWh (an assumption: a modest yearly target; docs/deviations.md E8)' },
    tolPct: { v: 5, note: 'benchmark tolerance: within it a system is on design (functional specs 9)' },
    /* E10, Part C: ESG on this site, from the engine (js/sim/medical-esg.js) */
    esg: {
      gridFactor: { v: { kgPerKwh: 0.41, id: 'DEWA grid 2025', date: '2025', inForceFrom: '2024-01-01' },
        note: "the grid emission factor, kgCO2e per kWh: a stand-in set from the latest DEWA sustainability report until the client's sustainability partner confirms the factor; every carbon figure shows this source" },
      months: { v: 24, note: 'the months of history the ESG pages read, from the engine (this month to date and the 24 before it)' },
      baselineYearOffset: { v: -1, note: "the stand-in baseline pack's year: the last full year, from the engine; the partner's pack replaces it" },
      targetPctYr: { v: 3, note: "the stand-in pack's yearly reduction target on energy and carbon intensity, the same assumption as the budget rule (budgetSavingPct); awaiting the owner's decision (open question 87)" },
      netZeroYear: { v: 2050, note: "the stand-in pathway's end year, a straight line from the baseline year, as on the hotel's stand-in pack; the partner's pathway replaces it" },
      ieqBands: { v: { tempC: [20.5, 24.5], rhPct: [30, 60], co2Ppm: 1000, pm25: 15 }, note: "the comfort band the site's other pages use (the Spaces comfort figure), a stand-in until the partner sets the standard" },
      ieqHours: { v: [10, 14], note: 'the hours of each open day the monthly in-band shares sample (the 7 and 30 day figures use every open hour), demo' },
      notConfigured: { v: ['water', 'ctWater', 'waste', 'refrigerant', 'fuel', 'bills'], note: 'no water meter, cooling tower meter, waste log, refrigerant log, gas meter or utility bill feed is configured on this site, so these show Not configured (never zero)' }
    },
    /* E3: the electrical side the Consumption and Systems pages show */
    elec: {
      boards: { v: [
        { board: 'DB-L1', level: 'L1', share: { cool: 0.45, heat: 0.6, dial: 1, med: 0.25 } },
        { board: 'DB-L2', level: 'L2', share: { cool: 0.35, heat: 0.3, dial: 0, med: 0.75 } },
        { board: 'DB-L3 plant', level: 'L3', share: { cool: 0.2, heat: 0.1, dial: 0, med: 0 } }],
        note: 'how each system\'s load splits over the three distribution boards (cooling, hot water, dialysis, medical equipment); lighting by each level\'s rating and the fans by the level each unit serves; demo split, sub-metering replaces it' },
      powerFactor: { v: 0.97, note: 'displacement power factor at the main switchboard; demo value, the PMU reading replaces it' },
      pfTarget: { v: 0.95, note: 'the power factor below which the utility charges, typical tariff threshold' },
      voltageV: { v: 400, note: 'nominal line voltage at the main switchboard' },
      imbalancePct: { v: [2, 6], note: 'phase load imbalance across the day, percent; demo range, the PMU phase currents replace it' },
      designKw: { v: 1100, note: 'the incoming supply\'s design capacity, kW (the D182 value, 1.1 MW); the Systems card and the load scale read it' },
      chillerKwTh: { v: 450, note: 'cooling capacity of each air-cooled chiller, kW thermal (three units), demo value sized so the hottest hour of the year uses about three quarters' },
      quarterScatter: { v: 0.012, note: 'scatter of the 15-minute demand around the hourly mean (one standard deviation), seeded' }
    },

    /* ------------------------------- faults ------------------------------- */
    /* each fault: an onset, a cause, and its effect on the data; the alarms are raised from the data */
    faults: {
      ahu1Filter: { asset: 'AHU-1', cause: 'filter loading since the last change', lastChangeAgoD: 36, cleanPa: 125.5, ratePaPerD: 2.75, scatterPa: 8.5, limitPa: 250, bandPa: 200,
        note: 'filter differential pressure rising since the last change; the prediction comes from the data (about 9 days, 7 to 12)' },
      ahu2Supply: { asset: 'AHU-2', cause: 'cooling valve actuator sticking', onsetAgoD: 34, fixAgoD: 14, devBefore: [1.7, 0.019], devAfter: 0.44, scatter: 0.04, limit: 1.5, band: [0, 1], kwhPerUnitDay: 95, wo: 'WO-5077',
        note: 'supply air above set point (°C over) until the actuator was replaced; the proof comes from the data' },
      chillerCop: { asset: 'Air-cooled chiller 1', cause: 'condenser coil fouling, high discharge pressure', onsetAgoD: 12, drop: 0.24, rampD: 3, alarmAgoH: 17.5, windowInH: [6, 8],
        note: 'chiller efficiency lower by about a quarter from 12 days ago; it produces the cooling gap in the benchmark' },
      o2Dip: { asset: 'O2-LINE-1', cause: 'manifold changeover regulator', onsetAgoH: 1.2, nominalBar: 4.1, dipBar: 3.6, limitBar: 3.8, note: 'oxygen line pressure dip below the low limit' },
      fridge: { asset: 'FR-03', cause: 'door seal', excursionsAgoH: [506, 338, 170, 2.1], durH: 1.6, peakC: 9.4, bandC: [2, 8], note: 'medication fridge above its band; four times in 90 days, the last one open' },
      imagingRh: { asset: 'RH-02-C.009.01', room: '2P9pAV3XvCZRg8OjVJf7g3', cause: 'reheat valve stuck, the room overcooled and humid', onsetAgoH: 3.6, rh: 67, band: [30, 60], note: 'imaging room humidity above its band' },
      upsRoom: { asset: 'UPS-1', cause: 'room cooling unit fan failed', onsetAgoH: 14.5, extraC: 3.1, limitC: 27, note: 'UPS room warm' },
      boilerCycle: { asset: 'Condensing boiler 2', cause: 'oversized for the summer hot water load', onsetAgoH: 30, note: 'boiler short cycling' },
      doorHeld: { door: 'CR-2428104', agoMin: 36, heldMin: 6, note: 'door held open past its time' },
      doorForced: { door: 'CR-2446968', agoMin: 180, note: 'door forced open' },
      tailgate: { door: 'CR-2434663', agoMin: 64, note: 'tailgating at a reader' },
      detector: { device: 'SD-928017', agoMin: 390, note: 'smoke detector fault, contamination' },
      ahuNoStop: { asset: 'AHU-3&4 (2)', cause: 'the fire alarm interface relay at the unit starter has failed open, so the stop command never reaches the starter', causeAr: 'مرحّل واجهة إنذار الحريق عند مشغّل الوحدة معطّل في وضع الفتح، فلا يصل أمر الإيقاف إلى المشغّل', wo: 'WO-5132', prio: 'P1',
        task: ['Fire alarm interface relay, unit did not stop on alarm', 'مرحّل واجهة إنذار الحريق، لم تتوقف الوحدة عند الإنذار'],
        note: 'E4: the cause and effect fault the demo scenario finds (the stop is commanded, the run status never changes); a work order is raised when the event ends' },
      liftOut: { lift: 'LIFT2', sinceAgoH: 26, cause: 'door operator fault, waiting for the lift contractor', note: 'E5: the public lift out of service (the Other systems page and the evacuation plan both read it)' },
      camerasOffline: { v: [['CAM-L1-2542543', 55], ['CAM-L1-2664336', 190], ['CAM-L2-2655171', 1450], ['CAM-L2-2669672', 3120]], note: 'cameras offline now, with minutes since the last answered poll' },
      camerasNotRecording: { v: ['CAM-L1-2542957', 'CAM-L2-2541671'], note: 'cameras online whose recorder reports no frames' },
      readersOffline: { v: 3, note: 'card readers offline now (the reader health poll), demo' },
      unlockedOffSchedule: { v: 3, note: 'doors unlocked outside their schedule now, demo' },
      staleSensors: { v: [['04-C.015.01', 190]], note: 'room sensors not reporting, with minutes since the last value' }
    },

    /* ------------------------- E13: the assets' records ------------------------- */
    /* the nameplate where the model has no value, the documents, the spares and the warranty: DEMO values, labelled so on screen
       ("Demo nameplate"); the asset drawer shows the source of every field (the model, the engine, or this table) */
    assetDemo: {
      nameplate: { v: {
        ahu:   { ratedKw: 'fan kW from the engine (ahus)', airflow: { 'AHU-1': 6.2, 'AHU-2': 6.0, 'AHU-3&4 (1)': 4.8, 'AHU-3&4 (2)': 4.8, 'AHU-5': 3.4 }, coolKw: { 'AHU-1': 185, 'AHU-2': 175, 'AHU-3&4 (1)': 140, 'AHU-3&4 (2)': 140, 'AHU-5': 95 }, installed: '2023-04-12', warrantyEnd: '2026-12-31' },
        chw:   { ratedKw: 152, capacityKw: 457, refrigerant: 'R-134a', installed: '2023-03-20', warrantyEnd: '2028-03-19' },
        heat:  { boiler: { ratedKw: 350, installed: '2023-03-27', warrantyEnd: '2028-03-26' }, hx: { capacityKw: 400, installed: '2023-03-27', warrantyEnd: '2025-03-26' }, pump: { ratedKw: 5.5, flow: 18, installed: '2023-03-27', warrantyEnd: '2025-03-26' } },
        elec:  { 'GEN-1': { ratedKva: 1250, installed: '2023-05-08', warrantyEnd: '2027-05-07' }, 'UPS-1': { ratedKva: 120, installed: '2023-05-15', warrantyEnd: '2026-11-30' }, 'ATS-1': { ratedA: 2000, installed: '2023-05-08', warrantyEnd: '2027-05-07' }, 'MSB-1': { ratedA: 2500, installed: '2023-05-02', warrantyEnd: '2028-05-01' } },
        fire:  { installed: '2023-06-01', warrantyEnd: '2026-05-31' },
        cold:  { volumeL: 600, bandC: [2, 8], installed: '2024-01-15', warrantyEnd: '2027-01-14' },
        medgas: { nominalBar: 4.1, installed: '2023-06-20', warrantyEnd: '2026-06-19' },
        sec:   { installed: '2023-06-01', warrantyEnd: '2026-05-31' } },
        note: 'demo nameplate values where the model has none: rated power, airflow or capacity, refrigerant, installation and warranty end dates, typical for the unit types, ' + A },
      contractor: { v: { ahu: 'Mechanical services contractor (demo)', chw: 'Chiller service contractor (demo)', heat: 'Mechanical services contractor (demo)', elec: 'Electrical services contractor (demo)', fire: 'Fire systems contractor (demo)', cold: 'Biomedical engineering (demo)', medgas: 'Medical gas contractor (demo)', sec: 'Security systems contractor (demo)' },
        note: 'the service contractor per system, generic names (no company is named in the demo), ' + A },
      docs: { v: [['om', 'O&M manual'], ['data', 'Datasheet'], ['cert', 'Test certificate']], note: 'the documents an asset record carries in the CMMS; titled placeholders in the demo, the client\'s document store replaces them' },
      spares: { v: {
        ahu: [['Bag filter set, F7', 12, 'set'], ['Panel filter set, G4', 12, 'set'], ['Fan belt set', 2, 'set'], ['Valve actuator, 24 V', 1, 'each']],
        chw: [['Compressor oil, 20 L', 2, 'drum'], ['Filter drier', 2, 'each'], ['Condenser fan motor', 1, 'each']],
        heat: [['Ignition electrode', 4, 'each'], ['Gasket set', 2, 'set'], ['Mechanical seal kit', 3, 'kit']],
        elec: [['Oil filter', 4, 'each'], ['Fuel filter', 4, 'each'], ['Starter battery, 12 V', 2, 'each'], ['UPS battery block', 4, 'each']],
        fire: [['Smoke detector head', 6, 'each'], ['Isolator module', 2, 'each']],
        cold: [['Door seal', 1, 'each'], ['Temperature probe', 2, 'each']],
        medgas: [['Line pressure regulator', 1, 'each'], ['Manifold gauge', 1, 'each']],
        sec: [['Card reader', 2, 'each'], ['Door closer', 2, 'each']] },
        note: 'spares held on site per system (part, quantity, unit), demo values, ' + A }
    },

    /* ----------------------------- work orders ----------------------------- */
    pm: {
      intervalsD: { v: { ahu: 30, chw: 90, heat: 90, elec: 30, fire: 365, cold: 30, medgas: 90, sec: 180 }, note: 'planned maintenance interval per asset type, days, ' + A },
      lateShare: { v: 0.06, note: 'share of planned tasks completed after their due date, demo calibration' }
    },
    response: {
      ackMedMin: { v: { critical: 4, high: 12, medium: 40 }, note: 'median time to acknowledge an alarm by priority, minutes, demo distribution' },
      ackSpread: { v: 0.62, note: 'log-normal spread of the acknowledgement time, demo' },
      recMedH: { v: { critical: 1.8, high: 4.1, medium: 16 }, note: 'median time to return to normal by priority, hours, demo distribution' },
      recSpread: { v: 0.66, note: 'log-normal spread of the recovery time, demo' },
      alarmsPer30D: { v: { critical: 6, high: 22, medium: 48 }, note: 'alarms raised in 30 days by priority (FIN history), demo' },
      targetH: { v: { P1: 4, P2: 24, P3: 120, P4: 480 }, note: 'work order target by priority, hours (the CMMS SLA), ' + A },
      closeMedH: { v: { P1: 2.5, P2: 15, P3: 70, P4: 260 }, note: 'median time to close a corrective work order by priority, hours, demo distribution' },
      closeSpread: { v: 0.55, note: 'log-normal spread of the closure time, demo' },
      cmPer30D: { v: 41, note: 'corrective work orders closed in 30 days besides the story ones, demo' }
    },

    /* --------------------------- security and fire --------------------------- */
    access: {
      passesPerPersonDay: { v: 2.3, note: 'card passes per person on site per day, ' + A },
      deniedShare: { v: 0.014, note: 'share of card transactions denied, demo' },
      busyDoors: { v: ['CR-2433264', 'CR-2466587', 'CR-2426097', 'CR-2500026', 'CR-2675387'], note: 'the doors with the most passes (entrances and the staff route), demo weights' },
      flaggedPerDay: { v: { forced: 0.7, held: 3.6, tailgate: 1.9 }, note: 'flagged door events per day, mean, demo' },
      heldMin: { v: 3.6, note: 'mean held open duration, minutes, demo' }
    },
    fire: {
      testIntervalMonths: { v: 12, note: 'detector test interval, configured (open question 72)' },
      testsAgoD: { v: [44, 148], note: 'the last two quarterly detector tests, days ago (Level 1 and 2; Level 3 and the roof), demo' },
      overdueTests: { v: 10, note: 'detectors past the interval, demo' },
      isolations: { v: [{ zone: 'z13', device: 'IM-941194', agoH: 3, expiresInH: 5, byRole: 'the duty engineer', reasonEn: 'Penthouse hot works, plant room', reasonAr: 'أعمال ساخنة في غرفة المعدات العلوية' },
        { zone: 'z10', device: 'SD-910220', agoH: 31, expiresInH: null, byRole: 'the fire contractor', reasonEn: 'Detector head removed for cleaning, not refitted', reasonAr: 'أُزيل رأس الكاشف للتنظيف ولم يُعد تركيبه' }], note: 'isolations in force, demo' },
      eventsPer30D: { v: { critical: 3, high: 12, medium: 27 }, note: 'security and fire events in 30 days by priority, for the time to acknowledge and clear, demo' }
    },
    power: {
      fuelPct: { v: 84, note: 'generator tank level, demo' }, tankL: { v: 2000, note: 'tank size, demo' }, ratingKw: { v: 1000, note: 'generator rating, demo' },
      burnCurve: { v: [[25, 70], [50, 128], [75, 186], [100, 246]], note: 'fuel burn, L/h at percent load, typical maker\'s curve for a 1 MW set' },
      upsKva: { v: 120, note: 'UPS rating, demo' }, upsBatteryKwh: { v: 33, note: 'UPS battery usable energy at its present health, demo' },
      startBatteryV: { v: 26.8, note: 'starter battery voltage, demo' }, transferTargetS: { v: 10, note: 'the site\'s transfer target (open question 72)' },
      lastTransferS: { v: 9, note: 'E9: the transfer time measured at the last completed run, seconds (demo value)' },
      runIntervalD: { v: 30, note: 'E9: the monthly run with transfer test is due this many days after the last one' },
      lastRunAgoD: { v: 38, note: 'the last monthly run with transfer test (passed, 9 s at 60 percent load); the next was due 30 days later' }
    },
    nurse: {
      callsPerOccBedH: { v: 0.32, note: 'nurse calls per occupied bed per hour, ' + A },
      answerMedMin: { v: { open: 2.4, iso: 3.1, img: 2.8, oac: 2.6 }, note: 'median answer time by unit, minutes, demo distribution' },
      answerSpread: { v: 0.62, note: 'log-normal spread of the answer time, demo' },
      assistShare: { v: 0.3, note: 'share of occupied beds whose patient needs help to leave, ' + A },
      isolatedShare: { v: 0.12, note: 'share of occupied Haemodialysis stations under contact isolation, ' + A }
    },
    /* E10: space use (Spaces > Occupancy, the Space use tab) */
    space: {
      capacityPerM2: { v: { wait: 0.7, clin: 0.25, office: 0.12, circ: 0.2, store: 0.05, plant: 0.02, gen: 0.02, ups: 0.02 }, note: 'E11: THE capacity of the site (the one definition, used by the Overview, Occupancy and the reports): the sum over the model rooms of floor area times this; design occupancy by room type, people per square metre, for the peak against capacity; an assumption until the client gives its space standards' },
      underUsePct: { v: 20, note: 'a room used in fewer than this share of its open hours over 7 days is a candidate to review' },
      usedFromCount: { v: 1, note: 'an hour counts as used when the room\'s count reaches this' }
    },
    scenario: {
      replayHour: { v: 11.5, note: 'the demo scenario replays at 11:30, during the second dialysis session, so the beds are in use as on a clinic day' },
      /* E4: the fire scenario is generated from the model and these values */
      origin: { v: 'Radiography with control 02-C.009.02', note: 'the room where the fire starts; its fire zone is the scenario\'s zone, and the evacuation engine starts its fire in the same room' },
      preAlarmS: { v: 3, note: 'the first detector goes to pre-alarm, seconds into the replay' },
      firstAlarmS: { v: 7, note: 'the first detector goes to alarm' },
      panelAfterS: { v: 2, note: 'the panel goes to alarm this long after the first detector' },
      smokeMs: { v: 0.4, note: 'how fast the smoke reaches the next detector along the ceiling, metres per second: each further detector alarms at the first alarm plus its distance from the origin over this speed; demo value for a small room fire' },
      windowS: { v: 40, note: 'detectors the smoke would reach after this are not reached in the replay' },
      maxDetectors: { v: 4, note: 'the replay shows at most this many detectors in alarm' },
      pullS: { v: 22, note: 'a member of staff operates the manual call point nearest the origin, seconds' },
      responseS: { v: { doors: 2, ahu: 7, dampers: 10, stairfan: 12, lifts: 15 }, note: 'each cause and effect output after the panel alarm, seconds: the programme\'s typical delays; each point adds a seeded half second' },
      dueS: { v: 16, note: 'an output not observed this long after the panel alarm is Not observed' },
      steps: { v: { cams: 30, power: 40, ack: 45, beds: 50, muster: 70, end: 120 }, note: 'when the replay shows the cameras, the emergency power, the acknowledgement at the source, the beds, the muster counts and the end card' },
      pressurisedStairs: { v: ['SPF-1', 'SPF-2'], note: 'stair pressurisation fans (two enclosed exit stairs; the model has no fan element for them), ' + A },
      musterOf: { v: { L1: 'MP-2', L2: 'MP-1', L3: 'MP-1' }, note: 'the muster point for people leaving by an exit on each level (the main entrance forecourt for Level 1, the north car park for the upper entrance), ' + A }
    },
    /* E4: the hourly security records the Security pages recompute from */
    records: {
      days: { v: 7, note: 'days of hourly records kept for access, intrusion and camera health' },
      camDropPerH: { v: 0.002, note: 'chance a camera misses an hour of polls (a short outage) in the history, demo' },
      motionPerH: { v: { open: 2.5, closed: 0.15, clinicFactor: 4 }, note: 'motion detections per area per hour, open and closed, and the factor for clinic areas, demo' },
      armedClosed: { v: true, note: 'areas are armed outside opening hours; plant and IT areas stay armed, ' + A }
    },
    /* E5: other building systems and the data states */
    other: {
      liftTripsPerH: { v: 9, note: 'lift trips per hour in opening hours (a fifth at night), demo' },
      gases: { v: { O2: 'o2Dip', MA: null, VAC: null }, note: 'the medical gas whose state follows an engine fault (oxygen: the line pressure dip)' },
      waterAlarmKw: { v: 0, note: 'the dialysis water plant is in warning while a session runs and the plant is on its standby train, demo' },
      m2PerPerson: { v: 2.5, note: 'floor area per person a room is sized for (its capacity on the Occupancy page), typical for clinic and waiting rooms' },
      evStates: { v: ['charging', 'available', 'available', 'fault'], note: 'EV charger states, demo; the charger feed replaces them' }
    },
    points: {
      perIntegration: { v: { 'BMS (FIN Framework, BACnet)': 3350, 'CMMS': 0, 'Video system': 139, 'Access control': 205, 'Fire alarm panel (demo)': 106, 'Hospital system, bed status (demo)': 41, 'Nurse call (demo)': 41 }, note: 'points per integration: the BMS points list, one per camera, reader, fire device, bed and nurse call connector; the CMMS carries records, not points' },
      intervalMin: { v: { 'BMS (FIN Framework, BACnet)': 5, 'Video system': 1, 'Access control': 1, 'Fire alarm panel (demo)': 1, 'Hospital system, bed status (demo)': 2, 'Nurse call (demo)': 1, 'CMMS': 15 }, note: 'expected update interval per integration, minutes; a point is stale after three intervals' },
      bmsStale: { v: 64, note: 'BMS points stale now besides the sensors the faults name, demo' },
      bmsFlat: { v: 21, note: 'BMS points flat-lined (no change in 24 hours on a value that should move), demo' },
      bmsOor: { v: 11, note: 'BMS points out of their physical range, demo' },
      bmsNever: { v: 12, note: 'BMS points configured but never reported, demo' },
      panelLagMin: { v: 18, note: 'the fire panel\'s last full poll, minutes ago (the panel is in fault, see the detector fault)' },
      bmsDipHour: { v: 3, note: 'the hour last night the BMS polls dropped (a network switch restart), demo' }
    }
  };
  if(typeof module !== 'undefined') module.exports = cfg;
  root.EKO_SIM_CFG = root.EKO_SIM_CFG || {}; root.EKO_SIM_CFG.medical = cfg;
})(typeof window !== 'undefined' ? window : globalThis);
