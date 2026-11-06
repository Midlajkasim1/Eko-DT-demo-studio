/* ============================================================================
   MAINTENANCE (D180, partner demo A1). One working page from what the build
   already has, on demo data:
     - the work order backlog (CMMS): every open work order with its asset,
       task, type, priority, state, age and due time, overdue first;
     - PM compliance by system (CMMS): planned work done against due, last 30 days;
     - the verified fix per work order (the prove engine, js/prove.js): the
       reading before and after the fix, and its outcome;
     - acknowledgement time and recovery time by priority (FIN alarm history),
       median and 90th percentile, last 30 days.
   Data: data.maintenance (demo, marked so), plus data.verified and data.pm.
   Read only: nothing here writes to the plant or to the CMMS; Create work
   order stays where it is (the asset panel and the alarm surfaces).
   ============================================================================ */
window.EKO_MNT = (function(){
  'use strict';
  const C = () => window.EKO_C, A = () => window.EKO_A;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d);
  const PRIO = { P1: 0, P2: 1, P3: 2, P4: 3 };
  const D = E => E.data.maintenance || null;
  const L = (E, en, ar) => E.lang === 'ar' ? (ar || en) : en;

  /* the open backlog: the demo CMMS list, plus any work order raised in this session */
  function backlog(E){
    const d = D(E) || { wos: [] }, rows = (d.wos || []).filter(w => w.state !== 'done').map(w => Object.assign({}, w));
    Object.keys(E.state.woRaised || {}).forEach(asset => { const id = E.state.woRaised[asset];
      if(!rows.some(w => w.id === id)) rows.push({ id, asset, taskEn: 'Raised from EKO', taskAr: 'أُنشئ من EKO', type: 'cm', prio: 'P2', state: 'asgn', openedH: 0, dueH: 24, session: true }); });
    return rows.sort((a, b) => ((a.dueH < 0) === (b.dueH < 0) ? 0 : a.dueH < 0 ? -1 : 1) || (PRIO[a.prio] - PRIO[b.prio]) || (b.openedH - a.openedH));
  }
  function pmRows(E){
    const d = D(E) || {};
    if(Array.isArray(d.pmBySystem) && d.pmBySystem.length) return d.pmBySystem;
    const pm = E.data.pm; return pm && pm.due ? [{ sysEn: 'All systems', sysAr: 'كل الأنظمة', done: pm.done, due: pm.due }] : [];
  }
  const pct = (a, b) => b ? a / b * 100 : null;

  /* D180 (screen specs): the fault to work order table. One row per fault rule on an asset, from the site's own
     data: the fault alarms (FIN rules) with their earlier occurrences, the work order on the asset (CMMS), and the
     verified fixes (Prove). EKO shows the CMMS record; it never creates one here. Fix check:
     needs action (no work order), in progress (work order open), fixed and holding (closed, the rule quiet 24 h
     or more since), recurred (closed, the rule back). Where Prove has run, its own outcome wording is shown. */
  const PR = { critical: 'P1', high: 'P2', medium: 'P3' };
  /* E7: a rule's short label by its type (the type's verb phrase is the Brief's, for its sentence); the asset in front: "FR-03: fridge above its band" */
  const ruleLbl = (E, type, types) => { const k = 'alt.' + type, v = E.t(k); return v !== k ? v : (types[type] ? L(E, types[type].en, types[type].ar) : type); };
  /* E7: how long the engine's fault has drifted before its rule crossed the limit (the chiller: 12 days, the rule 18 h ago) */
  const driftD = (E, asset) => { const F = E.sim && E.sim.cfg && E.sim.cfg.faults; if(!F) return null; const f = Object.values(F).find(x => x && x.asset === asset && x.onsetAgoD != null && !x.fixAgoD); return f ? f.onsetAgoD : null; };
  function faults(E){
    const d = E.data, types = ((d.alarmHistory || {}).types) || {}, hist = ((d.alarmHistory || {}).events) || [], wos = ((D(E) || {}).wos) || [];
    const assetOf = id => (d.assets || []).find(a => a.id === id) || {};
    const openWo = id => { const w = wos.find(x => x.asset === id && x.state !== 'done'); if(w) return { id: w.id, state: w.state };
      const a = (assetOf(id).activity || []).find(x => x[3] !== 'done'); return a ? { id: a[0], state: a[3] } : null; };
    const rows = [];
    (d.alarms || []).filter(a => a.cat === 'fdd' || (a.type && types[a.type])).forEach(a => {
      const prev = hist.filter(h => h.asset === a.asset && h.type === a.type), w = openWo(a.asset);
      rows.push({ rule: a.type && types[a.type] ? ruleLbl(E, a.type, types) : L(E, a.plainEn, a.plainAr), asset: a.asset, firstH: Math.max(a.ageH || 0, ...prev.map(h => h.agoH)),
        lastH: a.ageH || 0, n: prev.length + 1, prio: PR[a.sev] || 'P3', wo: w ? w.id : null, woState: w ? w.state : null, check: w ? 'prog' : 'needs' });
    });
    const PV = window.EKO_PROVE;
    (PV ? PV.verified(E) : []).forEach(v => {
      const held = v.outcome === 'recovered' || v.outcome === 'partly', back = v.outcome === 'notRecovered';
      rows.push({ rule: v.point, asset: v.asset, firstH: (v.fixedDaysAgo + 14) * 24, lastH: v.fixedDaysAgo * 24, n: null, prio: 'P2', wo: v.wo || null, woState: 'done',
        check: held ? 'holding' : back ? 'recurred' : 'prog', prove: PV.outcomeLbl(E, v) });
    });
    return rows.sort((a, b) => ['needs', 'recurred', 'prog', 'holding'].indexOf(a.check) - ['needs', 'recurred', 'prog', 'holding'].indexOf(b.check) || a.lastH - b.lastH);
  }
  /* D182: repeat offenders, the same rule on the same asset 3 times or more in 90 days (live alarm included) */
  function repeats(E){
    const d = E.data, types = ((d.alarmHistory || {}).types) || {}, hist = (((d.alarmHistory || {}).events) || []).filter(h => h.agoH <= 2160), wos = ((D(E) || {}).wos) || [], m = {};
    hist.forEach(h => { const k = h.asset + '|' + h.type; (m[k] = m[k] || { asset: h.asset, type: h.type, n: 0, lastH: Infinity }).n++; m[k].lastH = Math.min(m[k].lastH, h.agoH); });
    (d.alarms || []).forEach(a => { const k = a.asset + '|' + a.type; if(m[k]){ m[k].n++; m[k].lastH = Math.min(m[k].lastH, a.ageH || 0); } });
    return Object.values(m).filter(r => r.n >= 3).map(r => Object.assign(r, { rule: ruleLbl(E, r.type, types), wo: ((wos.find(w => w.asset === r.asset && w.state !== 'done') || {}).id) || null })).sort((a, b) => b.n - a.n);
  }
  const BUCKETS = [[0, 7], [8, 30], [31, 90], [91, Infinity]];
  const ageBuckets = bl => BUCKETS.map(([a, b]) => bl.filter(w => { const dd = (w.openedH || 0) / 24; return dd >= (a === 0 ? 0 : a - 1) && (b === Infinity || dd < b); }).length);

  function page(E){
    const t = E.t.bind(E), d = D(E), widget = A().widget, hero = A().heroTile;
    if(!d) return `<div class="pwarea"><p class="alempty">${esc(t('mnt.none'))}</p></div>`;
    const bl = backlog(E), over = bl.filter(w => w.dueH < 0);
    const pms = pmRows(E), pmDone = pms.reduce((s, r) => s + r.done, 0), pmDue = pms.reduce((s, r) => s + r.due, 0);
    const resp = (d.response || {}).byPrio || [], crit = resp.find(r => r.prio === 'critical') || resp[0] || {};
    const PV = window.EKO_PROVE, ver = PV ? PV.verified(E) : [];
    /* D182: the headline names what is overdue and what came back; each tile names the CMMS field it reads; every number is a door */
    const O = window.EKO_OPS, door = (v, k, arg) => O ? O.door(E, esc(v), k, arg) : esc(v), heroD = (lbl, v, u, cap, f, chip) => O.hero(E, lbl, v, u, cap + ' · ' + t('mnt.f.' + f), chip, 'warn');
    const fr0 = faults(E), rec = fr0.filter(r => r.check === 'recurred'), reps = repeats(E);
    /* E13: on the facility manager's landing the headline is written for them (js/personas.js) */
    const perHl = window.EKO_PERSONA && window.EKO_PERSONA.of(E) === 'fm' && window.EKO_PERSONA.onLanding(E) ? window.EKO_PERSONA.headline(E, 'fm') : null;
    const hl = O && perHl ? O.headline(E, perHl, over.length ? 'attn' : 'ok') : O ? O.headline(E, over.length || rec.length || reps.length ? t('mnt.hl2', { o: over.length, ids: over.slice(0, 3).map(w => w.id).join(', ') || t('emptyDash'), r: rec.length, p: reps.length, what: reps.slice(0, 2).map(r => t('mnt.repV', { a: r.asset, n: r.n })).join('; ') || t('emptyDash') }) : t('mnt.hlOk'), over.length || rec.length ? 'attn' : 'ok') : '';
    const heroes = [
      heroD(t('mnt.h.open'), door(String(bl.length), 'mntWo', 'open'), '', t('mnt.h.openCap'), 'open', over.length ? t('mnt.h.overdueChip', { n: over.length }) : ''),
      heroD(t('mnt.h.pm'), pmDue ? door(fmt(pct(pmDone, pmDue), 0), 'mntPm') : t('emptyDash'), pmDue ? '%' : '', t('mnt.h.pmCap', { a: pmDone, b: pmDue }), 'pm'),
      heroD(t('mnt.h.ack'), crit.ackMedMin != null ? door(String(crit.ackMedMin), 'mntResp') : t('emptyDash'), t('mnt.min'), t('mnt.h.ackCap'), 'ack'),
      heroD(t('mnt.h.rec'), crit.recMedH != null ? door(fmt(crit.recMedH, 1), 'mntResp') : t('emptyDash'), t('mnt.hrs'), t('mnt.h.recCap'), 'rec'),
      heroD(t('mnt.h.sla'), d.slaMetPct != null ? door(fmt(d.slaMetPct, 1), 'mntKpi') : t('emptyDash'), d.slaMetPct != null ? '%' : '', d.slaMetPct != null ? t('mnt.h.slaCap') : t('mnt.h.slaNone'), 'sla'),
      heroD(t('mnt.h.ver'), door(String(ver.filter(v => v.outcome === 'recovered' || v.outcome === 'partly').length), 'mntFix', 'holding'), '', t('mnt.h.verCap', { n: ver.length }), 'ver')];
    /* 1. the backlog */
    const st = w => `<span class="mntst" data-st="${esc(w.state)}">${esc(t('wo' + w.state.charAt(0).toUpperCase() + w.state.slice(1)))}</span>`;
    const due = w => w.dueH == null ? t('emptyDash') : w.dueH < 0 ? t('mnt.overdueBy', { t: E.fmtAge(-w.dueH) }) : t('mnt.dueIn', { t: E.fmtAge(w.dueH) });
    const rows = bl.map(w => `<tr data-over="${w.dueH < 0 ? 1 : 0}">
        <th scope="row" class="tMonoS">${esc(w.id)}</th>
        <td><button class="statlink tMonoS" data-act="openAsset" data-asset="${esc(w.asset)}">${esc(w.asset)}</button></td>
        <td>${esc(L(E, w.taskEn, w.taskAr))}</td><td class="tCap">${esc(t('mnt.type.' + (w.type || 'cm')))}</td>
        <td><span class="mntprio" data-p="${esc(w.prio || '')}">${esc(w.prio || t('emptyDash'))}</span></td><td>${st(w)}</td>
        <td class="tMonoS">${esc(E.fmtAge(w.openedH || 0))}</td><td class="tCap${w.dueH < 0 ? ' cWarn' : ''}">${esc(due(w))}</td></tr>`).join('');
    const backlogW = widget(E, t('mnt.bl.T'), t('mnt.bl.cap', { n: bl.length, o: over.length }),
      `<div class="mnttblwrap"><table class="mnttbl"><thead><tr><th scope="col">${esc(t('mnt.c.wo'))}</th><th scope="col">${esc(t('mnt.c.asset'))}</th><th scope="col">${esc(t('mnt.c.task'))}</th>
        <th scope="col">${esc(t('mnt.c.type'))}</th><th scope="col">${esc(t('mnt.c.prio'))}</th><th scope="col">${esc(t('mnt.c.state'))}</th><th scope="col">${esc(t('mnt.c.age'))}</th><th scope="col">${esc(t('mnt.c.due'))}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="alempty">${esc(t('mnt.bl.none'))}</td></tr>`}</tbody></table></div>`, t('mnt.src.cmms'));
    /* 2. PM compliance */
    const pmW = widget(E, t('mnt.pm.T'), t('mnt.pm.cap'), `<div class="col gap6">${pms.map(r => { const p = pct(r.done, r.due);
        return `<div class="mntpm"><span class="mntpmn">${esc(L(E, r.sysEn, r.sysAr))}</span><span class="mntbar"><span style="width:${p == null ? 0 : Math.min(100, p).toFixed(1)}%" data-low="${p != null && p < 90 ? 1 : 0}"></span></span>
          <span class="tMonoS">${p == null ? esc(t('mnt13.noneDue')) : fmt(p, 0) + '%'}</span><span class="tCap">${esc(t('mnt.pm.of', { a: r.done, b: r.due }))}</span></div>`; }).join('')}</div>`, t('mnt.src.cmms'));
    /* 3. verified fix per work order */
    const vrows = ver.map(v => `<tr><th scope="row" class="tMonoS">${esc(v.wo || t('emptyDash'))}</th>
        <td><button class="statlink tMonoS" data-act="openAsset" data-asset="${esc(v.asset)}">${esc(v.asset)}</button></td><td>${esc(v.point)}</td>
        <td class="tMonoS">${esc(fmt(v.beforeMean, 2) + ' → ' + fmt(v.afterMean, 2) + ' ' + v.unit)}</td>
        <td><span class="mntout" data-o="${esc(v.outcome)}">${esc(PV.outcomeLbl(E, v))}</span></td>
        <td class="tCap">${v.kwhMo != null ? esc(t('mnt.ver.kwh', { k: fmt(v.kwhMo, 0) })) : esc(t('emptyDash'))}</td></tr>`).join('');
    const verW = widget(E, t('mnt.ver.T'), t('mnt.ver.cap'),
      ver.length ? `<div class="mnttblwrap"><table class="mnttbl"><thead><tr><th scope="col">${esc(t('mnt.c.wo'))}</th><th scope="col">${esc(t('mnt.c.asset'))}</th><th scope="col">${esc(t('mnt.c.point'))}</th>
        <th scope="col">${esc(t('mnt.c.ba'))}</th><th scope="col">${esc(t('mnt.c.outcome'))}</th><th scope="col">${esc(t('mnt.c.saving'))}</th></tr></thead><tbody>${vrows}</tbody></table></div>`
        : `<p class="alempty">${esc(t('mnt.ver.none'))}</p>`, t('mnt.ver.foot'));
    /* 4. acknowledgement and recovery times */
    const trows = resp.map(r => `<tr><th scope="row"><span class="statchip" data-sev="${esc(r.prio)}">${esc(t('ov3.sev.' + r.prio))}</span></th><td class="tMonoS">${esc(String(r.n))}</td>
        <td class="tMonoS">${esc(t('mnt.minV', { v: r.ackMedMin }))}</td><td class="tMonoS">${esc(t('mnt.minV', { v: r.ackP90Min }))}</td>
        <td class="tMonoS">${esc(t('mnt.hV', { v: fmt(r.recMedH, 1) }))}</td><td class="tMonoS">${esc(t('mnt.hV', { v: fmt(r.recP90H, 1) }))}</td></tr>`).join('');
    const respW = widget(E, t('mnt.resp.T'), t('mnt.resp.cap'),
      `<div class="mnttblwrap"><table class="mnttbl"><thead><tr><th scope="col">${esc(t('mnt.c.prio'))}</th><th scope="col">${esc(t('mnt.c.n'))}</th><th scope="col">${esc(t('mnt.c.ackMed'))}</th>
        <th scope="col">${esc(t('mnt.c.ackP90'))}</th><th scope="col">${esc(t('mnt.c.recMed'))}</th><th scope="col">${esc(t('mnt.c.recP90'))}</th></tr></thead><tbody>${trows}</tbody></table></div>`, t('mnt.resp.foot'));
    /* fix check tiles, the fault to work order table, the backlog by age */
    const fr = faults(E), cnt = k => fr.filter(r => r.check === k).length;
    const fixT = ['needs', 'prog', 'holding', 'recurred'].map(k => { const it = fr.filter(r => r.check === k);
      return `<div class="mntfix" data-k="${k}"><span class="tLbl">${esc(t('mnt.fix.' + k))}</span><b class="tMonoS">${O ? O.door(E, String(it.length), 'mntFix', k) : it.length}</b>
        <ul class="mntfixl">${it.slice(0, 3).map(r => `<li><button class="statlink" data-act="openAsset" data-asset="${esc(r.asset)}">${esc(r.asset)}</button><span class="tCap">: ${esc(r.rule)}</span></li>`).join('') || `<li class="tCap">${esc(t('mnt.fix.' + k + 'Cap'))}</li>`}${it.length > 3 ? `<li class="tCap">${esc(t('mnt.fix.more', { n: it.length - 3 }))}</li>` : ''}</ul></div>`; }).join('');
    const frows = fr.map(r => `<tr data-check="${r.check}"><th scope="row">${esc(r.rule)}</th><td><button class="statlink tMonoS" data-act="openAsset" data-asset="${esc(r.asset)}">${esc(r.asset)}</button></td>
        <td class="tMonoS">${esc((dd => dd && dd * 24 > r.firstH + 24 ? t('mnt.firstDrift', { a: E.fmtAge(r.firstH), d: dd }) : E.fmtAge(r.firstH))(driftD(E, r.asset)))}</td><td class="tMonoS">${esc(E.fmtAge(r.lastH))}</td><td><span class="mntprio" data-p="${esc(r.prio)}">${esc(r.prio)}</span></td>
        <td class="tMonoS">${esc(r.wo || t('emptyDash'))}</td><td>${r.woState ? st({ state: r.woState }) : `<span class="tCap">${esc(t('mnt.fix.noWo'))}</span>`}</td>
        <td><span class="mntcheck" data-k="${r.check}">${esc(r.prove || t('mnt.fix.' + r.check))}</span></td></tr>`).join('');
    const faultW = widget(E, t('mnt.fw.T'), t('mnt.fw.cap'), `<div class="mntfixes">${fixT}</div><div class="mnttblwrap"><table class="mnttbl"><thead><tr>${['mnt.c.rule', 'mnt.c.asset', 'mnt.c.first', 'mnt.c.last', 'mnt.c.prio', 'mnt.c.wo', 'mnt.c.woState', 'mnt.c.check'].map(k => `<th scope="col">${esc(t(k))}</th>`).join('')}</tr></thead>
        <tbody>${frows || `<tr><td colspan="8" class="alempty">${esc(t('mnt.fw.none'))}</td></tr>`}</tbody></table></div>`, t('mnt.fw.foot'));
    const ab = ageBuckets(bl), abMax = Math.max(1, ...ab);
    const ageW = widget(E, t('mnt.age.T'), t('mnt.age.cap'), `<div class="col gap6">${ab.map((n, i) => `<div class="mntpm"><span class="mntpmn">${O ? O.door(E, esc(t('mnt.age.b' + i)), 'mntWo', 'age:' + i) : esc(t('mnt.age.b' + i))}</span><span class="mntbar"><span style="width:${(n / abMax * 100).toFixed(1)}%" data-low="${i >= 2 && n ? 1 : 0}"></span></span><span class="tMonoS">${n}</span><span></span></div>`).join('')}</div>`, t('mnt.src.cmms'));
    /* Priority 2: reliability by system and month, and an asset health estimate with its contributors and weights stated */
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], cm = new Date(E.nowMs()).getMonth();
    const mlb = k => E.ph(MON[(cm - 3 + k + 12) % 12]);
    const relW = d.reliability ? widget(E, t('mnt.rel.T'), t('mnt.rel.cap'), `<div class="mnttblwrap"><table class="mnttbl"><thead><tr><th scope="col">${esc(t('mnt.c.sys'))}</th>${[0, 1, 2].map(k => `<th scope="col">${esc(mlb(k))}</th>`).join('')}</tr></thead><tbody>${d.reliability.map(r => `<tr><th scope="row">${esc(L(E, r.sysEn, r.sysAr))}</th>${r.mtbfH.map((v, k) => `<td class="tMonoS">${esc(t('mnt.rel.v', { m: fmt(v, 0), d: fmt(r.downH[k], 1) }))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`, t('mnt.rel.foot')) : '';
    let healthW = '';
    if(d.health){
      const W = Object.fromEntries(d.health.weights), yrs = a => a.installed ? (E.nowMs() - Date.parse(a.installed)) / 3.156e10 : null;
      const sc = a => { const c = { alarms: Math.max(0, 100 - 40 * (a.alarms || []).length), wos: Math.max(0, 100 - 30 * (a.wos || 0)), pm: (d.wos || []).some(w => w.asset === a.id && w.type === 'pm' && w.dueH < 0) ? 40 : 100, age: yrs(a) == null ? 80 : Math.max(0, 100 - 6 * yrs(a)) };
        return { c, s: Object.keys(W).reduce((x, k) => x + c[k] * W[k], 0) }; };
      const rows = (E.data.assets || []).filter(a => a.crit === 'A' || (a.alarms || []).length).map(a => Object.assign({ a }, sc(a))).sort((x, y) => x.s - y.s).slice(0, 8);
      healthW = widget(E, t('mnt.hl.T'), t('mnt.hl.cap', { w: d.health.weights.map(([k, v]) => t('mnt.hl.k.' + k) + ' ' + Math.round(v * 100) + '%').join(' · ') }),
        `<div class="mnttblwrap"><table class="mnttbl"><thead><tr><th scope="col">${esc(t('mnt.c.asset'))}</th><th scope="col">${esc(t('mnt.hl.score'))}</th>${Object.keys(W).map(k => `<th scope="col">${esc(t('mnt.hl.k.' + k))}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><th scope="row"><button class="statlink tMonoS" data-act="openAsset" data-asset="${esc(r.a.id)}">${esc(r.a.id)}</button></th><td class="tMonoS"><b>${fmt(r.s, 0)}</b></td>${Object.keys(W).map(k => `<td class="tMonoS">${fmt(r.c[k], 0)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`, L(E, d.health.basisEn, d.health.basisAr));
    }
    const repW = widget(E, t('mnt.rep.T'), t('mnt.rep.cap'), reps.length ? `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${['mnt.c.asset', 'mnt.c.rule', 'mnt.rep.n', 'mnt.c.last', 'mnt.c.wo'].map(k => `<th scope="col">${esc(t(k))}</th>`).join('')}</tr></thead>
      <tbody>${reps.map(r => `<tr><th scope="row"><button class="statlink tMonoS" data-act="openAsset" data-asset="${esc(r.asset)}">${esc(r.asset)}</button></th><td>${esc(r.rule)}</td><td class="tMonoS">${r.n}</td><td class="tMonoS">${esc(E.fmtAge(r.lastH))}</td><td class="tMonoS">${esc(r.wo || t('emptyDash'))}</td></tr>`).join('')}</tbody></table></div>` : `<p class="alempty">${esc(t('mnt.rep.none'))}</p>`, t('mnt.src.cmms'));
    const kpiW = widget(E, t('mnt.kpi.T'), t('mnt.kpi.cap'), `<dl class="secdl mntkpis">${['pm', 'ack', 'rec', 'sla', 'age', 'rep', 'fix'].map(k => `<dt>${esc(t('mnt.kpi.' + k))}</dt><dd>${esc(t('mnt.kpi.' + k + 'F'))}</dd>`).join('')}</dl>`);
    const p2W = relW || healthW ? `<div class="mntgrid2">${relW}${healthW}</div>` : '';
    /* E9: the tiles stay on top (five); the detail in four tabs: work orders, faults and fixes, the PM plan, the KPIs (js/shell/frame.js) */
    const G = window.EKO_FRAME.group, h5 = heroes.slice(0, 5), hx = heroes.slice(5);
    return `<div class="pwarea mntpage" data-pg="mnt">${hl}<div class="pwhero" style="grid-template-columns:repeat(${h5.length},1fr)">${h5.join('')}</div>`
      + G('wo', t('mnt.tab.wo'), backlogW + ageW)
      + G('ff', t('mnt.tab.ff'), (hx.length ? `<div class="pwhero pfmore" style="grid-template-columns:repeat(5,1fr)">${hx.join('')}</div>` : '') + faultW + `<div class="mntgrid2">${repW}${verW}</div>`)
      + G('pm', t('mnt.tab.pm'), pmW)
      + G('kpi', t('mnt.tab.kpi'), `<div class="mntgrid2">${respW}${kpiW}</div>${p2W}`) + `</div>`;
  }
  if(window.EKO_OPS){
    const O = window.EKO_OPS, woTable = (E, l) => O.table(E, ['mnt.c.wo', 'mnt.c.asset', 'mnt.c.task', 'mnt.c.prio', 'mnt.c.age', 'mnt.c.due'], l.map(w => `<tr><th scope="row" class="tMonoS">${esc(w.id)}</th><td class="tMonoS">${esc(w.asset)}</td><td>${esc(L(E, w.taskEn, w.taskAr))}</td><td>${esc(w.prio || '')}</td><td class="tMonoS">${esc(E.fmtAge(w.openedH || 0))}</td><td class="tCap">${esc(w.dueH == null ? E.t('emptyDash') : w.dueH < 0 ? E.t('mnt.overdueBy', { t: E.fmtAge(-w.dueH) }) : E.t('mnt.dueIn', { t: E.fmtAge(w.dueH) }))}</td></tr>`).join(''), 'mnt.bl.none');
    O.drill('mntWo', (E, k) => { const bl = backlog(E), t = E.t.bind(E);
      if(/^age:/.test(k)){ const [a, b] = BUCKETS[+k.split(':')[1]]; return { title: t('mnt.age.T') + ': ' + t('mnt.age.b' + k.split(':')[1]), body: woTable(E, bl.filter(w => { const dd = (w.openedH || 0) / 24; return dd >= (a === 0 ? 0 : a - 1) && (b === Infinity || dd < b); })), method: t('mnt.kpi.ageF') }; }
      return { title: t('mnt.h.open'), body: woTable(E, bl), method: t('mnt.f.open') }; });
    O.drill('mntPm', E => ({ title: E.t('mnt.pm.T'), body: O.table(E, ['mnt.c.sys', 'mnt.pm.doneT', 'mnt.pm.dueT'], pmRows(E).map(r => `<tr><th scope="row">${esc(L(E, r.sysEn, r.sysAr))}</th><td class="tMonoS">${r.done}</td><td class="tMonoS">${r.due}</td></tr>`).join('')), method: E.t('mnt.kpi.pmF') }));
    O.drill('mntResp', E => ({ title: E.t('mnt.resp.T'), body: O.table(E, ['mnt.c.prio', 'mnt.c.n', 'mnt.c.ackMed', 'mnt.c.recMed'], (((D(E) || {}).response || {}).byPrio || []).map(r => `<tr><th scope="row">${esc(E.t('ov3.sev.' + r.prio))}</th><td class="tMonoS">${r.n}</td><td class="tMonoS">${esc(E.t('mnt.minV', { v: r.ackMedMin }))}</td><td class="tMonoS">${esc(E.t('mnt.hV', { v: fmt(r.recMedH, 1) }))}</td></tr>`).join('')), method: E.t('mnt.kpi.ackF') + ' ' + E.t('mnt.kpi.recF') }));
    O.drill('mntKpi', E => ({ title: E.t('mnt.h.sla'), body: `<p>${esc(L(E, (D(E) || {}).slaBasisEn, (D(E) || {}).slaBasisAr) || '')}</p>`, method: E.t('mnt.kpi.slaF') }));
    O.drill('mntFix', (E, k) => ({ title: E.t('mnt.fix.' + k), body: O.table(E, ['mnt.c.rule', 'mnt.c.asset', 'mnt.c.wo', 'mnt.c.last'], faults(E).filter(r => r.check === k).map(r => `<tr><th scope="row">${esc(r.rule)}</th><td class="tMonoS">${esc(r.asset)}</td><td class="tMonoS">${esc(r.wo || E.t('emptyDash'))}</td><td class="tMonoS">${esc(E.fmtAge(r.lastH))}</td></tr>`).join(''), 'mnt.fw.none'), method: E.t('mnt.kpi.fixF') }));
  }
  return { page, backlog, pmRows, faults, repeats };
})();
