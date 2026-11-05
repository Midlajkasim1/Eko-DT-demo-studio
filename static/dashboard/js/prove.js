/* ============================================================================
   PROVE AND PREDICT (D161) — EKO_PROVE.

   The chain competitors leave open: detect → prevent → predict → PROVE. This
   module holds the four capabilities and nothing renders a figure it did not
   compute:

     1. PROVED — a work order that resolved a recommendation or an alarm closes;
        the reading that triggered it is re-checked over a window before the fix
        against a window after it, weather-normalised, and the outcome is
        Recovered · Partly recovered · Not recovered · Too early to tell.
     2. PREDICTED — a reading drifting toward its alarm limit is projected to it
        by a linear fit over the lookback, reported as a RANGE, never a date.
     3. THE LEDGER — recommendations open longer than the threshold, with the
        cost of delay so far: the stated impact per day times the days open.
     4. THE ROLL-UP — verified savings this month, the sum of the Recovered and
        Partly recovered results, each traceable to its fix.

   THE LAW (unchanged): the data layer computes every figure; the model never
   does. Every figure states its method, its window and its basis; every AED
   goes through the ONE tariff record and carries its provisional tag. No
   machine-learning claim is made anywhere: this is a linear fit and a stated
   normalisation, and the words say so.

   PROTOTYPE: every input is a clearly marked stand-in fixture (data.prove,
   data.verified, data.readingHistory). handoff/prove.md documents what
   production needs — CMMS closure events, retained reading history, weather
   for the normalisation, the tariff record — and the claims we may make.
   ============================================================================ */
window.EKO_PROVE = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = s => C().esc(s);
  const fmt = (v, d) => C().fmt(v, d);
  const cfg = app => Object.assign({ beforeDays: 14, afterDays: 14, minAfterDays: 3, ledgerAfterDays: 3,
    normalisation: { method: 'coolingDegreeDays', standIn: true },
    verify: { uncK: 2 },
    predict: { lookbackD: 30, maxRangeFrac: 1, warnWithinD: 14 } }, (app.data || {}).prove || {});
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

  /* ------------------------------ 1. PROVED --------------------------------
     before: the reading over beforeDays up to the fix · after: the same reading
     over afterDays from the fix, adjusted by the stated normalisation (in the
     prototype a cooling-degree-day ratio, marked as a stand-in). The outcome is
     the improvement (before mean minus adjusted after mean) against its UNCERTAINTY BAND,
     and the adjusted after-mean against the reading's normal band (D172):
       after window not complete                          → tooEarly
       improvement inside the uncertainty band            → not recovered (a fix that
                                                            did not work is a new problem)
       improvement beyond it, after-mean inside normal    → recovered
       improvement beyond it, after-mean still outside    → partly
     The uncertainty band is uncK (2) standard errors of the difference of the two
     means (about 95 percent), from the day-to-day scatter of each window. Daily
     readings are correlated with the day before, so each window counts as its
     EFFECTIVE number of independent days, n(1 - r)/(1 + r) with r its lag-1
     autocorrelation (the correction used in ASHRAE Guideline 14); counting every
     day as independent would make the band too narrow. No fixed share of the
     excess decides anything.                                                     */
  const sd = a => { if(a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
  const lag1 = a => { const m = mean(a); let num = 0, den = 0; for(let i = 0; i < a.length; i++){ den += (a[i] - m) ** 2; if(i) num += (a[i] - m) * (a[i - 1] - m); } return den ? num / den : 0; };
  const nEff = a => { const r = Math.max(0, lag1(a)); return Math.max(2, a.length * (1 - r) / (1 + r)); };
  function verifyOne(app, v){
    const c = cfg(app), t = (k, p) => app.t(k, p);
    const before = (v.before || []).slice(), after = (v.after || []).slice();
    const bMean = mean(before), aRaw = mean(after);
    /* the stand-in normalisation: the after window is scaled by the ratio of the
       cooling-degree days of the two windows, so a cooler month cannot look like a fix */
    const norm = v.cddBefore && v.cddAfter ? v.cddBefore / v.cddAfter : 1;
    const aMean = aRaw * norm;
    const afterDays = v.afterDaysAvailable != null ? v.afterDaysAvailable : after.length;
    const band = v.band || [0, v.limit];
    const inBand = aMean <= band[1];
    const improvement = bMean - aMean;
    const adjAfter = after.map(x => x * norm);
    const unc = adjAfter.length < 2 ? Infinity : (c.verify.uncK || 2) * Math.sqrt(sd(before) ** 2 / nEff(before) + sd(adjAfter) ** 2 / nEff(adjAfter));
    const outcome = afterDays < c.minAfterDays ? 'tooEarly' : !(improvement > unc) ? 'notRecovered' : inBand ? 'recovered' : 'partly';
    /* the saving: the reading's change priced through the ONE tariff, only where the
       fixture states the energy relationship; otherwise the recovery stands alone */
    const tb = C().tariffBasis(app);
    const delta = bMean - aMean;
    const kwhMo = v.kwhPerUnitDay && delta > 0 ? delta * v.kwhPerUnitDay * 30 : null;
    const aedMo = kwhMo != null && tb ? kwhMo * tb.rate : null;
    const methodText = t('pv.method', { n: c.beforeDays, m: c.afterDays, norm: t('pv.norm.' + (c.normalisation.method || 'none')) })
      + (c.normalisation.standIn ? ' ' + t('pv.standIn') : '');
    return { id: v.id, asset: v.asset, alarm: v.alarm || null, wo: v.wo || null, rec: v.rec || null, standIn: !!v.standIn,
      verifiedH: v.verifiedH != null ? v.verifiedH : null,   /* when the after-window closed (the Brief places it) */
      point: app.lang === 'ar' ? (v.pointAr || v.point) : v.point, unit: v.unit || '', limit: v.limit, band,
      fixedDaysAgo: v.fixedDaysAgo, outcome, before, after, beforeMean: bMean, afterMean: aMean, afterRaw: aRaw, norm, improvement, uncertainty: unc,
      delta, deltaPct: bMean ? (delta / bMean) * 100 : 0, afterDays,
      kwhMo, aedMo, tariff: tb, methodText,
      basisText: [methodText, tb && aedMo != null ? C().kwhBasis(app, kwhMo, tb) : null].filter(Boolean).join(app.t('cu.lblSep')) };
  }
  const verified = app => ((app.data || {}).verified || []).map(v => verifyOne(app, v));
  const verifiedFor = (app, assetId) => verified(app).filter(v => v.asset === assetId);

  /* ---------------------------- 2. PREDICTED -------------------------------
     A least-squares line over the lookback, projected to the alarm limit. The
     range of days comes from the fit's prediction interval (the reading's scatter
     and the standard error of the slope, ±1 standard error), so the reader sees a
     band, never a date. THE GATE (D172): a prediction shows only when the slope
     carries the reading toward the limit and the range is narrower than
     prove.predict.maxRangeFrac (1) times its centre; "7 days, 6 to 9" shows, "7
     days, 2 to 40" is "no reliable trend". R² is reported, never the gate. */
  function fit(vals){
    const n = vals.length, xs = vals.map((_, i) => i);
    const mx = mean(xs), my = mean(vals);
    let sxy = 0, sxx = 0, syy = 0;
    for(let i = 0; i < n; i++){ sxy += (xs[i] - mx) * (vals[i] - my); sxx += (xs[i] - mx) ** 2; syy += (vals[i] - my) ** 2; }
    const slope = sxx ? sxy / sxx : 0, intercept = my - slope * mx;
    const r2 = syy ? (sxy * sxy) / (sxx * syy) : 0;
    /* standard error of the slope, for the range */
    let ss = 0; for(let i = 0; i < n; i++){ const e = vals[i] - (intercept + slope * xs[i]); ss += e * e; }
    const sigma = n > 2 ? Math.sqrt(ss / (n - 2)) : 0;            /* the reading's own scatter */
    const se = n > 2 && sxx ? Math.sqrt((ss / (n - 2)) / sxx) : 0; /* the standard error of the slope */
    return { slope, intercept, r2, se, sigma, n };
  }
  function predictOne(app, s){
    const c = cfg(app).predict, t = (k, p) => app.t(k, p);
    const vals = (s.vals || []).slice(), n = vals.length;
    const limit = s.limit, last = vals[n - 1];
    const f = fit(vals);
    const perDay = f.slope * (s.stepD || 1);
    const crit = t('pv.fitCrit', { frac: fmt(c.maxRangeFrac, 2), r2: fmt(f.r2, 2), n: n, d: Math.round(n * (s.stepD || 1)) });
    const base = { asset: s.asset, point: app.lang === 'ar' ? (s.pointAr || s.point) : s.point, pointShort: s.pointShort ? (app.lang === 'ar' ? (s.pointShortAr || s.pointShort) : s.pointShort) : null, unit: s.unit || '', limit,
      vals, stepD: s.stepD || 1, last, r2: f.r2, slopePerDay: perDay, standIn: !!s.standIn, fitCriterion: crit,
      lookbackD: Math.round(n * (s.stepD || 1)) };
    if(last >= limit) return Object.assign(base, { state: 'past' });                       /* already an alarm, not a prediction */
    if(perDay <= 0) return Object.assign(base, { state: 'noTrend' });                     /* moving away from the limit */
    const days = (limit - last) / perDay;
    /* the range: the scatter of the reading and the error of the slope, carried to the crossing */
    const sdD = Math.sqrt((f.sigma / perDay) ** 2 + (days * f.se * (s.stepD || 1) / perDay) ** 2);
    const dLo = Math.max(0, days - sdD), dHi = days + sdD;
    const daysLo = Math.max(1, Math.round(dLo)), daysHi = Math.round(Math.min(dHi, 999));
    /* the gate, on the range the reader would see: narrower than maxRangeFrac times its centre */
    if(!(daysHi - daysLo < (c.maxRangeFrac != null ? c.maxRangeFrac : 1) * days)) return Object.assign(base, { state: 'noTrend', days, daysLo, daysHi });
    /* TWO figures, and they are not the same thing (D162): what the drift costs PER DAY NOW —
       the reading's excess over its normal band, priced at the tariff — and how fast that daily
       cost is RISING. Without a stated band there is no "now", so only the rise is said. */
    const tbp = C().tariffBasis(app);
    const bandTop = Array.isArray(s.band) ? s.band[1] : null;
    const cost = s.kwhPerUnitDay && tbp ? {
      risePerDay: perDay * s.kwhPerUnitDay * tbp.rate,
      nowPerDay: bandTop != null ? Math.max(0, last - bandTop) * s.kwhPerUnitDay * tbp.rate : null,
      excess: bandTop != null ? Math.max(0, last - bandTop) : null, bandTop,
      basis: [C().kwhBasis(app, (bandTop != null ? Math.max(0, last - bandTop) : perDay) * s.kwhPerUnitDay, tbp),
              app.t('pv.costBasis', { band: bandTop != null ? C().fmt(bandTop, 1) : app.t('emptyDash'), u: s.unit || '', k: C().fmt(s.kwhPerUnitDay, 0) })].join(app.t('cu.lblSep'))
    } : null;
    return Object.assign(base, { state: 'drift', days, daysLo, daysHi, cost });
  }
  const predictions = app => (((app.data || {}).readingHistory || {}).series || []).map(s => predictOne(app, s));
  const predictFor = (app, assetId) => predictions(app).filter(p => p.asset === assetId);

  /* ------------------------------ 3. THE LEDGER ----------------------------
     Every recommendation still open after ledgerAfterDays, with the cost of
     delay so far: the alarm's STATED impact per day times the days open. Sums of
     stated figures only — nothing is modelled here. It is about the advice, not
     the person: no name appears in the total, and the assignee only on the row
     that is opened. Visible to `canSeeTeamBrief` (managers and executives). */
  function ledger(app){
    const c = cfg(app), B = window.EKO_BRIEF;
    if(!B) return null;
    const tb = C().tariffBasis(app);
    const rows = (B.memory() || []).map(r => {
      const openH = (Date.now() - r.issuedAt) / 36e5, days = openH / 24;
      if(days < c.ledgerAfterDays) return null;
      const a = r.subject && r.subject.kind === 'alarm' ? (app.data.alarms || []).find(x => x.id === r.subject.id) : null;
      if(!a || a.ack) return null;                       /* resolved advice leaves the ledger */
      const perDay = a.impactAedMo ? a.impactAedMo / 30 : 0;
      /* the row says what the advice is about in the READER'S language: the stored reason is
         the English the Brief issued, so the alarm's own plain line is used instead (D161) */
      const reason = app.lang === 'ar' ? (a.plainAr || a.plainEn) : a.plainEn;
      return { rec: r.id, asset: r.asset, alarm: a.id, sev: a.sev, reason, reasonIssued: r.reason, days: Math.floor(days),
        perDay, aed: perDay * Math.floor(days), assignee: r.issuedTo ? r.issuedTo.user : null,
        impactAedMo: a.impactAedMo || 0 };
    }).filter(Boolean).sort((x, y) => y.aed - x.aed);
    const total = rows.reduce((n, r) => n + r.aed, 0);
    return { rows, total, sinceDays: c.ledgerAfterDays, tariff: tb,
      basisText: [app.t('pv.ledgerMethod', { n: c.ledgerAfterDays }), app.t('rpSrc.modelOpt'), tb ? tb.text : null].filter(Boolean).join(app.t('cu.lblSep')) };
  }
  const canSeeLedger = app => !!(app.can && app.can('canSeeTeamBrief'));

  /* ------------------------------ 4. THE ROLL-UP ---------------------------
     Verified savings this month: the sum of the Recovered and Partly recovered
     results whose fix falls inside the month, each traceable to its fix. */
  function rollup(app){
    const list = verified(app).filter(v => (v.outcome === 'recovered' || v.outcome === 'partly') && v.aedMo != null && v.fixedDaysAgo <= 31);
    const tb = C().tariffBasis(app);
    return { aed: list.reduce((n, v) => n + v.aedMo, 0), n: list.length, fixes: list, tariff: tb,
      basisText: [app.t('pv.rollupMethod'), tb ? tb.text : null].filter(Boolean).join(app.t('cu.lblSep')) };
  }

  /* -------------------------------- rendering ------------------------------
     Two small charts, drawn from the same numbers the text states: the
     before/after chart (with the alarm limit and the fix marked) and the
     projection (history, dashed projection, the range as a band, the limit). */
  function baChart(v, w, h){
    const all = v.before.concat(v.after).concat([v.limit]);
    const mn = Math.min(...all), mx = Math.max(...all), span = (mx - mn) || 1;
    const pad = 6, W = w || 240, H = h || 56;
    const x = i => pad + (i / (v.before.length + v.after.length - 1)) * (W - pad * 2);
    const y = val => H - pad - ((val - mn) / span) * (H - pad * 2);
    const pts = arr => arr.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const bPts = v.before.map((val, i) => [x(i), y(val)]);
    const aPts = v.after.map((val, i) => [x(v.before.length + i), y(val)]);
    const fx = x(v.before.length - 0.5);
    return `<svg class="pvchart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-hidden="true">
      <line class="pvlim" x1="${pad}" x2="${W - pad}" y1="${y(v.limit).toFixed(1)}" y2="${y(v.limit).toFixed(1)}"/>
      <line class="pvfix" x1="${fx.toFixed(1)}" x2="${fx.toFixed(1)}" y1="2" y2="${H - 2}"/>
      <polyline class="pvbefore" points="${pts(bPts)}"/>
      <polyline class="pvafter" points="${pts(aPts)}"/></svg>`;
  }
  function projChart(p, w, h){
    const W = w || 240, H = h || 56, pad = 6;
    const days = p.days != null ? Math.min(p.days, p.vals.length) : 0;
    const total = p.vals.length + (p.state === 'drift' ? Math.min(p.daysHi, p.vals.length) : 0);
    const all = p.vals.concat([p.limit]);
    const mn = Math.min(...all), mx = Math.max(...all), span = (mx - mn) || 1;
    const x = i => pad + (i / Math.max(1, total - 1)) * (W - pad * 2);
    const y = val => H - pad - ((val - mn) / span) * (H - pad * 2);
    const hist = p.vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    let proj = '', band = '';
    if(p.state === 'drift'){
      const i0 = p.vals.length - 1, last = p.last;
      const iLo = i0 + Math.min(p.daysLo, total - i0), iHi = i0 + Math.min(p.daysHi, total - i0);
      proj = `<polyline class="pvproj" points="${x(i0).toFixed(1)},${y(last).toFixed(1)} ${x(iHi).toFixed(1)},${y(p.limit).toFixed(1)}"/>`;
      band = `<polygon class="pvband" points="${x(i0).toFixed(1)},${y(last).toFixed(1)} ${x(iLo).toFixed(1)},${y(p.limit).toFixed(1)} ${x(iHi).toFixed(1)},${y(p.limit).toFixed(1)}"/>`;
    }
    return `<svg class="pvchart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-hidden="true">
      <line class="pvlim" x1="${pad}" x2="${W - pad}" y1="${y(p.limit).toFixed(1)}" y2="${y(p.limit).toFixed(1)}"/>
      ${band}${proj}<polyline class="pvhist" points="${hist}"/></svg>`;
  }
  /* the words for an outcome, and the one-line summary the Brief and the panel share */
  const outcomeLbl = (app, v) => app.t('pv.out.' + v.outcome);
  /* D173: why the outcome was given: the improvement against its uncertainty band */
  const uncLine = (app, v) => { const o = outcomeLbl(app, v); return app.t('pv.uncLine', { imp: fmt(v.improvement, 3), unc: fmt(v.uncertainty, 3), out: app.lang === 'ar' ? o : o.charAt(0).toLowerCase() + o.slice(1) }); };
  function summaryText(app, v){
    const t = (k, p) => app.t(k, p);
    /* E14c: AED only for a role that sees money (the executive, the facility manager), as costLine */
    const r = app.role ? app.role() : '', mOk = r === 'executive' || r === 'manager';
    const money = mOk && v.aedMo != null ? t('pv.saving', { aed: fmt(v.aedMo, 0) }) + (v.tariff && /provisional/i.test(v.tariff.text) ? ' ' + t('rpB.prov') : '') : null;
    const move = t('pv.change', { point: v.point, a: fmt(v.beforeMean, 1), b: fmt(v.afterMean, 1), u: v.unit });
    return [move, money].filter(Boolean).join(t('cu.lblSep'));
  }
  /* the Proved block: the chain, the chart, and the three figures */
  function provedBlock(app, v){
    const t = (k, p) => app.t(k, p);
    const chain = [t('pv.chain.rec'), v.wo ? t('pv.chain.wo', { wo: v.wo }) : null, t('pv.chain.done'), t('pv.chain.verified')].filter(Boolean).join(' › ');
    const fig = (lbl, val, tip) => `<span class="pvfig"${tip ? ` data-tip="${esc(tip)}"` : ''}><i>${esc(lbl)}</i><b class="tMonoS">${esc(val)}</b></span>`;
    /* E14c: the saving in AED for a money role only (E15: this note sat inside the template and printed on the page) */
    return `<article class="pvbox" data-out="${esc(v.outcome)}" data-tip="${esc(v.basisText)}">
      <span class="pvhead"><span class="pvkind">${esc(t('pv.proved'))}${esc(t('cu.lblSep'))}${esc(outcomeLbl(app, v))}</span>
        <span class="pvwhen tMonoS">${esc(t('pv.fixedAgo', { n: v.fixedDaysAgo }))}</span></span>
      <span class="pvchain">${esc(chain)}</span>
      ${baChart(v)}
      <span class="pvfigs">
        ${fig(t('pv.figChange'), fmt(v.beforeMean, 1) + ' → ' + fmt(v.afterMean, 1) + ' ' + v.unit, t('pv.figChangeTip', { n: v.before.length, m: v.after.length }))}
        ${v.aedMo != null ? ((app.role ? ['executive', 'manager'].includes(app.role()) : false) ? fig(t('pv.figSaving'), 'AED ' + fmt(v.aedMo, 0) + t('pv.perMonth'), v.basisText) : '') : fig(t('pv.figSaving'), t('pv.noEnergyLink'), t('pv.noEnergyLinkTip'))}
        ${fig(t('pv.figMethod'), t('pv.norm.' + (cfg(app).normalisation.method || 'none')), v.methodText)}
      </span>
      ${isFinite(v.uncertainty) ? `<span class="pvsub pvunc">${esc(uncLine(app, v))}</span>` : ''}
      ${v.standIn ? `<span class="pvstand">${esc(t('pv.standIn'))}</span>` : ''}</article>`;
  }
  /* the Predicted block: the history, the projection, the range, the limit */
  function predictedBlock(app, p){
    const t = (k, v) => app.t(k, v);
    const head = `<span class="pvhead"><span class="pvkind">${esc(t('pv.predicted'))}</span><span class="pvwhen tMonoS">${esc(t('pv.lookback', { d: p.lookbackD }))}</span></span>`;
    if(p.state !== 'drift'){
      return `<article class="pvbox" data-out="${esc(p.state)}" data-tip="${esc(p.fitCriterion)}">${head}
        <span class="pvtitle">${esc(p.point)}${esc(t('cu.lblSep'))}${esc(t(p.state === 'past' ? 'pv.pastLimit' : 'pv.noTrend'))}</span>
        <span class="pvsub">${esc(p.fitCriterion)}</span>${projChart(p)}
        ${p.standIn ? `<span class="pvstand">${esc(t('pv.standIn'))}</span>` : ''}</article>`;
    }
    const rangeTxt = t('pv.inDaysRange', { n: Math.round(p.days), lo: p.daysLo, hi: p.daysHi });
    return `<article class="pvbox" data-out="drift" data-tip="${esc(p.fitCriterion)}">${head}
      <span class="pvtitle">${esc(t('pv.crossIn', { point: p.point, limit: fmt(p.limit, 1), u: p.unit, range: rangeTxt }))}</span>
      <span class="pvsub">${esc(t('pv.fitLine', { r2: fmt(p.r2, 2), d: p.lookbackD }))}${costLine(app, p)}</span>
      ${projChart(p)}
      ${p.standIn ? `<span class="pvstand">${esc(t('pv.standIn'))}</span>` : ''}</article>`;
  }

  /* E13: AED only for a role that sees money (the executive, the facility manager); a rise that rounds to zero is not a rise */
  function costLine(app, p){
    const t = (k, v) => app.t(k, v), fmt = (v, d) => C().fmt(v, d), r = app.role ? app.role() : '';
    if(!p.cost || !(r === 'executive' || r === 'manager')) return '';
    const now = p.cost.nowPerDay != null && Math.round(p.cost.nowPerDay) > 0 ? fmt(p.cost.nowPerDay, 0) : null, rise = Math.round(p.cost.risePerDay || 0) > 0 ? fmt(p.cost.risePerDay, 0) : null;
    const s = now && rise ? t('pv.costNowRise', { now, rise }) : now ? t('pv.costNow', { now }) : rise ? t('pv.costRise', { rise }) : '';
    return s ? `<span data-tip="${C().esc(p.cost.basis)}">${C().esc(t('cu.lblSep') + s)}</span>` : '';
  }
  return { verified, verifiedFor, predictions, predictFor, ledger, canSeeLedger, rollup,
           provedBlock, predictedBlock, summaryText, outcomeLbl, baChart, projChart, fit, cfg };
})();
