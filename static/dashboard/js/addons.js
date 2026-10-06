/* ============================================================================
   ADD-ONS (D125) — one entitlement model, one catalogue, one dialog.
   A module or sub-view is ACTIVE, AVAILABLE (offered as an add-on) or HIDDEN.
   The states come from data.entitlements in the site data (production: the
   tenant's licence); an administrator's overrides live in localStorage for
   the prototype. apply(E) stamps locked / hidden onto the nav document and
   the systems groups before every render, so every entry point (rail, phone
   tabs, palette, deep links, systems rows) reads ONE truth.
   The dialog states the outcome in the customer's own numbers and ends with
   one line — contact your administrator — and Close (D126: no request flow,
   nothing that needs a network or a representative). Nothing here is a
   permission: PIN and role gates keep the padlock; an add-on carries the
   plus glyph and the "Add-on" tag.
   ============================================================================ */
window.EKO_ADDONS = (function(){
  'use strict';
  const LS = 'eko-entitlements-v1';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const icon = (n, s) => window.EKO_C.icon(n, s);
  const co2Factor = E => ((E.data.basis || {}).co2KgPerKwh);   /* D135: the one emission factor, basis.co2KgPerKwh (was a second 0.41 typed here) */

  /* The catalogue: what each add-on does, in the customer's own numbers.
     figure(E) returns { key, vars } or null when the data is not there. */
  const CATALOGUE = {
    'esg':              { module: 'esg', nameKey: 'modEsg', icon: 'leaf',
                          figure: E => { const m = ((E.data.metrics || {}).energyTodayMwh), f = co2Factor(E); return m == null || f == null ? null : { key: 'ad.esg.fig', vars: { t: (m * 1000 * f / 1000).toFixed(1), f } }; } },
    'maintenance':      { module: 'maintenance', nameKey: 'modMaintenance', icon: 'wrench',
                          figure: E => { const n = (E.data.assets || []).reduce((s, a) => s + (a.wos || 0), 0); return n ? { key: 'ad.maintenance.fig', vars: { n } } : null; } },
    'security':         { module: 'security', nameKey: 'modSecurity', icon: 'shield',
                          figure: E => { const n = (E.data.alarms || []).filter(a => a.sys === 'Security').length; return { key: 'ad.security.fig', vars: { n } }; } },
    'systems.life':     { module: 'systems', sub: 'life', nameKey: 'sysLifeAmp', icon: 'shield',
                          figure: E => { const n = (E.data.alarms || []).filter(a => a.sys === 'Life safety').length; return { key: 'ad.systems.life.fig', vars: { n } }; } },
    'systems.security': { module: 'systems', sub: 'security', nameKey: 'sysSecurity', icon: 'shield',
                          figure: E => { const n = (E.data.alarms || []).filter(a => a.sys === 'Security').length; return { key: 'ad.systems.security.fig', vars: { n } }; } },
    'energy.bench':     { module: 'energy', sub: 'bench', nameKey: 'subBench', icon: 'columns',
                          figure: E => { const n = ((window.EKO_DATA || {}).portfolio || []).length; return n > 1 ? { key: 'ad.energy.bench.fig', vars: { n } } : null; } },
    'energy.fcst':      { module: 'energy', sub: 'fcst', nameKey: 'subFcst', icon: 'spark',
                          figure: E => { const m = ((E.data.metrics || {}).energyTodayKwh); return m == null ? null : { key: 'ad.energy.fcst.fig', vars: { v: m } }; } }
  };
  const KEYS = Object.keys(CATALOGUE);

  /* -------------------------------- config -------------------------------- */
  function overrides(){ try{ return JSON.parse(localStorage.getItem(LS) || '{}') || {}; }catch(e){ return {}; } }
  function saveOverrides(o){ try{ localStorage.setItem(LS, JSON.stringify(o)); }catch(e){} }
  function cfg(E){
    const base = (E.data && E.data.entitlements) || {}, o = overrides();
    return { showAddOns: o.showAddOns != null ? !!o.showAddOns : base.showAddOns !== false,
             modules: Object.assign({}, base.modules || {}, o.modules || {}),
             overridden: Object.keys(o).length > 0 };
  }
  const STATES = ['active', 'available', 'hidden'];
  function state(E, key){ const s = cfg(E).modules[key]; return STATES.includes(s) ? s : 'active'; }
  function setState(E, key, st){ const o = overrides(); o.modules = o.modules || {}; o.modules[key] = st; saveOverrides(o); }
  function setOption(E, k, v){ const o = overrides(); o[k] = v; saveOverrides(o); }
  function reset(){ try{ localStorage.removeItem(LS); }catch(e){} }

  /* Stamp locked / hidden on the nav document and the systems groups.
     locked = not active (hidden is a subset), teaser = the add-on key. */
  function apply(E){
    const c = cfg(E);
    const stamp = (obj, key) => { const st = state(E, key); obj.locked = st !== 'active'; obj.hidden = st === 'hidden' || (st === 'available' && !c.showAddOns); obj.teaser = obj.locked ? key : undefined; };
    ((E.nav || {}).modules || []).forEach(m => { if(CATALOGUE[m.id]) stamp(m, m.id); (m.subs || []).forEach(s => { const k = m.id + '.' + s.id; if(CATALOGUE[k]) stamp(s, k); }); });
    (((E.data || {}).systems || {}).groups || []).forEach(g => { const k = 'systems.' + g.id; if(CATALOGUE[k]) stamp(g, k); });
  }
  /* the add-on key that gates a route, or null */
  function lockFor(E, module, sub){
    const m = (E.nav.modules || []).find(x => x.id === module); if(!m) return null;
    if(m.locked) return m.teaser || m.id;
    const s = sub && (m.subs || []).find(x => x.id === sub); if(s && s.locked) return s.teaser || (m.id + '.' + s.id);
    return null;
  }

  /* --------------------------------- views -------------------------------- */
  /* the add-on card: shared by the dialog and the module landing page */
  function card(E, key){
    const t = E.t.bind(E), c = CATALOGUE[key] || CATALOGUE.maintenance, k = key in CATALOGUE ? key : 'maintenance';
    const fig = c.figure ? c.figure(E) : null;
    const bullets = [1, 2, 3].map(i => `<li>${icon('check', 13)}<span>${esc(t('ad.' + k + '.b' + i))}</span></li>`).join('');
    return `<div class="addon" data-key="${esc(k)}">
      <div class="adhead"><span class="adico">${icon(c.icon, 18)}</span><span class="adtag">${esc(t('ad.tag'))}</span></div>
      <h2 class="adname">${esc(t(c.nameKey))}</h2>
      <p class="adlead">${esc(t('ad.' + k + '.h'))}</p>
      <ul class="adlist">${bullets}</ul>
      ${fig ? `<div class="adfig">${icon('spark', 14)}<span>${esc(t(fig.key, fig.vars))}</span></div>` : ''}
      <p class="adcontact">${icon('info', 14)}<span>${esc(t('ad.contact'))}</span></p>
      <div class="row gap8 adacts"><button class="btnP" data-act="closeDlg">${esc(t('close'))}</button></div>
    </div>`;
  }
  function dialog(E){
    const t = E.t.bind(E), born = E.state.born === 'dlg' ? 1 : 0;
    return `<div class="scrim" data-born="${born}" data-act="closeDlg"></div>
      <div class="dlg dlgaddon" data-born="${born}" role="dialog" aria-label="${esc(t('ad.title'))}">
        <div class="draghandle"></div><div class="dlghead"><h2>${esc(t('ad.title'))}</h2>
        <button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(t('close'))}">${icon('x', 14)}</button></div>
        ${card(E, E.state.teaserKey)}
      </div>`;
  }
  /* Administration › Modules and add-ons */
  function adminBody(E){
    const t = E.t.bind(E), c = cfg(E);
    const seg = (key, v) => `<button class="seg" data-on="${state(E, key) === v}" data-act="addonState" data-key="${esc(key)}" data-v="${v}" aria-pressed="${state(E, key) === v}">${esc(t('ad.st.' + v))}</button>`;
    const rows = KEYS.map(k => { const e = CATALOGUE[k];
      return `<div class="admrow"><span class="admico">${icon(e.icon, 15)}</span><div class="col grow"><b>${esc(t(e.nameKey))}</b><span class="tCap">${esc(t('ad.' + k + '.h'))}</span></div>
        <div class="segbox row">${seg(k, 'active')}${seg(k, 'available')}${seg(k, 'hidden')}</div></div>`; }).join('');
    return `<p class="tCap admintro">${esc(t('ad.adminD'))}</p>
        <div class="admrow admopt"><div class="col grow"><b>${esc(t('ad.showAddOns'))}</b><span class="tCap">${esc(t('ad.showAddOnsD'))}</span></div>
          <div class="segbox row"><button class="seg" data-on="${c.showAddOns}" data-act="addonShow" data-v="1">${esc(t('onW'))}</button><button class="seg" data-on="${!c.showAddOns}" data-act="addonShow" data-v="0">${esc(t('offW'))}</button></div></div>
        <div class="tLbl admh">${esc(t('ad.modules'))}</div>
        <div class="admlist">${rows}</div>
        <div class="row gap8 admfoot"><span class="tCap grow">${esc(t('ad.note'))}</span>
          <button class="btnG btnSm" data-act="addonReset" ${c.overridden ? '' : 'disabled'}>${esc(t('ad.reset'))}</button></div>`;
  }
  function adminDialog(E){   /* stand-alone frame; Settings › Administration embeds adminBody (D129) */
    const t = E.t.bind(E), born = E.state.born === 'dlg' ? 1 : 0;
    return `<div class="scrim" data-born="${born}" data-act="closeDlg"></div>
      <div class="dlg dlgadm" data-born="${born}" role="dialog" aria-label="${esc(t('ad.admin'))}">
        <div class="draghandle"></div><div class="dlghead"><h2>${esc(t('ad.admin'))}</h2>
        <button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(t('close'))}">${icon('x', 14)}</button></div>
        ${adminBody(E)}</div>`;
  }

  return { CATALOGUE, KEYS, cfg, state, setState, setOption, reset, apply, lockFor, card, dialog, adminDialog, adminBody };
})();
