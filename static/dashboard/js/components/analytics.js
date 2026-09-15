/* ============================================================================
   EKO analytics pages — Systems, Benchmark, Anomalies, Forecasting, Water,
   Gas, Spaces, Assets landing and the Heat Map panel. Structure carried from
   the live reference (see /docs/screen-branches.md); strings from /js/i18n,
   numbers from /js/data, composition from /js/layouts. Pure render functions.
   ============================================================================ */
window.EKO_A = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = (...a) => C().esc(...a);
  const fmt = (...a) => C().fmt(...a);
  const icon = (...a) => C().icon(...a);

  /* Widget chrome the full-mode pages share (D132b): the ONE control cluster — sparkle · expand · drag — fixed top-right (widgets.js ctl). */
  const chrome = (E, label, cap) => C().ctl(E, label, cap);
  const tileCtl = (E, label, cap) => C().ctl(E, label, cap);
  const widget = (E, title, cap, inner, foot, extraHead) =>
    `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(title)}</span>
        ${cap?`<span class="alcardm">${esc(cap)}</span>`:''}${extraHead||''}${chrome(E, title, cap)}</div>
      ${inner}
      ${foot?`<span class="ovkcap">${esc(foot)}</span>`:''}</article>`;
  const heroTile = (E, lbl, v, u, cap, chip, chipTone) =>
    `<div class="pwtile"><div class="pwth"><span class="ovklbl">${esc(lbl)}</span>
        ${chip?`<span class="pwchip" data-tone="${chipTone||'warn'}">${esc(chip)}</span>`:''}${tileCtl(E, lbl, cap)}</div>
      <div class="ovkval"><span class="ovknum">${esc(v)}</span><span class="ovkunit">${esc(u)}</span></div>
      <span class="ovkcap">${esc(cap)}</span></div>`;
  const page = (E, heroes, widgets, pg) =>
    `<div class="pwarea" ${pg?`data-pg="${pg}"`:''}><div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>${widgets}</div>`;

  /* ------------------------------- SYSTEMS --------------------------------- */
  /* Systems summary cards (D33 — geometry measured from the Latest mock):
     a 4-column grid; stat/gauge/donut span 2, headline chip-stats and the
     trend span 4, IAQ tiles span 1 each. Cards carry a tone wash
     (ok = green, attention = red) with a dot before the label. */
  function sysCard(E, c, g){
    const ar = E.lang === 'ar';
    const word = (ar ? c.wordAr : c.wordEn) || '';
    const wash = c.wash || ((c.tone === 'warn' || c.tone === 'crit') ? 'warn' : 'ok');
    /* Dot rule (Final mock): equipment/chip stats carry the GROUP hue;
       everything else is tone-coded (green ok / red attention). */
    const dot = (c.chipEn && g && g.hue)
      ? `<span class="scdot" style="background:${g.hue}"></span>`
      : `<span class="scdot" data-tone="${wash}"></span>`;
    const head = `<div class="ovkhead">${dot}<span class="ovklbl">${esc(ar?c.labelAr:c.labelEn)}</span>
      ${c.chipEn?`<span class="pwchip msA" data-tone="${c.tone}">${esc(ar?c.chipAr:c.chipEn)}</span>`:''}</div>`;
    if(c.kind === 'stat')
      return `<div class="syscard" data-span="4" data-wash="${wash}">${head}
        <div class="scrow"><span class="scval lg">${esc(c.v)}${c.u?`<span class="ovkunit">${esc(c.u)}</span>`:''}</span>
        <span class="ovkcap msA" data-tone="${c.tone==='ok'?'pos':c.tone==='warn'?'warn':'t3'}">${esc((ar?c.capAr:c.capEn)||'')}</span></div></div>`;
    if(c.kind === 'gauge'){
      const g = ekoGauge(c.val, c.min, c.max, c.ramp);
      return `<div class="syscard" data-span="2" ${c.tall?'data-tall="1"':''} data-wash="${wash}">${head}
        <div class="sysgauge"><svg viewBox="0 0 124 78" width="112" height="70">
          ${g.segs.map(s=>`<path d="${s.d}" stroke="${s.c}" stroke-width="9" fill="none"/>`).join('')}
          <line x1="62" y1="66" x2="${g.nx}" y2="${g.ny}" stroke="#E2703A" stroke-width="3" stroke-linecap="round"/>
          <circle cx="62" cy="66" r="4.5" fill="var(--s3)" stroke="var(--bd2)" stroke-width="1.5"/></svg>
        ${g.ticks.map(t=>`<span style="${t.css}">${esc(t.t)}</span>`).join('')}</div>
        <div class="scrow"><span class="ovkcap" data-tone="${c.tone==='warn'?'warn':'pos'}">${esc(word)}</span>
        <span class="scval sm msA">${esc(String(c.val))}${c.u?esc(c.u):''}</span></div></div>`;
    }
    if(c.kind === 'donut'){
      const d = ekoDonut(c.pct);
      return `<div class="syscard" data-span="2" data-wash="${wash}">${head}
        <div class="scdonut"><svg viewBox="0 0 76 76" width="64" height="64">
          <circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="none" stroke="var(--s3)" stroke-width="8"/>
          <circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="none" stroke="var(--acc)" stroke-width="8"
            stroke-dasharray="${d.dash}" stroke-linecap="round" transform="rotate(-90 ${d.cx} ${d.cy})"/></svg>
          <span class="scdpct tMonoS fw6">${fmt(c.pct, c.pct % 1 ? 2 : 0)}%</span></div>
        <span class="ovkcap" data-tone="pos">${esc(word)}</span></div>`;
    }
    if(c.kind === 'tiles')
      return c.tiles.map(t2 =>
        `<div class="syscard sctile" data-span="1" data-wash="ok">
          <div class="ovkhead"><span class="scdot" data-tone="ok"></span><span class="ovklbl">${esc(t2[0])}</span></div>
          <span class="scval">${t2[1]}</span>
          <span class="ovkcap" data-tone="pos">${esc(word)}</span></div>`).join('');
    if(c.kind === 'trend'){
      const tr = ekoTrend(c.series, 240, 56);
      const seg = k => `<button class="seg" data-on="${k==='rangeHourly'}" data-act="none">${esc(E.t(k))}</button>`;
      return `<div class="syscard" data-span="4" data-wash="ok">
        <div class="ovkhead"><span class="scdot" data-tone="ok"></span><span class="ovklbl">${esc(ar?c.labelAr:c.labelEn)}</span></div>
        <div class="row segbox asS">${['rangeHourly','rangeToday','rangeWeekly','rangeMonthly'].map(seg).join('')}</div>
        <div class="systrend"><span class="tMonoS cT3">${c.yMax}</span>
          <svg viewBox="0 0 240 56" preserveAspectRatio="none">
            <path d="${tr.area}" fill="var(--accT)"/>
            <path d="${tr.line}" fill="none" stroke="var(--acc)" stroke-width="1.5"/>
            <line x1="0" x2="240" y1="${tr.avgY}" y2="${tr.avgY}" stroke="var(--t3)" stroke-dasharray="4 4" stroke-width="1"/></svg>
          <span class="tMonoS cT3">${c.yMin}</span></div>
        <span class="ovkcap">${esc(E.t('avgLbl',{v:fmt(c.avg,1)}))}</span></div>`;
    }
    return '';
  }
  function systemsSummary(E){
    const ar = E.lang === 'ar';
    const groups = E.data.systems.groups.filter(g => !g.hidden && (!E.state.sub || g.id === E.state.sub));
    const inner = groups.map(g => {
      const n = E.data.alarms.filter(a => g.sysKey.includes(a.sys)).length;
      const open = (E.state.sysExp||{})[g.id] !== false;
      /* Locked groups (Final mock): header only — routes to the teaser. */
      if(g.locked && !E.state.sub)
        return `<div class="sysgroup">
          <button class="sysgrouph" data-lock="true" data-act="teaser" data-teaser="systems.${g.id}" data-mod="systems">
            <span class="sysdot2" style="background:${g.hue}"></span><span class="sysgt">${esc(ar?g.labelAr:g.labelEn)}</span>
            <span class="sysgn">${n}</span><span class="msA cT3">${icon('lock',12)}</span></button></div>`;
      return `<div class="sysgroup">
        <button class="sysgrouph" data-act="goSub" data-mod="systems" data-sub="${g.id}" data-page="systems">
          <span class="sysdot2" style="background:${g.hue}"></span><span class="sysgt">${esc(ar?g.labelAr:g.labelEn)}</span>
          <span class="sysgn">${n}</span>
          ${E.state.sub?'':`<span class="sgchev msA cT3" role="button" tabindex="0" data-act="sysExpTgl" data-v="${g.id}"
            aria-label="${esc(E.t(open?'collapseNav':'expandNav'))}" data-open="${open}">${icon('chevD',12)}</span>`}</button>
        ${open || E.state.sub ? `<div class="sysgrid">${g.cards.filter(c => E.state.sub ? true : !c.subOnly).map(c=>sysCard(E,c,g)).join('')}</div>` : ''}</div>`;
    }).join('');
    return C().summaryShell(E, E.t('systemsOverview'), `<div class="sysgroups">${inner}</div>`);
  }
  /* Systems module panel: the full derived alarm list (or one group's) plus
     the group tab strip on the landing. */
  /* D105: compact lists show the plain line; "Show technical detail" reveals the technical string, per user */
  const discloseBar = E => E.wording() === 'plain' ? `<div class="alldisc"><button class="statlink" data-act="disclose" data-k="tech" aria-pressed="${E.disclose('tech')}">${esc(E.t(E.disclose('tech') ? 'hideTech' : 'discloseTech'))}</button></div>` : '';
  const alarmRows = (E, alarms) => discloseBar(E) + alarms.map(a => { const l = E.alarmLines(a, true); return (
    `<div class="alr" data-act="openAsset" data-asset="${esc(a.asset)}" role="button" tabindex="0">
      <span class="alrsev" data-tip="${esc(C().sevTipFor(E, a))}">${C().sevGlyph(a.sev, !!a.ack, 13)}</span>
      <div class="alrbody"><span class="alrid" ${a.ack?'data-ack="1"':''}>${esc(a.asset)}</span>
        <span class="alrwhat">${esc(l.main)}</span>${l.sub ? `<span class="alrtech">${esc(l.sub)}</span>` : ''}
        ${a.ack?`<span class="alrack">${esc(E.t('ackShort',{time:a.ack.time,who:a.ack.who}))}</span>`:''}</div>
      <span class="alract hst">
        ${a.ack?'':`<button class="alghost" data-act="ackAlarm" data-alarm="${a.id}">${esc(E.t('acknowledge'))}</button>`}
        <button class="alprim" data-act="openAsset" data-asset="${esc(a.asset)}">${esc(E.t('details'))}</button></span>
      <span class="alrage">${esc(E.fmtAge(a.ageH))}</span>
      <span class="alractw" data-tip="${esc(C().actTip(E, a.sev))}">${esc(C().sevAction(E,a.sev))}</span></div>`); }).join('');

  /* Sub-aware again (D27 reverted for Systems subs at the client's direction):
     a sub-view shows the group's summary, the 3D model, and that group's
     alarms in the panel — same anatomy as the landing, pre-filtered. */
  function systemsPanel(E){
    const ar = E.lang === 'ar';
    const groups = E.data.systems.groups;
    const cur = groups.find(g => g.id === E.state.sub) || null;
    const alarms = (cur ? E.visAlarms().filter(a => cur.sysKey.includes(a.sys)) : E.visAlarms());
    const grpLbl = g => ar ? g.labelAr : g.labelEn;
    const tabs = `<div class="sysrows">${groups.map(g => g.locked
      ? `<button class="landrow2" data-lock="true" data-act="teaser" data-teaser="systems.${g.id}" data-mod="systems">
        <span class="lr2pad"><span class="grow taS optname">${esc(grpLbl(g))}</span>${icon('lock',13)}</span></button>`
      : `<button class="landrow2" data-act="goSub" data-mod="systems" data-sub="${g.id}" data-page="systems">
        <span class="lr2pad"><span class="grow taS optname">${esc(grpLbl(g))}</span>
        <span class="dirx cT3">${icon('chevR',14)}</span></span></button>`).join('')}</div>`;
    const title = cur ? grpLbl(cur) : E.t('modSystems');
    const meta = cur ? E.t('nActiveSys',{n:alarms.length,sys:grpLbl(cur)}) : E.t('nActive',{n:alarms.length});
    const back = cur ? `<button class="iconbtn icon26 dirx tipU" data-act="goPage" data-page="systems"
      data-tip="${esc(E.t('backToMod',{m:E.t('modSystems')}))}" aria-label="${esc(E.t('backToMod',{m:E.t('modSystems')}))}">${icon('chevL',13,2)}</button>` : '';
    return C().modShell(E, title, back, '',
      `<div class="alcard"><div class="alcardh"><span class="alcardt">${esc(E.t('activeAlarms'))}</span>
        <span class="alcardm">${esc(meta)}</span></div>
        <div class="allist">${alarmRows(E, alarms)}</div></div>${cur?'':tabs}`);
  }

  /* D27: a systems sub-view is a full-width KPI dashboard, exactly like
     Water/Gas/Power — no summary panel, no viewer. Everything derives from
     the group's existing cards + the canonical alarm list. */
  function sysPage(E, w){
    const ar = E.lang === 'ar';
    const g = E.data.systems.groups.find(x => x.id === (w && w.binding && w.binding.group));
    if(!g) return '';
    const alarms = E.data.alarms.filter(a => g.sysKey.includes(a.sys));
    const lbl = c => ar ? c.labelAr : c.labelEn;
    const word = c => (ar ? c.wordAr : c.wordEn) || '';
    const heroes = g.cards.filter(c => c.kind === 'stat' || c.kind === 'gauge').map(c =>
      c.kind === 'stat'
        ? heroTile(E, lbl(c), c.v, c.u, (ar?c.capAr:c.capEn)||'', c.chipEn?(ar?c.chipAr:c.chipEn):null, c.tone==='warn'?'warn':'ok')
        : heroTile(E, lbl(c), String(c.val), c.u, '', word(c), c.tone==='warn'?'warn':'pos'));   /* D99: the word is a verdict */
    const widgets = [];
    g.cards.forEach(c => {
      if(c.kind === 'donut'){
        const d = ekoDonut(c.pct);
        widgets.push(widget(E, lbl(c), '', `<div class="row gap10">
          <svg viewBox="0 0 76 76" width="76" height="76">
            <circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="none" stroke="var(--s3)" stroke-width="8"/>
            <circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="none" stroke="var(--acc)" stroke-width="8"
              stroke-dasharray="${d.dash}" stroke-linecap="round" transform="rotate(-90 ${d.cx} ${d.cy})"/></svg>
          <div class="col"><span class="tMono fw6">${fmt(c.pct,2)}%</span>
            <span class="ovkcap" data-tone="pos">${esc(word(c))}</span></div></div>`));
      }
      if(c.kind === 'tiles')
        widgets.push(widget(E, lbl(c), '', `<div class="iaqgrid">${c.tiles.map(t=>
          `<div class="iaqtile"><span class="ovklbl">${esc(t[0])}</span>
            <span class="tMono fw6">${t[1]}</span>
            <span class="ovkcap" data-tone="pos">${esc(word(c))}</span></div>`).join('')}</div>`));
      if(c.kind === 'trend'){
        const tr = ekoTrend(c.series, 240, 56);
        widgets.push(widget(E, lbl(c), '', `<div class="systrend"><span class="tMonoS cT3">${c.yMax}</span>
          <svg viewBox="0 0 240 56" preserveAspectRatio="none">
            <path d="${tr.area}" fill="var(--accT)"/>
            <path d="${tr.line}" fill="none" stroke="var(--acc)" stroke-width="1.5"/>
            <line x1="0" x2="240" y1="${tr.avgY}" y2="${tr.avgY}" stroke="var(--t3)" stroke-dasharray="4 4" stroke-width="1"/></svg>
          <span class="tMonoS cT3">${c.yMin}</span></div>`,
          E.t('avgLbl',{v:fmt(c.avg,1)})));
      }
    });
    widgets.push(widget(E, E.t('activeAlarms'),
      E.t('nActiveSys',{n:alarms.length,sys:ar?g.labelAr:g.labelEn}),
      alarms.length ? `<div class="allist">${alarmRows(E, alarms)}</div>`
                    : `<p class="alempty">${esc(E.t('allClear'))}</p>`));
    return page(E, heroes, `<div class="pwgrid">${widgets.join('')}</div>`, 'sys');
  }

  /* Locked top-level modules (D27): every top level opens a summary page —
     locked ones present the honest available-on-demand state in the same
     shell (no invented KPIs; content pending activation, see questions.md). */
  function lockedSummary(E){
    /* D125: the module landing shows the same add-on card as the dialog */
    const A = window.EKO_ADDONS, key = E.state.teaserKey && A.CATALOGUE[E.state.teaserKey] ? E.state.teaserKey : (E.state.module || 'maintenance');
    return C().summaryShell(E, E.t((A.CATALOGUE[key] || A.CATALOGUE.maintenance).nameKey),
      `<div class="ovklist"><button class="nfpageback" data-act="pageBack" aria-label="${esc(E.t('back'))}">${icon('chevL',12)} ${esc(E.t('back'))}</button><div class="ovk">${A.card(E, key)}</div></div>`);
  }

  /* ------------------------------ BENCHMARK -------------------------------- */
  function benchPage(E){
    const d = E.data.bench, ar = E.lang === 'ar';
    const heroes = [
      heroTile(E, E.t('benchIntensity'), fmt(d.siteWhm2), 'Wh/m²', E.t('benchIntensityCap',{t:E.data.basis.asOf})),
      heroTile(E, E.t('benchHighest'), d.highestEn, '', ar?d.highestNoteAr:d.highestNote),
      heroTile(E, E.t('benchInBand'), d.inBand, '', ar?d.inBandListAr:d.inBandListEn)];
    const maxV = Math.max(...d.rows.map(r=>r.bandHi), ...d.rows.map(r=>r.whm2)) * 1.15;
    const rows = d.rows.map(r => {
      return `<div class="benchrow">
        <span class="benchsys">${esc(ar?(r.sysAr||r.sysEn):r.sysEn)}</span>
        <span class="benchbar">
          <span class="benchband" style="inset-inline-start:${(r.bandLo/maxV*100).toFixed(1)}%;width:${((r.bandHi-r.bandLo)/maxV*100).toFixed(1)}%"></span>
          <span class="benchval" data-out="${r.out}" style="width:${(r.whm2/maxV*100).toFixed(1)}%"></span></span>
        <span class="tMonoS">${fmt(r.whm2)} Wh/m²</span>
        <span class="benchnote" data-out="${r.out}">${esc(ar?r.noteAr:r.noteEn)}</span></div>`;
    }).join('');
    return page(E, heroes, widget(E, E.t('benchBySys'), E.t('benchBySysCap'),
      `<div class="col gap6">${rows}</div>`, E.t('benchFoot')), 'bench');
  }

  /* ------------------------------ ANOMALIES -------------------------------- */
  function anomPage(E){
    const d = E.data.anom, ar = E.lang === 'ar';
    /* D39 — Final-mock layout: six PMU hero tiles (state chip + load bar),
       evidence + time-of-day stacked on the left, and the PMU MEASUREMENTS
       rail on the right. No separate anomaly-list card (mock parity). */
    const pmus = E.data.power.pmus;
    const maxKw = Math.max(...pmus.map(u=>u.kw));
    const heroes = pmus.map(u =>
      `<div class="pwtile" data-tone="${u.tone}"><div class="pwth"><span class="ovklbl">${esc(u.id)}</span>
          <span class="pmchip" data-tone="${u.tone}">${esc(ar?u.stAr:u.stEn)}</span>${C().ctl(E, u.id, u.db, { topic:'peak' })}</div>
        <div class="ovkval"><span class="ovknum">${fmt(u.kw)}</span><span class="ovkunit">kW</span></div>
        <span class="ovkcap">${esc(u.db)} \u00b7 ${u.v.toFixed(1)} V \u00b7 ${u.pf.toFixed(2)} PF</span>
        <div class="pmubar39"><svg><rect x="0%" y="8" width="100%" height="8" fill="var(--chTrack)"/>
          <rect x="0%" y="10" width="${Math.round(u.kw/maxKw*100)}%" height="4" rx="2" fill="${u.tone === 'warn' ? 'var(--warn)' : 'var(--chFill)'}"/></svg></div></div>`);
    const ev = d.evidence, n = ev.actual.length;
    const ex = i2 => (i2/(n-1)*100), ey = v => (100 - v/ev.yMax*100);
    const band = ev.expected.map((v,i2)=>`${ex(i2).toFixed(1)},${ey(v*1.15).toFixed(1)}`).join(' ')
      + ' ' + ev.expected.slice().reverse().map((v,i2)=>`${ex(n-1-i2).toFixed(1)},${ey(v*0.85).toFixed(1)}`).join(' ');
    const expLine = ev.expected.map((v,i2)=>`${ex(i2).toFixed(1)},${ey(v).toFixed(1)}`).join(' ');
    const actLine = ev.actual.map((v,i2)=>`${ex(i2).toFixed(1)},${ey(v).toFixed(1)}`).join(' ');
    const dx = ex(ev.detectFrom).toFixed(1), dw = (ex(ev.detectTo)-ex(ev.detectFrom)).toFixed(1);
    const chrome2 = tileCtl(E, E.t('anomEvidence'), '');
    const days = ['dayMonday','dayTuesday','dayWednesday','dayThursday','dayFriday','daySaturday','daySunday'];
    const evidence = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('anomEvidence'))}</span>${chrome2}
        <span class="segbox row msA">${['24h','7d','30d','6M','1Y'].map((r2,i2)=>`<button class="seg" data-on="${i2===0}" data-act="none">${r2}</button>`).join('')}</span></div>
      <div class="fchips">${days.map(k=>`<button class="fchip" data-act="none">${esc(E.t(k))}</button>`).join('')}</div>
      <div class="fchips">${pmus.map(u=>`<button class="fchip fchipB" data-act="none">${esc(u.id)}</button>`).join('')}</div>
      <div class="fcap">${esc(E.t('showingAllDP'))}</div>
      <div class="ch39 anch39"><div class="chy39"><span>${ev.yMax}</span><span>${ev.yMid}</span><span>0</span></div>
        <div class="chplot39">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon points="${band}" fill="rgba(62,92,138,0.32)"/>
            <rect x="${dx}" y="0" width="${dw}" height="100" fill="rgba(232,179,65,0.06)" stroke="#E8B341" stroke-width="1" vector-effect="non-scaling-stroke"/>
            <polyline points="${expLine}" fill="none" stroke="var(--chTx)" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>
            <polyline points="${actLine}" fill="none" stroke="#F0A93B" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
          <span class="extag39" style="left:32%;top:${ey(ev.expected[8]).toFixed(0)}%">${esc(E.t('expectedTag'))}</span>
        </div></div>
      <div class="chx39"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span></div>
      <div class="pwlegend">
        <span><i class="lsw39 lgActual"></i>${esc(E.t('actualW'))}</span>
        <span><i class="lsw39 lgBand"></i>${esc(E.t('expectedBandW'))}</span>
        <span><i class="lsw39 lgDetected"></i>${esc(E.t('detectedW'))}</span></div>
      <span class="ovkcap">${esc(E.t('anomEvidenceFoot'))}</span></article>`;
    /* Cell tint derives from the deviation size (mock ramp: rgba(78,163,232)
       at .05 + pct*.005 alpha); >20% carries the amber outline. */
    const alpha = pct => Math.min(0.24, 0.05 + pct*0.005).toFixed(3);
    /* D117: the mockup derives the grid from today's date with a stable hash (date, zone, PMU); the fixture keeps that recipe rather than a snapshot */
    const todNow = new Date(), todDate = d.todGen === 'mock-hash' ? [String(todNow.getDate()).padStart(2,'0'), String(todNow.getMonth()+1).padStart(2,'0'), todNow.getFullYear()].join('/') : d.todDate;
    const todDev = zi => { const k = ((todNow.getFullYear()*372 + (todNow.getMonth()+1)*31 + todNow.getDate())*7 + zi*29 + 13); return 2 + ((k*2654435761)>>>0) % 37; };
    const todPct = (pp, zi) => d.todGen === 'mock-hash' ? todDev(zi) : pp.pct;
    const tod = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('anomTod'))}</span>
        <span class="alcardm msA">${esc(E.t('anomTodCap'))}</span>${chrome2}</div>
      <span class="todate39 tMonoS">${esc(todDate)}</span>
      ${d.todParts.map((pp, zi) => { const pct = todPct(pp, zi); return `<div class="todrow39">
        <div class="todlab39"><span>${esc(ar?pp.ar:pp.en)}</span><i class="tMonoS">${esc(pp.range)}</i></div>
        <span class="todcell39" style="background:rgba(78,163,232,${alpha(pct)})"${pct>20?' data-hot="1"':''}>+${pct}%</span></div>`; }).join('')}
      <span class="ovkcap">${esc(E.t('anomTodFoot'))}</span></article>`;
    const totMw = pmus.reduce((s2,u)=>s2+u.kw,0)/1000;
    const rail = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('anomPmuT'))}</span>
        <span class="alcardm msA">${esc(E.t('anomPmuCap'))}</span>${chrome2}</div>
      <div class="pmuhdr39"><span>${esc(E.t('pmuCol0'))}</span><span>${esc(E.t('pmuCol1'))}<small>A</small></span><span>${esc(E.t('pmuCol2'))}<small>V</small></span><span>${esc(E.t('pmuCol3'))}<small>Hz</small></span><span>${esc(E.t('pmuCol4'))}<small>kW</small></span><span>${esc(E.t('pmuCol5'))}<small>kWh</small></span></div>
      <div class="col grow pmurows">${pmus.map(u => `<div class="pmurow39">
        <span class="pmuid39"><i class="pmudot39" data-tone="${u.tone}"></i>${esc(u.id)}</span>
        <span>${fmt(u.a,1)}</span><span>${u.v.toFixed(1)}</span><span>${u.hz.toFixed(2)}</span>
        <span>${fmt(u.kw)}</span><span>${fmt(u.kwh)}</span></div>`).join('')}</div>
      <span class="ovkcap">${esc(E.t('anomPmuFoot',{mw:fmt(totMw,2)}))}</span></article>`;
    return `<div class="pwarea" data-pg="anom">
      <div class="pwhero cols6">${heroes.join('')}</div>
      <div class="angrid39"><div class="col gap10">${evidence}${tod}</div>${rail}</div></div>`;
  }

  /* ----------------------------- FORECASTING ------------------------------- */
  function fcstPage(E){
    const d = E.data.fcst, ar = E.lang === 'ar';
    const heroes = [
      heroTile(E, E.t('fcstPeakDay'), ar?d.peakDayAr:d.peakDayEn, '', E.t('fcstPeakCap',{v:fmt(d.peakMwh,1),p:d.peakPct})),
      heroTile(E, E.t('fcstMonthEnd'), fmt(d.monthEndMwh), 'MWh', E.t('fcstMonthCap')),
      heroTile(E, E.t('fcstBasis'), ar?d.basisAr:d.basisEn, '', E.t('fcstBasisCap'))];
    const maxV = Math.max(...d.days.map(x=>x[3])) * 1.1;
    const cols = d.days.map((x,di) =>
      `<div class="fccol"><div class="fcbarw">
        <span class="fcband" style="height:${((x[3]-x[2])/maxV*100).toFixed(1)}%;bottom:${(x[2]/maxV*100).toFixed(1)}%"></span>
        <span class="fcmed" style="bottom:${(x[1]/maxV*100).toFixed(1)}%"></span></div>
      <span class="tMonoS cT3">${esc(ar?d.daysAr[di]:x[0])}</span></div>`).join('');
    return page(E, heroes, widget(E, E.t('fcstNext7'), '',
      `<div class="fcchart">${cols}</div>`, E.t('fcstFoot')), 'fcst');
  }

  /* -------------------------------- WATER ---------------------------------- */
  /* D40 — measured from the Final mock. Alarm cards share one severity-chip
     anatomy; the daily chart is gradient bars with a hatched reset day. */
  function utilAlarmCard(E, titleKey, list, footKey){
    const ar = E.lang === 'ar';
    const SEVW = { critical:'sevCritical', warning:'sevWarning', watch:'sevWatch' };
    const rows = list.map(i => `<div class="uarow">
      <div class="uarow1"><span class="uachip" data-sev="${i.sev}">${esc(E.t(SEVW[i.sev]))}</span>
        <span class="uatitle">${esc(ar?i.tAr:i.tEn)}</span><span class="uaage">${esc(E.ph(i.age))}</span></div>
      <div class="uarow2"><span class="uadot" data-sev="${i.sev}"></span><span>${esc(ar?i.locAr:i.locEn)}</span></div>
      <p class="uanote">${esc(ar?i.noteAr:i.noteEn)}</p></div>`).join('');
    return `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t(titleKey))}</span>
        <span class="alcardm msA">${esc(E.t('pgAlarmsCap',{n:list.length}))}</span>${chrome(E, E.t(titleKey), E.t('pgAlarmsCap',{n:list.length}))}</div>
      <div class="col grow jcSB">${rows}</div>
      <span class="ovkcap">${esc(E.t(footKey))}</span></article>`;
  }
  function waterPage(E){
    const d = E.data.water, ar = E.lang === 'ar';
    const pct = Math.round(d.tankVolumeM3/d.tankCapacityM3*100);
    const autonomy = d.tankVolumeM3/d.meterAvgM3Day;
    const hero = (lbl, val, u, cap, chart) =>
      `<div class="pwtile"><div class="pwth"><span class="ovklbl">${esc(lbl)}</span>${tileCtl(E, lbl, '')}</div>
        <div class="ovkval"><span class="ovknum">${esc(val)}</span><span class="ovkunit">${esc(u)}</span></div>
        <span class="ovkcap">${esc(cap)}</span>${chart||''}</div>`;
    const sp = d.sparkToday, mxs = Math.max(...sp)*1.15;
    const spts = sp.map((v,i)=>`${(i/(sp.length-1)*100).toFixed(1)},${(32-v/mxs*30).toFixed(1)}`).join(' ');
    const spark = `<div class="pwmini2"><svg viewBox="0 0 100 32" preserveAspectRatio="none" class="wtsp40">
      <polyline points="${spts}" fill="none" stroke="#38BDF8" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>`;
    const tankbar = `<div class="pwmini2"><svg class="wttk40">
      <rect x="0%" y="10" width="100%" height="8" fill="var(--chTrack2)"/>
      <rect x="0%" y="12" width="${pct}%" height="4" rx="2" fill="#34D399"/>
      <line x1="${d.refillThresholdPct}%" x2="${d.refillThresholdPct}%" y1="6" y2="22" stroke="var(--chTx)" stroke-width="1.25"/>
      <text x="${d.refillThresholdPct}%" y="4" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="11.5" fill="var(--chTx)">${esc(E.t('wtRefill',{p:d.refillThresholdPct}))}</text></svg></div>`;
    const heroes = `<div class="pwhero cols4">
      ${hero(E.t('wtToday'), fmt(d.todayM3), 'm\u00b3', E.t('capMainMeters',{time:E.data.basis.asOf}), spark)}
      ${hero(E.t('wtAvg'), fmt(d.avgDrawM3Day), E.t('unitM3Day'), E.t('wtAvgCap'))}
      ${hero(E.t('wtTank'), pct+'%', '', E.t('wtTankCap',{cur:fmt(d.tankVolumeM3,1),cap:fmt(d.tankCapacityM3)}), tankbar)}
      ${hero(E.t('wtAutonomy'), fmt(autonomy,1), ar?'\u064a\u0648\u0645':'days', E.t('wtAutonomyCap'))}</div>`;
    /* daily bars: fixed 0-22 axis; the reset day renders as a hatched slot
       with the \u25f7 glyph (a cumulative meter going backwards is a reset). */
    const dv = d.daily14, n = dv.length, YMX = 22, step = 100/n, bw = 4;
    const gi = dv.indexOf(null);
    let dbars = '';
    dv.forEach((v,i)=>{
      const x = (i*step + (step-bw)/2).toFixed(1);
      if(v==null) dbars += `<rect x="${x}" y="18" width="${bw}" height="78" fill="url(#wtHatch)"/>`;
      else { const bh = v/YMX*96; dbars += `<rect x="${x}" y="${(96-bh).toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="1" fill="url(#wtBarG)"/>`; }
    });
    const avgY = (96 - d.meterAvgM3Day/YMX*96).toFixed(1);
    /* axis labels from the data's start day, month name per language (D122) */
    const [m0, d0] = String(d.daily14Start || 'Aug 5').split(' '), resetLbl = E.ph(d.resetNoteDay);
    const xrow = dv.map((v,i)=>{const lbl=E.ph(m0 + ' ' + (+d0 + i));
      return `<span style="width:${step.toFixed(2)}%">${(i%2===0&&v!=null&&lbl!==resetLbl)?esc(lbl):''}</span>`;}).join('');
    const seg = (k,on)=>`<button class="seg" data-on="${on}" data-act="none">${esc(E.t(k))}</button>`;
    const segs = `<span class="row segbox msA">${seg('rangeHourly',false)}${seg('rangeToday',true)}${seg('rangeWeekly',false)}${seg('rangeMonthly',false)}</span>`;
    const daily = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('wtDaily'))}</span>
        <span class="alcardm">${esc(E.t('wtDailyCap'))}</span>${segs}${chrome(E, E.t('wtDaily'), E.t('wtDailyCap'))}</div>
      <div class="ch39 mh150"><div class="chy39"><span>${YMX}</span><span>${YMX/2}</span><span>0</span></div>
        <div class="chplot39">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs><linearGradient id="wtBarG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#38BDF8" stop-opacity="0.9"/><stop offset="100%" stop-color="#0EA5E9" stop-opacity="0.45"/></linearGradient>
            <pattern id="wtHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="6" fill="rgba(255,255,255,0.08)"/></pattern></defs>
            <line x1="0" x2="100" y1="96" y2="96" stroke="var(--bd1)" stroke-width="1" vector-effect="non-scaling-stroke"/>
            <line x1="0" x2="100" y1="${avgY}" y2="${avgY}" stroke="var(--chTx)" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>
            ${dbars}</svg>
          <span class="wtavgchip">${esc(E.t('wtDailyAvg',{v:d.meterAvgM3Day}))}</span>
          ${gi>=0?`<span class="wtgap tipU" data-tip="${esc(E.t('wtDailyFoot',{m:d.meter.id}))}" style="left:${(gi*step+step/2).toFixed(1)}%">\u25f7</span>`:''}
        </div></div>
      <div class="wtxrow tMonoS cT3">${xrow}</div>
      <span class="ovkcap">${esc(E.t('wtDailyFoot',{m:d.meter.id}))}</span></article>`;
    const dl = (k,v,extra) => `<div class="aprow"><dt>${esc(k)}</dt><dd>${v}${extra||''}</dd></div>`;
    const tank = widget(E, E.t('wtTankSupply'), '',
      dl(E.t('wtCap'), fmt(d.tankCapacityM3)+' m\u00b3')
      + dl(E.t('wtVol'), fmt(d.tankVolumeM3,1)+' m\u00b3')
      + dl(E.t('wtThresh'), d.refillThresholdPct+'% ('+fmt(d.tankCapacityM3*d.refillThresholdPct/100)+' m\u00b3)')
      + dl(E.t('wtLastRefill'), esc(E.ph(d.lastRefillEn)))
      + dl(E.t('wtRefills'), String(d.refillsMonth))
      + dl(E.t('wtSupply'), esc(ar?(d.supplyAr||d.supplyEn):d.supplyEn)));
    const leak = widget(E, E.t('wtLeak'), '',
      dl(E.t('wtLeakEvents'), `<span class="cT3">${esc(E.t('emptyDash'))}</span>`)
      + `<p class="antext">${esc(E.t('wtLeakPending'))}</p>`
      + dl(E.t('wtMnf'), `<span class="cT3">${esc(E.t('emptyDash'))}</span>`)
      + `<p class="antext">${esc(E.t('wtMnfPending',{need:d.leak.nightsNeeded,got:d.leak.nightsCollected}))}</p>
      <div class="row gap8" style="align-items:center"><span class="lkbar"><span style="width:${(d.leak.nightsCollected/d.leak.nightsNeeded*100).toFixed(0)}%"></span></span>
        <span class="tMonoS">${d.leak.nightsCollected} / ${d.leak.nightsNeeded}</span></div>`,
      E.t('wtLeakFoot'));
    const mt = d.meter;
    const upbar = `<svg class="wttk40 mbs4"><rect x="0%" y="12" width="100%" height="6" rx="3" fill="var(--chTrack2)"/>
      <rect x="0%" y="13.5" width="${mt.uptimePct}%" height="3" rx="1.5" fill="#A78BFA"/>
      <line x1="${mt.targetPct}%" x2="${mt.targetPct}%" y1="8" y2="22" stroke="var(--chTx)" stroke-width="1.25"/>
      <text x="${mt.targetPct}%" y="6" text-anchor="end" font-family="JetBrains Mono,monospace" font-size="11.5" fill="var(--chTx)">${esc(E.t('wtTarget',{v:mt.targetPct}))}</text></svg>`;
    const meter = widget(E, E.t('wtMeter'), mt.id,
      dl(E.t('wtUptime'), `${fmt(mt.uptimePct,1)}% <span class="uachip" data-sev="warning">${esc(E.t('belowTargetW'))}</span>`)
      + upbar
      + dl(E.t('wtIntervals'), esc(E.t('wtIntervalsV',{got:mt.intervalsGot,t:mt.intervalsTotal})))
      + dl(E.t('wtResets'), `${mt.resetsMonth} \u00b7 ${esc(E.ph(mt.resetDateEn))}`)
      + dl(E.t('wtLastReading'), esc(mt.lastReadingEn))
      + dl(E.t('wtSignal'), esc(ar?mt.signalAr:mt.signalEn)),
      E.t('wtMeterFoot'));
    return `<div class="pwarea" data-pg="water">
      <div class="pwheadrow"><div><span class="alcardt pgtitle">${esc(E.t('wtHdrT'))}</span>
        <span class="alcardm"> ${esc(E.t('pwSub'))}</span></div></div>
      ${heroes}
      <div class="wtgrid">
        <div class="col gap10">${daily}<div class="wt3grid">${tank}${leak}${meter}</div></div>
        ${utilAlarmCard(E,'waterAlarmsT',d.alarms,'waterAlarmsFoot')}
      </div></div>`;
  }

  /* --------------------------------- GAS ----------------------------------- */
  function gasPage(E){
    const d = E.data.gas, ar = E.lang === 'ar';
    const hero = (lbl,v,u,cap)=>`<div class="pwtile"><div class="pwth"><span class="ovklbl">${esc(lbl)}</span>${tileCtl(E, lbl, cap)}</div>
      <div class="ovkval"><span class="ovknum">${esc(v)}</span><span class="ovkunit">${esc(u)}</span></div>
      <span class="ovkcap">${esc(cap)}</span></div>`;
    const heroes = `<div class="pwhero cols3">
      ${hero(E.t('kGasToday'), fmt(d.todayM3), 'm\u00b3', E.t('capToNow',{time:E.data.basis.asOf}).replace(' \u00b7 live','').replace(' \u00b7 \u0645\u0628\u0627\u0634\u0631',''))}
      ${hero(E.t('gasAvg7'), fmt(d.avg7M3), 'm\u00b3', E.t('gasAvg7Cap'))}
      ${hero(E.t('gasMtd'), fmt(d.mtdM3), 'm\u00b3', (ar?(d.meterAr||d.meterEn):d.meterEn).split(' \u00b7')[0])}</div>`;
    const YMX = 250, step = 100/d.daily14.length;
    const seg = (k,on)=>`<button class="seg" data-on="${on}" data-act="none">${esc(E.t(k))}</button>`;
    const segs = `<span class="row segbox msA">${seg('rangeHourly',false)}${seg('rangeToday',true)}${seg('rangeWeekly',false)}${seg('rangeMonthly',false)}</span>`;
    const bars = d.daily14.map(v=>`<div class="gcol"><span class="gbar" style="height:${(v/YMX*100).toFixed(1)}%"></span></div>`).join('');
    const xrow = d.daily14.map((v,i)=>`<span style="width:${step.toFixed(2)}%">${d.daily14StartDay+i}</span>`).join('');
    const grid = [0,20,40,60,80,100].map(y=>`<line x1="0" x2="100" y1="${y}" y2="${y}" stroke="var(--bd1)" stroke-width="1"${y===100?'':' stroke-dasharray="2 3"'} vector-effect="non-scaling-stroke"/>`).join('');
    const src = ar ? d.sourceAr : d.sourceEn;
    const daily = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('gasDailyT'))}</span>
        <span class="alcardm">${esc(E.t('gasDailySub'))}</span>${segs}${chrome(E, E.t('gasDailyT'), E.t('gasDailySub'))}</div>
      <div class="ch39 mh250"><div class="chy39">${[250,200,150,100,50,0].map(v=>`<span>${v}</span>`).join('')}</div>
        <div class="chplot39"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${grid}</svg>
          <div class="gbars">${bars}</div></div></div>
      <div class="wtxrow tMonoS cT3">${xrow}</div>
      <span class="ovkcap">${esc(E.t('gasFoot',{m:d.meter ? d.meter.id : 'G-01', s:src}))}</span></article>`;
    const dl = (k,v) => `<div class="aprow"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    const basis = widget(E, E.t('gasBasis'), '',
      dl(E.t('gasMeterLbl'), esc(ar?(d.meterAr||d.meterEn):d.meterEn))
      + dl(E.t('gasSourceLbl'), esc(src))
      + dl(E.t('gasTariffLbl'), esc(E.t('gasTariffV',{v:d.tariffAedM3.toFixed(2)}))),
      E.t('gasFoot',{m:'G-01', s:src}));
    return `<div class="pwarea" data-pg="gas">
      <div class="pwheadrow"><div><span class="alcardt pgtitle">${esc(E.t('gasHdrT'))}</span>
        <span class="alcardm"> ${esc(E.t('pwSub'))}</span></div></div>
      ${heroes}
      <div class="wtgrid">
        <div class="col gap10">${daily}${basis}</div>
        ${utilAlarmCard(E,'gasAlarmsT',d.alarms,'gasAlarmsFoot')}
      </div></div>`;
  }

  /* ---------------------- SPACES / ASSETS summaries ------------------------ */
  function spacesSummary(E){
    const d = E.data.spaces, ar = E.lang === 'ar';
    const row = (lbl,v,u,cap) => `<div class="ovk"><div class="ovkhead"><span class="ovklbl">${esc(lbl)}</span></div>
      <div class="ovkval"><span class="ovknum">${esc(v)}</span><span class="ovkunit">${esc(u)}</span></div>
      <div class="ovkcap">${esc(cap)}</div></div>`;
    return C().summaryShell(E, E.t('spacesOverview'), '<div class="ovklist">'
      + row(E.t('spComfort'), fmt(d.comfortPct,1), '%', E.t('spComfortCap'))
      + row(E.t('spOccupied'), fmt(d.occupiedPct), '%', ar?d.occPeakAr:d.occPeakEn)
      + row(E.t('spIeq'), fmt(d.ieq), '', ar?d.ieqCapAr:d.ieqCapEn)
      + '</div>');
  }
  function assetsSummary(E){
    const inAlarm = E.data.assets.filter(a => a.st === 'alarm');
    const critAssets = inAlarm.filter(a => a.alarms.some(id => E.alarm(id).sev === 'critical' && !E.alarm(id).ack));
    const row = (lbl,v,cap,tone) => `<div class="ovk"><div class="ovkhead"><span class="ovklbl">${esc(lbl)}</span></div>
      <div class="ovkval"><span class="ovknum" ${tone?'style="color:var(--sevCrit)"':''}>${esc(v)}</span></div>
      <div class="ovkcap">${esc(cap)}</div></div>`;
    return C().summaryShell(E, E.t('assetsOverview'), '<div class="ovklist">'
      + row(E.t('asRegistered'), fmt(E.data.registerTotal), E.t('asRegisteredCap'))
      + row(E.t('asWos'), '380', E.t('asWosCap'))
      + row(E.t('asInAlarm'), String(inAlarm.length), E.t('asInAlarmCap',{n:critAssets.length,first:critAssets[0]?critAssets[0].id:'—'}), true)
      + '</div>');
  }
  /* Module-highlight rows panel (Utilities / Spaces / Assets landings). */
  function modRowsPanel(E, w){
    const ar = E.lang === 'ar';
    const rows = (w.binding.rows||[]).map(r =>
      `<button class="landrow2" data-act="goSub" data-mod="${esc(w.binding.module)}" data-sub="${esc(r.sub)}" data-page="${esc(r.pageId)}">
        <span class="lr2pad"><span class="col grow minw0 taS"><span class="optname">${esc(E.t(r.label))}</span>
          <span class="alcardm">${esc(ar?(E.data.landing[r.key]||{}).headAr||'':(E.data.landing[r.key]||{}).headEn||'')}</span></span>
        <span class="dirx cT3">${icon('chevR',14)}</span></span></button>`).join('');
    return C().modShell(E, E.t(w.binding.title), '', '', rows);
  }

  /* ------------------------------- HEAT MAP -------------------------------- */
  function heatPanel(E){
    const d = E.data.heat, s = E.state, ar = E.lang === 'ar';
    /* D32 modes (Latest mock): temp (default) / comfort / occ. */
    const mode = s.hmMode === 'comfort' ? 'comfort' : s.hmMode === 'occ' ? 'occ' : 'temp';
    const comfort = mode === 'comfort';
    const zones = d.zones.filter(z => s.hmFloor === 'All' || z.floor === s.hmFloor);
    const rank = comfort
      ? zones.slice().sort((a,b) => Math.abs(b.dT||0) - Math.abs(a.dT||0))
      : mode === 'occ'
      ? zones.slice().sort((a,b) => b.occ - a.occ)
      : zones.slice().sort((a,b) => b.tempC - a.tempC);
    const maxK = Math.max(...zones.map(z=>z.occ));
    const siteMean = (d.zones.reduce((s2,z)=>s2+z.tempC,0)/d.zones.length);
    const zn = z => ar ? (z.nameAr||z.nameEn) : z.nameEn;
    const fmtDt = z => z.dT == null ? '—' : (z.dT>0?'+':'−') + Math.abs(z.dT).toFixed(1) + '°';
    const rankRows = rank.map((z,i) =>
      `<button class="hmrank selrow" data-on="${s.hmSel===z.nameEn}" data-act="hmSel" data-v="${esc(z.nameEn)}">
        <span class="tMonoS cT3">${i+1}</span><span class="grow taS">${esc(zn(z))}</span>
        <span class="hmrbar"><span style="width:${comfort?(z.dT==null?0:Math.min(100,Math.abs(z.dT)/2*100)).toFixed(0):mode==='occ'?(z.occ/maxK*100).toFixed(0):(Math.max(0,(z.tempC-20))/5*100).toFixed(0)}%"></span></span>
        <span class="tMonoS">${comfort?esc(fmtDt(z)):mode==='occ'?esc(E.t('hmPpl',{n:z.occ})):esc(z.tempC.toFixed(1)+'\u00b0')}</span></button>`).join('');
    const tglRow = (lbl, key, on) =>
      `<div class="hmtgl"><span class="grow">${esc(lbl)}</span>
        <button class="seg" data-on="${on}" data-act="hmLayer" data-v="${key}">${esc(on?E.t('onW'):E.t('offW'))}</button></div>`;
    const sel = d.zones.find(z => z.nameEn === s.hmSel);
    const selBody = sel
      ? `<div class="aprow"><dt>${esc(zn(sel))}</dt><dd>${comfort?esc(fmtDt(sel)):mode==='occ'?esc(E.t('hmPpl',{n:sel.occ})):esc(sel.tempC.toFixed(1)+' \u00b0C')} · ${esc(E.t('hmPpl',{n:sel.occ}))}</dd></div>`
      : `<p class="alempty">${esc(E.t('hmSelectedEmpty'))}</p>`;
    const matrix = `<div class="todwrap"><table class="todm hmm"><tbody>${d.zones.map(z =>
      `<tr><td>${esc(zn(z))}</td>${z.hours.map(v =>
        `<td><span class="todc" style="background:color-mix(in srgb, ${comfort?'var(--warn)':'var(--btnP)'} ${(v*70).toFixed(0)}%, var(--s3))"></span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const detail = true ? `<div class="alcard"><div class="alcardh"><span class="alcardt">${esc(E.t('hmZoneDetail'))}</span></div>
      ${d.comfortDetail.map(z => `<div class="hmtgl"><span class="grow">${esc(ar?(z.nameAr||z.nameEn):z.nameEn)}</span>
        <span class="tMonoS ${z.dT>1?'cWarn':''}">${(z.dT>0?'+':'−')+Math.abs(z.dT).toFixed(1)}°</span>
        <span class="tMonoS cT3">${esc(E.t('hmPpl',{n:z.occ}))}</span></div>`).join('')}
      <div class="alfoot">${esc(E.t('hmZoneDetailFoot'))}</div></div>` : '';
    const seg = (lbl,on,act,v) => `<button class="seg" data-on="${on}" data-act="${act}" data-v="${esc(v)}">${esc(lbl)}</button>`;
    const mseg = (lbl,on,v) => `<button class="hmseg" data-on="${on}" data-act="hmMode" data-v="${v}">${esc(lbl)}</button>`;
    const fseg = (lbl,on,v) => `<button class="hmfloor" data-on="${on}" data-act="hmFloor" data-v="${esc(v)}">${esc(lbl)}</button>`;
    return C().modShell(E, E.t('subHeat'), '', '',
      `<div class="hmwrap"><div class="row gap8">
        <span class="row gap2">${mseg(E.t('hmTemp'), mode==='temp', 'temp')}${mseg(E.t('hmComfort'), comfort, 'comfort')}${mseg(E.t('hmOcc'), mode==='occ', 'occ')}</span>
        <span class="row gap4 msA">${d.floors.map(f=>fseg(f==='All'?E.t('fltAll'):f, s.hmFloor===f, f)).join('')}</span></div>
      <div class="alcard"><div class="alcardh"><span class="alcardt">${esc(E.t('hmRanking'))}</span>
        <span class="alcardm">${esc(comfort?E.t('hmRankComfortCap'):mode==='occ'?E.t('hmRankOccCap'):E.t('hmRankTempCap'))}</span></div>
        <div class="col">${rankRows}</div>
        <div class="alfoot">${esc(E.t('hmRankFoot'))}</div></div>
      <div class="hmtgl"><span class="grow">${esc(comfort?E.t('hmOutlineBeyond'):E.t('hmOutlineAbove'))} <span class="cT3">${esc(comfort?E.t('hmUnitDt'):mode==='occ'?E.t('hmUnitPpl'):E.t('hmUnitTemp'))}</span></span>
        <button class="seg" data-on="${s.hmOutline}" data-act="hmOutline">${esc(s.hmOutline?E.t('onW'):E.t('offW'))}</button></div>
      <div class="alcard"><div class="alcardh"><span class="alcardt">${esc(E.t('hmLayers'))}</span></div>
        ${tglRow(E.t('hmSensors'),'sensors',s.hmLayers.sensors)}
        ${tglRow(E.t('hmLabels'),'labels',s.hmLayers.labels)}
        ${tglRow(E.t('hmValues'),'values',s.hmLayers.values)}</div>
      <div class="alcard"><div class="alcardh"><span class="alcardt">${esc(E.t('hmSelected'))}</span></div>${selBody}</div>
      <div class="alcard"><div class="alcardh"><span class="alcardt">${esc(E.t('hmByHour'))}</span>
        <span class="alcardm">${esc(E.t('hmByHourCap'))}</span>${chrome(E, E.t('hmByHour'), E.t('hmByHourCap'))}</div>
        ${matrix}<div class="alfoot">${esc(E.t('hmByHourFoot'))}</div></div>
      ${comfort?'':mode==='occ'?`<div class="alfoot">${esc(E.t('hmOccFoot'))}</div>`:`<div class="alfoot">${esc(E.t('hmTempFoot',{m:siteMean.toFixed(1)}))}</div>`}
      ${mode!=='occ'?detail:''}</div>`);
  }

  /* Heat overlay drawn ON the model + the bottom range bar. */
  function heatOverlay(E){
    const d = E.data.heat, s = E.state;
    const mode = s.hmMode === 'comfort' ? 'comfort' : s.hmMode === 'occ' ? 'occ' : 'temp';
    const comfort = mode === 'comfort';
    const maxO = Math.max(...d.zones.map(z=>z.occ));
    const tiles = d.zones.filter(z => s.hmFloor==='All' || z.floor===s.hmFloor).map(z => {
      const heat = comfort ? (z.dT==null?0:Math.min(1,Math.abs(z.dT)/2))
        : mode==='occ' ? z.occ/maxO
        : Math.max(0, Math.min(1, (z.tempC-20)/5));
      const hue = comfort ? (z.dT!=null&&z.dT<0 ? 'var(--info)' : 'var(--warn)')
        : mode==='occ' ? 'var(--btnP)' : 'var(--warn)';
      const label = comfort ? (z.dT==null?E.t('hmInBand'):((z.dT>0?'+':'−')+Math.abs(z.dT).toFixed(1)+'°'))
        : mode==='occ' ? E.t('hmPpl',{n:z.occ}) : z.tempC.toFixed(1)+'\u00b0C';
      const out = s.hmOutline && (comfort ? Math.abs(z.dT||0)>1 : mode==='occ' ? z.occ>40 : z.tempC>24);
      return `<button class="hmzone" data-on="${s.hmSel===z.nameEn}" data-out="${out}" data-act="hmSel" data-v="${esc(z.nameEn)}"
        style="left:${z.rect[0]}%;top:${z.rect[1]}%;width:${z.rect[2]}%;height:${z.rect[3]}%">
        ${s.hmLayers.labels?`<span class="hmzn">${esc(E.lang==='ar'?(z.nameAr||z.nameEn):z.nameEn)}</span>`:''}
        ${s.hmLayers.values?`<span class="hmzv">${esc(label)}</span>`:''}</button>`;
    }).join('');
    const seg = (lbl,on) => `<button class="seg" data-on="${on}" data-act="none">${esc(lbl)}</button>`;
    return `<div class="hmlayer">${tiles}</div>
      <div class="heatbar mzglass">
        <span class="tMonoS cT3">${esc(comfort?E.t('hmLegend'):mode==='occ'?E.t('hmUnitPpl'):E.t('hmLegendTemp'))}</span>
        <span class="hmgrad" data-mode="${comfort?'comfort':'energy'}"></span>
        <span class="tCap">${esc(E.t('hmLegendCap'))}</span>
        <span class="segbox row msA">${seg(E.t('rangeToday'),true)}${seg(E.t('rangeWeekly'),false)}${seg(E.t('rangeMonthly'),false)}</span>
        <button class="chip" data-act="none">${esc(E.t('playW'))}</button>
        <span class="tMonoS" style="color:var(--posTx)">${esc(E.t('tlLive'))}</span>
      </div>`;
  }

  return { systemsSummary, systemsPanel, benchPage, anomPage, fcstPage,
           waterPage, gasPage, spacesSummary, assetsSummary, modRowsPanel,
           heatPanel, heatOverlay, widget, heroTile, chrome, sysPage, lockedSummary };
})();
