/* ============================================================================
   THE PAGE FRAME (E9, EKO_E9_Prompt.md A1 and A4): one screen per work page.
   Every work page (.pwarea) is laid out the same way, on every site:
     1. the headline sentence (the page's own .opshl; HEADLINES below for a
        page that has none)
     2. the how-to-read line: what the page answers and how to read it, in
        plain words, with an info button for 3 to 5 lines (what it answers,
        what the colours mean, what to do next, where the data comes from)
     3. a row of no more than five tiles (.pwhero)
     4. the work area: a visual (a plan, the 3D, a diagram) beside a tabbed
        panel; the detail goes into the tabs, and a table or list scrolls
        inside its own panel with a sticky header.
   The page code still writes its widgets in order; the frame arranges them.
   A widget says where it goes with attributes on the page's top-level
   children (none of them needed for the default):
     data-frame="top"       stays above the tiles (an action row, a source line)
     data-frame="visual"    the visual beside the tabs
     data-tab="id"          the tab it belongs to (several widgets may share one)
     data-tablbl="label"    the tab's label (default: the widget's own title)
   The open tab is E.state.pfTab[pageId]. The model pages (the 3D with its
   panels) keep their layout; their how-to line opens the right-hand panel.
   Pages that are a single document scroll as a document: docPages.
   ============================================================================ */
window.EKO_FRAME = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = s => C().esc(s);
  const docPages = ['reports', 'report-preview', 'bible', 'notifications', 'portfolio', 'stub', 'module-locked'];
  const tpl = document.createElement('template');
  const TOP = ['pwheadrow', 'epinsl', 'evsrc', 'opsclaim', 'secplace', 'esgprov', 'fcmethod', 'evxlines'];
  const has = (E, k) => { const en = (window.EKO_I18N || {}).en || {}; return en[k] !== undefined; };
  const howKey = (E, pg) => has(E, 'how.' + pg + '.' + (E.data.key || 'marsa')) ? 'how.' + pg + '.' + (E.data.key || 'marsa') : 'how.' + pg;
  /* the how-to line and its info button; the lines open under it, over the page (they move nothing) */
  /* E15: off. D182 has no how-to line and it is not on the approved list (docs/reports/E15-design-diff.md, flagged);
     the strings stay, so it can come back with one line if the product owner approves it */
  const HOW_ON = false;
  function howLine(E, pg, inPanel){
    const k = howKey(E, pg); if(!HOW_ON || !has(E, k)) return '';
    const open = E.state.howOpen === pg, t = E.t.bind(E);
    const lines = ['q', 'c', 'n', 's'].filter(x => has(E, k + '.' + x)).map(x => `<li><b>${esc(t('how.lbl.' + x))}</b> ${esc(t(k + '.' + x))}</li>`).join('');
    return `<div class="howto${inPanel ? ' howpanel' : ''}" data-frame="how"><p class="howtx">${esc(t(k))}</p>`
      + (lines ? `<button class="howbtn" data-act="howInfo" data-v="${esc(pg)}" aria-expanded="${open}" aria-label="${esc(t('how.infoAria'))}">${C().icon('info', 14)}<span>${esc(t('how.info'))}</span></button>` : '')
      + (open && lines ? `<div class="howpop" role="note"><ul>${lines}</ul><button class="btnG btnSm" data-act="howInfo" data-v="${esc(pg)}">${esc(t('how.close'))}</button></div>` : '') + '</div>';
  }
  const titleOf = el => { const h = el.querySelector('.alcardt, .pwwh .ovklbl, h3, h4, .evxh3'); return h ? h.textContent.replace(/\s+/g, ' ').trim() : ''; };
  function apply(E, html){
    const pg = E.state.pageId;
    tpl.innerHTML = html;
    const root = tpl.content.firstElementChild;
    if(!root) return html;
    /* the model pages: the how-to line at the top of the right-hand panel */
    if(root.id === 'vpmain' || root.tagName === 'MAIN'){
      const mc = tpl.content.querySelector('#modcontent'); const hl = howLine(E, pg, true);
      if(mc && hl){ const t2 = document.createElement('template'); t2.innerHTML = hl; mc.insertBefore(t2.content, mc.firstChild); }
      return tpl.innerHTML;
    }
    if(!root.classList.contains('pwarea') || docPages.includes(pg) || root.dataset.frame === 'off') return html;
    const kids = [...root.children];
    const head = [], top = [], tiles = [], visual = [], groups = []; let g = null;
    const hl0 = kids.find(k => k.classList.contains('opshl'));
    kids.forEach(k => {
      const f = k.dataset.frame;
      if(k === hl0) head.push(k);
      else if(f === 'top' || (!f && TOP.some(c => k.classList.contains(c)))) top.push(k);
      else if(k.classList.contains('pwhero') && !tiles.length) tiles.push(k);
      else if(f === 'visual') visual.push(k);
      else {
        const id = k.dataset.tab || null, small = !id && (k.tagName === 'P' || k.tagName === 'UL' || k.tagName === 'H3' || k.classList.contains('row')) && !k.querySelector('table, .pwwidget') && ![...k.querySelectorAll('svg')].some(v => +(v.getAttribute('width') || 99) > 20);   /* an icon is not a chart */
        if(small && g){ g.els.push(k); return; }   /* a note or a small row belongs with the widget before it */
        if(small && !g){ top.push(k); return; }   /* a note before any widget stays above the tiles */
        const ex = id && groups.find(x => x.id === id);
        if(ex){ ex.els.push(k); g = ex; return; }
        g = { id: id || 'w' + groups.length, lbl: k.dataset.tablbl || titleOf(k), els: [k] }; groups.push(g);
      }
    });
    /* the headline: the page's own, or the frame's for a page that has none */
    let hlHtml = '';
    if(!hl0){ const H = HEADLINES[pg]; const h = H ? H(E, root) : genericHl(E, root); if(h) hlHtml = window.EKO_OPS.headline(E, h.text, h.tone || 'ok'); }
    /* no more than five tiles: the rest go to the top of the first tab */
    let extra = null;
    if(tiles[0]){ const ts = [...tiles[0].children]; if(ts.length > 5){ extra = document.createElement('div'); extra.className = 'pwhero pfmore'; ts.slice(5).forEach(x => extra.appendChild(x)); tiles[0].style.gridTemplateColumns = 'repeat(5,1fr)'; } }
    if(tiles[0]) tiles[0].querySelectorAll('.ovkcap').forEach(c => { const tx = c.textContent.replace(/\s+/g, ' ').trim(); if(!c.getAttribute('title')) c.setAttribute('title', tx);
      const tile = c.closest('.pwtile'); if(tile && !tile.getAttribute('title')) tile.setAttribute('title', tx); });   /* a clamped (or, in a compact strip, hidden) caption keeps its full text */
    if(extra){ if(groups[0]) groups[0].els.unshift(extra); else groups.push({ id: 'w0', lbl: '', els: [extra] }); }
    const sel = ((E.state.pfTab || {})[pg]) && groups.find(x => x.id === E.state.pfTab[pg]) ? E.state.pfTab[pg] : (groups[0] || {}).id;
    const out = document.createElement('div');
    const keep = el => out.appendChild(el);
    head.forEach(keep);
    const t2 = document.createElement('template'); t2.innerHTML = hlHtml + howLine(E, pg, false); [...t2.content.childNodes].forEach(n => out.appendChild(n));
    top.forEach(keep); tiles.forEach(keep);
    const work = document.createElement('div'); work.className = 'pfwork'; if(visual.length) work.dataset.vis = '1';
    if(visual.length){ const v = document.createElement('div'); v.className = 'pfvisual'; visual.forEach(x => v.appendChild(x)); work.appendChild(v); }
    if(groups.length){
      const panel = document.createElement('div'); panel.className = 'pfpanel';
      if(groups.length > 1){
        const bar = document.createElement('div'); bar.className = 'pftabs'; bar.setAttribute('role', 'tablist');
        bar.innerHTML = groups.map(x => `<button class="pftab" role="tab" id="pft-${esc(x.id)}" aria-selected="${x.id === sel}" data-act="pfTab" data-v="${esc(x.id)}" title="${esc(x.lbl)}">${esc(x.lbl)}</button>`).join('');
        panel.appendChild(bar);
      }
      groups.forEach(x => { const b = document.createElement('div'); b.className = 'pfbody'; b.id = 'pfb-' + pg + '-' + x.id; b.setAttribute('role', 'tabpanel');
        if(x.id !== sel) b.hidden = true; x.els.forEach(el => b.appendChild(el)); panel.appendChild(b); });
      work.appendChild(panel);
    }
    out.appendChild(work);
    root.innerHTML = ''; [...out.childNodes].forEach(n => root.appendChild(n));
    root.dataset.frame = 'on';
    return tpl.innerHTML;
  }
  /* a headline for a page that has none: its first tiles in one sentence, the words the tiles already use */
  function genericHl(E, root){
    const ts = [...root.querySelectorAll('.pwhero > *')].slice(0, 3).map(t => { const l = (t.querySelector('.ovklbl') || {}).textContent || '', n = (t.querySelector('.ovknum') || {}).textContent || '', u = (t.querySelector('.ovkunit') || {}).textContent || '';
      /* a label set in capitals reads in sentence case; a code (short, or with a digit: PMU, CO2, L2) keeps its capitals */
      const KEEP = /^(PMU|CO2|CO₂|UPS|AHU|EUI|IAQ|IEQ|PUE|GRESB|HVAC|PM|WO|SLA|KPI|MW|KW|EV|BMS|FIN|CMMS|LED|DEWA)[,.]?$/;
      const sc = s => s.trim().split(/\s+/).map(w => KEEP.test(w) || /\d/.test(w) ? w : w.toLowerCase()).join(' ').replace(/^./, c => c.toUpperCase());
      return l && n ? (l === l.toUpperCase() ? sc(l) : l.trim()) + ' ' + n.trim() + (u.trim() ? ' ' + u.trim() : '') : ''; }).filter(Boolean);
    return ts.length ? { text: ts.join(E.lang === 'ar' ? '؛ ' : '; ') + '.', tone: 'ok' } : null;
  }
  /* a tab of several widgets, from page code: group(id, label, html) */
  const group = (id, lbl, html) => html ? `<div class="pfgrp" data-tab="${esc(id)}" data-tablbl="${esc(lbl)}">${html}</div>` : '';
  const HEADLINES = {};
  const ACTS = {
    pfTab(el){ const pg = window.EKO.state.pageId; window.EKO.set({ pfTab: Object.assign({}, window.EKO.state.pfTab || {}, { [pg]: el.dataset.v }) }); },
    howInfo(el){ const E = window.EKO; E.set({ howOpen: E.state.howOpen === el.dataset.v ? null : el.dataset.v }); }
  };
  return { apply, docPages, ACTS, HEADLINES, howLine, group };
})();
