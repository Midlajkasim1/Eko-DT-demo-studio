/* ============================================================================
   ESG (D175) — EKO_ESG. The module measures the building against the baseline
   a sustainability partner delivers; it never invents a baseline, a target or a
   pathway, never certifies, verifies or submits anything, and sends nothing
   outside the site. Packs are prepared and downloaded; a person submits them.

   Everything runs on stand-in fixtures (js/data/site.marsa.js "esg") and the
   baseline packs the partner delivers (versioned, kept in the browser here:
   eko-esg-packs-v1:<site>). The production sources are documented in
   handoff/esg.md; every figure computed here (sums, intensities, shares,
   pro-rating, variance) is arithmetic that moves to Axon in production.

   Laws: three lines on every KPI (actual, partner baseline, client target);
   four data states (live, true zero, stale, no data); no false zeros; every
   percentage states its basis; every carbon figure its factor (value, unit,
   source, date); every AED figure its tariff version, and AED in the
   executive lens only; no gauges, no grade words; portfolio ratios are sums of
   numerators over sums of denominators. Copy says "prepared for" a framework,
   never "compliant with" it.
   ============================================================================ */
window.EKO_ESG = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = (...a) => C().esc(...a), fmt = (...a) => C().fmt(...a), icon = (...a) => C().icon(...a), dicon = (...a) => C().dicon(...a);
  let E = null;
  const use = E2 => { E = E2 || window.EKO; return E; };
  const t = (k, v) => E.t(k, v);
  const ar = () => E.lang === 'ar';
  const L = (en, a) => ar() ? (a || en) : en;
  const DAY = 864e5;
  const now = () => E.nowMs();
  const D = () => (E.data && E.data.esg) || null;
  const siteKey = () => (E.data && E.data.key) || 'marsa';
  const ls = {
    get(k){ try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(e){ return null; } },
    set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} } };
  /* ruling 4: money in the executive lens only; D176 B2: and the partner's, when the site setting "Partner sees cost" is on */
  const isPartner = () => E.role() === 'partner';
  const LSITE = () => 'eko-esg-site-v1:' + siteKey();
  const siteSet = () => Object.assign({ partnerCost: false }, ls.get(LSITE()) || {});
  const exec = () => E.role() === 'executive' || E.role() === 'manager' || (isPartner() && siteSet().partnerCost);   /* the money lens (E13: the facility manager too) */
  const moneyOk = E2 => { use(E2); return exec(); };                 /* D176 A3: the one money rule for ESG pages, Ask EKO included */
  const canNote = () => ['partner', 'executive'].includes(E.role());   /* D176 B3 */
  const canSite = () => ['executive', 'admin'].includes(E.role());   /* D177 ruling 1: "Partner sees cost" is switched by the executive and admin roles only */
  /* D176 B2: the partner is read only. Its only writes are notes and period sign-off. */
  const PARTNER_DENY = /^(ack|cwo|shelv|hoSubmit|hoReceive|brArch|dgBulkTag|nfMarkAll|nfPrefTgl|ctl(?!Aud|BigClose|DlgClose|SecBack)|esg(PackRm|PackFile|PackSample|Tol|Query|Upload|Prepare|MarkSub|SubmitOk|FvAdd|WasteSave|Attach|SiteSet|Verify|VerifyOk))/;
  const partnerDenied = (E2, act) => { use(E2); return isPartner() && PARTNER_DENY.test(act || ''); };
  const active = E2 => { const e = E2 || E; return !window.EKO_ADDONS || window.EKO_ADDONS.state(e, 'esg') === 'active'; };
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* ------------------------------ dates ------------------------------------ */
  const nd = () => new Date(now());
  const monthStart = o => { const d = nd(); return new Date(d.getFullYear(), d.getMonth() + o, 1); };
  const monthLbl = o => { const d = monthStart(o); return E.ph(MON[d.getMonth()] + ' ' + d.getFullYear()); };
  const dayLbl = ms => { const d = new Date(ms); return E.ph(d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear()); };
  const isoDay = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const parseDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };
  const isoLbl = s => { const ms = parseDay(s); return ms == null ? t('emptyDash') : dayLbl(ms); };
  const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
  const daysInYear = y => (new Date(y, 1, 29).getMonth() === 1 ? 366 : 365);
  const year = () => nd().getFullYear();
  const monthOffsetOf = ms => { const a = new Date(ms), b = nd(); return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth()); };

  /* ------------------------------ the boundary (D176 A1) ---------------------- */
  /* Every ESG intensity divides by the floor area of the ESG boundary: the pack in force names it, else the site's
     boundary record, else the estate floor area labelled as the whole site. Never the estate area silently. */
  const estRow = (key) => (((window.EKO_DATA || {}).estate || {}).sites || []).find(s => s.key === (key || siteKey()));
  const siteBoundary = () => { const d = D(); if(d && d.boundary && d.boundary.floorAreaM2) return d.boundary;
    const r = estRow(); return r && r.floorArea ? { nameEn: 'Whole site (estate record)', nameAr: 'الموقع كاملًا (سجل العقارات)', floorAreaM2: r.floorArea, estate: true } : null; };
  let memo = { k: null, raw: null, v: null };
  function readPacks(){ const k = LSP(); let raw = null; try{ raw = localStorage.getItem(k); }catch(e){}
    if(memo.k === k && memo.raw === raw) return memo.v; let v = null; try{ v = JSON.parse(raw || 'null'); }catch(e){} memo = { k, raw, v }; return v; }
  const pickInForce = (list, ms) => list.filter(p => { const a = parseDay(p.validFrom), b = parseDay(p.validTo); return a != null && b != null && ms >= a && ms <= b + DAY - 1; })
    .sort((x, y) => (y.version || 0) - (x.version || 0) || String(y.importedAt).localeCompare(String(x.importedAt)))[0] || null;
  function boundary(){ const p = readPacks(), P = Array.isArray(p) ? pickInForce(p, now()) : null;
    return P && P.boundary && P.boundary.floorAreaM2 ? P.boundary : siteBoundary(); }
  const area = () => (boundary() || {}).floorAreaM2 || null;
  const bName = b => b ? L(b.nameEn, b.nameAr) || (b.estate ? t('esg.bnd.estate') : '') : '';
  const bIncl = b => b ? L(b.includesEn, b.includesAr) || '' : '';

  /* -------------------------------- history --------------------------------- */
  const months = () => (((D() || {}).history) || {}).months || [];
  const mo = o => months().find(m => m.o === o);
  /* the three windows; share = the elapsed share of the period, for pro-rating an annual figure */
  function period(id){
    const d = nd(), y = d.getFullYear(), m = d.getMonth();
    if(id === 'mtd') return { id, from: 0, to: 0, share: d.getDate() / daysInYear(y), yr: y,   /* an annual figure, pro-rated to the days elapsed this month */
      label: t('esg.win.mtd', { from: dayLbl(monthStart(0).getTime()), to: dayLbl(now()) }) };
    if(id === 'ytd'){ const doy = Math.floor((now() - new Date(y, 0, 1).getTime()) / DAY) + 1;
      return { id, from: -m, to: 0, share: doy / daysInYear(y), yr: y, label: t('esg.win.ytd', { from: dayLbl(new Date(y, 0, 1).getTime()), to: dayLbl(now()) }) }; }
    return { id: '12m', from: -12, to: -1, share: 1, yr: monthStart(-1).getFullYear(), label: t('esg.win.12m', { from: monthLbl(-12), to: monthLbl(-1) }) };
  }
  const within = p => months().filter(x => x.o >= p.from && x.o <= p.to);
  const sum = (p, f) => { const ms = within(p); return ms.length ? ms.reduce((s, x) => s + (typeof f === 'function' ? (f(x) ?? NaN) : x[f]), 0) : null; };
  const cov = (p, f) => { const exp = p.to - p.from + 1, ms = within(p); return exp ? ms.reduce((s, x) => s + (f ? (x[f] ?? 1) : 1), 0) / exp : 0; };

  /* ------------------------------ baseline packs ---------------------------- */
  const LSP = () => 'eko-esg-packs-v1:' + siteKey();
  /* a pack template in the fixture carries offsets; the partner's file carries dates: materialise() makes the file */
  function materialise(tpl, v1tpl){
    const y = year(), sb = siteBoundary(), A = sb ? sb.floorAreaM2 : null;   /* the site boundary (never area(): that reads the packs) */
    const vFrom = tpl.validFrom === 'yearStart' ? y + '-01-01' : isoDay(monthStart(-2).getTime());
    const vTo = tpl.validYears ? (y + tpl.validYears - 1) + '-12-31' : (v1tpl && v1tpl.validYears ? (y + v1tpl.validYears - 1) + '-12-31' : (y + 2) + '-12-31');
    const of1 = (k) => (tpl[k] === 'ofVersion1' && v1tpl) ? v1tpl[k] : tpl[k];
    const baseYear = y + (tpl.baselineYearOffset ?? -2);
    const targets = {}; Object.keys(tpl.targets || {}).forEach(k => { targets[k] = {}; tpl.targets[k].forEach((v, i) => { targets[k][String(y + i)] = v; }); });
    const ci = ((tpl.kpis || {}).carbonIntensity || {}).v;
    /* B8: an absolute pathway (tCO2e) or an intensity pathway (kgCO2e/m²), with its source; the fixture generates both as straight lines */
    const pw = tpl.pathway && ci != null && A ? (() => { const end = tpl.pathway.netZeroYear, yrs = {}, intensity = tpl.pathway.kind === 'intensity';
      const start = intensity ? ci * (tpl.pathway.startFactor || 1) : ci * A / 1000;
      for(let yy = baseYear; yy <= end; yy++) yrs[String(yy)] = +(start * (1 - (yy - baseYear) / (end - baseYear))).toFixed(intensity ? 2 : 1);
      return { netZeroYear: end, kind: intensity ? 'intensity' : 'absolute', unit: intensity ? 'kgCO2e/m²' : 'tCO2e', scope: '1+2', source: tpl.pathway.source || 'partner', years: yrs }; })() : null;
    const factors = (of1('factors') || []).map(f => Object.assign({}, f, { inForceFrom: f.inForceFromYearStart ? y + '-01-01' : (f.inForceFrom || null),
      date: isoDay(now() - (tpl.assessedAgoD || 0) * DAY) }));
    const calendar = (of1('calendar') || []).map(c => ({ fw: c.fw, period: String(y + (c.periodYearOffset ?? -1)), due: isoDay(now() + c.dueInD * DAY), standIn: !!c.standIn }));
    const attachments = (tpl.attachments || []).map(a => Object.assign({ date: isoDay(now() - (tpl.assessedAgoD || 0) * DAY), bytes: null }, a));
    return { schema: 'eko.esg.baselinePack/1', id: tpl.id, version: tpl.version, site: siteKey(), assessorRole: tpl.assessorRole,
      standards: tpl.standards || [], assessed: isoDay(now() - (tpl.assessedAgoD || 0) * DAY), validFrom: vFrom, validTo: vTo,
      baselineYear: baseYear, floorAreaM2: A, boundary: sb && !sb.estate ? Object.assign({}, sb) : null, kpis: tpl.kpis || {}, targets, pathway: pw, ieqBands: tpl.ieqBands || null,
      factors, calendar, evidence: of1('evidence') || {}, credits: of1('credits') || [], attachments, standIn: true };
  }
  function seedPacks(){ const d = D(); if(!d || !d.packs || !d.packs.length) return []; const v1 = materialise(d.packs[0]); v1.importedAt = v1.assessed; return [v1]; }
  function packs(){ let p = readPacks(); if(!Array.isArray(p)){ p = seedPacks(); ls.set(LSP(), p); } return p; }
  const inForceAt = ms => pickInForce(packs(), ms);
  const pack = () => inForceAt(now());                                       /* THE provenance: the pack in force today */
  const samplePack = () => { const d = D(); return d && d.packs && d.packs[1] ? materialise(d.packs[1], d.packs[0]) : null; };
  const REQ = ['site', 'assessorRole', 'assessed', 'validFrom', 'validTo', 'kpis'];
  function importPack(obj){
    if(!obj || typeof obj !== 'object' || REQ.some(k => obj[k] == null)) return { ok: false, why: 'esg.imp.badSchema' };
    if(obj.site !== siteKey()) return { ok: false, why: 'esg.imp.otherSite' };
    const p = packs().filter(x => !(x.id === obj.id && x.version === obj.version));
    p.push(Object.assign({}, obj, { importedAt: isoDay(now()) })); ls.set(LSP(), p); return { ok: true };
  }
  function removePack(id, v){ ls.set(LSP(), packs().filter(x => !(x.id === id && String(x.version) === String(v)))); }
  const bDate = b => b ? (b.date || (b.dateAgoD != null ? isoDay(now() - b.dateAgoD * DAY) : null)) : null;
  const bRef = (b, en) => b ? (b.id || (en ? b.nameEn : bName(b)) || '') + (bDate(b) ? ', ' + (en ? bDate(b) : isoLbl(bDate(b))) : '') : '';   /* D178 item 4 */
  const bLine = () => { const b = boundary(); return b ? bName(b) : t('esg.why.noArea'); };   /* the line names the boundary; its area is in the tooltip and the coverage caption */
  const provenance = () => { const p = pack(); return (p ? t('esg.prov', { role: E.person(p.assessorRole), d: isoLbl(p.assessed), to: isoLbl(p.validTo) }) : t('esg.noBase')) + ' · ' + bLine(); };
  const provTip = () => { const b = boundary(); const inc = bIncl(b) || t('esg.bnd.estateIncl');
    return b ? t('esg.provB', { b: bName(b), a: fmt(b.floorAreaM2) }) + ': ' + inc + (b.standIn && !/stand-in|بديلة/.test(inc) ? '. ' + t('esg.bnd.standIn') : '') : ''; };

  /* ------------------------------ factor records ---------------------------- */
  function grid(){ const b = E.data.basis || {}; return b.co2KgPerKwh > 0 && b.co2FactorId ? { kind: 'grid', id: b.co2FactorId, v: b.co2KgPerKwh, unit: b.co2FactorUnit || 'kgCO2e/kWh',
      source: L(b.co2FactorSourceEn, b.co2FactorSourceAr) || '', standIn: /stand-in/i.test(b.co2FactorSourceEn || ''), date: b.co2FactorDate || null, from: b.co2FactorInForceFrom || null, status: b.co2FactorStatus, toConfirm: !!b.co2FactorToConfirm } : null; }
  /* D176 B5: the site grid factor keeps earlier versions; one is in force at any time (the latest whose date has passed).
     Monthly carbon uses the version in force in that month. A version added with a past in-force date restates the months
     it covers and keeps their earlier figures (restates: { 'YYYY-MM': kg }). */
  const LFV = () => 'eko-esg-fv-v1:' + siteKey();
  const ym = o => { const d = monthStart(o); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  function gridVersions(){ const b = E.data.basis || {}, g = grid(); if(!g) return [];
    const fixed = (b.co2FactorVersions || []).map(v => Object.assign({ kind: 'grid', unit: g.unit, source: L(v.sourceEn, v.sourceAr), standIn: /stand-in/i.test(v.sourceEn || ''), from: v.inForceFrom }, v));
    const added = (ls.get(LFV()) || []).map(v => Object.assign({ kind: 'grid', unit: g.unit, from: v.inForceFrom, added: true }, v));
    return fixed.concat(added, [Object.assign({ current: true }, g)]).filter(v => v.from).sort((a, b2) => String(a.from).localeCompare(String(b2.from)) || (a.added ? 1 : 0) - (b2.added ? 1 : 0)); }
  function gridAt(ms){ const vs = gridVersions(); let cur = null; vs.forEach(v => { const f = parseDay(v.from); if(f != null && f <= ms) cur = v; }); return cur; }
  const gridOfMonth = m => gridAt(monthStart(m.o).getTime());
  const restatedPrev = o => { const k = ym(o); const v = (ls.get(LFV()) || []).filter(x => x.restates && x.restates[k] != null).slice(-1)[0]; return v ? v.restates[k] : null; };
  const vName = v => v ? (ar() && v.nameAr ? v.nameAr : v.id) : '';   /* a version's display name (the id is the record's key) */
  const gridUsed = ms => [...new Set(ms.map(m => vName(gridOfMonth(m))).filter(Boolean))];
  const pf = kind => { const p = pack(); const f = p ? (p.factors || []).find(x => x.kind === kind) || null : null; return f ? Object.assign({ standIn: /stand-in/i.test(f.sourceEn || '') }, f) : null; };
  const fDate = d => d ? (/^\d{4}$/.test(d) ? d : isoLbl(d)) : null;
  const fName = f => (f.nameEn ? L(f.nameEn, f.nameAr) : (f.id || '')) + (f.gwpSourceEn ? ', ' + t('esg.gwpFrom', { s: L(f.gwpSourceEn, f.gwpSourceAr) }) : '');
  /* the full factor line: value and unit, name (and the GWP's assessment report), source, date, in force from */
  function factorLine(f){
    if(!f) return t('esg.noFactor');
    const d = f.date, from = f.from || f.inForceFrom;
    return [fmt(f.v, f.v < 10 ? 2 : 0) + ' ' + f.unit, fName(f), f.source || L(f.sourceEn, f.sourceAr) || '',
      d ? t('esg.dated', { d: fDate(d) }) : t('esg.dateNone'), from ? t('esg.inForceFrom', { d: isoLbl(from) }) : t('esg.fromNone')].filter(Boolean).join(' · ');
  }
  /* D176 C7: the short chip ("0.41 kgCO2e/kWh, stand-in") that opens the full record; it is the factor line in reach */
  function factorChip(f){
    if(!f) return `<span class="tCap esgfnone">${esc(t('esg.noFactor'))}</span>`;
    return `<button class="esgfchip" data-act="esgFactor" data-k="${esc(f.kind || 'grid')}" data-v="${esc(f.kind || 'grid')}" data-basis="emission" aria-haspopup="dialog" data-tip="${esc(factorLine(f))}"><bdi dir="ltr" class="esgfnum">${esc(fmt(f.v, f.v < 10 ? 2 : 0) + ' ' + f.unit)}</bdi>${f.standIn ? `<span>${esc((ar() ? '، ' : ', ') + t('esg.standIn'))}</span>` : ''}</button>`;
  }
  const factorOf = k => k === 'grid' ? grid() : pf(k);
  function factorPop(E2){
    use(E2);
    const st = E.state.esgFp || {}, f = factorOf(st.k); if(!f) return '';
    const W = 340, vw = innerWidth, vh = innerHeight, r = st.r || { left: vw / 2 - W / 2, right: vw / 2 + W / 2, top: vh / 3, bottom: vh / 3 };
    const left = Math.max(8, Math.min(ar() ? r.right - W : r.left, vw - W - 8)), below = r.bottom + 6 + 230 < vh;
    const pos = `left:${Math.round(left)}px;${below ? `top:${Math.round(r.bottom + 6)}px` : `bottom:${Math.round(vh - r.top + 6)}px`}`;
    const row = (k, v) => v ? `<dt>${esc(t(k))}</dt><dd>${esc(v)}</dd>` : '';
    return `<div class="scrim scrimclear" data-pass="1" data-act="closeDlg"></div>
      <div class="dlg esgfpop" role="dialog" aria-label="${esc(t('esg.fpopT'))}" style="${pos}">
        <div class="dgmhead"><h3>${esc(t('esg.fpopT'))}</h3><button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(t('close'))}">${icon('x', 13)}</button></div>
        <dl class="esgdl"><dt>${esc(t('esg.s.value'))}</dt><dd class="tMonoS" data-basis="emission">${esc(fmt(f.v, f.v < 10 ? 2 : 0) + ' ' + f.unit)}</dd>
          ${row('esg.s.factor', fName(f))}${row('esg.s.source', f.source || L(f.sourceEn, f.sourceAr))}
          <dt>${esc(t('esg.s.date'))}</dt><dd>${esc(fDate(f.date) || t('esg.dateNone'))}</dd>
          <dt>${esc(t('esg.s.from'))}</dt><dd>${esc((f.from || f.inForceFrom) ? isoLbl(f.from || f.inForceFrom) : t('esg.fromNone'))}</dd>
          ${row('esg.fpopRec', f.kind === 'grid' ? t('esg.s.siteRec') : t('esg.s.fromPack'))}</dl></div>`;
  }
  const tariff = () => { const b = E.data.basis || {}; return b.aedPerKwh > 0 && b.tariffId ? { rate: b.aedPerKwh, id: b.tariffId, ver: b.tariffVersion || '', status: b.tariffStatus } : null; };
  const tariffLine = tb => tb ? t('esg.tariffLine', { r: fmt(tb.rate, 2), id: tb.id, v: tb.ver || t('esg.dateNone') }) + (tb.status === 'provisional' ? t('basisProv') : '') : t('esg.noTariff');

  /* --------------------------------- carbon --------------------------------- */
  /* E10: a source the site has not configured shows Not configured, never a zero or a missing factor */
  const nc = k => (((D() || {}).notConfigured) || []).includes(k);
  /* a KPI's name; carbon is Scope 2 only where neither fuel nor refrigerant is configured */
  const kName = id => t(id === 'carbonIntensity' && nc('fuel') && nc('refrigerant') ? 'esg.kpi.carbonIntensityS2' : 'esg.kpi.' + id);
  const NC_OF = { waterIntensity: 'water', ctWaterIntensity: 'ctWater', wasteIntensity: 'waste', wasteDiversion: 'waste' };
  const refrigerant = () => (((D() || {}).refrigerant) || { entries: [] });
  const refInMonth = o => refrigerant().entries.filter(e => monthOffsetOf(now() - e.agoD * DAY) === o);
  function carbonKg(m){                                                       /* one month, Scope 1 plus 2, kg; null when a factor is missing */
    const g = gridOfMonth(m), fuel = pf('fuel'), gwp = pf('refrigerant');   /* D176 B5: the grid version in force that month */
    if(!g || (!fuel && !nc('fuel')) || (!gwp && !nc('refrigerant'))) return null;
    const ref = nc('refrigerant') ? 0 : refInMonth(m.o).reduce((s, e) => s + e.kg * gwp.v, 0);
    return m.kwh * g.v + (nc('fuel') ? 0 : m.gasM3 * fuel.v) + ref;   /* a source not configured adds nothing: the figure says Scope 2 only */
  }
  const s2Kg = m => { const g = gridOfMonth(m); return g ? m.kwh * g.v : null; };

  /* D176 B6: operational waste, a monthly manual entry (the fixture's stand-in months plus entries made here) */
  const LW = () => 'eko-esg-waste-v1:' + siteKey();
  function wasteList(){ const base = (((D() || {}).waste) || {}).months || [], loc = ls.get(LW()) || {};
    const out = {}; base.forEach(w => { out[ym(w.o)] = Object.assign({}, w); });
    Object.keys(loc).forEach(k => { const o = (() => { const [yy, mm] = k.split('-').map(Number), d = nd(); return (yy - d.getFullYear()) * 12 + (mm - 1 - d.getMonth()); })();
      out[k] = Object.assign({ o }, loc[k], { entered: true }); });
    return Object.values(out).sort((a, b) => a.o - b.o); }
  const wasteAt = o => wasteList().find(w => w.o === o) || null;
  const wasteIn = p => wasteList().filter(w => w.o >= p.from && w.o <= p.to);
  const wasteCov = p => { const exp = p.to - p.from + 1; return exp ? wasteIn(p).length / exp : 0; };

  /* ---------------------------------- KPIs ---------------------------------- */
  /* kind: intensity (period sum over the floor area; the annual baseline and target are pro-rated by the elapsed share)
           share (a ratio of sums, compared directly) · pct (occupied-hour shares, compared directly) */
  const KPIS = [
    { id: 'energyIntensity', unit: 'kWh/m²', kind: 'intensity', dir: -1, dp: 1, src: ['kwh'], val: p => { const s = sum(p, 'kwh'), A = area(); return s == null || !A ? null : s / A; }, month: m => m.kwh / area() },
    { id: 'coolingShare', unit: '%', kind: 'share', dir: -1, dp: 1, src: ['coolingKwh'], val: p => { const a = sum(p, 'coolingKwh'), b = sum(p, 'kwh'); return a == null || !b ? null : a / b * 100; }, month: m => m.coolingKwh / m.kwh * 100 },
    { id: 'oohShare', unit: '%', kind: 'share', dir: -1, dp: 1, src: ['oohKwh'], val: p => { const a = sum(p, 'oohKwh'), b = sum(p, 'kwh'); return a == null || !b ? null : a / b * 100; }, month: m => m.oohKwh / m.kwh * 100 },
    { id: 'carbonIntensity', unit: 'kgCO2e/m²', kind: 'intensity', dir: -1, dp: 1, carbon: true, src: ['kwh', 'gasM3'], val: p => { const s = sum(p, carbonKg), A = area(); return s == null || isNaN(s) || !A ? null : s / A; }, month: m => { const k = carbonKg(m); return k == null ? null : k / area(); } },
    { id: 'waterIntensity', unit: 'm³/m²', kind: 'intensity', dir: -1, dp: 2, src: ['waterM3'], val: p => { const s = sum(p, 'waterM3'), A = area(); return s == null || !A ? null : s / A; }, month: m => m.waterM3 / area() },
    { id: 'ctWaterIntensity', unit: 'm³/m²', kind: 'intensity', dir: -1, dp: 2, covField: 'covCt', src: ['ctWaterM3'], val: p => { const s = sum(p, 'ctWaterM3'), A = area(); return s == null || !A ? null : s / A; }, month: m => m.ctWaterM3 / area() },
    { id: 'co2InBand', unit: '%', kind: 'pct', dir: 1, dp: 1, src: ['co2InBandPct'], val: p => { const ms = within(p); return ms.length ? ms.reduce((s, x) => s + x.co2InBandPct, 0) / ms.length : null; }, month: m => m.co2InBandPct },
    { id: 'tempInBand', unit: '%', kind: 'pct', dir: 1, dp: 1, src: ['tempInBandPct'], val: p => { const ms = within(p); return ms.length ? ms.reduce((s, x) => s + x.tempInBandPct, 0) / ms.length : null; }, month: m => m.tempInBandPct },
    /* D176 B6 */
    { id: 'wasteIntensity', unit: 'kg/m²', kind: 'intensity', dir: -1, dp: 1, waste: true, src: ['wasteKg'], val: p => { const ws = wasteIn(p), A = area(); return ws.length && A ? ws.reduce((s, w) => s + w.totalKg, 0) / A : null; }, month: m => { const w = wasteAt(m.o); return w && area() ? w.totalKg / area() : null; } },
    { id: 'wasteDiversion', unit: '%', kind: 'ratio', dir: 1, dp: 1, waste: true, src: ['wasteKg'], val: p => { const ws = wasteIn(p), tot = ws.reduce((s, w) => s + w.totalKg, 0); return tot ? ws.reduce((s, w) => s + w.divertedKg, 0) / tot * 100 : null; }, month: m => { const w = wasteAt(m.o); return w && w.totalKg ? w.divertedKg / w.totalKg * 100 : null; } }
  ];
  const COV_MIN = 0.9;
  function kpiRow(k, pid){
    const p = period(pid), P = inForceAt(Math.min(now(), monthStart(p.to + 1).getTime() - 1)) || null;   /* the pack in force at the period's end */
    const v = months().length ? k.val(p) : null;
    const c = k.waste ? wasteCov(p) : cov(p, k.covField);
    const base = P && P.kpis && P.kpis[k.id] ? P.kpis[k.id].v : null;
    const tgtA = P && P.targets && P.targets[k.id] ? (P.targets[k.id][String(p.yr)] ?? null) : null;
    const scale = k.kind === 'intensity' ? p.share : 1;
    const baseP = base == null ? null : base * scale, tgtP = (tgtA ?? base) == null ? null : (tgtA ?? base) * scale;
    let st = 'on';
    if(NC_OF[k.id] && nc(NC_OF[k.id])) return { k, p, P, v: null, c: 0, base, baseP, tgt: tgtA, tgtP, st: 'notconf', why: t('esg.why.notConf'), scale };
    if(base == null) st = 'nobase';
    else if(v == null || c < COV_MIN) st = 'insuff';
    else st = (k.dir < 0 ? v <= tgtP : v >= tgtP) ? 'on' : 'off';
    const why = v == null ? (!months().length ? t('esg.why.noHistory') : !area() ? t('esg.why.noArea') : k.waste ? t('esg.why.noWaste') : k.carbon ? t('esg.why.noFactor') : t('esg.why.noData')) : null;
    return { k, p, P, v, c, base, baseP, tgt: tgtA, tgtP, st, why, scale };
  }

  /* ----------------------------- data-state cells --------------------------- */
  /* live · true zero (0 with its timestamp) · stale (muted, age, clock) · no data (dash and the reason) */
  function val(o){
    if(o.v == null || (typeof o.v === 'number' && isNaN(o.v)))
      return `<span class="esgnd" data-state="none"${o.why ? ` data-tip="${esc(o.why)}"` : ''}>${esc(t('esg13.noData'))}${o.whyShow && o.why ? `<span class="esgwhy">${esc(o.why)}</span>` : ''}</span>`;
    const num = `${esc(fmt(o.v, o.dp ?? 1))}${o.unit ? `<span class="ovkunit">${esc(o.unit)}</span>` : ''}`;
    const attrs = `${o.basis ? ` data-basis="${esc(o.basis)}"` : ''}${o.tip ? ` data-tip="${esc(o.tip)}"` : ''}`;
    if(o.ageH != null && o.ageH > staleH())
      return `<span class="esgstale" data-state="stale"${attrs}>${icon('clock', 11)}<span>${num}</span><span class="esgage">${esc(t('esg.age', { h: Math.round(o.ageH) }))}</span></span>`;
    if(o.v === 0 && o.at)
      return `<span class="esgzero" data-state="zero"${attrs}><span>${num}</span><span class="esgage">${esc(t('esg.zeroAt', { d: dayLbl(o.at) }))}</span></span>`;
    return `<span class="esglive" data-state="live"${attrs}>${num}</span>`;
  }
  const tol = () => Object.assign({ billPct: 2, excursionPct: 10, staleH: 24 }, (ls.get('eko-esg-tol-v1:' + siteKey()) || {}));
  const tolIsDefault = k => (ls.get('eko-esg-tol-v1:' + siteKey()) || {})[k] == null;
  const staleH = () => tol().staleH;
  const pill = st => `<span class="esgpill" data-st="${st}"><span class="esgdot" aria-hidden="true"></span>${esc(t('esg.st.' + st))}</span>`;
  const pctChip = (gap, ref) => gap == null ? '' : `<span class="pwchip" data-tone="${gap > 0 ? 'warn' : 't3'}" data-tip="${esc(t('esg.gapTip', { ref }))}">${esc(t(gap > 0 ? 'esg.above' : 'esg.below', { p: fmt(Math.abs(gap), 1), ref }))}</span>`;
  const spark = vals => { const v = vals.filter(x => x != null && isFinite(x)); if(v.length < 2) return '';
    const mn = Math.min(...v), mx = Math.max(...v), sp = (mx - mn) || 1;
    const pts = vals.map((x, i) => x == null ? null : `${(i / (vals.length - 1) * 44).toFixed(1)},${(14 - (x - mn) / sp * 12).toFixed(1)}`).filter(Boolean).join(' ');
    return `<svg class="esgspark" viewBox="0 0 44 16" width="44" height="16" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--domEnergy)" stroke-width="1.4"/></svg>`; };

  /* D176 C8: round axis ticks (0, 1,000, 2,000 ...) */
  function niceTicks(mx){ if(!(mx > 0)) return [0, 1]; const raw = mx / 4, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow, out = []; for(let v = 0; v < mx + step - 1e-9; v += step) out.push(+v.toFixed(6)); return out; }
  /* -------------------------------- carbon totals --------------------------- */
  const yearMonths = y => months().filter(m => monthStart(m.o).getFullYear() === y);
  function yearCarbonT(y){ const ms = yearMonths(y); if(!ms.length) return { t: null, n: 0 };
    const k = ms.map(carbonKg); return { t: k.some(x => x == null || isNaN(x)) ? null : k.reduce((s, x) => s + x, 0) / 1000, n: ms.length }; }
  /* the pathway in tCO2e for the chart and the year-to-date position; an intensity pathway is kgCO2e/m² times the boundary floor area */
  function pathwayAt(P, y){ const v = P && P.pathway && P.pathway.years ? (P.pathway.years[String(y)] ?? null) : null;
    return v == null ? null : P.pathway.kind === 'intensity' ? (area() ? v * area() / 1000 : null) : v; }
  const pathIntAt = (P, y) => P && P.pathway && P.pathway.kind === 'intensity' && P.pathway.years ? (P.pathway.years[String(y)] ?? null) : null;
  /* B8: the stranding year: the first year the trailing 12 month intensity, held flat, is above the intensity pathway */
  function stranding(){ const P = pack(); if(!P || !P.pathway || P.pathway.kind !== 'intensity') return null;
    const cur = kpiRow(KPIS.find(k => k.id === 'carbonIntensity'), '12m').v, base = { nz: P.pathway.netZeroYear, ver: P.version, standIn: !!P.standIn };
    if(cur == null) return Object.assign({ cur: null, year: null }, base);
    for(let y = year(); y <= P.pathway.netZeroYear; y++){ const v = pathIntAt(P, y); if(v != null && cur > v) return Object.assign({ cur, year: y }, base); }
    return Object.assign({ cur, year: null }, base); }
  function ytdPathway(){ const P = pack(), y = year(), p = period('ytd'), a = yearCarbonT(y), pw = pathwayAt(P, y);
    return { actual: a.t, pro: pw == null ? null : pw * p.share, pw, gap: a.t == null || pw == null ? null : (a.t - pw * p.share) / (pw * p.share) * 100, p }; }

  /* -------------------------------- bills ----------------------------------- */
  function bills(){
    const d = D(); if(!d || !d.bills) return [];
    return d.bills.map(b => {
      const m = mo(b.o), f = b.utility === 'water' ? 'waterM3' : 'kwh', unit = b.utility === 'water' ? 'm³' : 'kWh';
      const metered = m ? m[f] : null, billed = b.missing || metered == null ? null : Math.round(metered * b.billedFactor * 100) / 100;
      const varPct = billed == null || !metered ? null : (billed - metered) / metered * 100;
      const st = b.missing ? 'missing' : b.read === 'estimated' ? 'estimated' : Math.abs(varPct) <= tol().billPct ? 'matched' : 'variance';
      return Object.assign({}, b, { metered, billed, unit, varPct, st, label: monthLbl(b.o), recAgeD: b.reconciledAgoD });
    });
  }
  /* D176 C10: a flag says why, where it appears */
  const lc = s => E.lang === 'en' && s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  const varTxt = b => (b.varPct > 0 ? '+' : '') + fmt(b.varPct, 1);
  const billWhy = b => b.st === 'missing' ? t('esg.hl.billMissing') : b.explain ? t('esg.hl.billVar', { p: varTxt(b), x: lc(t('esg.b.expl.' + b.explain)) }) : t('esg.hl.billVarNo', { p: varTxt(b) });

  /* -------------------------------- IEQ ------------------------------------- */
  /* D176 C2 and C3: bands and occupied hours per space type. EKO's defaults name no standard ("EKO default, to be set by
     the partner"); the partner's pack names its standard and the space types it covers. Comfort bands apply to regularly
     occupied spaces: kitchen and back of house are not assessed until the pack sets a band for them. */
  const SPACE_TYPES = ['guest', 'office', 'dining', 'lobby', 'boh', 'kitchen', 'gym', 'spa'];
  const NOT_ASSESSED = ['kitchen', 'boh'];
  const spaceTypes = () => ((((D() || {}).ieq) || {}).spaceTypes) || SPACE_TYPES;   /* E10: the site's own room types (the Medical Centre: clinical, waiting, office, back of house) */
  const DEF_BANDS = { tempC: [22.0, 25.5], rhPct: [30, 60], co2Ppm: 1000, pm25: 15 };
  function bands(){ const P = pack(), pb = P && P.ieqBands;
    return { v: pb || DEF_BANDS, src: pb ? 'pack' : 'default', pack: P, types: pb ? (pb.types || spaceTypes().filter(x => !NOT_ASSESSED.includes(x))) : null, std: pb ? L(pb.standardEn, pb.standardAr) : '' }; }
  function bandFor(type){ const B = bands();
    if(B.src === 'pack' && B.types.includes(type)) return { v: B.v, src: 'pack' };
    return NOT_ASSESSED.includes(type) ? null : { v: DEF_BANDS, src: 'default' }; }
  const occFor = type => { const q = (D() || {}).ieq || {}, pb = (bands().pack || {}).ieqBands, o = pb && pb.occupancy && pb.occupancy[type];
    if(o) return { s: L(o.en, o.ar), src: 'pack' };
    return type === 'guest' ? { s: L(q.occupancyGuestEn, q.occupancyGuestAr), src: 'default' } : { s: L(q.occupancyEn, q.occupancyAr), src: 'default' }; };
  const zoneName = z => { const h = (((E.data.heat || {}).zones) || []).concat(((E.data.spaces || {}).zones) || []).find(x => x.nameEn === z); return ar() && h && h.nameAr ? h.nameAr : z; };
  const IEQ_KEYS = ['co2', 'temp', 'rh', 'pm25'];
  function ieqRows(pid){ const z = (((D() || {}).ieq) || {}).zones || [], tl = tol().excursionPct;
    return z.map(r => { const type = r.spaceType || 'office', p = (r.periods || {})[pid] || {}, band = bandFor(type);
      if(!band) return { zone: r.zone, type, p, staleH: r.staleH || null, exc: null, persistent: false, cause: null, out: [], notAssessed: true };
      let exc = null, cause = null; IEQ_KEYS.forEach(k => { const v = p[k]; if(v != null && (exc == null || 100 - v > exc)){ exc = 100 - v; cause = k; } });
      return { zone: r.zone, type, p, band, staleH: r.staleH || null, exc, cause, out: IEQ_KEYS.filter(k => p[k] != null && 100 - p[k] > tl), persistent: exc != null && exc > tl }; }); }

  /* D176 B1: the reduction measures register. Estimates are the partner's; results are the prove engine's, never invented. */
  function measures(){ const list = (D() || {}).measures || [], V = window.EKO_PROVE ? window.EKO_PROVE.verified(E) : [];
    return list.map(m => { const v = m.prove ? V.find(x => x.id === m.prove) || null : null;
      const st = v && v.outcome === 'recovered' ? 'verified' : v && v.outcome === 'partly' ? 'partly' : v && v.outcome === 'notRecovered' ? 'notRecovered' : m.status;
      const per = v && v.delta ? (v.kwhMo != null ? v.kwhMo / v.delta : null) : null;   /* kWh a month per unit of the reading, from the fixture's stated relationship */
      const verKwh = v && (v.outcome === 'recovered' || v.outcome === 'partly') ? v.kwhMo : null, verUnc = verKwh != null && per != null && isFinite(v.uncertainty) ? v.uncertainty * per : null;
      return Object.assign({}, m, { v, st, verKwh, verUnc, payback: m.capexAed != null && m.est && m.est.aedYr ? m.capexAed / m.est.aedYr : null }); }); }
  const measureOfProve = id => measures().find(m => m.prove === id) || null;

  /* D176 B3: notes (role, date, text; resolved is the only change a note accepts) and the period sign-off records */
  const LN = () => 'eko-esg-notes-v1:' + siteKey(), LR = () => 'eko-esg-rev-v1:' + siteKey();
  const notes = () => ls.get(LN()) || [];
  const notesFor = tg => notes().filter(n => n.tg === tg);
  const reviews = () => ls.get(LR()) || [];
  const roleLbl = r => r === 'verifier' ? t('esg.so.verRole') : t('role' + String(r || '').charAt(0).toUpperCase() + String(r || '').slice(1));

  /* D176 B4: partner documents, kept in IndexedDB in the prototype (5 MB each, 25 MB in all); production: the EKO box */
  const DOC_MAX = 5 * 1024 * 1024, DOC_ALL = 25 * 1024 * 1024;
  function idb(){ return new Promise((res, rej) => { try{ const r = indexedDB.open('eko-esg-docs', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'docId' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }catch(e){ rej(e); } }); }
  async function docPut(rec){ const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(rec); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }); }
  async function docGet(id){ const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('files').objectStore('files').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); }
  const attachmentsOf = P => (P && P.attachments) || [];
  const docFor = (P, item) => attachmentsOf(P).find(a => (a.evidence || []).includes(item)) || null;
  /* the two stand-in documents of the sample pack version 2: small PDFs made in the page, so the evidence links open a real file */
  async function seedDocs(P){ for(const a of attachmentsOf(P)){ const have = await docGet(a.docId).catch(() => null); if(have) continue;
      const bytes = pdfBytes([{ t: a.titleEn, b: true }, ' ', 'Stand-in document for the EKO prototype. It holds no assessment.', 'Document id: ' + a.docId, 'Author role: ' + a.authorRole, 'Date: ' + a.date]);
      await docPut({ docId: a.docId, name: a.fileName, type: 'application/pdf', blob: new Blob([bytes], { type: 'application/pdf' }), bytes: bytes.length }).catch(() => {}); } }

  /* D176 B7: credits at risk: the credit's KPI is Off track (last 12 months) or its evidence item is Missing */
  function creditsAtRisk(){ const P = pack(); if(!P || !(P.credits || []).length) return null;
    return P.credits.map(c => { const reasons = [];
      if(c.kpi){ const k = KPIS.find(x => x.id === c.kpi); const r = k ? kpiRow(k, '12m') : null; if(r && r.st === 'off') reasons.push(t('esg.c.kpiOff', { k: kName(c.kpi) })); }
      if(c.evidence){ const it = evidence(c.fw).find(x => x.id === c.evidence); if(it && !it.present) reasons.push(t('esg.c.evMissing', { e: t('esg.ev.' + c.evidence.replace('doc:', 'doc.')) })); }
      return Object.assign({}, c, { reasons }); }).filter(c => c.reasons.length); }

  /* -------------------------------- reporting -------------------------------- */
  const FW = ['mrv', 'gresb', 'safat', 'estidama', 'mostadam', 'leed', 'well'];   /* D176 B7: LEED O+M and WELL (stand-in) */
  const LSS = () => 'eko-esg-sub-v1:' + siteKey();
  const subState = () => Object.assign({ submitted: {}, prepared: {}, queries: [], captures: [] }, ls.get(LSS()) || {});
  const saveSub = s => ls.set(LSS(), s);
  function submitted(fw){ const s = subState().submitted[fw]; if(s) return s; const f = ((D() || {}).submitted || {})[fw];
    return f ? { date: isoDay(now() - f.agoD * DAY), by: f.by, byRole: f.byRole, readinessPct: f.readinessPct ?? null, seeded: true } : null; }
  const whoOf = s => s.byRole ? t('role' + s.byRole.charAt(0).toUpperCase() + s.byRole.slice(1)) : E.person(s.by || '', true);
  /* D176 A5: Not reviewed, Under review, Reviewed (partner role and date), Verified (verifier role and date). Verified is
     third-party verification by an approved verifier, offered only where the pack lists it as a required item. */
  const needsVerifier = fw => { const P = pack(); return !!(P && P.evidence && (P.evidence[fw] || []).includes('thirdParty')); };
  function verification(fw){ const rec = reviewOf(fw); if(rec) return rec;
    const v = ((D() || {}).verification || {})[fw]; return v ? { status: v.status, role: v.role, date: v.agoD != null ? isoDay(now() - v.agoD * DAY) : null } : { status: 'notReviewed' }; }
  /* D176 B3: the latest sign-off record for the framework's calendar period sets Reviewed (or Verified) */
  const periodOf = fw => (calendar().find(c => c.fw === fw) || {}).period || String(year() - 1);
  const reviewOf = fw => { const r = reviews().filter(x => x.fw === fw && x.period === periodOf(fw)).slice(-1)[0];
    return r ? { status: r.kind === 'verification' ? 'verified' : 'reviewed', role: r.kind === 'verification' ? 'approved verifier' : r.role === 'partner' ? 'sustainability consultant' : r.role, date: r.date, rec: r } : null; };
  const canSubmit = () => E.role() === 'executive';   /* D176 C5: a submission is a management act */
  function evidence(fw){
    const P = pack(); const req = P && P.evidence ? (P.evidence[fw] || []) : []; const per = (P && (P.calendar || []).find(c => c.fw === fw) || {}).period || String(year() - 1);
    const y = +per, ms = yearMonths(y), g = grid(), tb = tariff(), full = ms.length === 12;
    const pts = f => ((D() || {}).points || []).filter(x => (x.serves || []).includes(f)).map(x => x.id);
    const src = { energy: ['kwh'], fuel: ['gasM3'], water: ['waterM3'], carbon: ['kwh', 'gasM3'], ieq: ['co2InBandPct', 'tempInBandPct'] };
    return req.map(id => {
      if(id.startsWith('doc:')){ const a = docFor(P, id); return { id, present: !!a, doc: true, att: a, period: per, sources: a ? [a.fileName] : [] }; }   /* B4 */
      let present = false, figs = [];
      if(src[id]) present = full;
      if(id === 'refrigerant') present = refrigerant().entries.length > 0 || !!refrigerant().checkedAt;
      if(id === 'factorGrid') present = !!(g && g.source);
      if(id === 'factorFuel') present = !!pf('fuel');
      if(id === 'coverage' || id === 'floorArea') present = !!(area() && (D() || {}).coverage);
      if(id === 'bills') present = bills().some(b => b.st !== 'missing');
      if(id === 'carbon') present = full && yearCarbonT(y).t != null;
      if(id === 'thirdParty') present = verification(fw).status === 'verified';
      if(id === 'waste'){ const wy = wasteList().filter(w => monthStart(w.o).getFullYear() === y); present = wy.length === 12; }   /* B6 */
      const fac = id === 'energy' || id === 'factorGrid' ? (gridUsed(ms).join(', ') || (g ? g.id : null)) : id === 'fuel' || id === 'factorFuel' ? (pf('fuel') ? pf('fuel').id : null)
        : id === 'carbon' ? gridUsed(ms).concat([pf('fuel') && pf('fuel').id, pf('refrigerant') && pf('refrigerant').id]).filter(Boolean).join(', ') : null;
      const srcs = id === 'refrigerant' ? [t('esg.r.manualLog')] : id === 'waste' ? [t('esg.w.cap')] : id === 'floorArea' || id === 'coverage' ? [t('esg.r.bndRec', { r: bRef(boundary()) })] : (src[id] || []).flatMap(pts);
      return { id, present, period: per, sources: srcs, factor: fac, tariff: id === 'energy' && tb ? tb.id + ' ' + tb.ver : null, figs };
    });
  }
  function readiness(fw){ const ev = evidence(fw); return ev.length ? { pct: ev.filter(x => x.present).length / ev.length * 100, n: ev.filter(x => x.present).length, of: ev.length } : null; }
  const calendar = () => { const P = pack(); return P ? (P.calendar || []).slice().sort((a, b) => String(a.due).localeCompare(String(b.due))) : []; };
  const daysLeft = due => { const ms = parseDay(due); return ms == null ? null : Math.ceil((ms - (new Date(nd().getFullYear(), nd().getMonth(), nd().getDate()).getTime())) / DAY); };

  /* ================================ VIEWS ===================================== */
  const glanceRows = () => {
    const P = pack(), tv = KPIS.map(k => kpiRow(k, E.state.esgPer || '12m')), withBase = tv.filter(r => r.st !== 'nobase');
    const on = tv.filter(r => r.st === 'on').length;
    const yp = ytdPathway(), bl = bills(), bv = bl.filter(b => b.st !== 'matched').length;
    const ieq = ieqRows('7d'), exc = ieq.filter(r => r.persistent).length;
    const next = calendar().filter(c => !submitted(c.fw)).map(c => ({ c, d: daysLeft(c.due) })).filter(x => x.d != null && x.d >= 0).sort((a, b) => a.d - b.d)[0];
    return [
      { sub: 'tva', page: 'esg-tva', label: 'esgTva', head: P ? t('esg.gl.tva', { n: on, m: withBase.length }) : t('esg.noBase') },
      { sub: 'nz', page: 'esg-nz', label: 'esgNz', tip: t('esg.gapTip', { ref: t('esg.ref.pathway') }), head: yp.gap == null ? (P ? t('esg.gl.nzNone') : t('esg.noPathway')) : t(yp.gap > 0 ? 'esg.gl.nzAbove' : 'esg.gl.nzBelow', { p: fmt(Math.abs(yp.gap), 0) }) },
      { sub: 'bills', page: 'esg-bills', label: 'esgBills', head: nc('bills') ? t('esg.why.notConf') : bl.length ? t('esg.gl.bills', { n: bv }) : t('esg.gl.billsNone') },
      { sub: 'ieq', page: 'esg-ieq', label: 'esgIeq', tip: t('esg.pctBasis.occ'), head: ieq.length ? t('esg.gl.ieq', { n: exc }) : t('esg.gl.ieqNone') },
      { sub: 'rep', page: 'esg-rep', label: 'esgRep', head: next ? t('esg.gl.rep', { n: next.d }) : t('esg.gl.repNone') } ];
  };

  /* the overlay: ESG OVERVIEW, four KPIs, the provenance line, AT A GLANCE */
  function summary(E2){
    use(E2);
    const r12 = kpiRow(KPIS[0], '12m'), w12 = kpiRow(KPIS[4], '12m'), yp = ytdPathway(), A = area(), d = D();
    const gap = r => r.v == null || r.baseP == null ? null : (r.v - r.baseP) / r.baseP * 100;
    const kpi = (lbl, body, cap, chip, warn, tip, basis, extra, inl) => `<div class="ovk esgk"${warn ? ' data-warn="1"' : ''}${inl ? ' data-inl="1"' : ''}><div class="ovkhead"><span class="ovklbl">${esc(lbl)}</span>${chip || ''}</div>
      <div class="ovkval">${body}${inl ? `<span class="ovkcap"${tip ? ` data-tip="${esc(tip)}"` : ''}>${esc(cap)}</span>` : ''}</div>${inl ? '' : `<div class="ovkcap"${tip ? ` data-tip="${esc(tip)}"` : ''}${basis ? ` data-basis="${basis}"` : ''}>${esc(cap)}${extra || ''}</div>`}</div>`;
    const covPct = A && d && d.coverage ? Math.min(100, d.coverage.meteredM2 / A * 100) : null;
    const g = grid();
    /* D176 C7: the overview fits 1280 by 665 (four KPIs and the first AT A GLANCE row): a compact signed chip beside the label
       (the sentence in its tooltip), one caption line naming the reference and the window, the factor as a chip */
    const sChip = (gp, ref) => gp == null ? '' : `<span class="pwchip esgschip" data-tone="${gp > 0 ? 'warn' : 't3'}" data-tip="${esc(t(gp > 0 ? 'esg.above' : 'esg.below', { p: fmt(Math.abs(gp), 1), ref }) + '. ' + t('esg.gapTip', { ref }))}" aria-label="${esc(t(gp > 0 ? 'esg.above' : 'esg.below', { p: fmt(Math.abs(gp), 1), ref }))}">${esc((gp > 0 ? '+' : '-') + fmt(Math.abs(gp), 1) + '%')}</span>`;
    const capW = (gp, refKey, p) => gp == null ? t('esg.k.capWin') : t(refKey);
    const html = '<div class="ovklist">'
      + kpi(t('esg.k.energy'), val({ v: r12.v, dp: 1, unit: 'kWh/m²', why: r12.why, whyShow: true }), capW(gap(r12), 'esg.k.capBase'),
          sChip(gap(r12), t('esg.ref.baseline')), gap(r12) > 0, r12.p.label + '. ' + t('esg.k.intTip2'))
      + kpi(t('esg.k.carbon'), `<span data-basis="emission" data-tip="${esc(factorLine(g))}">${val({ v: yp.actual, dp: 1, unit: 'tCO2e', why: yp.actual == null ? (months().length ? t('esg.why.noFactor') : t('esg.why.noHistory')) : null, whyShow: true })}</span>`,
          capW(yp.gap, 'esg.k.capPath'), sChip(yp.gap, t('esg.ref.pathway')), yp.gap > 0, yp.p.label + '. ' + t('esg.k.carbonTip'), 'emission', `<span class="esgcapchip">${factorChip(g)}</span>`)
      + kpi(t('esg.k.water'), val({ v: w12.v, dp: 2, unit: 'm³/m²', why: w12.why, whyShow: true }), capW(gap(w12), 'esg.k.capBase'), sChip(gap(w12), t('esg.ref.baseline')), gap(w12) > 0, w12.p.label + '. ' + t('esg.k.intTip2'))
      + kpi(t('esg.k.cov'), val({ v: covPct, dp: 0, unit: '%', why: t('esg.why.noCoverage'), whyShow: true, tip: d && d.coverage ? L(d.coverage.basisEn, d.coverage.basisAr) : '' }),
          covPct == null ? t('esg.k.covNone') : t('esg.k.covCap4', { m: fmt(d.coverage.meteredM2), a: fmt(A) }), '', false, d && d.coverage ? L(d.coverage.basisEn, d.coverage.basisAr) : '', '', '', true)
      + `</div><p class="esgprov" data-has="${pack() ? 1 : 0}">${icon('doc', 12)}<span data-tip="${esc(provTip())}">${esc(provenance())}</span>${pack() ? '' : `<button class="statlink" data-act="esgSettings">${esc(t('esg.toSettings'))}</button>`}</p>
      <div class="tLbl esgglt">${esc(t('esg.glance'))}</div>
      <div class="esgglance">${glanceRows().map(r => `<button class="landrow2 esggl" data-act="goSub" data-mod="esg" data-sub="${r.sub}" data-page="${r.page}">
        <span class="lr2pad"><span class="col grow minw0 taS"><span class="optname">${esc(t(r.label))}</span><span class="alcardm"${r.tip ? ` data-tip="${esc(r.tip)}"` : ''}>${esc(r.head)}</span></span>
        <span class="cT3">${dicon('end', 14)}</span></span></button>`).join('')}</div>`;
    return C().summaryShell(E, t('esg.overview'), html);
  }

  /* the right panel with no sub-view: what needs a person, consistent with Energy's module panel layout (no gauges, no grade words) */
  function panel(E2){
    use(E2);
    const items = [];
    KPIS.map(k => kpiRow(k, '12m')).filter(r => r.st === 'off').forEach(r => items.push({ sub: 'tva', page: 'esg-tva', h: kName(r.k.id),
      b: t('esg.hl.offWhy', { a: fmt(r.v, r.k.dp), tg: fmt(r.tgtP, r.k.dp), u: r.k.unit, w: r.p.label }), tip: r.k.carbon ? factorLine(grid()) : t('esg.stRule'), basis: r.k.carbon ? 'emission' : null }));
    bills().filter(b => b.st !== 'matched').forEach(b => items.push({ sub: 'bills', page: 'esg-bills', h: t('esg.hl.billH', { u: t('esg.util.' + b.utility), m: b.label }), b: billWhy(b), tip: t('esg.pctBasis.bill') }));
    ieqRows('7d').filter(r => r.persistent).forEach(r => items.push({ sub: 'ieq', page: 'esg-ieq', h: zoneName(r.zone), b: t('esg.hl.excWhy', { k: t('esg.ieq.param.' + r.cause), p: fmt(r.exc, 1) }), tip: t('esg.pctBasis.occ') }));
    calendar().filter(c => !submitted(c.fw)).map(c => ({ c, d: daysLeft(c.due) })).filter(x => x.d != null && x.d >= 0 && x.d <= 14).forEach(x => items.push({ sub: 'rep', page: 'esg-rep', h: t('esg.fw.' + x.c.fw), b: t('esg.hl.due', { n: x.d }), warn: true }));
    const cards = items.length ? items.map(i => `<button class="esghl" data-act="goSub" data-mod="esg" data-sub="${i.sub}" data-page="${i.page}"${i.warn ? ' data-warn="1"' : ''}>
        <span class="col grow minw0 taS"><b>${esc(i.h)}</b><span class="tCap"${i.tip ? ` data-tip="${esc(i.tip)}"` : ''}${i.basis ? ` data-basis="${i.basis}"` : ''}>${esc(i.b)}</span></span><span class="cT3">${dicon('end', 14)}</span></button>`).join('')
      : `<p class="alempty">${esc(t(!months().length && !bills().length && !ieqRows('7d').length && !pack() ? 'esg.hl.noInputs' : 'esg.hl.none'))}</p>`;   /* nothing checked is not "nothing needs attention" */
    return C().modShell(E, t('modEsg'), '', '', `<div class="esgpad"><h3 class="esgh3">${esc(t('esg.hl.t'))}</h3><p class="tCap">${esc(t('esg.hl.cap2'))}</p><div class="esghls">${cards}</div></div>`, 'esg');
  }

  /* 1. TARGET VS ACTUAL: a full-width page (D176 C6), one row per KPI */
  function tvaPage(E2){
    use(E2);
    const pid = E.state.esgPer || '12m';
    const seg = ['mtd', 'ytd', '12m'].map(p => `<button class="seg" data-on="${pid === p}" aria-pressed="${pid === p}" data-act="esgPer" data-v="${p}">${esc(t('esg.per.' + p))}</button>`).join('');
    const rows = KPIS.map(k => kpiRow(k, pid));
    const pr = rows[0].p;
    const cellNum = (v, r, why) => val({ v, dp: r.k.dp, why: why || r.why, basis: r.k.carbon ? 'emission' : null, tip: r.k.carbon ? factorLine(grid()) + ' · ' + t('esg.fv.used', { l: gridUsed(within(r.p)).join(', ') }) : (r.k.unit === '%' ? t('esg.pctBasis.' + r.k.kind) : null) });
    const ct = (((D() || {}).points) || []).find(x => x.id === 'MW-03');
    const body = rows.map(r => {
      const ageH = r.k.id === 'ctWaterIntensity' && ct && ct.lastAt ? (now() - E.fxMs(ct.lastAt)) / 36e5 : null;
      const actual = ageH != null && ageH > staleH() ? val({ v: r.v, dp: r.k.dp, ageH, tip: t('esg.staleTip', { id: ct.id }) }) : cellNum(r.v, r);
      const trend = spark(Array.from({ length: 12 }, (_, j) => { const m = mo(j - 11); return m ? r.k.month(m) : null; }));
      const gp = gapTo(r);
      return `<tr class="esgrow" data-act="esgKpi" data-v="${r.k.id}" tabindex="0" role="button" aria-label="${esc(kName(r.k.id) + ', ' + t('esg.st.' + r.st))}">
        <th scope="row"${r.k.carbon ? ' data-basis="emission"' : ''}><span class="esgkn">${esc(kName(r.k.id))}</span><span class="tCap">${esc(r.k.unit)}</span></th>
        <td>${actual}${r.k.carbon && restatedFigure(r.k, r) != null ? `<span class="esgpill esgrestp" data-tip="${esc(t('esg.fv.restTip'))}">${esc(t('esg.fv.restated'))}</span>` : ''}</td><td>${cellNum(r.baseP, r, t('esg.noBase'))}</td><td>${cellNum(r.tgtP, r, t('esg.noBase'))}</td>
        <td>${gp == null ? val({ v: null, why: r.base == null ? t('esg.noBase') : r.why || t('esg.why.noData') }) : `<span class="tMonoS esggap" data-dir="${gp.bad ? 'bad' : 'good'}" data-tip="${esc(gp.tip)}">${esc(gp.txt)}</span>`}</td>
        <td><span data-tip="${esc(t('esg.stRule'))}">${pill(r.st)}</span>${r.st === 'insuff' ? `<span class="tCap esgwhy2">${esc(r.v == null ? r.why || '' : t('esg.why.cov', { p: fmt(r.c * 100, 0) }))}</span>` : ''}</td>
        <td class="esgtr">${trend}</td></tr>`;
    }).join('');
    const n = st => rows.filter(r => r.st === st).length;
    const heroes = [
      tile(t('esg.t.hOn'), `<span class="ovknum">${n('on')}</span>`, t('esg.t.hOf', { n: rows.length - n('nobase') - n('notconf') }), '', t('esg.stRule')),
      tile(t('esg.t.hOff'), `<span class="ovknum">${n('off')}</span>`, t('esg.t.hOffCap'), '', t('esg.stRule')),
      tile(t(n('notconf') ? 'esg.t.hOtherNc' : 'esg.t.hOther'), `<span class="ovknum">${n('nobase') + n('insuff') + n('notconf')}</span>`, n('notconf') ? t('esg.t.hOtherCapNc', { b: n('nobase'), i: n('insuff'), c: n('notconf') }) : t('esg.t.hOtherCap', { b: n('nobase'), i: n('insuff') }))];
    const table = `<div class="row gap8 esgper"><span class="tCap">${esc(t('esg.period'))}</span><span class="segbox row" role="group" aria-label="${esc(t('esg.period'))}">${seg}</span>
        <span class="tCap esgwin">${esc(pr.label)}${pr.share < 1 ? ` · <span data-tip="${esc(t('esg.shareTip'))}">${esc(t('esg.prorated', { p: fmt(pr.share * 100, 0) }))}</span>` : ''}</span></div>
      <div class="esgtblwrap"><table class="esgtbl esgtva" aria-label="${esc(t('esgTva'))}"><thead><tr><th scope="col">${esc(t('esg.col.kpiUnit'))}</th><th scope="col">${esc(t('esg.col.actual'))}</th><th scope="col">${esc(t('esg.col.baseline'))}</th><th scope="col">${esc(t('esg.col.target'))}</th>
        <th scope="col"><span data-tip="${esc(t('esg.gapTgtTip'))}">${esc(t('esg.col.gap'))}</span></th><th scope="col">${esc(t('esg.col.status'))}</th><th scope="col">${esc(t('esg.col.trend'))}</th></tr></thead><tbody>${body}</tbody></table></div>
      <p class="tCap esgrule">${esc(t('esg.stRule'))}</p>`;
    return pageWrap('esg-tva', heroes, provBar() + card(t('esg.t.tableT'), t('esg.t.tableCap'), table));
  }
  /* the gap to target, with its basis: intensities as a percentage of the pro-rated target, shares as percentage points */
  function gapTo(r){
    if(r.v == null || r.tgtP == null) return null;
    const bad = r.k.dir < 0 ? r.v > r.tgtP : r.v < r.tgtP;
    if(r.k.unit === '%'){ const d = r.v - r.tgtP; return { bad, txt: (d > 0 ? '+' : '') + fmt(d, 1) + ' ' + t('esg.pts'), tip: t('esg.gapPtsTip') }; }
    const d = (r.v - r.tgtP) / r.tgtP * 100; return { bad, txt: (d > 0 ? '+' : '') + fmt(d, 1) + '%', tip: t('esg.gapPctTip') };
  }

  /* D176 B5: the figure before a restatement, for the carbon KPI over its window (null when nothing in the window was restated) */
  function restatedFigure(k, r){ if(!k.carbon) return null; const ms = within(r.p); let any = false, tot = 0;
    for(const m of ms){ const pv = restatedPrev(m.o); if(pv != null){ any = true; tot += pv; } else { const c = carbonKg(m); if(c == null) return null; tot += c; } }
    return any && area() ? tot / area() : null; }
  /* --- the detail popover (depth three): a KPI row --- */
  function kpiDialog(id){
    const k = KPIS.find(x => x.id === id); if(!k) return '';
    const pid = E.state.esgPer || '12m', r = kpiRow(k, pid);
    const os = Array.from({ length: 13 }, (_, i) => i - 12);
    const pts = os.map(o => { const m = mo(o); const P = inForceAt(Math.min(now(), monthStart(o + 1).getTime() - 1)); const y = monthStart(o).getFullYear();
      const sc = k.kind === 'intensity' ? 1 / 12 : 1;
      const b = P && P.kpis[k.id] ? P.kpis[k.id].v * sc : null, tg = P && P.targets[k.id] ? (P.targets[k.id][String(y)] ?? null) : null;
      return { o, a: m ? k.month(m) : null, b, tg: tg == null ? null : tg * sc, pack: P ? P.version : null }; });
    const all = pts.flatMap(p => [p.a, p.b, p.tg]).filter(v => v != null && isFinite(v));
    const mn = all.length ? Math.min(...all) * 0.95 : 0, mx = all.length ? Math.max(...all) * 1.05 : 1, W = 520, H = 150;
    const x = i => 34 + i / (os.length - 1) * (W - 44), y = v => H - 18 - (v - mn) / ((mx - mn) || 1) * (H - 34);
    const line = (f, cls) => { const seg = pts.map((p, i) => p[f] == null ? null : `${x(i).toFixed(1)},${y(p[f]).toFixed(1)}`); const runs = []; let cur = [];
      seg.forEach(s => { if(s) cur.push(s); else if(cur.length){ runs.push(cur); cur = []; } }); if(cur.length) runs.push(cur);
      return runs.map(rn => `<polyline class="${cls}" points="${rn.join(' ')}" fill="none"/>`).join(''); };
    const ticks = pts.filter((_, i) => i % 3 === 0 || i === os.length - 1).map(p => { const i = os.indexOf(p.o);
      return `<text x="${x(i).toFixed(1)}" y="${H - 3}" class="esgax" text-anchor="${i === 0 ? 'start' : i === os.length - 1 ? 'end' : 'middle'}">${esc(monthLbl(p.o))}</text>`; }).join('');
    const chart = `<svg class="esgchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('esg.dlg.chartAria', { k: kName(k.id) }))}">
      <text x="2" y="12" class="esgax">${esc(fmt(mx, k.dp))}</text><text x="2" y="${H - 18}" class="esgax">${esc(fmt(mn, k.dp))}</text>
      ${line('b', 'esgl-b')}${line('tg', 'esgl-t')}${line('a', 'esgl-a')}${ticks}</svg>
      <div class="row gap12 esgleg"><span><i class="esgsw" data-l="a"></i>${esc(t('esg.col.actual'))}</span><span><i class="esgsw" data-l="b"></i>${esc(t('esg.col.baseline'))}</span><span><i class="esgsw" data-l="t"></i>${esc(t('esg.col.target'))}</span></div>`;
    const pts2 = (((D() || {}).points) || []).filter(p => k.src.some(f => (p.serves || []).includes(f)));
    const P = r.P;
    const fixes = (k.id === 'energyIntensity' || k.id === 'carbonIntensity' || k.id === 'coolingShare') && window.EKO_PROVE
      ? window.EKO_PROVE.verified(E).filter(v => (v.outcome === 'recovered' || v.outcome === 'partly') && v.kwhMo != null && v.fixedDaysAgo != null && v.fixedDaysAgo * DAY <= now() - monthStart(r.p.from).getTime()) : [];
    const rec = P ? `<dl class="esgdl"><dt>${esc(t('esg.dlg.pack'))}</dt><dd>${esc(P.id + ' · ' + t('esg.ver', { v: P.version }))}</dd>
        <dt>${esc(t('esg.dlg.std'))}</dt><dd>${esc((P.standards || []).map(x => E.ph(x)).join('; '))}</dd>
        <dt>${esc(t('esg.dlg.assessor'))}</dt><dd>${esc(E.person(P.assessorRole, true))}</dd>
        <dt>${esc(t('esg.dlg.assessed'))}</dt><dd>${esc(isoLbl(P.assessed))}</dd>
        <dt>${esc(t('esg.dlg.baseRec'))}</dt><dd>${P.kpis[k.id] ? esc(fmt(P.kpis[k.id].v, k.dp) + ' ' + k.unit + (k.kind === 'intensity' ? ' ' + t('esg.perYear') : '')) + (P.kpis[k.id].noteEn ? ` <span class="tCap">${esc(L(P.kpis[k.id].noteEn, P.kpis[k.id].noteAr))}</span>` : '') : esc(t('esg.st.nobase'))}</dd></dl>`
      : `<p class="tCap">${esc(t('esg.noBase'))}</p>`;
    return dlgShell(kName(k.id), `${chart}
      <div class="esggrid2"><div><h4 class="tLbl">${esc(t('esg.dlg.method'))}</h4><p class="tCap">${esc(t('esg.method.' + k.kind))}</p>
        <h4 class="tLbl">${esc(t('esg.dlg.window'))}</h4><p class="tCap">${esc(r.p.label)}${r.scale < 1 ? ' · ' + esc(t('esg.prorated', { p: fmt(r.scale * 100, 0) })) : ''}</p>
        <h4 class="tLbl">${esc(t('esg.dlg.basis'))}</h4><p class="tCap">${esc(k.unit === '%' ? t('esg.pctBasis.' + k.kind) : t('esg.basis.boundary', { b: bName(boundary()), a: area() ? fmt(area()) : t('emptyDash') }))}${k.carbon ? ' · ' + esc(factorLine(grid())) : ''}</p>
        <h4 class="tLbl">${esc(t('esg.dlg.sources'))}</h4><ul class="dglist">${pts2.map(p => `<li class="tCap">${esc(L(p.nameEn, p.nameAr))}</li>`).join('') || `<li class="tCap">${esc(t('emptyDash'))}</li>`}</ul></div>
      <div><h4 class="tLbl">${esc(t('esg.dlg.record'))}</h4>${rec}
        ${fixes.length ? `<h4 class="tLbl">${esc(t('esg.dlg.verified', { n: fixes.length }))}</h4><ul class="dglist">${fixes.map(v => { const m = measureOfProve(v.id);
          return `<li><button class="statlink" data-act="${m ? 'esgMeasure' : 'esgFix'}" data-v="${esc(m ? m.id : '')}" data-asset="${esc(v.asset)}">${esc(v.asset + ' · ' + v.point + ' · ' + t('pv.out.' + v.outcome))}</button>${m ? `<span class="tCap esgvby">${esc(t('esg.m.link', { id: m.id }))}</span>` : ''}</li>`; }).join('')}</ul>` : ''}
        ${k.carbon ? (() => { const used = gridUsed(within(r.p)), prev = restatedFigure(k, r); return `<p class="tCap">${esc(t('esg.fv.used', { l: used.join(', ') || t('emptyDash') }))}</p>${prev != null ? `<p class="tCap esgrest">${esc(t('esg.fv.prev', { v: fmt(prev, k.dp), u: k.unit }))}</p>` : ''}`; })() : ''}
        ${k.waste ? `<p class="tCap">${esc(t('esg.w.manual'))}</p>` : ''}</div></div>
      ${noteBlock('kpi:' + k.id + ':' + pid, t('esg.n.forPeriod', { p: r.p.label }))}`, 'esgdlgkpi');
  }
  /* D176 B3: a note block: the list (role, date, text; resolved), and for the partner and the executive an add box */
  function noteBlock(tg, sub){
    const list = notesFor(tg).slice().reverse();
    const items = list.length ? list.map(n => `<li class="esgnote" data-res="${n.resolved ? 1 : 0}"><span class="tCap">${esc(t('esg.n.by', { role: roleLbl(n.role), d: isoLbl(n.date) }))}${n.forPeriod ? ' · ' + esc(t('esg.n.forPeriod', { p: n.forPeriod })) : ''}</span>
        <span class="esgnotet">${esc(n.text)}</span>${n.resolved ? `<span class="tCap">${esc(t('esg.n.resolved', { d: isoLbl(n.resolved.date), role: roleLbl(n.resolved.role) }))}</span>`
          : canNote() ? `<button class="statlink" data-act="esgNoteResolve" data-v="${esc(n.id)}">${esc(t('esg.n.resolve'))}</button>` : ''}</li>`).join('') : `<li class="tCap">${esc(t('esg.n.none'))}</li>`;
    return `<div class="esgnotes" data-tg="${esc(tg)}"><h4 class="tLbl">${esc(t('esg.n.T'))}</h4><ul class="dglist esgnlist">${items}</ul>
      ${canNote() ? `<label class="rpfld"><span class="tCap">${esc(sub || t('esg.n.who'))}</span><textarea class="dgfin esgnin" rows="2" maxlength="600" aria-label="${esc(t('esg.n.add'))}" placeholder="${esc(t('esg.n.ph'))}"></textarea></label>
        <div class="row gap8"><span class="grow"></span><button class="btnG btnSm" data-act="esgNoteAdd" data-v="${esc(tg)}">${esc(t('esg.n.add'))}</button></div>` : `<p class="tCap">${esc(t('esg.n.who'))}</p>`}</div>`;
  }
  function dlgShell(title, inner, cls){
    return `<div class="scrim" data-act="closeDlg"></div><div class="dlg esgdlg ${cls || ''}" role="dialog" aria-label="${esc(title)}">
      <div class="dgmhead"><h3>${esc(title)}</h3><button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(t('close'))}">${icon('x', 13)}</button></div>
      <div class="esgdlgbody">${inner}</div></div>`;
  }

  /* ------------------------------- detail pages ------------------------------ */
  const card = (title, cap, inner, cls) => `<article class="pwwidget esgw ${cls || ''}"><div class="pwwh"><span class="alcardt">${esc(title)}</span>${cap ? `<span class="alcardm">${esc(cap)}</span>` : ''}</div>${inner}</article>`;
  const tile = (lbl, body, cap, chip, tip, basis) => `<div class="pwtile"><div class="pwth"><span class="ovklbl">${esc(lbl)}</span>${chip || ''}</div><div class="ovkval">${body}</div><span class="ovkcap"${tip ? ` data-tip="${esc(tip)}"` : ''}${basis ? ` data-basis="${basis}"` : ''}>${esc(cap)}</span></div>`;
  const pageWrap = (pg, heroes, inner) => `<div class="pwarea esgpage" data-pg="${pg}">${heroes.length ? `<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>` : ''}${inner}</div>`;
  const provBar = () => `<p class="esgprov esgprovpg" data-has="${pack() ? 1 : 0}">${icon('doc', 12)}<span data-tip="${esc(provTip())}">${esc(provenance())}</span>${pack() ? '' : `<button class="statlink" data-act="esgSettings">${esc(t('esg.toSettings'))}</button>`}</p>`;

  /* 2. NET ZERO AND DECARBONIZATION */
  function netZeroPage(E2){
    use(E2);
    const P = pack(), y = year(), g = grid(), fuel = pf('fuel'), gwp = pf('refrigerant'), yp = ytdPathway();
    const by = P ? P.baselineYear : y - 2, nz = P && P.pathway ? P.pathway.netZeroYear : y;
    const years = []; for(let yy = by; yy <= Math.max(nz, y); yy++) years.push(yy);
    const bars = years.filter(yy => yy <= y).map(yy => ({ yy, c: yearCarbonT(yy), ytd: yy === y }));
    const all = bars.map(b => b.c.t).concat(years.map(yy => pathwayAt(P, yy))).filter(v => v != null);
    const yt = niceTicks(all.length ? Math.max(...all) : 1), mx = yt[yt.length - 1], W = 760, H = 220, X0 = 52;
    const bw = Math.max(6, (W - X0 - 10) / years.length * 0.55);
    const x = yy => X0 + (years.indexOf(yy) + 0.5) * (W - X0 - 10) / years.length, yv = v => H - 24 - v / mx * (H - 44);
    const barSvg = bars.map(b => b.c.t == null ? '' : `<rect class="esgbar" data-ytd="${b.ytd ? 1 : 0}" x="${(x(b.yy) - bw / 2).toFixed(1)}" y="${yv(b.c.t).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - 24 - yv(b.c.t)).toFixed(1)}"><title>${esc(b.yy + ': ' + fmt(b.c.t, 1) + ' tCO2e' + (b.c.n < 12 ? ' · ' + t('esg.nz.monthsOf', { n: b.c.n }) : ''))}</title></rect>`).join('');
    const pro = yp.pro != null ? `<rect class="esgpro" x="${(x(y) + bw / 2 + 2).toFixed(1)}" y="${yv(yp.pro).toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${(H - 24 - yv(yp.pro)).toFixed(1)}"><title>${esc(t('esg.nz.proTip', { v: fmt(yp.pro, 1) }))}</title></rect>` : '';
    const pw = P && P.pathway ? `<polyline class="esgpw" fill="none" points="${years.map(yy => pathwayAt(P, yy) == null ? null : `${x(yy).toFixed(1)},${yv(pathwayAt(P, yy)).toFixed(1)}`).filter(Boolean).join(' ')}"/>` : '';
    const keep = [by, y, nz], near = yy => keep.some(k => k !== yy && Math.abs(k - yy) <= 1);
    const ticks = years.filter(yy => keep.includes(yy) || (yy % 5 === 0 && !near(yy))).map(yy => `<text class="esgax" x="${x(yy).toFixed(1)}" y="${H - 6}" text-anchor="middle"${yy === by ? ' data-base="1"' : ''}>${yy}</text>`).join('');
    const gridSvg = yt.map(v => `<line class="esggrid" x1="${X0}" x2="${W - 10}" y1="${yv(v).toFixed(1)}" y2="${yv(v).toFixed(1)}"/><text class="esgax" x="${X0 - 6}" y="${(yv(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmt(v, 0))}</text>`).join('');
    const byLine = years.includes(by) ? `<line class="esgbyl" x1="${x(by).toFixed(1)}" x2="${x(by).toFixed(1)}" y1="${yv(mx).toFixed(1)}" y2="${H - 24}"><title>${esc(t('esg.nz.baseYr', { y: by }))}</title></line>
      <text class="esgax esgbylt" x="${(x(by) + (ar() ? -4 : 4)).toFixed(1)}" y="${(yv(mx) + 10).toFixed(1)}" text-anchor="start">${esc(t('esg.nz.baseMark'))}</text>` : '';
    const chart = `<svg class="esgchart esgnz" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('esg.nz.chartAria'))}">${gridSvg}${byLine}${barSvg}${pro}${pw}${ticks}</svg>
      <div class="row gap12 esgleg"><span><i class="esgsw" data-l="bar"></i>${esc(t('esg.nz.lgActual'))}</span><span><i class="esgsw" data-l="pro"></i>${esc(t('esg.nz.lgPro'))}</span>${P && P.pathway ? `<span><i class="esgsw" data-l="pw"></i>${esc(t('esg.nz.lgPath', { y: nz }))}</span>` : ''}</div>
      <p class="tCap esgfoot" data-basis="emission">${esc(P && P.pathway ? t('esg.nz.chartCap', { y: nz }) + ' · ' + t('esg.nz.src', { s: t('esg.nz.src.' + (P.pathway.source || 'partner')) }) + (P.pathway.kind === 'intensity' ? ' · ' + t('esg.nz.intPath') : '') : t('esg.noPathway'))} · ${factorChip(g)}</p>`;
    const p = period('ytd'), kwh = sum(p, 'kwh'), gas = sum(p, 'gasM3');
    const refs = refrigerant().entries.filter(e => monthStart(monthOffsetOf(now() - e.agoD * DAY)).getFullYear() === y);
    const refKg = refs.reduce((s, e) => s + e.kg, 0);
    const chk = refrigerant().checkedAt ? E.fxMs(refrigerant().checkedAt) : null;
    const s2 = kwh != null && g ? kwh * g.v / 1000 : null, s1g = gas != null && fuel ? gas * fuel.v / 1000 : null, s1r = gwp ? refKg * gwp.v / 1000 : null;
    const line = (lbl, q, qu, tco2, f, extra) => `<div class="esgsl"><div class="row gap8"><span class="grow">${esc(lbl)}</span><span class="tMonoS">${q}</span></div>
      <div class="row gap8"><span class="grow tCap">${esc(extra || '')}</span><span class="tMonoS" data-basis="emission" data-tip="${esc(factorLine(f))}">${val({ v: tco2, dp: 1, unit: 'tCO2e', why: f ? t('esg.why.noData') : t('esg.noFactor') })}</span></div>
      <p class="tCap esgfl" data-basis="emission">${factorChip(f)}</p></div>`;
    const s2card = card(t('esg.nz.s2'), p.label, line(t('esg.nz.elec'), val({ v: kwh, dp: 0, unit: 'kWh' }), '', s2, g, t('esg.nz.elecSrc'))
      + `<div class="esgsl"><div class="row gap8"><span class="grow">${esc(t('esg.nz.dc'))}</span>${val({ v: null, why: t('esg.why.noDc'), whyShow: true })}</div></div>`);
    const ncLine = lbl => `<div class="esgsl"><div class="row gap8"><span class="grow">${esc(lbl)}</span>${val({ v: null, why: t('esg.why.notConf'), whyShow: true })}</div></div>`;
    const s1card = card(t('esg.nz.s1'), p.label, (nc('fuel') ? ncLine(t('esg.nz.gas')) : line(t('esg.nz.gas'), val({ v: gas, dp: 0, unit: 'm³' }), '', s1g, fuel, t('esg.nz.gasSrc')))
      + (nc('refrigerant') ? ncLine(t('esg.nz.ref')) : line(t('esg.nz.ref'), val({ v: refKg, dp: 1, unit: 'kg', at: refKg === 0 ? chk : null }), '', s1r, gwp, t('esg.nz.refSrc')))
      + (nc('fuel') || nc('refrigerant') ? `<p class="tCap">${esc(t('esg.nz.s2only'))}</p>` : ''));
    /* contribution by system, Scope 2: the system benchmark submeters (Wh/m² by system); one hue, an intensity ramp */
    const bench = ((E.data.bench || {}).rows) || [], map = ((D() || {}).systems || {}).map || {};
    const grp = {}; bench.forEach(b => { const k = map[b.sysEn] || 'rest'; grp[k] = (grp[k] || 0) + b.whm2; });
    const tot = Object.values(grp).reduce((s, v) => s + v, 0);
    const sys = ['hvac', 'lighting', 'rest'].filter(k => grp[k] != null).map(k => ({ k, sh: grp[k] / tot }));
    const smax = Math.max(...sys.map(s => s.sh), 0.0001);
    const contrib = card(t('esg.nz.contrib'), t('esg.nz.contribCap'), sys.length && s2 != null ? `<div class="esgcontrib">${sys.map(s => `<div class="esgcrow">
        <span class="esgcn">${esc(t('esg.sys.' + s.k))}</span><span class="esgcbar"><span style="width:${(s.sh / smax * 100).toFixed(1)}%;opacity:${(0.35 + 0.65 * s.sh / smax).toFixed(2)}"></span></span>
        <span class="tMonoS" data-basis="emission" data-tip="${esc(factorLine(g))}">${esc(fmt(s2 * s.sh, 1))} tCO2e</span><span class="tMonoS cT3" data-tip="${esc(t('esg.pctBasis.sys'))}">${esc(fmt(s.sh * 100, 0))}%</span></div>`).join('')}</div>
        <p class="tCap">${esc(t('esg.nz.contribNote'))}</p>` : `<p class="alempty">${esc(t('esg.why.noData'))}</p>`);
    /* the cost of the gap to the baseline: executive lens only */
    let gapCard = '';
    if(exec()){
      const tb = tariff(), A = area(), base = P && P.kpis.energyIntensity ? P.kpis.energyIntensity.v : null;
      const baseKwh = base != null && A ? base * A * p.share : null, gapKwh = kwh != null && baseKwh != null ? kwh - baseKwh : null;
      const aed = gapKwh != null && gapKwh > 0 && tb ? gapKwh * tb.rate : null, open = !!E.state.esgGapOpen;
      gapCard = card(t('esg.nz.gapT'), p.label, gapKwh == null ? `<p class="alempty">${esc(t('esg.noBase'))}</p>` : `<button class="esggapbtn" data-act="esgGap" aria-expanded="${open}">
          <span class="grow taS">${gapKwh > 0 ? `<b data-basis="tariff" data-tip="${esc(tariffLine(tb))}">AED ${esc(fmt(aed, 0))}</b> ${esc(t('esg.nz.gapAbove'))}` : esc(t('esg.nz.gapBelow'))}</span>${dicon(open ? 'up' : 'down', 12)}</button>
        ${open ? `<dl class="esgdl"><dt>${esc(t('esg.nz.gapActual'))}</dt><dd class="tMonoS">${esc(fmt(kwh, 0))} kWh</dd><dt>${esc(t('esg.nz.gapBase', { b: fmt(base, 0), s: fmt(p.share * 100, 0) }))}</dt><dd class="tMonoS">${esc(fmt(baseKwh, 0))} kWh</dd>
          <dt>${esc(t(gapKwh > 0 ? 'esg.nz.gapKwh' : 'esg.nz.gapKwhBelow'))}</dt><dd class="tMonoS">${esc(fmt(Math.abs(gapKwh), 0))} kWh</dd><dt>${esc(t('esg.nz.gapTier'))}</dt><dd class="tCap" data-basis="tariff">${esc(tariffLine(tb))} · ${esc(t('esg.nz.gapOneTier'))}</dd>
          <dt>${esc(t('esg.nz.gapAed'))}</dt><dd class="tMonoS" data-basis="tariff">${gapKwh > 0 ? 'AED ' + esc(fmt(aed, 2)) : esc(t('esg.nz.gapNone'))}</dd></dl>` : ''}`);
    }
    const heroes = [
      tile(t('esg.k.carbon'), `<span data-basis="emission" data-tip="${esc(factorLine(g))}">${val({ v: yp.actual, dp: 1, unit: 'tCO2e', why: t('esg.why.noFactor') })}</span>`, p.label, yp.gap == null ? '' : pctChip(yp.gap, t('esg.ref.pathway'))),
      tile(t('esg.nz.proT'), `<span data-basis="emission">${val({ v: yp.pro, dp: 1, unit: 'tCO2e', why: t('esg.noPathway') })}</span>`, yp.pw == null ? t('esg.noPathway') : t('esg.nz.proCap', { v: fmt(yp.pw, 1), s: fmt(p.share * 100, 0) }), '', t('esg.shareTip'), 'emission'),
      tile(t('esg.nz.nzT'), `<span class="ovknum">${P && P.pathway ? nz : esc(t('emptyDash'))}</span>`, P && P.pathway ? t('esg.nz.nzCap', { role: E.person(P.assessorRole) }) : t('esg.noPathway'))];
    const sy = stranding();   /* B8: only when an intensity pathway is loaded */
    /* D177 ruling 4: the stranding year is labelled with its source wherever it shows */
    if(sy){ const src = sy.standIn ? t('esg.nz.strandSrc', { v: sy.ver }) : t('esg.nz.strandSrcPack', { v: sy.ver });
      heroes.push(tile(t('esg.nz.strandT'), `<span class="ovknum">${sy.year != null ? sy.year : esc(t('emptyDash'))}</span>`, (sy.year != null ? t('esg.nz.strandCap') : t('esg.nz.strandNone', { y: sy.nz })),
        `<span class="pwchip" data-tone="t3">${esc(src)}</span>`, src + '. ' + t('esg.nz.strandTip', { v: sy.cur == null ? t('emptyDash') : fmt(sy.cur, 1) }), 'emission')); }
    return pageWrap('esg-nz', heroes, provBar() + card(t(nc('fuel') && nc('refrigerant') ? 'esg.nz.chartTS2' : 'esg.nz.chartT'), t('esg.nz.scope'), chart)
      + `<div class="esggrid2">${s2card}${s1card}</div>` + contrib + gapCard + registerCard());
  }

  /* D176 B1: the reduction measures register, a section of Net Zero and Decarbonization (no new rail item) */
  const mPill = st => `<span class="esgpill" data-st="${st === 'verified' ? 'on' : st === 'partly' || st === 'notRecovered' ? 'off' : 'nobase'}"><span class="esgdot" aria-hidden="true"></span>${esc(t('esg.m.st.' + st))}</span>`;
  function registerCard(){
    const ms = measures(), money = exec();
    if(!ms.length) return card(t('esg.m.T'), t('esg.m.cap'), `<p class="alempty">${esc(t('esg.m.none'))}</p>`);
    const verCell = m => m.v ? (m.verKwh != null ? `<span class="tMonoS" data-tip="${esc(m.v.methodText)}">${esc(t('esg.m.ver', { k: fmt(m.verKwh, 0), u: m.verUnc == null ? t('emptyDash') : fmt(m.verUnc, 0) }))}</span>`
        : m.v.outcome === 'tooEarly' ? `<span class="tCap">${esc(t('esg.m.tooEarly'))}</span>`
        : `<span class="tCap" data-tip="${esc(m.v.methodText)}">${esc(t('esg.m.band', { i: fmt(m.v.improvement, 2), b: fmt(m.v.uncertainty, 2), u: m.v.unit }))}</span>`) : `<span class="tCap">${esc(t('esg.m.notYet'))}</span>`;
    const rows = ms.map(m => `<tr class="esgrow" data-act="esgMeasure" data-v="${esc(m.id)}" tabindex="0" role="button" aria-label="${esc(m.id + ', ' + L(m.titleEn, m.titleAr))}">
        <th scope="row"><span class="esgkn">${esc(L(m.titleEn, m.titleAr))}</span><span class="tCap">${esc(m.id + (m.asset ? ' · ' + m.asset : ''))}</span></th>
        <td class="tCap">${esc(t('esg.m.src.' + m.source))}</td>
        <td><span class="tCap esgvby esgestmo" data-tip="${esc(t('esg.m.estMoTip'))}">${esc(t('esg.m.estMo', { k: fmt(m.est.kwhYr / 12, 0) }))}</span><span class="tMonoS" data-basis="emission" data-tip="${esc(L(m.est.methodEn, m.est.methodAr))}">${esc(t('esg.m.estLine', { k: fmt(m.est.kwhYr, 0), c: fmt(m.est.tco2eYr, 1) }))}</span>${money ? `<span class="tMonoS esgvby" data-basis="tariff" data-tip="${esc(L(m.est.methodEn, m.est.methodAr))}">AED ${esc(fmt(m.est.aedYr, 0))}</span>` : ''}</td>
        ${money ? `<td><span class="tMonoS">AED ${esc(fmt(m.capexAed, 0))}</span>${m.payback != null ? `<span class="tCap esgvby" data-tip="${esc(t('esg.m.payback', { y: fmt(m.payback, 1) }))}">${esc(t('esg.m.payback', { y: fmt(m.payback, 1) }))}</span>` : ''}</td>` : ''}
        <td class="tCap">${esc(roleLbl(m.ownerRole))}</td>
        <td>${mPill(m.st)}</td>
        <td>${m.wo ? `<button class="statlink" data-act="esgWo" data-asset="${esc(m.asset || '')}" data-v="${esc(m.wo)}">${esc(m.wo)}</button>` : esc(t('emptyDash'))}</td>
        <td>${verCell(m)}</td></tr>`).join('');
    const est = ms.filter(m => m.st !== 'rejected'), ver = ms.filter(m => m.verKwh != null);
    const totals = `<p class="esgtot"><b data-basis="emission" data-tip="${esc(factorLine(grid()))}">${esc(t('esg.m.totEst', { k: fmt(est.reduce((a, m) => a + m.est.kwhYr, 0), 0), c: fmt(est.reduce((a, m) => a + m.est.tco2eYr, 0), 1) }))}</b>${money ? ' · <span data-basis="tariff">' + esc(t('esg.m.totEstAed', { a: fmt(est.reduce((a, m) => a + m.est.aedYr, 0), 0) })) + '</span>' : ''}</p>
      <p class="esgtot"><b>${esc(t('esg.m.totVer', { k: fmt(ver.reduce((a, m) => a + m.verKwh, 0), 0), n: ver.length }))}</b></p><p class="tCap">${esc(t('esg.m.never'))}</p>`;
    return card(t('esg.m.T'), t('esg.m.cap'), `<div class="esgtblwrap"><table class="esgtbl esgreg"><thead><tr><th scope="col">${esc(t('esg.m.measure'))}</th><th scope="col">${esc(t('esg.m.source'))}</th><th scope="col">${esc(t('esg.m.est'))}</th>${money ? `<th scope="col">${esc(t('esg.m.capex'))}</th>` : ''}
      <th scope="col">${esc(t('esg.m.owner'))}</th><th scope="col">${esc(t('esg.m.status'))}</th><th scope="col">${esc(t('esg.m.wo'))}</th><th scope="col">${esc(t('esg.m.verified'))}</th></tr></thead><tbody>${rows}</tbody></table></div>${totals}`, 'esgregcard');
  }
  function measureDialog(id){
    const m = measures().find(x => x.id === id); if(!m) return '';
    const money = exec(), v = m.v, cfgP = window.EKO_PROVE && window.EKO_PROVE.cfg ? window.EKO_PROVE.cfg(E) : {};
    const ver = v ? `<dl class="esgdl"><dt>${esc(t('esg.m.status'))}</dt><dd>${esc(t('esg.m.st.' + m.st))}${v.outcome === 'tooEarly' ? ' · ' + esc(t('esg.m.tooEarly')) : ''}</dd>
        <dt>${esc(t('esg.m.verified'))}</dt><dd class="tMonoS">${esc(m.verKwh != null ? t('esg.m.ver', { k: fmt(m.verKwh, 0), u: m.verUnc == null ? t('emptyDash') : fmt(m.verUnc, 0) }) : v.kwhMo == null ? t('esg.m.verNoKwh') : t('esg.m.notYet'))}</dd>
        <dt>${esc(t('esg.dlg.basis'))}</dt><dd>${esc(t('esg.m.band', { i: fmt(v.improvement, 2), b: isFinite(v.uncertainty) ? fmt(v.uncertainty, 2) : t('emptyDash'), u: v.unit }))}</dd>
        <dt>${esc(t('esg.m.window'))}</dt><dd>${esc(t('esg.m.winTxt', { b: cfgP.beforeDays || t('emptyDash'), a: cfgP.afterDays || t('emptyDash') }))}</dd>
        <dt>${esc(t('esg.m.method'))}</dt><dd>${esc(v.methodText)}</dd></dl>` : `<p class="tCap">${esc(t('esg.m.notYet'))}</p>`;
    return dlgShell(m.id + ' · ' + L(m.titleEn, m.titleAr), `<div class="esggrid2"><div><h4 class="tLbl">${esc(t('esg.m.dlgEst'))}</h4><dl class="esgdl">
        <dt>${esc(t('esg.m.source'))}</dt><dd>${esc(t('esg.m.src.' + m.source))}</dd>
        <dt>${esc(t('esg.m.estMoT'))}</dt><dd class="tCap" data-tip="${esc(t('esg.m.estMoTip'))}">${esc(t('esg.m.estMo', { k: fmt(m.est.kwhYr / 12, 0) }))}</dd>
        <dt>${esc(t('esg.m.est'))}</dt><dd class="tMonoS" data-basis="emission">${esc(t('esg.m.estLine', { k: fmt(m.est.kwhYr, 0), c: fmt(m.est.tco2eYr, 1) }))}${money ? ' · <span data-basis="tariff">AED ' + esc(fmt(m.est.aedYr, 0)) + '</span>' : ''}</dd>
        <dt>${esc(t('esg.m.method'))}</dt><dd>${esc(L(m.est.methodEn, m.est.methodAr))}</dd>
        ${money ? `<dt>${esc(t('esg.m.capex'))}</dt><dd class="tMonoS">AED ${esc(fmt(m.capexAed, 0))}${m.payback != null ? ' · ' + esc(t('esg.m.payback', { y: fmt(m.payback, 1) })) : ''}</dd>` : ''}
        <dt>${esc(t('esg.m.owner'))}</dt><dd>${esc(roleLbl(m.ownerRole))}</dd>
        <dt>${esc(t('esg.m.wo'))}</dt><dd>${m.wo ? `<button class="statlink" data-act="esgWo" data-asset="${esc(m.asset || '')}" data-v="${esc(m.wo)}">${esc(t('esg.m.openWo'))}: ${esc(m.wo)}</button>` : esc(t('emptyDash'))}</dd></dl></div>
      <div><h4 class="tLbl">${esc(t('esg.m.dlgVer'))}</h4>${ver}</div></div>${noteBlock('measure:' + m.id)}`, 'esgdlgm');
  }

  /* 3. UTILITY BILL MANAGEMENT */
  function billsPage(E2){
    use(E2);
    const bl = bills(), tb = tariff(), d = D() || {}, cap = d.capture || { routes: {} }, sub = subState();
    const tolTxt = t('esg.b.tol', { p: fmt(tol().billPct, 1) }) + (tolIsDefault('billPct') ? ' ' + t('esg.default') : '');
    const tolHtml = `<span data-tip="${esc(t('esg.tolTip'))}">${esc(tolTxt)}</span>`;
    const rows = bl.map(b => `<tr class="esgrow" data-act="esgBill" data-v="${esc(b.id)}" tabindex="0" role="button">
        <th scope="row">${esc(t('esg.util.' + b.utility))}</th><td>${esc(b.label)}</td>
        <td>${val({ v: b.billed, dp: 0, unit: b.unit, why: t('esg.why.noBill') })}</td><td>${val({ v: b.metered, dp: 0, unit: b.unit })}</td>
        <td data-tip="${esc(t('esg.pctBasis.bill'))}">${b.varPct == null ? val({ v: null, why: t('esg.why.noBill') }) : `<span class="tMonoS">${esc((b.varPct > 0 ? '+' : '') + fmt(b.varPct, 1))}%</span>`}</td>
        <td><span class="esgpill" data-st="${b.st === 'matched' ? 'on' : b.st === 'missing' ? 'nobase' : 'off'}"><span class="esgdot" aria-hidden="true"></span>${esc(b.st === 'variance' && b.explain ? t('esg.bst.varWhy', { x: lc(t('esg.b.expl.' + b.explain)) }) : t('esg.bst.' + b.st))}</span></td>
        <td>${b.missing ? esc(t('emptyDash')) : `<span class="tMonoS" data-tip="${esc(t('esg.b.recTip') + ': ' + t('esg.daysAgo', { n: b.recAgeD }))}">${esc(t('esg.dAgo', { n: b.recAgeD }))}</span>`}</td>
        ${exec() ? `<td>${b.utility === 'electricity' && b.billed != null && tb ? `<span class="tMonoS" data-basis="tariff" data-tip="${esc(tariffLine(tb))}">AED ${esc(fmt((b.billed - b.metered) * tb.rate, 0))}</span>` : val({ v: null, why: b.utility === 'water' ? t('esg.why.noWaterTariff') : t('esg.why.noBill') })}</td>` : ''}</tr>`).join('');
    const dc = `<tr><th scope="row">${esc(t('esg.util.dc'))}</th><td colspan="${exec() ? 7 : 6}">${val({ v: null, why: t('esg.why.noDc'), whyShow: true })}</td></tr>`;
    const table = `<div class="esgtblwrap"><table class="esgtbl esgbills"><thead><tr><th scope="col">${esc(t('esg.b.util'))}</th><th scope="col">${esc(t('esg.b.period'))}</th><th scope="col">${esc(t('esg.b.billed'))}</th><th scope="col">${esc(t('esg.b.metered'))}</th><th scope="col">${esc(t('esg.b.var'))}</th><th scope="col">${esc(t('esg.col.status'))}</th><th scope="col">${esc(t('esg.b.rec'))}</th>${exec() ? `<th scope="col">${esc(t('esg.b.varAed'))}</th>` : ''}</tr></thead><tbody>${rows}${dc}</tbody></table></div>
      <p class="tCap">${tolHtml} · ${esc(t('esg.b.meteredNote'))}</p>`;
    const routes = ['upload', 'mailbox', 'feed'].map(r => `<li class="esgroute"><span class="grow">${esc(t('esg.b.route.' + r))}</span><span class="esgpill" data-st="${cap.routes[r] ? 'on' : 'nobase'}"><span class="esgdot" aria-hidden="true"></span>${esc(t(cap.routes[r] ? 'esg.b.cfg' : 'esg.b.notCfg'))}</span></li>`).join('');
    const lastCap = (sub.captures || []).slice(-1)[0];
    const ingest = card(t('esg.b.ingT'), '', `<ul class="dglist">${routes}</ul>
      <p class="tCap">${esc(lastCap ? t('esg.b.lastCapFile', { d: isoLbl(lastCap.date), f: lastCap.name }) : t('esg.b.lastCap', { d: dayLbl(now() - (cap.lastAgoD || 0) * DAY), r: t('esg.b.route.' + (cap.lastRoute || 'upload')) }))}</p>
      ${isPartner() ? '' : `<label class="esgupl"><span class="btnG btnSm">${icon('plus', 13)} ${esc(t('esg.b.upload'))}</span><input type="file" accept=".pdf,image/*" data-chg="esgUpload" class="esgfile" aria-label="${esc(t('esg.b.upload'))}"></label>`}
      <p class="tCap">${esc(t('esg.b.routesNote'))}</p>`);
    const heroes = [
      tile(t('esg.b.hMatched'), `<span class="ovknum">${bl.filter(b => b.st === 'matched').length}</span>`, t('esg.b.hOf', { n: bl.length })),
      tile(t('esg.b.hVar'), `<span class="ovknum">${bl.filter(b => b.st === 'variance' || b.st === 'estimated').length}</span>`, tolTxt, '', t('esg.tolTip')),
      tile(t('esg.b.hMissing'), `<span class="ovknum">${bl.filter(b => b.st === 'missing').length}</span>`, t('esg.b.hMissingCap'))];
    const ncCard = (T, k) => card(T, '', val({ v: null, why: t(k), whyShow: true }));
    if(nc('bills')) return pageWrap('esg-bills', [], `<div class="esgcols"><div class="esgmain">${ncCard(t('esg.b.tableT'), 'esg.why.notConfBills')}${wasteCard()}</div></div>`);
    return pageWrap('esg-bills', heroes, `<div class="esgcols"><div class="esgmain">${card(t('esg.b.tableT'), t('esg.b.tableCap'), table)}${wasteCard()}</div><div class="esgside">${ingest}</div></div>`);
  }
  /* D176 B6: operational waste, a monthly manual entry with an optional hauler report */
  function wasteCard(){
    if(nc('waste')) return card(t('esg.w.T'), '', val({ v: null, why: t('esg.why.notConfWaste'), whyShow: true }), 'esgwaste');
    const wl = wasteList().slice(-6).reverse(), canEdit = !isPartner();
    const rows = wl.map(w => `<tr><th scope="row">${esc(monthLbl(w.o))}</th><td>${val({ v: w.totalKg, dp: 0, unit: 'kg' })}</td><td>${val({ v: w.divertedKg, dp: 0, unit: 'kg' })}</td>
        <td data-tip="${esc(t('esg.pctBasis.ratio'))}">${w.totalKg ? `<span class="tMonoS">${esc(fmt(w.divertedKg / w.totalKg * 100, 1))}%</span>` : esc(t('emptyDash'))}</td></tr>`).join('');
    const opts = [-1, -2, -3].map(o => `<option value="${o}">${esc(monthLbl(o))}</option>`).join('');
    return card(t('esg.w.T'), t('esg.w.cap'), `<div class="esgtblwrap"><table class="esgtbl"><thead><tr><th scope="col">${esc(t('esg.w.month'))}</th><th scope="col">${esc(t('esg.w.total'))}</th><th scope="col">${esc(t('esg.w.div'))}</th><th scope="col">${esc(t('esg.w.rate'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="tCap">${esc(t('esg.w.manual'))}</p>
      ${canEdit ? `<div class="esgwform"><label class="rpfld"><span class="tCap">${esc(t('esg.w.month'))}</span><select class="rpf esgwm" aria-label="${esc(t('esg.w.month'))}">${opts}</select></label>
        <label class="rpfld"><span class="tCap">${esc(t('esg.w.total'))}</span><input type="number" min="0" step="1" class="dgfin esgwt" aria-label="${esc(t('esg.w.total'))}"></label>
        <label class="rpfld"><span class="tCap">${esc(t('esg.w.div'))}</span><input type="number" min="0" step="1" class="dgfin esgwd" aria-label="${esc(t('esg.w.div'))}"></label>
        <label class="rpfld"><span class="tCap">${esc(t('esg.w.attach'))}</span><input type="file" accept=".pdf,image/*" class="esgwr" aria-label="${esc(t('esg.w.attach'))}"></label>
        <button class="btnG btnSm" data-act="esgWasteSave">${esc(t('esg.w.save'))}</button></div>` : ''}`, 'esgwaste');
  }
  function billDialog(id){
    const b = bills().find(x => x.id === id); if(!b) return '';
    const tb = tariff(), m = mo(b.o), sub = subState();
    const q = (sub.queries || []).find(x => x.bill === b.id);
    const EXPL = ['meterReset', 'estimatedRead', 'tierMismatch', 'missingSubmeter'];
    const series = m ? `<p class="tCap">${esc(t('esg.b.seriesCap', { m: b.label }))}</p><div class="row gap8"><span class="grow">${esc(t('esg.b.metered'))}</span>${val({ v: b.metered, dp: 0, unit: b.unit })}</div>` : '';
    const fields = b.missing ? `<p class="alempty">${esc(t('esg.b.missingNote', { m: b.label }))}</p>` : `<dl class="esgdl">
        <dt>${esc(t('esg.b.fAccount'))}</dt><dd>${esc(((D() || {}).billDoc || {}).accountEn || t('emptyDash'))}</dd>
        <dt>${esc(t('esg.b.fPeriod'))}</dt><dd>${esc(dayLbl(monthStart(b.o).getTime()) + ' ' + t('esg.to') + ' ' + dayLbl(monthStart(b.o + 1).getTime() - DAY))}</dd>
        <dt>${esc(t('esg.b.billed'))}</dt><dd class="tMonoS">${esc(fmt(b.billed, 0) + ' ' + b.unit)}</dd>
        <dt>${esc(t('esg.b.fRead'))}</dt><dd>${esc(t('esg.b.read.' + b.read))}</dd>
        ${exec() && b.utility === 'electricity' && tb ? `<dt>${esc(t('esg.b.fAmount'))}</dt><dd class="tMonoS" data-basis="tariff" data-tip="${esc(tariffLine(tb))}">AED ${esc(fmt(b.billed * tb.rate, 2))}</dd>` : ''}</dl>`;
    const expl = b.explain ? `<h4 class="tLbl">${esc(t('esg.b.explT'))}</h4><ul class="dglist">${EXPL.map(x => `<li class="esgexpl" data-on="${x === b.explain}">${x === b.explain ? icon('check', 12) : ''}<span>${esc(t('esg.b.expl.' + x))}</span></li>`).join('')}</ul>` : '';
    return dlgShell(t('esg.util.' + b.utility) + ' · ' + b.label, `${fields}${series}
      ${b.varPct != null ? `<div class="row gap8"><span class="grow">${esc(t('esg.b.var'))}</span><span class="tMonoS" data-tip="${esc(t('esg.pctBasis.bill'))}">${esc((b.varPct > 0 ? '+' : '') + fmt(b.varPct, 1))}%</span></div>` : ''}
      ${expl}
      <div class="row gap8 esgdlgact">${q ? `<p class="tCap grow">${esc(t('esg.b.queryDone', { d: isoLbl(q.date) }))}</p>` : `<span class="grow"></span>${isPartner() ? '' : `<button class="btnG btnSm" data-act="esgQuery" data-v="${esc(b.id)}">${esc(t('esg.b.query'))}</button>`}`}</div>
      <p class="tCap">${esc(t('esg.b.queryNote'))}</p>`, 'esgdlgbill');
  }

  /* 4. AIR QUALITY AND IEQ — a reporting roll-up; live comfort stays in Spaces */
  function ieqPage(E2){
    use(E2);
    const pid = E.state.esgIeqPer || '7d', rows = ieqRows(pid), B = bands(), ieq = (D() || {}).ieq || {};
    const seg = ['7d', '30d'].map(p => `<button class="seg" data-on="${pid === p}" aria-pressed="${pid === p}" data-act="esgIeqPer" data-v="${p}">${esc(t('esg.ieq.per.' + p))}</button>`).join('');
    const c = (v, r, k) => { const cause = r.out.includes(k);
      const h = r.staleH && r.staleH > staleH() ? val({ v, dp: 1, unit: '%', ageH: r.staleH, tip: t('esg.ieq.staleTip') }) : val({ v, dp: 1, unit: '%', why: t('esg.why.noSensor'), tip: t('esg.pctBasis.occ') });
      return `<td${cause ? ' class="esgcause"' : ''}>${h}</td>`; };
    const tr = rows.map(r => `<tr${r.persistent ? ' data-exc="1"' : ''}${r.notAssessed ? ' data-na="1"' : ''}><th scope="row"><button class="statlink esgzl" data-act="esgSpaces" data-v="${esc(r.zone)}" data-tip="${esc(t('esg.ieq.open'))}">${esc(zoneName(r.zone))}</button></th><td class="tCap">${esc(t('esg.sp.' + r.type))}</td>
        ${r.notAssessed ? `<td colspan="5">${val({ v: null, why: t('esg.ieq.notAssessed', { t: lc(t('esg.sp.' + r.type)) }), whyShow: true })}</td>`
          : `${c(r.p.co2, r, 'co2')}${c(r.p.temp, r, 'temp')}${c(r.p.rh, r, 'rh')}${c(r.p.pm25, r, 'pm25')}
        <td>${r.persistent ? `<span class="esgpill" data-st="off" data-tip="${esc(t('esg.pctBasis.occ'))}"><span class="esgdot" aria-hidden="true"></span>${esc(t('esg.ieq.excWhy', { k: t('esg.ieq.param.' + r.cause), p: fmt(r.exc, 1) }))}</span>` : `<span class="tCap">${esc(t('esg.ieq.noExc'))}</span>`}</td>`}</tr>`).join('');
    const exT = t('esg.ieq.excRule', { p: fmt(tol().excursionPct, 0) }) + (tolIsDefault('excursionPct') ? ' ' + t('esg.default') : '');
    const table = rows.length ? `<div class="esgtblwrap"><table class="esgtbl esgieq"><thead><tr><th scope="col">${esc(t('esg.ieq.zone'))}</th><th scope="col">${esc(t('esg.ieq.type'))}</th><th scope="col">${esc(t('esg.ieq.co2'))}</th><th scope="col">${esc(t('esg.ieq.temp'))}</th><th scope="col">${esc(t('esg.ieq.rh'))}</th><th scope="col">${esc(t('esg.ieq.pm'))}</th><th scope="col">${esc(t('esg.ieq.flag'))}</th></tr></thead><tbody>${tr}</tbody></table></div>
      <p class="tCap">${esc(t('esg.ieq.occByType'))} · <span data-tip="${esc(t('esg.tolTip'))}">${esc(exT)}</span></p>` : `<p class="alempty">${esc(t('esg.why.noSensor'))}</p>`;
    const bsrc = B.src === 'pack' ? t('esg.ieq.bandsPack', { v: B.pack.version, role: E.person(B.pack.assessorRole) }) : t('esg.ieq.bandsDefault');
    const bl = B.src === 'pack' ? (B.std ? t('esg.ieq.fromPackStd', { s: B.std }) : t('esg.ieq.fromPack')) : t('esg.ieq.ekoDefault');
    const typeRows = spaceTypes().map(ty => { const b = bandFor(ty), o = occFor(ty);
      return `<tr><th scope="row">${esc(t('esg.sp.' + ty))}</th><td class="tCap">${esc(b ? (b.src === 'pack' ? t('esg.ieq.srcPack') : t('esg.ieq.srcDefault')) : t('esg.ieq.notAssessedShort'))}</td><td class="tCap">${esc(b ? o.s : t('emptyDash'))}</td></tr>`; }).join('');
    const bandsCard = card(t('esg.ieq.bandsT'), bsrc, `<dl class="esgdl"><dt>${esc(t('esg.ieq.bTemp'))}</dt><dd class="tMonoS" data-tip="${esc(t('esg.bandTip'))}">${esc(fmt(B.v.tempC[0], 1) + ' ' + t('esg.to') + ' ' + fmt(B.v.tempC[1], 1) + ' °C')}</dd>
      <dt>${esc(t('esg.ieq.bRh'))}</dt><dd class="tMonoS" data-tip="${esc(t('esg.bandTip'))}">${esc(fmt(B.v.rhPct[0]) + ' ' + t('esg.to') + ' ' + fmt(B.v.rhPct[1]) + ' %')}</dd>
      <dt>${esc(t('esg.ieq.bCo2'))}</dt><dd class="tMonoS">${esc(t('esg.ieq.atMost', { v: fmt(B.v.co2Ppm), u: 'ppm' }))}</dd>
      <dt>${esc(t('esg.ieq.bPm'))}</dt><dd class="tMonoS">${esc(t('esg.ieq.atMost', { v: fmt(B.v.pm25), u: 'µg/m³' }))}</dd></dl>
      <p class="tCap esgbandsrc">${esc(bl)}</p>
      <div class="esgtblwrap"><table class="esgtbl esgtypes"><thead><tr><th scope="col">${esc(t('esg.ieq.type'))}</th><th scope="col">${esc(t('esg.ieq.bandCol'))}</th><th scope="col">${esc(t('esg.ieq.occCol'))}</th></tr></thead><tbody>${typeRows}</tbody></table></div>`);
    const oa = (ieq.oa || []).map(o => `<tr><th scope="row">${esc(o.ahu)}</th><td>${val({ v: o.measuredLs, dp: 0, unit: 'L/s', why: t('esg.why.noOa') })}</td><td>${val({ v: o.requiredLs, dp: 0, unit: 'L/s', why: t('esg.why.noReq') })}${o.requiredSrc ? ` <span class="tCap">${esc(t('esg.ieq.req.' + o.requiredSrc))}</span>` : ''}</td>
        <td data-tip="${esc(t('esg.pctBasis.oa'))}">${o.measuredLs != null && o.requiredLs ? `<span class="tMonoS">${esc(fmt(o.measuredLs / o.requiredLs * 100, 0))}%</span>` : esc(t('emptyDash'))}</td></tr>`).join('');
    const oaCard = card(t('esg.ieq.oaT'), t('esg.ieq.oaCap'), `<div class="esgtblwrap"><table class="esgtbl"><thead><tr><th scope="col">${esc(t('esg.ieq.ahu'))}</th><th scope="col">${esc(t('esg.ieq.meas'))}</th><th scope="col">${esc(t('esg.ieq.reqd'))}</th><th scope="col">${esc(t('esg.ieq.ratio'))}</th></tr></thead><tbody>${oa}</tbody></table></div>`);
    const head = `<div class="row gap8 esgper"><span class="tCap">${esc(t('esg.period'))}</span><span class="segbox row" role="group" aria-label="${esc(t('esg.period'))}">${seg}</span><span class="grow"></span><span class="tCap">${esc(t('esg.ieq.liveNote'))}</span><button class="statlink" data-act="esgSpaces" data-v="">${esc(t('esg.ieq.openSpaces'))}</button></div>`;
    return pageWrap('esg-ieq', [], head + card(t('esg.ieq.tableT'), t('esg.ieq.tableCap'), table) + `<div class="esggrid2">${oaCard}${bandsCard}</div>`);
  }

  /* 5. REPORTING — packs prepared from live data; a person submits them */
  function reportingPage(E2){
    use(E2);
    const cal = calendar(), sel = E.state.esgFw && FW.includes(E.state.esgFw) ? E.state.esgFw : (cal[0] || {}).fw, sub = subState();
    const rows = cal.map(c => { const dl = daysLeft(c.due), rd = readiness(c.fw), v = verification(c.fw), s = submitted(c.fw);
      return `<tr data-on="${c.fw === sel}"${!s && dl != null && dl >= 0 && dl <= 14 ? ' data-due="1"' : ''}><th scope="row"><button class="statlink" data-act="esgFw" data-v="${c.fw}">${esc(t('esg.fw.' + c.fw))}</button></th><td>${esc(c.period)}</td><td>${esc(isoLbl(c.due))}</td>
        <td>${s ? esc(t('emptyDash')) : `<span class="tMonoS esgdl14">${esc(dl < 0 ? t('esg.r.overdue', { n: -dl }) : t('esg.r.daysLeft', { n: dl }))}</span>`}</td>
        ${s ? `<td data-tip="${esc(t('esg.r.readyAtSubTip'))}">${s.readinessPct != null ? `<span class="tMonoS">${esc(fmt(s.readinessPct, 0))}%</span><span class="tCap esgvby">${esc(t('esg.r.atSub', { d: isoLbl(s.date) }))}</span>` : esc(t('emptyDash'))}</td>`
          : `<td data-tip="${esc(t('esg.pctBasis.ready', { n: rd ? rd.n : 0, of: rd ? rd.of : 0 }))}">${rd ? `<span class="tMonoS">${esc(fmt(rd.pct, 0))}%</span>` : esc(t('emptyDash'))}</td>`}
        <td>${esc(t('esg.v.' + v.status))}${v.status !== 'notReviewed' && v.role ? `<span class="tCap esgvby">${esc(t('esg.v.by', { role: E.person(v.role), d: isoLbl(v.date) }))}</span>` : ''}</td>
        <td>${s ? `<span class="tMonoS">${esc(isoLbl(s.date))}</span><span class="tCap esgvby">${esc(whoOf(s))}</span>` : esc(t('emptyDash'))}</td></tr>`; }).join('');
    const calCard = card(t('esg.r.calT'), t('esg.r.calCap'), cal.length ? `<div class="esgtblwrap"><table class="esgtbl esgcal"><thead><tr><th scope="col">${esc(t('esg.r.fw'))}</th><th scope="col">${esc(t('esg.r.period'))}</th><th scope="col">${esc(t('esg.r.due'))}</th><th scope="col">${esc(t('esg.r.left'))}</th><th scope="col">${esc(t('esg.r.ready'))}</th><th scope="col">${esc(t('esg.r.revCol'))}</th><th scope="col">${esc(t('esg.r.sub'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="tCap">${esc(t('esg.r.standIn'))}</p>` : `<p class="alempty">${esc(t('esg.r.noCal'))}</p>`);
    let builder = '';
    if(sel){
      const ev = evidence(sel), prep = (sub.prepared || {})[sel], s = submitted(sel), g = grid(), tb = tariff();
      builder = card(t('esg.r.packT', { fw: t('esg.fw.' + sel) }), t('esg.r.packCap'), `<ul class="esgev">${ev.map(x => `<li data-present="${x.present ? 1 : 0}">
          <span class="esgpill" data-st="${x.present ? 'on' : 'nobase'}"><span class="esgdot" aria-hidden="true"></span>${esc(t(x.present ? 'esg.r.present' : 'esg.r.missing'))}</span>
          <span class="grow">${esc(t('esg.ev.' + x.id.replace('doc:', 'doc.')))}</span>
          ${x.present && !x.doc ? `<span class="tCap esgtrace">${esc(t('esg.r.trace', { s: (x.sources || []).join(', ') || t('emptyDash'), p: x.period, f: x.factor || t('esg.r.na'), tv: x.tariff || t('esg.r.na') }))}</span>` : ''}
          ${x.doc && x.att ? `<span class="tCap esgtrace"><button class="statlink" data-act="esgDoc" data-v="${esc(x.att.docId)}">${esc(t('esg.r.docOpen', { f: x.att.fileName }))}</button> · ${esc(t('esg.a.meta', { f: L(x.att.titleEn, x.att.titleAr), d: isoLbl(x.att.date), role: E.person(x.att.authorRole), id: x.att.docId }))}</span>` : ''}</li>`).join('')}</ul>
        <p class="tCap">${esc(t('esg.r.cover', { fw: t('esg.fw.' + sel) }))}</p>
        <div class="row gap8 esgacts">${isPartner() ? '' : `<button class="btnP btnSm" data-act="esgPrepare" data-v="${sel}">${esc(t('esg.r.prepare'))}</button>`}
          <button class="btnG btnSm" data-act="esgDownload" data-v="${sel}"${prep ? '' : ' disabled aria-disabled="true"'}>${esc(t('esg.r.download'))}</button>
          ${canSubmit() ? `<button class="btnG btnSm" data-act="esgMarkSub" data-v="${sel}"${s ? ' disabled aria-disabled="true"' : ''}>${esc(t('esg.r.markSub'))}</button>` : `<span class="tCap">${esc(t('esg.r.subExecOnly'))}</span>`}
          ${isPartner() ? `<button class="btnP btnSm" data-act="esgSignOff" data-v="${sel}">${esc(t('esg.so.btn'))}</button>` : ''}
          ${E.role() === 'executive' && needsVerifier(sel) ? `<button class="btnG btnSm" data-act="esgVerify" data-v="${sel}">${esc(t('esg.so.verBtn'))}</button>` : ''}</div>
        ${(() => { const rv = reviewOf(sel); return rv ? `<p class="tCap">${esc(t('esg.so.signedBy', { role: rv.status === 'verified' ? t('esg.so.verRole') : roleLbl(rv.rec.role), d: isoLbl(rv.date) }))}</p>` : ''; })()}
        <p class="tCap">${esc(prep ? t('esg.r.prepared', { d: isoLbl(prep.date), by: prep.byRole ? t('esg.r.byRole', { r: lc(whoOf(prep)) }) : E.person(prep.by || '') }) : t('esg.r.notPrepared'))} · ${esc(t('esg.r.noSend'))}</p>`);
    }
    const slot = card(t('esg.r.aiT'), '', `<p class="tCap">${esc(t('esg.r.aiSlot'))}</p>`, 'esgslot');
    const next = cal.filter(c => !submitted(c.fw)).map(c => daysLeft(c.due)).filter(d => d != null && d >= 0).sort((a, b) => a - b)[0];
    const heroes = [
      tile(t('esg.r.hNext'), `<span class="ovknum">${next == null ? esc(t('emptyDash')) : next}</span><span class="ovkunit">${next == null ? '' : esc(t('esg.r.days'))}</span>`, t('esg.r.hNextCap'), next != null && next <= 14 ? `<span class="pwchip" data-tone="warn">${esc(t('esg.r.within14'))}</span>` : ''),
      tile(t('esg.r.hRev'), `<span class="ovknum">${cal.filter(c => ['reviewed', 'verified'].includes(verification(c.fw).status)).length}</span>`, t('esg.r.hRevCap', { n: cal.length, v: cal.filter(c => verification(c.fw).status === 'verified').length })),
      tile(t('esg.r.hSub'), `<span class="ovknum">${cal.filter(c => submitted(c.fw)).length}</span>`, t('esg.r.hSubCap'))];
    const cr = creditsAtRisk();   /* B7 */
    const credits = card(t('esg.c.T'), t('esg.c.cap'), cr == null ? `<p class="alempty">${esc(t('esg.c.noMap'))}</p>` : !cr.length ? `<p class="alempty">${esc(t('esg.c.none'))}</p>`
      : `<div class="esgtblwrap"><table class="esgtbl"><thead><tr><th scope="col">${esc(t('esg.c.credit'))}</th><th scope="col">${esc(t('esg.r.fw'))}</th><th scope="col">${esc(t('esg.c.why'))}</th></tr></thead>
        <tbody>${cr.map(c => `<tr><th scope="row"><span class="esgkn">${esc(L(c.nameEn, c.nameAr))}</span><span class="tCap">${esc(c.id)}</span></th><td>${esc(t('esg.fw.' + c.fw))}</td><td>${c.reasons.map(x => `<span class="esgwhy3">${esc(x)}</span>`).join('')}</td></tr>`).join('')}</tbody></table></div>
        <p class="tCap">${esc(t('esg.c.standIn'))}</p>`);
    return pageWrap('esg-rep', heroes, provBar() + calCard + builder + credits + slot);
  }
  /* D176 B3: the partner signs off a period (Reviewed); the executive records an approved verifier's statement (Verified) */
  function signDialog(fw, kind){
    const P = pack(), per = periodOf(fw), verify = kind === 'verify';
    return dlgShell(t(verify ? 'esg.so.verT' : 'esg.so.T', { fw: t('esg.fw.' + fw), p: per }), `<p class="tCap">${esc(t(verify ? 'esg.so.verCap' : 'esg.so.cap'))}</p>
      <dl class="esgdl"><dt>${esc(t('esg.r.fw'))}</dt><dd>${esc(t('esg.fw.' + fw))}</dd><dt>${esc(t('esg.r.period'))}</dt><dd>${esc(per)}</dd>
        <dt>${esc(t('esg.dlg.pack'))}</dt><dd>${esc(P ? t('esg.so.pack', { id: P.id, v: P.version }) : t('esg.so.noPack'))}</dd>
        <dt>${esc(t('esg.dlg.assessor'))}</dt><dd>${esc(verify ? t('esg.so.verRole') : roleLbl(E.role()))}</dd><dt>${esc(t('esg.s.date'))}</dt><dd>${esc(dayLbl(now()))}</dd></dl>
      <div class="row gap8 esgdlgact"><span class="grow"></span><button class="btnG btnSm" data-act="closeDlg">${esc(t('cancelW'))}</button><button class="btnP btnSm" data-act="${verify ? 'esgVerifyOk' : 'esgSignOk'}" data-v="${fw}">${esc(t(verify ? 'esg.so.verOk' : 'esg.so.ok'))}</button></div>`, 'esgdlgsub');
  }
  function submitDialog(fw){
    return dlgShell(t('esg.r.markSubT', { fw: t('esg.fw.' + fw) }), `<p class="tCap">${esc(t('esg.r.markSubCap'))}</p>
      <label class="rpfld"><span class="tCap">${esc(t('esg.r.subDate'))}</span><input type="date" class="dgfin esgdate" value="${isoDay(now())}" max="${isoDay(now())}" aria-label="${esc(t('esg.r.subDate'))}"></label>
      <p class="tCap">${esc(t('esg.r.subWho', { who: t('roleExecutive') }))}</p>
      <div class="row gap8 esgdlgact"><span class="grow"></span><button class="btnG btnSm" data-act="closeDlg">${esc(t('cancelW'))}</button><button class="btnP btnSm" data-act="esgSubmitOk" data-v="${fw}">${esc(t('esg.r.markSub'))}</button></div>`, 'esgdlgsub');
  }

  /* --------------------------- the pack file ---------------------------------- */
  const ascii = s => String(s ?? '').replace(/₂/g, '2').replace(/²/g, '2').replace(/³/g, '3').replace(/[·•]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/µ/g, 'u').replace(/[^\x20-\x7E]/g, '?');
  function pdfBytes(lines){                                                  /* a minimal PDF: Helvetica, one column, A4, as many pages as needed */
    const esc2 = s => ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const wrapped = []; lines.forEach(l => { const b = l && l.b, txt = ascii(l && l.t != null ? l.t : l); let rest = txt;
      while(rest.length > 92){ let k = rest.lastIndexOf(' ', 92); if(k < 40) k = 92; wrapped.push(b ? { t: rest.slice(0, k), b } : rest.slice(0, k)); rest = '      ' + rest.slice(k).trimStart(); }
      wrapped.push(b ? { t: rest, b } : rest); });
    lines = wrapped;
    const pages = []; for(let i = 0; i < lines.length; i += 52) pages.push(lines.slice(i, i + 52));
    const objs = []; const add = s => { objs.push(s); return objs.length; };
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'), fontB = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const pagesId = objs.length + 1; objs.push(null);
    const kids = pages.map(pg => {
      const body = 'BT 50 800 Td 14 TL ' + pg.map(l => (l.b ? '/F2 11 Tf ' : '/F1 9.5 Tf ') + '(' + esc2(l.t != null ? l.t : l) + ') \'').join(' ') + ' ET';
      const cs = add('<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream');
      return add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ' + font + ' 0 R /F2 ' + fontB + ' 0 R >> >> /Contents ' + cs + ' 0 R >>');
    });
    objs[pagesId - 1] = '<< /Type /Pages /Kids [' + kids.map(k => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>';
    const cat = add('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
    let out = '%PDF-1.4\n'; const off = [];
    objs.forEach((o, i) => { off.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const x = out.length; out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
      + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + cat + ' 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
    return new TextEncoder().encode(out);
  }
  function packData(fw){
    const P = pack(), cal = (calendar().find(c => c.fw === fw) || {}), y = +(cal.period || year() - 1), ms = yearMonths(y), g = grid(), tb = tariff(), fuel = pf('fuel'), gwp = pf('refrigerant');
    const pts = f => ((D() || {}).points || []).filter(x => (x.serves || []).includes(f)).map(x => x.id);
    const s = f => ms.length === 12 ? ms.reduce((a, m) => a + m[f], 0) : null;
    const fig = (id, label, v, unit, sources, method, factor, withTariff) => ({ id, label, value: v == null ? null : +(+v).toFixed(3), unit, period: String(y), sources, method, factor: factor || null, tariff: withTariff && tb ? { id: tb.id, version: tb.ver } : null });
    const fac = f => f ? { id: f.id, value: f.v, unit: f.unit, source: f.sourceEn || f.source, date: f.date, inForceFrom: f.from || f.inForceFrom, gwpSource: f.gwpSourceEn || null } : null;
    const gridRec = g ? { id: g.id, value: g.v, unit: g.unit, source: (E.data.basis || {}).co2FactorSourceEn, date: g.date, inForceFrom: g.from, status: g.status } : null;
    const yc = yearCarbonT(y);
    const figures = [
      fig('electricity', 'Electricity consumption', s('kwh'), 'kWh', pts('kwh'), 'sum of the monthly main-meter totals', null, true),
      fig('naturalGas', 'Natural gas consumption', s('gasM3'), 'm3', pts('gasM3'), 'sum of the monthly G-01 totals'),
      fig('water', 'Water consumption', s('waterM3'), 'm3', pts('waterM3'), 'sum of the monthly W-01 totals'),
      fig('scope2', 'Scope 2 emissions (electricity)', s('kwh') == null || !g ? null : s('kwh') * g.v / 1000, 'tCO2e', pts('kwh'), 'electricity kWh x grid factor / 1000', gridRec),
      fig('scope1and2', 'Scope 1 and 2 emissions', yc.t, 'tCO2e', pts('kwh').concat(pts('gasM3')), 'electricity x grid factor + gas x fuel factor + refrigerant top-ups x GWP', { grid: gridRec, fuel: fac(fuel), refrigerant: fac(gwp) }),
      fig('floorArea', 'Floor area of the ESG boundary', area(), 'm2', ['boundary record ' + (bRef(boundary(), true) || 'estate record')], 'the boundary floor area every intensity divides by' + ((boundary() || {}).standIn ? ' (stand-in)' : '')),
      fig('coverage', 'Floor area with metered data', ((D() || {}).coverage || {}).meteredM2 ?? null, 'm2', ['boundary record ' + (bRef(boundary(), true) || 'estate record')].concat(pts('kwh')), ((D() || {}).coverage || {}).basisEn || '')];
    return { cover: 'Prepared from EKO data for ' + t('esg.fw.' + fw).replace(/[^\x20-\x7E]/g, '') + ' submission', framework: fw, site: siteKey(), period: String(y),
      preparedAt: new Date(now()).toISOString(), preparedBy: 'the ' + E.role() + ' role', baselinePack: P ? { id: P.id, version: P.version, assessorRole: P.assessorRole, assessed: P.assessed } : null,
      statement: 'EKO prepares this pack from measured data. EKO does not certify, verify or submit it; verification is a status set by the partner review.',
      verification: verification(fw), figures, evidence: evidence(fw).map(x => ({ item: x.id, present: x.present, sources: x.sources || [], period: x.period, factor: x.factor, tariff: x.tariff })), standIn: true };
  }
  function packFile(d){
    const L1 = [{ t: d.cover, b: true }, ' ', 'Site: ' + (E.data.nameEn || d.site), 'Period covered: ' + d.period, 'Prepared: ' + d.preparedAt + ' by ' + d.preparedBy,
      'Baseline pack: ' + (d.baselinePack ? d.baselinePack.id + ' version ' + d.baselinePack.version + ', ' + d.baselinePack.assessorRole + ', assessed ' + d.baselinePack.assessed : 'none loaded'),
      'Verification: ' + d.verification.status + (d.verification.role ? ' (' + d.verification.role + ', ' + d.verification.date + ')' : ''), ' ', d.statement, 'All values are stand-in fixture data.', ' ', { t: 'Figures', b: true }];
    d.figures.forEach(f => { L1.push(f.label + ': ' + (f.value == null ? 'no data' : f.value + ' ' + f.unit) + ' (' + f.period + ')'); L1.push('   sources: ' + (f.sources.join(', ') || '-') + '; method: ' + f.method);
      /* D176 A4: every factor line carries its in-force date (and the GWP's assessment report), as the screens and figures.json do */
      const fl = x => x.id + ' ' + x.value + ' ' + x.unit + (x.gwpSource ? ' (GWP: ' + x.gwpSource + ')' : '') + ', ' + x.source + ', dated ' + (x.date || 'not recorded') + ', in force from ' + (x.inForceFrom || 'not recorded');
      if(f.factor && f.factor.id) L1.push('   factor: ' + fl(f.factor));
      else if(f.factor) Object.keys(f.factor).forEach(k => { const x = f.factor[k]; if(x) L1.push('   ' + k + ' factor: ' + fl(x)); });
      if(f.tariff) L1.push('   tariff: ' + f.tariff.id + ' ' + f.tariff.version); });
    L1.push(' ', { t: 'Evidence items', b: true }); d.evidence.forEach(x => L1.push((x.present ? 'Present  ' : 'Missing  ') + x.item + (x.sources.length ? ' (sources: ' + x.sources.join(', ') + ')' : '')));
    const enc = new TextEncoder();
    const zip = window.EKO_RX.zipStored([{ name: 'summary.pdf', data: pdfBytes(L1) }, { name: 'figures.json', data: enc.encode(JSON.stringify(d, null, 2)) }]);
    return new Blob([zip], { type: 'application/zip' });
  }
  const fname = (fw, ext) => 'EKO-' + siteKey() + '-' + fw + '-pack-' + isoDay(now()) + '.' + ext;

  /* -------------------- Settings > Targets and Baselines ----------------------- */
  function settingsBody(E2){
    use(E2);
    const today = pack(), list = packs().slice().sort((a, b) => (b.version || 0) - (a.version || 0)), g = grid(), B = bands(), sample = samplePack();
    const hasSample = sample && !list.some(p => p.id === sample.id && p.version === sample.version);
    const vrows = list.map(p => `<tr data-on="${today && p.id === today.id && p.version === today.version}"><td>${esc(p.id)}</td><td class="tMonoS">${esc(t('esg.ver', { v: p.version }))}</td><td>${esc(E.person(p.assessorRole, true))}</td><td>${esc(isoLbl(p.assessed))}</td><td>${esc(isoLbl(p.validFrom) + ' ' + t('esg.to') + ' ' + isoLbl(p.validTo))}</td>
        <td>${today && p.id === today.id && p.version === today.version ? esc(t('esg.s.inForce')) : ''}</td><td>${isPartner() ? '' : `<button class="statlink" data-act="esgPackRm" data-v="${esc(p.id)}" data-ver="${p.version}">${esc(t('esg.s.remove'))}</button>`}</td></tr>`).join('');
    const fl = [g ? { n: t('esg.s.gridF'), f: g, rec: true } : null].concat(((today || {}).factors || []).map(f => ({ n: fName(f), f: Object.assign({}, f, { source: L(f.sourceEn, f.sourceAr), from: f.inForceFrom }) }))).filter(Boolean);
    const frows = fl.map(x => `<tr><td>${esc(x.n)}</td><td class="tMonoS" data-basis="emission">${esc(fmt(x.f.v, x.f.v < 10 ? 2 : 0) + ' ' + x.f.unit)}</td><td>${esc(x.f.source || '')}</td><td>${esc(x.f.date ? (/^\d{4}$/.test(x.f.date) ? x.f.date : isoLbl(x.f.date)) : t('esg.dateNone'))}</td><td>${esc(x.f.from ? isoLbl(x.f.from) : t('esg.dateNone'))}</td><td class="tCap">${esc(x.rec ? t('esg.s.siteRec') : t('esg.s.fromPack'))}</td></tr>`).join('');
    const T = tol(), num = (k, lbl, unit) => `<label class="rpfld esgtol"><span class="tCap">${esc(t(lbl))}${tolIsDefault(k) ? ' ' + esc(t('esg.default')) : ''}</span><span class="row gap6 aiC"><input type="number" class="dgfin" min="0" step="0.5" data-chg="esgTol" data-k="${k}" value="${T[k]}"${isPartner() ? ' disabled' : ''} aria-label="${esc(t(lbl))}"><span class="tCap">${esc(unit)}</span></span></label>`;
    const cal = calendar().map(c => `<tr><td>${esc(t('esg.fw.' + c.fw))}</td><td>${esc(c.period)}</td><td>${esc(isoLbl(c.due))}</td></tr>`).join('');
    return `<div class="esgset">
      <section><h3 class="esgh3">${esc(t('esg.s.packsT'))}</h3><p class="tCap">${esc(provenance())}</p>
        <p class="tCap" data-tip="${esc(t('esg.s.bndTip'))}">${esc(t('esg.s.bnd', { b: bName(boundary()), a: area() ? fmt(area()) : t('emptyDash'), i: bIncl(boundary()) || t('esg.bnd.estateIncl') }))}</p>
        ${list.length ? `<div class="audwrap"><table class="audt"><thead><tr><th>${esc(t('esg.s.id'))}</th><th>${esc(t('esg.s.ver'))}</th><th>${esc(t('esg.dlg.assessor'))}</th><th>${esc(t('esg.dlg.assessed'))}</th><th>${esc(t('esg.s.valid'))}</th><th></th><th></th></tr></thead><tbody>${vrows}</tbody></table></div>` : `<p class="alempty">${esc(t('esg.noBase'))}</p>`}
        <p class="tCap">${esc(t('esg.s.versioning'))}</p>
        <div class="row gap8 esgacts">${isPartner() ? '' : `<label class="esgupl"><span class="btnG btnSm">${icon('plus', 13)} ${esc(t('esg.s.import'))}</span><input type="file" accept=".json,application/json" data-chg="esgPackFile" class="esgfile" aria-label="${esc(t('esg.s.import'))}"></label>
          ${hasSample && window.EKO_BUILD && window.EKO_BUILD.demo ? `<button class="btnG btnSm" data-act="esgPackSample">${esc(t('esg.s.sample'))}</button>` : ''}`}
          <button class="btnG btnSm" data-act="esgSchema">${esc(t('esg.s.schema'))}</button></div></section>
      <section><h3 class="esgh3">${esc(t('esg.s.siteT'))}</h3>
        ${canSite() ? `<label class="row gap8 aiC"><input type="checkbox" data-chg="esgSiteSet" data-k="partnerCost"${siteSet().partnerCost ? ' checked' : ''} aria-label="${esc(t('esg.s.partnerCost'))}"><span>${esc(t('esg.s.partnerCost'))}</span></label>`
          : `<p>${esc(t(siteSet().partnerCost ? 'esg.s.partnerCostOn' : 'esg.s.partnerCostOff'))}</p>`}
        <p class="tCap">${esc(t('esg.s.partnerCostCap'))}</p><p class="tCap">${esc(t('esg.s.offline'))}</p></section>
      <section><h3 class="esgh3">${esc(t('esg.a.T'))}</h3>${(() => { const at = attachmentsOf(today);
          return at.length ? `<ul class="dglist">${at.map(a => `<li class="row gap8 aiC"><button class="statlink" data-act="esgDoc" data-v="${esc(a.docId)}">${esc(t('esg.a.open'))}</button><span class="tCap">${esc(t('esg.a.meta', { f: a.fileName, d: isoLbl(a.date), role: E.person(a.authorRole), id: a.docId }))}${a.kind ? ' · ' + esc(t('esg.a.kind.' + a.kind)) : ''}</span></li>`).join('')}</ul>` : `<p class="alempty">${esc(t('esg.a.none'))}</p>`; })()}
        ${!isPartner() && today ? `<div class="row gap8 esgacts"><select class="rpf esgak" aria-label="${esc(t('esg.a.attach'))}">${['audit', 'model', 'pathway', 'creditMap'].map(k2 => `<option value="${k2}">${esc(t('esg.a.kind.' + k2))}</option>`).join('')}</select>
          <label class="esgupl"><span class="btnG btnSm">${icon('plus', 13)} ${esc(t('esg.a.attach'))}</span><input type="file" accept=".pdf,image/*,.xlsx,.docx" data-chg="esgAttach" class="esgfile" aria-label="${esc(t('esg.a.attach'))}"></label></div>` : ''}
        <p class="tCap">${esc(t('esg.a.limit'))}</p></section>
      <section><h3 class="esgh3">${esc(t('esg.s.factorsT'))}</h3><div class="audwrap"><table class="audt"><thead><tr><th>${esc(t('esg.s.factor'))}</th><th>${esc(t('esg.s.value'))}</th><th>${esc(t('esg.s.source'))}</th><th>${esc(t('esg.s.date'))}</th><th>${esc(t('esg.s.from'))}</th><th></th></tr></thead><tbody>${frows}</tbody></table></div>
        <p class="tCap">${esc(t('esg.s.oneFactor'))}</p>
        <h4 class="tLbl">${esc(t('esg.fv.T'))}</h4><div class="audwrap"><table class="audt"><thead><tr><th>${esc(t('esg.fv.id'))}</th><th>${esc(t('esg.s.value'))}</th><th>${esc(t('esg.s.source'))}</th><th>${esc(t('esg.s.from'))}</th><th></th></tr></thead>
          <tbody>${gridVersions().map(v => `<tr><td>${esc(vName(v))}</td><td class="tMonoS" data-basis="emission">${esc(fmt(v.v, 2) + ' ' + v.unit)}</td><td>${esc(v.source || L(v.sourceEn, v.sourceAr) || '')}</td><td>${esc(isoLbl(v.from))}</td><td class="tCap">${esc(v.current ? t('esg.fv.current') : v.added ? t('esg.fv.restated') : '')}</td></tr>`).join('')}</tbody></table></div>
        <p class="tCap">${esc(t('esg.fv.rule'))}</p>
        ${!isPartner() ? `<div class="row gap8 esgacts esgfvform"><input class="dgfin esgfvi" placeholder="${esc(t('esg.fv.id'))}" aria-label="${esc(t('esg.fv.id'))}"><input type="number" step="0.001" min="0" class="dgfin esgfvv" placeholder="0.41" aria-label="${esc(t('esg.s.value'))}">
          <input class="dgfin esgfvs" placeholder="${esc(t('esg.s.source'))}" aria-label="${esc(t('esg.s.source'))}"><input type="date" class="dgfin esgfvf" aria-label="${esc(t('esg.s.from'))}"><button class="btnG btnSm" data-act="esgFvAdd">${esc(t('esg.fv.add'))}</button></div>` : ''}</section>
      <section><h3 class="esgh3">${esc(t('esg.ieq.bandsT'))}</h3><p class="tCap">${esc(B.src === 'pack' ? t('esg.ieq.bandsPack', { v: B.pack.version, role: E.person(B.pack.assessorRole) }) : t('esg.ieq.bandsDefault'))}</p>
        <p class="tMonoS">${esc(t('esg.s.bandsLine', { t0: fmt(B.v.tempC[0], 1), t1: fmt(B.v.tempC[1], 1), h0: fmt(B.v.rhPct[0]), h1: fmt(B.v.rhPct[1]), c: fmt(B.v.co2Ppm), p: fmt(B.v.pm25) }))}</p></section>
      <section><h3 class="esgh3">${esc(t('esg.s.tolT'))}</h3><div class="row gap12 esgtols">${num('billPct', 'esg.s.tolBill', '%')}${num('excursionPct', 'esg.s.tolExc', '%')}${num('staleH', 'esg.s.tolStale', 'h')}</div></section>
      <section><h3 class="esgh3">${esc(t('esg.r.calT'))}</h3>${cal ? `<div class="audwrap"><table class="audt"><thead><tr><th>${esc(t('esg.r.fw'))}</th><th>${esc(t('esg.r.period'))}</th><th>${esc(t('esg.r.due'))}</th></tr></thead><tbody>${cal}</tbody></table></div><p class="tCap">${esc(t('esg.r.standIn'))}</p>` : `<p class="alempty">${esc(t('esg.r.noCal'))}</p>`}</section>
      <section><h3 class="esgh3">${esc(t('esg.s.exportT'))}</h3><p class="tCap">${esc(t('esg.s.exportCap'))}</p>
        <div class="row gap8 esgacts"><select class="rpf" data-chg="esgExpPer" aria-label="${esc(t('esg.period'))}">${['12m', 'ytd', 'mtd'].map(p => `<option value="${p}"${(E.state.esgExpPer || '12m') === p ? ' selected' : ''}>${esc(t('esg.per.' + p))}</option>`).join('')}</select>
          <button class="btnG btnSm" data-act="esgExport">${esc(t('esg.s.export'))}</button></div></section></div>`;
  }
  function dataPack(pid){
    const p = period(pid), d = D() || {};
    return { schema: 'eko.esg.dataPackExport/1', site: siteKey(), period: { id: p.id, label: p.label, months: within(p).map(m => monthLbl(m.o)) }, floorAreaM2: area(),
      consumption: within(p).map(m => ({ month: monthLbl(m.o), kwh: m.kwh, coolingKwh: m.coolingKwh, oohKwh: m.oohKwh, gasM3: m.gasM3, waterM3: m.waterM3, ctWaterM3: m.ctWaterM3, coverageCt: m.covCt })),
      points: (d.points || []).map(x => ({ id: x.id, name: x.nameEn, serves: x.serves })), coverage: d.coverage || null,
      bills: bills().map(b => ({ id: b.id, utility: b.utility, month: b.label, billed: b.billed, metered: b.metered, unit: b.unit, variancePct: b.varPct == null ? null : +b.varPct.toFixed(2), status: b.st })),
      factor: grid(), tariff: tariff(), exportedAt: new Date(now()).toISOString(), standIn: true };
  }
  const SCHEMA = { schema: 'eko.esg.baselinePack/1', required: REQ, fields: { site: 'site key', assessorRole: 'role of the assessor, never a name', standards: 'standards referenced',
    assessed: 'YYYY-MM-DD', validFrom: 'YYYY-MM-DD', validTo: 'YYYY-MM-DD', baselineYear: 'year', boundary: '{ nameEn, floorAreaM2, includesEn }: what every ESG intensity divides by (D176)',
    kpis: '{ kpiId: { v, unit?, basis?, noteEn? } }', targets: '{ kpiId: { year: value } }',
    pathway: '{ netZeroYear, unit: tCO2e, scope: 1+2, years: { year: value } }', ieqBands: '{ tempC: [lo, hi], rhPct: [lo, hi], co2Ppm, pm25, types: [space types it covers], standardEn, occupancy: { type: { en } } }',
    factors: '[ { id, kind, v, unit, sourceEn, date, inForceFrom, gwpSourceEn (refrigerants: the IPCC assessment report) } ]',
    evidence: '{ framework: [ itemId ] }', calendar: '[ { fw, period, due } ]' } };

  /* ------------------------------ the portfolio -------------------------------- */
  function portfolioStrip(E2){
    use(E2);
    /* the ESG sites: site twins with ESG active, and estate rows marked ESG active without a twin (D176 A2: Property Two) */
    const twins = Object.keys(window.EKO_DATA || {}).map(k => window.EKO_DATA[k]).filter(d => d && typeof d === 'object' && d.key && d.entitlements && (d.entitlements.modules || {}).esg === 'active');
    const rows = (((window.EKO_DATA || {}).estate || {}).sites || []).filter(r => r.esg && r.esg.active && !twins.some(d => d.key === r.key));
    if(!twins.length && !rows.length) return '';
    const sites = twins.map(d => { const row = estRow(d.key) || {}, ms = ((d.esg || {}).history || {}).months || [];
      const last12 = ms.filter(m => m.o >= -12 && m.o <= -1), kwh = last12.length === 12 ? last12.reduce((s, m) => s + m.kwh, 0) : null;
      const packsOf = ls.get('eko-esg-packs-v1:' + d.key);
      const inForce = Array.isArray(packsOf) ? pickInForce(packsOf, now()) : null;
      const hasBase = Array.isArray(packsOf) ? !!inForce : !!((d.esg || {}).packs || []).length;
      const bd = (inForce && inForce.boundary) || (d.esg || {}).boundary || null;   /* the boundary area, never the estate area when a boundary exists */
      const b = d.basis || {}, s12 = d.key === siteKey() ? yearCarbonT(year()).t : null;
      return { key: d.key, name: E.lang === 'ar' ? (d.nameAr || row.nameAr || d.nameEn) : (d.nameEn || row.nameEn), area: bd ? bd.floorAreaM2 : (row.floorArea || null), kwh, hasBase, s12, hasHist: ms.length > 0, factor: b.co2FactorId }; })
      .concat(rows.map(r => ({ key: r.key, name: E.lang === 'ar' ? r.nameAr : r.nameEn, area: (r.esg.boundary || {}).floorAreaM2 || r.floorArea || null, kwh: null, hasBase: false, s12: null, hasHist: false, factor: null })));
    const withE = sites.filter(s => s.kwh != null && s.area), A = sites.reduce((s, x) => s + (x.area || 0), 0), Ab = sites.filter(s => s.hasBase).reduce((s, x) => s + (x.area || 0), 0);
    const eui = withE.length ? withE.reduce((s, x) => s + x.kwh, 0) / withE.reduce((s, x) => s + x.area, 0) : null;   /* sum of numerators over sum of denominators */
    const tot = sites.filter(s => s.s12 != null), s12 = tot.length ? tot.reduce((s, x) => s + x.s12, 0) : null;
    const note = sites.filter(x => !x.hasBase || x.s12 == null).map(x => x.name + ': ' + [!x.hasBase ? t('esg.noBase') : '', !x.hasHist ? t('esg.why.noHistory') : ''].filter(Boolean).join(', ')).join('; ');
    const cov = t('esg.pf.cov2', { n: sites.filter(x => x.hasBase).length, m: sites.length, a: fmt(Ab), b: fmt(A) });
    const hist = t('esg.pf.hist', { e: withE.length, m: sites.length });
    return `<div class="pfprove esgpfc" data-tip="${esc(t('esg.pf.euiTip2') + '. ' + hist + (note ? '. ' + note : ''))}"><span class="tLbl">${esc(t('esg.pf.eui'))}</span><b>${eui == null ? esc(t('emptyDash')) : esc(fmt(eui, 1)) + ' kWh/m²'}</b><span class="tCap">${esc(cov)}</span></div>
      <div class="pfprove esgpfc" data-tip="${esc(t('esg.pf.threshTip') + '. ' + t('esg.pf.s12Tip', { f: tot.map(x => x.factor).filter(Boolean).join(', '), n: tot.length, m: sites.length }))}"><span class="tLbl">${esc(t('esg.pf.s12'))}</span><b data-basis="emission">${s12 == null ? esc(t('emptyDash')) : esc(fmt(s12, 1)) + ' tCO2e'}</b><span class="tCap">${esc(t('esg.pf.thresh', { v: s12 == null ? t('emptyDash') : fmt(s12 / 500000 * 100, 3) }))}</span></div>`;
  }

  /* ---------------------------------- dialog ------------------------------------ */
  function dialog(E2){
    use(E2);
    const k = E.state.esgDlg || {};
    if(k.kind === 'kpi') return kpiDialog(k.id);
    if(k.kind === 'bill') return billDialog(k.id);
    if(k.kind === 'submit') return submitDialog(k.id);
    if(k.kind === 'measure') return measureDialog(k.id);
    if(k.kind === 'signoff') return signDialog(k.id, 'review');
    if(k.kind === 'verify') return signDialog(k.id, 'verify');
    return '';
  }
  const opened = (el, act) => { if(window.EKO_SURF) window.EKO_SURF.noteOpener({ act, v: el.dataset.v }); };
  const dl = (blob, name) => window.EKO_RX.download(blob, name);
  const toast = (key, tone, vars) => { if(window.EKO_FB) window.EKO_FB.toast({ text: E.t(key, vars), tone: tone || 'info' }); };

  const ACTS = {
    esgPer(el){ use(); E.set({ esgPer: el.dataset.v }); },
    esgIeqPer(el){ use(); E.set({ esgIeqPer: el.dataset.v }); },
    esgFw(el){ use(); E.set({ esgFw: el.dataset.v }); },
    esgKpi(el){ use(); opened(el, 'esgKpi'); E.set({ born: 'dlg', dlg: 'esg', esgDlg: { kind: 'kpi', id: el.dataset.v } }); },
    esgBill(el){ use(); opened(el, 'esgBill'); E.set({ born: 'dlg', dlg: 'esg', esgDlg: { kind: 'bill', id: el.dataset.v } }); },
    esgMarkSub(el){ use(); if(!canSubmit()) return; opened(el, 'esgMarkSub'); E.set({ born: 'dlg', dlg: 'esg', esgDlg: { kind: 'submit', id: el.dataset.v } }); },
    esgSubmitOk(el){ use(); if(!canSubmit()) return; const inp = document.querySelector('.esgdate'), d = inp && inp.value ? inp.value : isoDay(now());
      const s = subState(), rd = readiness(el.dataset.v); s.submitted[el.dataset.v] = { date: d, byRole: E.role(), readinessPct: rd ? Math.round(rd.pct) : null }; saveSub(s);   /* D178 item 5 */
      E.set({ dlg: null, esgDlg: null }); toast('esg.r.subToast', 'ok', { fw: E.t('esg.fw.' + el.dataset.v) }); },
    esgGap(){ use(); E.set({ esgGapOpen: !E.state.esgGapOpen }); },
    /* D176 B1 */
    esgMeasure(el){ use(); opened(el, 'esgMeasure'); E.set({ born: 'dlg', dlg: 'esg', esgDlg: { kind: 'measure', id: el.dataset.v } }); },
    esgWo(el){ use(); if(!el.dataset.asset) return; ACTS.esgFix(el); },
    /* D176 B3: notes are added and resolved, never edited */
    esgNoteAdd(el){ use(); if(!canNote()) return; const box = el.closest('.esgnotes'), ta = box && box.querySelector('.esgnin'), txt = ta ? ta.value.trim() : ''; if(!txt) return;
      const tg = el.dataset.v, per = tg.startsWith('kpi:') ? period(tg.split(':')[2] || '12m').label : null;
      ls.set(LN(), notes().concat([{ id: 'N' + Date.now().toString(36), tg, role: E.role(), date: isoDay(now()), text: txt.slice(0, 600), forPeriod: per, resolved: null }])); E.set({}); toast('esg.n.saved', 'ok'); },
    esgNoteResolve(el){ use(); if(!canNote()) return; ls.set(LN(), notes().map(n => n.id === el.dataset.v && !n.resolved ? Object.assign({}, n, { resolved: { role: E.role(), date: isoDay(now()) } }) : n)); E.set({}); },
    esgSignOff(el){ use(); if(!isPartner()) return; opened(el, 'esgSignOff'); E.set({ born: 'dlg', dlg: 'esg', esgDlg: { kind: 'signoff', id: el.dataset.v } }); },
    esgSignOk(el){ use(); if(!isPartner()) return; const fw = el.dataset.v, P = pack();
      ls.set(LR(), reviews().concat([{ fw, period: periodOf(fw), kind: 'review', role: 'partner', enteredBy: 'partner', date: isoDay(now()), pack: P ? { id: P.id, version: P.version } : null }]));
      E.set({ dlg: null, esgDlg: null }); toast('esg.so.done', 'ok', { fw: E.t('esg.fw.' + fw), p: periodOf(fw) }); },
    esgVerify(el){ use(); if(E.role() !== 'executive' || !needsVerifier(el.dataset.v)) return; opened(el, 'esgVerify'); E.set({ born: 'dlg', dlg: 'esg', esgDlg: { kind: 'verify', id: el.dataset.v } }); },
    esgVerifyOk(el){ use(); const fw = el.dataset.v; if(E.role() !== 'executive' || !needsVerifier(fw)) return; const P = pack();
      ls.set(LR(), reviews().concat([{ fw, period: periodOf(fw), kind: 'verification', role: 'verifier', enteredBy: 'executive', date: isoDay(now()), pack: P ? { id: P.id, version: P.version } : null }]));
      E.set({ dlg: null, esgDlg: null }); toast('esg.so.verDone', 'ok', { fw: E.t('esg.fw.' + fw), p: periodOf(fw) }); },
    /* D176 B4 */
    esgDoc(el){ use(); docGet(el.dataset.v).then(r => { if(r && r.blob) dl(r.blob, r.name || el.dataset.v); else toast('esg.a.noBlob', 'warn'); }).catch(() => toast('esg.a.noBlob', 'warn')); },
    esgAttach(el){ use(); const f = el.files && el.files[0], P = pack(); if(!f || !P) return;
      const all = attachmentsOf(P).reduce((a, x) => a + (x.bytes || 0), 0); if(f.size > DOC_MAX || all + f.size > DOC_ALL){ toast('esg.a.tooBig', 'warn'); return; }
      const kind = (document.querySelector('.esgak') || {}).value || 'audit', id = 'DOC-' + Date.now().toString(36).toUpperCase();
      docPut({ docId: id, name: f.name, type: f.type, blob: f, bytes: f.size }).then(() => {
        ls.set(LSP(), packs().map(x => x.id === P.id && x.version === P.version ? Object.assign({}, x, { attachments: attachmentsOf(x).concat([{ docId: id, kind, titleEn: f.name, fileName: f.name, date: isoDay(now()), authorRole: E.role(), bytes: f.size, evidence: [] }]) }) : x));
        E.set({}); toast('esg.a.added', 'ok', { f: f.name }); }).catch(() => toast('esg.a.noBlob', 'warn')); },
    /* D176 B5: a grid factor version; a past in-force date restates the months it covers and keeps their earlier figures */
    esgFvAdd(){ use(); const q = s2 => document.querySelector(s2), v = parseFloat((q('.esgfvv') || {}).value), id = ((q('.esgfvi') || {}).value || '').trim(), src = ((q('.esgfvs') || {}).value || '').trim(), from = (q('.esgfvf') || {}).value;
      if(!(v > 0) || !id || !parseDay(from)){ toast('esg.fv.bad', 'warn'); return; }
      const before = {}; months().forEach(m => { before[ym(m.o)] = carbonKg(m); });
      const list = (ls.get(LFV()) || []).concat([{ id, v, inForceFrom: from, date: isoDay(now()), sourceEn: src || id, sourceAr: src || id, restates: {} }]); ls.set(LFV(), list);
      const restates = {}; months().forEach(m => { const k2 = ym(m.o), a = carbonKg(m); if(before[k2] != null && a != null && Math.abs(a - before[k2]) > 1e-6 && monthStart(m.o).getTime() < now()) restates[k2] = before[k2]; });
      list[list.length - 1].restates = restates; ls.set(LFV(), list); E.set({}); toast('esg.fv.added', 'ok', { n: Object.keys(restates).length }); },
    /* D176 B6 */
    esgWasteSave(){ use(); const q = s2 => document.querySelector(s2), o = parseInt((q('.esgwm') || {}).value, 10), tot = parseFloat((q('.esgwt') || {}).value), div = parseFloat((q('.esgwd') || {}).value), f = (q('.esgwr') || {}).files;
      if(!(tot >= 0) || !(div >= 0) || div > tot || !isFinite(o)){ toast('esg.w.bad', 'warn'); return; }
      const loc = ls.get(LW()) || {}; loc[ym(o)] = { totalKg: tot, divertedKg: div, report: f && f[0] ? f[0].name : null }; ls.set(LW(), loc); E.set({}); toast('esg.w.saved', 'ok', { m: monthLbl(o) }); },
    esgSiteSet(el){ use(); if(!canSite()) return; const cur = siteSet(); cur[el.dataset.k] = !!el.checked; ls.set(LSITE(), cur); E.set({}); },
    esgFactor(el){ use(); const r = el.getBoundingClientRect(); opened(el, 'esgFactor');
      E.set({ born: 'dlg', dlg: 'esgfp', esgFp: { k: el.dataset.k, r: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } } }); },
    esgFix(el){ use(); E.state.dlg = null; E.state.esgDlg = null;
      const b = document.createElement('button'); b.dataset.act = 'openAsset'; b.dataset.asset = el.dataset.asset; b.style.display = 'none';
      (document.getElementById('mount') || document.body).appendChild(b); b.click(); b.remove(); E.set({ apTab: 'activity' }); },
    esgSpaces(el){ use(); E.go('heatmap', 'spaces', 'heat'); E.set({ hmMode: 'comfort', hmSel: el.dataset.v || null }); },
    esgSettings(){ use(); E.set({ born: 'dlg', dlg: 'settings', settingsTab: 'targets' }); },
    esgQuery(el){ use(); const s = subState(); s.queries = (s.queries || []).concat([{ bill: el.dataset.v, date: isoDay(now()), by: (E.data.user || {}).name || '' }]); saveSub(s);
      E.set({}); toast('esg.b.queryToast', 'ok'); },
    esgUpload(el){ use(); const f = el.files && el.files[0]; if(!f) return; const s = subState(); s.captures = (s.captures || []).concat([{ name: f.name, date: isoDay(now()) }]); saveSub(s); E.set({}); toast('esg.b.capToast', 'ok', { f: f.name }); },
    esgPrepare(el){ use(); const fw = el.dataset.v, s = subState(); s.prepared = Object.assign({}, s.prepared, { [fw]: { date: isoDay(now()), byRole: E.role(), data: packData(fw) } }); saveSub(s);
      E.set({}); toast('esg.r.prepToast', 'ok', { fw: E.t('esg.fw.' + fw) }); },
    esgDownload(el){ use(); const pr = (subState().prepared || {})[el.dataset.v]; if(!pr || !pr.data) return; dl(packFile(pr.data), fname(el.dataset.v, 'zip')); },
    esgPackSample(){ use(); const p = samplePack(); if(!p) return; const r = importPack(p); E.set({}); toast(r.ok ? 'esg.imp.ok' : r.why, r.ok ? 'ok' : 'warn', { v: p.version }); if(r.ok) seedDocs(p).then(() => E.set({})); },
    esgPackFile(el){ use(); const f = el.files && el.files[0]; if(!f) return; const rd = new FileReader();
      rd.onload = () => { let o = null; try{ o = JSON.parse(String(rd.result)); }catch(e){ o = null; } const r = importPack(o); E.set({}); toast(r.ok ? 'esg.imp.ok' : r.why, r.ok ? 'ok' : 'warn', { v: (o && o.version) || '' }); };
      rd.readAsText(f); },
    esgPackRm(el){ use(); removePack(el.dataset.v, el.dataset.ver); E.set({}); },
    esgSchema(){ use(); dl(new Blob([JSON.stringify(SCHEMA, null, 2)], { type: 'application/json' }), 'eko-esg-baseline-pack-schema.json'); },
    esgTol(el){ use(); const k = el.dataset.k, v = parseFloat(el.value), cur = ls.get('eko-esg-tol-v1:' + siteKey()) || {};
      if(isFinite(v) && v >= 0) cur[k] = v; ls.set('eko-esg-tol-v1:' + siteKey(), cur); E.set({}); },
    esgExpPer(el){ use(); E.state.esgExpPer = el.value; },
    esgExport(){ use(); const pid = E.state.esgExpPer || '12m'; dl(new Blob([JSON.stringify(dataPack(pid), null, 2)], { type: 'application/json' }), 'EKO-' + siteKey() + '-data-pack-' + pid + '-' + isoDay(now()) + '.json'); }
  };
  /* Enter and Space on a focusable table row act as its click */
  document.addEventListener('keydown', ev => { if((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.classList && ev.target.classList.contains('esgrow')){ ev.preventDefault(); ev.target.click(); } });

  /* deep links (ruling 2): ?page=esg and ?page=esg&view=<sub-view> */
  const VIEWS = { 'target-vs-actual': ['esg-tva', 'tva'], 'net-zero': ['esg-nz', 'nz'], 'utility-bills': ['esg-bills', 'bills'], 'air-quality-ieq': ['esg-ieq', 'ieq'], 'reporting': ['esg-rep', 'rep'] };
  function deepLink(E2, u){ use(E2); if(u.searchParams.get('page') !== 'esg' || !active(E)) return false;
    const v = VIEWS[u.searchParams.get('view') || ''] || ['esg', null]; E.state.pageId = v[0]; E.state.module = 'esg'; E.state.sub = v[1]; E.state.exp = { esg: true }; E.state.navCollapsed = null; E.state.moduleLabel = 'modEsg'; return true; }

  /* the self-check's hooks (no UI): the pack file's content and the pack in force */
  return { summary, panel, tvaPage, factorPop, moneyOk, partnerDenied, netZeroPage, billsPage, ieqPage, reportingPage, dialog, settingsBody, portfolioStrip, deepLink, ACTS, active,
           test: { packData: fw => { use(); return packData(fw); }, packFile: d => packFile(d), pack: () => { use(); return pack(); }, packs: () => { use(); return packs(); }, kpis: pid => { use(); return KPIS.map(k => { const r = kpiRow(k, pid); return { id: k.id, v: r.v, base: r.baseP, tgt: r.tgtP, st: r.st }; }); }, bills: () => { use(); return bills(); }, pdf: lines => pdfBytes(lines),
             measures: () => { use(); return measures(); }, stranding: () => { use(); return stranding(); }, credits: () => { use(); return creditsAtRisk(); }, evidence: fw => { use(); return evidence(fw); },
             versions: () => { use(); return gridVersions(); }, waste: () => { use(); return wasteList(); }, docGet: id => docGet(id) } };
})();
