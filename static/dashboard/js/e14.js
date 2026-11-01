/* ============================================================================
   E14: THE APPROVED MOCK (design/persona-mock/) — EKO_E14.

   The prediction card (mock 2, the signature screen) and the proof card (mock 3)
   as two full-width pages, reachable from the asset drawer's Predict tab and from
   the engineer's landing; and "How this works on site", the button every mock
   screen carries, with the text adjusted to the facts in handoff/.

   Every figure comes from the engine through EKO_PROVE (js/prove.js): the linear
   fit, its range and R², the before and after windows, the outcome. Where the
   mock's value differs (or is marked *), the engine's value is shown.
   ============================================================================ */
window.EKO_E14 = (function(){
  'use strict';
  const C = () => window.EKO_C, PV = () => window.EKO_PROVE;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d), icon = (n, s) => C().icon(n, s);
  const L = (E, en, ar) => E.lang === 'ar' ? (ar || en) : en;
  const lc = (E, s) => E.lang === 'ar' || !s ? s : s.charAt(0).toLowerCase() + s.slice(1);

  /* --------------------------- How this works on site --------------------------- */
  /* the rows of each screen's box: e14.site.<key>.<n>.k (the label) and .v (the text) */
  const SITE = { land: 6, pred: 4, prove: 3, exec: 5, asset: 5 };
  const open = (E, key) => !!((E.state.site14 || {})[key]);
  function siteBtn(E, key){
    return `<button class="e14sitebtn" data-act="e14Site" data-v="${key}" aria-expanded="${open(E, key)}">${esc(E.t(open(E, key) ? 'e14.siteHide' : 'e14.site'))}</button>`;
  }
  function siteBox(E, key){
    if(!open(E, key)) return '';
    const t = E.t.bind(E), n = SITE[key] || 0, rows = [];
    for(let i = 1; i <= n; i++) rows.push(`<div><b>${esc(t('e14.site.' + key + '.' + i + '.k'))}</b> ${esc(t('e14.site.' + key + '.' + i + '.v'))}</div>`);
    return `<div class="e14site" data-k="${key}" role="note"><div class="e14siteT">${esc(t('e14.siteT'))}</div>${rows.join('')}</div>`;
  }

  /* ------------------------------- the facts ------------------------------- */
  const asset = (E, id) => (E.data.assets || []).find(a => a.id === id) || null;
  const ctxOf = (E, a) => a ? [L(E, a.typeEn, a.typeAr), L(E, a.level, a.levelAr)].filter(Boolean).join(E.t('cu.lblSep')) : '';
  const wos = E => ((E.data.maintenance || {}).wos || []);
  const openWo = (E, id) => wos(E).filter(w => w.asset === id && !w.closedH && w.state !== 'done').sort((a, b) => (a.dueH == null) - (b.dueH == null) || (a.dueH || 0) - (b.dueH || 0))[0] || null;
  const alarmOf = (E, id) => (E.data.alarms || []).filter(a => a.asset === id).sort((a, b) => b.ageH - a.ageH)[0] || null;
  /* the drifting predictions and the proved fixes the pages can show */
  const drifts = E => PV() ? PV().predictions(E).filter(p => p.state === 'drift') : [];
  const proofs = E => PV() ? PV().verified(E) : [];
  const predAsset = E => { const s = E.state.p14Asset, d = drifts(E); return (d.find(p => p.asset === s) || d[0] || {}).asset || null; };
  const proofAsset = E => { const s = E.state.p14Proof, v = proofs(E); return (v.find(x => x.asset === s) || v.find(x => x.outcome === 'recovered') || v[0] || {}).asset || null; };
  const daysTxt = (E, h) => fmt(Math.max(0, Math.round(h / 24)), 0);
  const woState = (E, w) => E.t('e14.wost.' + (w.state === 'prog' ? 'prog' : w.state === 'asgn' ? 'asgn' : 'open'));

  /* ------------------------------ the cone chart ------------------------------ */
  /* the history, today, the projection to the limit and the cone of its range (mock 2) */
  function cone(E, p){
    const W = 800, H = 260, x0 = 40, x1 = 780, yTop = 20, yBot = 222;
    const n = p.vals.length, total = n - 1 + Math.max(p.daysHi, p.days) * 1.12;
    const lo = Math.min(...p.vals), hi = p.limit * 1.12, span = (hi - lo) || 1;
    const X = i => x0 + (i / total) * (x1 - x0), Y = v => yBot - ((v - lo) / span) * (yBot - yTop);
    const iT = n - 1, xT = X(iT), yL = Y(p.limit), last = p.last;
    const hist = p.vals.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
    const xEnd = x1, dEnd = total - iT;
    const upper = Y(last + (p.limit - last) / Math.max(0.5, p.daysLo) * dEnd), lower = Y(last + (p.limit - last) / p.daysHi * dEnd);
    const xHit = X(iT + p.days), u = p.unit;
    const range = E.t('e14.p.range', { lo: p.daysLo, hi: p.daysHi });
    return `<svg class="p14cone" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(E.t('e14.p.chartLbl', { point: lc(E, p.point), d: p.lookbackD, range }))}">
      <line x1="${x0}" y1="${yL.toFixed(1)}" x2="${x1}" y2="${yL.toFixed(1)}" class="p14lim"/>
      <text x="${x0 + 4}" y="${(yL - 8).toFixed(1)}" class="p14limt">${esc(E.t('e14.p.limit', { v: fmt(p.limit, 0), u }))}</text>
      <line x1="${xT.toFixed(1)}" y1="${yTop}" x2="${xT.toFixed(1)}" y2="${H - 15}" class="p14today"/>
      <text x="${(xT + 6).toFixed(1)}" y="${H - 20}" class="p14ax">${esc(E.t('e14.p.today'))}</text>
      <polygon class="cone" points="${xT.toFixed(1)},${Y(last).toFixed(1)} ${xEnd},${Math.max(0, upper).toFixed(1)} ${xEnd},${lower.toFixed(1)}"/>
      <line x1="${xT.toFixed(1)}" y1="${Y(last).toFixed(1)}" x2="${xHit.toFixed(1)}" y2="${yL.toFixed(1)}" class="p14proj"/>
      <polyline points="${hist}" class="p14hist"/>
      <circle cx="${xT.toFixed(1)}" cy="${Y(last).toFixed(1)}" r="5" class="p14dotH"/>
      <circle cx="${xHit.toFixed(1)}" cy="${yL.toFixed(1)}" r="5" class="p14dotP"/>
      <text x="${Math.min(xHit - 40, x1 - 110).toFixed(1)}" y="${(yL + 34).toFixed(1)}" class="p14rng">${esc(range)}</text>
      <text x="${x0}" y="${H - 4}" class="p14ax">${esc(E.t('e14.p.ago', { d: p.lookbackD }))}</text>
    </svg>`;
  }

  /* --------------------------- the prediction (mock 2) --------------------------- */
  function predictPage(E){
    const t = E.t.bind(E), id = predAsset(E);
    const back = `<button class="e14back" data-act="e14Back">${C().dicon('start', 12)}${esc(t('e14.back'))}</button>`;
    if(!id) return `<div class="pwarea p14page" data-frame="off">${back}<p class="p14none">${esc(t('e14.p.none'))}</p></div>`;
    const p = PV().predictFor(E, id).find(x => x.state === 'drift'), a = asset(E, id), w = openWo(E, id), al = alarmOf(E, id);
    const pct = Math.min(100, Math.round(p.last / p.limit * 100)), u = p.unit, n = Math.round(p.days);
    const dueD = w && w.dueH != null ? Math.max(0, Math.round(w.dueH / 24)) : null;
    const task = w ? lc(E, L(E, w.taskEn, w.taskAr)) : '';
    /* the sentence: built by code from the fit and the work order */
    const fix = !w ? t('e14.p.sFixNone') : dueD != null && dueD < p.days ? t('e14.p.sFixBefore', { task, wo: w.id, d: dueD }) : dueD != null ? t('e14.p.sFixAfter', { wo: w.id, d: dueD }) : t('e14.p.sFixOpen', { wo: w.id });
    const sentence = t('e14.p.sentence', { point: lc(E, p.point), d: p.lookbackD, n }) + ' ' + fix;
    const v = proofs(E).find(x => x.outcome === 'recovered') || proofs(E)[0];
    const step = (k, txt, cls, act) => act ? `<button class="p14step${cls ? ' ' + cls : ''}" data-act="${act[0]}" data-v="${esc(act[1] || '')}"><span class="p14k">${esc(t('e14.chain.' + k))}</span><span class="p14s">${esc(txt)}</span></button>`
      : `<div class="p14step${cls ? ' ' + cls : ''}"><span class="p14k">${esc(t('e14.chain.' + k))}</span><span class="p14s">${esc(txt)}</span></div>`;
    const chain = [
      step('detect', al ? t('e14.p.detect', { what: L(E, al.plainEn, al.plainAr), age: E.fmtAge(al.ageH) }) : t('e14.p.detectNone', { d: p.lookbackD }), 'p14det'),
      step('predict', t('e14.p.chainPred', { n, lo: p.daysLo, hi: p.daysHi }), 'p14pred'),
      step('fix', w ? (dueD != null ? t('e14.p.chainFix', { task: L(E, w.taskEn, w.taskAr), wo: w.id, st: woState(E, w), d: dueD }) : t('e14.p.chainFixNoDue', { task: L(E, w.taskEn, w.taskAr), wo: w.id, st: woState(E, w) })) : t('e14.p.chainFixNone'), 'p14fix'),
      step('prove', v ? t('e14.p.chainProve', { wo: w ? w.id : t('e14.p.theWo'), a: v.asset }) : t('e14.p.chainProveNone', { wo: w ? w.id : t('e14.p.theWo') }), 'p14prove', v ? ['e14Prove', v.asset] : null)
    ].join('');
    return `<div class="pwarea p14page" data-frame="off" data-pg="predict">
      ${back}
      <div class="p14wrap">
        <section class="p14card p14predc" aria-label="${esc(t('e14.chain.predict') + ' ' + id)}">
          <div class="p14head"><span class="p14kind">${esc(t('e14.chain.predict'))}</span><span class="p14ctx">${esc(id + t('cu.lblSep') + ctxOf(E, a))}</span><span class="grow"></span>
            <span class="p14fit tMonoS" data-tip="${esc(p.fitCriterion)}">${esc(t('e14.p.fit', { d: p.lookbackD, r2: fmt(p.r2, 2) }))}</span></div>
          <div class="p14fig">
            <div><div class="p14days">${esc(fmt(n, 0))} <span>${esc(t(n === 1 ? 'e14.p.day' : 'e14.p.days'))}</span></div>
              <div class="p14until">${esc(t('e14.p.until', { point: lc(E, p.point), lo: p.daysLo, hi: p.daysHi }))}</div></div>
            <div class="p14bar"><div class="p14barl tMonoS"><span>${esc(t('e14.p.now', { v: fmt(p.last, 0), u }))}</span><span>${esc(t('e14.p.limit', { v: fmt(p.limit, 0), u }))}</span></div>
              <div class="p14bart" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(t('e14.p.used', { n: pct }))}"><i style="width:${pct}%"></i></div>
              <div class="p14barc">${esc(t('e14.p.used', { n: pct }))}</div></div>
          </div>
          ${cone(E, p)}
          <p class="p14sent">${esc(sentence)}</p>
          <div class="p14acts">${w ? `<button class="btnP" data-act="woOpen" data-asset="${esc(id)}">${esc(t('e14.p.openWo', { wo: w.id }))}</button>` : ''}
            <button class="btnG" data-act="e14Model" data-asset="${esc(id)}">${esc(t('e14.p.showModel', { a: id }))}</button>${siteBtn(E, 'pred')}</div>
        </section>
        <aside class="p14aside"><div class="p14lbl">${esc(t('e14.p.chainT', { a: id }))}</div>${chain}${siteBox(E, 'pred')}</aside>
      </div></div>`;
  }

  /* ------------------------- the before and after (mock 3) ------------------------- */
  function baChart(E, v){
    const W = 800, H = 260, x0 = 40, x1 = 760, yTop = 20, yBot = 222;
    const all = v.before.concat(v.after), n = all.length;
    const lo = Math.min(0, ...all, v.band[0]), hi = Math.max(...all, v.limit) * 1.15, span = (hi - lo) || 1;
    const X = i => x0 + (i / Math.max(1, n - 1)) * (x1 - x0), Y = val => yBot - ((val - lo) / span) * (yBot - yTop);
    const nb = v.before.length, xFix = X(nb - 0.5), u = v.unit;
    const bPts = v.before.map((val, i) => X(i).toFixed(1) + ',' + Y(val).toFixed(1)).join(' ');
    const aPts = [X(nb - 1).toFixed(1) + ',' + Y(v.before[nb - 1]).toFixed(1)].concat(v.after.map((val, i) => X(nb + i).toFixed(1) + ',' + Y(val).toFixed(1))).join(' ');
    const yB0 = Y(v.band[0]), yB1 = Y(v.band[1]), yL = Y(v.limit);
    return `<svg class="p14ba" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(E.t('e14.v.chartLbl', { point: lc(E, v.point) }))}">
      <rect x="${x0}" y="${yB1.toFixed(1)}" width="${x1 - x0}" height="${(yB0 - yB1).toFixed(1)}" class="p14band"/>
      <text x="${x0 + 6}" y="${(yB1 + 16).toFixed(1)}" class="p14bandt">${esc(E.t('e14.v.band', { lo: fmt(v.band[0], 0), hi: fmt(v.band[1], 0), u }))}</text>
      <line x1="${x0}" y1="${yL.toFixed(1)}" x2="${x1}" y2="${yL.toFixed(1)}" class="p14lim"/>
      <text x="${x0 + 6}" y="${(yL - 8).toFixed(1)}" class="p14limt">${esc(E.t('e14.v.alarm', { v: fmt(v.limit, 1), u }))}</text>
      <line x1="${xFix.toFixed(1)}" y1="${yTop}" x2="${xFix.toFixed(1)}" y2="${H - 15}" class="p14fixl"/>
      <text x="${(xFix + 7).toFixed(1)}" y="34" class="p14fixt">${esc(E.t('e14.v.closed', { wo: v.wo || '' }))}</text>
      <polyline points="${bPts}" class="p14bef"/><polyline points="${aPts}" class="p14aft"/>
      <text x="${(x0 + (xFix - x0) * 0.35).toFixed(1)}" y="${Math.max(16, Y(Math.max(...v.before)) - 14).toFixed(1)}" class="p14beft">${esc(E.t('e14.v.before', { v: fmt(v.beforeMean, 1), u }))}</text>
      <text x="${(xFix + (x1 - xFix) * 0.3).toFixed(1)}" y="${Math.min(yBot - 4, Y(Math.min(...v.after)) + 28).toFixed(1)}" class="p14aftt">${esc(E.t('e14.v.after', { v: fmt(v.afterMean, 1), u }))}</text>
      <text x="${x0}" y="${H - 4}" class="p14ax">${esc(E.t('e14.p.ago', { d: n }))}</text>
      <text x="${x1 - 40}" y="${H - 4}" class="p14ax">${esc(E.t('e14.p.today'))}</text>
    </svg>`;
  }
  function provePage(E){
    const t = E.t.bind(E), id = proofAsset(E);
    const back = `<button class="e14back" data-act="e14Back">${C().dicon('start', 12)}${esc(t('e14.back'))}</button>`;
    if(!id) return `<div class="pwarea p14page" data-frame="off">${back}<p class="p14none">${esc(t('e14.v.none'))}</p></div>`;
    const v = PV().verifiedFor(E, id)[0], a = asset(E, id), u = v.unit, rec = v.outcome === 'recovered';
    const inBand = v.afterMean <= v.band[1];
    const text = t('e14.v.text', { point: lc(E, v.point), b: fmt(v.beforeMean, 1), a: fmt(v.afterMean, 1), u, wo: v.wo || t('e14.p.theWo'), d: v.fixedDaysAgo })
      + ' ' + t(inBand ? 'e14.v.inBand' : 'e14.v.outBand', { lo: fmt(v.band[0], 0), hi: fmt(v.band[1], 0), u });
    const onset = v.before.length + v.after.length;
    const cause = E.sim && E.sim.cfg && E.sim.cfg.faults ? Object.values(E.sim.cfg.faults).find(f => f && f.asset === id && f.wo === v.wo) : null;
    const step = (k, txt, cls) => `<div class="p14step${cls ? ' ' + cls : ''}"><span class="p14k">${esc(t('e14.chain.' + k))}</span><span class="p14s">${esc(txt)}</span></div>`;
    const chain = step('detect', t('e14.v.detect', { point: v.point, d: cause && cause.onsetAgoD ? cause.onsetAgoD : onset }), 'p14det')
      + (cause ? step('cause', t('e14.v.cause', { c: t('e14.cause.' + id) !== 'e14.cause.' + id ? t('e14.cause.' + id) : cause.cause }), 'p14det') : '')
      + step('fix', t('e14.v.fix', { wo: v.wo || t('e14.p.theWo'), d: v.fixedDaysAgo }), 'p14det')
      + step('prove', t('e14.v.prove.' + v.outcome, { d: v.fixedDaysAgo }), rec ? 'p14ok' : 'p14det');
    return `<div class="pwarea p14page" data-frame="off" data-pg="prove">
      ${back}
      <div class="p14wrap">
        <section class="p14card p14proof" data-out="${esc(v.outcome)}" aria-label="${esc(t('e14.chain.prove') + ' ' + id)}">
          <div class="p14head"><span class="p14kind">${esc(t('e14.chain.prove'))}</span><span class="p14ctx">${esc(id + t('cu.lblSep') + ctxOf(E, a))}</span><span class="grow"></span>
            <span class="p14fit tMonoS" data-tip="${esc(v.basisText)}">${esc(t('e14.v.method', { n: v.before.length, m: v.after.length }))}</span></div>
          <div class="p14fig p14figv">
            <div class="p14seal" data-out="${esc(v.outcome)}">${rec ? icon('check', 26) : ''}<span>${esc(PV().outcomeLbl(E, v))}</span></div>
            <p class="p14sent">${esc(text)}</p>
          </div>
          ${baChart(E, v)}
          <div class="p14acts">${v.wo ? `<button class="btnG" data-act="woOpen" data-asset="${esc(id)}">${esc(t('e14.p.openWo', { wo: v.wo }))}</button>` : ''}${siteBtn(E, 'prove')}</div>
        </section>
        <aside class="p14aside"><div class="p14lbl">${esc(t('e14.v.chainT'))}</div>${chain}${siteBox(E, 'prove')}</aside>
      </div></div>`;
  }

  /* the drawer's Predict tab (mock 5): the prediction and the proof for this asset, each opening its page */
  function predictTab(E, id){
    const t = E.t.bind(E), out = [];
    const p = PV() ? PV().predictFor(E, id)[0] : null, v = PV() ? PV().verifiedFor(E, id)[0] : null;
    if(p && p.state === 'drift') out.push(`<button class="p14link" data-act="e14Predict" data-v="${esc(id)}"><span class="p14k">${esc(t('e14.chain.predict'))}</span>
      <span class="p14lt">${esc(t('e14.tab.pred', { point: p.point, n: Math.round(p.days), lo: p.daysLo, hi: p.daysHi }))}</span><span class="p14lc">${esc(t('e14.tab.openPred'))}</span></button>`);
    else if(p) out.push(`<div class="p14link" data-k="none"><span class="p14k">${esc(t('e14.chain.predict'))}</span><span class="p14lt">${esc(p.point + t('cu.lblSep') + t(p.state === 'past' ? 'pv.pastLimit' : 'pv.noTrend'))}</span><span class="p14lc">${esc(p.fitCriterion)}</span></div>`);
    if(v) out.push(`<button class="p14link" data-k="prove" data-act="e14Prove" data-v="${esc(id)}"><span class="p14k">${esc(t('e14.chain.prove'))}</span>
      <span class="p14lt">${esc(PV().outcomeLbl(E, v) + t('cu.lblSep') + t('e14.tab.prove', { point: lc(E, v.point), b: fmt(v.beforeMean, 1), a: fmt(v.afterMean, 1), u: v.unit }))}</span><span class="p14lc">${esc(t('e14.tab.openProve'))}</span></button>`);
    return out.length ? `<div class="p14links">${out.join('')}</div>` : `<p class="apempty">${esc(t('e14.tab.none'))}</p>`;
  }
  /* the engineer's landing carries both, one click each */
  function engineerLinks(E){
    const t = E.t.bind(E), d = drifts(E)[0], v = proofs(E).find(x => x.outcome === 'recovered');
    if(!d && !v) return '';
    return `<div class="p14eng">${d ? `<button class="p14chip" data-k="pred" data-act="e14Predict" data-v="${esc(d.asset)}"><b>${esc(t('e14.chain.predict'))}</b> ${esc(t('e14.eng.pred', { a: d.asset, n: Math.round(d.days) }))}</button>` : ''}
      ${v ? `<button class="p14chip" data-k="prove" data-act="e14Prove" data-v="${esc(v.asset)}"><b>${esc(t('e14.chain.prove'))}</b> ${esc(t('e14.eng.prove', { a: v.asset, out: lc(E, PV().outcomeLbl(E, v)) }))}</button>` : ''}</div>`;
  }

  const ACTS = {
    e14Site(el){ const E = window.EKO, k = el.dataset.v; E.state.site14 = Object.assign({}, E.state.site14, { [k]: !open(E, k) }); E.set({}); },
    e14Predict(el){ const E = window.EKO; E.state.p14Asset = el.dataset.v || null; E.go('predict', 'systems', E.state.module === 'systems' ? E.state.sub : null); },
    e14Prove(el){ const E = window.EKO; E.state.p14Proof = el.dataset.v || null; E.go('prove', 'systems', E.state.module === 'systems' ? E.state.sub : null); },
    e14Back(){ const E = window.EKO, p = E.state._prev; if(p && p.pageId && p.pageId !== E.state.pageId && !['predict', 'prove'].includes(p.pageId)) E.go(p.pageId, p.module, p.sub); else E.go('systems', 'systems', 'hvac'); },
    /* show the asset on a page with the model: the Overview, the drawer open on it */
    e14Model(el){ const E = window.EKO, id = el.dataset.asset; E.go(E.overviewId(), 'overview', null);
      setTimeout(() => { if(E.runAct) E.runAct('openAsset', { asset: id }); }, 60); }
  };
  return { siteBtn, siteBox, predictPage, provePage, predictTab, engineerLinks, cone, ACTS, open };
})();
