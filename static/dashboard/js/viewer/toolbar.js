/* ============================================================================
   VIEWPORT CONTROLS (D69) — the bottom-centre bar, its flyouts, the phone
   bar + FAB + More sheet, the radial accelerator and the canvas gestures.
   Everything is read from js/layouts/tools.js; labels from i18n; the engine
   is reached only through the viewer API. Direct manipulation is the
   default: Select starts off and Reset turns it off, a single click on an
   alarmed asset opens its panel, a double-click (or double-tap) frames the
   spot, drag / two-finger / wheel / pinch move the camera with no tool
   armed, a long-press or right-click opens the radial (an accelerator —
   every tool in it is also on the bar or in More). The bar mirrors in
   RTL; the scene and its gestures never do.
   ============================================================================ */
window.EKO_VT = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const T = () => window.EKO_LAYOUTS.tools;
  const caps = E => (E.engine && E.engine.capabilities) || {};
  const phone = () => window.matchMedia('(max-width:767px)').matches;
  const byId = id => T().all.find(t => t.id === id);
  const BLOOMS_MORE = ['more', 'layers', 'style', 'levels'];     /* phone sheet contents */
  const PICKERS = ['levels', 'layers', 'style'];
  /* D72: the bar is COMPOSED from what the engine declares — a tool whose
     capability is false is not shown (More says what the live model adds). */
  const avail = (E, def) => !def.cap || !!caps(E)[def.cap];
  const list = (E, ids) => ids.filter(id => avail(E, byId(id)));
  const hidden = E => T().all.filter(def => def.kind !== 'more' && !avail(E, def));

  /* ------------------------------ view state ------------------------------ */
  /* Every non-default view setting, named for people (D71). */
  const LBL = { all:'layAll', arch:'layArch', elec:'layElec', int:'layInt', mech:'layMech', str:'layStr' };
  const STY = { default:'styDefault', photo:'styPhoto', minimal:'styMinimal', xray:'styXray' };
  const levelName = (E, l) => /^L\d+$/.test(l) ? E.t('lvlName', { n: l.slice(1) }) : l;
  const styleName = (E, d) => E.t(STY[d.style] || 'styDefault');
  function viewState(E){
    const d = E.state.dock, items = [];
    if(d.level !== 'ALL') items.push({ k:'level', text: levelName(E, d.level) });
    if(d.style !== 'default') items.push({ k:'style', text: styleName(E, d) });
    if(d.layer !== 'all') items.push({ k:'layer', text: E.t(LBL[d.layer] || 'layAll') });
    if(d.minimap) items.push({ k:'minimap', text: E.t('dockMinimap') });
    return items;
  }
  const cameraMoved = E => !!(E.engine && E.engine.cameraMoved && E.engine.cameraMoved());
  const selected = E => !!(E.state.paint || E.state.mkPop || E.state.assetSel);
  const resetList = E => viewState(E).map(i => i.text).concat(cameraMoved(E) ? [E.t('camMoved')] : [], selected(E) ? [E.t('resetSel')] : []);

  /* ------------------------------ tool state ------------------------------ */
  function state(E, def){
    const d = E.state.dock, cp = caps(E);
    const dis = !!def.cap && !cp[def.cap];
    let on = false, tag = null, dot = false, muted = false;
    switch(def.id){
      case 'select': case 'measure': case 'slice': on = d.tool === def.id; break;
      case 'levels':  on = d.bloom === 'levels' || d.level !== 'ALL'; tag = d.level !== 'ALL' ? d.level : null; break;
      case 'layers':  on = d.layer !== 'all'; tag = on ? d.layer.slice(0, 2).toUpperCase() : null; break;
      case 'minimap': on = !!d.minimap; break;
      case 'style':   on = d.style !== 'default'; tag = on ? E.t(STY[d.style] || 'styDefault') : null; break;
      case 'more':    on = BLOOMS_MORE.includes(d.bloom); dot = viewState(E).length > 0; break;
      case 'reset':   on = resetList(E).length > 0; muted = !on; break;
    }
    return { dis, on, tag, dot, muted };
  }
  /* Tooltip = name + shortcut ("Measure (M)"); a disabled tool says why;
     an isolated level says what and how; Reset lists what it will reset. */
  function tip(E, def, s){
    const t = E.t.bind(E), name = t(def.label);
    if(s.dis) return name + ' · ' + t('capNeedsLive');                 /* no shortcut on a tool that cannot run */
    if(def.id === 'levels' && E.state.dock.level !== 'ALL') return t('tipShortcut', { t: t('lvlIsolatedTip', { lvl: levelName(E, E.state.dock.level) }), k: def.key });
    if(def.id === 'reset'){ const l = resetList(E); return t('tipShortcut', { t: l.length ? t('resetListTip', { list: l.join(', ') }) : name, k: def.key }); }
    return t('tipShortcut', { t: name, k: def.key });
  }
  function button(E, def, cls){
    const s = state(E, def), tp = tip(E, def, s);
    const pressed = (def.kind === 'tool' || def.kind === 'toggle' || def.kind === 'bloom' || def.kind === 'more') ? ` aria-pressed="${s.on}"` : '';
    /* Levels / Layers / Style: the state REPLACES the label ("L11", "ME",
       "B/W"); the icon stays, in the accent when on. */
    const label = (PICKERS.includes(def.id) && s.tag) ? s.tag : E.t(def.label);
    return `<button class="${cls}" data-act="vtool" data-v="${def.id}" data-k="${def.id}" data-on="${s.on}" ${s.dis ? 'data-off="1" aria-disabled="true"' : ''}${s.tag ? ' data-tag="1"' : ''}${s.muted ? ' data-muted="1"' : ''}
      data-tip="${C().esc(tp)}" data-tipat="above" aria-label="${C().esc(tp)}" aria-keyshortcuts="${C().esc(def.key)}"${pressed}>
      <span class="vtic">${C().icon(def.icon, 18)}</span>${s.dot ? '<span class="vtdot" aria-hidden="true"></span>' : ''}
      <span class="vtlbl">${C().esc(label)}</span></button>`;
  }

  /* The view-state chip: exists ONLY when something is non-default; one
     line of every non-default setting; click = reset to defaults. */
  function chip(E){
    const items = viewState(E);
    if(!items.length) return '';
    const tp = E.t('tipShortcut', { t: E.t('chipResetTip'), k: byId('reset').key });
    return `<button id="vstate" class="mzglass" data-act="vtool" data-v="reset" data-tip="${C().esc(tp)}" aria-label="${C().esc(tp)}">${items.map(i => `<span data-k="${i.k}">${C().esc(i.text)}</span>`).join('<span class="vsdot" aria-hidden="true">·</span>')}</button>`;
  }
  /* Measure readout: the value lives here, never in the button. */
  function readout(E){
    const m = E.state.measureResult;
    if(!m) return '';
    return `<div id="vreadout" class="mzglass" role="status">${C().icon('ruler', 14)}<span class="tMonoS">${C().esc(String(m.value))} ${C().esc(m.unit || '')}</span></div>`;
  }
  /* Camera moves must not re-render the app: patch the Reset button in
     place (its tooltip too) whenever the engine reports a camera change. */
  function syncReset(E){
    const btn = document.querySelector('#vbar .vtb[data-v="reset"]');
    if(!btn) return;
    const def = byId('reset'), s = state(E, def), tp = tip(E, def, s);
    btn.dataset.on = String(s.on); btn.toggleAttribute('data-muted', s.muted);
    btn.dataset.tip = tp; btn.setAttribute('aria-label', tp);
  }

  /* -------------------------------- the bar -------------------------------- */
  function toolbar(E){
    const doc = T(), t = E.t.bind(E), d = E.state.dock;
    const wrap = def => `<div class="vtw">${button(E, def, 'vtb')}${phone() ? '' : flyoutFor(E, def.id)}</div>`;
    const grp = (ids, g, lbl) => `<div class="vgrp" data-g="${g}" role="group" aria-label="${C().esc(t(lbl))}">${ids.map(id => wrap(byId(id))).join('')}</div>`;
    /* D73: every tool is on the bar (unsupported ones muted, with the reason
       in their tooltip); a small control collapses the bar to one icon. */
    if(!phone() && E.state.vbarMin){
      const tp = t('tipShortcut', { t: t('vbarExpand'), k: doc.expandKey });
      return `<button id="vbar" class="mzglass vtmin" data-act="vbarTgl" data-tip="${C().esc(tp)}" data-tipat="above" aria-label="${C().esc(tp)}" aria-expanded="false">
        ${C().icon('toolbar', 20)}${viewState(E).length ? '<span class="vtdot" aria-hidden="true"></span>' : ''}</button>${fab(E)}`;
    }
    const col = phone() ? '' : `<button class="vtb vtcol" data-act="vbarTgl" data-tip="${C().esc(t('tipShortcut', { t: t('vbarCollapse'), k: doc.expandKey }))}" data-tipat="above" aria-label="${C().esc(t('vbarCollapse'))}" aria-expanded="true">${C().icon('chevR2', 14)}</button>`;
    return `<div id="vbar" class="mzglass" role="toolbar" aria-label="${C().esc(t('dockTools'))}"${d.bloom ? ` data-bloom="${d.bloom}"` : ''}>
        ${grp(phone() ? doc.phone.bar : doc.resting, 'a', 'vbarA')}<span class="vdiv" aria-hidden="true"></span>${grp(doc.analysis, 'b', 'vbarB')}${col}</div>
      ${fab(E)}`;
  }
  /* Phone FAB = the PRIMARY action (Alarms: finding the fault is the job),
     not a drawer; it shows the visible alarm count. */
  function fab(E){
    const f = T().phone.fab, t = E.t.bind(E);
    if(typeof f === 'string') return button(E, byId(f), 'vfab mzglass');
    const n = E.visAlarms().length;
    const worst = (E.visAlarms().slice().sort((x, y) => ({ critical:0, high:1, medium:2 }[x.sev] - { critical:0, high:1, medium:2 }[y.sev]))[0] || {}).sev || 'medium';
    return `<button class="vfab mzglass" data-act="${f.act}" data-v="${f.v}" data-tip="${C().esc(t(f.tip))}" data-tipat="above"
      aria-label="${C().esc(t(f.label))}: ${n}" aria-haspopup="dialog">${C().icon(f.icon, 22)}
      ${n ? `<span class="cbadge" data-sev="${worst}">${n}</span>` : ''}</button>`;
  }
  /* The phone sheet and the radial are positioned against the scene, so
     they render at the viewer level — never inside the centred bar row. */
  function extras(E){ return (phone() ? sheet(E) : '') + radial(E); }

  /* ------------------------------- flyouts --------------------------------- */
  const panel = (E, cls, inner) =>
    `<div class="mzfly mzglass mzflyin ${cls}" data-born="${E.state.born === 'bloom' ? 1 : 0}" role="menu">${inner}</div>`;
  function flyoutFor(E, id){
    const d = E.state.dock;
    if(PICKERS.includes(id) && d.bloom === id) return panel(E, 'fly' + id[0].toUpperCase() + id.slice(1), body(E, id));
    return '';
  }
  function body(E, which){
    const d = E.state.dock, t = E.t.bind(E);
    const title = k => `<span class="mzflyT">${C().esc(t(k))}</span>`;
    const opt = (act, v, lbl, on) =>
      `<button class="mzopt mzfan" data-act="${act}" data-v="${C().esc(v)}" data-on="${!!on}">${C().esc(lbl)}</button>`;
    const back = phone() ? `<button class="mzopt vmback mzfan" data-act="vtool" data-v="more">${C().icon('chevL', 12)}<span class="grow taS">${C().esc(t('dockTools'))}</span></button>` : '';
    if(which === 'levels'){
      /* Searchable, grouped picker with a floor stepper (D72): scales to
         any storey count. Groups derive from the level code. */
      const lv = E.data.viewer.levels;
      const grpOf = l => /^roof/i.test(l) ? 'lvlGroupRoof' : /^B\d/i.test(l) ? 'lvlGroupBasement' : /^GF$/i.test(l) ? 'lvlGroupGround' : 'lvlGroupLevels';
      const groups = [];
      lv.forEach(l => { const g = grpOf(l); let G = groups.find(x => x.k === g); if(!G){ G = { k:g, items:[] }; groups.push(G); } G.items.push(l); });
      const i = lv.indexOf(d.level);
      const rows = groups.map(G => `<span class="mzflyT vpgrp">${C().esc(t(G.k))}</span>` +
        G.items.map(l => `<button class="mzopt mzfan vprow" data-act="setLevel" data-v="${C().esc(l)}" data-on="${d.level === l}" data-q="${C().esc((l + ' ' + levelName(E, l)).toLowerCase())}">${C().esc(levelName(E, l))}<span class="tCap msA">${C().esc(l)}</span></button>`).join('')).join('');
      return `<div class="vpick"><div class="row gap6 vphead">${title('dockLevels')}<span class="grow"></span>
          <button class="iconbtn icon26" data-act="lvlStep" data-v="up" data-tip="${C().esc(t('lvlUp'))}" aria-label="${C().esc(t('lvlUp'))}" ${i <= 0 && d.level !== 'ALL' ? 'disabled' : ''}>${C().icon('chevR2', 13)}</button>
          <button class="iconbtn icon26" data-act="lvlStep" data-v="down" data-tip="${C().esc(t('lvlDown'))}" aria-label="${C().esc(t('lvlDown'))}" ${(i >= lv.length - 1) ? 'disabled' : ''}>${C().icon('chevL2', 13)}</button></div>
        <input class="vpq" type="search" placeholder="${C().esc(t('pickFloor'))}" aria-label="${C().esc(t('pickFloor'))}" autocomplete="off">
        <div class="vplist">${opt('setLevel', 'ALL', t('lvlAll'), d.level === 'ALL').replace('class="mzopt', 'class="vprow mzopt').replace('data-on', 'data-q="all ' + C().esc(t('lvlAll').toLowerCase()) + '" data-on')}${rows}</div></div>`;
    }
    if(which === 'more'){
      const note = '';
      return title('dockTools') + T().more.map(id => {
        const def = byId(id), s = state(E, def), tp = tip(E, def, s);
        return `<button class="mzopt vmrow mzfan" data-act="vtool" data-v="${id}" data-k="${id}" data-on="${s.on}" ${s.dis ? 'data-off="1" aria-disabled="true"' : ''}
          data-tip="${C().esc(tp)}" aria-label="${C().esc(tp)}">${C().icon(def.icon, 16)}<span class="grow taS">${C().esc(t(def.label))}</span>
          ${s.tag ? `<span class="vmtag" data-on="${s.on}">${C().esc(s.tag)}</span>` : ''}${def.kind === 'bloom' ? C().icon('chevR', 12) : ''}</button>`;
      }).join('') + note;
    }
    if(which === 'layers'){
      const rows = E.data.viewer.layers.map(l => `<button class="mzopt mzfan vprow" data-act="setLayer" data-v="${C().esc(l)}" data-on="${d.layer === l}" data-q="${C().esc((l + ' ' + t(LBL[l])).toLowerCase())}">${C().esc(t(LBL[l]))}</button>`).join('');
      return back + `<div class="vpick">${title('dockLayers')}
        <input class="vpq" type="search" placeholder="${C().esc(t('pickLayer'))}" aria-label="${C().esc(t('pickLayer'))}" autocomplete="off">
        <div class="vplist">${rows}</div></div>`;
    }
    if(which === 'style'){
      const DEFS = [['default', t('styDefault')], ['photo', t('styPhoto')], ['minimal', t('styMinimal')], ['xray', t('styXray')]];
      const tiles = DEFS.map(sd =>
        `<button class="mztile mzfan" data-act="setStyle" data-v="${sd[0]}" data-on="${d.style === sd[0]}">
           <span class="mztileimg tpl-shot" data-sty="${sd[0]}" aria-hidden="true"><span class="tpl-sun"></span><span class="tpl-ground"></span><span class="tpl-mass tpl-mass--tall"></span><span class="tpl-mass tpl-mass--low"></span></span>
           <span class="mztilelbl">${C().esc(sd[1])}</span></button>`).join('');
      const TONES = { blue:'#29a8df', white:'#e8eef4' };
      const tones = d.style === 'xray'
        ? `<span class="mzflyT">${C().esc(t('xrayToneT'))}</span><div class="row gap8">${Object.keys(TONES).map(tn =>
            `<button class="mztone" data-act="setTone" data-v="${tn}" data-on="${(d.tone || 'blue') === tn}"
               style="background:${TONES[tn]}" data-tip="${C().esc(t('tone' + tn[0].toUpperCase() + tn.slice(1)))}"
               aria-label="${C().esc(t('tone' + tn[0].toUpperCase() + tn.slice(1)))}"></button>`).join('')}</div>` : '';
      return back + title('dockStyle') + `<div class="mztilegrid">${tiles}</div>${tones}`;
    }
    return '';
  }

  /* Phone: every flyout is ONE bottom sheet (Levels from the bar, More from
     the FAB; Layers/Style open inside it with a back row). */
  function sheet(E){
    const d = E.state.dock;
    if(!d.bloom) return '';
    const born = E.state.born === 'bloom' ? 1 : 0;
    return `<div class="scrim" data-born="${born}" data-act="vtool" data-v="closeMore"></div>
      <div class="dlg vsheet" data-born="${born}" role="dialog" aria-label="${C().esc(E.t('dockTools'))}">
        <div class="draghandle"></div>${body(E, d.bloom)}</div>`;
  }

  /* ------------------------------- radial ---------------------------------- */
  function radial(E){
    const r = E.state.radial;
    if(!r) return '';
    const doc = T(), ids = doc.radial, n = ids.length, R = doc.metrics.radialR;
    const dir = (window.DASHBOARD_ROOT||document.documentElement).dir === 'rtl' ? -1 : 1;      /* mirrors the ring order */
    const items = ids.map((id, i) => {
      const def = byId(id), s = state(E, def), tp = tip(E, def, s);
      const a = -Math.PI / 2 + i * 2 * Math.PI / n;
      const x = Math.cos(a) * R * dir, y = Math.sin(a) * R;
      return `<button class="vrb" data-act="vtool" data-v="${id}" data-k="${id}" data-on="${s.on}" ${s.dis ? 'data-off="1" aria-disabled="true"' : ''}
        data-tip="${C().esc(tp)}" aria-label="${C().esc(tp)}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">${C().icon(def.icon, 18)}</button>`;
    }).join('');
    return `<div class="vradial" role="menu" aria-label="${C().esc(E.t('dockTools'))}" data-born="${E.state.born === 'radial' ? 1 : 0}"
      style="left:${r.x}px;top:${r.y}px"><span class="vrc" aria-hidden="true"></span>${items}</div>`;
  }

  /* --------------------------- canvas gestures ----------------------------- */
  /* The adapter owns drag / two-finger / pinch / wheel. The shell adds the
     semantic gestures: double-click / double-tap = frame, long-press /
     right-click = radial. Never on chrome or markers. */
  const IGN = '.mk,.mkpop,#vbar,.mzfly,.vradial,.scrubbar,.minimap,.vsheet,.scrim,.vfab';
  function wireCanvas(E, host){
    if(host._ekoGest) return;
    host._ekoGest = true;
    const M = () => T().metrics;
    const vp = () => document.getElementById('vpmain');
    const openRadial = ev => {
      const vr = vp().getBoundingClientRect(), hr = host.getBoundingClientRect();
      const R = M().radialR + 26;
      const x = Math.max(hr.left - vr.left + R, Math.min(hr.right - vr.left - R, ev.clientX - vr.left));
      const y = Math.max(hr.top - vr.top + R, Math.min(hr.bottom - vr.top - R, ev.clientY - vr.top));
      if(window.EKO_PWA && window.EKO_PWA.haptic) window.EKO_PWA.haptic('snap');
      E.set({ born:'radial', radial:{ x: Math.round(x), y: Math.round(y) } });
    };
    const focus = ev => {
      const r = host.getBoundingClientRect();
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      if(E.engine.focusAt) E.engine.focusAt({ x: p.x, y: p.y, scale: M().focusScale });
      const rip = document.createElement('span');
      rip.className = 'mzripple vfocus'; rip.style.left = p.x.toFixed(0) + 'px'; rip.style.top = p.y.toFixed(0) + 'px';
      host.appendChild(rip); setTimeout(() => rip.remove(), 420);
    };
    let down = null, hold = null, holdFired = false, lastTap = null;
    host.addEventListener('pointerdown', ev => {
      if(ev.target.closest(IGN)) return;
      down = { x: ev.clientX, y: ev.clientY, b: ev.button, t: Date.now(), pt: ev.pointerType };
      clearTimeout(hold); hold = null; holdFired = false;
      if(ev.pointerType === 'touch' && ev.isPrimary)
        hold = setTimeout(() => { hold = null; holdFired = true; openRadial(ev); }, M().holdMs);
    }, true);
    host.addEventListener('pointermove', ev => {
      if(hold && down && (Math.abs(ev.clientX - down.x) > 10 || Math.abs(ev.clientY - down.y) > 10)){ clearTimeout(hold); hold = null; }
    }, true);
    host.addEventListener('pointerup', ev => {
      clearTimeout(hold); hold = null;
      if(ev.pointerType !== 'touch' || !down || holdFired) return;
      const moved = Math.abs(ev.clientX - down.x) > 12 || Math.abs(ev.clientY - down.y) > 12;
      if(moved) return;
      const now = Date.now();
      if(lastTap && now - lastTap.t < M().dblTapMs && Math.abs(ev.clientX - lastTap.x) < 24 && Math.abs(ev.clientY - lastTap.y) < 24){
        lastTap = null; focus(ev);
      } else lastTap = { x: ev.clientX, y: ev.clientY, t: now };
    }, true);
    host.addEventListener('pointercancel', () => { clearTimeout(hold); hold = null; }, true);
    host.addEventListener('dblclick', ev => {
      if(ev.target.closest(IGN)) return;
      if(down && down.pt === 'touch') return;                 /* the tap path already framed */
      focus(ev);
    });
    host.addEventListener('contextmenu', ev => {
      if(ev.target.closest(IGN)) return;
      ev.preventDefault();
      /* a right-DRAG is a pan, not a request for the menu */
      if(down && down.b === 2 && (Math.abs(ev.clientX - down.x) > 6 || Math.abs(ev.clientY - down.y) > 6)) return;
      if(ev.button === 0 && down && down.pt === 'touch') return;   /* touch long-press handled above */
      openRadial(ev);
    });
  }

  /* Type-ahead in the pickers filters rows in place (no re-render: the field
     keeps focus). Enter picks the first visible row. */
  document.addEventListener('input', ev => {
    const q = ev.target;
    if(!(q instanceof HTMLInputElement) || !q.classList.contains('vpq')) return;
    const needle = q.value.trim().toLowerCase();
    const box = q.closest('.vpick');
    if(!box) return;                                   /* another .vpq-styled field (Help) */
    box.querySelectorAll('.vprow').forEach(r => { r.hidden = !!needle && !(r.dataset.q || '').includes(needle); });
    box.querySelectorAll('.vpgrp').forEach(g => { let n = g.nextElementSibling, any = false;
      while(n && !n.classList.contains('vpgrp')){ if(!n.hidden) any = true; n = n.nextElementSibling; } g.hidden = !any; });
  });
  document.addEventListener('keydown', ev => {
    const q = ev.target;
    if(!(q instanceof HTMLInputElement) || !q.classList.contains('vpq')) return;
    const box = q.closest('.vpick'); if(!box) return;
    if(ev.key === 'Enter'){ const r = [...box.querySelectorAll('.vprow')].find(x => !x.hidden); if(r) r.click(); ev.preventDefault(); }
    if(ev.key === 'ArrowDown'){ const r = [...box.querySelectorAll('.vprow')].find(x => !x.hidden); if(r) r.focus(); ev.preventDefault(); }
  });

  return { toolbar, extras, body, radial, sheet, chip, readout, syncReset, viewState, wireCanvas, state, tip, byId, phone, avail, list, hidden };
})();
