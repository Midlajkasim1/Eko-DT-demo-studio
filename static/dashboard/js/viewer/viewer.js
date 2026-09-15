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
  const projKey = (x, y) => x + ',' + y;
  const hostSig = E => { const h = document.getElementById('enginehost'); if(!h) return '';
    const r = h.getBoundingClientRect(); return E.state.pageId + ':' + Math.round(r.width) + 'x' + Math.round(r.height); };
  /* valid only for a re-render of the SAME page with the SAME host box — a
     route change or a resize always waits for a fresh projection */
  let cacheOK = false;
  const cachedStyle = (x, y) => { const c = cacheOK && lastProj[projKey(x, y)];
    return c ? ` style="left:${c.left};top:${c.top}${c.on ? '' : ';display:none'}"` : ''; };
  const allCached = pts => cacheOK && pts.length > 0 && pts.every(p => lastProj[projKey(p.x, p.y)]);

  function markers(E){
    cacheOK = lastSig !== '' && hostSig(E) === lastSig;
    if(!E.state.markersOn) return '<div class="mklayer"></div>';
    /* alert-centre display filter (D30); only LOCATED alarms get a marker —
       an alarm without a world position has nothing to point at (D64) */
    const list = E.visAlarms().filter(a => isFinite(+a.x) && isFinite(+a.y));
    const clu = list.filter(a => a.clu);
    const rest = list.filter(a => !a.clu);
    let out = rest.map(a => marker(E,a)).join('');
    const pts = rest.slice();
    if(clu.length > 1){
      const worst = clu.find(p=>p.sev==='critical') || clu[0];
      pts.push(worst);
      out += `<button class="mk mkclu" data-x="${worst.x}" data-y="${worst.y}"${cachedStyle(worst.x, worst.y)} data-act="mkClu" data-alarm="${worst.id}" data-n="${clu.length}"
        aria-label="${C().esc(E.t('alarmsN', { n: clu.length }))}" data-tip="${C().esc(E.t('cluTip',{n:clu.length}))}">${clu.length}</button>`;
    } else { out += clu.map(a => marker(E,a)).join(''); pts.push(...clu); }
    return `<div class="mklayer"${allCached(pts) ? ' data-proj="1"' : ''}>${out}</div>`;
  }
  const marker = (E,a) =>
    `<button class="mk" data-x="${a.x}" data-y="${a.y}" data-act="mkOpen" data-alarm="${a.id}"${cachedStyle(a.x, a.y)}
       data-pulse="${E.state.mkPulse===a.id?1:0}" aria-label="${C().esc(a.asset)}" data-tip="${C().esc(a.asset)}">
       ${C().sevGlyph(a.sev, !!a.ack, 16, true)}</button>`;
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
      const p = E.engine.worldToScreen({ x:+el.dataset.x, y:+el.dataset.y });
      const on = p.visible && p.x >= 0 && p.x <= hr.width && p.y >= 0 && p.y <= hr.height;
      const left = (p.x + hr.left - lr.left).toFixed(1) + 'px', top = (p.y + hr.top - lr.top).toFixed(1) + 'px';
      el.style.left = left; el.style.top = top;
      el.style.display = on ? '' : 'none';
      lastProj[projKey(+el.dataset.x, +el.dataset.y)] = { left, top, on };
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
      const p = E.engine.worldToScreen({ x:+pop.dataset.x, y:+pop.dataset.y });
      const inView = p.visible && p.x >= 0 && p.x <= hr.width && p.y >= 0 && p.y <= hr.height;
      if(!inView){ if(E.state.mkPop){ E.state.mkPop = null; E.set({}); } return; }   /* D128: the marker left the view — the popup goes with it */
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
    }
  }

  /* D128: the two-step marker interaction. A marker click opens THIS popup,
     anchored to the marker (position() places it); "Details" opens the docked
     asset panel. Severity chip · plain asset name with its code · the alarm's
     two lines · impact where known · Details (primary) · Create work order. */
  function mkPop(E){
    const a = E.state.mkPop && E.alarm(E.state.mkPop);
    if(!a) return '';
    const t = E.t.bind(E), esc = C().esc, ar = E.lang === 'ar';
    const asset = (E.data.assets || []).find(x => x.id === a.asset) || {};
    const name = ar ? (asset.typeAr || asset.typeEn || a.asset) : (asset.typeEn || a.asset);
    const zone = ar ? (asset.zoneAr || asset.zone || '') : (asset.zone || '');
    const l = E.alarmLines(a, false);
    const woDone = E.state.woRaised[a.asset];
    const n = E.state.mkPopN || 0;
    return `<div class="mkpop mzglass col gap8" data-x="${a.x}" data-y="${a.y}" data-born="${E.state.born==='pop'?1:0}" role="dialog" aria-label="${esc(name + ' ' + a.asset)}">
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

  /* Timeline scrub bar — reference anatomy: 56px glass bar, LIVE/HISTORY
     segs, prev/next event, metric segs, slider with curve + event dots. */
  function timeline(E){
    const t = E.t.bind(E);
    /* Range selector (D31): 6 h and Day render from the 24 h feed; 3 d and
       Custom need a history feed the fixtures do not carry, so they render
       disabled with an honest tooltip (same rule as the capability dock). */
    const range = E.state.tlRange === '6h' ? 6 : 24;
    const src = E.data.load24hMw;
    const series = range === 24 ? src : src.slice(-Math.max(2, Math.round(src.length * range / 24)));
    const tr = ekoTrend(series, 480, 26);
    const asOfH = parseInt((E.data.basis.asOf || '14:00'), 10) || 14;
    const step = range === 24 ? 6 : 2;
    const labels = [];
    for(let h = (range === 24 ? 0 : asOfH - range); h <= (range === 24 ? 12 : asOfH); h += step)
      labels.push(String((h + 24) % 24).padStart(2, '0') + ':00');
    const axis = `<span class="tlaxis" aria-hidden="true">${labels.map(l =>
      `<i>${l}</i>`).join('')}</span>`;
    const cur = E.state.histAge;
    const evs = E.events().filter(a => a.ageH <= range).map(a => {
      return `<button class="scrubev tipU" style="left:${(1-a.ageH/range)*100}%"
        data-act="tlEvent" data-age="${a.ageH}"
        data-tip="${C().esc(E.t('tlEventTip',{time:E.ph(a.raised),what:a.asset}))}"
        aria-label="${C().esc(a.asset)}">${C().sevGlyph(a.sev, !!a.ack, 9, true)}</button>`;
    }).join('');
    const seg = (lbl, on, act, v, extra) =>
      `<button class="seg" data-on="${on}" data-act="${act}" ${v?`data-v="${v}"`:''}>${extra||''}${C().esc(lbl)}</button>`;
    const stale = !!E.state.stale && cur == null;   /* D121: the timeline shows its last-known window, marked stale */
    return `<div class="scrubbar" role="group" aria-label="${C().esc(t('history'))}" data-stale="${stale ? 1 : 0}">
      <div class="row gap8 flexnone">
        <div class="segbox row" role="group">
          ${seg(t(E.state.offline ? 'liveOffline' : E.state.degraded ? 'liveDegraded' : 'segLive'), cur==null, 'tlLive', '', '<span class="livedot"></span>')}
          ${seg(t('segHistory'), cur!=null, 'tlHist')}
        </div>
        <button class="iconbtn icon26 tipU dirx" data-act="tlPrev" data-tip="${C().esc(t('prevEvent'))}" aria-label="${C().esc(t('prevEvent'))}">${C().icon('chevL',13,2)}</button>
        <button class="iconbtn icon26 tipU dirx" data-act="tlNext" data-tip="${C().esc(t('nextEvent'))}" aria-label="${C().esc(t('nextEvent'))}" ${cur==null?'disabled':''}>${C().icon('chevR',13,2)}</button>
        <div class="segbox row" role="group" aria-label="${C().esc(t('tlMetricKwh'))}">
          ${seg('kWh', E.state.tlMetric==='kwh', 'tlMetric', 'kwh')}
          ${seg('AED', E.state.tlMetric==='aed', 'tlMetric', 'aed')}
          ${seg('CO2', E.state.tlMetric==='co2', 'tlMetric', 'co2')}
        </div>
        <select class="tlsel" data-chg="tlRangeSel" aria-label="${C().esc(t('history'))}" data-tip="${C().esc(t('tlNeedsHist'))}">
          <option value="6h" ${range===6?'selected':''}>${C().esc(t('tlR6h'))}</option>
          <option value="day" ${range===24?'selected':''}>${C().esc(t('tlRDay'))}</option>
          <option disabled>${C().esc(t('tlR3d'))}</option>
          <option disabled>${C().esc(t('tlRCustom'))}</option>
        </select>
      </div>
      <div class="scrubtrack" data-act="tlScrub" role="slider" aria-label="${C().esc(t('history'))}"
        aria-valuemin="0" aria-valuemax="${range}" aria-valuenow="${cur==null?0:Math.round(cur)}" tabindex="0">
        <svg viewBox="0 0 480 26" preserveAspectRatio="none">
          <path d="${tr.line}" fill="none" stroke="var(--acc)" stroke-width="1.2" opacity=".8"/></svg>
        ${evs}${axis}
        ${cur!=null?`<span class="scrubcur" style="left:${(1-Math.min(cur,range)/range)*100}%"></span>`:''}
      </div>
      <span class="tMonoS flexnone${stale ? ' tlstale' : ''}" style="color:${cur==null && !stale?'var(--posTx)':'var(--warnTx)'}" ${stale ? `data-tip="${C().esc(E.state.offline ? t('pwaOffline',{t:E.state.offlineSince||''}) : t('pwaDegraded',{t:E.state.degradedSince||'', src:E.state.degradedSrc||''}))}"` : ''}>${C().esc(cur==null ? (stale ? t('tlLastKnown',{t:E.state.offlineSince||E.state.degradedSince||E.hhmmAgo(0)}) : t('tlLiveAt',{t:E.hhmmAgo(0)})) : E.hhmmAgo(cur))}</span>
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
