/* ============================================================================
   ENERGY: SYSTEM BENCHMARK AND FORECASTING on the daily model (D182, specs 9 and 10).
   Used where the site has data.energyModel (js/energy-model.js); other sites keep
   the D180 pages in js/components/analytics.js.
   Benchmark answers: which system uses more than its design, by how much, since
   when, and why (its faults and work orders). Forecasting answers: where this
   month lands against budget, what the next two months need, whether the peak
   stays under the contracted maximum, and whether the forecast can be trusted.
   One colour rule for the chart, the table and the 3D: within 5 percent of design
   green, more than 5 over amber, more than 15 over red, more than 5 under blue.
   Money (AED) for executives only, and the partner where its switch allows.
   ============================================================================ */
window.EKO_EP = (function(){
  'use strict';
  const C = () => window.EKO_C, A = () => window.EKO_A, O = () => window.EKO_OPS, EM = () => window.EKO_EM;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d), icon = (n, s) => C().icon(n, s);
  const kwh = (v, d) => fmt(typeof v === 'number' && isFinite(v) ? v * 1000 : v, d);
  const L = (E, en, ar) => E.lang === 'ar' ? (ar || en) : en;
  const DAY = 86400000;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dLbl = (E, ms) => { const d = new Date(ms); return d.getDate() + ' ' + E.ph(MON[d.getMonth()]); };
  const MFULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const mFull = (E, ms) => E.lang === 'ar' ? E.ph(MON[new Date(ms).getMonth()]) : MFULL[new Date(ms).getMonth()];
  const mLbl = (E, ms) => { const d = new Date(ms); return E.ph(MON[d.getMonth()] + ' ' + d.getFullYear()); };
  const money = E => { const r = E.role(); return r === 'executive' || r === 'manager' || (r === 'partner' && window.EKO_ESG && window.EKO_ESG.moneyOk && window.EKO_ESG.moneyOk(E)); };
  const tone = (g, tol) => g == null ? 'none' : g > 15 ? 'red' : g > tol ? 'amber' : g < -tol ? 'blue' : 'green';
  const TONEC = { green: 'var(--pos)', amber: 'var(--warn)', red: 'var(--sevCrit)', blue: 'var(--link)' };
  const sysOf = (E, id) => (E.data.energyModel.systems || []).find(s => s.id === id) || { id };
  const sysName = (E, id) => { const s = sysOf(E, id); return L(E, s.en || id, s.ar); };

  /* ------------------------------ BENCHMARK ------------------------------ */
  function rows(E){
    const em = EM().of(E), M = em.mtd(E), tol = em.model.tolPct;
    return em.systems.map(s => { const a = M.actual[s.id], d = M.design[s.id], g = d ? (a - d) / d * 100 : null;
      const trend = []; for(let i = 13; i >= 0; i--){ const x = em.day(E, i); trend.push((x.actual[s.id] / x.design[s.id] - 1) * 100); }
      return { s, a, d, gapMwh: a - d, g, tone: tone(g, tol), onset: M.onset[s.id], trend }; }).sort((x, y) => (y.g || 0) - (x.g || 0));
  }
  function benchPage(E){
    const t = E.t.bind(E), em = EM().of(E), M = em.mtd(E), tol = em.model.tolPct, R = rows(E), aed = money(E), tariff = (E.data.basis || {}).aedPerKwh || 0;
    const now = E.nowMs(), period = mLbl(E, now);
    const worst = R[0];
    const hl = worst && worst.g > tol ? O().headline(E, t(worst.onset != null ? 'ep.bn.hl' : 'ep.bn.hlNoOnset', { s: sysName(E, worst.s.id), p: fmt(worst.g, 1), d: worst.onset != null ? dLbl(E, now - worst.onset * DAY) : '' }), worst.g > 15 ? 'alarm' : 'attn', { act: 'opsDrill', v: 'bnSys' }).replace('data-v="bnSys"', `data-v="bnSys" data-arg="${esc(worst.s.id)}"`)
      : O().headline(E, t('ep.bn.hlOk', { p: tol }), 'ok');
    const totG = M.designTotal ? (M.total - M.designTotal) / M.designTotal * 100 : null;
    const heroes = [O().hero(E, t('ep.bn.k.actual'), O().door(E, kwh(M.total, 0), 'bnTotal'), 'kWh', t('ep.bn.k.actualCap', { p: period, d: kwh(M.designTotal, 0) })),
      O().hero(E, t('ep.bn.k.gap'), (totG > 0 ? '+' : '') + fmt(totG, 1), '%', t('ep.bn.k.gapCap')),
      O().hero(E, t('ep.bn.k.over'), String(R.filter(r => r.g > tol).length), '', t('ep.bn.k.overCap', { p: tol, n: R.length })),
      O().hero(E, t('ep.bn.k.eui'), fmt(eui(E), 0), 'kWh/m²/yr', t('ep.bn.k.euiCap'))];
    const sg = g => g == null ? t('emptyDash') : (g > 0 ? '+' : g < 0 ? '−' : '') + fmt(Math.abs(g), 1) + '%';
    const spark = vals => { const mn = Math.min(...vals, -5), mx = Math.max(...vals, 5), W = 64, H = 18;
      return `<svg class="esgspark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><line x1="0" x2="${W}" y1="${(H - (0 - mn) / (mx - mn) * H).toFixed(1)}" y2="${(H - (0 - mn) / (mx - mn) * H).toFixed(1)}" stroke="var(--bd2)"/><polyline points="${vals.map((v, i) => (i / (vals.length - 1) * W).toFixed(1) + ',' + (H - (v - mn) / (mx - mn) * H).toFixed(1)).join(' ')}" fill="none" stroke="var(--domEnergy)" stroke-width="1.3"/></svg>`; };
    const trows = R.map(r => `<tr><th scope="row">${O().door(E, esc(sysName(E, r.s.id)), 'bnSys', r.s.id)}</th><td class="tMonoS">${kwh(r.d, 0)}</td><td class="tMonoS">${kwh(r.a, 0)}</td>
      <td class="tMonoS">${(r.gapMwh > 0 ? '+' : '') + kwh(r.gapMwh, 0)}</td><td><span class="bngap tMonoS" data-tone="${r.tone}">${esc(sg(r.g))}</span></td>
      <td><span class="eptone" data-tone="${r.tone}">${esc(t('ep.tone.' + r.tone, { p: tol }))}</span></td><td>${spark(r.trend)}</td>${aed ? `<td class="tMonoS">${esc('AED ' + fmt(r.gapMwh * 1000 * tariff, 0))}</td>` : ''}</tr>`).join('');
    const table = `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${['ep.c.sys', 'ep.c.design', 'ep.c.actual', 'ep.c.gapMwh', 'ep.c.gapPct', 'ep.c.status', 'ep.c.trend'].concat(aed ? ['ep.c.gapAed'] : []).map(k => `<th scope="col">${esc(t(k))}</th>`).join('')}</tr></thead><tbody>${trows}</tbody></table></div>`;
    /* the chart: actual bars, the design value as a marker line on each bar */
    const mx = Math.max(...R.map(r => Math.max(r.a, r.d) * 1000)) * 1.1, W = 960, rowH = 30, H = R.length * rowH + 30, X0 = 200, x = v => X0 + v / mx * (W - X0 - 16);
    const bars = R.map((r, i) => { const y = 8 + i * rowH;
      return `<text x="${X0 - 8}" y="${y + 15}" class="esgax" text-anchor="end">${esc(sysName(E, r.s.id))}</text>
        <rect x="${X0}" y="${y + 4}" width="${(x(r.a * 1000) - X0).toFixed(1)}" height="16" rx="2" fill="${TONEC[r.tone]}" opacity=".85"><title>${esc(sysName(E, r.s.id) + ': ' + kwh(r.a, 0) + ' kWh, ' + t('ep.c.design') + ' ' + kwh(r.d, 0) + ' kWh')}</title></rect>
        <line x1="${x(r.d * 1000).toFixed(1)}" x2="${x(r.d * 1000).toFixed(1)}" y1="${y}" y2="${y + 24}" class="epdesign"/>`; }).join('');
    const ax = [0, 0.5, 1].map(f => `<text x="${x(mx * f / 1.1).toFixed(1)}" y="${H - 4}" class="esgax" text-anchor="middle">${esc(fmt(mx * f / 1.1, 0))}</text>`).join('');
    const chart = `<svg class="esgchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('ep.bn.chartAria'))}">${bars}${ax}<text x="${W - 4}" y="${H - 4}" class="esgax" text-anchor="end">kWh</text></svg>
      <div class="row gap12 esgleg">${['green', 'amber', 'red', 'blue'].map(k => `<span><i class="eptonesw" data-tone="${k}"></i>${esc(t('ep.tone.' + k, { p: tol }))}</span>`).join('')}<span><i class="epdesignsw"></i>${esc(t('ep.bn.designMark'))}</span></div>`;
    const gm = {}; R.forEach(r => { const g = sysOf(E, r.s.id).group; if(g && (!gm[g] || Math.abs(r.g) > gm[g].a)) gm[g] = { a: Math.abs(r.g), c: TONEC[r.tone] }; });
    const gapMap = {}; Object.keys(gm).forEach(k => { gapMap[k] = gm[k].c; });
    const show3d = E.engine && E.engine.setGapColors ? `<div class="row gap8 bn3d"><button class="btnG btnSm" data-act="bnGap" data-v="${esc(JSON.stringify(gapMap))}">${esc(t('bn.show3d'))}</button><span class="tCap">${esc(t('bn.show3dCap'))}</span></div>` : '';
    const pv = (E.data.bench || {}).design ? E.data.bench.design.provenance : null;
    const prov = A().widget(E, t('bn.provT'), t('bn.provCap'), `<dl class="secdl bnprov"><dt>${esc(t('bn.prov.design'))}</dt><dd>${esc(pv ? L(E, pv.designEn, pv.designAr) : t('emptyDash'))}</dd>
      <dt>${esc(t('bn.prov.norm'))}</dt><dd>${esc(em.model.engine ? t('ep.bn.normE') : t('ep.bn.norm', { c: fmt(em.model.climate.designCdd, 1) }))}</dd>
      <dt>${esc(t('bn.prov.fit'))}</dt><dd class="tMonoS">${pv && pv.fit ? esc(t('bn.prov.fitV', { r2: fmt(pv.fit.r2, 2), cv: fmt(pv.fit.cv, 1), n: pv.fit.n })) : esc(t('emptyDash'))}</dd>
      <dt>${esc(t('bn.prov.eui'))}</dt><dd class="tMonoS">${esc(fmt(eui(E), 0))} kWh/m²/yr <span class="tCap">${esc(t('ep.bn.euiNoRef'))}</span></dd></dl>`, t('bn.provFoot'));
    return `<div class="pwarea" data-pg="bench">${hl}<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>
      ${A().widget(E, t('ep.bn.tableT'), t('ep.bn.tableCap', { p: period }), table, t('ep.bn.tableFoot'))}
      ${A().widget(E, t('ep.bn.chartT'), t('ep.bn.chartCap', { p: period }), chart + show3d)}${prov}</div>`;
  }
  const eui = E => { const em = EM().of(E), area = (E.data.energyModel || {}).floorAreaM2 || 1; let s = 0; for(let i = 1; i <= 365; i++) s += em.day(E, i).total; return s * 1000 / area; };

  /* drill-downs: a system's daily actual against its normalised design, the faults and the work orders */
  function sysDrill(E, id){
    const t = E.t.bind(E), em = EM().of(E), M = em.mtd(E), now = E.nowMs(), tol = em.model.tolPct;
    const days = []; for(let i = 29; i >= 0; i--) days.push(em.day(E, i));
    const W = 640, H = 190, all = days.flatMap(d => [d.actual[id] * 1000, d.design[id] * 1000]), NB = O().nice(Math.min(...all), Math.max(...all)), mn = NB.lo, mx = NB.hi;
    const x = i => 40 + i / (days.length - 1) * (W - 50), y = v => H - 22 - (v - mn) / (mx - mn) * (H - 44);
    const pa = days.map((d, i) => x(i).toFixed(1) + ',' + y(d.actual[id] * 1000).toFixed(1)), pd = days.map((d, i) => x(i).toFixed(1) + ',' + y(d.design[id] * 1000).toFixed(1));
    const gap = `<polygon points="${pa.join(' ')} ${pd.slice().reverse().join(' ')}" class="epgap"/>`;
    /* faults on the system's equipment (the alarm history and the open alarms) as markers */
    const group = sysOf(E, id).group, assetsIn = (E.data.assets || []).filter(a => a.sys === (id === 'cool' ? 'chw' : id === 'ahu' ? 'ahu' : id === 'heat' ? 'heat' : '__'));
    const ids = new Set(assetsIn.map(a => a.id));
    const ev = (((E.data.alarmHistory || {}).events) || []).filter(e => ids.has(e.asset)).map(e => ({ ago: e.agoH / 24, a: e.asset, ty: e.type }))
      .concat((E.data.alarms || []).filter(a => ids.has(a.asset)).map(a => ({ ago: (a.ageH || 0) / 24, a: a.asset, ty: a.type, open: true }))).filter(e => e.ago <= 29);
    const marks = ev.map(e => { const i = days.length - 1 - Math.round(e.ago); return `<circle cx="${x(i).toFixed(1)}" cy="${(H - 22).toFixed(1)}" r="4" class="epfault"><title>${esc(e.a + ' · ' + E.fmtAge(e.ago * 24))}</title></circle>`; }).join('');
    const ticks = [0, 10, 20, 29].map(i => `<text x="${x(i).toFixed(1)}" y="${H - 4}" class="esgax" text-anchor="middle">${esc(dLbl(E, days[i].ms))}</text>`).join('');
    const hover = days.map((d, i) => `<rect x="${(x(i) - 9).toFixed(1)}" y="8" width="18" height="${H - 30}" fill="transparent"><title>${esc(dLbl(E, d.ms) + ': ' + t('ep.c.actual') + ' ' + kwh(d.actual[id], 0) + ' kWh · ' + t('ep.c.design') + ' ' + kwh(d.design[id], 0) + ' kWh')}</title></rect>`).join('');
    const chart = `<svg class="esgchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('ep.bn.dayAria'))}">${O().yAxis(NB.ticks, y, 40, W - 10, NB.step < 1 ? 1 : 0)}<text x="2" y="10" class="esgax">kWh/d</text>
      ${gap}<polyline class="esgl-b" points="${pd.join(' ')}" fill="none"/><polyline class="esgl-a" points="${pa.join(' ')}" fill="none"/>${marks}${ticks}${hover}</svg>
      <div class="row gap12 esgleg"><span><i class="esgsw" data-l="a"></i>${esc(t('ep.c.actual'))}</span><span><i class="esgsw" data-l="b"></i>${esc(t('ep.bn.normDesign'))}</span><span><i class="epgapsw"></i>${esc(t('ep.bn.gapShade'))}</span><span><i class="epfaultsw"></i>${esc(t('ep.bn.faultMark'))}</span></div>`;
    const wos = (((E.data.maintenance || {}).wos) || []).filter(w => ids.has(w.asset));
    const wrows = wos.map(w => `<tr><th scope="row" class="tMonoS">${esc(w.id)}</th><td><button class="statlink tMonoS" data-act="openAsset" data-asset="${esc(w.asset)}">${esc(w.asset)}</button></td><td>${esc(L(E, w.taskEn, w.taskAr))}</td><td>${esc(t('wo' + w.state.charAt(0).toUpperCase() + w.state.slice(1)))}</td></tr>`).join('');
    const a = M.actual[id], d = M.design[id], g = (a - d) / d * 100;
    return { title: t('ep.bn.drillT', { s: sysName(E, id) }),
      body: `<p class="tCap">${esc(t('ep.bn.drillCap', { a: kwh(a, 0), d: kwh(d, 0), g: (g > 0 ? '+' : '') + fmt(g, 1), o: M.onset[id] != null ? dLbl(E, now - M.onset[id] * DAY) : t('emptyDash') }))}</p>${chart}
        <h4 class="tLbl">${esc(t('ep.bn.wosT'))}</h4>${O().table(E, ['mnt.c.wo', 'mnt.c.asset', 'mnt.c.task', 'mnt.c.state'], wrows, 'ep.bn.noWos')}${window.EKO_PROVE && id === 'ahu' ? `<p class="tCap">${esc(t('ep.bn.prove'))}</p>` : ''}`,
      method: em.model.engine ? t('ep.bn.methodE', { p: mLbl(E, now) }) : t(sysOf(E, id).cdd ? 'ep.bn.methodCool' : 'ep.bn.methodOther', { c: fmt(em.model.climate.designCdd, 1), p: mLbl(E, now) }) };
  }

  /* ------------------------------ FORECASTING ------------------------------ */
  function fit(bt){ return window.EKO_A && window.EKO_A.fcstFit ? window.EKO_A.fcstFit(bt) : null; }
  function fcstPage(E){
    const t = E.t.bind(E), em = EM().of(E), F = em.forecast(E), M = F.mtd, bt = em.backtest(E), ft = fit(bt), now = E.nowMs(), tol = em.model.tolPct;
    const pass = !ft || ft.pass;
    const me = F.monthEnd, bud = F.budgetMonth, overB = bud ? (me.v - bud) / bud * 100 : null;
    /* the driver: the system whose next month differs most from last year */
    const drv = Object.keys(F.next.bySys).map(k => ({ k, d: F.next.bySys[k] - F.next.lastYearBySys[k] })).sort((p, q) => Math.abs(q.d) - Math.abs(p.d))[0];
    const rDp = Math.round(me.lo) === Math.round(me.hi) ? 1 : 0;   /* a narrow range keeps a decimal, so its ends differ */
    /* E8: the headline leads with the month's energy against its budget, and the engine's figure with the fault fixed (energyInsight) */
    const EI = energyInsight(E);
    const hl = !pass ? O().headline(E, t('ep.fc.hlNone'), 'attn') : O().headline(E, EI.text, EI.state === 'over' ? 'attn' : 'ok');
    /* E3: the forecast peak against the contract, linked to the fault behind it and its work order, with the engine's peak if it is fixed */
    const PF = F.peakFixed, peakOver = F.peakKw > F.contractKw, peakNear = F.peak15 != null && F.peak15 > F.contractKw;
    const peakHl = pass && PF ? `<p class="row gap6 epinsl"><button class="btnG btnSm" data-act="openAsset" data-asset="${esc(PF.asset)}">${esc(t('ep.fc.peakAsset', { a: PF.asset }))}</button><button class="btnG btnSm" data-act="woOpen" data-asset="${esc(PF.asset)}">${esc(t('ep.fc.peakWo', { w: PF.wo }))}</button></p>` : '';
    const heroes = pass ? [O().hero(E, t('ep.fc.k.month'), O().door(E, kwh(me.v, 0), 'fcMonth'), 'kWh', t('ep.fc.k.monthCap', { lo: kwh(me.lo, 0), hi: kwh(me.hi, 0), b: bud != null ? kwh(bud, 0) : t('emptyDash'), m: kwh(M.total, 0) })),
      O().hero(E, t('ep.fc.k.next', { m: mLbl(E, new Date(new Date(now).getFullYear(), new Date(now).getMonth() + 1, 1).getTime()) }), O().door(E, kwh(F.next.v, 0), 'fcNext'), 'kWh', t('ep.fc.k.nextCap', { lo: kwh(F.next.lo, 0), hi: kwh(F.next.hi, 0), b: F.budgetNext != null ? kwh(F.budgetNext, 0) : t('emptyDash') })),
      O().hero(E, t('ep.fc.k.peak'), PF ? O().door(E, fmt(F.peakKw, 0), 'fcPeak') : fmt(F.peakKw, 0), 'kW', t('ep.fc.k.peakCap2', { c: fmt(F.contractKw, 0) }) + (PF ? ' · ' + t('ep.fc.k.peak15', { q: fmt(F.peak15, 0) }) : '')   /* E10: two lines; the peak with the fault fixed is in the tile's drawer and behind the buttons above */, peakOver ? t('ep.fc.k.peakOver') : peakNear ? t('ep.fc.k.peakNear') : '', 'warn')]
      : [O().hero(E, t('fc.noFcT'), t('fc.noFc'), '', t('fc.noFcCap'))];
    /* the main chart: one time axis; actual this month (solid), the forecast to month end and the next 60 days (dashed), P10 to P90, the budget as a step line */
    const d0 = new Date(now); const mStart = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime();
    const pts = M.daily.filter(x => x.part >= 1).map(x => ({ ms: x.ms, a: x.total * 1000 }));
    /* E10: today (the first forecast point) is the energy used so far plus the forecast for the rest of the day, the range on the rest only */
    const td = M.daily[M.daily.length - 1], soFar = td && td.part < 1 ? td.total * 1000 : 0, part0 = td && td.part < 1 ? td.part : 0;
    const fc = F.ahead.slice(0, 61).map((f, i) => { const r = i === 0 ? f.total * 1000 * (1 - part0) : f.total * 1000, s = i === 0 ? soFar : 0; return { ms: f.ms, f: s + r, lo: s + r * (1 + F.q10), hi: s + r * (1 + F.q90), today: i === 0 && part0 > 0 }; });
    const x0 = mStart, x1 = fc[fc.length - 1].ms, W = 720, H = 220, X = ms => 52 + (ms - x0) / (x1 - x0) * (W - 64);
    const budStep = []; for(let ms = x0; ms <= x1; ms += DAY){ const dd = new Date(ms), b = (em.model.budgetMwh || [])[dd.getMonth()], dim = new Date(dd.getFullYear(), dd.getMonth() + 1, 0).getDate(); budStep.push({ ms, v: b != null ? b * 1000 / dim : null }); }
    const vals = pts.map(p => p.a).concat(fc.flatMap(p => [p.lo, p.hi]), budStep.map(b => b.v).filter(v => v != null));
    const NA = O().nice(Math.min(...vals), Math.max(...vals)), mn = NA.lo, mx = NA.hi, Y = v => H - 24 - (v - mn) / (mx - mn) * (H - 46);
    const band = `<polygon class="epband" points="${fc.map(p => X(p.ms).toFixed(1) + ',' + Y(p.hi).toFixed(1)).join(' ')} ${fc.slice().reverse().map(p => X(p.ms).toFixed(1) + ',' + Y(p.lo).toFixed(1)).join(' ')}"/>`;
    const step = budStep.filter(b => b.v != null).map((b, i, arr) => (i === 0 ? 'M' : 'L') + X(b.ms).toFixed(1) + ' ' + Y(b.v).toFixed(1) + (arr[i + 1] ? ' L' + X(arr[i + 1].ms).toFixed(1) + ' ' + Y(b.v).toFixed(1) : '')).join(' ');
    const monthTicks = []; for(let k = 0; k < 4; k++){ const ms = new Date(d0.getFullYear(), d0.getMonth() + k, 1).getTime(); if(ms <= x1) monthTicks.push(`<line x1="${X(ms).toFixed(1)}" x2="${X(ms).toFixed(1)}" y1="10" y2="${H - 24}" class="epgrid"/><text x="${X(ms).toFixed(1)}" y="${H - 6}" class="esgax" text-anchor="middle">${esc(mLbl(E, ms))}</text>`); }
    const hov = pts.map(p => `<circle cx="${X(p.ms).toFixed(1)}" cy="${Y(p.a).toFixed(1)}" r="5" fill="transparent"><title>${esc(dLbl(E, p.ms) + ': ' + fmt(p.a, 0) + ' kWh, ' + t('ep.c.actual'))}</title></circle>`).join('')
      + fc.map(p => `<circle cx="${X(p.ms).toFixed(1)}" cy="${Y(p.f).toFixed(1)}" r="5" fill="transparent"><title>${esc(dLbl(E, p.ms) + ': ' + fmt(p.f, 0) + ' kWh (' + fmt(p.lo, 0) + ' to ' + fmt(p.hi, 0) + ')' + (p.today ? ', ' + t('ep.fc.todayTip', { s: fmt(soFar, 0) }) : ''))}</title></circle>`).join('');
    const main = `<svg class="esgchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('ep.fc.mainAria'))}">
      ${O().yAxis(NA.ticks, Y, 52, W - 12)}<text x="2" y="10" class="esgax">kWh/d</text>
      ${monthTicks.join('')}<line x1="${X(now).toFixed(1)}" x2="${X(now).toFixed(1)}" y1="10" y2="${H - 24}" class="epnow"/>${pass ? band : ''}<path d="${step}" class="epbudget" fill="none"/>
      <polyline class="esgl-a" points="${pts.map(p => X(p.ms).toFixed(1) + ',' + Y(p.a).toFixed(1)).join(' ')}" fill="none"/>
      ${pass ? `<polyline class="epfcline" points="${fc.map(p => X(p.ms).toFixed(1) + ',' + Y(p.f).toFixed(1)).join(' ')}" fill="none"/>` : ''}${hov}</svg>
      <div class="row gap12 esgleg"><span><i class="esgsw" data-l="a"></i>${esc(t('ep.fc.lg.actual'))}</span>${pass ? `<span><i class="epfcsw"></i>${esc(t('ep.fc.lg.fc'))}</span><span><i class="epbandsw"></i>${esc(t('ep.fc.lg.band'))}</span>` : ''}<span><i class="epbudsw"></i>${esc(t('ep.fc.lg.budget'))}</span></div>`;
    /* by system, next month */
    const sysRows = Object.keys(F.next.bySys).map(k => ({ k, v: F.next.bySys[k], ly: F.next.lastYearBySys[k] })).sort((p, q) => Math.abs(q.v - q.ly) - Math.abs(p.v - p.ly));
    const sysT = sysRows.map((r, i) => `<tr><th scope="row">${esc(sysName(E, r.k))}${i === 0 ? ` <span class="eptone" data-tone="amber">${esc(t('ep.fc.driver'))}</span>` : ''}</th><td class="tMonoS">${kwh(r.v, 0)}</td><td class="tMonoS">${kwh(r.ly, 0)}</td><td class="tMonoS">${(r.v - r.ly > 0 ? '+' : '') + kwh(r.v - r.ly, 0)}</td><td class="tMonoS">${(r.v / r.ly - 1 > 0 ? '+' : '') + fmt((r.v / r.ly - 1) * 100, 1)}%</td></tr>`).join('');
    /* trust: the method, the backtest at full width with axes, the fit statistics */
    const btW = 720, btH = 170, n = bt.actual.length, NT = O().nice(Math.min(...bt.actual, ...bt.forecast), Math.max(...bt.actual, ...bt.forecast)), bmn = NT.lo, bmx = NT.hi;
    const bX = i => 52 + i / (n - 1) * (btW - 64), bY = v => btH - 24 - (v - bmn) / (bmx - bmn) * (btH - 46);
    const btTicks = [0, 30, 61, 91].map(i => `<text x="${bX(i).toFixed(1)}" y="${btH - 6}" class="esgax" text-anchor="middle">${esc(dLbl(E, now - (n - i) * DAY))}</text>`).join('');
    const btChart = `<svg class="esgchart" viewBox="0 0 ${btW} ${btH}" role="img" aria-label="${esc(t('fc.btAria'))}">${O().yAxis(NT.ticks, bY, 52, btW - 12, NT.step < 1 ? 1 : 0)}<text x="2" y="10" class="esgax">kWh/d</text>
      <polyline class="esgl-a" points="${bt.actual.map((v, i) => bX(i).toFixed(1) + ',' + bY(v).toFixed(1)).join(' ')}" fill="none"/><polyline class="epfcline" points="${bt.forecast.map((v, i) => bX(i).toFixed(1) + ',' + bY(v).toFixed(1)).join(' ')}" fill="none"/>${btTicks}</svg>
      <div class="row gap12 esgleg"><span><i class="esgsw" data-l="a"></i>${esc(t('fc.btActual'))}</span><span><i class="epfcsw"></i>${esc(t('fc.btFcst'))}</span></div>`;
    const trust = `<p class="fcmethod"><span class="fcmchip">${esc(t('fc.methodLbl'))}</span><span>${esc(t('ep.fc.method'))}</span></p>${ft ? window.EKO_A.fcstFitTiles(E, ft) : ''}${btChart}`;
    const bRule = budgetRule(E) ? `<p class="tCap fcbudget" data-frame="top">${esc(budgetRule(E))}</p>` : '';
    return `<div class="pwarea" data-pg="fcst">${hl}${peakHl}${bRule}<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>
      ${A().widget(E, t('ep.fc.mainT'), t('ep.fc.mainCap', { m: kwh(M.total, 0) }), pass ? main : `<p class="alempty">${esc(t('fc.noFcLong'))}</p>` + main, t('ep.fc.mainFoot') + (budgetRule(E) ? ' ' + budgetRule(E) : ''))}
      ${pass ? whyWidget(E) : ''}
      ${pass ? A().widget(E, t('ep.fc.sysT', { m: mLbl(E, new Date(d0.getFullYear(), d0.getMonth() + 1, 1).getTime()) }), t('ep.fc.sysCap'), O().table(E, ['ep.c.sys', 'ep.c.fcNext', 'ep.c.lastYear', 'ep.c.chgMwh', 'ep.c.chgPct'], sysT)) : ''}
      ${A().widget(E, t('ep.fc.trustT'), t('fc.fitCap', { n: bt.actual.length }), trust, t('fc.fitFoot'))}</div>`;
  }

  /* E10: why each forecast month is over its budget, from the engine's own what-if runs, one cause at a time in this order:
     the chiller fault, the other faults with an energy effect (the AHU-2 valve), the weather against the same dates last year, the load
     growth since last year (the dialysis sessions added), and the saving target in the budget rule. Each run keeps the causes before it
     removed, so the rows add up; the rest is what the runs do not explain (the forecast method against the engine, the meter noise, the
     weekdays against last year's dates). The months: this month (measured so far plus the forecast) and next month (the forecast). */
  const whyCache = new WeakMap();
  function whyOver(E){
    const em = EM() && EM().of(E), e = em && em.model.engine; if(!e || !e.whatIf) return null;
    const key = E.nowMs(), hit = whyCache.get(em.model); if(hit && hit.key === key) return hit.v;
    const F = em.forecast(E), n = new Date(E.nowMs()), HOUR = 36e5, pct = (em.model.budgetRule || {}).savingPct || 0;
    /* a whole day of a run: today is the day so far plus the rest of the day hour by hour */
    const full = (run, k) => { const d = run.day(k); if(k !== 0) return d.total; let r = d.total; const end = run.dayStart(1);
      for(let ms = run.now; ms < end;){ const nx = Math.min(end, (Math.floor(ms / HOUR) + 1) * HOUR); r += run.hour(ms, false).total * (nx - ms) / HOUR / 1000; ms = nx; } return r; };
    const months = [{ y: n.getFullYear(), m: n.getMonth(), v: F.monthEnd.v, b: F.budgetMonth }, { y: new Date(n.getFullYear(), n.getMonth() + 1, 1).getFullYear(), m: (n.getMonth() + 1) % 12, v: F.next.v, b: F.budgetNext }];
    const out = months.map(M => {
      const m0 = new Date(M.y, M.m, 1).getTime(), dim = new Date(M.y, M.m + 1, 0).getDate(), ks = [];
      for(let i = 1; i <= dim; i++) ks.push(Math.round((new Date(M.y, M.m, i).getTime() - e.today0) / DAY));
      const sum = run => ks.reduce((s, k) => s + full(run, k), 0), sh = Math.round((new Date(M.y - 1, M.m, 1).getTime() - m0) / DAY);
      const all = ['chillerCop', 'ahu2Supply'];
      const T0 = sum(e), T1 = sum(e.whatIf({ fix: ['chillerCop'], fixFrom: m0 })), T2 = sum(e.whatIf({ fix: all, fixFrom: m0 })),
        T3 = sum(e.whatIf({ fix: all, fixFrom: m0, weatherShiftD: sh })), T4 = sum(e.whatIf({ fix: all, fixFrom: m0, weatherShiftD: sh, growShiftD: sh }));
      let ly = 0; for(let i = 1; i <= dim; i++) ly += e.day(Math.round((new Date(M.y - 1, M.m, i).getTime() - e.today0) / DAY)).total;
      const gap = M.b != null ? M.v - M.b : null, parts = { chiller: T0 - T1, faults: T1 - T2, weather: T2 - T3, growth: T3 - T4, target: M.b != null ? ly - M.b : 0 };
      parts.rest = gap == null ? 0 : gap - Object.keys(parts).reduce((s, k) => s + parts[k], 0);
      return { ms: m0, v: M.v, b: M.b, gap, lastYear: ly, engine: T0, parts, fixedV: M.v - parts.chiller, measured: m0 <= E.nowMs() };
    });
    const v = { months: out, pct, chiller: e.faults.chillerCop.asset, valve: e.faults.ahu2Supply.asset };
    whyCache.set(em.model, { key, v }); return v;
  }
  function whyWidget(E){
    const t = E.t.bind(E), W = whyOver(E); if(!W) return '';
    const ROWS = [['chiller', t('ep.why.chiller', { a: W.chiller })], ['faults', t('ep.why.faults', { a: W.valve })], ['weather', t('ep.why.weather')], ['growth', t('ep.why.growth')], ['target', t('ep.why.target', { p: W.pct })], ['rest', t('ep.why.rest')]];
    const sg = v => (v > 50 ? '+' : v < -50 ? '−' : '') + fmt(Math.abs(v), 0);
    W.months.forEach(M => { if(M.gap == null) return; const r = {}; ['chiller', 'faults', 'weather', 'growth', 'target'].forEach(k => { r[k] = Math.round(M.parts[k] * 1000); }); r.rest = Math.round(M.gap * 1000) - Object.values(r).reduce((x, y) => x + y, 0); M.shown = r; });
    const pv = (M, k) => M.shown ? M.shown[k] : M.parts[k];
    /* one bar per month: the gap split by cause, each cause's share of the bar by its size, a cause that lowers the gap hatched */
    const COL = { chiller: 'var(--crit)', faults: 'var(--warn)', weather: 'var(--info)', growth: 'var(--acc)', target: 'var(--t3)', rest: 'var(--bd2)' };
    const tot = Math.max(1, ...W.months.map(M => ROWS.reduce((s, r) => s + Math.abs(M.parts[r[0]]), 0)));   /* one scale for the months */
    const bars = W.months.map(M => {
      const segs = ROWS.map(r => { const v = M.parts[r[0]], w = Math.abs(v) / tot * 100; const shown = pv(M, r[0]);
        return w < 0.4 ? '' : `<span class="whyseg" data-neg="${v < 0}" style="width:${w.toFixed(1)}%;background:${COL[r[0]]}" title="${esc(r[1] + ': ' + sg(shown) + ' kWh')}">${w >= 5 && shown ? `<b>${esc(sg(shown))}</b>` : ''}</span>`; }).join('');
      return `<div class="whyrow"><div class="whyhd"><b>${esc(mFull(E, M.ms))}</b> <span class="tCap">${esc(t(M.gap > 0 ? 'ep.why.over' : 'ep.why.under', { v: kwh(M.v, 0), b: kwh(M.b, 0), d: kwh(Math.abs(M.gap), 0) }))}</span></div><div class="whybar" role="img" aria-label="${esc(t('ep.why.barAria', { m: mFull(E, M.ms) }))}">${segs}</div></div>`; }).join('');
    const leg = `<div class="row gap12 esgleg whyleg">${ROWS.map(r => `<span><i class="whysw" style="background:${COL[r[0]]}"></i>${esc(r[1])}</span>`).join('')}</div>`;
    const body = ROWS.map(r => `<tr><th scope="row">${esc(r[1])}</th>${W.months.map(M => `<td class="tMonoS">${sg(pv(M, r[0]))}</td>`).join('')}</tr>`).join('')
      + `<tr class="whytot"><th scope="row">${esc(t('ep.why.gap'))}</th>${W.months.map(M => `<td class="tMonoS"><b>${sg(Math.round(M.gap * 1000))}</b></td>`).join('')}</tr>`;
    const head = `<thead><tr><th scope="col">${esc(t('ep.why.c.cause'))}</th>${W.months.map(M => `<th scope="col">${esc(mFull(E, M.ms))}, kWh</th>`).join('')}</tr></thead>`;
    return A().widget(E, t('ep.why.T'), t('ep.why.cap'), `<p class="tCap fcbudget">${esc(budgetRule(E))}</p>` + bars + leg + `<div class="tblwrap"><table class="otbl">${head}<tbody>${body}</tbody></table></div>`, t('ep.why.foot', { p: W.pct }));
  }

  /* E11: the budget rule, said wherever a budget figure appears (Forecasting, Why over budget, the Brief, Ask EKO) */
  function budgetRule(E){ const em = EM() && EM().of(E), r = em && em.model.budgetRule; return r ? E.t('ep.budget.rule', { p: r.savingPct }) : ''; }

  /* drills for the numbers */
  function regDrills(){
    const O2 = window.EKO_OPS; if(!O2) return;
    O2.drill('bnSys', (E, id) => sysDrill(E, id));
    O2.drill('bnTotal', E => { const t = E.t.bind(E), em = EM().of(E), M = em.mtd(E);
      const r = M.daily.map(d => `<tr><th scope="row">${esc(dLbl(E, d.ms))}</th><td class="tMonoS">${kwh(d.total * d.part, 0)}${d.part < 1 ? ' ' + esc(t('ep.soFar')) : ''}</td><td class="tMonoS">${kwh(d.designTotal * d.part, 0)}</td><td class="tMonoS">${fmt(d.cdd, 1)}</td></tr>`).join('');
      return { title: t('ep.bn.k.actual'), body: O2.table(E, ['ep.c.day', 'ep.c.actual', 'ep.c.design', 'ep.c.cdd'], r), method: t('ep.bn.methodTotal') }; });
    O2.drill('fcMonth', E => { const t = E.t.bind(E), F = EM().of(E).forecast(E);
      return { title: t('ep.fc.k.month'), body: `<dl class="secdl"><dt>${esc(t('ep.fc.mtd'))}</dt><dd class="tMonoS">${kwh(F.mtd.total, 0)} kWh</dd><dt>${esc(t('ep.fc.rest'))}</dt><dd class="tMonoS">${kwh(F.monthEnd.v - F.mtd.total, 0)} kWh</dd>
        <dt>${esc(t('ep.fc.range'))}</dt><dd class="tMonoS">${kwh(F.monthEnd.lo, 0)} to ${kwh(F.monthEnd.hi, 0)} kWh</dd><dt>${esc(t('ep.fc.budget'))}</dt><dd class="tMonoS">${F.budgetMonth != null ? kwh(F.budgetMonth, 0) + ' kWh' : t('emptyDash')}</dd></dl><p class="tCap">${esc(budgetRule(E))}</p>`, method: t('ep.fc.methodMonth') }; });
    O2.drill('fcPeak', E => { const t = E.t.bind(E), F = EM().of(E).forecast(E), PF = F.peakFixed;
      return { title: t('ep.fc.k.peak'), body: `<dl class="secdl"><dt>${esc(t('ep.fc.pk.now'))}</dt><dd class="tMonoS">${fmt(F.peakKw, 0)} kW · ${esc(dLbl(E, F.peakAt))}</dd><dt>${esc(t('ep.fc.pk.est15'))}</dt><dd class="tMonoS">${fmt(F.peak15, 0)} kW</dd><dt>${esc(t('ep.fc.pk.contract'))}</dt><dd class="tMonoS">${fmt(F.contractKw, 0)} kW</dd>
        <dt>${esc(t('ep.fc.pk.fixed', { a: PF.asset }))}</dt><dd class="tMonoS">${fmt(PF.kw, 0)} kW · ${esc(dLbl(E, PF.at))}</dd><dt>${esc(t('ep.fc.pk.wo'))}</dt><dd class="tMonoS">${esc(PF.wo)}</dd></dl>`, method: t('ep.fc.methodPeak') }; });
    O2.drill('fcNext', E => { const t = E.t.bind(E), F = EM().of(E).forecast(E);
      const r = Object.keys(F.next.bySys).map(k => `<tr><th scope="row">${esc(sysName(E, k))}</th><td class="tMonoS">${kwh(F.next.bySys[k], 0)}</td><td class="tMonoS">${fmt(F.trend[k], 3)}</td></tr>`).join('');
      return { title: t('ep.fc.k.next', { m: '' }).trim(), body: O2.table(E, ['ep.c.sys', 'ep.c.fcNext', 'ep.c.trend7'], r), method: t('ep.fc.methodNext') }; });
  }
  setTimeout(regDrills, 0);
  /* E3: the forecast peak insight the Brief shows, the same figures as the Forecasting page (null when the peak is within the contract) */
  function peakInsight(E){
    const em = EM() && EM().of(E); if(!em) return null; const F = em.forecast(E), PF = F.peakFixed;
    if(!PF || !(F.peakKw > F.contractKw || (F.peak15 != null && F.peak15 > F.contractKw))) return null;
    return { m: mFull(E, F.peakAt), p: fmt(F.peakKw, 0), q: fmt(F.peak15, 0), c: fmt(F.contractKw, 0), d: dLbl(E, F.peakAt), a: PF.asset, w: PF.wo, f: fmt(PF.kw, 0), over: F.peakKw > F.contractKw };
  }
  /* E8: the forecast sentence the page, the Brief and Ask EKO share. In the last 10 days of a month it is about next month
     (this month is mostly measured by then); otherwise this month. With an engine, the same month with the fault fixed. */
  function energyInsight(E){
    const em = EM() && EM().of(E); if(!em) return null; const F = em.forecast(E), n = new Date(E.nowMs()), nxt = F.dim - F.dom < 10;
    const v = nxt ? F.next.v : F.monthEnd.v, b = nxt ? F.budgetNext : F.budgetMonth, fx = nxt ? F.next.fixed : F.monthEnd.fixed, PF = F.peakFixed;
    const ms = nxt ? new Date(n.getFullYear(), n.getMonth() + 1, 1).getTime() : n.getTime();
    const diff = b ? v - b : 0, state = !b || Math.abs(diff) / b < 0.005 ? 'on' : diff > 0 ? 'over' : 'under';
    /* E10: the chiller's share is the forecast less the engine's figure with it fixed (the first row of Why over budget); r is what is still over */
    const cN = fx != null ? v - fx : null, rN = fx != null && b ? fx - b : null;
    const P = { m: mFull(E, ms), v: kwh(v, 0), b: b != null ? kwh(b, 0) : E.t('emptyDash'), d: kwh(Math.abs(diff), 0), a: PF ? PF.asset : '', w: PF ? PF.wo : '', f: fx != null ? kwh(fx, 0) : '',
      c: cN != null ? kwh(cN, 0) : '', r: rN != null ? kwh(Math.abs(rN), 0) : '' };
    const first = E.t(state === 'over' ? (PF && cN != null ? 'ep.fc.hlE.overC' : 'ep.fc.hlE.over') : state === 'under' ? 'ep.fc.hlE.under' : 'ep.fc.hlE.on', P);
    const second = PF && fx != null ? E.t(state === 'over' ? (rN > 0.5 ? 'ep.fc.hlE.fixOver' : 'ep.fc.hlE.fixWithin') : 'ep.fc.hlE.fix', P) : '';
    return Object.assign(P, { state, next: nxt, ms, vNum: v, bNum: b, fNum: fx, cNum: cN, rNum: rN, first, second, text: first + (second ? ' ' + second : '') });
  }
  return { benchPage, fcstPage, rows, peakInsight, energyInsight, whyOver, budgetRule, applies: E => !!(E.data.energyModel && window.EKO_EM) };
})();
