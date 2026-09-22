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

  function anomNow(){
    try{
      const parts = new Intl.DateTimeFormat('en-GB',{ timeZone:'Asia/Dubai', year:'numeric', month:'numeric', day:'numeric', hour:'numeric', hourCycle:'h23' }).formatToParts(new Date());
      const g = t => parseInt((parts.find(p => p.type===t)||{}).value, 10);
      let h = g('hour'); if(h===24) h = 0;
      return { y:g('year'), m:g('month')-1, d:g('day'), h };
    }catch(e){
      const n = new Date();
      return { y:n.getFullYear(), m:n.getMonth(), d:n.getDate(), h:n.getHours() };
    }
  }
  function anomEvidenceSeries(power, range, daySel, pmuIds, pmus){
    const ids = ['PMU09','PMU04','PMU05','PMU06','PMU07','PMU08'];
    const hues = ['#4EA3E8','#F0A93B','#45C79A','#E48FC4','#A78BFA','#E06C75'];
    const want = pmuIds && pmuIds.length ? pmuIds : ids;
    const now = anomNow();
    const daySet = daySel && daySel.length ? daySel : null;
    const wd = p => { const d = new Date(p.y, p.m, p.d).getDay(); return d === 0 ? 7 : d; };
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const keys = [];
    if(range === '7d'){
      for(let i=6;i>=0;i--){
        const dt = new Date(now.y, now.m, now.d - i);
        keys.push({ id: dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate(), lab: String(dt.getDate()), title: dt.getDate()+' '+MON[dt.getMonth()] });
      }
    } else if(range === '30d'){
      for(let i=29;i>=0;i--){
        const dt = new Date(now.y, now.m, now.d - i);
        const lab = (i===29 || i===0 || dt.getDate()%5===0) ? String(dt.getDate()) : '';
        keys.push({ id: dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate(), lab, title: dt.getDate()+' '+MON[dt.getMonth()] });
      }
    } else if(range === '6M' || range === '1Y'){
      const n = range === '6M' ? 6 : 12;
      for(let i=n-1;i>=0;i--){
        let m = now.m - i, y = now.y;
        while(m<0){ m+=12; y-=1; }
        keys.push({ id: y+'-'+(m+1), lab: MON[m], title: MON[m]+' '+y });
      }
    } else {
      const end = new Date(now.y, now.m, now.d, now.h);
      for(let i=23;i>=0;i--){
        const dt = new Date(end.getTime() - i*36e5);
        const hh = String(dt.getHours()).padStart(2,'0');
        const lab = (i===23 || i===0 || dt.getHours()%6===0) ? hh : '';
        keys.push({ id: dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate()+'-'+dt.getHours(), lab, title: hh+':00' });
      }
    }
    const idx = {};
    keys.forEach((k,i2) => { idx[k.id] = i2; });
    const per = want.map((id, pi) => {
      const flat = (power && power.pmuFlats && power.pmuFlats[id]) || [];
      const sum = keys.map(() => 0);
      const n = keys.map(() => 0);
      (flat||[]).forEach(p => {
        if(daySet && daySet.indexOf(wd(p))<0) return;
        let kid;
        if(range === '6M' || range === '1Y') kid = p.y+'-'+(p.m+1);
        else if(range === '7d' || range === '30d') kid = p.y+'-'+(p.m+1)+'-'+p.d;
        else kid = p.y+'-'+(p.m+1)+'-'+p.d+'-'+p.h;
        const i2 = idx[kid];
        if(i2 == null) return;
        sum[i2] += p.val;
        n[i2] += 1;
      });
      const u = (pmus||[]).find(x => x.id === id);
      const gi = ids.indexOf(id);
      return {
        id,
        n: u ? (u.db ? id+' · '+u.db : id) : id,
        c: hues[gi >= 0 ? gi : pi] || '#F0A93B',
        vals: keys.map((_, i2) => n[i2] ? sum[i2]/n[i2] : null)
      };
    });
    const vals = keys.map((_, i2) => {
      let s = 0, c = 0;
      per.forEach(row => { if(row.vals[i2] != null){ s += row.vals[i2]; c += 1; } });
      return c ? s : 0;
    });
    const any = per.some(row => row.vals.some(v => v != null));
    const rawMax = any ? Math.max.apply(null, vals) : 0;
    const yMax = rawMax > 0 ? Math.max(1, Math.ceil(rawMax)) : 1;
    return { vals, labels: keys.map(k => k.lab), titles: keys.map(k => k.title), per, yMax, any };
  }

  /* ------------------------------ ANOMALIES -------------------------------- */
  function anomPage(E){
    const d = E.data.anom, ar = E.lang === 'ar';
    const pmus = E.data.power.pmus || [];
    const nd = (v, d2) => (v == null || !isFinite(Number(v))) ? '--' : fmt(v, d2);
    const kwVals = pmus.map(u => Number(u.kw)).filter(v => isFinite(v));
    const maxKw = kwVals.length ? Math.max(...kwVals) : 0;
    const totKw = kwVals.reduce((s2, v) => s2 + v, 0);
    const totMw = kwVals.length ? totKw / 1000 : null;
    const heroes = pmus.map(u => {
      const bar = maxKw && u.kw != null ? Math.max(0, Math.round(Number(u.kw) / maxKw * 100)) : 0;
      return `<div class="pwtile"><div class="pwth"><span class="ovklbl">${esc(u.id)}</span>${C().ctl(E, u.id, u.db, { topic:'peak' })}</div>
        <div class="ovkval"><span class="ovknum">${nd(u.kw)}</span><span class="ovkunit">kW</span></div>
        <span class="ovkcap">${esc(u.db || '')} \u00b7 ${nd(u.v,1)} V \u00b7 ${nd(u.pf,2)} PF</span>
        <div class="pmubar39"><svg><rect x="0%" y="8" width="100%" height="8" fill="var(--chTrack)"/>
          <rect x="0%" y="10" width="${bar}%" height="4" rx="2" fill="var(--chFill)"/></svg></div></div>`;
    });
    const chrome2 = tileCtl(E, E.t('anomEvidence'), '');
    const days = ['dayMonday','dayTuesday','dayWednesday','dayThursday','dayFriday','daySaturday','daySunday'];
    const range = E.state.anomRange || '24h';
    const daySel = E.state.anomDays || [];
    const pmuSel = E.state.anomPmus || [];
    const evSeries = anomEvidenceSeries(E.data.power, range, daySel, pmuSel, pmus);
    const evPts = evSeries.vals.length > 1
      ? evSeries.vals.map((v,i2) => `${(i2/(evSeries.vals.length-1)*100).toFixed(2)},${(100 - v/evSeries.yMax*100).toFixed(2)}`).join(' ')
      : (evSeries.vals.length === 1 ? `50,${(100 - evSeries.vals[0]/evSeries.yMax*100).toFixed(2)}` : '');
    const evCap = pmuSel.length
      ? pmuSel.map(id => {
          const u = pmus.find(x => x.id === id);
          return u ? (u.db ? u.id + ' · ' + u.db : u.id) : id;
        }).join('  ·  ')
      : E.t('showingAllDP');
    const evidence = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('anomEvidence'))}</span>${chrome2}
        <span class="segbox row msA">${['24h','7d','30d','6M','1Y'].map(r2=>`<button class="seg" data-on="${range===r2}" data-act="anomRange" data-v="${r2}">${r2}</button>`).join('')}</span></div>
      <div class="fchips">${days.map((k,di)=>`<button class="fchip" data-act="anomDay" data-d="${di+1}" data-on="${daySel.indexOf(di+1)>=0}">${esc(E.t(k))}</button>`).join('')}</div>
      <div class="fchips">${pmus.map(u=>`<button class="fchip fchipB" data-act="anomPmu" data-id="${esc(u.id)}" data-on="${pmuSel.indexOf(u.id)>=0}">${esc(u.id)}</button>`).join('')}</div>
      <div class="fcap">${esc(evCap)}</div>
      <div class="ch39 anch39"><div class="chy39"><span>${evSeries.any?evSeries.yMax:'--'}</span><span>${evSeries.any?Math.round(evSeries.yMax/2):'--'}</span><span>0</span></div>
        <div class="chplot39">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="0" x2="100" y1="50" y2="50" stroke="var(--bd1)" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>
            ${evPts ? `<polyline points="${evPts}" fill="none" stroke="#F0A93B" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ''}
            ${evSeries.vals.length===1 && evPts ? `<circle cx="50" cy="${(100 - evSeries.vals[0]/evSeries.yMax*100).toFixed(2)}" r="1.6" fill="#F0A93B"/>` : ''}
          </svg>
          ${evSeries.vals.length ? `<div class="chhits39">${evSeries.vals.map((_,i2) => {
            const rows = evSeries.per.map(row => ({
              c: row.c, n: row.n,
              v: row.vals[i2] == null ? '--' : (row.vals[i2] >= 100 ? fmt(row.vals[i2], 0) : fmt(row.vals[i2], 1))
            }));
            const tot = evSeries.vals[i2];
            const totTxt = tot >= 100 ? fmt(tot, 0) : fmt(tot, 1);
            if (rows.length > 1) rows.unshift({ c: '#F0A93B', n: 'Total', v: totTxt });
            return `<span class="chhit39" data-chtip="${encodeURIComponent(JSON.stringify({ t: evSeries.titles[i2], u: 'kW', rows }))}"></span>`;
          }).join('')}</div>` : ''}
        </div></div>
      <div class="chx39" style="display:grid;grid-template-columns:repeat(${Math.max(evSeries.labels.length,1)},minmax(0,1fr));padding-inline-start:28px">${evSeries.labels.map(t2=>`<span>${esc(t2)}</span>`).join('')}</div>
      <span class="ovkcap">${esc(evSeries.any ? E.t('anomEvidenceLive') : E.t('anomEvidenceEmpty'))}</span></article>`;
    const todNow = new Date();
    const todDate = [String(todNow.getDate()).padStart(2,'0'), String(todNow.getMonth()+1).padStart(2,'0'), todNow.getFullYear()].join('/');
    const tod = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('anomTod'))}</span>
        <span class="alcardm msA">${esc(E.t('anomTodCap'))}</span>${chrome2}</div>
      <span class="todate39 tMonoS">${esc(todDate)}</span>
      ${(d.todParts||[]).map(pp => `<div class="todrow39">
        <div class="todlab39"><span>${esc(ar?pp.ar:pp.en)}</span><i class="tMonoS">${esc(pp.range)}</i></div>
        <span class="todcell39">--</span></div>`).join('')}
      <span class="ovkcap">${esc(E.t('anomTodEmpty'))}</span></article>`;
    const rail = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('anomPmuT'))}</span>
        <span class="alcardm msA">${esc(E.t('anomPmuCap',{n:pmus.length}))}</span>${chrome2}</div>
      <div class="pmuhdr39"><span>${esc(E.t('pmuCol0'))}</span><span>${esc(E.t('pmuCol1'))}<small>A</small></span><span>${esc(E.t('pmuCol2'))}<small>V</small></span><span>${esc(E.t('pmuCol3'))}<small>Hz</small></span><span>${esc(E.t('pmuCol4'))}<small>kW</small></span><span>${esc(E.t('pmuCol5'))}<small>kWh</small></span></div>
      <div class="col grow pmurows">${pmus.map(u => `<div class="pmurow39">
        <span class="pmuid39">${esc(u.id)}</span>
        <span>${nd(u.a,1)}</span><span>${nd(u.v,1)}</span><span>${nd(u.hz,2)}</span>
        <span>${nd(u.kw)}</span><span>${nd(u.kwh)}</span></div>`).join('')}</div>
      <span class="ovkcap">${esc(E.t('anomPmuFoot',{mw:nd(totMw,2)}))}</span></article>`;
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
    const d = E.data.water || {}, ar = E.lang === 'ar';
    const nd = (v, d2) => (v == null || !isFinite(Number(v))) ? '--' : fmt(v, d2);
    const dash = esc(E.t('emptyDash'));
    const hasFin = Array.isArray(d.todayH) || Array.isArray(d.hourly) || Array.isArray(d.weekly) || Array.isArray(d.monthly);
    const sumHrs = arr => {
      if (!Array.isArray(arr) || !arr.some(v => Number(v))) return null;
      return arr.reduce((s, v) => s + (Number(v) || 0), 0);
    };
    const todayVal = hasFin ? sumHrs(d.todayH) : null;
    const avgVal = hasFin && d.avgDrawM3Day != null && Number(d.avgDrawM3Day) ? d.avgDrawM3Day : null;
    const hero = (lbl, val, u, cap, chart) =>
      `<div class="pwtile"><div class="pwth"><span class="ovklbl">${esc(lbl)}</span>${tileCtl(E, lbl, '')}</div>
        <div class="ovkval"><span class="ovknum">${esc(val)}</span><span class="ovkunit">${esc(u)}</span></div>
        <span class="ovkcap">${esc(cap)}</span>${chart||''}</div>`;
    const sp = hasFin && Array.isArray(d.sparkToday) ? d.sparkToday : [];
    const spark = sp.length > 1 ? (() => {
      const mxs = Math.max.apply(null, sp.map(v => Number(v)||0))*1.15 || 1;
      const spts = sp.map((v,i)=>`${(i/(sp.length-1)*100).toFixed(1)},${(32-(Number(v)||0)/mxs*30).toFixed(1)}`).join(' ');
      return `<div class="pwmini2"><svg viewBox="0 0 100 32" preserveAspectRatio="none" class="wtsp40">
      <polyline points="${spts}" fill="none" stroke="#38BDF8" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>`;
    })() : '';
    const heroes = `<div class="pwhero cols4">
      ${hero(E.t('wtToday'), nd(todayVal), todayVal!=null?'m\u00b3':'', E.t('capMainMeters',{time:E.data.basis.asOf}), spark)}
      ${hero(E.t('wtAvg'), nd(avgVal), avgVal!=null?E.t('unitM3Day'):'', E.t('wtAvgCap'))}
      ${hero(E.t('wtTank'), '--', '', E.t('wtTankCap',{cur:'--',cap:'--'}), '')}
      ${hero(E.t('wtAutonomy'), '--', '', E.t('wtAutonomyCap'))}</div>`;
    /* daily bars: fixed 0-22 axis; the reset day renders as a hatched slot
       with the \u25f7 glyph (a cumulative meter going backwards is a reset). */
    const tr = E.state.wtTrendRange || 'today';
    const liveS = { hourly: d.hourly, today: d.todayH, weekly: d.weekly, monthly: d.monthly }[tr];
    const dv = Array.isArray(liveS) ? liveS : [];
    const n = dv.length;
    const YMX = n ? Math.max(1, Math.ceil(Math.max.apply(null, dv.filter(v => v != null).concat([0])) * 1.15)) : 1;
    const step = n ? 100/n : 100, bw = Math.min(6, step * 0.6);
    const gi = -1;
    let dbars = '', whits = '';
    const xLive = (d.trendX && d.trendX[tr]) || [];
    dv.forEach((v,i)=>{
      const x = (i*step + (step-bw)/2).toFixed(1);
      const bh = Math.max(0, Number(v)||0)/YMX*96;
      dbars += `<rect x="${x}" y="${(96-bh).toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="1" fill="url(#wtBarG)"/>`;
      const lab = xLive[i] || String(i+1);
      const tipV = v == null || Number(v)===0 ? '--' : (v >= 100 ? fmt(v,0) : fmt(v,1));
      whits += `<span class="chhit39" data-chtip="${encodeURIComponent(JSON.stringify({ t: lab, u: 'm³', rows: [{ c:'#38BDF8', n: E.t('wtDaily'), v: tipV }] }))}"></span>`;
    });
    const avgY = (tr==='today' && avgVal != null) ? (96 - avgVal/YMX*96).toFixed(1) : null;
    const todayTo = (tr==='today' && n) ? String(Math.max(0, n-1)).padStart(2,'0')+':00' : (E.data.basis.asOf || '');
    const wtCap = tr==='hourly' ? E.t('wtDailyCapHourly')
      : tr==='weekly' ? E.t('wtDailyCapWeekly',{range:d.weekRange||''})
      : tr==='monthly' ? E.t('wtDailyCapMonthly',{from:(xLive[0]||''),to:(xLive[xLive.length-1]||'')})
      : E.t('wtDailyCapToday',{t:todayTo});
    const seg = (k,v)=>`<button class="seg" data-on="${tr===v}" data-act="wtTrendRange" data-v="${v}">${esc(E.t(k))}</button>`;
    const segs = `<span class="row segbox msA">${seg('rangeHourly','hourly')}${seg('rangeToday','today')}${seg('rangeWeekly','weekly')}${seg('rangeMonthly','monthly')}</span>`;
    const daily = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('wtDaily'))}</span>
        <span class="alcardm">${esc(wtCap)}</span>${segs}${chrome(E, E.t('wtDaily'), wtCap)}</div>
      <div class="ch39 mh150"><div class="chy39"><span>${YMX}</span><span>${Math.round(YMX/2)}</span><span>0</span></div>
        <div class="chcol39">
        <div class="chplot39">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs><linearGradient id="wtBarG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#38BDF8" stop-opacity="0.9"/><stop offset="100%" stop-color="#0EA5E9" stop-opacity="0.45"/></linearGradient></defs>
            <line x1="0" x2="100" y1="96" y2="96" stroke="var(--bd1)" stroke-width="1" vector-effect="non-scaling-stroke"/>
            ${avgY!=null?`<line x1="0" x2="100" y1="${avgY}" y2="${avgY}" stroke="var(--chTx)" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`:''}
            ${dbars}</svg>
          ${n ? `<div class="chhits39">${whits}</div>` : ''}
          ${tr==='today' && avgVal!=null?`<span class="wtavgchip">${esc(E.t('wtDailyAvg',{v:avgVal}))}</span>`:''}
        </div>
        <div class="chx39" style="grid-template-columns:repeat(${Math.max(n,1)},minmax(0,1fr))">${(n?xLive:['']).map(t2=>`<span>${esc(t2||'')}</span>`).join('')}</div>
        </div></div>
      <span class="ovkcap">${esc(E.t('wtDailyFoot',{m:d.meter && d.meter.id ? d.meter.id : '--'}))}</span></article>`;
    const dl = (k,v,extra) => `<div class="aprow"><dt>${esc(k)}</dt><dd>${v}${extra||''}</dd></div>`;
    const tank = widget(E, E.t('wtTankSupply'), '',
      dl(E.t('wtCap'), dash)
      + dl(E.t('wtVol'), dash)
      + dl(E.t('wtThresh'), dash)
      + dl(E.t('wtLastRefill'), dash)
      + dl(E.t('wtRefills'), dash)
      + dl(E.t('wtSupply'), dash));
    const leak = widget(E, E.t('wtLeak'), '',
      dl(E.t('wtLeakEvents'), dash)
      + dl(E.t('wtMnf'), dash),
      E.t('wtLeakFoot'));
    const meter = widget(E, E.t('wtMeter'), dash,
      dl(E.t('wtUptime'), dash)
      + dl(E.t('wtIntervals'), dash)
      + dl(E.t('wtResets'), dash)
      + dl(E.t('wtLastReading'), dash)
      + dl(E.t('wtSignal'), dash),
      E.t('wtMeterFoot'));
    return `<div class="pwarea" data-pg="water">
      <div class="pwheadrow"><div><span class="alcardt pgtitle">${esc(E.t('wtHdrT'))}</span>
        <span class="alcardm"> ${esc(E.t('pwSub'))}</span></div></div>
      ${heroes}
      <div class="wtgrid">
        <div class="col gap10">${daily}<div class="wt3grid">${tank}${leak}${meter}</div></div>
        ${utilAlarmCard(E,'waterAlarmsT',[],'waterAlarmsFoot')}
      </div></div>`;
  }

  /* --------------------------------- GAS ----------------------------------- */
  function gasPage(E){
    const d = E.data.gas, ar = E.lang === 'ar';
    const hero = (lbl,v,u,cap)=>`<div class="pwtile"><div class="pwth"><span class="ovklbl">${esc(lbl)}</span>${tileCtl(E, lbl, cap)}</div>
      <div class="ovkval"><span class="ovknum">${esc(v)}</span><span class="ovkunit">${esc(u)}</span></div>
      <span class="ovkcap">${esc(cap)}</span></div>`;
    const heroes = `<div class="pwhero cols3">
      ${hero(E.t('kGasToday'), d.todayM3 == null ? '--' : fmt(d.todayM3), 'm\u00b3', E.t('capToNow',{time:E.data.basis.asOf}).replace(' \u00b7 live','').replace(' \u00b7 \u0645\u0628\u0627\u0634\u0631',''))}
      ${hero(E.t('gasAvg7'), d.avg7M3 == null ? '--' : fmt(d.avg7M3), 'm\u00b3', E.t('gasAvg7Cap'))}
      ${hero(E.t('gasMtd'), d.mtdM3 == null ? '--' : fmt(d.mtdM3), 'm\u00b3', (ar?(d.meterAr||d.meterEn):d.meterEn) ? (ar?(d.meterAr||d.meterEn):d.meterEn).split(' \u00b7')[0] : '')}</div>`;

    // --- Live-data chart (toggle-aware) ---
    const tr = E.state.gsTrendRange || 'today';
    const liveS = { hourly: d.hourly, today: d.todayH, weekly: d.weekly, monthly: d.monthly }[tr];
    const useLive = Array.isArray(liveS) && liveS.some(function(v){ return v > 0; });
    const xLive = (d.trendX && d.trendX[tr]) || [];

    // Fall back to mock daily14 only when live hasn't arrived yet
    const dv   = useLive ? liveS : (tr === 'today' ? d.daily14 : []);
    const xrow_labels = useLive ? xLive : (tr === 'today' ? d.daily14.map(function(_,i){ return d.daily14StartDay + i; }) : []);

    const n    = dv.length;
    const YMX  = n ? Math.max(1, Math.ceil(Math.max.apply(null, dv.filter(function(v){ return v != null; }).concat([0])) * 1.15)) : 250;
    const step = n ? 100 / n : 100;
    const bw   = Math.min(6, step * 0.6);

    const seg = (k,v)=>`<button class="seg" data-on="${tr===v}" data-act="gsTrendRange" data-v="${v}">${esc(E.t(k))}</button>`;
    const segs = `<span class="row segbox msA">${seg('rangeHourly','hourly')}${seg('rangeToday','today')}${seg('rangeWeekly','weekly')}${seg('rangeMonthly','monthly')}</span>`;

    const grid = [0,25,50,75,100].map(y=>`<line x1="0" x2="100" y1="${y}" y2="${y}" stroke="var(--bd1)" stroke-width="1"${y===100?'':' stroke-dasharray="2 3"'} vector-effect="non-scaling-stroke"/>`).join('');

    let gbars = '', ghits = '';
    dv.forEach(function(v, i){
      const x  = (i * step + (step - bw) / 2).toFixed(1);
      const bh = Math.max(0, Number(v) || 0) / YMX * 96;
      gbars += `<rect x="${x}" y="${(96 - bh).toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="1" fill="url(#gsBarG)"/>`;
      const lab   = xrow_labels[i] != null ? String(xrow_labels[i]) : String(i + 1);
      const tipV  = v == null || Number(v) === 0 ? '--' : (v >= 100 ? fmt(v, 0) : fmt(v, 1));
      ghits += `<span class="chhit39" data-chtip="${encodeURIComponent(JSON.stringify({ t: lab, u: 'm³', rows: [{ c:'#A16207', n: E.t('gasDailyT'), v: tipV }] }))}"></span>`;
    });

    const gsCap = tr === 'hourly' ? E.t('gasDailySub')
      : tr === 'weekly'  ? (d.weekRange ? d.weekRange : E.t('gasDailySub'))
      : tr === 'monthly' ? (xLive.length ? xLive[0] + ' – ' + xLive[xLive.length - 1] : E.t('gasDailySub'))
      : E.t('gasDailySub');

    const src = ar ? d.sourceAr : d.sourceEn;
    const daily = `<article class="pwwidget">
      <div class="pwwh"><span class="alcardt">${esc(E.t('gasDailyT'))}</span>
        <span class="alcardm">${esc(gsCap)}</span>${segs}${chrome(E, E.t('gasDailyT'), gsCap)}</div>
      <div class="ch39 mh250"><div class="chy39"><span>${YMX}</span><span>${Math.round(YMX * 0.75)}</span><span>${Math.round(YMX / 2)}</span><span>${Math.round(YMX * 0.25)}</span><span>0</span></div>
        <div class="chcol39">
        <div class="chplot39">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs><linearGradient id="gsBarG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#A16207" stop-opacity="0.9"/><stop offset="100%" stop-color="#78350F" stop-opacity="0.5"/></linearGradient></defs>
            <line x1="0" x2="100" y1="96" y2="96" stroke="var(--bd1)" stroke-width="1" vector-effect="non-scaling-stroke"/>
            ${grid}${gbars}</svg>
          ${n ? `<div class="chhits39">${ghits}</div>` : ''}
        </div>
        <div class="chx39" style="grid-template-columns:repeat(${Math.max(n,1)},minmax(0,1fr))">${(n ? xrow_labels : ['']).map(function(t){ return `<span>${esc(String(t != null ? t : ''))}</span>`; }).join('')}</div>
        </div></div>
      <span class="ovkcap">${esc(E.t('gasFoot',{m:d.meterEn ? d.meterEn.split(' ')[0] : '--', s:src || '--'}))}</span></article>`;

    const dl = (k,v) => `<div class="aprow"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    const basis = widget(E, E.t('gasBasis'), '',
      dl(E.t('gasMeterLbl'), esc((ar?(d.meterAr||d.meterEn):d.meterEn) || '--'))
      + dl(E.t('gasSourceLbl'), esc(src || '--'))
      + dl(E.t('gasTariffLbl'), d.tariffAedM3 == null ? '--' : esc(E.t('gasTariffV',{v:d.tariffAedM3.toFixed(2)}))),
      E.t('gasFoot',{m: d.meterEn ? d.meterEn.split(' ')[0] : '--', s:src || '--'}));
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