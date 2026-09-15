/* ============================================================================
   BASELINE VERSUS ACTUAL (D96) — measurement-and-verification thinking:
   actual against a baseline with a CUMULATIVE avoided (or excess) line.
   Data: E.data.power.bva.ranges[key] = { unit, labels, actual[], baseline[] }
   (a null baseline point is a GAP: rendered with the reset-glyph pattern,
   named in the caption, never interpolated). Three series, never a fourth.
   The chart is drawn in real pixels after render (mount) so text keeps the
   12px floor at every width; phones get one axis and a value readout with a
   horizontal scrub. Every derived ratio handles a zero denominator with a
   dash and a reason — "Infinity" and "NaN" never render.
   ============================================================================ */
window.EKO_BVA = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = s => C().esc(s);
  const fmt = (v, d) => (typeof v === 'number' && isFinite(v)) ? v.toLocaleString('en-US', { minimumFractionDigits:d, maximumFractionDigits:d }) : '—';
  const RANGES = ['today', 'week', 'month'];

  function range(E){ const b = E.data.power.bva; const k = b.ranges[E.state.bvaRange] ? E.state.bvaRange : 'today'; return { key:k, r:b.ranges[k], b }; }
  /* the sums behind the summary line, the ratio and the cumulative line */
  function sums(E){
    const { key, r, b } = range(E);
    let sa = 0, sb = 0, n = 0, c = 0; const gaps = [], cum = [];
    r.actual.forEach((a, i) => {
      const bl = r.baseline[i];
      if(a == null){ cum.push(null); return; }
      if(bl == null){ gaps.push(i); cum.push(c); return; }
      sa += a; sb += bl; n++; c += bl - a; cum.push(c);
    });
    const diff = sb - sa;                                   /* positive = avoided */
    const mwh = r.unit === 'MWh' ? diff : diff / 1000;
    const rate = E.data.basis.aedPerKwh;
    const aed = mwh * 1000 * rate;
    const pct = sb > 0 ? (sa - sb) / sb * 100 : null;      /* zero denominator → null → dash */
    return { key, r, b, unit:r.unit, sa, sb, n, diff, mwh, avoided: diff >= 0, aed, rate, pct, gaps, cum, prov: E.data.basis.tariffStatus === 'provisional' };
  }
  const label = (E, r, i) => r.labelKeys ? E.t(r.labels[i]) : r.labels[i];
  const gapList = (E, s) => s.gaps.map(i => label(E, s.r, i)).join(', ');

  function card(E){
    const t = E.t.bind(E), s = sums(E);
    const win = t('bvaWindow.' + s.key);
    const adj = s.b.adjust || {};
    const adjText = (adj.weather && adj.occupancy) ? t('bvaAdjBoth') : (adj.weather ? t('bvaAdjWeather') : adj.occupancy ? t('bvaAdjOcc') : t('bvaAdjNone'));
    const prov = s.prov ? ` <span class="rpprov">${esc(t('rpB.prov'))}</span>` : '';
    const sumKey = s.avoided ? 'bvaSumAvoided' : 'bvaSumExcess';
    const sumHtml = `<span class="bvasumv"><b class="tMono">${esc(fmt(Math.abs(s.mwh), 2))}</b> MWh</span>
      <span class="bvasumt">${esc(t(sumKey, { window:win }))}</span>
      <span class="bvasumaed">AED <b class="tMono">${esc(fmt(Math.abs(s.aed), 0))}</b> ${esc(t('bvaAtRate', { rate:fmt(s.rate, 2) }))}${prov}</span>
      <span class="bvasumpct" data-tip="${esc(s.pct == null ? t('bvaNoBaseWhy') : t('bvaVsTip'))}">${s.pct == null ? esc(t('bvaNoBase')) : esc(t('bvaVs', { pct:(s.pct >= 0 ? '+' : '') + fmt(s.pct, 1) }))}</span>`;
    const tabs = RANGES.map(k => `<button class="seg" data-on="${s.key === k}" data-act="bvaRange" data-v="${k}">${esc(t('bvaRange.' + k))}</button>`).join('');
    return `<article class="pwwidget bvacard" data-single="0" aria-label="${esc(t('bvaTitle'))}">
      <div class="pwwh"><span class="alcardt">${esc(t('bvaTitle'))}</span><span class="alcardm">${esc(t('bvaSub', { u:s.unit }))}</span>
        <span class="row segbox msA" role="tablist">${tabs}</span>${window.EKO_A.chrome(E)}</div>
      <div class="bvasum" data-avoided="${s.avoided ? 1 : 0}">${sumHtml}</div>
      <div class="bvaread" aria-live="polite"><span class="bvareadl tCap"></span><span class="bvareadv"></span></div>
      <div class="bvachart" data-range="${esc(s.key)}" role="img" aria-label="${esc(t('bvaTitle'))}"></div>
      <div class="bvaleg"><span><i class="bvasw bvaswA"></i>${esc(t('bvaActual'))} (${esc(s.unit)})</span><span class="bvapill">${esc(t('bvaBaseline'))}</span><span><i class="bvasw bvaswC"></i>${esc(t(s.avoided ? 'bvaCum' : 'bvaCumEx'))} (${esc(s.unit)})</span></div>
      <p class="bvacap">${esc(t('bvaBasis', { adj:adjText }))}</p>
      ${s.gaps.length ? `<p class="bvacap bvagapcap">${esc(t('bvaGapCap', { list:gapList(E, s), why:t('bvaGapWhy') }))}</p>` : ''}
      ${!s.avoided ? `<p class="bvacap bvaexcess">${esc(t('bvaExcessCap'))}</p>` : ''}
      <p class="bvacap bvaphonecap">${esc(t('bvaPhoneCap'))}</p></article>`;
  }

  /* ---- drawing, in pixels ------------------------------------------------ */
  const nice = v => { if(v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return n * p; };
  function draw(E, host){
    const s = sums(E), r = s.r, t = E.t.bind(E);
    const W = Math.max(280, host.clientWidth || 0);
    const single = W < 560;
    const card = host.closest('.bvacard'); if(card) card.dataset.single = single ? '1' : '0';
    const H = single ? 232 : 312, L = 56, R = single ? 12 : 66, T = 26, B = 30;   /* T leaves headroom for the axis titles */
    const pw = W - L - R, ph = H - T - B, n = r.actual.length;
    const maxV = Math.max(...r.actual.filter(v => v != null), ...r.baseline.filter(v => v != null), 1);
    const yMax = nice(maxV * 1.08);
    const y = v => T + ph - (v / yMax) * ph;
    const step = pw / n, bw = Math.max(4, step * 0.56);
    const cx = i => L + step * i + step / 2;
    const cumVals = s.cum.filter(v => v != null);
    const cMin = Math.min(0, ...cumVals), cMax = Math.max(0, ...cumVals);
    const cSpan = (cMax - cMin) || 1;
    const cy = v => T + ph - ((v - cMin) / cSpan) * ph;
    const ticks = [0, .25, .5, .75, 1];
    let g = `<defs><pattern id="bvahatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--bd2)" stroke-width="1.5"/></pattern></defs>`;
    /* grid + left axis */
    g += ticks.map(f => `<line x1="${L}" x2="${W - R}" y1="${(T + ph - f * ph).toFixed(1)}" y2="${(T + ph - f * ph).toFixed(1)}" stroke="var(--bd1)" stroke-width="1"${f ? ' stroke-dasharray="2 3"' : ''}/>
      <text x="${L - 8}" y="${(T + ph - f * ph + 4).toFixed(1)}" text-anchor="end" class="bvatx">${esc(fmt(yMax * f, yMax >= 100 ? 0 : 1))}</text>`).join('');
    g += `<text x="${L - 8}" y="${T - 10}" text-anchor="end" class="bvatx bvaax">${esc(s.unit)}</text>`;
    /* right axis (cumulative) */
    if(!single){
      g += ticks.map(f => `<text x="${W - R + 8}" y="${(T + ph - f * ph + 4).toFixed(1)}" text-anchor="start" class="bvatx">${esc(fmt(cMin + cSpan * f, cSpan >= 100 ? 0 : 1))}</text>`).join('');
      g += `<text x="${W - 2}" y="${T - 10}" text-anchor="end" class="bvatx bvaax">${esc(t('bvaAxisR', { u:s.unit }))}</text>`;
      if(cMin < 0 && cMax > 0) g += `<line x1="${L}" x2="${W - R}" y1="${cy(0).toFixed(1)}" y2="${cy(0).toFixed(1)}" stroke="var(--bd2)" stroke-width="1" stroke-dasharray="1 3"/>`;
    }
    /* gaps (baseline unavailable): hatched column + reset glyph */
    s.gaps.forEach(i => { g += `<rect x="${(L + step * i).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${ph}" fill="url(#bvahatch)" opacity=".7"/>
      <text x="${cx(i).toFixed(1)}" y="${T + 14}" text-anchor="middle" class="bvatx bvagap">◷</text>`; });
    /* actual bars */
    r.actual.forEach((a, i) => { if(a == null) return; g += `<rect x="${(cx(i) - bw / 2).toFixed(1)}" y="${y(a).toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + ph - y(a)).toFixed(1)}" rx="2" fill="var(--domEnergy)" opacity=".85"/>`; });
    /* baseline: dashed, broken at gaps */
    let seg = []; const segs = [];
    r.baseline.forEach((b, i) => { if(b == null || r.actual[i] == null){ if(seg.length) segs.push(seg); seg = []; return; } seg.push(`${cx(i).toFixed(1)},${y(b).toFixed(1)}`); });
    if(seg.length) segs.push(seg);
    segs.forEach(sg => { g += `<polyline points="${sg.join(' ')}" fill="none" stroke="var(--t3)" stroke-width="1.5" stroke-dasharray="6 4" stroke-linejoin="round"/>`; });
    /* cumulative, right axis */
    if(!single){
      const pts = s.cum.map((v, i) => v == null ? null : `${cx(i).toFixed(1)},${cy(v).toFixed(1)}`).filter(Boolean);
      if(pts.length > 1) g += `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--t2)" stroke-width="1.8" stroke-linejoin="round"/>`;
      const li = s.cum.length - 1; if(s.cum[li] != null) g += `<circle cx="${cx(li).toFixed(1)}" cy="${cy(s.cum[li]).toFixed(1)}" r="3" fill="var(--t2)"/>`;
    }
    /* x labels: as many as fit at ≥44px spacing */
    const every = Math.max(1, Math.ceil(44 / step));
    r.labels.forEach((l, i) => { if(i % every) return; g += `<text x="${cx(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="bvatx">${esc(label(E, r, i))}</text>`; });
    /* cursor + hit areas (hover tooltips through the shell layer; scrub on touch) */
    g += `<line class="bvacur" x1="0" x2="0" y1="${T}" y2="${T + ph}" stroke="var(--acc)" stroke-width="1" opacity="0"/>`;
    r.actual.forEach((a, i) => { const bl = r.baseline[i], c = s.cum[i];
      const tip = a == null ? '' : bl == null ? t('bvaTipNoBase', { label:label(E, r, i), a:fmt(a, 1), u:s.unit }) : t('bvaTipRow', { label:label(E, r, i), a:fmt(a, 1), b:fmt(bl, 1), c:(c >= 0 ? '+' : '') + fmt(c, 1), u:s.unit });
      g += `<rect class="bvahit" data-i="${i}" x="${(L + step * i).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${ph}" fill="transparent"${tip ? ` data-tip="${esc(tip)}"` : ''}/>`; });
    /* positions are absolute pixels: anchor semantics stay LTR under an RTL document; Arabic runs still shape correctly */
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" style="direction:ltr">${g}</svg>`;
    host.dataset.w = String(W);
    wireScrub(E, host, s, { L, step, n, T, ph });
    readout(E, host, s, s.actual == null ? 0 : lastIndex(s));
  }
  const lastIndex = s => { let li = 0; s.r.actual.forEach((a, i) => { if(a != null) li = i; }); return li; };
  function readout(E, host, s, i){
    const card = host.closest('.bvacard'); if(!card) return;
    const t = E.t.bind(E), r = s.r, a = r.actual[i], bl = r.baseline[i], c = s.cum[i];
    const l = card.querySelector('.bvareadl'), v = card.querySelector('.bvareadv');
    if(l) l.textContent = label(E, r, i);
    if(v) v.innerHTML = a == null ? esc(t('emptyDash')) : `<b class="tMono">${esc(fmt(a, 1))}</b> ${esc(s.unit)} <span class="tCap">${esc(t('bvaActual'))}</span> · <span class="tMono">${bl == null ? esc(t('bvaGapShort')) : esc(fmt(bl, 1))}</span> <span class="tCap">${esc(t('bvaBaseline'))}</span> · <b class="tMono">${c == null ? '—' : esc((c >= 0 ? '+' : '') + fmt(c, 1))}</b> <span class="tCap">${esc(t(s.avoided ? 'bvaCum' : 'bvaCumEx'))}</span>`;
    const cur = host.querySelector('.bvacur'); const hit = host.querySelector(`.bvahit[data-i="${i}"]`);
    if(cur && hit){ const x = (+hit.getAttribute('x') + (+hit.getAttribute('width')) / 2).toFixed(1); cur.setAttribute('x1', x); cur.setAttribute('x2', x); cur.setAttribute('opacity', '.9'); }
  }
  function wireScrub(E, host, s, geo){
    const svg = host.querySelector('svg'); if(!svg) return;
    let down = false;
    const at = ev => { const b = svg.getBoundingClientRect(); const x = ev.clientX - b.left; const i = Math.max(0, Math.min(geo.n - 1, Math.floor((x - geo.L) / geo.step))); readout(E, host, s, i); };
    svg.addEventListener('pointerdown', ev => { if(ev.pointerType !== 'touch' && ev.button !== 0) return; down = true; at(ev); });
    svg.addEventListener('pointermove', ev => { if(down || ev.pointerType === 'mouse') at(ev); });
    svg.addEventListener('pointerup', () => { down = false; }); svg.addEventListener('pointercancel', () => { down = false; });
  }
  let ro = null;
  function mount(E){
    const hosts = [...document.querySelectorAll('.bvachart')];
    if(!hosts.length) return;
    hosts.forEach(h => draw(E, h));
    if(!ro && window.ResizeObserver){ ro = new ResizeObserver(entries => entries.forEach(en => { const h = en.target; if(!document.contains(h)) return; const w = Math.round(en.contentRect.width); if(w && String(w) !== h.dataset.w) draw(window.EKO, h); })); }
    if(ro) hosts.forEach(h => ro.observe(h));
  }
  return { card, mount, sums, RANGES };
})();
