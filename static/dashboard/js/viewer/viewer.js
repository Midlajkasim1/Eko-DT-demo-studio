/* ============================================================================
   EKO viewer CHROME — dock, flyouts, markers, pills, timeline, popups.
   Model rendering happens behind /js/viewer/viewer-api.js; this file never
   touches engine internals. The dock reads the adapter's capability flags
   and disables unsupported tools with a tooltip.
   Geometry carried from the approved reference (see /docs/parity-diff.md).
   ============================================================================ */
window.EKO_V = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const caps = E => (E.engine && E.engine.capabilities) || {};

  /* Markers: 16px severity shapes, 1px dark outline, no glyph inside;
     clusters 20px with the count. Projected through the engine. */
  /* Last settled projection per world point (D64): a re-render emits the
     cached position inline and pre-stamps the layer, so markers never blink
     out for the two frames until the post-layout projection confirms them.
     A point with no cache (first paint, new marker) stays hidden until then. */
  const lastProj = {};
  let lastSig = '';                 /* page + host size the cache was made for */
  /* Markers cache by their data-key (alarm id, or as:<asset> for equipment
     dots — neither has a meaningful x/y on the live model); chips by x,y. */
  const projKey = (x, y, key) => key ? 'k:' + key : (+x) + ',' + (+y);
  const hostSig = E => { const h = document.getElementById('enginehost'); if(!h) return '';
    const r = h.getBoundingClientRect(); return E.state.pageId + ':' + Math.round(r.width) + 'x' + Math.round(r.height); };
  /* valid only for a re-render of the SAME page with the SAME host box — a
     route change or a resize always waits for a fresh projection */
  let cacheOK = false;
  const cachedStyle = (x, y, id) => { const c = cacheOK && lastProj[projKey(x, y, id)];
    return c ? ` style="left:${c.left};top:${c.top}${c.on ? '' : ';display:none'}"` : ''; };
  const allCached = pts => cacheOK && pts.length > 0 && pts.every(p => lastProj[projKey(p.x, p.y, p.key)]);
  /* IFC GUID of an asset via the host 3D engine; null when the equipment is
     not in the model or no host engine is attached */
  const guidOf = assetId => { const HE = window.EKO_HOST_ENGINE;
    return HE && HE.bimIdFor && assetId ? HE.bimIdFor(assetId) : null; };
  const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  /* A marker's inline position: its cached one, or — when the rest of the
     layer is cached — hidden on its own until position() places it, so a new
     marker never makes the whole layer blink. */
  const mkStyle = (x, y, key) => cachedStyle(x, y, key) || (cacheOK ? ' style="display:none"' : '');
  /* The popup's last placement, keyed by what it shows: a re-render (every
     live-data refresh) emits it in place, so an open popup never blinks out
     for the two frames until position() confirms it. */
  let lastPop = null;
  const popPlaced = E => lastPop && lastPop.key === E.state.mkPop && lastSig !== '' && hostSig(E) === lastSig
    ? ` style="left:${lastPop.left};top:${lastPop.top}" data-placed="1"` : '';
  /* Is this marker the selected equipment (E.state.paint)? Compared by model
     element, so rows sharing one element all read as selected. */
  const isSel = (E, assetId, g) => { const p = E.state.paint; return !!p && (p === assetId || (!!g && guidOf(p) === g)); };
  /* Every marker's tooltip names its equipment the same way: type · code
     ("FCU · FCU-ANC09-FF-01"), or the code alone when the type is unknown. */
  const eqName = (E, id) => { const s = (E.data.assets || []).find(x => x.id === id);
    const type = s && (E.lang === 'ar' ? (s.typeAr || s.typeEn) : s.typeEn);
    return type ? type + ' · ' + id : String(id || ''); };

  function markers(E){
    cacheOK = lastSig !== '' && hostSig(E) === lastSig;
    if(!E.state.markersOn) return '<div class="mklayer"></div>';
    /* alert-centre display filter (D30); only LOCATED alarms get a marker —
       an alarm without a world position has nothing to point at (D64) */
    const list = E.visAlarms().filter(a => (isFinite(+a.x) && isFinite(+a.y)) || a.bimId || guidOf(a.asset));
    /* Alarms on the same equipment (or the same spot) collapse into ONE
       cluster badge that opens the worst of them. */
    const where = a => guidOf(a.asset) || a.bimId || a.asset || (Math.round(a.x) + ',' + Math.round(a.y));
    const groups = new Map();
    list.forEach(a => { const k = where(a); if(!groups.has(k)) groups.set(k, []); groups.get(k).push(a); });
    let out = '';
    const pts = [];
    groups.forEach((g, loc) => {
      if(g.length === 1){ out += marker(E, g[0], loc); pts.push({ key: g[0].id }); return; }
      const worst = g.slice().sort((p, q) => (SEV_RANK[p.sev] ?? 9) - (SEV_RANK[q.sev] ?? 9))[0];
      pts.push({ key: worst.id });
      out += `<button class="mk mkclu" data-key="${C().esc(worst.id)}" data-x="${worst.x}" data-y="${worst.y}" data-z="${worst.z || ''}" data-bimid="${guidOf(worst.asset) || worst.bimId || ''}" data-asset="${C().esc(worst.asset || '')}"${mkStyle(worst.x, worst.y, worst.id)} data-act="mkClu" data-alarm="${worst.id}" data-n="${g.length}" data-sel="${isSel(E, worst.asset, loc) ? 1 : 0}"
        aria-label="${C().esc(E.t('alarmsN', { n: g.length }))}" data-tip="${C().esc(eqName(E, worst.asset) + ' · ' + E.t('cluTip',{n:g.length}))}">${g.length}</button>`;
    });
    /* Every piece of equipment located in the 3D model gets a status dot
       (green healthy, red in alarm) unless an alarm marker already sits on it.
       Several register rows can share one model element: one dot each. */
    const seen = new Set();
    (E.data.assets || []).forEach(s => {
      const g = guidOf(s.id);
      if(!g || groups.has(g) || seen.has(g)) return;
      seen.add(g);
      out += assetMarker(E, s, g);
      pts.push({ key: 'as:' + s.id });
    });
    return `<div class="mklayer"${cacheOK && pts.length ? ' data-proj="1"' : ''}>${out}</div>`;
  }
  const marker = (E, a, where) =>
    `<button class="mk" data-key="${C().esc(a.id)}" data-x="${a.x}" data-y="${a.y}" data-z="${a.z || ''}" data-bimid="${guidOf(a.asset) || a.bimId || ''}" data-asset="${C().esc(a.asset || '')}" data-act="mkOpen" data-alarm="${a.id}"${mkStyle(a.x, a.y, a.id)}
       data-sel="${isSel(E, a.asset, where) ? 1 : 0}" data-pulse="${E.state.mkPulse===a.id?1:0}" aria-label="${C().esc(a.asset)}" data-tip="${C().esc(eqName(E, a.asset))}">
       ${C().sevGlyph(a.sev, !!a.ack, 16, true)}</button>`;
  const assetMarker = (E, s, g) => {
    const esc = C().esc, tip = eqName(E, s.id), key = 'as:' + s.id, sel = isSel(E, s.id, g);
    /* the same alarm rule the engine paints the model with, so dot and model agree */
    const HE = window.EKO_HOST_ENGINE, alarm = HE && HE.isAlarmed ? HE.isAlarmed(g) : s.st === 'alarm';
    return `<button class="mk mkasset" data-key="${esc(key)}" data-bimid="${esc(g)}" data-asset="${esc(s.id)}" data-act="mkAsset"${mkStyle(null, null, key)}
       data-st="${alarm ? 'alarm' : 'ok'}" data-sel="${sel ? 1 : 0}" aria-pressed="${sel}"
       aria-label="${esc(tip)}" data-tip="${esc(tip)}"><i aria-hidden="true"></i></button>`;
  };
  const chipLayer = (chips) =>
    `<div class="pmulayer"${allCached(chips) ? ' data-proj="1"' : ''}>${chips.map(pc =>
      `<span class="pmuchip" data-x="${pc.x}" data-y="${pc.y}"${cachedStyle(pc.x, pc.y)}>${C().esc(pc.id)}</span>`).join('')}</div>`;

  /* Projection runs only against SETTLED geometry (D52): never in the same
     task as the render. Layers render without data-proj and CSS keeps their
     markers display:none until a post-layout projection stamps it, so an
     unprojected marker can never widen the page; a projected one is shown
     only when it lands INSIDE the host box (outside = hidden, never clamped
     onto the wrong building feature). */
  let projRaf = 0;
  function schedulePosition(E){
    cancelAnimationFrame(projRaf);
    projRaf = requestAnimationFrame(() => { projRaf = requestAnimationFrame(() => position(E)); });
  }
  function position(E){
    const host = document.getElementById('enginehost');
    if(!host) return;
    const hr = host.getBoundingClientRect();
    if(hr.width < 2 || hr.height < 2) return;   /* not laid out: stays hidden */
    const sig = hostSig(E);
    if(sig !== lastSig){ for(const k in lastProj) delete lastProj[k]; lastSig = sig; }
    const project = (el, lr) => {
      const p = E.engine.worldToScreen({
        x: +el.dataset.x,
        y: +el.dataset.y,
        z: el.dataset.z ? +el.dataset.z : undefined,
        bimId: el.dataset.bimid,
        asset: el.dataset.asset,
        alarm: el.dataset.alarm
      });
      const on = p.visible && p.x >= 0 && p.x <= hr.width && p.y >= 0 && p.y <= hr.height;
      const left = (p.x + hr.left - lr.left).toFixed(1) + 'px', top = (p.y + hr.top - lr.top).toFixed(1) + 'px';
      el.style.left = left; el.style.top = top;
      el.style.display = on ? '' : 'none';
      lastProj[projKey(el.dataset.x, el.dataset.y, el.dataset.key)] = { left, top, on };
    };
    const layer = document.querySelector('.mklayer');
    const lr = layer && layer.getBoundingClientRect();
    const dx = lr ? hr.left - lr.left : 0, dy = lr ? hr.top - lr.top : 0;
    if(layer){ layer.querySelectorAll('.mk').forEach(el => project(el, lr)); layer.dataset.proj = '1'; }
    /* Chips offset against their OWN layer: .pmulayer spans the whole
       viewer column in the stacked layout, so borrowing the marker layer's
       rectangle (a 0×0 anchor there) would misplace them. */
    /* D122: a chip that lands on a marker or cluster badge is nudged above
       it (data-nudge), so a meter label never hides an alarm count */
    const mks = layer ? [...layer.querySelectorAll('.mk')].filter(m => m.style.display !== 'none').map(m => m.getBoundingClientRect()) : [];
    document.querySelectorAll('.pmulayer').forEach(lay => {
      const plr = lay.getBoundingClientRect();
      const chipsHere = [...lay.querySelectorAll('.pmuchip')];
      chipsHere.forEach(el => { project(el, plr); delete el.dataset.nudge; });
      lay.dataset.proj = '1';   /* chips are display:none until the layer is projected — so measure AFTER this */
      if(mks.length) chipsHere.forEach(el => { if(el.style.display === 'none') return;
        const r = el.getBoundingClientRect();
        if(mks.some(m => r.left < m.right + 2 && r.right > m.left - 2 && r.top < m.bottom + 2 && r.bottom > m.top - 2)) el.dataset.nudge = 'up'; });
    });
    /* The marker popup anchors beside its marker's projected position on
       desktop; in the stacked layout the CSS bottom sheet owns placement,
       so no inline coordinates there. */
    const pop = document.querySelector('.mkpop[data-x]');
    if(pop && window.innerWidth >= 768){
      const p = E.engine.worldToScreen({
        x: +pop.dataset.x,
        y: +pop.dataset.y,
        z: pop.dataset.z ? +pop.dataset.z : undefined,
        bimId: pop.dataset.bimid,
        asset: pop.dataset.asset,
        alarm: pop.dataset.alarm
      });
      const inView = p.visible && p.x >= 0 && p.x <= hr.width && p.y >= 0 && p.y <= hr.height;
      if(!inView){ delete pop.dataset.placed; lastPop = null; return; }   /* the marker left the view: the popup waits, hidden, and returns with it */
      const par = (pop.offsetParent || host).getBoundingClientRect();
      const mx = p.x + hr.left - par.left, my = p.y + hr.top - par.top;   /* the marker in the popup's own frame */
      const W = par.width, H = par.height, pw = pop.offsetWidth, ph = pop.offsetHeight, GAP = 18, PAD = 8, MK = 12;
      let left, top;
      if(mx + GAP + pw <= W - PAD) left = mx + GAP;                    /* beside the marker, to the end side */
      else if(mx - GAP - pw >= PAD) left = mx - GAP - pw;              /* or the start side */
      else left = Math.max(PAD, Math.min(mx - pw / 2, W - pw - PAD));  /* or centred: then it must go above or below */
      top = Math.max(PAD, Math.min(my - ph / 2, H - ph - PAD));
      const covers = () => left < mx + MK && left + pw > mx - MK && top < my + MK && top + ph > my - MK;
      if(covers()){ top = my + GAP; if(top + ph > H - PAD) top = my - GAP - ph; if(top < PAD) top = PAD; }
      pop.style.left = left.toFixed(1) + 'px'; pop.style.top = top.toFixed(1) + 'px';
      pop.dataset.placed = '1';
      lastPop = { key: E.state.mkPop, left: pop.style.left, top: pop.style.top };
    }
  }

  /* D128: the two-step marker interaction. A marker click opens THIS popup,
     anchored to the marker (position() places it); "Details" opens the docked
     asset panel. Severity chip · plain asset name with its code · the alarm's
     two lines · impact where known · Details (primary) · Create work order. */
  function mkPop(E){
    const key = E.state.mkPop;
    if(typeof key === 'string' && key.indexOf('asset:') === 0) return assetPop(E, key.slice(6));
    const a = key && E.alarm(key);
    if(!a) return '';
    const t = E.t.bind(E), esc = C().esc, ar = E.lang === 'ar';
    const asset = (E.data.assets || []).find(x => x.id === a.asset) || {};
    const name = ar ? (asset.typeAr || asset.typeEn || a.asset) : (asset.typeEn || a.asset);
    const zone = ar ? (asset.zoneAr || asset.zone || '') : (asset.zone || '');
    const l = E.alarmLines(a, false);
    const woDone = E.state.woRaised[a.asset];
    const n = E.state.mkPopN || 0;
    return `<div class="mkpop mzglass col gap8" data-x="${a.x}" data-y="${a.y}" data-z="${a.z || ''}" data-bimid="${a.bimId || ''}" data-asset="${a.asset || ''}" data-alarm="${a.id}" data-born="${E.state.born==='pop'?1:0}"${popPlaced(E)} role="dialog" aria-label="${esc(name + ' ' + a.asset)}">
      <div class="draghandle"></div>
      <div class="row gap8 aiC"><span class="statchip" data-sev="${esc(a.sev)}">${esc(t('rpSev.' + a.sev))}</span>${a.ack ? `<span class="tCap">${esc(t('ackedShort'))}</span>` : ''}<span class="grow"></span>
        <button class="iconbtn icon26" data-act="mkClose" aria-label="${esc(t('close'))}">${C().icon('x',12)}</button></div>
      <div class="col"><b class="mkname">${esc(name)}</b><span class="tMonoS mkcode">${esc(a.asset)}${zone ? ` · ${esc(zone)}` : ''}</span></div>
      <div class="col gap2"><span class="mkwhat">${esc(l.main)}</span>${l.sub ? `<span class="mkwhat mktech">${esc(l.sub)}</span>` : ''}</div>
      ${a.impactAedMo ? `<span class="mkimpact tMonoS cWarn">${esc(t('mkImpact', { v: C().fmt(a.impactAedMo) }))}</span>` : ''}
      ${n > 1 ? `<span class="tCap">${esc(t('mkCluNote', { n }))}</span>` : ''}
      <div class="row gap6 mkacts">
        <button class="btnP btnSm" data-act="openAsset" data-asset="${esc(a.asset)}">${esc(t('details'))}</button>
        ${woDone || (E.state.woPhase||{})[a.asset]
          ? C().woBtn(E, a.asset)
          : `<button class="btnG btnSm" data-act="cwo" data-asset="${esc(a.asset)}">${esc(t('cwo'))}</button>`}
      </div></div>`;
  }

  /* The same popup for an equipment dot (no alarm marker on it): status,
     name and code, a few live readings, then Details / Create work order.
     Opened as mkPop = "asset:<id>", so every path that closes the alarm
     popup (click-away, Escape, swipe, route change) closes this one too. */
  function assetPop(E, id){
    const s = (E.data.assets || []).find(x => x.id === id);
    if(!s) return '';
    const t = E.t.bind(E), esc = C().esc, ar = E.lang === 'ar';
    const g = guidOf(id), HE = window.EKO_HOST_ENGINE;
    const alarm = HE && HE.isAlarmed && g ? HE.isAlarmed(g) : s.st === 'alarm';
    const name = ar ? (s.typeAr || s.typeEn || id) : (s.typeEn || id);
    const where = [ar ? (s.levelAr || s.level) : s.level, ar ? (s.zoneAr || s.zone) : s.zone].filter(Boolean).join(' · ');
    const params = (s.params || []).slice(0, 3);
    /* register rows that share this model element (the mapping points several at one element) */
    const also = g ? (E.data.assets || []).filter(x => x.id !== id && guidOf(x.id) === g).map(x => x.id) : [];
    const woDone = E.state.woRaised[id];
    return `<div class="mkpop mzglass col gap8" data-x="" data-y="" data-z="" data-bimid="${esc(g || '')}" data-asset="${esc(id)}" data-born="${E.state.born==='pop'?1:0}"${popPlaced(E)} role="dialog" aria-label="${esc(name + ' ' + id)}">
      <div class="draghandle"></div>
      <div class="row gap8 aiC"><span class="statchip" data-sev="${alarm ? 'high' : 'ok'}">${esc(t(alarm ? 'mkEqAlarm' : 'stNormal'))}</span><span class="grow"></span>
        <button class="iconbtn icon26" data-act="mkClose" aria-label="${esc(t('close'))}">${C().icon('x',12)}</button></div>
      <div class="col"><b class="mkname">${esc(name)}</b><span class="tMonoS mkcode">${esc(id)}${where ? ` · ${esc(where)}` : ''}</span></div>
      ${alarm ? '' : `<span class="mkwhat">${esc(t('wall.noAlarms'))}</span>`}
      ${params.length ? `<div class="mkparams">${params.map(p => `<span class="tCap mkplbl" data-tip="${esc(E.ph(p[0]))}" data-tipif="trunc">${esc(E.ph(p[0]))}</span><span class="tMonoS mkpval">${esc(p[2])}</span>`).join('')}</div>` : ''}
      ${also.length ? `<span class="tCap">${esc(also.join(', '))}</span>` : ''}
      <div class="row gap6 mkacts">
        <button class="btnP btnSm" data-act="openAsset" data-asset="${esc(id)}">${esc(t('details'))}</button>
        ${woDone || (E.state.woPhase||{})[id]
          ? C().woBtn(E, id)
          : `<button class="btnG btnSm" data-act="cwo" data-asset="${esc(id)}">${esc(t('cwo'))}</button>`}
      </div></div>`;
  }

  /* Viewport controls (D69) live in js/viewer/toolbar.js — bottom-centre
     bar, More flyout / phone sheet, radial accelerator. `dock` stays the
     name the pages and the gallery call. */
  function dock(E){ return window.EKO_VT.toolbar(E); }

  const minimap = E => `<div class="minimap mzglass mzflyin" data-born="${E.state.born==='bloom'?1:0}" aria-label="${C().esc(E.t('dockMinimap'))}">
    <svg viewBox="0 0 148 96"><rect x="4" y="4" width="140" height="88" rx="4" fill="none" stroke="var(--bd2)"/>
      <image href="${E.data.viewer.scene.images.photo}" x="8" y="8" width="132" height="80" preserveAspectRatio="xMidYMid slice" opacity=".75"/>
      <rect x="34" y="20" width="80" height="62" fill="none" stroke="var(--acc)" stroke-width="1.5" rx="2"/></svg></div>`;

  /* Corner caption (the marker toggle left the canvas in D70: it is the eye
     control in the alarm surfaces). */
  const caption = E => `<div id="vpcaption">${C().esc((E.lang==='ar'?E.data.nameAr:E.data.nameEn).toUpperCase())} · ${C().esc(E.t('capLiveModel'))}</div>`;

  /* A moment on the app's one clock (the browser's): "HH:MM" today, the
     weekday within the week ("Tue 14:00"), the date beyond ("13 Sep 14:00"). */
  function clockLabel(E, ms){
    const d = new Date(ms), now = new Date();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const day0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day0(now) - day0(d)) / 864e5);
    if(days === 0) return hm;
    const loc = E.lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB';
    return d.toLocaleDateString(loc, days > 0 && days < 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }) + ' ' + hm;
  }

  /* Timeline strip (D145 / D168 anatomy): LIVE / HISTORY, previous and next
     event, the metric modes, the window, then the curve with the alarm
     markers over a clock axis, and a caption under it all.
     The curve is the site's load as HOURLY AVERAGES in kW: data-map.js builds
     timeline24 from the meters, each hour with its real start; the standalone
     demo draws the fixture's load24hMw. AED/h and kg CO2/h are the same curve
     through the site's tariff and emission-factor records (kW × AED/kWh =
     AED/h); a mode whose record is missing (rate not above zero, or no record
     id) is not offered, and a remembered choice of it falls back to kW. The
     window rolls and ends now; 3 d and Custom need the history feed (D31). */
  function timeline(E){
    const t = E.t.bind(E), esc = C().esc, fmt = C().fmt;
    const range = E.state.tlRange === '6h' ? 6 : 24;
    const cur = E.state.histAge;
    const H = 36e5, end = Date.now(), start = end - range * H;
    const live = E.data.timeline24;
    const hourly = live && Array.isArray(live.kw)
      ? live.kw.map((v, i) => ({ t: live.start + i * live.stepMs, v }))
      : window.DASHBOARD_OVERLAY ? []          /* live mode, history not in yet: no stand-in curve */
      : (E.data.load24hMw || []).map((mw, i, a) => ({ t: Math.floor(end / H) * H - (a.length - 1 - i) * H, v: mw * 1000 }));
    /* each hour drawn at its middle (never past now); hours wholly before the window are left out */
    const pts = hourly.filter(p => p.t + H > start)
      .map(p => ({ x: (Math.max(start, Math.min(p.t + H / 2, end)) - start) / (end - start), v: p.v }));
    const vals = pts.filter(p => p.v != null).map(p => p.v);
    /* today's peak (the highest hour of Peak_Demand_his): a point above the
       curve when its hour is in the window, the scale widened to hold it */
    const peak = vals.length && live && live.peak && live.peak.v != null ? live.peak : null;
    const peakIn = !!peak && peak.t + H > start && peak.t <= end;
    const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals, peakIn ? peak.v : -Infinity) : 0;
    const Y = v => hi > lo ? 24 - (v - lo) / (hi - lo) * 22 : 13;
    let line = '', pen = false;                        /* an unreported hour breaks the line */
    pts.forEach(p => { if(p.v == null){ pen = false; return; }
      line += (pen ? 'L' : 'M') + (p.x * 480).toFixed(1) + ',' + Y(p.v).toFixed(1); pen = true; });

    const b = E.data.basis || {};
    const MODES = {
      kwh: { lbl: 'kW', rate: 1 },
      aed: b.aedPerKwh > 0 && b.tariffId ? { lbl: 'AED', rate: b.aedPerKwh, prov: b.tariffStatus === 'provisional',
        basis: t('basisTariff', { r: fmt(b.aedPerKwh, 2), id: [b.tariffId, b.tariffVersion].filter(Boolean).join(' ') }) } : null,
      co2: b.co2KgPerKwh > 0 && b.co2FactorId ? { lbl: 'CO2', rate: b.co2KgPerKwh, prov: b.co2FactorStatus === 'provisional',
        basis: t('basisEmission', { r: fmt(b.co2KgPerKwh, 2), id: b.co2FactorId }) } : null
    };
    const mk = MODES[E.state.tlMetric] ? E.state.tlMetric : 'kwh', M = MODES[mk];
    const unit = t('tlUnit.' + mk), sc = v => fmt(v * M.rate);

    /* the axis: the clock hours inside the window at their true positions,
       every 6 h on Day and every 2 h on 6 h */
    const every = range === 24 ? 6 : 2, ticks = [];
    for(const tk = new Date(start - start % 6e4); ; ){
      tk.setMinutes(60, 0, 0);                         /* the next whole hour */
      if(tk.getTime() > end) break;
      if(tk.getHours() % every) continue;
      const x = (tk.getTime() - start) / (end - start) * 100;
      ticks.push(`<i style="left:${x.toFixed(2)}%"${x < 4 ? ' data-edge="s"' : x > 96 ? ' data-edge="e"' : ''}>${String(tk.getHours()).padStart(2, '0')}:00</i>`);
    }
    const axis = `<span class="tlaxis" aria-hidden="true">${ticks.join('')}</span>`;

    /* a marker is when an alarm was RAISED, not a point on the curve */
    const evs = E.events().filter(a => a.ageH <= range).map(a => {
      const when = a.raisedAt ? clockLabel(E, a.raisedAt) : E.ph(a.raised);
      return `<button class="scrubev tipU" style="left:${(1-a.ageH/range)*100}%"
        data-act="tlEvent" data-age="${a.ageH}"
        data-tip="${esc(t('tlEventTip',{time:when,what:eqName(E, a.asset)}))}"
        aria-label="${esc(a.asset)}">${C().sevGlyph(a.sev, !!a.ack, 9, true)}</button>`;
    }).join('');

    /* the caption: what the curve is (and, in AED / CO2, the record it went
       through), and the curve's range in the mode's unit */
    const capL = t('tlHourly') + (M.basis ? ' · ' + M.basis + (M.prov ? ' · ' + t('basisProv') : '') : '');
    const capR = t('tlScale', { lo: sc(Math.min(...vals)), hi: sc(Math.max(...vals)), u: unit });
    const hh = ms => String(new Date(ms).getHours()).padStart(2, '0') + ':00';
    const capP = peak ? t('tlPeak', { v: sc(peak.v), u: unit, from: hh(peak.t), to: hh(peak.t + H) }) : '';
    const peakDot = peakIn ? `<span class="tlpeak tipU" style="left:${((Math.max(start, Math.min(peak.t + H / 2, end)) - start) / (end - start) * 100).toFixed(2)}%;top:${(4 + Y(peak.v) / 26 * 24).toFixed(1)}px" data-tip="${esc(capP)}" aria-label="${esc(capP)}"></span>` : '';
    /* no history in the window: a plain strip, no caption */
    const cap = !vals.length ? '' : `<span class="tlcap"><span class="tlcapL">${esc(capL)}</span><span class="tlcapR">${esc(capR)}</span>${capP ? `<span class="tlcapP">${esc(capP)}</span>` : ''}</span>`;
    let curVal = '';                                   /* in history: that hour's value */
    if(cur != null){ const ct = end - cur * H, hp = hourly.find(p => ct >= p.t && ct < p.t + H);
      if(hp && hp.v != null) curVal = ' · ' + sc(hp.v) + ' ' + unit; }

    const seg = (lbl, on, act, v, extra) =>
      `<button class="seg" data-on="${on}" data-act="${act}" ${v?`data-v="${v}"`:''}>${extra||''}${esc(lbl)}</button>`;
    const stale = !!E.state.stale && cur == null;   /* D121: the timeline shows its last-known window, marked stale */
    return `<div class="scrubbar" role="group" aria-label="${esc(t('history'))}" data-stale="${stale ? 1 : 0}"${!vals.length ? '' : ` data-cap="${capP ? 2 : 1}"`}>
      <div class="row gap8 flexnone">
        <div class="segbox row" role="group">
          ${seg(t(E.state.offline ? 'liveOffline' : E.state.degraded ? 'liveDegraded' : 'segLive'), cur==null, 'tlLive', '', '<span class="livedot"></span>')}
          ${seg(t('segHistory'), cur!=null, 'tlHist')}
        </div>
        <button class="iconbtn icon26 tipU dirx" data-act="tlPrev" data-tip="${esc(t('prevEvent'))}" aria-label="${esc(t('prevEvent'))}">${C().icon('chevL',13,2)}</button>
        <button class="iconbtn icon26 tipU dirx" data-act="tlNext" data-tip="${esc(t('nextEvent'))}" aria-label="${esc(t('nextEvent'))}" ${cur==null?'disabled':''}>${C().icon('chevR',13,2)}</button>
        <div class="segbox row" role="group" aria-label="${esc(t('tlMetricKwh'))}">
          ${Object.keys(MODES).filter(k => MODES[k]).map(k => seg(MODES[k].lbl, mk === k, 'tlMetric', k)).join('')}
        </div>
        <select class="tlsel" data-chg="tlRangeSel" aria-label="${esc(t('history'))}" data-tip="${esc(t('tlNeedsHist'))}">
          <option value="6h" ${range===6?'selected':''}>${esc(t('tlR6h'))}</option>
          <option value="day" ${range===24?'selected':''}>${esc(t('tlRDay'))}</option>
          <option disabled>${esc(t('tlR3d'))}</option>
          <option disabled>${esc(t('tlRCustom'))}</option>
        </select>
      </div>
      <div class="scrubtrack" data-act="tlScrub" role="slider" aria-label="${esc(t('history'))}"
        aria-valuemin="0" aria-valuemax="${range}" aria-valuenow="${cur==null?0:Math.round(cur)}" tabindex="0">
        <svg viewBox="0 0 480 26" preserveAspectRatio="none">
          <path d="${line}" fill="none" stroke="var(--acc)" stroke-width="1.2" opacity=".8"/></svg>
        ${peakDot}${evs}${axis}
        ${cur!=null?`<span class="scrubcur" style="left:${(1-Math.min(cur,range)/range)*100}%"></span>`:''}
      </div>
      <span class="tMonoS flexnone${stale ? ' tlstale' : ''}" style="color:${cur==null && !stale?'var(--posTx)':'var(--warnTx)'}" ${stale ? `data-tip="${esc(E.state.offline ? t('pwaOffline',{t:E.state.offlineSince||''}) : t('pwaDegraded',{t:E.state.degradedSince||'', src:E.state.degradedSrc||''}))}"` : ''}>${esc(cur==null ? (stale ? t('tlLastKnown',{t:E.state.offlineSince||E.state.degradedSince||E.hhmmAgo(0)}) : t('tlLiveAt',{t:E.hhmmAgo(0)})) : E.hhmmAgo(cur) + curVal)}</span>
      ${cap}
    </div>`;
  }

  /* Viewer surface. summaryHtml (the #ovp overlay) renders INSIDE vpmain,
     exactly as the reference layers it. */
  function viewer(E, config, summaryHtml){
    const t = E.t.bind(E);
    return `<main id="vpmain" data-vst="${E.state.dock.style}" data-tl="${config.timeline?1:0}">
      <div id="enginehost"></div>
      <div class="v3tint" aria-hidden="true"></div>
      <div class="v3glow" aria-hidden="true"></div>
      ${config.markers ? markers(E) : ''}
      ${config.pmuChips ? (cacheOK = lastSig !== '' && hostSig(E) === lastSig, chipLayer(E.data.power.pmuChips||[])) : ''}
      ${config.utilChips ? (cacheOK = lastSig !== '' && hostSig(E) === lastSig, chipLayer(E.data.utilLanding.chips||[])) : ''}
      ${config.heat ? window.EKO_A.heatOverlay(E) : ''}
      ${mkPop(E)}
      ${summaryHtml || ''}
      ${config.dock === 'none' ? '' : `<div id="vbottom">${window.EKO_VT.readout(E)}${dock(E)}</div>`}
      ${config.dock === 'none' ? '' : (E.state.dock.minimap ? minimap(E) : '') + window.EKO_VT.extras(E)}
      ${config.pills === false ? '' : `<div id="vcap">${config.dock === 'none' ? '' : window.EKO_VT.chip(E)}${caption(E)}</div>`}
      ${config.timeline ? timeline(E) : ''}
      ${E.state.histAge!=null?`<div class="histbanner">${C().icon('clock',12,2)} <span>${C().esc(t('viewingHist'))}: <b class="tMonoS">${C().esc(E.hhmmAgo(E.state.histAge))}</b></span> <span aria-hidden="true">·</span> <button class="histback" data-act="tlLive">${C().esc(t('backToLive'))}</button></div>`:''}
    </main>`;
  }

  function mountEngine(E){
    const host = document.getElementById('enginehost');
    if(!host) return;
    /* Init once per host; render() re-adopts the live host so the scene
       never re-mounts (no image flash on every click). */
    if(host.dataset.live !== '1'){ E.engine.init(host, E.data.viewer.scene); host.dataset.live = '1'; }
    if(window.EKO_VT) window.EKO_VT.wireCanvas(E, host);          /* D69 gestures */
    E.engine.setStyle(E.state.dock.style, E.state.dock.tone);
    E.engine.setMarkers(E.data.alarms.map(a => ({ id:a.id, assetId:a.asset, world:{x:a.x, y:a.y} })));
    /* Alarm colouring rule lives in the SHELL: colour only assets in alarm. */
    E.data.alarms.forEach(a => E.engine.setAssetColor(a.asset, `var(--sev${a.sev[0].toUpperCase()+a.sev.slice(1)})`));
    /* No synchronous projection: the first pass is the post-layout frame,
       and markers stay display:none until it stamps data-proj (D52). Every
       later settle re-projects — the scene image finishing loading (camera
       event), late font metrics, and content above the host reflowing in
       the stacked layout (size observers on the host, the body and the
       persistent #mount, which is what actually changes when the page
       column grows). Observers die with the host node on the next render. */
    schedulePosition(E);
    if(document.fonts && document.fonts.ready)
      document.fonts.ready.then(() => schedulePosition(E));
    if(window.ResizeObserver && !host._ekoRO){
      const ro = new ResizeObserver(() => {
        if(!document.contains(host)){ ro.disconnect(); host._ekoRO = null; return; }
        schedulePosition(E);
      });
      ro.observe(host); ro.observe(document.body);
      const mnt = document.getElementById('mount'); if(mnt) ro.observe(mnt);
      host._ekoRO = ro;
    }
    if(E.engine.onCameraChange && !E.engine._ekoProjHook){
      E.engine._ekoProjHook = true;
      E.engine.onCameraChange(() => { schedulePosition(E); if(window.EKO_VT) window.EKO_VT.syncReset(E); });   /* D71 */
    }
    /* D71: a measurement's value lives in the readout, never in the button */
    if(E.engine.onMeasureResult && !E.engine._ekoMeasHook){
      E.engine._ekoMeasHook = true;
      E.engine.onMeasureResult(r => E.set({ measureResult: r }));
    }
  }

  return { viewer, dock, timeline, markers, position, schedulePosition, mountEngine };
})();
