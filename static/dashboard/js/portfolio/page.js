/* ============================================================================
   PORTFOLIO PAGE (D103 stage 2) — the estate landing: header strip (estate
   ribbon, not-reporting chip, three KPI chips with coverage badges, per-
   vertical breakdown), then the shared data grid with the estate spec and,
   behind a labelled toggle, the map. Every figure comes from EKO_EST, every
   aggregate from EKO_ROLLUP; this file only renders.
   ============================================================================ */
window.EKO_PF = (function(){
  'use strict';
  const C = () => window.EKO_C, EST = () => window.EKO_EST, DG = () => window.EKO_DG, MAP = () => window.EKO_MAP;
  const esc = s => C().esc(s), icon = (n, s) => C().icon(n, s);
  let E = null;
  const loc = E2 => E2.lang === 'ar' ? 'ar-AE' : 'en-GB';
  const fmtN = (E2, v, d) => v == null ? E2.t('emptyDash') : (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString(loc(E2), { maximumFractionDigits: d });
  const mwh = (E2, kwh) => fmtN(E2, (kwh || 0) / 1000, (kwh || 0) >= 100000 ? 0 : 1);
  const name = (E2, s) => E2.lang === 'ar' ? (s.nameAr || s.nameEn) : s.nameEn;

  /* ------------------------------ cells ----------------------------------- */
  function agoText(E2, s){
    if(s.lastSampleAt == null) return E2.t('pfNever');
    const m = Math.max(0, Math.round((Date.now() - s.lastSampleAt) / 60000));
    if(m < 60) return E2.t('pfAgo.min', { n: m }); if(m < 48 * 60) return E2.t('pfAgo.h', { n: Math.round(m / 60) }); return E2.t('pfAgo.d', { n: Math.round(m / 1440) });
  }
  const repChip = (E2, s) => `<span class="statchip pfrep" data-rep="${s.state}" data-tip="${esc(E2.t('pfRepTip.' + s.state, { t: agoText(E2, s) }))}">${esc(E2.t('pfRep.' + s.state))}</span>`;
  function sevCell(E2, s){
    const t = E2.t.bind(E2);
    if(!s.worstSev) return `<span class="tCap">${esc(t('pfNoAlarms'))}</span>${!s.telemetry ? unk(E2) : ''}`;
    return `<span class="pfsev" data-tip="${esc(t('pfSevTip', { sev: t('rpSev.' + s.worstSev), n: s.alarmCount }))}">${C().sevGlyph(s.worstSev, false, 13)}<b>${s.alarmCount}</b><span class="tCap">${esc(t('rpSev.' + s.worstSev))}</span></span>${!s.telemetry ? unk(E2) : ''}`;
  }
  const unk = E2 => `<span class="pfunk" data-tip="${esc(E2.t('pfLiveUnknownOne'))}" aria-label="${esc(E2.t('pfLiveUnknownOne'))}">${icon('warn', 11)}</span>`;
  const sevText = (E2, s) => s.worstSev ? E2.t('rpSev.' + s.worstSev) + ' · ' + s.alarmCount : E2.t('pfNoAlarms');
  function kpiCell(E2, s){
    const t = E2.t.bind(E2), k = s.kpi;
    if(!s.telemetry) return `<span class="tCap pfdash" data-tip="${esc(t('pfNo.' + s.state, { t: agoText(E2, s) }))}">${esc(t('emptyDash'))}</span>`;
    if(k.value == null && k.reason === 'insufficientHistory') return `<span class="tCap pfdash" data-tip="${esc(t('pfReason.insufficientHistory'))}">${esc(t('emptyDash'))}</span>`;
    if(k.value == null) return `<span class="tCap pfdash" data-tip="${esc(t('pfNo.noData'))}">${esc(t('emptyDash'))}</span>`;
    if(k.kind === 'eui') return `<span class="pfkpi"><b>${fmtN(E2, k.value, 1)}</b> <span class="tCap">${esc(t('pfEui'))}</span> <span class="tCap pfbasis" data-tip="${esc(t(k.basisKey))}">· ${esc(t('pfPer.' + k.period))}</span></span>`;
    if(k.kind === 'pue') return `<span class="pfkpi"><b>${fmtN(E2, k.value, 2)}</b> <span class="tCap">${esc(t('pfPue'))}</span> <span class="tCap pfbasis" data-tip="${esc(t(k.basisKey))}">· ${esc(t('pfItLoad', { v: fmtN(E2, k.itLoadKw, 0) }))}</span></span>`;
    if(k.kind === 'pueShort') return `<span class="pfkpi" data-partial="1" data-tip="${esc(t('pfPueShortTip', { m: k.months }))}"><b>${fmtN(E2, k.value, 2)}</b> <span class="tCap">${esc(t('pfPueShort', { m: k.months }))}</span></span>`;
    return `<span class="pfkpi"><b>${k.open}</b> <span class="tCap">${esc(t('pfWoOpenShort'))}</span>${k.overdue ? ` <span class="statchip" data-sev="high">${esc(t('pfWoOverdue', { n: k.overdue }))}</span>` : ''} <span class="tCap">· ${esc(t('pfEnergyShort', { v: mwh(E2, k.energyKwh) }))} · ${esc(t('pfPer.' + k.period))}</span></span>`;
  }
  function kpiText(E2, s){
    const t = E2.t.bind(E2), k = s.kpi;
    if(!s.telemetry) return t('emptyDash') + ' · ' + t('pfNo.' + s.state, { t: agoText(E2, s) });
    if(k.value == null && k.reason === 'insufficientHistory') return t('emptyDash') + ' · ' + t('pfReason.insufficientHistory');
    if(k.value == null) return t('emptyDash');
    if(k.kind === 'eui') return fmtN(E2, k.value, 1) + ' ' + t('pfEui') + ' · ' + t('pfPer.' + k.period);
    if(k.kind === 'pue') return fmtN(E2, k.value, 2) + ' ' + t('pfPue') + ' · ' + t('pfItLoad', { v: fmtN(E2, k.itLoadKw, 0) });
    if(k.kind === 'pueShort') return fmtN(E2, k.value, 2) + ' ' + t('pfPueShort', { m: k.months });
    return k.open + ' ' + t('pfWoOpenShort') + (k.overdue ? ' · ' + t('pfWoOverdue', { n: k.overdue }) : '') + ' · ' + t('pfEnergyShort', { v: mwh(E2, k.energyKwh) }) + ' · ' + t('pfPer.' + k.period);
  }

  /* --------------------------- header strip ------------------------------- */
  /* every estate figure states its period beside its coverage: counts are live records ("now"), telemetry the estate period */
  const perLabel = (E2, agg) => E2.t(agg.basis.kind === 'count' && !agg.periodOf ? 'pfPer.now' : 'pfPer.' + EST().period(E2));
  function covBadge(E2, key, agg){
    const t = E2.t.bind(E2), w = t('pfCovW.' + (agg.basis.weightKey || 'sites'));
    const txt = perLabel(E2, agg) + ' · ' + t('pfCov', { n: agg.sitesIncluded, total: agg.sitesTotal, pct: agg.coveragePct, w });
    const tip = agg.lowCoverage ? t('pfCovLow', { pct: agg.coveragePct, th: agg.coverageThreshold }) : t('pfCovTip');
    return `<button class="covb" data-act="pfCov" data-v="${key}" data-low="${agg.lowCoverage ? 1 : 0}" data-tip="${esc(tip)}" aria-label="${esc(t('pfCovAria', { m: t(key.startsWith('v-') ? 'pfVert.' + key.slice(2) : 'pfKpi.' + key) }))}">${agg.lowCoverage ? icon('warn', 11) : ''}${esc(txt)}</button>`;
  }
  const kpiChip = (E2, key, agg, valueHtml, unitTxt) => `<div class="pfchip" data-low="${agg.lowCoverage ? 1 : 0}"><span class="tLbl">${esc(E2.t('pfKpi.' + key))}</span><span class="pfval">${valueHtml}${unitTxt ? `<span class="pfunit">${esc(unitTxt)}</span>` : ''}</span>${covBadge(E2, key, agg)}</div>`;

  function page(E2){
    E = E2;
    const t = E.t.bind(E), h = EST().header(E), spec = DG().specs.portfolio, doc = window.EKO_LAYOUTS.portfolio;
    const nUnk = h.alarms.unknownLive.length;
    const ribbon = C().ribbon(E, EST().ribbonList(E), { id: 'estateribbon', tip: t('pfRibTip'), note: nUnk ? t('pfLiveUnknown', { n: nUnk }) : '', act: 'pfSevFilter', actV: 'all' });
    const nr = h.reporting.notReporting.length;
    const nrChip = nr ? `<button class="statchip pfnr" data-sev="stale" data-act="pfNotRep" data-tip="${esc(t('pfNotReportingTip'))}">${icon('clock', 11)} ${esc(t('pfNotReporting', { n: nr }))}</button>` : `<span class="statchip" data-tone="pos">${icon('check', 11)} ${esc(t('pfAllReporting'))}</span>`;
    const mix = t('pfSitesMix', { h: h.mix.hospitality, d: h.mix.datacentre, r: h.mix.retail });
    const chips = kpiChip(E, 'energy', h.energy, `<b>${mwh(E, h.energy.value)}</b>`, t('pfMwh'))
      + kpiChip(E, 'wos', Object.assign({ periodOf: 0 }, h.wos), `<b>${h.wos.value || 0}</b>`, h.overdue.value ? t('pfWoOverdue', { n: h.overdue.value }) : '')
      + kpiChip(E, 'alarms', h.alarms, `<b>${h.alarms.value || 0}</b>`, h.unacked.value ? t('pfUnackedN', { n: h.unacked.value }) : '');
    const V = h.verticals, vert = [];
    if(V.hospitality) vert.push(`<div class="pfvert"><span class="tLbl">${esc(EST().label(E, 'vertical', 'hospitality'))}</span><b>${fmtN(E, V.hospitality.value, 1)}</b><span class="tCap">${esc(t('pfEui'))}</span>${covBadge(E, 'v-hospitality', Object.assign({ periodOf: 1 }, V.hospitality))}</div>`);
    if(V.datacentre) vert.push(`<div class="pfvert"><span class="tLbl">${esc(EST().label(E, 'vertical', 'datacentre'))}</span><b>${V.datacentre.value == null ? esc(t('emptyDash')) : fmtN(E, V.datacentre.value, 2)}</b><span class="tCap">${esc(t('pfPue'))} · ${esc(t('pfItLoad', { v: fmtN(E, V.datacentreIt.value || 0, 0) }))}</span>${covBadge(E, 'v-datacentre', Object.assign({ periodOf: 1 }, V.datacentre))}</div>`);
    if(V.retailOverdue) vert.push(`<div class="pfvert"><span class="tLbl">${esc(EST().label(E, 'vertical', 'retail'))}</span><b>${V.retailOverdue.value || 0}</b><span class="tCap">${esc(t('pfOverdueWord'))} · ${esc(t('pfEnergyPerSite', { v: mwh(E, V.retailEnergyPerSite.value) }))}</span>${covBadge(E, 'v-retail', Object.assign({ periodOf: 1 }, V.retailEnergyPerSite))}</div>`);
    const win = (doc.windows || []).map(w => `<button class="seg" data-on="${E.state.tlRange === w}" data-act="pfWindow" data-v="${w}" aria-pressed="${E.state.tlRange === w}">${esc(t(w === '6h' ? 'tlR6h' : 'tlRDay'))}</button>`).join('');
    const per = EST().period(E), pc = EST().cfg().periods;
    const perSeg = pc.ids.map(p => p === 'custom'
      ? `<button class="seg" disabled data-tip="${esc(t('pfPerCustomTip'))}" aria-disabled="true">${esc(t('pfPer.custom'))}</button>`
      : `<button class="seg" data-on="${per === p}" data-act="pfPeriod" data-v="${p}" aria-pressed="${per === p}">${esc(t('pfPer.' + p))}</button>`).join('');
    return `<section class="pfpage" aria-label="${esc(t('pfTitle'))}">
      <header class="pfhead">
        <div class="pfrow1"><div class="col"><h1 class="pftitle">${esc(t('pfTitle'))}</h1><span class="tCap">${esc(t('pfSubtitle', { n: h.sitesTotal, v: mix }))}${E.state.estateFixture === '1000' ? ' · ' + esc(t('pfFixture1000')) : ''}</span></div><span class="grow"></span>
          <span class="row gap8 pfper"><span class="tCap">${esc(t('pfPeriod'))}</span><span class="segbox row" role="group" aria-label="${esc(t('pfPeriod'))}">${perSeg}</span></span>
          <span class="row gap8 pfwin"><span class="tCap">${esc(t('pfSiteWindow'))}</span><span class="segbox row" role="group" aria-label="${esc(t('pfSiteWindow'))}">${win}</span></span></div>
        <div class="pfstrip">${ribbon}${nrChip}<span class="pfchips">${chips}</span></div>
        ${vert.length ? `<div class="pfverts">${vert.join('')}</div>` : ''}
      </header>
      ${DG().render(E, spec)}
      ${covDialog(E)}
    </section>`;
  }

  /* the coverage badge's list: which sites are out, and why */
  function covDialog(E2){
    if(E2.state.dlg !== 'pfcov') return '';
    const t = E2.t.bind(E2), h = EST().header(E2), key = E2.state.pfCovKey || '';
    const agg = { energy: h.energy, wos: h.wos, alarms: h.alarms, 'v-hospitality': h.verticals.hospitality, 'v-datacentre': h.verticals.datacentre, 'v-retail': h.verticals.retailEnergyPerSite }[key];
    if(!agg) return '';
    const nm = x => { const s = EST().site(E2, x.id); return s ? name(E2, s) : x.id; };
    const li = x => `<li class="pfcovrow"><span class="grow">${esc(nm(x))}</span><span class="tCap">${esc(t('pfReason.' + x.reason))}</span></li>`;
    const label = t(key.startsWith('v-') ? 'pfVert.' + key.slice(2) : 'pfKpi.' + key);
    return `<div class="scrim" data-act="closeDlg"></div><div class="dlg dlgcov" role="dialog" aria-label="${esc(t('pfCovTitle', { m: label }))}"><div class="dgmhead"><h3>${esc(t('pfCovTitle', { m: label }))}</h3><button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(t('close'))}">${icon('x', 13)}</button></div>
      <p class="tCap">${esc(t('pfCov', { n: agg.sitesIncluded, total: agg.sitesTotal, pct: agg.coveragePct, w: t('pfCovW.' + (agg.basis.weightKey || 'sites')) }))}${agg.lowCoverage ? ' · ' + esc(t('pfCovLow', { pct: agg.coveragePct, th: agg.coverageThreshold })) : ''}</p>
      ${agg.sitesExcluded.length ? `<h4 class="tLbl">${esc(t('pfExcluded'))}</h4><ul class="dglist">${agg.sitesExcluded.map(li).join('')}</ul>` : `<p class="tCap">${esc(t('pfCovNone'))}</p>`}
      ${(agg.unknownLive || []).length ? `<h4 class="tLbl">${esc(t('pfLiveUnknownT'))}</h4><ul class="dglist">${agg.unknownLive.map(li).join('')}</ul>` : ''}</div>`;
  }

  /* the map as the grid's alternate body */
  const altBody = (E2, rows) => E2.state.pfView === 'map' ? MAP().render(E2, rows, EST().sites(E2)) : null;

  /* ------------------------------ actions --------------------------------- */
  const toast = (msg) => { if(window.EKO_FB) window.EKO_FB.toast({ text: msg, tone: 'info' }); };
  const gridState = () => DG().st(E, DG().specs.portfolio);
  const ACTS = {
    pfGo(){ E.state.pfFrom = false; E.state.pfCard = null; E.go('portfolio', E.state.module, null); },
    siteGo(el){ const s = EST().site(E, el.dataset.site); if(!s) return;
      const sc = document.querySelector('.dgwrap[data-grid="portfolio"] .dgscroll'); if(sc) gridState().scrollTop = sc.scrollTop;
      E.state.pfFrom = true; E.state.pfCard = null;
      if(s.open){ E.go('marsa-overview', 'overview', null); return; }
      E.state.pfSite = s.id; E.go('pfsite', E.state.module, null); },   /* D104: metered without a model is a real deployment case */
    pfPeriod(el){ E.set({ pfPeriod: el.dataset.v, pfCard: null }); },
    pfViewMode(el){ E.set({ pfView: el.dataset.v, pfCard: null }); },
    pfCov(el){ if(window.EKO_SURF) window.EKO_SURF.noteOpener({ act: 'pfCov', v: el.dataset.v }); E.set({ born: 'dlg', dlg: 'pfcov', pfCovKey: el.dataset.v }); },
    pfCard(el){ E.set({ pfCard: el.dataset.site }); },
    pfCardClose(){ if(E.state.pfCard) E.set({ pfCard: null }); },
    pfZoom(el){ const v = E.state.pfMap || { scale: 1, cx: MAP().W / 2, cy: MAP().H / 2 }; const nx = v.cx + (+el.dataset.x - MAP().W / 2) / v.scale, ny = v.cy + (+el.dataset.y - MAP().H / 2) / v.scale;
      E.set({ pfMap: { scale: Math.min(16, v.scale * 2), cx: nx, cy: ny }, pfCard: null }); },
    pfZoomBtn(el){ const v = E.state.pfMap || { scale: 1, cx: MAP().W / 2, cy: MAP().H / 2 }; const d = el.dataset.v;
      if(d === 'reset' || (d === 'out' && v.scale / 1.5 <= 1.01)){ E.set({ pfMap: null, pfCard: null }); return; }
      E.set({ pfMap: { scale: d === 'in' ? Math.min(16, v.scale * 1.5) : v.scale / 1.5, cx: v.cx, cy: v.cy }, pfCard: null }); },
    pfWindow(el){ E.set({ tlRange: el.dataset.v }); },
    pfNotRep(){ const s = gridState(); s.filters.rep = { in: ['stale', 'offline', 'degraded'] }; s.dirty = true; s.page = 0; E.set({}); },
    pfSevFilter(){ const s = gridState(); s.filters.sev = { in: ['critical', 'high', 'medium'] }; s.dirty = true; s.page = 0; E.set({}); },
    pfSavedView(el){ const spec = DG().specs.portfolio; DG().applyView(E, spec, DG().st(E, spec), el.dataset.v); E.state.dlg = null; E.state.pfFrom = false; E.go('portfolio', E.state.module, null); }
  };

  /* ------------------------- site detail (D104) ---------------------------
     A site that is metered but has no 3D model configured: its KPIs for the
     estate period, alarm records by severity, work orders, meter status and
     energy by period — the same facts the row carries, stated in full. */
  function sitePage(E2){
    E = E2;
    const t = E.t.bind(E), s = EST().site(E, E.state.pfSite);
    if(!s) return `<section class="pfpage pfsite"><p class="alempty">${esc(t('dgEmpty'))}</p></section>`;
    const a = s.alarms || {}, m = s.meters, per = EST().period(E);
    const kv = (k, v, tip) => `<div class="aprow"${tip ? ` data-tip="${esc(tip)}"` : ''}><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    const energy = EST().energyByPeriod(E, s).map(r => kv(t('pfPer.' + r.id), r.kwh == null ? `<span class="tCap">${esc(t('emptyDash'))} · ${esc(t(r.ok ? 'pfNo.' + s.state : 'pfReason.insufficientHistory', { t: agoText(E, s) }))}</span>` : `<b>${mwh(E, r.kwh)}</b> <span class="tCap">${esc(t('pfMwh'))}</span>`)).join('');
    return `<section class="pfpage pfsite" aria-label="${esc(name(E, s))}">
      <header class="pfhead"><div class="pfrow1"><div class="col gap4"><h1 class="pftitle">${C().icon(EST().typeOf(s.type).icon || 'home', 15)} ${esc(name(E, s))}</h1><span class="tCap">${esc(EST().label(E, 'type', s.type))} · ${esc(E.lang === 'ar' ? s.clusterAr : s.clusterEn)} · ${esc(EST().label(E, 'region', s.region))}${(s.tags || []).length ? ' · ' + esc(s.tags.join(', ')) : ''}</span></div><span class="grow"></span>${repChip(E, s)}<button class="btnG btnSm" data-act="pfGo">${C().icon('chevL', 12)} ${esc(t('pfTitle'))}</button></div>
        ${!s.open ? `<div class="pfnote" role="note">${C().icon('box', 14)}<span>${esc(t('pfNoModel'))}</span></div>` : ''}
        <div class="row gap8 pfper"><span class="tCap">${esc(t('pfPeriod'))}</span><span class="segbox row" role="group" aria-label="${esc(t('pfPeriod'))}">${EST().cfg().periods.ids.map(p => p === 'custom' ? `<button class="seg" disabled data-tip="${esc(t('pfPerCustomTip'))}" aria-disabled="true">${esc(t('pfPer.custom'))}</button>` : `<button class="seg" data-on="${per === p}" data-act="pfPeriod" data-v="${p}" aria-pressed="${per === p}">${esc(t('pfPer.' + p))}</button>`).join('')}</span></div>
      </header>
      <div class="pfsgrid">
        <section class="pfscard"><h2 class="tLbl">${esc(t('pfsKpis'))} · ${esc(t('pfPer.' + per))}</h2><div class="pfskpi">${kpiCell(E, s)}</div>
          ${kv(t('pfsFloorArea'), fmtN(E, s.floorArea, 0) + ' m²')}${s.itLoadKw ? kv(t('pfsItLoad'), fmtN(E, s.itLoadKw, 0) + ' kW') : ''}${kv(t('pfsHistory'), t('pfsMonths', { n: s.monthsOfData || 0 }))}${kv(t('pfc.compliance'), s.compliancePct == null ? t('emptyDash') : s.compliancePct + '%')}</section>
        <section class="pfscard"><h2 class="tLbl">${esc(t('pfsAlarms'))}</h2><div class="pfsalarms">${['critical', 'high', 'medium'].map(sev => `<span class="pfsev">${C().sevGlyph(sev, false, 13)}<b>${a[sev] || 0}</b><span class="tCap">${esc(t('rpSev.' + sev))}</span></span>`).join('')}<span class="tCap">· ${esc(t('pfUnackedN', { n: s.unacked || 0 }))}</span></div>
          ${!s.telemetry ? `<p class="tCap pfwarnline">${C().icon('warn', 11)} ${esc(t('pfLiveUnknownOne'))}</p>` : ''}<p class="tCap">${esc(t('pfsAlarmsNote'))}</p></section>
        <section class="pfscard"><h2 class="tLbl">${esc(t('pfsWos'))}</h2>${kv(t('pfWoOpenShort'), `<b>${s.wos.open}</b>`)}${kv(t('pfOverdueWord'), `<b>${s.wos.overdue}</b>`)}<p class="tCap">${esc(t('pfsWosNote'))}</p></section>
        <section class="pfscard"><h2 class="tLbl">${esc(t('pfsMeters'))}</h2>${m ? ['ok', 'intermittent', 'offline', 'unconfirmed'].map(q => kv(t('mtQ.' + q), `<b>${m[q] || 0}</b>`)).join('') + kv(t('pfsMetersTotal'), `<b>${m.n}</b>`) : `<p class="tCap">${esc(t('emptyDash'))}</p>`}<p class="tCap">${esc(t('pfsMetersNote'))}</p></section>
        <section class="pfscard"><h2 class="tLbl">${esc(t('pfsEnergyBy'))}</h2>${energy}<p class="tCap">${esc(t('pfsEnergyNote'))}</p></section>
      </div></section>`;
  }

  /* the breadcrumb prefix: Portfolio above the site whenever the estate is the context */
  const crumb = E2 => (E2.state.pageId === 'portfolio' || E2.state.pfFrom || (E2.data.user && E2.data.user.role === 'executive'));

  function init(app){ E = app; }
  return { page, sitePage, init, ACTS, repChip, sevCell, sevText, kpiCell, kpiText, agoText, altBody, crumb, name };
})();
