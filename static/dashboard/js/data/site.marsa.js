/* ============================================================================
   Marsa Al Arab — ALL fixture values. No number lives in markup or component
   code. Derived figures (AED, CO2, percentages) are computed at render time
   from the stated bases below, never stored twice.
   Values carried over verbatim from the approved reference prototype.
   ============================================================================ */
window.EKO_DATA = window.EKO_DATA || {};
window.EKO_DATA.marsa = {
  "key": "marsa",
  "nameEn": "Marsa Al Arab", "nameAr": "مرسى العرب",
  "cityEn": "Dubai", "cityAr": "دبي",

  /* Brand slot (D54): the top-bar mark is DATA, per site. light/dark are the
     on-light / on-dark colour marks, mono is the single-colour mark used for
     print and for the co-brand lockup. partner is null unless the site is
     co-branded (Khazna: "EKO · powered by …" — held). */
  "brand": {
    "name": "EKO",
    "logo": { "light": "/static/dashboard/assets/brand/eko-logo-light.svg",
              "dark":  "/static/dashboard/assets/brand/eko-logo-dark.svg",
              "mono":  "/static/dashboard/assets/brand/eko-logo-mono.svg" },
    "partner": null
  },

  /* Bases for every derived figure (spec: data honesty). */
  "basis": {
    "co2KgPerKwh": 0.41, "co2FactorId": "DEWA grid 2025",
    "aedPerKwh": 0.30, "tariffId": "DEWA-C", "tariffVersion": "2026-Q3",
    "averagingKey": "rpAvg.min15",
    "monthStart": "1 Sep",
    /* D89: the references above are placeholders until the client confirms
       them; every figure and footer says "provisional" while they are. */
    "tariffStatus": "provisional", "co2FactorStatus": "provisional", "gasTariffStatus": "provisional",
    "asOf": "14:00"
  },

  "metrics": {
    "energyTodayKwh": null,
    "energyTodayMwh": null,
    "waterTodayM3": null,
    "gasTodayM3": null,
    "comfortIndex": null,
    "iaq": null,
    "loadNowMw": null,
    "todayForecastEodMwh": null,
    "loadAboveBaselinePct": null,
    "baselineKw": 71.0,
    "peakTodayKw": null,
    "peakTodayMw": null,
    "peakPctOfLimit": null,
    "contractedKw": 125,
    "pfNow": null,
    "pfTarget": 0.95,
    "avoidableKwhMo": null
  },

  /* Executive summary rows (Overview). delta = vs typical; spark = relative
     series drawn with the shared smooth-path generator. dom = identity hue. */
  /* D135: a summary row names its measured value (metric + decimals); it never stores a second copy of the number */
  "summary": [
    { "key": "energy", "dom": "#2DD4BF", "icon": "bolt",  "label": "kEnergyToday", "metric": "energyTodayKwh", "d": 1, "u": "kWh",
      "deltaEn": null, "deltaAr": null, "spark": [], "sparkCompare": [] },
    { "key": "water",  "dom": "#60A5FA", "icon": "drop",  "label": "kWaterToday", "metric": "waterTodayM3", "d": 1, "u": "m³",
      "deltaEn": null, "deltaAr": null, "spark": [] },
    { "key": "gas",    "dom": "#A78BFA", "icon": "flame", "label": "kGasToday", "metric": "gasTodayM3", "d": 1, "u": "m³",
      "deltaEn": null, "deltaAr": null, "spark": [] },
    { "key": "comfort","dom": "#4E9C7C", "icon": "gauge", "label": "kComfortIdx", "metric": "comfortIndex", "d": 1, "u": "",
      "capEn": null, "capAr": null, "capTone": "t3" },
    { "key": "iaq",    "dom": "#4E9C7C", "icon": "wind",  "label": "kIaq", "metric": "iaq", "d": 1, "u": "",
      "capEn": null, "capAr": null, "capTone": "pos" }
  ],

  /* Integrations (drawer + top-bar pill count). */
  "integrations": [
    { "name": "BMS (J2 FIN Framework)", "proto": "BACnet/IP", "st": "Live", "hb": "2 s ago", "pts": "4,812 points" }
  ],

  /* ------------------------------------------------------------------------
     ALARMS — the one list. Ribbon, panel, markers, register chips and the
     asset panel all read from here. Severity per spec (D1): critical | high |
     medium. cat (fdd | sys) is the reference's category, kept for the
     by-system split. age as shown; sys drives the by-system card.
     ------------------------------------------------------------------------ */
  "alarms": [
    { "id": "al-ch2", "fam": "hvac", "asset": "CH-2",       "sev": "high",     "cat": "sys", "sys": "HVAC",
      "ack": null, "x": 48.8, "y": 71.5, "clu": true, "ageH": 264,
      "locEn": "Chiller CH-2, Plant room L3", "locAr": "المبرد CH-2، غرفة المحطة L3",
      "plainEn": "Working harder than it should to reject heat", "plainAr": "يعمل بجهد أكبر مما ينبغي لطرد الحرارة",
      "techEn": "Condenser approach +2.1 K", "techAr": "تقارب المكثف +2.1 K", "impactAedMo": 9400, "raised": "07:02",
      "lifecycle": [["Raised","07:02",true],["Issued","+2m · 07:04",true],["Acknowledged","—",false],["Work order","—",false]] },
    { "id": "al-cop", "fam": "hvac", "asset": "CH-2",       "sev": "critical", "cat": "fdd", "sys": "HVAC",
      "ack": null, "x": 48.8, "y": 71.5, "clu": true, "ageH": 264,
      "locEn": "Chiller CH-2, Plant room L3", "locAr": "المبرد CH-2، غرفة المحطة L3",
      "plainEn": "Producing less cooling for the power it draws", "plainAr": "ينتج تبريدًا أقل مقابل الطاقة المسحوبة",
      "techEn": "Efficiency warning · COP 4.1", "techAr": "تحذير كفاءة · COP 4.1", "impactAedMo": null, "raised": "07:02",
      "lifecycle": [["Raised","07:02",true],["Issued","+2m · 07:04",true],["Acknowledged","—",false],["Work order","—",false]] },
    { "id": "al-ahu", "fam": "vent", "asset": "AHU-L12-03", "sev": "high",     "cat": "sys", "sys": "HVAC",
      "ack": null, "x": 51.2, "y": 43.0, "ageH": 4,
      "locEn": "Air handler L12-03, Guest rooms W", "locAr": "وحدة مناولة الهواء L12-03، غرف الضيوف غرب",
      "plainEn": "Blowing air 1.8° warmer than it should", "plainAr": "يدفع هواءً أدفأ بـ 1.8° مما يجب",
      "techEn": "Supply air +1.8 °C vs SP", "techAr": "هواء الإمداد +1.8 °م عن نقطة الضبط", "impactAedMo": 3100, "raised": "10:04",
      "lifecycle": [["Raised","10:04",true],["Issued","10:20",true],["Acknowledged","—",false],["Work order","WO-2287 drafted",false]] },
    { "id": "al-vav", "fam": "vent", "asset": "VAV-L11-W",  "sev": "critical", "cat": "fdd", "sys": "HVAC",
      "ack": { "time": "14:22", "who": "AY" }, "x": 41.7, "y": 48.2, "ageH": 6,
      "locEn": "L11 West, Guest rooms", "locAr": "الطابق 11 غرب، غرف الضيوف",
      "plainEn": "Heating and cooling at the same time", "plainAr": "تدفئة وتبريد في آن واحد",
      "techEn": "Simultaneous heat + cool", "techAr": "تدفئة وتبريد متزامنان", "impactAedMo": 4900, "raised": "08:12",
      "lifecycle": [["Raised","08:12",true],["Issued","08:25",true],["Acknowledged","14:22 · AY",true],["Work order","—",false]] },
    { "id": "al-pump", "fam": "pumps", "asset": "PUMP-CHW-1", "sev": "critical", "cat": "fdd", "sys": "HVAC",
      "ack": null, "x": 50.9, "y": 74.6, "clu": true, "ageH": 2,
      "locEn": "Chilled water pump 1, Plant room L3", "locAr": "مضخة المياه المبردة 1، غرفة المحطة L3",
      "plainEn": "Starting and stopping far too often", "plainAr": "تشتغل وتتوقف بوتيرة عالية جدًا",
      "techEn": "Short-cycling · 14 starts/h", "techAr": "تشغيل متقطع · 14 بدء/س", "impactAedMo": 1900, "raised": "12:10",
      "lifecycle": [["Raised","12:10",true],["Issued","12:14",true],["Acknowledged","—",false],["Work order","—",false]] },
    { "id": "al-ef", "fam": "vent", "asset": "EF-RF-02",   "sev": "high",     "cat": "sys", "sys": "HVAC",
      "ack": null, "x": 57.1, "y": 32.5, "ageH": 3,
      "locEn": "Extract fan RF-02, Roof plant", "locAr": "مروحة السحب RF-02، سطح المحطة",
      "plainEn": "Shaking more than it should while running", "plainAr": "تهتز أكثر من المعتاد أثناء التشغيل",
      "techEn": "Vibration above baseline", "techAr": "اهتزاز فوق خط الأساس", "impactAedMo": null, "raised": "11:20",
      "lifecycle": [["Raised","11:20",true],["Issued","11:24",true],["Acknowledged","—",false],["Work order","—",false]] },
    { "id": "al-db", "fam": "elec", "asset": "DB-L3-2",    "sev": "high",     "cat": "sys", "sys": "Electrical",
      "ack": null, "ageH": 8,
      "locEn": "Distribution board L3-2, Plant room L3", "locAr": "لوحة التوزيع L3-2، غرفة المحطة L3",
      "plainEn": "One electrical phase is pulling more than its share", "plainAr": "أحد الأطوار الكهربائية يسحب أكثر من نصيبه",
      "techEn": "Phase imbalance 5.9%", "techAr": "عدم اتزان أطوار 5.9%", "impactAedMo": null, "raised": "06:12",
      "lifecycle": [["Raised","06:12",true],["Issued","06:18",true],["Acknowledged","—",false],["Work order","—",false]] },
    { "id": "al-ups", "fam": "elec", "asset": "UPS-01",     "sev": "medium",   "cat": "sys", "sys": "Electrical",
      "ack": null, "ageH": 48,
      "locEn": "UPS 01, Server room GF", "locAr": "وحدة UPS 01، غرفة الخوادم GF",
      "plainEn": "Backup battery has missed its scheduled test", "plainAr": "بطارية الاحتياط تجاوزت موعد اختبارها",
      "techEn": "Battery test overdue", "techAr": "اختبار البطارية متأخر", "impactAedMo": null, "raised": "Fri 09:00",
      "lifecycle": [["Raised","Fri 09:00",true],["Issued","Fri 09:05",true],["Acknowledged","—",false],["Work order","—",false]] },
    { "id": "al-fd", "fam": "fire", "asset": "FD-L2-14",   "sev": "high",     "cat": "sys", "sys": "Life safety",
      "ack": null, "ageH": 5,
      "locEn": "Smoke detector L2-14, Guest rooms E", "locAr": "كاشف الدخان L2-14، غرف الضيوف شرق",
      "plainEn": "A smoke detector has stopped reporting", "plainAr": "توقف أحد كواشف الدخان عن الإبلاغ",
      "techEn": "Smoke detector offline", "techAr": "كاشف دخان غير متصل", "impactAedMo": null, "raised": "09:20",
      "lifecycle": [["Raised","09:20",true],["Issued","09:22",true],["Acknowledged","—",false],["Work order","—",false]] },
    { "id": "al-spk", "fam": "fire", "asset": "SPK-Z3",     "sev": "medium",   "cat": "sys", "sys": "Life safety",
      "ack": null, "ageH": 24,
      "locEn": "Sprinkler zone 3, Podium", "locAr": "منطقة الرشاشات 3، البوديوم",
      "plainEn": "Sprinkler water pressure is running low", "plainAr": "ضغط مياه الرشاشات منخفض",
      "techEn": "Sprinkler pressure low · 6.2 bar", "techAr": "ضغط الرشاشات منخفض · 6.2 bar", "impactAedMo": null, "raised": "Sun 14:00",
      "lifecycle": [["Raised","Sun 14:00",true],["Issued","Sun 14:04",true],["Acknowledged","—",false],["Work order","—",false]] },
    { "id": "al-cam", "fam": "sec", "asset": "CAM-P07",    "sev": "high",     "cat": "sys", "sys": "Security",
      "ack": null, "ageH": 7,
      "locEn": "Camera P07, Podium entrance", "locAr": "الكاميرا P07، مدخل البوديوم",
      "plainEn": "A security camera has gone dark", "plainAr": "انقطعت إحدى كاميرات المراقبة",
      "techEn": "Camera offline", "techAr": "كاميرا غير متصلة", "impactAedMo": null, "raised": "07:20",
      "lifecycle": [["Raised","07:20",true],["Issued","07:23",true],["Acknowledged","—",false],["Work order","—",false]] },
    { "id": "al-dr", "fam": "sec", "asset": "DR-S12",     "sev": "medium",   "cat": "sys", "sys": "Security",
      "ack": null, "ageH": 0.37,
      "locEn": "Service door S12, Loading bay", "locAr": "باب الخدمة S12، منطقة التحميل",
      "plainEn": "A service door has been held open too long", "plainAr": "أحد أبواب الخدمة مفتوح لمدة أطول من المسموح",
      "techEn": "Door held open", "techAr": "باب مفتوح لمدة طويلة", "impactAedMo": null, "raised": "14:08",
      "lifecycle": [["Raised","14:08",true],["Issued","14:09",true],["Acknowledged","—",false],["Work order","—",false]] }
  ],
  /* Systems with no open alarms — the by-system card's honest footer. */
  "families": [
    { "id": "hvac",  "en": "HVAC",               "ar": "\u0627\u0644\u062a\u0643\u064a\u064a\u0641" },
    { "id": "vent",  "en": "Ventilation",         "ar": "\u0627\u0644\u062a\u0647\u0648\u064a\u0629" },
    { "id": "pumps", "en": "Pumps",               "ar": "\u0627\u0644\u0645\u0636\u062e\u0627\u062a" },
    { "id": "elec",  "en": "Electrical",          "ar": "\u0627\u0644\u0643\u0647\u0631\u0628\u0627\u0621" },
    { "id": "light", "en": "Lighting",            "ar": "\u0627\u0644\u0625\u0646\u0627\u0631\u0629" },
    { "id": "fire",  "en": "Fire & life safety",  "ar": "\u0627\u0644\u062d\u0631\u064a\u0642 \u0648\u0627\u0644\u0633\u0644\u0627\u0645\u0629" },
    { "id": "sec",   "en": "Security",            "ar": "\u0627\u0644\u0623\u0645\u0646" }
  ],
  "alarmsClear": ["Plumbing", "Utilities"],
  "lifeSafetyActive": 0,

  /* Timeline events derive from the alarm list (ageH < 24 h) — see app.js. */
  "load24hMw": [2.98,2.94,2.9,2.88,2.9,2.96,3.05,3.18,3.32,3.44,3.52,3.61,
                3.72,3.88,4.02,4.12,3.98,3.81,3.66,3.5,3.38,3.24,3.12,3.65],

  /* ------------------------------------------------------------------------
     ENERGY landing (module summary + optimization cards).
     AED figures derive from kWh × basis.aedPerKwh at render.
     ------------------------------------------------------------------------ */
  "energyLanding": {
    "performancePct": null, "perfSpark": [], "perfDeltaEn": null, "perfDeltaAr": null,
    "perfWordEn": null, "perfWordAr": null,
    "currentKw": null, "baselineKw": null,
    "mtdKwh": null,
    "carbonKgH": null,
    "overnightDeviationPct": null,
    "overnightWordEn": null, "overnightWordAr": null, "overnightTone": "ok",
    "sumGauges": [
      { "key": "enDev", "labelEn": "ENERGY DEVIATION", "labelAr": "\u0627\u0646\u062d\u0631\u0627\u0641 \u0627\u0644\u0637\u0627\u0642\u0629", "val": null, "max": 100, "u": "%", "wordEn": null, "wordAr": null, "tone": "ok" },
      { "key": "loadFactor", "labelEn": "LOAD FACTOR", "labelAr": "\u0645\u0639\u0627\u0645\u0644 \u0627\u0644\u062d\u0645\u0644", "val": null, "max": 100, "u": "%", "wordEn": null, "wordAr": null, "tone": "ok" }
    ],
    "wasteTotalKwh": null,
    "wasteTotalAed": null,
    "kpis": [
      { "key": "overnight", "labelEn": "Overnight / Idle Load", "labelAr": "حمل الليل / الخمول",
        "sharePct": null, "gaugeVal": null, "gaugeMax": 100, "stateEn": null, "stateAr": null, "tone": "ok",
        "wasteKwh": null, "costAed": null, "tipEn": "Schedule pumps, lighting, and HVAC during off-hours.",
        "tipAr": "جدولة المضخات والإنارة والتكييف خارج ساعات التشغيل." },
      { "key": "epr", "labelEn": "HVAC / EPR", "labelAr": "التكييف / EPR",
        "sharePct": null, "gaugeVal": null, "gaugeMax": 2, "stateEn": null, "stateAr": null, "tone": "ok",
        "wasteKwh": null, "costAed": null, "tipEn": "Timely FDD maintenance saves energy and extends equipment life.",
        "tipAr": "صيانة FDD في وقتها توفر الطاقة وتطيل عمر المعدات." },
      { "key": "pf", "labelEn": "Power Factor", "labelAr": "معامل القدرة",
        "sharePct": null, "gaugeVal": null, "gaugeMax": 1, "stateEn": null, "stateAr": null, "tone": "ok",
        "wasteKwh": null, "tipEn": "Ensure capacitor banks operate correctly to maintain power factor.",
        "tipAr": "تأكد من عمل بنوك المكثفات للحفاظ على معامل القدرة." },
      { "key": "imbalance", "labelEn": "Load Imbalance", "labelAr": "عدم اتزان الأحمال",
        "sharePct": null, "gaugeVal": null, "gaugeMax": 30, "stateEn": null, "stateAr": null, "tone": "ok",
        "wasteKwh": null, "tipEn": "Regular phase balancing and equipment check.",
        "tipAr": "موازنة الأطوار وفحص المعدات دوريًا." }
    ],
    "topOpps": [
      { "titleEn": "Overnight / idle load", "titleAr": "حمل الليل / الخمول", "aed": null },
      { "titleEn": "HVAC faults", "titleAr": "أعطال التكييف", "aed": null },
      { "titleEn": "Power factor", "titleAr": "معامل القدرة", "aed": null } ],
    "modules": [
      { "label": "subPower", "pageId": "power", "sub": "power", "headEn": null, "headAr": null },
      { "label": "subBench", "pageId": "bench", "sub": "bench", "headEn": null, "headAr": null },
      { "label": "subAnom", "pageId": "anom", "sub": "anom", "headEn": null, "headAr": null },
      { "label": "subFcst", "pageId": "fcst", "sub": "fcst", "headEn": null, "headAr": null } ]
  },

  /* ------------------------------------------------------------------------
     POWER analytics page.
     ------------------------------------------------------------------------ */
  "utilLanding": { "waterMeters": null, "gasMeters": null,
    "waterSparkPath": null,
    "gasSparkPath": null,
    "chips": [ { "id": "W-01", "x": 50, "y": 70 }, { "id": "G-01", "x": 57.5, "y": 65 } ] },

  /* Signed-in user + site capability flags (D43). Marsa carries control as a
     DEMO capability (the demo switch); Khazna carries it live. canControl is
     the per-role permission; both must hold for the Control tab to exist. */
  "user": { "name": "Arman Y.", "nameAr": "\u0623\u0631\u0645\u0627\u0646 \u064a.", "role": "technician", "canControl": true },
  /* D105: the ROLE sets defaults (landing, wording, disclosure, layout controls) — never permissions.
     landing: site | portfolio | auto (portfolio when the user covers more than one site). Every disclosure
     is a per-user toggle the role only seeds; nothing here locks anything away. */
  "roles": {
    "technician": { "landing": "site",      "wording": "plain",     "disclose": { "tech": false, "full": false, "raw": false } },
    "engineer":   { "landing": "auto",      "wording": "technical", "disclose": { "tech": true,  "full": true,  "raw": true,  "edit": true  } },
    "executive":  { "landing": "portfolio", "wording": "plain",     "disclose": { "tech": false, "full": false, "raw": false } }
  },
  /* D106: the control-room wall. Type derives from viewingDistance (metres); dwell per pane kind in seconds;
     panes render in this order and can be switched off in "disabled"; the layout drifts shiftPx every shiftEverySec. */
  /* D108: the wall. Targets are the published guidance and name their source; the client's alarm philosophy overrides them per site. shifts null = "since midnight". */
  "wall": { "viewingDistance": 6, "panel": { "diagonalIn": 98 }, "scale": 1, "theme": "dark", "lock": false, "wallBrightness": 100, "dwell": { "main": 30, "model": 40 }, "panes": ["model", "map", "board"], "disabled": [], "shiftPx": 6, "shiftEverySec": 90, "topAlarms": 8, "hintSec": 5,
    "alarmTargets": { "standingHours": 24, "standingTarget": 10, "standingSource": "EEMUA 191", "rateWindowMin": 60, "rateTargetPer10Min": 1, "rateSource": "EEMUA 191", "floodPer10Min": 10, "floodSource": "ISA-18.2", "priorityRef": [5, 15, 80], "prioritySource": "EEMUA 191" },
    "shifts": { "starts": ["06:00", "14:00", "22:00"] },
    "watch": { "autonomyDays": 3, "trendWindowH": 24 } },
  "features": { "control": "demo", "cmms": "mock", "llm": "mock" },
  /* D125: ENTITLEMENTS — which modules are active, offered as add-ons ("available") or hidden.
     Production reads the tenant's licence; the administrator's overrides live in localStorage
     (Account menu › Administration › Modules and add-ons). Keys: a module id, or module.sub.
     showAddOns false hides every add-on as if it did not exist. Activation is a licence change
     (D126): the dialog tells the user to contact their administrator, nothing is sent anywhere. */
  "entitlements": { "showAddOns": true,
    "modules": { "esg": "available", "maintenance": "available", "security": "available",
                 "systems.life": "available", "systems.security": "available",
                 "energy.bench": "available", "energy.fcst": "available" } },  /* the config lines: cmms mock | hexagon · llm mock | ollama | none */
  "llm": { "ollama": { "baseUrl": "http://localhost:11434", "model": "llama3.1:8b", "timeoutMs": 20000, "stream": false } },
  "sites": [ { "id": "marsa", "control": "demo" }, { "id": "khazna", "control": "on" } ],
  "controlUsers": ["Arman Y.", "S. Khan"],

  "power": {
    "pmuChips": [
      { "id": "PMU-L1", "x": 47.9, "y": 56.4 },
      { "id": "PMU-L2", "x": 55.6, "y": 68.7 },
      { "id": "PMU-L3", "x": 61.4, "y": 61.6 }
    ],
    "heroCharts": {
      "current": { "bands": [71, 85], "value": 87.4, "noteEn": "71.0 baseline", "noteAr": "\u062e\u0637 \u0627\u0644\u0623\u0633\u0627\u0633 71.0" },
      "month":   { "spark": [7.1, 8.0, 10.6, 14.0, 13.4, 18.6, 14.3], "fromEn": "Tue", "fromAr": "\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621", "toEn": "Today", "toAr": "\u0627\u0644\u064a\u0648\u0645" },
      "peak":    { "bands": [80, 95], "value": 95.2, "crit": true, "noteEn": "125 contracted", "noteAr": "\u0627\u0644\u062a\u0639\u0627\u0642\u062f\u064a 125" }
    },
    "pmus": [
      { "id": "PMU09", "db": "MCC 1", "a": null, "v": null, "hz": null, "kw": null, "kwh": null, "pf": null },
      { "id": "PMU04", "db": "MCC 2", "a": null, "v": null, "hz": null, "kw": null, "kwh": null, "pf": null },
      { "id": "PMU05", "db": "Kitchen SMDB", "a": null, "v": null, "hz": null, "kw": null, "kwh": null, "pf": null },
      { "id": "PMU06", "db": "LVFP", "a": null, "v": null, "hz": null, "kw": null, "kwh": null, "pf": null },
      { "id": "PMU07", "db": "ATS", "a": null, "v": null, "hz": null, "kw": null, "kwh": null, "pf": null },
      { "id": "PMU08", "db": "Sump pump", "a": null, "v": null, "hz": null, "kw": null, "kwh": null, "pf": null }
    ],
    /* Consumption model sub-view panel (D39, mock-verbatim figures; the
       84.2/119.0 pair is the mock's own drift vs the hero 108.25 - logged). */
    "subview": {
      "loadNowKw": 84.2, "baselineKw": 71.0, "scaleMaxKw": 130,
      "peakKw": 119.0, "limitKw": 125,
      "pf": 0.92, "pfTarget": 0.95, "pfScale": [0.90, 1.00],
      "avoidAed": 999.74, "avoidKwh": 3332,
      "zonesToday": [[504, 49], [297, 29], [144, 14], [75, 7], [2, 0.2]],
      "totalMwh": 42.6, "warnN": 2, "warnAed": 961.55
    },
    "prevMonthKwh": 61204.35,
    "contractedMw": 5.2,
    "boards": [["MCC 1",0],["MCC 2",0],["Kitchen SMDB",0],["LVFP",0],["ATS",0],["Sump pump",0]],
    "peakAvgKw": 68.8,
    /* D96 — baseline versus actual. baseline null = a gap (model refresh):
       rendered as a gap, named in the caption, never interpolated. No
       weather or occupancy adjustment is applied in this data set, and the
       caption says so. today: kWh per hour 00→13; week: MWh per day to date;
       month: MWh per day, last 30 days (today partial). */
    "bva": {
      "modelKey": "bvaModel4wk", "adjust": { "weather": false, "occupancy": false },
      "ranges": {
        "today": { "unit": "kWh", "labels": ["00","01","02","03","04","05","06","07","08","09","10","11","12","13"],
          "actual":   [2750,2710,2670,2640,2650,2730,2900,3070,3230,3370,3450,3500,3510,3490],
          "baseline": [2700,2670,2640,2620,2630,2680,2780,2860,2900,2920,2930,2920,2900,2880] },
        "week": { "unit": "MWh", "labelKeys": true, "labels": ["dayMonday","dayTuesday","dayWednesday","dayThursday","dayFriday"],
          "actual":   [63.2, 61.8, 64.9, 62.1, 42.7],
          "baseline": [66.0, 65.5, null, 66.2, 39.0] },
        "month": { "unit": "MWh", "labels": ["6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30","31","1","2","3","4"],
          "actual":   [63.1,64.2,65.0,64.6,63.9,52.1,50.4,63.3,64.0,65.8,64.9,63.2,52.6,50.9,63.8,64.4,65.1,63.9,63.0,51.8,50.2,63.5,64.6,65.4,64.7,63.6,52.3,50.7,64.9,42.7],
          "baseline": [64,65,66,65,64,53,51,64,65,66,65,64,53,51,64,65,66,65,64,53,51,64,65,66,65,64,53,51,66,39] }
      }
    },
    /* kW per 15-min sample, 00:00→14:00 (reference curve shape). */
    "peakSeries": [],
    /* Stacked kWh per hour by zone, 00→14. */
    "zones": ["Burger King","C-Store","Utility & Canopy","Car Services","Booster & Fire Pumps"],
    "zonesAr": ["Burger King","C-Store","المرافق والمظلة","خدمات السيارات","مضخات التعزيز والحريق"],
    "zoneHues": ["#4EA3E8","#F0A93B","#45C79A","#E48FC4","#A78BFA"],
    "zoneHourly": [[], [], [], [], [], []]
  },

  /* ------------------------------------------------------------------------
     ASSET REGISTER. st: ok | alarm | stale; alarm rows point at the alarm
     list (one alarm, one place). connectedTotal: fleet size in the CAFM.
     ------------------------------------------------------------------------ */
  /* ------------------------------------------------------------------------
     METERS (D96) — the ONE source for metering data quality: the Energy
     page's Meter status panel and the report engine's Data quality section
     both read this array. quality: ok | intermittent | offline | unconfirmed
     (derived from received intervals against the expected schedule);
     receivedMin: minutes since the last reading; spark7: last 7 days.
     ------------------------------------------------------------------------ */
  "meters": [
    { "id": "E-MAIN", "nameEn": "Main incomer", "nameAr": "المدخل الرئيسي", "domain": "energy", "unit": "kWh", "last": 56621.99, "lastAt": "14:00", "receivedMin": 3, "quality": "ok", "intervalsGot": 56, "intervalsTotal": 56, "uptimePct": 100, "targetPct": 99, "sparkUnit": "MWh/d", "spark7": [14.9, 15.3, 14.1, 15.8, 16.2, 15.5, 14.3] },
    { "id": "DB-L1", "nameEn": "Board meter DB-L1", "nameAr": "عداد اللوحة DB-L1", "domain": "energy", "unit": "kWh", "last": 9120, "lastAt": "14:00", "receivedMin": 1, "quality": "ok", "intervalsGot": 56, "intervalsTotal": 56, "uptimePct": 100, "targetPct": 99, "sparkUnit": "MWh/d", "spark7": [8.9, 9.2, 8.7, 9.4, 9.6, 9.1, 9.1] },
    { "id": "DB-L2", "nameEn": "Board meter DB-L2", "nameAr": "عداد اللوحة DB-L2", "domain": "energy", "unit": "kWh", "last": 7320, "lastAt": "14:00", "receivedMin": 1, "quality": "ok", "intervalsGot": 56, "intervalsTotal": 56, "uptimePct": 100, "targetPct": 99, "sparkUnit": "MWh/d", "spark7": [7.1, 7.4, 7.0, 7.5, 7.7, 7.3, 7.3] },
    { "id": "DB-L3", "nameEn": "Board meter DB-L3", "nameAr": "عداد اللوحة DB-L3", "domain": "energy", "unit": "kWh", "last": 10680, "lastAt": "14:00", "receivedMin": 1, "quality": "ok", "intervalsGot": 56, "intervalsTotal": 56, "uptimePct": 100, "targetPct": 99, "sparkUnit": "MWh/d", "spark7": [10.1, 10.4, 10.2, 10.9, 11.2, 10.8, 10.7] },
    { "id": "DB-GF", "nameEn": "Board meter DB-GF", "nameAr": "عداد اللوحة DB-GF", "domain": "energy", "unit": "kWh", "last": 6060, "lastAt": "14:00", "receivedMin": 1, "quality": "ok", "intervalsGot": 56, "intervalsTotal": 56, "uptimePct": 100, "targetPct": 99, "sparkUnit": "MWh/d", "spark7": [5.9, 6.1, 5.8, 6.2, 6.3, 6.0, 6.1] },
    { "id": "DB-RF", "nameEn": "Board meter DB-RF", "nameAr": "عداد اللوحة DB-RF", "domain": "energy", "unit": "kWh", "last": 4920, "lastAt": "14:00", "receivedMin": 1, "quality": "ok", "intervalsGot": 56, "intervalsTotal": 56, "uptimePct": 100, "targetPct": 99, "sparkUnit": "MWh/d", "spark7": [4.8, 5.0, 4.7, 5.1, 5.2, 4.9, 4.9] },
    { "id": "DB-B1", "nameEn": "Board meter DB-B1", "nameAr": "عداد اللوحة DB-B1", "domain": "energy", "unit": "kWh", "last": 5700, "lastAt": "14:00", "receivedMin": 1, "quality": "ok", "intervalsGot": 56, "intervalsTotal": 56, "uptimePct": 100, "targetPct": 99, "sparkUnit": "MWh/d", "spark7": [5.5, 5.7, 5.4, 5.8, 5.9, 5.6, 5.7] },
    { "id": "W-01", "nameEn": "Main inlet water", "nameAr": "مدخل المياه الرئيسي", "domain": "water", "unit": "m³", "last": 380, "lastAt": "14:05", "receivedMin": 8, "quality": "intermittent", "sinceEn": "08:40", "sinceAr": "08:40", "intervalsGot": 53, "intervalsTotal": 56, "uptimePct": 94.2, "targetPct": 99, "sparkUnit": "m³/d", "spark7": [15, 17, 16, 18, 14, 13, 15] },
    { "id": "W-02", "nameEn": "Irrigation", "nameAr": "الري", "domain": "water", "unit": "m³", "last": 31, "lastAt": "14:00", "receivedMin": 5, "quality": "ok", "intervalsGot": 56, "intervalsTotal": 56, "uptimePct": 99.6, "targetPct": 99, "sparkUnit": "m³/d", "spark7": [22, 24, 21, 23, 25, 27, 31] },
    { "id": "MW-03", "nameEn": "Cooling makeup", "nameAr": "مياه تعويض التبريد", "domain": "water", "unit": "m³", "last": 12.4, "lastAt": "12:00", "receivedMin": 1560, "quality": "offline", "sinceEn": "yesterday 12:00", "sinceAr": "أمس 12:00", "sinceAgeH": 26, "intervalsGot": 0, "intervalsTotal": 56, "uptimePct": 0, "targetPct": 99, "sparkUnit": "m³/d", "spark7": [12.0, 12.6, 12.1, 12.4, 12.2, 12.4, null] },
    { "id": "G-01", "nameEn": "Boiler room gas", "nameAr": "غاز غرفة الغلايات", "domain": "gas", "unit": "m³", "last": 210, "lastAt": "14:00", "receivedMin": 4, "quality": "unconfirmed", "sinceEn": "2 d", "sinceAr": "يومان", "intervalsGot": 56, "intervalsTotal": 56, "uptimePct": 100, "targetPct": 99, "sparkUnit": "m³/d", "spark7": [200, 215, 210, 230, 221, 206, 210] },
    { "id": "KG-02", "nameEn": "Kitchen main gas", "nameAr": "غاز المطبخ الرئيسي", "domain": "gas", "unit": "m³", "last": 48, "lastAt": "12:00", "receivedMin": 1560, "quality": "offline", "sinceEn": "yesterday 12:00", "sinceAr": "أمس 12:00", "sinceAgeH": 26, "intervalsGot": 0, "intervalsTotal": 56, "uptimePct": 0, "targetPct": 99, "sparkUnit": "m³/d", "spark7": [46, 49, 47, 50, 48, 48, null] }
  ],
  "registerTotal": null,
  "assets": [
    { "id": "CH-2", "sys": "hvac", "crit": "A", "wtyEnd": "2027-03-31", "tags": ["critical-plant"],        "st": "alarm", "alarms": ["al-ch2","al-cop"], "floor": "L3",  "zone": "Plant room", "zoneAr": "غرفة المحطة",    "typeEn": "Water-cooled chiller", "typeAr": "مبرد بتبريد مائي", "level": "Level 3", "levelAr": "الطابق 3", "wos": 2, "wost": "prog", "make": "Carrier 30XV", "serial": "CX-88412", "svc": "12 Aug", "cafm": "HEX-4401",
      "trend7": { "point": "Condenser approach", "unit": "K", "vals": [1.3, 1.2, 1.4, 1.9, 2.0, 2.0, 2.1] }, "params": [["Condenser approach","derived · FDD","+2.1 K · 11 d"],["COP","derived","4.1"],["Load","BMS","61 %"],["CHW supply","sensor CHWS-02","6.6 °C"]],
      "activity": [["WO-2320","Condenser inspection","today","prog"],["WO-2304","Tube cleaning","12 Aug","pend"]],
      "spark7": [0.62,0.66,0.71,0.74,0.78,0.85,0.92] },
    { "id": "AHU-L12-03", "sys": "vent", "crit": "B", "wtyEnd": "2026-11-30", "tags": [],  "st": "alarm", "alarms": ["al-ahu"], "floor": "L12", "zone": "Guest rooms W", "zoneAr": "غرف الضيوف غرب", "typeEn": "Air handling unit", "typeAr": "وحدة مناولة هواء", "level": "Level 12", "levelAr": "الطابق 12", "wos": 1, "wost": "asgn", "make": "TROX X-Cube", "serial": "TX-55102", "svc": "11 Aug", "cafm": "HEX-4402",
      "trend7": { "point": "Supply air", "unit": "°C", "vals": [0.6, 0.4, 1.1, 0.8, 1.5, 1.2, 1.8] }, "params": [["Supply air","sensor SAT-12","+1.8 °C vs SP"],["Fan speed","BMS","74 %"]],
      "activity": [["WO-2287","Coil valve check","today","asgn"]],
      "spark7": [0.55,0.56,0.6,0.63,0.66,0.7,0.72] },
    { "id": "VAV-L11-W", "sys": "vent", "crit": "C", "wtyEnd": null, "tags": [],   "st": "alarm", "alarms": ["al-vav"], "floor": "L11", "zone": "L11 West", "zoneAr": "L11 غرب", "typeEn": "VAV terminal", "typeAr": "وحدة VAV", "level": "Level 11", "levelAr": "الطابق 11", "wos": 1, "wost": "pend", "make": "TROX TVE", "serial": "TV-31877", "svc": "29 Jun", "cafm": "HEX-4403",
      "trend7": { "point": "Reheat valve", "unit": "%", "vals": [44, 58, 39, 61, 47, 62, 62] }, "params": [["Reheat valve","BMS","62 %"],["Cool demand","BMS","55 %"]],
      "activity": [],
      "spark7": [0.4,0.42,0.45,0.52,0.58,0.61,0.59] },
    { "id": "PUMP-CHW-1", "sys": "pumps", "crit": "A", "wtyEnd": "2028-01-15", "tags": ["critical-plant"],  "st": "alarm", "alarms": ["al-pump"], "floor": "L3",  "zone": "Plant room", "zoneAr": "غرفة المحطة", "typeEn": "Chilled water pump", "typeAr": "مضخة مياه مبردة", "level": "Level 3", "levelAr": "الطابق 3", "wos": 1, "wost": "asgn", "make": "Grundfos NB", "serial": "GF-20931", "svc": "29 Jun", "cafm": "HEX-4404",
      "trend7": { "point": "Starts", "unit": "/h", "vals": [6, 6, 7, 11, 10, 13, 14] }, "params": [["Starts","derived · FDD","14 / h"],["Head","sensor DP-03","182 kPa"]],
      "activity": [["WO-2331","Check staging control","today","asgn"]],
      "spark7": [0.5,0.53,0.5,0.56,0.6,0.66,0.7] },
    { "id": "EF-RF-02", "sys": "vent", "crit": "B", "wtyEnd": null, "tags": [],    "st": "alarm", "alarms": ["al-ef"], "floor": "RF",  "zone": "Roof plant", "zoneAr": "سطح المحطة", "typeEn": "Extract fan", "typeAr": "مروحة سحب", "level": "Roof", "levelAr": "السطح", "wos": 1, "wost": "prog", "make": "Systemair DV", "serial": "SA-11221", "svc": "05 Jul", "cafm": "HEX-4405",
      "trend7": { "point": "Vibration", "unit": "mm/s", "vals": [4.3, 4.2, 4.4, 4.3, 6.5, 6.9, 7.1] }, "params": [["Vibration","sensor VIB-2","7.1 mm/s"],["Speed","BMS","88 %"]],
      "activity": [["WO-2333","Bearing inspection","today","prog"]],
      "spark7": [0.32,0.33,0.31,0.33,0.34,0.32,0.33] },
    { "id": "AHU-L3-01", "sys": "vent", "crit": "B", "wtyEnd": null, "tags": [],   "st": "ok", "floor": "L3",  "zone": "West wing", "zoneAr": "الجناح الغربي", "typeEn": "Air handling unit", "typeAr": "وحدة مناولة هواء", "level": "Level 3", "levelAr": "الطابق 3", "wos": 2, "wost": "prog", "make": "TROX X-Cube", "serial": "TX-54120", "svc": "11 Aug", "cafm": "HEX-4406", "spark7": [0.5,0.52,0.51,0.53,0.5,0.52,0.51] },
    { "id": "CHILLER-L3-01", "sys": "hvac", "crit": "A", "wtyEnd": "2027-03-31", "tags": ["critical-plant"],"st": "ok", "floor": "L3", "zone": "Plant room", "zoneAr": "غرفة المحطة", "typeEn": "Water-cooled chiller", "typeAr": "مبرد بتبريد مائي", "level": "Level 3", "levelAr": "الطابق 3", "wos": 3, "wost": "pend", "make": "Carrier 30XV", "serial": "CX-88413", "svc": "12 Aug", "cafm": "HEX-4407", "spark7": [0.58,0.6,0.59,0.61,0.6,0.62,0.6] },
    { "id": "AHU-A2-RF-01", "sys": "vent", "crit": "B", "wtyEnd": null, "tags": [],"st": "ok", "floor": "RF",  "zone": "Zone A2", "zoneAr": "المنطقة A2", "typeEn": "Air handling unit", "typeAr": "وحدة مناولة هواء", "level": "Roof", "levelAr": "السطح", "wos": 1, "wost": "prog", "make": "TROX X-Cube", "serial": "TX-57209", "svc": "05 Jul", "cafm": "HEX-4408", "spark7": [0.48,0.5,0.49,0.5,0.51,0.5,0.49],
      "trend7": { "point": "RA temp", "unit": "°C", "vals": [21.2, 21.0, 21.4, 20.8, 21.1, 21.3, 21.0] }, "params": [["RA temp","sensor RAT-A2-01","21.0 °C"],["SA temp","sensor SAT-A2-01","13.0 °C"],["RA CO2","sensor CO2-A2-01","466.4 ppm"],["SA pressure","sensor SPT-A2-01","404.1 Pa"]],
      "activity": [["WO-2288","Damper synchronization check","09 Aug","prog"]],
      "controllable": true, "finImg": "/static/dashboard/assets/ref-d4e17371.png",
      "points": [
        { "id": "coil", "nameEn": "Cooling coil valve", "nameAr": "صمام ملف التبريد", "kind": "analog", "unit": "%", "value": 0, "min": 0, "max": 100, "mode": "auto", "writable": true, "lifeSafety": false, "demoTarget": 65 },
        { "id": "fan",  "nameEn": "Supply fan", "nameAr": "مروحة الإمداد", "kind": "binary", "value": "ON", "mode": "auto", "writable": false, "lifeSafety": false },
        { "id": "oad",  "nameEn": "OA damper", "nameAr": "مخمد الهواء الخارجي", "kind": "analog", "unit": "%", "value": 60, "min": 0, "max": 100, "mode": "auto", "writable": true, "lifeSafety": false, "mockFailOnce": true },
        { "id": "tsp",  "nameEn": "Temp setpoint", "nameAr": "نقطة ضبط الحرارة", "kind": "analog", "unit": "°C", "value": 22.0, "dp": 1, "min": 18, "max": 26, "mode": "manual", "writable": true, "lifeSafety": false,
          "override": { "byEn": "S. Khan", "byAr": "س. خان", "whenEn": "09 Aug", "whenAr": "09 أغسطس", "expEn": "expires in 3 days", "expAr": "تنتهي خلال 3 أيام" } }
      ] },
    { "id": "FCU-L1-02", "sys": "vent", "crit": "C", "wtyEnd": null, "tags": [],   "st": "stale", "staleH": 26, "floor": "L1", "zone": "Kitchen", "zoneAr": "المطبخ", "typeEn": "Fan coil unit", "typeAr": "وحدة ملف مروحة", "level": "Level 1", "levelAr": "الطابق 1", "wos": 1, "wost": "asgn", "make": "Daikin FWB", "serial": "DK-77120", "svc": "10 Aug", "cafm": "HEX-4409", "spark7": null },
    { "id": "VAV-L2-03", "sys": "vent", "crit": "C", "wtyEnd": null, "tags": [],   "st": "stale", "staleH": 26, "floor": "L2", "zone": "Guest rooms W", "zoneAr": "غرف الضيوف غرب", "typeEn": "VAV terminal", "typeAr": "وحدة VAV", "level": "Level 2", "levelAr": "الطابق 2", "wos": 0, "wost": null, "make": "TROX TVE", "serial": "TV-30455", "svc": "–", "cafm": "HEX-4410", "spark7": null },
    { "id": "FCU-GF-01", "sys": "vent", "crit": "C", "wtyEnd": null, "tags": [],   "st": "ok", "floor": "GF",  "zone": "Lobby", "zoneAr": "البهو", "typeEn": "Fan coil unit", "typeAr": "وحدة ملف مروحة", "level": "Ground", "levelAr": "الأرضي", "wos": 0, "wost": "done", "make": "Daikin FWB", "serial": "DK-76001", "svc": "12 Aug", "cafm": "HEX-4411", "spark7": [0.45,0.46,0.44,0.45,0.47,0.45,0.44] },
    { "id": "FCU-GF-02", "sys": "vent", "crit": "C", "wtyEnd": null, "tags": [],   "st": "ok", "floor": "GF",  "zone": "Back office", "zoneAr": "المكتب الخلفي", "typeEn": "Fan coil unit", "typeAr": "وحدة ملف مروحة", "level": "Ground", "levelAr": "الأرضي", "wos": 0, "wost": null, "make": "Daikin FWB", "serial": "DK-76002", "svc": "–", "cafm": "HEX-4412", "spark7": [0.4,0.41,0.42,0.4,0.41,0.4,0.42] },
    { "id": "FCU-L1-01", "sys": "vent", "crit": "C", "wtyEnd": null, "tags": [],   "st": "ok", "floor": "L1",  "zone": "Dining", "zoneAr": "المطعم", "typeEn": "Fan coil unit", "typeAr": "وحدة ملف مروحة", "level": "Level 1", "levelAr": "الطابق 1", "wos": 0, "wost": null, "make": "Daikin FWB", "serial": "DK-76103", "svc": "–", "cafm": "HEX-4413", "spark7": [0.5,0.52,0.55,0.53,0.5,0.54,0.52] },
    { "id": "FCU-L2-01", "sys": "vent", "crit": "C", "wtyEnd": null, "tags": [],   "st": "ok", "floor": "L2",  "zone": "Guest rooms E", "zoneAr": "غرف الضيوف شرق", "typeEn": "Fan coil unit", "typeAr": "وحدة ملف مروحة", "level": "Level 2", "levelAr": "الطابق 2", "wos": 1, "wost": "asgn", "make": "Daikin FWB", "serial": "DK-76210", "svc": "26 Jul", "cafm": "HEX-4414", "spark7": [0.44,0.45,0.43,0.44,0.46,0.44,0.45] },
    { "id": "AHU-GF-01", "sys": "vent", "crit": "B", "wtyEnd": null, "tags": ["events"],   "st": "ok", "floor": "GF",  "zone": "Ballroom", "zoneAr": "قاعة الاحتفالات", "typeEn": "Air handling unit", "typeAr": "وحدة مناولة هواء", "level": "Ground", "levelAr": "الأرضي", "wos": 1, "wost": "pend", "make": "TROX X-Cube", "serial": "TX-53001", "svc": "22 Jun", "cafm": "HEX-4415", "spark7": [0.6,0.35,0.34,0.62,0.64,0.33,0.35] },
    { "id": "AHU-L2-01", "sys": "vent", "crit": "B", "wtyEnd": null, "tags": [],   "st": "ok", "floor": "L2",  "zone": "Guest rooms E", "zoneAr": "غرف الضيوف شرق", "typeEn": "Air handling unit", "typeAr": "وحدة مناولة هواء", "level": "Level 2", "levelAr": "الطابق 2", "wos": 0, "wost": null, "make": "TROX X-Cube", "serial": "TX-53988", "svc": "–", "cafm": "HEX-4416", "spark7": [0.5,0.5,0.51,0.5,0.52,0.5,0.51] },
    { "id": "VAV-L2-04", "sys": "vent", "crit": "C", "wtyEnd": null, "tags": [],   "st": "ok", "floor": "L2",  "zone": "Guest rooms W", "zoneAr": "غرف الضيوف غرب", "typeEn": "VAV terminal", "typeAr": "وحدة VAV", "level": "Level 2", "levelAr": "الطابق 2", "wos": 0, "wost": null, "make": "TROX TVE", "serial": "TV-30460", "svc": "–", "cafm": "HEX-4417", "spark7": [0.38,0.39,0.4,0.38,0.39,0.4,0.39] },
    { "id": "VAV-L3-01", "sys": "vent", "crit": "C", "wtyEnd": null, "tags": [],   "st": "ok", "floor": "L3",  "zone": "West wing", "zoneAr": "الجناح الغربي", "typeEn": "VAV terminal", "typeAr": "وحدة VAV", "level": "Level 3", "levelAr": "الطابق 3", "wos": 0, "wost": null, "make": "TROX TVE", "serial": "TV-30990", "svc": "–", "cafm": "HEX-4418", "spark7": [0.42,0.41,0.43,0.42,0.44,0.42,0.41] },
    { "id": "VAV-L3-03", "sys": "vent", "crit": "C", "wtyEnd": null, "tags": [],   "st": "ok", "floor": "L3",  "zone": "East wing", "zoneAr": "الجناح الشرقي", "typeEn": "VAV terminal", "typeAr": "وحدة VAV", "level": "Level 3", "levelAr": "الطابق 3", "wos": 0, "wost": null, "make": "TROX TVE", "serial": "TV-31002", "svc": "–", "cafm": "HEX-4419", "spark7": [0.41,0.42,0.41,0.43,0.41,0.42,0.43] },
    { "id": "PUMP-CHW-2", "sys": "pumps", "crit": "B", "wtyEnd": null, "tags": [],  "st": "ok", "floor": "L3",  "zone": "Plant room", "zoneAr": "غرفة المحطة", "typeEn": "Chilled water pump", "typeAr": "مضخة مياه مبردة", "level": "Level 3", "levelAr": "الطابق 3", "wos": 0, "wost": null, "make": "Grundfos NB", "serial": "GF-20932", "svc": "–", "cafm": "HEX-4420", "spark7": [0.5,0.51,0.5,0.52,0.5,0.51,0.5] },
    { "id": "EF-RF-01", "sys": "vent", "crit": "B", "wtyEnd": null, "tags": [],    "st": "ok", "floor": "RF",  "zone": "Roof plant", "zoneAr": "سطح المحطة", "typeEn": "Extract fan", "typeAr": "مروحة سحب", "level": "Roof", "levelAr": "السطح", "wos": 0, "wost": null, "make": "Systemair DV", "serial": "SA-11220", "svc": "–", "cafm": "HEX-4421", "spark7": [0.3,0.31,0.3,0.32,0.31,0.3,0.31] },
    { "id": "DB-L3-2", "sys": "elec", "crit": "A", "wtyEnd": "2029-05-31", "tags": [],  "st": "alarm", "alarms": ["al-db"],  "floor": "L3", "zone": "Plant room", "zoneAr": "غرفة المحطة",   "typeEn": "Distribution board", "typeAr": "لوحة توزيع", "level": "Level 3", "levelAr": "الطابق 3", "wos": 1, "wost": "asgn", "make": "Schneider Prisma", "serial": "SP-30412", "svc": "18 Jul", "cafm": "HEX-4422",
      "trend7": { "point": "Phase imbalance", "unit": "%", "vals": [3.1, 3.6, 3.5, 4.4, 4.9, 5.4, 5.9] }, "params": [["Phase imbalance","derived","5.9 %"],["Load","meter","64 %"]], "activity": [["WO-2338","Phase rebalance","today","asgn"]], "spark7": [0.5,0.52,0.55,0.58,0.6,0.62,0.64] },
    { "id": "UPS-01", "sys": "elec", "crit": "B", "wtyEnd": "2026-10-01", "tags": [],   "st": "alarm", "alarms": ["al-ups"], "floor": "GF", "zone": "Server room", "zoneAr": "غرفة الخوادم",  "typeEn": "UPS", "typeAr": "وحدة UPS", "level": "Ground", "levelAr": "الأرضي", "wos": 1, "wost": "pend", "make": "Eaton 93PM", "serial": "ET-11007", "svc": "02 Jun", "cafm": "HEX-4423",
      "trendKind": "state", "params": [["Battery test","schedule","overdue 2 d"],["Load","BMS","41 %"]], "activity": [], "spark7": [0.4,0.4,0.41,0.4,0.42,0.41,0.4] },
    { "id": "FD-L2-14", "sys": "fire", "crit": "A", "wtyEnd": "2026-12-31", "tags": ["life-safety"], "st": "alarm", "alarms": ["al-fd"],  "floor": "L2", "zone": "Guest rooms E", "zoneAr": "غرف الضيوف شرق","typeEn": "Smoke detector", "typeAr": "كاشف دخان", "level": "Level 2", "levelAr": "الطابق 2", "wos": 1, "wost": "asgn", "make": "Siemens FDA", "serial": "SI-88231", "svc": "14 Aug", "cafm": "HEX-4424",
      "trendKind": "state", "params": [["Heartbeat","panel","offline 5 h"]], "activity": [["WO-2339","Detector check","today","asgn"]], "spark7": null },
    { "id": "SPK-Z3", "sys": "fire", "crit": "A", "wtyEnd": null, "tags": ["life-safety"],   "st": "alarm", "alarms": ["al-spk"], "floor": "GF", "zone": "Podium", "zoneAr": "البوديوم",       "typeEn": "Sprinkler zone", "typeAr": "منطقة رشاشات", "level": "Ground", "levelAr": "الأرضي", "wos": 1, "wost": "pend", "make": "Viking VK", "serial": "VK-20114", "svc": "30 Jul", "cafm": "HEX-4425",
      "trend7": { "point": "Pressure", "unit": "bar", "vals": [7.0, 6.9, 6.7, 7.1, 6.6, 6.4, 6.2] }, "params": [["Pressure","sensor SP-3","6.2 bar"],["Nominal","design","7.5 bar"]], "activity": [], "spark7": null },
    { "id": "CAM-P07", "sys": "sec", "crit": "B", "wtyEnd": "2027-06-30", "tags": ["security"],  "st": "alarm", "alarms": ["al-cam"], "floor": "GF", "zone": "Podium entrance", "zoneAr": "مدخل البوديوم", "typeEn": "CCTV camera", "typeAr": "كاميرا مراقبة", "level": "Ground", "levelAr": "الأرضي", "wos": 1, "wost": "asgn", "make": "Axis P32", "serial": "AX-70992", "svc": "22 Aug", "cafm": "HEX-4426",
      "trendKind": "state", "params": [["Stream","VMS","offline 7 h"]], "activity": [["WO-2340","Camera reset","today","asgn"]], "spark7": null },
    { "id": "DR-S12", "sys": "sec", "crit": "C", "wtyEnd": null, "tags": [],   "st": "alarm", "alarms": ["al-dr"],  "floor": "GF", "zone": "Loading bay", "zoneAr": "منطقة التحميل",  "typeEn": "Access door", "typeAr": "باب تحكم بالدخول", "level": "Ground", "levelAr": "الأرضي", "wos": 0, "wost": null, "make": "ASSA ABLOY", "serial": "AA-51230", "svc": "–", "cafm": "HEX-4427",
      "trendKind": "state", "params": [["State","controller","held open 22 m"]], "activity": [], "spark7": null },
    { "id": "CT-RF-01", "sys": "hvac", "crit": "B", "wtyEnd": null, "tags": [],    "st": "ok", "floor": "RF",  "zone": "Roof plant", "zoneAr": "سطح المحطة", "typeEn": "Cooling tower", "typeAr": "برج تبريد", "level": "Roof", "levelAr": "السطح", "wos": 0, "wost": null, "make": "BAC S3000", "serial": "BC-40011", "svc": "–", "cafm": "HEX-4428", "spark7": [0.44,0.45,0.44,0.46,0.45,0.44,0.45] }
  ],


  /* Module-highlight row headlines (module landing panels). */
  "landing": {
    "water": { "headEn": "--", "headAr": "--" },
    "gas":   { "headEn": "--", "headAr": "--" },
    "heat":  { "headEn": "--", "headAr": "--" },
    "reg":   { "headEn": "--", "headAr": "--" }
  },

  /* ------------------------------------------------------------------------
     SYSTEMS module — four groups; alarm counts DERIVE from the alarm list
     via sysKey. Card kinds: stat, gauge (own min/max), donut, tiles, trend.
     ------------------------------------------------------------------------ */
  "systems": {
    "groups": [
      { "id": "hvac", "hue": "#C56A6A", "sysKey": ["HVAC", "Mechanical"], "labelEn": "HVAC & Mechanical", "labelAr": "التكييف والميكانيكا",
        "cards": [
          { "kind": "stat", "labelEn": "OVERALL HEALTH", "labelAr": "\u0627\u0644\u062d\u0627\u0644\u0629 \u0627\u0644\u0639\u0627\u0645\u0629", "v": null, "u": "%", "capEn": null, "capAr": null, "tone": "ok" },
          { "kind": "stat", "labelEn": "HVAC EQUIPMENT", "labelAr": "معدات التكييف", "v": null, "u": "", "capEn": null, "capAr": null, "chipEn": null, "chipAr": null, "tone": "ok" },
          { "kind": "stat", "subOnly": true, "labelEn": "TEMPERATURE DEVIATION INDEX", "labelAr": "مؤشر انحراف الحرارة", "v": null, "u": "°C", "capEn": null, "capAr": null, "tone": "ok" },
          { "kind": "stat", "subOnly": true, "labelEn": "ENERGY PERFORMANCE", "labelAr": "نسبة أداء الطاقة", "v": null, "u": "", "capEn": null, "capAr": null, "tone": "ok" },
          { "kind": "stat", "subOnly": true, "labelEn": "COMFORT ENERGY INDEX", "labelAr": "مؤشر طاقة الراحة", "v": null, "u": "", "capEn": null, "capAr": null, "tone": "ok" }
          ] },
      { "id": "electrical", "hue": "#C2955A", "sysKey": ["Electrical"], "labelEn": "Electrical", "labelAr": "الكهرباء",
        "cards": [
          { "kind": "stat", "labelEn": "OVERALL HEALTH", "labelAr": "\u0627\u0644\u062d\u0627\u0644\u0629 \u0627\u0644\u0639\u0627\u0645\u0629", "v": null, "u": "%", "capEn": null, "capAr": null, "tone": "ok" },
          { "kind": "stat", "labelEn": "ELECTRICAL EQUIPMENT", "labelAr": "المعدات الكهربائية", "v": null, "u": "", "capEn": null, "capAr": null, "chipEn": null, "chipAr": null, "tone": "ok" } ,
          { "kind": "stat", "subOnly": true, "labelEn": "ENERGY DEVIATION", "labelAr": "انحراف الطاقة", "v": null, "u": "%", "capEn": null, "capAr": null, "tone": "ok" },
          { "kind": "stat", "subOnly": true, "labelEn": "LOAD IMBALANCE INDEX", "labelAr": "مؤشر عدم اتزان الأحمال", "v": null, "u": "%", "capEn": null, "capAr": null, "tone": "ok" },
          { "kind": "stat", "subOnly": true, "labelEn": "LOAD FACTOR", "labelAr": "معامل الحمل", "v": null, "u": "%", "capEn": null, "capAr": null, "tone": "ok" },
          { "kind": "stat", "subOnly": true, "labelEn": "PEAK DEMAND", "labelAr": "ذروة الطلب", "v": null, "u": "kW", "capEn": null, "capAr": null, "tone": "ok" } ] },
      { "id": "life", "hue": "#5FA8D3", "sysKey": ["Life safety"], "labelEn": "Life & Safety", "labelAr": "السلامة",
        "cards": [
          { "kind": "stat", "labelEn": "OVERALL HEALTH", "labelAr": "\u0627\u0644\u062d\u0627\u0644\u0629 \u0627\u0644\u0639\u0627\u0645\u0629", "v": "97.3", "u": "%", "capEn": "Healthy", "capAr": "\u0633\u0644\u064a\u0645", "tone": "ok" },
          { "kind": "stat", "wash": "warn", "labelEn": "SMOKE DETECTORS ONLINE", "labelAr": "كواشف الدخان المتصلة", "v": "142 / 146", "u": "", "capEn": "Total: 146", "capAr": "الإجمالي: 146", "chipEn": "4 offline", "chipAr": "4 غير متصلة", "tone": "warn" } ,
          { "kind": "gauge", "subOnly": true, "labelEn": "FIRE SYSTEM HEALTH", "labelAr": "صحة نظام الحريق", "val": 98.2, "min": 0, "max": 100, "u": "%", "wordEn": "Normal", "wordAr": "طبيعي", "tone": "ok" },
          { "kind": "gauge", "subOnly": true, "labelEn": "SPRINKLER PRESSURE", "labelAr": "ضغط الرشاشات", "val": 6.2, "min": 0, "max": 10, "u": "bar", "wordEn": "Nominal", "wordAr": "اسمي", "tone": "ok" },
          { "kind": "donut", "subOnly": true, "labelEn": "EMERGENCY LIGHTING", "labelAr": "إنارة الطوارئ", "pct": 96.4, "wordEn": "Compliant", "wordAr": "مطابِقة", "tone": "ok" },
          { "kind": "stat", "subOnly": true, "labelEn": "EGRESS ROUTES", "labelAr": "مسارات الإخلاء", "v": "12 / 12", "u": "", "capEn": "All clear", "capAr": "كلها سالكة", "tone": "ok" } ] },
      { "id": "security", "hue": "#9B8AD4", "sysKey": ["Security"], "labelEn": "Security", "labelAr": "الأمن",
        "cards": [
          { "kind": "stat", "labelEn": "OVERALL HEALTH", "labelAr": "\u0627\u0644\u062d\u0627\u0644\u0629 \u0627\u0644\u0639\u0627\u0645\u0629", "v": "95.8", "u": "%", "capEn": "Healthy", "capAr": "\u0633\u0644\u064a\u0645", "tone": "ok" },
          { "kind": "stat", "wash": "warn", "labelEn": "CAMERAS ONLINE", "labelAr": "الكاميرات المتصلة", "v": "92 / 96", "u": "", "capEn": "Total: 96", "capAr": "الإجمالي: 96", "chipEn": "4 offline", "chipAr": "4 غير متصلة", "tone": "warn" },
          { "kind": "gauge", "subOnly": true, "labelEn": "ACCESS CONTROL HEALTH", "labelAr": "صحة التحكم في الوصول", "val": 99.1, "min": 0, "max": 100, "u": "%", "wordEn": "Normal", "wordAr": "طبيعي", "tone": "ok" },
          { "kind": "gauge", "subOnly": true, "labelEn": "BADGE READ SUCCESS", "labelAr": "نجاح قراءة البطاقات", "val": 97.8, "min": 0, "max": 100, "u": "%", "wordEn": "Healthy", "wordAr": "سليم", "tone": "ok" },
          { "kind": "donut", "subOnly": true, "labelEn": "PERIMETER INTEGRITY", "labelAr": "سلامة المحيط", "pct": 100, "wordEn": "Secure", "wordAr": "آمن", "tone": "ok" },
          { "kind": "stat", "subOnly": true, "labelEn": "FORCED / HELD DOORS", "labelAr": "أبواب مفتوحة قسرًا / محتجزة", "v": "3", "u": "", "capEn": "Today", "capAr": "اليوم", "tone": "warn" } ] }
    ]
  },

  /* System Benchmark. */
  "bench": {
    "siteWhm2": 85, "highestEn": "HVAC", "highestNote": "+9% above typical", "highestNoteAr": "‎+9% فوق المعتاد",
    "inBand": "2/4", "inBandListEn": "Lighting · Small power", "inBandListAr": "الإنارة · الأحمال الصغيرة",
    "rows": [
      { "sysEn": "HVAC", "sysAr": "التكييف", "whm2": 46, "bandLo": 38, "bandHi": 44, "noteEn": "+5% above typical", "noteAr": "‎+5% فوق المعتاد", "out": true },
      { "sysEn": "Lighting", "sysAr": "الإنارة", "whm2": 18, "bandLo": 16, "bandHi": 21, "noteEn": "in band", "noteAr": "ضمن النطاق", "out": false },
      { "sysEn": "Small power", "sysAr": "الأحمال الصغيرة", "whm2": 12, "bandLo": 10, "bandHi": 14, "noteEn": "in band", "noteAr": "ضمن النطاق", "out": false },
      { "sysEn": "Pumps", "sysAr": "المضخات", "whm2": 9, "bandLo": 6, "bandHi": 8, "noteEn": "+13% above typical", "noteAr": "‎+13% فوق المعتاد", "out": true } ]
  },

  /* Anomalies. flaggedKwhToday/avoidable derive costs from basis.aedPerKwh. */
  "anom": {
    "flaggedKwhToday": 142, "pointsMapped": 418, "pointsOnline": 412,
    "modelEn": "4-week seasonal band", "modelAr": "نطاق موسمي 4 أسابيع", "lastRefreshEn": "today 04:00", "lastRefreshAr": "اليوم 04:00",
    "items": [
      { "id": "AN-0231", "sevEn": "critical", "titleEn": "Pump short-cycling", "titleAr": "تشغيل متقطع للمضخة", "mag": "14/h", "zone": "Booster & Fire Pumps", "zoneAr": "مضخات التعزيز والحريق",
        "bodyEn": "starting 14 times per hour since 02:10, expected under 4 · detected today 02:14",
        "bodyAr": "تشتغل 14 مرة في الساعة منذ 02:10 والمتوقع أقل من 4 · رُصدت اليوم 02:14", "kwhMtd": 38.0 },
      { "id": "AN-0228", "sevEn": "warning", "titleEn": "Overnight base load above band", "titleAr": "حمل الليل فوق النطاق", "mag": "+38%", "zone": "C-Store", "zoneAr": "C-Store",
        "bodyEn": "00:00-06:00 mean 16.4 kW against an expected band of 10.5-12.6 kW · detected today 06:05",
        "bodyAr": "متوسط 00:00-06:00 هو 16.4 ك.و مقابل نطاق متوقع 10.5-12.6 · رُصد اليوم 06:05", "kwhMtd": 1532.8 },
      { "id": "AN-0224", "sevEn": "watch", "titleEn": "Weekly trend drift", "titleAr": "انحراف الاتجاه الأسبوعي", "mag": "+17%", "zone": "Car Services", "zoneAr": "خدمات السيارات",
        "bodyEn": "7-day mean creeping above the 4-week reference, no single-day breach · detected Mon 08:00",
        "bodyAr": "متوسط 7 أيام يرتفع فوق مرجع 4 أسابيع دون تجاوز يومي · رُصد الاثنين 08:00", "kwhMtd": 206.0 } ],
    "evidence": { "id": "AN-0228", "windowEn": "00:00-06:00 · kW, 15-min mean", "windowAr": "00:00-06:00 · kW، متوسط 15 دقيقة", "yMax": 35, "yMid": 18,
      "expected": [11,11.5,12,11.8,11.2,10.8,11,12,14,18,22,25,27,28,27,26,25,24,23,22,20,17,14,12],
      "actual":   [16.2,16.5,16.8,16.4,16.1,15.9,14,13.5,14.5,18.5,22.4,25.2,27.1,28.3,27.2,26.1,25.3,24.2,23.1,22.4,20.2,17.3,14.6,13.1],
      "detectFrom": 0, "detectTo": 6 },
    "todGen": "snapshot",   /* D135: the fixed snapshot below (todDate, pct). D117 derived the grid from a hash of today's date, which invented numbers that changed daily with no source; a live FDD feed replaces this block */
    "todDate": "02/09/2026",
    "todParts": [
      { "en": "Early Morning", "ar": "\u0627\u0644\u0635\u0628\u0627\u062d \u0627\u0644\u0628\u0627\u0643\u0631", "range": "00:00-06:00", "pct": 9 },
      { "en": "Morning", "ar": "\u0627\u0644\u0635\u0628\u0627\u062d", "range": "06:00-11:00", "pct": 14 },
      { "en": "Afternoon", "ar": "\u0628\u0639\u062f \u0627\u0644\u0638\u0647\u0631", "range": "11:00-15:00", "pct": 28 },
      { "en": "Evening", "ar": "\u0627\u0644\u0645\u0633\u0627\u0621", "range": "15:00-19:00", "pct": 35 },
      { "en": "Night", "ar": "\u0627\u0644\u0644\u064a\u0644", "range": "19:00-24:00", "pct": 3 } ]
  },

  /* Forecasting. */
  "fcst": {
    "peakDayEn": "Thu", "peakDayAr": "الخميس", "peakMwh": 76.8, "peakPct": 8,
    "monthEndMwh": 1190, "basisEn": "Seasonal", "basisAr": "موسمي",
    "days": [["Wed",68,63,74],["Thu",76.8,70,83],["Fri",71,66,77],["Sat",58,53,63],["Sun",55,50,60],["Mon",69,64,75],["Tue",70,65,76]],
    "daysAr": ["الأربعاء","الخميس","الجمعة","السبت","الأحد","الاثنين","الثلاثاء"]
  },

  /* Water page. Live consumption from FIN; tank/leak/meter stay empty. */
  "water": {
    "todayM3": null, "avgDrawM3Day": null,
    "tankCapacityM3": null, "tankVolumeM3": null, "refillThresholdPct": null,
    "sparkToday": [],
    "lastRefillEn": null, "refillsMonth": null, "supplyEn": null, "supplyAr": null,
    "leak": { "nightsCollected": null, "nightsNeeded": null },
    "meter": { "id": null, "uptimePct": null, "targetPct": null, "intervalsGot": null, "intervalsTotal": null,
               "resetsMonth": null, "resetDateEn": null, "lastReadingEn": null, "signalEn": null, "signalAr": null },
    "alarms": []
  },

  /* Gas page. */
  "gas": {
    "todayM3": null, "avg7M3": null, "mtdM3": null,
    "daily14": [],
    "daily14StartDay": 1,
    "meterEn": null, "meterAr": null, "sourceEn": null, "sourceAr": null,
    "tariffAedM3": null,
    "alarms": []
  },


  /* Spaces. */
  "spaces": {
    "comfortPct": null, "occupiedPct": null, "occPeakEn": null, "occPeakAr": null,
    "ieq": null, "ieqCapEn": null, "ieqCapAr": null
  },

  "heat": {
    "siteKwhToday": null,
    "floors": ["All"],
    "zones": [
      { "nameEn": "IAQ-01", "nameAr": "IAQ-01", "floor": "", "kind": "iaq", "rect": [12,22,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] },
      { "nameEn": "IAQ-02", "nameAr": "IAQ-02", "floor": "", "kind": "iaq", "rect": [32,22,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] },
      { "nameEn": "IAQ-03", "nameAr": "IAQ-03", "floor": "", "kind": "iaq", "rect": [52,22,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] },
      { "nameEn": "IAQ-04", "nameAr": "IAQ-04", "floor": "", "kind": "iaq", "rect": [72,22,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] },
      { "nameEn": "IS-01", "nameAr": "IS-01", "floor": "", "kind": "is", "rect": [12,40,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] },
      { "nameEn": "IS-02", "nameAr": "IS-02", "floor": "", "kind": "is", "rect": [32,40,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] },
      { "nameEn": "IS-03", "nameAr": "IS-03", "floor": "", "kind": "is", "rect": [52,40,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] },
      { "nameEn": "IS-04", "nameAr": "IS-04", "floor": "", "kind": "is", "rect": [72,40,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] },
      { "nameEn": "IS-05", "nameAr": "IS-05", "floor": "", "kind": "is", "rect": [12,58,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] },
      { "nameEn": "IS-06", "nameAr": "IS-06", "floor": "", "kind": "is", "rect": [32,58,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] },
      { "nameEn": "IS-07", "nameAr": "IS-07", "floor": "", "kind": "is", "rect": [52,58,16,12], "tempC": null, "rh": null, "co2": null, "hours": [] }
    ],
    "comfortDetail": []
  },

  /* Viewer config. "engine" is THE one config line that picks the adapter. */
  "viewer": {
    "engine": "host",
    "scene": {
      "images": {
        "photo":   "/static/dashboard/assets/scene/marsa-photo.png",
        "real":    "/static/dashboard/assets/scene/marsa-real.jpg",
        "minimal": "/static/dashboard/assets/scene/marsa-minimal.jpg",
        "xray":    "/static/dashboard/assets/scene/marsa-xray.jpg"
      },
      "fragments": "/static/dashboard/assets/scene/marsa.frag"
    },
    "levels": ["Roof","L12","L11","L3","L1","GF","B1"],
    "layers": ["all","arch","elec","int","mech","str"],
    "styles": ["default","photo","minimal","xray"],
    "xrayTones": ["gray","bluegray","dot","sepia"],
    "defaultStyle": "default"
  },
};

/* the site list lives in js/data/portfolio.js (D103): one source of sites for the shell and the estate */