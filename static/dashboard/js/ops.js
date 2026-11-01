/* ============================================================================
   OPERATIONS MODULE HELPERS (D182, functional specs rule 0). Shared by the
   new modules (security, cameras, access, fire, power, evacuation, nurse
   call, maintenance, benchmark, forecasting, heat map) so they read like ESG:
     headline(E, text, tone, act?)   one plain sentence: what needs attention, or that nothing does
     val(E, o)                       the four data states: live, stale (hatched, with its age), no data
                                     (a dash with the reason), not configured; never a false zero
     door(E, html, key, arg?)        every number is a door: it opens the list or chart behind it
     drill(key, fn)                  registers a drill-down: fn(E, arg) -> { title, body, method }
     dialog(E)                       the drill-down dialog, with its method line (formula, source, period)
     tile(E, o)                      a status tile: state word (Normal, Attention, Alarm), count, caption
   Uses the ESG card and value classes; no new chart style.
   ============================================================================ */
window.EKO_OPS = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d), icon = (n, s) => C().icon(n, s);
  const drills = {};

  /* E7: an identifier never breaks across lines (WO-5118 broke after its hyphen); applied to escaped text */
  const idWrap = h => String(h).replace(/\b([A-Z][A-Z0-9]*(?:-[A-Z0-9][A-Z0-9.]*)+(?:&amp;[0-9]+)?(?: \([0-9]+\))?)/g, '<span class="idnb">$1</span>');
  function headline(E, text, tone, act){
    const t = E.t.bind(E);
    return `<div class="opshl" data-tone="${tone || 'ok'}"${act ? ` role="button" tabindex="0" data-act="${esc(act.act)}" data-v="${esc(act.v || '')}"` : ''}>
      <span class="opshld" aria-hidden="true"></span><b>${idWrap(esc(text))}</b>${act ? `<span class="opshlgo">${esc(t('ops.open'))} ${icon('chevR', 12)}</span>` : ''}</div>`;
  }
  /* o: { v, dp, unit, ageMin, staleMin, why, notConfigured, tip } */
  function val(E, o){
    const t = E.t.bind(E);
    if(o.notConfigured) return `<span class="esgnd opsnc" data-state="nc" data-tip="${esc(o.why || t('ops.st.nc'))}">${esc(t('ops.st.ncShort'))}</span>`;
    if(o.v == null || (typeof o.v === 'number' && isNaN(o.v)))
      return `<span class="esgnd" data-state="none" data-tip="${esc(o.why || t('ops.st.none'))}">${esc(t('emptyDash'))}</span>`;
    const num = `${esc(typeof o.v === 'number' ? fmt(o.v, o.dp ?? 0) : o.v)}${o.unit ? `<span class="ovkunit">${esc(o.unit)}</span>` : ''}`;
    if(o.ageMin != null && o.staleMin != null && o.ageMin > o.staleMin)
      return `<span class="esgstale opsstale" data-state="stale"${o.tip ? ` data-tip="${esc(o.tip)}"` : ''}>${icon('clock', 11)}<span>${num}</span><span class="esgage">${esc(t('ops.age', { a: E.fmtAge(o.ageMin / 60) }))}</span></span>`;
    return `<span class="esglive" data-state="live"${o.tip ? ` data-tip="${esc(o.tip)}"` : ''}>${num}</span>`;
  }
  const door = (E, html, key, arg, label) => `<button class="opsdoor" data-act="opsDrill" data-v="${esc(key)}" data-arg="${esc(arg == null ? '' : String(arg))}" aria-label="${esc(label || E.t('ops.open'))}">${html}</button>`;
  /* o: { k, label, word, tone, count, unit?, cap, act?, v?, sub?, on? } */
  function tile(E, o){
    return `<button class="opstile" data-tone="${o.tone || 'ok'}" data-on="${!!o.on}" data-act="${esc(o.act || 'none')}" data-v="${esc(o.v || '')}"${o.sub != null ? ` data-sub="${esc(o.sub)}"` : ''} aria-pressed="${!!o.on}">
      <span class="opstileh"><span class="scdot" data-tone="${o.tone === 'alarm' ? 'crit' : o.tone === 'attn' ? 'warn' : 'ok'}"></span><span class="ovklbl">${esc(o.label)}</span><span class="opsword" data-tone="${o.tone || 'ok'}">${esc(o.word)}</span></span>
      <span class="opstilev">${o.count}</span><span class="tCap">${esc(o.cap || '')}</span></button>`;
  }
  /* the ESG hero tile, with a value that may be a door (markup from door()) */
  const hero = (E, lbl, v, u, cap, chip, chipTone) => `<div class="pwtile"><div class="pwth"><span class="ovklbl">${esc(lbl)}</span>${chip ? `<span class="pwchip" data-tone="${chipTone || 'warn'}">${esc(chip)}</span>` : ''}</div>
      <div class="ovkval"><span class="ovknum">${String(v).startsWith('<') ? v : esc(v)}</span><span class="ovkunit">${esc(u || '')}</span></div><span class="ovkcap">${esc(cap || '')}</span></div>`;
  const drill = (key, fn) => { drills[key] = fn; };
  function dialog(E){
    const d = E.state.opsDrill; if(!d || !drills[d.key]) return '';
    const r = drills[d.key](E, d.arg) || {}, t = E.t.bind(E);
    return `<div class="scrim" data-act="closeDlg"></div><div class="dlg opsdlg" role="dialog" aria-label="${esc(r.title || '')}">
      <div class="dgmhead"><h3>${esc(r.title || '')}</h3><button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(t('close'))}">${icon('x', 13)}</button></div>
      <div class="opsdlgbody">${r.body || ''}${r.method ? `<p class="opsmethod">${icon('info', 12)}<span><b>${esc(t('ops.method'))}</b> ${esc(r.method)}</span></p>` : ''}</div></div>`;
  }
  /* small shared pieces */
  const median = a => { const s = a.filter(x => x != null).slice().sort((x, y) => x - y); if(!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (a, b) => b ? a / b * 100 : null;
  const table = (E, cols, rows, empty) => `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${cols.map(k => `<th scope="col">${esc(E.t(k))}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${cols.length}" class="alempty">${esc(E.t(empty || 'ops.none'))}</td></tr>`}</tbody></table></div>`;
  /* charts in the ESG style (esgchart, esgax): a ranked bar list, and stacked columns over days or hours */
  const TONE = { ok: 'var(--pos)', attn: 'var(--warn)', alarm: 'var(--sevCrit)', info: 'var(--link)', mute: 'var(--t3)' };
  function hbars(E, rows, o){
    o = o || {}; const W = o.w || 480, rowH = 26, X0 = o.x0 || 170, H = rows.length * rowH + 8, mx = Math.max(1, ...rows.map(r => r.v)) * 1.08, x = v => X0 + v / mx * (W - X0 - 52);
    return `<svg class="esgchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || '')}">${rows.map((r, i) => { const y = 4 + i * rowH;
      return `<text x="${X0 - 8}" y="${y + 14}" class="esgax" text-anchor="end">${esc(r.label)}</text><rect x="${X0}" y="${y + 3}" width="${Math.max(1, x(r.v) - X0).toFixed(1)}" height="15" rx="2" fill="${TONE[r.tone || 'info']}" opacity=".85"><title>${esc(r.label + ': ' + fmt(r.v, o.dp || 0) + (o.unit ? ' ' + o.unit : ''))}</title></rect>
        <text x="${(x(r.v) + 6).toFixed(1)}" y="${y + 14}" class="esgax">${esc(fmt(r.v, o.dp || 0))}</text>`; }).join('')}</svg>`;
  }
  /* series: [{ label, tone, vals }] stacked per category */
  function cols(E, cats, series, o){
    o = o || {}; const W = o.w || 480, H = o.h || 150, X0 = 30, B = 20, n = cats.length, bw = (W - X0 - 6) / n;
    const tot = cats.map((_, i) => series.reduce((s, q) => s + (q.vals[i] || 0), 0)), mx = Math.max(1, ...tot), y = v => (H - B) - v / mx * (H - B - 12);
    const bars = cats.map((c, i) => { let acc = 0; return series.map(q => { const v = q.vals[i] || 0; if(!v) return ''; const y1 = y(acc + v), y0 = y(acc); acc += v;
      return `<rect x="${(X0 + i * bw + bw * 0.18).toFixed(1)}" y="${y1.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" fill="${TONE[q.tone || 'info']}" opacity=".85"><title>${esc(c + ', ' + q.label + ': ' + fmt(v, 0))}</title></rect>`; }).join('')
      + (o.every && i % o.every ? '' : `<text x="${(X0 + i * bw + bw / 2).toFixed(1)}" y="${H - 4}" class="esgax" text-anchor="middle">${esc(c)}</text>`); }).join('');
    return `<svg class="esgchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || '')}"><text x="2" y="12" class="esgax">${esc(fmt(mx, 0))}</text><text x="2" y="${H - B}" class="esgax">0</text>
      <line x1="${X0}" x2="${W}" y1="${H - B}" y2="${H - B}" stroke="var(--bd2)"/>${bars}</svg>
      <div class="row gap12 esgleg">${series.map(q => `<span><i class="esgsw" data-l="bar" style="background:${TONE[q.tone || 'info']}"></i>${esc(q.label)}</span>`).join('')}</div>`;
  }
  /* round axis: a step of 1, 2, 2.5 or 5 times a power of ten, about n steps, the range widened to whole steps */
  function nice(lo, hi, n){ n = n || 4; if(!(hi > lo)) hi = lo + 1; const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p, a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, ticks = [];
    for(let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(6)); return { lo: a, hi: b, step, ticks }; }
  /* the tick lines and labels of a y axis */
  const yAxis = (ticks, Y, x0, x1, dp) => ticks.map(v => `<line x1="${x0}" x2="${x1}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="epgrid"/><text x="${x0 - 4}" y="${(Y(v) + 3.5).toFixed(1)}" class="esgax" text-anchor="end">${esc(fmt(v, dp || 0))}</text>`).join('');
  const linkOut = (E, k) => `<span class="opslink" data-tip="${esc(E.t('ops.linkTip'))}">${icon('external', 12)} ${esc(E.t(k))}</span>`;

  const ACTS = {
    opsDrill(el){ const E = window.EKO; E.set({ born: 'dlg', dlg: 'ops', opsDrill: { key: el.dataset.v, arg: el.dataset.arg } }); }
  };
  return { headline, val, door, tile, hero, drill, dialog, median, pct, table, linkOut, hbars, cols, TONE, nice, yAxis, ACTS };
})();
