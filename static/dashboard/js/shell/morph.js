/* ============================================================================
   MORPH (E9, EKO_E9_Prompt.md A2): the page is updated in place, never rebuilt.
   Before E9 every state change set #mount.innerHTML to the whole page, so every
   click destroyed and recreated every element: a panel's scroll went back to
   the top, a table lost its place, a focused control lost focus. The shell
   still renders the page to a string (one source of truth for each screen),
   but EKO_MORPH.into(el, html) walks the live tree against the new one and
   changes only what differs: an attribute, a text, a row added or removed.
   Elements that did not change are the same elements, so their scroll
   position, focus and any open state stay as they are.
     into(el, html)       morph el's children to html
   Matching: an element with an id matches the element with that id among its
   siblings; otherwise the next sibling of the same tag (and the same data-key,
   if given). An element marked data-morph="keep" (the live 3D host) is left
   alone. A focused input keeps what the reader is typing.
   ============================================================================ */
window.EKO_MORPH = (function(){
  'use strict';
  const tpl = document.createElement('template');
  const keyOf = n => n.nodeType === 1 ? (n.id ? '#' + n.id : n.getAttribute('data-key') ? n.tagName + '@' + n.getAttribute('data-key') : null) : null;
  const same = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && keyOf(a) === keyOf(b)));
  function attrs(from, to){
    const fa = from.attributes, ta = to.attributes;
    for(let i = fa.length - 1; i >= 0; i--){ const a = fa[i]; if(!to.hasAttributeNS(a.namespaceURI, a.localName)) from.removeAttributeNS(a.namespaceURI, a.localName); }
    for(let i = 0; i < ta.length; i++){ const a = ta[i]; if(from.getAttributeNS(a.namespaceURI, a.localName) !== a.value) from.setAttributeNS(a.namespaceURI, a.name, a.value); }
    /* the live properties of form controls follow the markup, unless the reader is in the control */
    const tg = from.tagName;
    if((tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') && document.activeElement !== from){
      if(tg === 'INPUT' && (from.type === 'checkbox' || from.type === 'radio')) from.checked = to.hasAttribute('checked');
      else if(tg === 'SELECT'){ const v = [...to.options].findIndex(o => o.hasAttribute('selected')); if(v >= 0) from.selectedIndex = v; }
      else { const v = tg === 'TEXTAREA' ? to.textContent : (to.getAttribute('value') || ''); if(from.value !== v) from.value = v; }
    }
  }
  function node(from, to){
    if(from.nodeType === 3 || from.nodeType === 8){ if(from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return; }
    if((from.id === 'enginehost' || from.getAttribute('data-morph') === 'keep') && from.dataset.live === '1') return;   /* the live 3D host keeps its canvas */
    attrs(from, to);
    if(from.tagName === 'TEXTAREA') return;
    kids(from, to);
  }
  function kids(from, to){
    let cur = from.firstChild;
    for(let nx = to.firstChild; nx; ){
      const next = nx.nextSibling, k = keyOf(nx);
      let match = null;
      if(k){ for(let c = cur; c; c = c.nextSibling) if(keyOf(c) === k){ match = c; break; }
        if(!match && nx.id){ const g = from.ownerDocument.getElementById(nx.id); if(g && g.parentNode === from) match = g; } }
      else {
        /* an unkeyed element: first the next sibling of the same tag and class, then (a few ahead) one of the same tag and class,
           so an inserted bar never takes over a scrolling list; only then the next sibling of the same tag */
        const cls = n => n.nodeType === 1 ? (n.getAttribute('class') || '') : null, kin = (c, n) => same(c, n) && !keyOf(c) && cls(c) === cls(n);
        if(cur && kin(cur, nx)) match = cur;
        else { let c = cur, n = 0; while(c && n < 6){ if(kin(c, nx)){ match = c; break; } c = c.nextSibling; n++; } }
        if(!match && cur && same(cur, nx) && !keyOf(cur)){ let c = cur.nextSibling, n = 0, later = false; while(c && n < 6){ if(kin(c, nx)){ later = true; break; } c = c.nextSibling; n++; }
          /* the next sibling changes into the new one, unless its own kind comes next in the new markup (then the new node is an insertion) */
          let q = nx.nextSibling, m = 0, needed = false; while(q && m < 6){ if(q.nodeType === 1 && kin(cur, q)){ needed = true; break; } q = q.nextSibling; m++; }
          if(!later && !needed) match = cur; }
      }
      if(match){ if(match !== cur) from.insertBefore(match, cur); node(match, nx); cur = match.nextSibling; }
      else { from.insertBefore(nx, cur); }   /* the new node itself (parsed in this document, so SVG keeps its namespace) */
      nx = next;
    }
    while(cur){ const n = cur.nextSibling; from.removeChild(cur); cur = n; }
  }
  function into(el, html){
    if(!el) return;
    tpl.innerHTML = html;
    const frag = document.importNode(tpl.content, true);
    kids(el, frag);
  }
  return { into };
})();
