/* ============================================================================
   GRID SPECS (D100) — the asset register and the portfolio site list as
   column documents on the shared data grid (js/components/datagrid.js).
   Every label is an i18n key; every value comes from the data layer.
   ============================================================================ */
(function(){
  'use strict';
  const DG = () => window.EKO_DG, C = () => window.EKO_C;
  const esc = s => C().esc(s);
  const ar = E => E.lang === 'ar';
  const worst = (E, r) => (r.alarms || []).map(id => E.alarm(id)).sort((x, y) => ({ critical:0, high:1, medium:2 }[x.sev] - { critical:0, high:1, medium:2 }[y.sev]))[0];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const svcDate = s => { if(!s || s === '–') return null; const m = /^(\d{1,2}) ([A-Za-z]{3})$/.exec(s); if(!m) return null; const mi = MONTHS.indexOf(m[2]); return mi < 0 ? null : new Date(2026, mi, +m[1]); };
  const isoDate = s => s ? new Date(s) : null;
  const fmtDate = (E, d) => d ? d.toLocaleDateString(ar(E) ? 'ar-AE' : 'en-GB', { day:'numeric', month:'short', year:'numeric' }) : E.t('emptyDash');
  const tagsOf = (E, r) => (r.tags || []).concat(((E.state.tags || {})[r.id] || []));
  const fam = (E, id) => { const f = (E.data.families || []).find(x => x.id === id); return f ? (ar(E) ? f.ar : f.en) : id; };
  /* D101: trend sparkline of the asset's primary point (7 daily fixture values), row menu, inline expansion */
  const HUE = { hvac:'var(--domEnergy)', vent:'var(--domEnergy)', pumps:'var(--domEnergy)', elec:'var(--domEnergy)', light:'var(--domEnergy)' };
  const pAr = (E, x) => E.ph(x);
  const fmt1 = (E, v) => (Math.round(v * 10) / 10).toLocaleString(ar(E) ? 'ar-AE' : 'en-GB');
  const trendReason = (E, r) => r.st === 'stale' ? 'dgNoTrend.stale' : (r.trendKind === 'state' ? 'dgNoTrend.state' : 'dgNoTrend.none');
  const trendOk = r => r.trend7 && Array.isArray(r.trend7.vals) && r.trend7.vals.length >= 2;
  const trendText = (E, r) => { if(!trendOk(r)) return E.t('emptyDash') + ' · ' + E.t(trendReason(E, r)); const v = r.trend7.vals; return E.t('dgTrendTip', { point:pAr(E, r.trend7.point), lo:fmt1(E, Math.min(...v)), hi:fmt1(E, Math.max(...v)), u:r.trend7.unit || '' }).trim(); };
  const trendCell = (E, r) => { if(!trendOk(r)) return `<span class="dgnotrend" data-tip="${esc(E.t(trendReason(E, r)))}" aria-label="${esc(E.t(trendReason(E, r)))}" role="img">${C().icon('nohist', 14)}</span>`;
    const v = r.trend7.vals, p = window.ekoTrend(v, 100, 24);
    return `<span class="dgspark" data-tip="${esc(trendText(E, r))}"><svg viewBox="0 0 100 24" width="100" height="24" aria-hidden="true"><path d="${p.line}" fill="none" stroke="${HUE[r.sys] || 'var(--t2)'}" stroke-width="1.5"/></svg></span>`; };
  const trendDelta = r => trendOk(r) ? r.trend7.vals[r.trend7.vals.length - 1] - r.trend7.vals[0] : null;
  const rowMenu = (E, r) => [
    { section:'dgr.sOpen', act:'openAsset', attr:'asset', labelKey:'dgr.open', icon:'doc' },
    { section:'dgr.sOpen', act:'locate', attr:'asset', labelKey:'dgr.locate', icon:'map' },
    { section:'dgr.sAct', act:'cwo', attr:'asset', labelKey:'dgr.wo', icon:'wrench' },
    { section:'dgr.sAct', act:'dgRowAck', attr:'id', labelKey:'dgr.ack', icon:'check', off:!(r.alarms || []).some(id => { const a = E.alarm(id); return a && !a.ack; }) },
    { section:'dgr.sRef', act:'dgCopyId', attr:'id', labelKey:'dgr.copy', icon:'grid' },
    { section:'dgr.sRef', act:'none', attr:'asset', labelKey:'dgr.cafm', icon:'expand' }
  ];
  const expand = (E, r) => { const t = E.t.bind(E); const als = (r.alarms || []).map(id => E.alarm(id)).filter(Boolean);
    const live = (r.params || []).length ? `<dl class="dgxl">${r.params.map(p => `<div class="aprow"><dt>${esc(pAr(E, p[0]))}<span class="apsrc">${esc(pAr(E, p[1]))}</span></dt><dd>${esc(p[2])}</dd></div>`).join('')}</dl>` : `<p class="tCap">${esc(t('emptyDash'))}</p>`;
    const al = als.length ? als.map(a => `<div class="alref"><div class="alrefh"><span class="statchip" data-sev="${a.sev}">${esc(t('rib' + a.sev[0].toUpperCase() + a.sev.slice(1)).toLowerCase())}</span><span class="alrefage tMonoS msA">${esc(a.age)}</span></div>
      <div class="alreft">${esc(E.alarmLines(a).main)}</div>${E.alarmLines(a).sub ? `<div class="alreftech">${esc(E.alarmLines(a).sub)}</div>` : ''}<div class="alrefack">${a.ack ? esc(t('ackShort', { time:a.ack.time, who:a.ack.who })) : esc(t('apUnack'))}</div></div>`).join('') : `<p class="tCap">${esc(t('apNoAlarms'))}</p>`;
    return `<div class="dgxg"><section><h4 class="tLbl">${esc(t('apLiveParams'))}</h4>${live}</section><section><h4 class="tLbl">${esc(t('dgxAlarms'))}</h4>${al}</section></div>`; };

  const assets = E => ({
    id:'assets', titleKey:'regTitle', exportName:'asset-register', rowKey:'id', rowAct:{ act:'openAsset', attr:'asset' }, searchKeys:['id', 'zone', 'type'],
    isSelectedRow:(E2, r) => E2.state.assetSel === r.id,
    rows: E2 => E2.data.assets,
    groups:[{ id:'identity', labelKey:'dgg.identity' }, { id:'condition', labelKey:'dgg.condition' }, { id:'maintenance', labelKey:'dgg.maintenance' }, { id:'reference', labelKey:'dgg.reference' }],
    rowMenu, expand,
    head: (E2, n, total) => `<div class="dghead"><span class="modtitle">${esc(E2.t('modAssets'))}</span><span class="alcardt">${esc(E2.t('regHead'))}</span><span class="alcardm"> ${esc(E2.t('regConnected', { n, total:E2.data.registerTotal.toLocaleString('en-US') }))} <button class="statlink" data-act="dgQuick" data-k="st" data-v="stale">${esc(E2.t('regStaleN', { n:E2.data.assets.filter(r => r.st === 'stale').length }))}</button></span></div>`,
    consume(E2, s){   /* entries from other pages (Overview by-system row, alert chips) become grid filters */
      if(E2.state.regSysF){ s.filters.sys = { in:[E2.state.regSysF] }; E2.state.regSysF = null; s.dirty = true; }
      if(E2.state.regSevF){ s.filters.sev = { in:[E2.state.regSevF] }; E2.state.regSevF = null; s.dirty = true; }
      if(E2.state.regStF){ s.filters.st = { in:[E2.state.regStF] }; E2.state.regStF = null; s.dirty = true; }
    },
    columns:[
      { key:'id', labelKey:'dgc.id', type:'text', width:116, mono:true, def:true, grp:'identity', mob:'title', get:(E2, r) => r.id, text:(E2, r) => r.id },
      { key:'st', labelKey:'dgc.status', type:'enum', width:138, def:true, grp:'condition', mob:'chip', get:(E2, r) => r.st, text:(E2, r) => r.st === 'alarm' ? (r.alarms.length > 1 ? r.alarms.length + ' ' + E2.t('alarms').toLowerCase() : E2.t('chipAlarm', { sev:E2.t('rib' + worst(E2, r).sev[0].toUpperCase() + worst(E2, r).sev.slice(1)) })) : r.st === 'stale' ? E2.t('chipStale', { h:r.staleH }) : E2.t('stNormal'),
        cell:(E2, r) => r.st === 'alarm' ? `<span class="statchip" data-sev="${worst(E2, r).sev}">${esc(r.alarms.length > 1 ? r.alarms.length + ' ' + E2.t('alarms').toLowerCase() : E2.t('chipAlarm', { sev:E2.t('rib' + worst(E2, r).sev[0].toUpperCase() + worst(E2, r).sev.slice(1)) }))}</span>` : r.st === 'stale' ? `<span class="statchip" data-sev="stale">${esc(E2.t('chipStale', { h:r.staleH }))}</span>` : `<span class="tCap">${esc(E2.t('stNormal'))}</span>`,
        enumOpts:E2 => [{ v:'alarm', label:E2.t('dgv.alarm') }, { v:'stale', label:E2.t('dgst.stale') }, { v:'ok', label:E2.t('stNormal') }],
        sortVal:(E2, r) => ({ alarm:0, stale:1, ok:2 }[r.st]) },
      { key:'trend', labelKey:'dgc.trend', type:'text', width:132, def:true, grp:'condition', noFilter:true, get:(E2, r) => trendText(E2, r), text:(E2, r) => trendText(E2, r), cell:(E2, r) => trendCell(E2, r), sortVal:(E2, r) => { const d = trendDelta(r); return d == null ? null : -d; } },
      { key:'sev', labelKey:'dgc.sev', type:'enum', width:150, def:false, grp:'condition', get:(E2, r) => { const w = worst(E2, r); return w ? w.sev : ''; }, text:(E2, r) => { const w = worst(E2, r); return w ? E2.t('rpSev.' + w.sev) : E2.t('emptyDash'); },
        enumOpts:E2 => ['critical', 'high', 'medium'].map(v => ({ v, label:E2.t('rpSev.' + v) })), sortVal:(E2, r) => { const w = worst(E2, r); return w ? ({ critical:0, high:1, medium:2 }[w.sev]) : 9; } },
      { key:'floor', labelKey:'dgc.floor', type:'enum', width:94, def:true, grp:'identity', get:(E2, r) => r.floor, text:(E2, r) => r.floor, enumOpts:E2 => [...new Set(E2.data.assets.map(r => r.floor))].map(v => ({ v, label:v })) },
      { key:'zone', labelKey:'dgc.zone', type:'text', width:132, def:true, grp:'identity', mob:'line2', get:(E2, r) => ar(E2) ? (r.zoneAr || r.zone) : r.zone, text:(E2, r) => ar(E2) ? (r.zoneAr || r.zone) : r.zone },
      { key:'wos', labelKey:'dgc.wos', type:'num', width:158, def:true, grp:'maintenance', mono:true, get:(E2, r) => r.wos || 0, text:(E2, r) => r.wos ? String(r.wos) : E2.t('emptyDash') },
      { key:'wost', labelKey:'dgc.wost', type:'enum', width:124, def:true, grp:'maintenance', get:(E2, r) => r.wost || '', text:(E2, r) => r.wost ? E2.t('wo' + r.wost[0].toUpperCase() + r.wost.slice(1)) : E2.t('emptyDash'),
        cell:(E2, r) => r.wost ? `<span class="row gap6"><span class="wodot" data-st="${r.wost}"></span>${esc(E2.t('wo' + r.wost[0].toUpperCase() + r.wost.slice(1)))}</span>` : `<span class="tCap">${esc(E2.t('emptyDash'))}</span>`,
        enumOpts:E2 => ['pend', 'asgn', 'prog', 'done'].map(v => ({ v, label:E2.t('wo' + v[0].toUpperCase() + v.slice(1)) })) },
      { key:'hasWo', labelKey:'dgc.hasWo', type:'bool', width:196, def:false, grp:'maintenance', get:(E2, r) => !!(r.wos && r.wost && r.wost !== 'done'), text:(E2, r) => E2.t((r.wos && r.wost && r.wost !== 'done') ? 'dgf.yes' : 'dgf.no') },
      { key:'type', labelKey:'dgc.type', type:'enum', width:170, def:false, grp:'identity', mob:'line2', get:(E2, r) => r.typeEn, text:(E2, r) => ar(E2) ? (r.typeAr || r.typeEn) : r.typeEn, enumOpts:E2 => [...new Set(E2.data.assets.map(r => r.typeEn))].map(v => ({ v, label:(ar(E2) ? (E2.data.assets.find(r => r.typeEn === v).typeAr || v) : v) })) },
      { key:'sys', labelKey:'dgc.sys', type:'enum', width:150, def:false, grp:'identity', get:(E2, r) => r.sys || '', text:(E2, r) => r.sys ? fam(E2, r.sys) : E2.t('emptyDash'), enumOpts:E2 => (E2.data.families || []).map(f => ({ v:f.id, label:ar(E2) ? f.ar : f.en })) },
      { key:'crit', labelKey:'dgc.crit', type:'enum', width:140, def:false, grp:'condition', get:(E2, r) => r.crit || '', text:(E2, r) => r.crit ? E2.t('dgCrit.' + r.crit) : E2.t('emptyDash'), enumOpts:E2 => ['A', 'B', 'C'].map(v => ({ v, label:E2.t('dgCrit.' + v) })) },
      { key:'last', labelKey:'dgc.last', type:'text', width:200, def:false, grp:'condition', get:(E2, r) => r.params && r.params[0] ? r.params[0][0] + ' · ' + r.params[0][2] : '', text:(E2, r) => r.params && r.params[0] ? r.params[0][0] + ' · ' + r.params[0][2] : E2.t('emptyDash') },
      { key:'svc', labelKey:'dgc.svc', type:'date', width:200, def:false, grp:'maintenance', get:(E2, r) => svcDate(r.svc), text:(E2, r) => fmtDate(E2, svcDate(r.svc)) },
      { key:'wty', labelKey:'dgc.wty', type:'date', width:164, def:false, grp:'maintenance', get:(E2, r) => isoDate(r.wtyEnd), text:(E2, r) => fmtDate(E2, isoDate(r.wtyEnd)) },
      { key:'cafm', labelKey:'dgc.cafm', type:'text', width:124, def:false, grp:'reference', mono:true, get:(E2, r) => r.cafm || '', text:(E2, r) => r.cafm || E2.t('emptyDash') },
      { key:'tags', labelKey:'dgc.tags', type:'text', width:160, def:false, grp:'reference', get:(E2, r) => tagsOf(E2, r).join(' '), text:(E2, r) => tagsOf(E2, r).join(', ') || E2.t('emptyDash'),
        cell:(E2, r) => tagsOf(E2, r).length ? tagsOf(E2, r).map(x => `<span class="chip dgtag">${esc(x)}</span>`).join(' ') : `<span class="tCap">${esc(E2.t('emptyDash'))}</span>` }
    ],
    views:[
      { id:'all', nameKey:'dgv.all', cols:['id', 'st', 'trend', 'floor', 'zone', 'wos', 'wost'], sort:[{ key:'st', dir:'asc' }], filters:{}, density:'standard' },
      { id:'alarm', nameKey:'dgv.alarm', cols:['id', 'st', 'sev', 'sys', 'zone', 'wost'], sort:[{ key:'sev', dir:'asc' }], filters:{ st:{ in:['alarm'] } }, density:'standard' },
      { id:'wo', nameKey:'dgv.wo', cols:['id', 'wost', 'wos', 'st', 'zone', 'svc'], sort:[{ key:'wos', dir:'desc' }], filters:{ hasWo:{ is:true } }, group:'wost', density:'compact' }
    ],
    bulk:[
      { id:'wo', labelKey:'dgBulkWo', icon:'wrench', doneKey:'dgBulkWoDone', run:(E2, rows) => { E2.state.woPhase = E2.state.woPhase || {}; let n = 0; rows.forEach(r => { if(E2.state.woRaised[r.id] || E2.state.woPhase[r.id]) return; E2.state.woPhase[r.id] = 'raising'; n++; if(window.EKO_CMMS) window.EKO_CMMS.createWorkOrder({ assetId:r.id }); }); return n; } },
      { id:'ack', labelKey:'dgBulkAck', icon:'check', doneKey:'dgBulkAckDone', run:(E2, rows) => { let n = 0; const d = new Date(); const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        rows.forEach(r => (r.alarms || []).forEach(id => { const a = E2.alarm(id); if(a && !a.ack){ a.ack = { time, who:'AY' }; n++; } })); return n; } },
      { id:'export', labelKey:'dgBulkExport', icon:'download' },
      { id:'tag', labelKey:'dgBulkTag', icon:'plus', run:(E2, rows, tag) => { E2.state.tags = E2.state.tags || {}; rows.forEach(r => { const set = new Set(E2.state.tags[r.id] || []); set.add(tag); E2.state.tags[r.id] = [...set]; }); try{ localStorage.setItem('eko-tags-' + ((E2.data.user && E2.data.user.name) || 'user'), JSON.stringify(E2.state.tags)); }catch(e){} return rows.length; } }
    ]
  });

  /* The portfolio site list (D103): the same component, the estate spec.
     Rows come from EKO_EST (derived once per change); cells from EKO_PF. */
  const portfolio = E => { const EST = () => window.EKO_EST, PF = () => window.EKO_PF, DE = () => window.EKO_DATA.estate; return {
    id:'portfolio', titleKey:'pfTitle', exportName:'portfolio', rowKey:'id', rowAct:{ act:'siteGo', attr:'site' }, searchKeys:['site', 'tags'],
    selectable:false, pinKey:'site', pageSize:DE().config.pageSize, cardsBelow:1023,
    facets:['region', 'cluster', 'type', 'rep', 'sev', 'compliance'], groupBy:['region', 'cluster'],
    rows: E2 => EST().sites(E2),
    altBody: (E2, rows, s) => PF().altBody(E2, rows, s),
    head: (E2, n, total) => `<div class="dghead pfgridhead"><span class="alcardt">${esc(E2.t('pfSites'))}</span><span class="grow"></span><span class="segbox row" role="group" aria-label="${esc(E2.t('pfViewMode'))}">${['table', 'map'].map(v => `<button class="seg" data-on="${(E2.state.pfView || 'table') === v}" data-act="pfViewMode" data-v="${v}" aria-pressed="${(E2.state.pfView || 'table') === v}">${C().icon(v === 'table' ? 'columns' : 'map', 12)} ${esc(E2.t('pfView.' + v))}</button>`).join('')}</span></div>`,
    columns:[
      { key:'site', labelKey:'pfc.site', type:'text', width:230, def:true, mob:'title', get:(E2, r) => PF().name(E2, r), text:(E2, r) => PF().name(E2, r),
        cell:(E2, r) => `<span class="pfsite">${C().icon(EST().typeOf(r.type).icon || 'home', 13)} <b>${esc(PF().name(E2, r))}</b><span class="tCap pfsub">${esc(EST().label(E2, 'type', r.type))} · ${esc(ar(E2) ? r.clusterAr : r.clusterEn)}</span></span>` },
      { key:'rep', labelKey:'pfc.rep', type:'enum', width:130, def:true, mob:'chip', get:(E2, r) => r.state, text:(E2, r) => E2.t('pfRep.' + r.state), cell:(E2, r) => PF().repChip(E2, r),
        enumOpts:E2 => ['reporting', 'degraded', 'stale', 'offline'].map(v => ({ v, label:E2.t('pfRep.' + v) })), sortVal:(E2, r) => r.repRank },
      { key:'sev', labelKey:'pfc.sev', type:'enum', width:170, def:true, mob:'line2', get:(E2, r) => r.worstSev || '', text:(E2, r) => PF().sevText(E2, r), cell:(E2, r) => PF().sevCell(E2, r),
        enumOpts:E2 => ['critical', 'high', 'medium'].map(v => ({ v, label:E2.t('rpSev.' + v) })), sortVal:(E2, r) => r.sevRank * 1000 - r.alarmCount },
      { key:'kpi', labelKey:'pfc.kpi', type:'text', width:250, def:true, mob:'kpi', noFilter:true, get:(E2, r) => PF().kpiText(E2, r), text:(E2, r) => PF().kpiText(E2, r), cell:(E2, r) => PF().kpiCell(E2, r),
        sortVal:(E2, r) => ({ hospitality:0, datacentre:1, retail:2 }[r.vertical] || 0) * 1e9 + (r.telemetry && r.kpi.value != null ? -r.kpi.value : 1e8) },
      { key:'wos', labelKey:'pfc.wos', type:'num', width:150, def:true, mob:'line3', hideBelow:1024, get:(E2, r) => r.wos.open, text:(E2, r) => r.wos.open + (r.wos.overdue ? ' · ' + E2.t('pfWoOverdue', { n:r.wos.overdue }) : ''),
        cell:(E2, r) => `<span class="pfwos"><b>${r.wos.open}</b>${r.wos.overdue ? ` <span class="statchip" data-sev="high">${esc(E2.t('pfWoOverdue', { n:r.wos.overdue }))}</span>` : ''}</span>` },
      { key:'last', labelKey:'pfc.last', type:'date', width:130, def:true, hideBelow:1280, get:(E2, r) => r.lastSampleAt == null ? null : new Date(r.lastSampleAt), text:(E2, r) => PF().agoText(E2, r),
        cell:(E2, r) => `<span class="tCap" data-tip="${esc(r.lastSampleAt == null ? E2.t('pfNever') : new Date(r.lastSampleAt).toLocaleString(ar(E2) ? 'ar-AE' : 'en-GB'))}">${esc(PF().agoText(E2, r))}</span>` },
      { key:'region', labelKey:'pfc.region', type:'enum', width:120, def:false, get:(E2, r) => r.region, text:(E2, r) => EST().label(E2, 'region', r.region), enumOpts:E2 => DE().regions.map(x => ({ v:x.id, label:ar(E2) ? x.ar : x.en })) },
      { key:'cluster', labelKey:'pfc.cluster', type:'enum', width:130, def:false, get:(E2, r) => r.cluster, text:(E2, r) => EST().label(E2, 'cluster', r.cluster), enumOpts:E2 => DE().clusters.map(x => ({ v:x.id, label:ar(E2) ? x.ar : x.en })) },
      { key:'type', labelKey:'pfc.type', type:'enum', width:140, def:false, get:(E2, r) => r.type, text:(E2, r) => EST().label(E2, 'type', r.type), enumOpts:E2 => Object.keys(DE().types).map(v => ({ v, label:EST().label(E2, 'type', v) })) },
      { key:'compliance', labelKey:'pfc.compliance', type:'enum', width:150, def:false, get:(E2, r) => r.complianceBand || '', text:(E2, r) => r.compliancePct == null ? E2.t('emptyDash') : r.compliancePct + '%', enumOpts:E2 => ['ok', 'mid', 'low'].map(v => ({ v, label:E2.t('pfComp.' + v) })), sortVal:(E2, r) => r.compliancePct == null ? null : -r.compliancePct },
      { key:'tags', labelKey:'pfc.tags', type:'text', width:160, def:false, get:(E2, r) => (r.tags || []).join(' '), text:(E2, r) => (r.tags || []).join(', ') || E2.t('emptyDash') }
    ],
    views:[{ id:'all', nameKey:'dgv.allSites', cols:['site', 'rep', 'sev', 'kpi', 'wos', 'last'], sort:[{ key:'sev', dir:'asc' }, { key:'rep', dir:'asc' }], filters:{}, density:'standard' }],
    bulk:[]
  }; };

  window.EKO_GRIDS = { assets, portfolio };
})();
