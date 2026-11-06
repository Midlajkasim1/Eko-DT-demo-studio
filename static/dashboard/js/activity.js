/* ============================================================================
   ASSET DRAWER, ACTIVITY TAB (D180, partner demo A6). What happened to this
   equipment, newest first, from two sources only:
     - the alarm history (FIN alarm history): every alarm raised on the asset,
       its acknowledgement, and the earlier occurrences recorded for it;
     - the work order history (CMMS): every work order on the asset, with its
       state.
   Each row names its source. Each alarm row has a plus that opens that alarm's
   own history: its lifecycle (raised, issued, acknowledged, work order) and the
   earlier times the same alarm was raised on this asset.
   On demo sites the rows are demo rows. handoff/asset-activity.md states which
   FIN query and which CMMS field each row type needs.
   The proved result of a fix (js/prove.js) moved to the Analytics tab: it is
   neither source.
   ============================================================================ */
window.EKO_ACT = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = s => C().esc(s), icon = (n, s) => C().icon(n, s);
  const L = (E, en, ar) => E.lang === 'ar' ? (ar || en) : en;
  const cap1 = x => x ? x[0].toUpperCase() + x.slice(1) : x;

  function rows(E, r, als){
    const t = E.t.bind(E), id = r.id, out = [];
    /* 1. FIN alarm history */
    als.forEach(a => {
      out.push({ h: a.ageH || 0, src: 'fin', kind: 'raised', alarm: a, title: E.alarmLines(a, true).main, detail: t('rpSev.' + a.sev) });
      if(a.ack && a.ack.ageH != null) out.push({ h: a.ack.ageH, src: 'fin', kind: 'acked', title: E.alarmLines(a, true).main, detail: t('act.ackBy', { who: E.person(a.ack.who) }) });
    });
    const types = ((E.data.alarmHistory || {}).types) || {};
    ((E.data.alarmHistory || {}).events || []).filter(e => e.asset === id).forEach(e => { const ty = types[e.type];
      out.push({ h: e.agoH, src: 'fin', kind: 'past', title: ty ? cap1((k => E.t(k) !== k ? E.t(k) : L(E, ty.en, ty.ar))('alt.' + e.type)) : e.type, detail: t('act.cleared') }); });
    (E.data.eventLog || []).filter(e => e.asset === id && e.kind === 'alarmCleared').forEach(e => out.push({ h: e.h, src: 'fin', kind: 'clearedNow', title: L(E, e.plainEn, e.plainAr), detail: t('act.cleared') }));
    /* 2. CMMS work order history (one row per work order) */
    const wos = new Map();
    const put = (wid, o) => { const cur = wos.get(wid); wos.set(wid, Object.assign({}, cur || {}, o)); };
    (r.activity || []).forEach(w => put(w[0], { id: w[0], title: E.ph(w[1]), state: w[3], h: w[4] != null ? w[4] : 0 }));
    (((E.data.maintenance || {}).wos) || []).filter(w => w.asset === id).forEach(w => put(w.id, { id: w.id, title: L(E, w.taskEn, w.taskAr), state: w.state, h: w.openedH || 0, prio: w.prio }));
    if(E.state.woRaised[id]) put(E.state.woRaised[id], { id: E.state.woRaised[id], title: t('tl.woCreated'), state: 'asgn', h: 0 });
    const EV = { woCreated: 'tl.woCreated', woAssigned: 'tl.woAssigned', woCompleted: 'tl.woCompleted', woOverdue: 'tl.woOverdue' };
    (E.data.eventLog || []).filter(e => e.asset === id && EV[e.kind]).forEach(e => { const cur = wos.get(e.wo);
      if(cur) put(e.wo, { h: Math.min(cur.h, e.h) });   /* the row sits at its latest CMMS update */
      else put(e.wo, { id: e.wo, title: t(EV[e.kind]), state: e.kind === 'woCompleted' ? 'done' : 'asgn', h: e.h }); });
    /* D182: a work order opens and closes as two rows; each close carries the fix check at that moment (js/maintenance.js) */
    const MN = window.EKO_MNT, fx = MN ? MN.faults(E).filter(f => f.asset === id) : [];
    const mw = id2 => (((E.data.maintenance || {}).wos) || []).find(w => w.id === id2) || {};
    const pmOpen = new Set((((E.data.maintenance || {}).wos) || []).filter(w => w.asset === id && w.type === 'pm' && w.state !== 'done' && w.dueH != null).map(w => w.id));
    wos.forEach(w => { const done = w.state === 'done', f = done ? (fx.find(q => q.wo === w.id) || null) : null;
      if(pmOpen.has(w.id)) return;   /* an open planned task shows once, as PM due */
      out.push({ h: w.h, src: 'cmms', kind: done ? 'woClosed' : 'wo', title: w.title, wo: w.id, detail: t('wo' + cap1(w.state || 'prog')) + (w.prio ? ' · ' + w.prio : ''), fix: f ? (f.prove || t('mnt.fix.' + f.check)) : null, fixK: f ? f.check : null });
      const o = mw(w.id).openedH; if(done && o != null && o > w.h + 0.05) out.push({ h: o, src: 'cmms', kind: 'woOpened', title: w.title, wo: w.id, detail: w.prio || '' }); });
    /* planned maintenance due on the asset (an upcoming row sits above today) */
    (((E.data.maintenance || {}).wos) || []).filter(w => w.asset === id && w.type === 'pm' && w.state !== 'done' && w.dueH != null)
      .forEach(w => out.push({ h: -w.dueH, src: 'cmms', kind: 'pmDue', title: L(E, w.taskEn, w.taskAr), wo: w.id, detail: (w.dueH < 0 ? t('mnt.overdueBy', { t: E.fmtAge(-w.dueH) }) : t('mnt.dueIn', { t: E.fmtAge(w.dueH) })) + ' · ' + t('wo' + cap1(w.state || 'asgn')) }));
    /* inspections and tests on record for the asset (generator tests, detector tests) */
    const sec = E.data.security || {}, hAt = d => Math.floor((E.nowMs() - Date.parse(d)) / 86400000) * 24;   /* whole days, as the test summaries count them */
    if(((sec.power || {}).generators || []).some(g => g.id === id)) ((sec.power || {}).genTests || []).filter(q => q.result !== 'overdue').forEach(q => out.push({ h: hAt(q.date), src: 'insp', kind: 'insp', title: L(E, q.type, q.typeAr), detail: t('sec.test.' + q.result) }));
    ((((sec.fire || {}).deviceTests) || []).filter(q => q.id === id)).forEach(q => out.push({ h: q.monthsAgo * 730, src: 'insp', kind: 'insp', title: t('act.detTest'), detail: t('sp.fi.monthsAgo', { m: q.monthsAgo }) }));
    return out.sort((a, b) => a.h - b.h);
  }
  /* the plus: one alarm's own history */
  function history(E, r, a){
    const t = E.t.bind(E);
    const lc = (a.lifecycle || []).map(s => { const done = !!s[2], key = 'act.lc.' + String(s[0]).replace(/\s+/g, '');
      const extra = s[0] === 'Issued' && s[1] && s[1].afterMin != null ? ' · ' + t('act.afterMin', { n: s[1].afterMin }) : s[0] === 'Work order' && s[1] && s[1] !== '—' ? ' · ' + E.ph(s[1]) : '';
      return `<li data-done="${done ? 1 : 0}"><span class="actstep"></span>${esc(t(key) + extra)}</li>`; }).join('');
    const prev = ((E.data.alarmHistory || {}).events || []).filter(e => e.asset === r.id && a.type && e.type === a.type).sort((x, y) => x.agoH - y.agoH);
    const prevHtml = prev.length ? `<ul class="actprev">${prev.map(e => `<li><span class="tMonoS">${esc(E.fmtAge(e.agoH))}</span><span>${esc(t('act.prevAt', { h: String(e.hour).padStart(2, '0') + ':00' }))}</span></li>`).join('')}</ul>`
      : `<p class="tCap">${esc(t('act.prevNone'))}</p>`;
    return `<div class="acthist"><ol class="actlc">${lc}</ol>${prev.length ? `<p class="tLbl">${esc(t('act.prevT', { n: prev.length }))}</p>` : ''}${prevHtml}</div>`;
  }
  function tab(E, r, als){
    const t = E.t.bind(E), list = rows(E, r, als), open = E.state.actOpen || {};
    if(!list.length) return `<p class="apempty">${esc(t('act.empty'))}</p><p class="tCap actfoot">${esc(t('act.foot'))}</p>`;
    const li = x => `<li class="actrow" data-src="${x.src}">
        <span class="tMonoS actwhen">${esc(x.h < 0 ? t('act.ahead') : x.h < 0.02 ? t('whenToday') : E.fmtAge(x.h))}</span>
        <span class="actbody"><span class="actkind">${esc(t('act.k.' + x.kind, { id: x.wo || '' }))}</span><span class="acttitle">${esc(x.title)}</span>
          <span class="actmeta"><span class="actsrc">${esc(t('act.src.' + x.src))}</span>${x.detail ? ' · ' + esc(x.detail) : ''}</span>
          ${x.fix ? `<span class="actfix mntcheck" data-k="${esc(x.fixK || '')}">${esc(t('act.fixAt', { s: x.fix }))}</span>` : ''}
          ${x.kind === 'raised' && open[x.alarm.id] ? history(E, r, x.alarm) : ''}</span>
        ${x.kind === 'raised' ? `<button class="iconbtn icon26 actplus" data-act="actPlus" data-v="${esc(x.alarm.id)}" aria-expanded="${!!open[x.alarm.id]}"
            data-tip="${esc(t(open[x.alarm.id] ? 'act.minus' : 'act.plus'))}" aria-label="${esc(t(open[x.alarm.id] ? 'act.minus' : 'act.plus'))}">${icon(open[x.alarm.id] ? 'chevU' : 'plus', 13)}</button>`
          : x.src === 'cmms' ? `<span class="actcafm" data-tip="${esc(t('apCafmOpen'))}">${icon('external', 12)}</span>` : ''}</li>`;
    return `<ol class="actlist">${list.map(li).join('')}</ol><p class="tCap actfoot">${esc(t('act.foot'))}</p>`;
  }
  const ACTS = {
    actPlus(el, ev){ if(ev) ev.stopPropagation(); const E = window.EKO, o = Object.assign({}, E.state.actOpen || {}); o[el.dataset.v] = !o[el.dataset.v]; E.set({ actOpen: o }); }
  };
  return { tab, rows, ACTS };
})();
