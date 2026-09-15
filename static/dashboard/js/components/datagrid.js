/* ============================================================================
   DATA GRID (D100) — the shared data-table component. The asset register is
   its first user; the portfolio site list is built from the same component
   with a different column spec. A grid is a SPEC (columns, rows, views,
   bulk actions) plus per-user STATE (view, columns, widths, sort, filters,
   grouping, density, selection) persisted in localStorage.

   spec = { id, rows(E)→[], rowKey, rowAct:{act, attr}, searchKeys:[k],
            columns:[{ key, labelKey, type:'text'|'enum'|'num'|'date'|'bool',
                       get(E,r)→raw, text(E,r)→string, cell?(E,r)→html,
                       enumOpts?(E)→[{v,label}], width, def, mono, mob }],
            views:[{ id, nameKey, cols, sort, filters, group, density }],
            bulk:[{ id, labelKey, icon }], head(E)→html, exportName }
   Laws: flush grid (no card frame), hairline header rule and row separators,
   sticky header, hover highlight, selected row = leading accent bar, row
   height from density; filters AND together; every column sorts, Shift adds
   a sort level; proper table semantics with announced sort state and
   keyboard navigation across cells; ≤1023 menus become sheets; ≤767 rows
   become stacked cards; 48px targets on touch.
   ============================================================================ */
window.EKO_DG = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = s => C().esc(s);
  const icon = (n, s) => C().icon(n, s);
  const DENS = ['compact', 'standard', 'comfortable'];
  const user = E => (E.data.user && E.data.user.name) || 'user';
  const LS = (E, spec, part) => 'eko-dg-' + spec.id + '-' + part + '-' + user(E);
  const specs = {};

  /* ---------------------------- state ------------------------------------ */
  function st(E, spec){
    E.state.dg = E.state.dg || {};
    let s = E.state.dg[spec.id];
    if(!s){ s = load(E, spec); E.state.dg[spec.id] = s; }
    if(spec.consume) spec.consume(E, s);           /* entries from other pages become filters */
    return s;
  }
  function load(E, spec){
    let saved = null; try{ saved = JSON.parse(localStorage.getItem(LS(E, spec, 'prefs')) || 'null'); }catch(e){}
    const s = { views:(saved && saved.views) || [], defaultView:(saved && saved.defaultView) || spec.views[0].id, widths:(saved && saved.widths) || {},
      order:spec.columns.map(c => c.key), open:new Set(), page:0, scrollTop:0,
      view:null, cols:[], sort:[], filters:{}, group:null, density:'standard', q:'', sel:new Set(), selAll:false, menu:null, live:'', dirty:false, tagDraft:'' };
    applyView(E, spec, s, s.defaultView);
    return s;
  }
  const allViews = (spec, s) => spec.views.concat(s.views);
  function applyView(E, spec, s, id){
    const v = allViews(spec, s).find(x => x.id === id) || spec.views[0];
    s.view = v.id; s.cols = v.cols.slice(); s.order = v.cols.concat((s.order || spec.columns.map(c => c.key)).filter(k => !v.cols.includes(k))); s.sort = (v.sort || []).map(x => Object.assign({}, x));
    s.filters = JSON.parse(JSON.stringify(v.filters || {})); s.group = v.group || null; s.density = v.density || 'standard'; s.dirty = false;
  }
  function persist(E, spec, s){ try{ localStorage.setItem(LS(E, spec, 'prefs'), JSON.stringify({ views:s.views, defaultView:s.defaultView, widths:s.widths })); }catch(e){} }
  const colMap = spec => { const m = {}; spec.columns.forEach(c => m[c.key] = c); return m; };
  /* D101: the visible columns in the user's order (s.order holds every column, shown or not) */
  const isCards = spec => window.innerWidth <= (spec.cardsBelow || 767);
  const visCols = (spec, s, all) => { const m = colMap(spec); return s.order.filter(k => s.cols.includes(k) && m[k]).map(k => m[k]).filter(c => all || !c.hideBelow || isCards(spec) || window.innerWidth > c.hideBelow); };   /* D103: hideBelow drops a column under a width in table mode; cards keep their whole anatomy; the shell re-renders on resize */
  const savedViews = (E, spec) => st(E, spec).views;
  const defCols = spec => spec.columns.filter(c => c.def).map(c => c.key);
  const viewName = (E, spec, v) => v.nameKey ? E.t(v.nameKey) : v.name;

  /* ---------------------------- pipeline --------------------------------- */
  function match(E, c, r, f){
    const v = c.get(E, r);
    switch(c.type){
      case 'text': return !f.q || String(c.text(E, r)).toLowerCase().includes(String(f.q).toLowerCase());
      case 'enum': return !f.in || !f.in.length || f.in.includes(v == null ? '' : String(v));
      case 'num':  return (f.min == null || f.min === '' || v >= +f.min) && (f.max == null || f.max === '' || v <= +f.max);
      case 'date': { if(!f.from && !f.to) return true; if(v == null) return false; const t = +v;
        return (!f.from || t >= +new Date(f.from)) && (!f.to || t <= +new Date(f.to) + 86399999); }
      case 'bool': return f.is == null || f.is === '' ? true : (!!v === (f.is === true || f.is === 'true'));
    }
    return true;
  }
  const active = f => f && Object.values(f).some(x => x != null && x !== '' && !(Array.isArray(x) && !x.length));
  function compare(a, b){ if(a == null && b == null) return 0; if(a == null) return 1; if(b == null) return -1;
    if(typeof a === 'number' && typeof b === 'number') return a - b; if(a instanceof Date && b instanceof Date) return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric:true }); }
  function rowsOf(E, spec, s){
    const cols = colMap(spec);
    let rows = spec.rows(E).slice();
    if(s.q){ const q = s.q.toLowerCase(); rows = rows.filter(r => (spec.searchKeys || [spec.columns[0].key]).some(k => String(cols[k].text(E, r)).toLowerCase().includes(q))); }
    Object.keys(s.filters).forEach(k => { const c = cols[k], f = s.filters[k]; if(c && active(f)) rows = rows.filter(r => match(E, c, r, f)); });
    const sorts = s.sort.filter(o => cols[o.key]);
    if(s.group && cols[s.group]) sorts.unshift({ key:s.group, dir:'asc' });
    if(sorts.length) rows.sort((a, b) => { for(const o of sorts){ const c = cols[o.key];
      const cmp = compare(c.sortVal ? c.sortVal(E, a) : c.get(E, a), c.sortVal ? c.sortVal(E, b) : c.get(E, b)); if(cmp) return o.dir === 'desc' ? -cmp : cmp; } return 0; });
    return rows;
  }

  /* ---------------------------- rendering -------------------------------- */
  const chipCount = (E, spec, s) => Object.keys(s.filters).filter(k => active(s.filters[k])).length + (s.q ? 1 : 0);
  function filterChipText(E, c, f){
    const t = E.t.bind(E);
    switch(c.type){
      case 'text': return `${t(c.labelKey)}: ${f.q}`;
      case 'enum': return `${t(c.labelKey)}: ${(f.in || []).map(v => enumLabel(E, c, v)).join(', ')}`;
      case 'num':  return `${t(c.labelKey)}: ${f.min != null && f.min !== '' ? f.min : '…'}–${f.max != null && f.max !== '' ? f.max : '…'}`;
      case 'date': return `${t(c.labelKey)}: ${f.from || '…'} → ${f.to || '…'}`;
      case 'bool': return `${t(c.labelKey)}: ${t(f.is === true || f.is === 'true' ? 'dgf.yes' : 'dgf.no')}`;
    }
    return t(c.labelKey);
  }
  const enumLabel = (E, c, v) => { const o = (c.enumOpts ? c.enumOpts(E) : []).find(x => String(x.v) === String(v)); return o ? o.label : String(v); };

  function render(E, spec){
    const s = st(E, spec), t = E.t.bind(E), cols = colMap(spec);
    const rows = rowsOf(E, spec, s), total = spec.rows(E).length;
    /* D103: a change of query, filters, sort or grouping returns to page 1; pages are slices of the matching rows */
    const sig = JSON.stringify([s.q, s.filters, s.sort, s.group]); if(s._sig !== sig){ s._sig = sig; s.page = 0; }
    const ps = spec.pageSize || 0, pages = ps ? Math.max(1, Math.ceil(rows.length / ps)) : 1;
    if(s.page >= pages) s.page = pages - 1; if(s.page < 0) s.page = 0;
    const pageRows = ps ? rows.slice(s.page * ps, s.page * ps + ps) : rows;
    const selectable = spec.selectable !== false, pinKey = spec.pinKey || 'id';
    const vis = visCols(spec, s), extra = (spec.expand ? 1 : 0) + (spec.rowMenu ? 1 : 0), span = vis.length + (selectable ? 1 : 0) + extra;
    const sortOf = k => s.sort.find(o => o.key === k);
    const rk = r => r[spec.rowKey];
    const allSel = pageRows.length > 0 && pageRows.every(r => s.sel.has(rk(r)));
    /* toolbar */
    const bar = `<div class="dgbar">${spec.head ? spec.head(E, rows.length, total) : ''}
      <div class="askbox dgqbox"><span class="dgqi">${icon('search', 13)}</span><input class="dgq" value="${esc(s.q)}" placeholder="${esc(t(spec.searchPh || 'regSearchPh'))}" aria-label="${esc(t('dgSearch'))}"></div>
      <button class="btnG btnSm dgbtn" data-act="dgMenu" data-v="views" aria-haspopup="menu" aria-expanded="${s.menu === 'views'}">${icon('bookmark', 13)} ${esc(viewName(E, spec, allViews(spec, s).find(v => v.id === s.view) || spec.views[0]))}${s.dirty ? ` <span class="dgdirty" data-tip="${esc(t('dgViewModified'))}">•</span>` : ''} ${icon('chevD', 11)}</button>
      ${E.stacked() ? `<button class="btnG btnSm dgbtn" data-act="dgMenu" data-v="filters" aria-haspopup="dialog" aria-expanded="${s.menu === 'filters'}" data-on="${chipCount(E, spec, s) > 0}">${icon('filter', 13)} ${esc(t('dgFilters'))}${chipCount(E, spec, s) ? ` <span class="cbadge" data-sev="medium">${chipCount(E, spec, s)}</span>` : ''}</button>` : ''}
      <button class="btnG btnSm dgbtn" data-act="dgMenu" data-v="cols" aria-haspopup="dialog" aria-expanded="${s.menu === 'cols'}">${icon('columns', 13)} ${esc(t('dgCols'))}</button>
      <button class="btnG btnSm dgbtn" data-act="dgMenu" data-v="display" aria-haspopup="menu" aria-expanded="${s.menu === 'display'}">${icon('layout', 13)} ${esc(t('dgDisplay'))}</button>
      <button class="btnG btnSm dgbtn" data-act="dgMenu" data-v="export" aria-haspopup="menu" aria-expanded="${s.menu === 'export'}">${icon('download', 13)} ${esc(t('dgExport'))}</button></div>`;
    /* filter chips */
    const chips = Object.keys(s.filters).filter(k => cols[k] && active(s.filters[k])).map(k => `<button class="chip dgchip" data-on="true" data-act="dgFiltClear" data-k="${k}" aria-label="${esc(t('dgRemoveFilter', { f: filterChipText(E, cols[k], s.filters[k]) }))}">${esc(filterChipText(E, cols[k], s.filters[k]))} ${icon('x', 10)}</button>`);
    if(s.q) chips.unshift(`<button class="chip dgchip" data-on="true" data-act="dgQClear" aria-label="${esc(t('dgRemoveFilter', { f: s.q }))}">${esc(t('dgSearch'))}: ${esc(s.q)} ${icon('x', 10)}</button>`);
    const chiprow = chips.length ? `<div class="dgchips" role="group" aria-label="${esc(t('dgActiveFilters'))}">${chips.join('')}<button class="statlink dgclear" data-act="dgClearAll">${esc(t('dgChipClear'))}</button></div>` : '';
    /* D103: facet chips — one tag-based filter engine; each opens the column's own filter, shown or not */
    const facets = (spec.facets || []).length ? `<div class="dgfacets" role="group" aria-label="${esc(t('dgFacets'))}"><span class="tCap dgflbl">${esc(t('dgFacets'))}</span>${spec.facets.map(k => { const c = cols[k]; if(!c) return ''; const on = active(s.filters[k]); const n = on && s.filters[k].in ? s.filters[k].in.length : 0;
        return `<button class="chip dgfacet" data-on="${on}" data-act="dgMenu" data-v="filter:${k}" aria-haspopup="dialog" aria-expanded="${s.menu === 'filter:' + k}">${esc(t(c.labelKey))}${n ? ` <span class="cbadge">${n}</span>` : ''} ${icon('chevD', 10)}</button>`; }).join('')}${(spec.groupBy || []).length ? `<span class="dgfsep" aria-hidden="true"></span><button class="chip dgfacet" data-on="${!!s.group}" data-act="dgMenu" data-v="group" aria-haspopup="menu" aria-expanded="${s.menu === 'group'}">${icon('layers', 11)} ${esc(s.group && cols[s.group] ? t('dgGroupBy', { col:t(cols[s.group].labelKey) }) : t('dgGroup'))} ${icon('chevD', 10)}</button>` : ''}</div>` : '';
    /* selection bar */
    const nSel = s.selAll ? rows.length : [...s.sel].filter(id => rows.some(r => rk(r) === id)).length;
    const selbar = nSel ? `<div class="dgselbar" role="region" aria-label="${esc(t('dgSelN', { n:nSel }))}"><b>${esc(t('dgSelN', { n:nSel }))}</b>
      ${!s.selAll && allSel && rows.length > nSel ? `<button class="statlink" data-act="dgSelAll">${esc(t('dgSelAll', { n:rows.length }))}</button>` : ''}
      <span class="grow"></span>
      ${(spec.bulk || []).map(b => `<button class="btnG btnSm" data-act="dgBulk" data-v="${b.id}">${icon(b.icon || 'check', 12)} ${esc(t(b.labelKey))}</button>`).join('')}
      ${s.menu === 'tag' ? `<span class="row gap6 dgtagrow"><input class="dgtagin" placeholder="${esc(t('dgTagPh'))}" aria-label="${esc(t('dgTagPh'))}" value="${esc(s.tagDraft)}"><button class="btnP btnSm" data-act="dgBulkTagApply">${esc(t('dgApply'))}</button></span>` : ''}
      <button class="iconbtn" data-act="dgSelClear" aria-label="${esc(t('dgSelClear'))}" data-tip="${esc(t('dgSelClear'))}">${icon('x', 13)}</button></div>` : '';
    /* header */
    const th = c => { const so = sortOf(c.key), n = s.sort.indexOf(so) + 1;
      return `<th scope="col" role="columnheader" data-k="${c.key}" aria-sort="${so ? (so.dir === 'desc' ? 'descending' : 'ascending') : 'none'}" style="width:${(s.widths[c.key] || fitW(E, spec, c.key) || c.width || 140)}px" class="${c.align === 'end' ? 'taE' : ''}${c.key === pinKey ? ' dgpinh' : ''}">
        <span class="dgthw">${c.noSort ? `<span class="dgth">${esc(t(c.labelKey))}</span>` : `<button class="dgth" data-act="dgSort" data-k="${c.key}">${esc(t(c.labelKey))}<span class="dgsg" aria-hidden="true" data-tip="${esc(t('dgSortTip'))}">${so ? (so.dir === 'desc' ? '↓' : '↑') : '↕'}${s.sort.length > 1 && so ? `<i>${n}</i>` : ''}</span></button>`}
        ${c.noFilter ? '' : `<button class="dgfb" data-act="dgMenu" data-v="filter:${c.key}" data-on="${active(s.filters[c.key])}" aria-label="${esc(t('dgFilterCol', { col:t(c.labelKey) }))}" data-tip="${esc(t('dgFilterCol', { col:t(c.labelKey) }))}" aria-haspopup="dialog">${icon('filter', 11)}</button>`}
        <span class="dgrz" data-k="${c.key}" role="separator" aria-orientation="vertical" aria-label="${esc(t('dgResize', { col:t(c.labelKey) }))}" tabindex="-1"></span></span></th>`; };
    /* rows (with optional grouping) */
    let body = '', lastG = null, gcol = s.group && cols[s.group];
    pageRows.forEach((r, i) => {
      if(gcol){ const g = gcol.text(E, r); if(g !== lastG){ lastG = g; body += `<tr class="dggrp" role="row"><td colspan="${span}" role="rowheader">${esc(t(gcol.labelKey))}: ${esc(g)} <span class="tCap">· ${rows.filter(x => gcol.text(E, x) === g).length}</span></td></tr>`; } }
      const id = rk(r), sel = s.selAll || s.sel.has(id), open = spec.expand && s.open.has(id);
      body += `<tr role="row" data-act="${spec.rowAct.act}" data-${spec.rowAct.attr}="${esc(id)}" data-on="${spec.isSelectedRow ? spec.isSelectedRow(E, r) : false}" data-sel="${sel}" data-open="${!!open}" aria-selected="${sel}" tabindex="-1" aria-rowindex="${i + 2}">
        ${selectable ? `<td class="dgsel" role="gridcell" tabindex="-1"><input type="checkbox" data-act="dgSel" data-id="${esc(id)}" ${sel ? 'checked' : ''} aria-label="${esc(t('dgSelRow', { id }))}"></td>` : ''}
        ${spec.expand ? `<td class="dgxt" role="gridcell" tabindex="-1"><button class="dgxb" data-act="dgExpand" data-id="${esc(id)}" aria-expanded="${!!open}" aria-label="${esc(t(open ? 'dgCollapse' : 'dgExpand', { id }))}">${icon('chevD', 12)}</button></td>` : ''}
        ${vis.map((c, ci) => `<td role="gridcell" tabindex="${i === 0 && ci === 0 ? 0 : -1}" data-mob="${c.mob || ''}" class="${c.mono ? 'mono ' : ''}${c.align === 'end' ? 'taE ' : ''}${c.key === pinKey ? 'dgpin' : ''}">${c.cell ? c.cell(E, r) : esc(c.text(E, r))}</td>`).join('')}
        ${spec.rowMenu ? `<td class="dgact" role="gridcell" tabindex="-1"><button class="iconbtn dgmore" data-act="dgMenu" data-v="row:${esc(id)}" aria-haspopup="menu" aria-expanded="${s.menu === 'row:' + id}" aria-label="${esc(t('dgRowMenu', { id }))}">${icon('dots', 14)}</button></td>` : ''}</tr>`;
      if(open) body += `<tr class="dgx" role="row"><td colspan="${span}" role="gridcell">${spec.expand(E, r)}</td></tr>`;
    });
    if(!pageRows.length) body = `<tr><td colspan="${span}" class="dgempty">${esc(t('dgEmpty'))}</td></tr>`;
    const alt = spec.altBody ? spec.altBody(E, rows, s) : null;   /* D103: the map takes the table's place, the toolbar and filters stay */
    const table = alt != null ? `<div class="dgalt">${alt}</div>` : `<div class="dgscroll"><table class="dg" role="grid" aria-label="${esc(t(spec.titleKey))}" aria-rowcount="${rows.length + 1}" aria-colcount="${span}" aria-multiselectable="${selectable}">
      <colgroup>${selectable ? '<col class="dgcsel">' : ''}${spec.expand ? '<col class="dgcx">' : ''}${vis.map(c => `<col data-k="${c.key}" style="width:${(s.widths[c.key] || fitW(E, spec, c.key) || c.width || 140)}px">`).join('')}${spec.rowMenu ? '<col class="dgcact">' : ''}</colgroup>
      <thead><tr role="row">${selectable ? `<th scope="col" class="dgsel"><input type="checkbox" data-act="dgSelPage" ${allSel ? 'checked' : ''} aria-label="${esc(t('dgSelPage'))}"></th>` : ''}${spec.expand ? `<th scope="col" class="dgxt"><span class="srOnly">${esc(t('dgDetails'))}</span></th>` : ''}${vis.map(th).join('')}${spec.rowMenu ? `<th scope="col" class="dgact"><span class="srOnly">${esc(t('dgActions'))}</span></th>` : ''}</tr></thead>
      <tbody>${body}</tbody></table></div>`;
    const pager = ps && alt == null && pages > 1 ? `<span class="dgpager"><button class="btnG btnSm" data-act="dgPage" data-v="-1" ${s.page === 0 ? 'disabled' : ''}>${esc(t('dgPrev'))}</button><span class="tCap">${esc(t('dgPage', { a:(s.page * ps + 1).toLocaleString(), b:Math.min(rows.length, (s.page + 1) * ps).toLocaleString(), n:rows.length.toLocaleString() }))}</span><button class="btnG btnSm" data-act="dgPage" data-v="1" ${s.page >= pages - 1 ? 'disabled' : ''}>${esc(t('dgNext'))}</button></span>` : '';
    const foot = `<div class="dgfoot"><span>${esc(t('dgCount', { n:rows.length.toLocaleString(), total:total.toLocaleString() }))}</span>${pager}<span class="dglive" aria-live="polite">${esc(s.live)}</span></div>`;
    const cardsBelow = spec.cardsBelow || 767, cards = isCards(spec);
    return `<section class="dgwrap" data-grid="${spec.id}" data-density="${s.density}" data-menu="${s.menu || ''}" data-x="${spec.expand ? 1 : 0}" data-sel="${selectable ? 1 : 0}" data-mode="${cards ? 'cards' : 'table'}" data-cols="${cards && cardsBelow > 767 && window.innerWidth >= 600 ? 2 : 1}" aria-label="${esc(t(spec.titleKey))}">${bar}${facets}${chiprow}${selbar}${table}${foot}${menu(E, spec, s, rows)}</section>`;
  }

  /* ---------------------------- menus / sheets ----------------------------- */
  function menu(E, spec, s, rows){
    if(!s.menu || s.menu === 'tag') return '';
    const t = E.t.bind(E), cols = colMap(spec);
    let title = '', body = '';
    if(s.menu === 'views'){
      title = t('dgViews');
      body = `<ul class="dglist" role="menu">${allViews(spec, s).map(v => `<li class="dgvrow" data-on="${v.id === s.view}"><button class="dgvgo" role="menuitemradio" aria-checked="${v.id === s.view}" data-act="dgViewGo" data-v="${esc(v.id)}">${icon(v.id === s.view ? 'check' : 'doc', 13)} ${esc(viewName(E, spec, v))}${v.id === s.defaultView ? ` <span class="tCap">· ${esc(t('dgViewDefault'))}</span>` : ''}</button>
        <span class="row gap4">${v.id !== s.defaultView ? `<button class="iconbtn" data-act="dgViewDef" data-v="${esc(v.id)}" aria-label="${esc(t('dgViewSetDefault'))}" data-tip="${esc(t('dgViewSetDefault'))}">${icon('check', 12)}</button>` : ''}
        ${!v.nameKey ? `<button class="iconbtn" data-act="dgViewDel" data-v="${esc(v.id)}" aria-label="${esc(t('dgViewDelete'))}" data-tip="${esc(t('dgViewDelete'))}">${icon('trash', 12)}</button>` : ''}</span></li>`).join('')}</ul>
        <div class="dgsave"><span class="tLbl">${esc(t('dgViewSave'))}</span><span class="tCap">${esc(t('dgViewSaveHint'))}</span>
          <div class="row gap6"><input class="dgvname" placeholder="${esc(t('dgViewName'))}" aria-label="${esc(t('dgViewName'))}"><button class="btnP btnSm" data-act="dgViewSave">${esc(t('dgSave'))}</button></div></div>`;
    } else if(s.menu === 'cols'){
      title = t('dgCols');
      const row = k => { const c = cols[k]; const on = s.cols.includes(k);
        return `<li class="dgcrow" data-k="${k}" draggable="false"><span class="dgdrag" data-k="${k}" aria-hidden="true">${icon('dots', 12)}</span>
          <label class="row gap8 grow"><input type="checkbox" data-act="dgColTgl" data-k="${k}" ${on ? 'checked' : ''}><span>${esc(t(c.labelKey))}</span></label></li>`; };
      const groups = spec.groups && spec.groups.length ? spec.groups : [{ id:null }];
      body = `<div class="dgcolsh"><span class="tCap dgshown">${esc(t('dgShown', { n:s.cols.length, total:spec.columns.length }))}</span><button class="statlink dgreset" data-act="dgColReset">${esc(t('dgReset'))}</button></div>
        ${groups.map(g => { const keys = s.order.filter(k => cols[k] && (g.id ? cols[k].grp === g.id : true)); if(!keys.length) return '';
          return `<section class="dgcg">${g.id ? `<h4 class="tLbl dgcgh">${esc(t(g.labelKey))}</h4>` : ''}<ul class="dglist dgcols" role="listbox" aria-label="${esc(g.id ? t(g.labelKey) : t('dgCols'))}">${keys.map(row).join('')}</ul></section>`; }).join('')}`;
    } else if(s.menu === 'filters'){
      title = t('dgFilters');
      body = `<p class="tCap">${esc(t('dgFiltersHint'))}</p><ul class="dglist">${spec.columns.map(c => `<li><button class="dgvgo" data-act="dgMenu" data-v="filter:${c.key}" data-on="${active(s.filters[c.key])}">${icon('filter', 12)} <span class="grow taS">${esc(t(c.labelKey))}</span>${active(s.filters[c.key]) ? `<span class="tCap">${esc(filterChipText(E, c, s.filters[c.key]).split(': ').slice(1).join(': '))}</span>` : ''}</button></li>`).join('')}</ul>`;
    } else if(s.menu === 'group'){
      title = t('dgGroup');
      const opts = [''].concat(spec.groupBy || []);
      body = `<ul class="dglist" role="group" aria-label="${esc(t('dgGroup'))}">${opts.map(k => `<li><button class="dgvgo" role="menuitemradio" aria-checked="${(s.group || '') === k}" data-on="${(s.group || '') === k}" data-act="dgGroupSet" data-v="${k}">${(s.group || '') === k ? icon('check', 13) : '<span class="dgico" aria-hidden="true"></span>'} <span class="grow taS">${esc(k ? t(cols[k].labelKey) : t('dgGroupNone'))}</span></button></li>`).join('')}</ul>`;
    } else if(s.menu === 'display'){
      title = t('dgDisplay');
      body = `<h4 class="tLbl dgcgh">${esc(t('dgDensity'))}</h4><ul class="dglist" role="group" aria-label="${esc(t('dgDensity'))}">${DENS.map(d => `<li><button class="dgvgo" role="menuitemradio" aria-checked="${s.density === d}" data-on="${s.density === d}" data-act="dgDensity" data-v="${d}">${s.density === d ? icon('check', 13) : '<span class="dgico" aria-hidden="true"></span>'} <span class="grow taS">${esc(t('dgDens.' + d))}</span></button></li>`).join('')}</ul>`;
    } else if(s.menu === 'export'){
      title = t('dgExport');
      body = `<ul class="dglist"><li><button class="dgvgo" data-act="dgExport" data-v="csv">${icon('download', 13)} ${esc(t('dgExportCsv'))}</button></li><li><button class="dgvgo" data-act="dgExport" data-v="xlsx">${icon('download', 13)} ${esc(t('dgExportXlsx'))}</button></li></ul><p class="tCap">${esc(t('dgExportHint'))}</p>`;
    } else if(s.menu.startsWith('row:') && spec.rowMenu){
      const id = s.menu.slice(4); const r = spec.rows(E).find(x => String(x[spec.rowKey]) === id); if(!r) return '';
      title = id;
      let sect = null;   /* D107: more than five items → headed sections */
      body = `<ul class="dglist" role="menu">${spec.rowMenu(E, r).map(it => { const h = it.section && it.section !== sect ? `<li class="dgmsect" role="presentation">${esc(t(it.section))}</li>` : ''; sect = it.section || sect;
        return h + `<li><button class="dgvgo" role="menuitem" data-act="${it.act}" data-${it.attr || 'id'}="${esc(id)}" ${it.off ? 'disabled' : ''}>${icon(it.icon || 'doc', 13)} <span class="grow taS">${esc(t(it.labelKey))}</span></button></li>`; }).join('')}</ul>`;
    } else if(s.menu.startsWith('filter:')){
      const c = cols[s.menu.slice(7)]; if(!c) return '';
      const f = s.filters[c.key] || {};
      title = t('dgFilterCol', { col:t(c.labelKey) });
      if(c.type === 'text') body = `<label class="rpfld"><span class="tCap">${esc(t('dgf.contains'))}</span><input class="dgfin" data-k="${c.key}" data-f="q" value="${esc(f.q || '')}"></label>`;
      else if(c.type === 'enum') body = `<ul class="dglist">${c.enumOpts(E).map(o => `<li><label class="row gap8 dgfopt"><input type="checkbox" class="dgfck" data-k="${c.key}" value="${esc(o.v)}" ${(f.in || []).includes(String(o.v)) ? 'checked' : ''}><span>${o.html || esc(o.label)}</span></label></li>`).join('')}</ul>`;
      else if(c.type === 'num') body = `<div class="row gap8"><label class="rpfld grow"><span class="tCap">${esc(t('dgf.min'))}</span><input type="number" class="dgfin" data-k="${c.key}" data-f="min" value="${esc(f.min == null ? '' : f.min)}"></label><label class="rpfld grow"><span class="tCap">${esc(t('dgf.max'))}</span><input type="number" class="dgfin" data-k="${c.key}" data-f="max" value="${esc(f.max == null ? '' : f.max)}"></label></div>`;
      else if(c.type === 'date') body = `<div class="row gap8"><label class="rpfld grow"><span class="tCap">${esc(t('dgf.from'))}</span><input type="date" class="dgfin" data-k="${c.key}" data-f="from" value="${esc(f.from || '')}"></label><label class="rpfld grow"><span class="tCap">${esc(t('dgf.to'))}</span><input type="date" class="dgfin" data-k="${c.key}" data-f="to" value="${esc(f.to || '')}"></label></div>`;
      else if(c.type === 'bool') body = `<div class="segbox row" role="radiogroup">${[['', 'dgf.any'], ['true', 'dgf.yes'], ['false', 'dgf.no']].map(([v, k]) => `<button class="seg" role="radio" aria-checked="${String(f.is == null ? '' : f.is) === v}" data-on="${String(f.is == null ? '' : f.is) === v}" data-act="dgFiltBool" data-k="${c.key}" data-v="${v}">${esc(t(k))}</button>`).join('')}</div>`;
      if(E.stacked()) body += `<div class="row gap8 dgfacts"><button class="btnG btnSm" data-act="dgMenu" data-v="filters">${icon('chevL', 12)} ${esc(t('dgFilters'))}</button><button class="btnG btnSm" data-act="dgFiltClear" data-k="${c.key}">${esc(t('dgf.clear'))}</button><span class="grow"></span><button class="btnP btnSm" data-act="dgMenuClose">${esc(t('dgDone'))}</button></div>`;
      else body += `<div class="dgfacts">${c.type === 'enum' ? `<button class="statlink" data-act="dgFiltAll" data-k="${c.key}">${esc(t('dgf.all'))}</button>` : '<span></span>'}<button class="statlink" data-act="dgFiltClear" data-k="${c.key}">${esc(t('dgf.clear'))}</button></div>`;
    }
    const compact = !E.stacked() && (s.menu.startsWith('filter:') || s.menu.startsWith('row:') || s.menu === 'group');   /* D100e/D101: column filters and row menus are compact popovers on desktop */
    return `<div class="dgscrim" data-act="dgMenuClose"></div><div class="dgmenu" data-kind="${compact ? (s.menu.startsWith('row:') ? 'row' : 'filter') : 'panel'}" data-row="${s.menu.startsWith('row:') ? 1 : 0}" role="dialog" aria-label="${esc(title)}"><div class="draghandle"></div>${compact ? '' : `<div class="dgmhead"><h3>${esc(title)}</h3><button class="iconbtn msA" data-act="dgMenuClose" aria-label="${esc(t('close'))}">${icon('x', 13)}</button></div>`}${body}</div>`;
  }

  /* ---------------------------- export ------------------------------------ */
  function exportRows(E, spec, s, rows, fmt){
    const t = E.t.bind(E), cols = colMap(spec), vis = visCols(spec, s, true);
    const head = vis.map(c => t(c.labelKey));
    const data = rows.map(r => vis.map(c => { const v = c.get(E, r); return (c.type === 'num' && typeof v === 'number') ? v : c.text(E, r); }));
    const flist = Object.keys(s.filters).filter(k => cols[k] && active(s.filters[k])).map(k => filterChipText(E, cols[k], s.filters[k]));
    if(s.q) flist.unshift(t('dgSearch') + ': ' + s.q);
    const view = viewName(E, spec, allViews(spec, s).find(v => v.id === s.view) || spec.views[0]);
    const footer = [[], [flist.length ? t('dgFootFilters', { list: flist.join(' · ') }) : t('dgFootNone')], [t('dgFootExported', { t: new Date().toLocaleString(E.lang === 'ar' ? 'ar-AE' : 'en-GB'), view, n: rows.length })]];
    const all = [head].concat(data, footer);
    const name = (spec.exportName || spec.id) + '-' + new Date().toISOString().slice(0, 10);
    if(fmt === 'xlsx' && window.EKO_RX && window.EKO_RX.workbook){
      const blob = window.EKO_RX.workbook([{ name: t(spec.titleKey).slice(0, 31), rows: all }], E.lang === 'ar');
      download(blob, name + '.xlsx');
    } else {
      const cell = v => { const sv = String(v == null ? '' : v); return /[",\n]/.test(sv) ? '"' + sv.replace(/"/g, '""') + '"' : sv; };
      download(new Blob(['﻿' + all.map(r => r.map(cell).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' }), name + '.csv');
    }
    return rows.length;
  }
  function download(blob, name){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); }

  /* ---------------------------- actions ----------------------------------- */
  let E = null;
  const cur = el => { const w = el.closest('.dgwrap'); const spec = specs[w && w.dataset.grid]; return spec ? { spec, s: st(E, spec), w } : null; };
  const rerender = () => E.set({});
  const say = (s, msg) => { s.live = msg; };
  const ACTS = {
    dgMenu(el){ const c = cur(el); if(!c) return; c.s.menu = c.s.menu === el.dataset.v ? null : el.dataset.v; rerender(); },
    dgMenuClose(el){ const c = cur(el); if(!c) return; c.s.menu = null; rerender(); },
    dgSort(el, ev){ const c = cur(el); if(!c) return; const k = el.dataset.k, s = c.s, t = E.t.bind(E);
      const i = s.sort.findIndex(o => o.key === k);
      if(ev && ev.shiftKey){ if(i < 0) s.sort.push({ key:k, dir:'asc' }); else if(s.sort[i].dir === 'asc') s.sort[i].dir = 'desc'; else s.sort.splice(i, 1); }
      else { if(i < 0 || s.sort.length > 1) s.sort = [{ key:k, dir:'asc' }]; else if(s.sort[i].dir === 'asc') s.sort[i].dir = 'desc'; else s.sort = []; }
      const o = s.sort.find(x => x.key === k); const col = t(colMap(c.spec)[k].labelKey);
      say(s, o ? t(o.dir === 'desc' ? 'dgSortedDesc' : 'dgSortedAsc', { col, n:s.sort.length }) : t('dgSortNone')); s.dirty = true; rerender(); },
    dgDensity(el){ const c = cur(el); if(!c) return; c.s.density = el.dataset.v; c.s.dirty = true; c.s.menu = null; rerender(); },
    dgPage(el){ const c = cur(el); if(!c) return; c.s.page += +el.dataset.v; const sc = c.w.querySelector('.dgscroll'); if(sc) sc.scrollTop = 0; c.s.scrollTop = 0; rerender(); },
    dgGroupSet(el){ const c = cur(el); if(!c) return; c.s.group = el.dataset.v || null; c.s.dirty = true; c.s.menu = null; rerender(); },
    dgQClear(el){ const c = cur(el); if(!c) return; c.s.q = ''; rerender(); },
    dgFiltClear(el){ const c = cur(el); if(!c) return; delete c.s.filters[el.dataset.k]; c.s.dirty = true; rerender(); },
    dgFiltAll(el){ const c = cur(el); if(!c) return; const col = colMap(c.spec)[el.dataset.k]; if(!col || !col.enumOpts) return; c.s.filters[el.dataset.k] = { in: col.enumOpts(E).map(o => String(o.v)) }; c.s.dirty = true; rerender(); },
    dgClearAll(el){ const c = cur(el); if(!c) return; c.s.filters = {}; c.s.q = ''; c.s.dirty = true; rerender(); },
    dgFiltBool(el){ const c = cur(el); if(!c) return; const v = el.dataset.v; c.s.filters[el.dataset.k] = v === '' ? {} : { is: v === 'true' }; c.s.dirty = true; rerender(); },
    dgViewGo(el){ const c = cur(el); if(!c) return; applyView(E, c.spec, c.s, el.dataset.v); c.s.menu = null; rerender(); },
    dgViewDef(el){ const c = cur(el); if(!c) return; c.s.defaultView = el.dataset.v; persist(E, c.spec, c.s); rerender(); },
    dgViewDel(el){ const c = cur(el); if(!c) return; const s = c.s; s.views = s.views.filter(v => v.id !== el.dataset.v);
      if(s.defaultView === el.dataset.v) s.defaultView = c.spec.views[0].id; if(s.view === el.dataset.v) applyView(E, c.spec, s, s.defaultView);
      persist(E, c.spec, s); toast(E.t('dgViewDeleted')); rerender(); },
    dgViewSave(el){ const c = cur(el); if(!c) return; const s = c.s; const inp = c.w.querySelector('.dgvname'); const name = (inp && inp.value.trim()) || ''; if(!name) { if(inp) inp.focus(); return; }
      const id = 'v-' + Date.now(); s.views.push({ id, name, cols:visCols(c.spec, s).map(x => x.key), sort:s.sort.map(x => Object.assign({}, x)), filters:JSON.parse(JSON.stringify(s.filters)), group:s.group, density:s.density });
      s.view = id; s.dirty = false; s.menu = null; persist(E, c.spec, s); toast(E.t('dgViewSaved', { name })); rerender(); },
    dgColTgl(el){ const c = cur(el); if(!c) return; const s = c.s, k = el.dataset.k;
      if(s.cols.includes(k)){ if(s.cols.length > 1) s.cols = s.cols.filter(x => x !== k); } else s.cols.push(k); s.dirty = true; rerender(); },
    dgColReset(el){ const c = cur(el); if(!c) return; const s = c.s; s.cols = defCols(c.spec); s.order = c.spec.columns.map(x => x.key); s.widths = {}; s.dirty = true; persist(E, c.spec, s); rerender(); },
    dgExpand(el){ const c = cur(el); if(!c) return; const s = c.s, id = el.dataset.id; if(s.open.has(id)) s.open.delete(id); else s.open.add(id); rerender(); },
    dgRowAck(el){ const c = cur(el); if(!c) return; const r = c.spec.rows(E).find(x => String(x[c.spec.rowKey]) === el.dataset.id); const b = (c.spec.bulk || []).find(x => x.id === 'ack');
      const n = (r && b) ? b.run(E, [r]) : 0; c.s.menu = null; toast(E.t('dgBulkAckDone', { n })); rerender(); },
    dgCopyId(el){ const c = cur(el); if(!c) return; const id = el.dataset.id; try{ if(navigator.clipboard) navigator.clipboard.writeText(id).catch(() => {}); }catch(e){} c.s.menu = null; toast(E.t('dgCopied', { id })); rerender(); },
    dgSel(el){ const c = cur(el); if(!c) return; const s = c.s, id = el.dataset.id; if(s.selAll){ s.selAll = false; rowsOf(E, c.spec, s).forEach(r => s.sel.add(r[c.spec.rowKey])); }
      if(s.sel.has(id)) s.sel.delete(id); else s.sel.add(id); rerender(); },
    dgSelPage(el){ const c = cur(el); if(!c) return; const s = c.s, rows = rowsOf(E, c.spec, s); const all = rows.every(r => s.sel.has(r[c.spec.rowKey]));
      s.selAll = false; if(all) rows.forEach(r => s.sel.delete(r[c.spec.rowKey])); else rows.forEach(r => s.sel.add(r[c.spec.rowKey])); rerender(); },
    dgSelAll(el){ const c = cur(el); if(!c) return; c.s.selAll = true; rowsOf(E, c.spec, c.s).forEach(r => c.s.sel.add(r[c.spec.rowKey])); rerender(); },
    dgSelClear(el){ const c = cur(el); if(!c) return; c.s.sel = new Set(); c.s.selAll = false; c.s.menu = null; rerender(); },
    dgBulk(el){ const c = cur(el); if(!c) return; const s = c.s; const rows = rowsOf(E, c.spec, s).filter(r => s.selAll || s.sel.has(r[c.spec.rowKey]));
      const b = (c.spec.bulk || []).find(x => x.id === el.dataset.v); if(!b) return;
      if(b.id === 'tag'){ s.menu = 'tag'; rerender(); return; }
      if(b.id === 'export'){ const n = exportRows(E, c.spec, s, rows, 'csv'); toast(E.t('dgExported', { n })); return; }
      const n = b.run(E, rows); toast(E.t(b.doneKey, { n })); rerender(); },
    dgBulkTagApply(el){ const c = cur(el); if(!c) return; const s = c.s; const inp = c.w.querySelector('.dgtagin'); const tag = (inp && inp.value.trim()) || ''; if(!tag){ if(inp) inp.focus(); return; }
      const rows = rowsOf(E, c.spec, s).filter(r => s.selAll || s.sel.has(r[c.spec.rowKey]));
      const b = (c.spec.bulk || []).find(x => x.id === 'tag'); const n = b.run(E, rows, tag); s.menu = null; s.tagDraft = ''; toast(E.t('dgTagged', { n, tag })); rerender(); },
    dgExport(el){ const c = cur(el); if(!c) return; const n = exportRows(E, c.spec, c.s, rowsOf(E, c.spec, c.s), el.dataset.v); c.s.menu = null; toast(E.t('dgExported', { n })); rerender(); }
  };
  const toast = msg => { if(window.EKO_FB) window.EKO_FB.toast({ text: msg, tone:'ok' }); };

  /* inputs: search and filter fields re-render the grid only (the caret survives) */
  let deb = null;
  function onInput(ev){
    const el = ev.target; if(!(el instanceof Element)) return;
    if(el.matches('.dgq')){ const c = cur(el); if(!c) return; c.s.q = el.value; clearTimeout(deb); deb = setTimeout(() => refreshGrid(c, '.dgq'), 120); return; }
    if(el.matches('.dgfin')){ const c = cur(el); if(!c) return; const f = c.s.filters[el.dataset.k] = c.s.filters[el.dataset.k] || {}; f[el.dataset.f] = el.value; c.s.dirty = true; clearTimeout(deb); deb = setTimeout(() => refreshGrid(c, `.dgfin[data-f="${el.dataset.f}"]`), 160); return; }
    if(el.matches('.dgfck')){ const c = cur(el); if(!c) return; const f = c.s.filters[el.dataset.k] = c.s.filters[el.dataset.k] || {}; const set = new Set(f.in || []); if(el.checked) set.add(el.value); else set.delete(el.value); f.in = [...set]; c.s.dirty = true; refreshGrid(c, null); return; }
    if(el.matches('.dgtagin')){ const c = cur(el); if(c) c.s.tagDraft = el.value; }
  }
  /* D100c: a desktop popover opens under the control that opened it (a toolbar
     button or a column funnel), clamped inside the grid; sheets (position:fixed)
     are left alone. Called after every render that can carry an open menu. */
  function place(){
    document.querySelectorAll('.dgwrap[data-menu]:not([data-menu=""])').forEach(w => {
      const m = w.querySelector('.dgmenu'); if(!m || getComputedStyle(m).position === 'fixed') return;
      const key = w.dataset.menu; const opener = [...w.querySelectorAll(`[data-act="dgMenu"][data-v="${key}"]`)].find(b => !b.closest('.dgmenu'));
      if(!opener){ m.style.insetInlineStart = ''; m.style.insetInlineEnd = ''; m.style.top = ''; m.style.maxHeight = ''; return; }
      const anchor = (key.startsWith('filter:') && opener.closest('th')) || opener;
      const wr = w.getBoundingClientRect(), o = anchor.getBoundingClientRect(), rtl = (window.DASHBOARD_ROOT||document.documentElement).dir === 'rtl';
      const mw = m.offsetWidth, pad = 8;
      let x = rtl ? (wr.right - o.right) : (o.left - wr.left);              /* start edges aligned */
      if(x + mw > wr.width - pad) x = (rtl ? (wr.right - o.left) : (o.right - wr.left)) - mw;   /* else end edges aligned */
      x = Math.max(pad, Math.min(x, wr.width - mw - pad));
      const top = Math.round(o.bottom - wr.top + (anchor === opener ? 6 : 2));
      m.style.insetInlineStart = Math.round(x) + 'px'; m.style.insetInlineEnd = 'auto'; m.style.top = top + 'px';
      m.style.maxHeight = Math.max(220, Math.min(key === 'cols' ? 720 : 520, Math.round(wr.height - top - 12))) + 'px';
    });
  }
  const FIT = {};   /* grid id → lang → column key → width that fits the header */
  const fitW = (E, spec, k) => ((FIT[spec.id] || {})[E.state.lang] || {})[k];
  function fit(){
    document.querySelectorAll('.dgwrap[data-grid]').forEach(w => {
      const spec = specs[w.dataset.grid]; const s = spec && st(E, spec); if(!s) return;
      const cache = (FIT[spec.id] = FIT[spec.id] || {}); const byLang = (cache[E.state.lang] = cache[E.state.lang] || {});
      w.querySelectorAll('th[data-k]').forEach(th => {
        const k = th.dataset.k; if(s.widths[k]) return;
        const b = th.querySelector('.dgth'); if(!b) return; const need = b.scrollWidth - b.clientWidth; if(need <= 0) return;
        const wpx = th.offsetWidth + need + 2; byLang[k] = wpx;
        th.style.width = wpx + 'px'; const col = w.querySelector(`col[data-k="${k}"]`); if(col) col.style.width = wpx + 'px';
      });
    });
  }
  function mount(){ fit(); place();
    document.querySelectorAll('.dgwrap[data-grid]').forEach(w => { const spec = specs[w.dataset.grid]; const s = spec && st(E, spec); const sc = w.querySelector('.dgscroll'); if(s && sc && s.scrollTop && sc.scrollTop === 0) sc.scrollTop = s.scrollTop; }); }   /* D103: a grid remembers where it was scrolled across navigation */
  function onScroll(ev){ const el = ev.target; if(el instanceof Element && el.classList.contains('dgscroll')){ const c = cur(el); if(c) c.s.scrollTop = el.scrollTop; } }
  function refreshGrid(c, focusSel){
    const w = c.w; if(!document.contains(w)) return;
    const html = render(E, c.spec); const tmp = document.createElement('div'); tmp.innerHTML = html;
    const fresh = tmp.firstElementChild; const sc = w.querySelector('.dgscroll'); const top = sc ? sc.scrollTop : 0;
    w.replaceWith(fresh); const sc2 = fresh.querySelector('.dgscroll'); if(sc2) sc2.scrollTop = top; mount();
    if(focusSel){ const inp = fresh.querySelector(focusSel); if(inp){ inp.focus(); if(inp.setSelectionRange && inp.type !== 'number' && inp.type !== 'date') inp.setSelectionRange(inp.value.length, inp.value.length); } }
  }
  /* column resize (pointer drag on the header divider), column drag-to-reorder, keyboard */
  function onPointerDown(ev){
    const el = ev.target; if(!(el instanceof Element)) return;
    const rz = el.closest('.dgrz');
    if(rz){ const c = cur(rz); if(!c) return; ev.preventDefault(); const k = rz.dataset.k; const col = c.w.querySelector(`col[data-k="${k}"]`); const th = rz.closest('th');
      const x0 = ev.clientX, w0 = th.getBoundingClientRect().width; const rtl = (window.DASHBOARD_ROOT||document.documentElement).dir === 'rtl';
      const move = e => { const w = Math.max(60, Math.round(w0 + (rtl ? x0 - e.clientX : e.clientX - x0))); col.style.width = w + 'px'; th.style.width = w + 'px'; c.s.widths[k] = w; };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); persist(E, c.spec, c.s); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); return; }
    const dg = el.closest('.dgdrag');
    if(dg){ const c = cur(dg); if(!c) return; ev.preventDefault(); const li = dg.closest('li'); const list = li.parentElement; li.classList.add('dgdragging');
      let moved = false; const menu = li.closest('.dgmenu');
      const move = e => { const over = document.elementFromPoint(e.clientX, e.clientY); const tgt = over && over.closest('.dgcrow'); if(tgt && tgt !== li && tgt.closest('.dgmenu') === menu){ const r = tgt.getBoundingClientRect(); if(e.clientY < r.top + r.height / 2) tgt.parentElement.insertBefore(li, tgt); else tgt.parentElement.insertBefore(li, tgt.nextSibling); moved = true; } };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); li.classList.remove('dgdragging');
        if(!moved) return; const s = c.s, k = li.dataset.k; const sib = (el2) => el2 && el2.classList && el2.classList.contains('dgcrow') ? el2.dataset.k : null;
        const next = sib(li.nextElementSibling), prev = sib(li.previousElementSibling);
        const order = s.order.filter(x => x !== k); const j = next ? order.indexOf(next) : (prev ? order.indexOf(prev) + 1 : order.length);
        order.splice(j, 0, k); s.order = order; s.dirty = true; rerender(); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); return; }
    /* click-away closes a grid menu (desktop popover); the scrim handles sheets */
    document.querySelectorAll('.dgwrap[data-menu]:not([data-menu=""])').forEach(w => { if(!w.contains(el) || (!el.closest('.dgmenu') && !el.closest('[data-act="dgMenu"]'))){ const spec = specs[w.dataset.grid]; const s = spec && st(E, spec); if(s && s.menu && !el.closest('.dgmenu') && !el.closest('[data-act="dgMenu"]') && !el.closest('.dgselbar')){ s.menu = null; rerender(); } } });
  }
  function onKey(ev){
    const el = ev.target; if(!(el instanceof Element)) return;
    const w = el.closest('.dgwrap'); if(!w) return;
    if(ev.key === 'Escape'){ const spec = specs[w.dataset.grid]; const s = spec && st(E, spec); if(s && s.menu){ s.menu = null; rerender(); ev.stopImmediatePropagation(); } return; }
    if(ev.key === 'Enter' && el.matches('.dgvname')){ ACTS.dgViewSave(el); return; }
    if(ev.key === 'Enter' && el.matches('.dgtagin')){ ACTS.dgBulkTagApply(el); return; }
    const cell = el.closest('td[role="gridcell"]'); if(!cell) return;
    const tr = cell.parentElement, cells = [...tr.querySelectorAll('td[role="gridcell"]')], ci = cells.indexOf(cell);
    const rows = [...w.querySelectorAll('tbody tr[role="row"]')], ri = rows.indexOf(tr);
    const go = (r, c) => { const row = rows[Math.max(0, Math.min(rows.length - 1, r))]; const cs = [...row.querySelectorAll('td[role="gridcell"]')]; const tgt = cs[Math.max(0, Math.min(cs.length - 1, c))];
      w.querySelectorAll('td[tabindex="0"]').forEach(x => x.tabIndex = -1); tgt.tabIndex = 0; tgt.focus(); };
    switch(ev.key){
      case 'ArrowDown': ev.preventDefault(); go(ri + 1, ci); break;
      case 'ArrowUp': ev.preventDefault(); go(ri - 1, ci); break;
      case 'ArrowRight': ev.preventDefault(); go(ri, ci + 1); break;
      case 'ArrowLeft': ev.preventDefault(); go(ri, ci - 1); break;
      case 'Home': ev.preventDefault(); go(ev.ctrlKey ? 0 : ri, 0); break;
      case 'End': ev.preventDefault(); go(ev.ctrlKey ? rows.length - 1 : ri, cells.length - 1); break;
      case 'Enter': if(!el.matches('input,button') || el.matches('input[data-act="dgSel"]')){ ev.preventDefault(); tr.click(); } break;   /* D121: Enter on the row's checkbox opens the row too */
      case ' ': if(!el.matches('input,button')){ ev.preventDefault(); const cb = tr.querySelector('input[data-act="dgSel"]'); if(cb) cb.click(); } break;
    }
  }
  function onClick(ev){ const el = ev.target instanceof Element ? ev.target.closest('.dgmenu[data-row="1"] [data-act]') : null; if(!el || String(el.dataset.act).startsWith('dg')) return; const c = cur(el); if(c && c.s.menu){ c.s.menu = null; setTimeout(rerender, 0); } }
  function init(app){ E = app; document.addEventListener('input', onInput); document.addEventListener('pointerdown', onPointerDown, true); document.addEventListener('click', onClick); document.addEventListener('keydown', onKey); document.addEventListener('scroll', onScroll, true); window.addEventListener('resize', place); }

  return { render, init, ACTS, specs, rowsOf, st, applyView, place, mount, savedViews };
})();
