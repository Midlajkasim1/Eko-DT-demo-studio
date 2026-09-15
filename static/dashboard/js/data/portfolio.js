/* ============================================================================
   ESTATE FIXTURES (D103) — the portfolio layer's data. Two sets:
     estate.sites      the demo estate (14 sites, mixed verticals) used by the
                       product demo and the acceptance run
     estate.generated  the recipe for the 1,000-site test set, built on demand
                       by EKO_DATA.estateGen() (deterministic, seeded) and
                       selected with ?estate=1000 — never mixed with the demo
   Times are offsets in minutes from "now" so the reporting states stay true
   whenever the prototype is opened. No number in this file is a UI string.
   ============================================================================ */
window.EKO_DATA = window.EKO_DATA || {};
window.EKO_DATA.estate = {
  "config": { "coverageThreshold": 90, "pageSize": 50, "offlineFactorDefault": 3, "clusterRadius": 26, "mapPadPct": 10, "pueMinMonths": 12, "complianceBands": { "ok": 95, "mid": 80 },
    /* the estate period: independent of the site timeline window. Energy per period is derived from each site's
       month-to-date figure with a per-type factor and a small per-site variation (fixture recipe, not a live feed);
       a period needs at least minMonths of history or the site is excluded by name. Custom needs the history feed. */
    "periods": { "ids": ["today", "mtd", "lastMonth", "last12", "custom"], "default": "mtd", "minMonths": { "today": 0, "mtd": 0, "lastMonth": 2, "last12": 12 },
      "factors": { "hotel": { "today": 0.27, "mtd": 1, "lastMonth": 7.4, "last12": 86 }, "datacentre": { "today": 0.26, "mtd": 1, "lastMonth": 7.6, "last12": 90 },
                   "fuel": { "today": 0.25, "mtd": 1, "lastMonth": 7.2, "last12": 84 }, "restaurant": { "today": 0.28, "mtd": 1, "lastMonth": 7.5, "last12": 88 } },
      "jitterPct": 8 } },
  "regions": [ { "id": "uae", "en": "UAE", "ar": "الإمارات" }, { "id": "ksa", "en": "Saudi Arabia", "ar": "السعودية" } ],
  "clusters": [
    { "id": "dubai",    "region": "uae", "en": "Dubai",     "ar": "دبي",     "lat": 25.20, "lon": 55.27 },
    { "id": "abudhabi", "region": "uae", "en": "Abu Dhabi", "ar": "أبوظبي",  "lat": 24.45, "lon": 54.38 },
    { "id": "sharjah",  "region": "uae", "en": "Sharjah",   "ar": "الشارقة", "lat": 25.35, "lon": 55.40 },
    { "id": "riyadh",   "region": "ksa", "en": "Riyadh",    "ar": "الرياض",  "lat": 24.71, "lon": 46.68 },
    { "id": "jeddah",   "region": "ksa", "en": "Jeddah",    "ar": "جدة",     "lat": 21.54, "lon": 39.17 }
  ],
  "types": {
    "hotel":      { "vertical": "hospitality", "icon": "home",  "en": "Hotel",        "ar": "فندق" },
    "datacentre": { "vertical": "datacentre",  "icon": "grid",  "en": "Data centre",  "ar": "مركز بيانات" },
    "fuel":       { "vertical": "retail",      "icon": "flame",  "en": "Fuel station", "ar": "محطة وقود" },
    "restaurant": { "vertical": "retail",      "icon": "doc",   "en": "Restaurant",   "ar": "مطعم" }
  },
  "verticals": { "hospitality": { "en": "Hospitality", "ar": "الضيافة" }, "datacentre": { "en": "Data centres", "ar": "مراكز البيانات" }, "retail": { "en": "Retail & fuel", "ar": "التجزئة والوقود" } },
  "sites": [
    { "key": "marsa", "meters": { "n": 12, "ok": 9, "intermittent": 1, "offline": 2, "unconfirmed": 0 },  "nameEn": "Marsa Al Arab",       "nameAr": "مرسى العرب",         "cluster": "dubai",    "type": "hotel", "open": true,  "lat": 25.138, "lon": 55.185, "floorArea": 48000, "monthsOfData": 19, "energyMtdKwh": 612000, "wos": { "open": 9, "overdue": 2 }, "pmDone": 46, "pmDue": 48, "hbAgoMin": 1, "sampleAgoMin": 3, "intervalMin": 15, "sourcesDown": [], "tags": ["flagship", "resort"] },
    { "key": "p2", "meters": { "n": 8, "ok": 8, "intermittent": 0, "offline": 0, "unconfirmed": 0 },     "nameEn": "Property Two",        "nameAr": "العقار الثاني",      "cluster": "dubai",    "type": "hotel", "open": false, "lat": 25.076, "lon": 55.132, "floorArea": 31000, "monthsOfData": 14, "energyMtdKwh": 401000, "alarms": { "critical": 0, "high": 2, "medium": 1 }, "unacked": 2, "wos": { "open": 5, "overdue": 1 }, "pmDone": 40, "pmDue": 44, "hbAgoMin": 2, "sampleAgoMin": 6, "intervalMin": 15, "sourcesDown": [], "tags": ["city"] },
    { "key": "p3", "meters": { "n": 7, "ok": 4, "intermittent": 2, "offline": 0, "unconfirmed": 1 },     "nameEn": "Property Three",      "nameAr": "العقار الثالث",      "cluster": "abudhabi", "type": "hotel", "open": false, "lat": 24.462, "lon": 54.320, "floorArea": 26000, "monthsOfData": 11, "energyMtdKwh": 355000, "alarms": { "critical": 1, "high": 1, "medium": 0 }, "unacked": 1, "wos": { "open": 4, "overdue": 3 }, "pmDone": 30, "pmDue": 41, "hbAgoMin": 4, "sampleAgoMin": 52, "intervalMin": 15, "sourcesDown": [], "tags": ["beach"] },
    { "key": "p4", "meters": { "n": 6, "ok": 6, "intermittent": 0, "offline": 0, "unconfirmed": 0 },     "nameEn": "Property Four",       "nameAr": "العقار الرابع",      "cluster": "riyadh",   "type": "hotel", "open": false, "lat": 24.690, "lon": 46.685, "floorArea": 22000, "monthsOfData": 9,  "energyMtdKwh": 302000, "alarms": { "critical": 0, "high": 0, "medium": 2 }, "unacked": 0, "wos": { "open": 2, "overdue": 0 }, "pmDone": 38, "pmDue": 39, "hbAgoMin": 3, "sampleAgoMin": 9, "intervalMin": 15, "sourcesDown": [], "tags": ["business"] },
    { "key": "kz-auh1", "meters": { "n": 24, "ok": 24, "intermittent": 0, "offline": 0, "unconfirmed": 0 },"nameEn": "Khazna AUH-1",        "nameAr": "خزنة أبوظبي 1",      "cluster": "abudhabi", "type": "datacentre", "open": false, "lat": 24.428, "lon": 54.605, "floorArea": 12000, "itLoadKw": 4200, "monthsOfData": 18, "energyMtdKwh": 1310000, "facilityKwh": 16400000, "itKwh": 12420000, "alarms": { "critical": 0, "high": 1, "medium": 3 }, "unacked": 1, "wos": { "open": 6, "overdue": 0 }, "pmDone": 118, "pmDue": 120, "hbAgoMin": 1, "sampleAgoMin": 1, "intervalMin": 5, "sourcesDown": [], "tags": ["tier3"] },
    { "key": "kz-dxb2", "meters": { "n": 18, "ok": 17, "intermittent": 0, "offline": 0, "unconfirmed": 1 },"nameEn": "Khazna DXB-2",        "nameAr": "خزنة دبي 2",         "cluster": "dubai",    "type": "datacentre", "open": false, "lat": 25.115, "lon": 55.390, "floorArea": 9000,  "itLoadKw": 2600, "monthsOfData": 7,  "energyMtdKwh": 860000,  "facilityKwh": 5620000,  "itKwh": 3980000,  "alarms": { "critical": 0, "high": 0, "medium": 1 }, "unacked": 0, "wos": { "open": 3, "overdue": 0 }, "pmDone": 64, "pmDue": 66, "hbAgoMin": 1, "sampleAgoMin": 2, "intervalMin": 5, "sourcesDown": [], "tags": ["tier3", "new"] },
    { "key": "kz-ruh1", "meters": { "n": 26, "ok": 24, "intermittent": 1, "offline": 1, "unconfirmed": 0 },"nameEn": "Khazna RUH-1",        "nameAr": "خزنة الرياض 1",      "cluster": "riyadh",   "type": "datacentre", "open": false, "lat": 24.780, "lon": 46.760, "floorArea": 15000, "itLoadKw": 5100, "monthsOfData": 24, "energyMtdKwh": 1580000, "facilityKwh": 20100000, "itKwh": 14800000, "alarms": { "critical": 1, "high": 2, "medium": 2 }, "unacked": 3, "wos": { "open": 8, "overdue": 2 }, "pmDone": 140, "pmDue": 150, "hbAgoMin": 1, "sampleAgoMin": 2, "intervalMin": 5, "sourcesDown": ["W-03"], "tags": ["tier3"] },
    { "key": "fs-012", "meters": { "n": 3, "ok": 3, "intermittent": 0, "offline": 0, "unconfirmed": 0 }, "nameEn": "Station 12 Al Quoz",  "nameAr": "محطة 12 القوز",      "cluster": "dubai",    "type": "fuel", "open": false, "lat": 25.130, "lon": 55.230, "floorArea": 900,  "monthsOfData": 22, "energyMtdKwh": 38000, "alarms": { "critical": 0, "high": 1, "medium": 0 }, "unacked": 1, "wos": { "open": 2, "overdue": 1 }, "pmDone": 12, "pmDue": 12, "hbAgoMin": 5, "sampleAgoMin": 12, "intervalMin": 30, "sourcesDown": [], "tags": ["24h"] },
    { "key": "fs-044", "meters": { "n": 3, "ok": 0, "intermittent": 0, "offline": 3, "unconfirmed": 0 }, "nameEn": "Station 44 Yas",      "nameAr": "محطة 44 ياس",        "cluster": "abudhabi", "type": "fuel", "open": false, "lat": 24.495, "lon": 54.605, "floorArea": 1100, "monthsOfData": 20, "energyMtdKwh": 41000, "alarms": { "critical": 0, "high": 0, "medium": 1 }, "unacked": 1, "wos": { "open": 1, "overdue": 1 }, "pmDone": 10, "pmDue": 12, "hbAgoMin": 190, "sampleAgoMin": 190, "intervalMin": 30, "sourcesDown": [], "tags": ["24h", "highway"] },
    { "key": "fs-007", "meters": { "n": 3, "ok": 3, "intermittent": 0, "offline": 0, "unconfirmed": 0 }, "nameEn": "Station 7 Olaya",     "nameAr": "محطة 7 العليا",      "cluster": "riyadh",   "type": "fuel", "open": false, "lat": 24.700, "lon": 46.680, "floorArea": 800,  "monthsOfData": 16, "energyMtdKwh": 33000, "alarms": { "critical": 0, "high": 0, "medium": 0 }, "unacked": 0, "wos": { "open": 0, "overdue": 0 }, "pmDone": 12, "pmDue": 12, "hbAgoMin": 4, "sampleAgoMin": 8, "intervalMin": 30, "sourcesDown": [], "tags": [] },
    { "key": "fs-019", "meters": { "n": 3, "ok": 2, "intermittent": 1, "offline": 0, "unconfirmed": 0 }, "nameEn": "Station 19 Sharjah",  "nameAr": "محطة 19 الشارقة",    "cluster": "sharjah",  "type": "fuel", "open": false, "lat": 25.340, "lon": 55.420, "floorArea": 950,  "monthsOfData": 13, "energyMtdKwh": 36000, "alarms": { "critical": 0, "high": 0, "medium": 2 }, "unacked": 2, "wos": { "open": 3, "overdue": 2 }, "pmDone": 9, "pmDue": 12, "hbAgoMin": 6, "sampleAgoMin": 14, "intervalMin": 30, "sourcesDown": [], "tags": ["24h"] },
    { "key": "rs-mar", "meters": { "n": 2, "ok": 2, "intermittent": 0, "offline": 0, "unconfirmed": 0 }, "nameEn": "Grill House Marina",  "nameAr": "جريل هاوس المارينا", "cluster": "dubai",    "type": "restaurant", "open": false, "lat": 25.080, "lon": 55.140, "floorArea": 420, "monthsOfData": 15, "energyMtdKwh": 21000, "alarms": { "critical": 0, "high": 0, "medium": 0 }, "unacked": 0, "wos": { "open": 1, "overdue": 0 }, "pmDone": 6, "pmDue": 6, "hbAgoMin": 3, "sampleAgoMin": 7, "intervalMin": 15, "sourcesDown": [], "tags": ["mall"] },
    { "key": "rs-cor", "meters": { "n": 2, "ok": 1, "intermittent": 1, "offline": 0, "unconfirmed": 0 }, "nameEn": "Grill House Corniche","nameAr": "جريل هاوس الكورنيش", "cluster": "abudhabi", "type": "restaurant", "open": false, "lat": 24.478, "lon": 54.345, "floorArea": 380, "monthsOfData": 12, "energyMtdKwh": 19000, "alarms": { "critical": 0, "high": 1, "medium": 0 }, "unacked": 1, "wos": { "open": 2, "overdue": 1 }, "pmDone": 5, "pmDue": 6, "hbAgoMin": 2, "sampleAgoMin": 41, "intervalMin": 15, "sourcesDown": [], "tags": ["street"] },
    { "key": "rs-tah", "meters": { "n": 2, "ok": 2, "intermittent": 0, "offline": 0, "unconfirmed": 0 }, "nameEn": "Grill House Tahlia",  "nameAr": "جريل هاوس التحلية",  "cluster": "jeddah",   "type": "restaurant", "open": false, "lat": 21.560, "lon": 39.150, "floorArea": 460, "monthsOfData": 8,  "energyMtdKwh": 24000, "alarms": { "critical": 0, "high": 0, "medium": 1 }, "unacked": 0, "wos": { "open": 0, "overdue": 0 }, "pmDone": 6, "pmDue": 6, "hbAgoMin": 4, "sampleAgoMin": 10, "intervalMin": 15, "sourcesDown": [], "tags": ["mall"] }
  ],
  /* the 1,000-site recipe: shares per type, state mix, value bands per type; one seed so every run is identical */
  "generated": { "count": 1000, "seed": 20260904, "share": { "hotel": 0.22, "datacentre": 0.06, "fuel": 0.42, "restaurant": 0.30 },
    "stalePct": 0.08, "offlinePct": 0.03, "degradedPct": 0.05, "jitterDeg": 0.35,
    "bands": { "hotel": { "area": [12000, 60000], "euiMtd": [8, 16], "wos": [0, 12] }, "datacentre": { "area": [6000, 20000], "itKw": [1500, 8000], "pue": [1.22, 1.62], "wos": [0, 10] },
               "fuel": { "area": [600, 1400], "kwh": [24000, 52000], "wos": [0, 4] }, "restaurant": { "area": [250, 700], "kwh": [14000, 32000], "wos": [0, 3] } } }
};

/* Deterministic generator for the 1,000-site set (mulberry32). Separate from
   the demo: nothing here touches estate.sites. */
window.EKO_DATA.estateGen = function(){
  const G = window.EKO_DATA.estate.generated, T = window.EKO_DATA.estate.types, CL = window.EKO_DATA.estate.clusters;
  let a = G.seed >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const between = (lo, hi) => lo + rnd() * (hi - lo);
  const pick = () => { const r = rnd(); let acc = 0; for(const k in G.share){ acc += G.share[k]; if(r <= acc) return k; } return 'fuel'; };
  const out = [];
  for(let i = 0; i < G.count; i++){
    const type = pick(), cl = CL[Math.floor(rnd() * CL.length)], b = G.bands[type];
    const area = Math.round(between(b.area[0], b.area[1]));
    const r = rnd(); const st = r < G.offlinePct ? 'offline' : r < G.offlinePct + G.stalePct ? 'stale' : r < G.offlinePct + G.stalePct + G.degradedPct ? 'degraded' : 'reporting';
    const interval = type === 'datacentre' ? 5 : type === 'fuel' ? 30 : 15;
    const crit = rnd() < 0.06 ? 1 : 0, high = rnd() < 0.25 ? Math.ceil(rnd() * 2) : 0, med = rnd() < 0.5 ? Math.ceil(rnd() * 3) : 0;
    const wosOpen = Math.round(between(b.wos[0], b.wos[1]));
    const s = { key: 'g' + String(i + 1).padStart(4, '0'), nameEn: T[type].en + ' ' + (i + 1), nameAr: T[type].ar + ' ' + (i + 1), cluster: cl.id, type, open: false,
      lat: cl.lat + (rnd() - .5) * G.jitterDeg, lon: cl.lon + (rnd() - .5) * G.jitterDeg, floorArea: area, monthsOfData: Math.round(between(3, 30)),
      alarms: { critical: crit, high, medium: med }, unacked: Math.round((crit + high + med) * rnd()), wos: { open: wosOpen, overdue: Math.round(wosOpen * rnd() * .5) },
      pmDone: Math.round(between(30, 48)), pmDue: 48, intervalMin: interval, sourcesDown: st === 'degraded' ? ['S-1'] : [], tags: [] };
    const mn = type === 'datacentre' ? Math.round(between(14, 28)) : type === 'hotel' ? Math.round(between(5, 12)) : Math.round(between(2, 4));
    const moff = st === 'offline' ? mn : (rnd() < .1 ? 1 : 0), mint = rnd() < .15 ? 1 : 0; s.meters = { n: mn, ok: Math.max(0, mn - moff - mint), intermittent: mint, offline: moff, unconfirmed: 0 };
    if(type === 'datacentre'){ s.itLoadKw = Math.round(between(b.itKw[0], b.itKw[1])); const pue = between(b.pue[0], b.pue[1]); s.itKwh = Math.round(s.itLoadKw * 720 * 12); s.facilityKwh = Math.round(s.itKwh * pue); s.energyMtdKwh = Math.round(s.itLoadKw * 720 * pue * 0.13); }
    else if(type === 'hotel') s.energyMtdKwh = Math.round(area * between(b.euiMtd[0], b.euiMtd[1]));
    else s.energyMtdKwh = Math.round(between(b.kwh[0], b.kwh[1]));
    s.hbAgoMin = st === 'offline' ? interval * 5 : Math.round(between(1, 4)); s.sampleAgoMin = st === 'stale' ? Math.round(interval * between(1.5, 6)) : Math.round(between(1, interval * .8));
    out.push(s);
  }
  return out;
};

/* The site list older parts of the shell read (top-bar site name, switcher,
   palette): derived from the demo estate so there is one source of sites. */
window.EKO_DATA.portfolio = window.EKO_DATA.estate.sites.map(s => { const c = window.EKO_DATA.estate.clusters.find(x => x.id === s.cluster) || {}; return { key: s.key, nameEn: s.nameEn, nameAr: s.nameAr, cityEn: c.en || '', cityAr: c.ar || '', open: !!s.open }; });
