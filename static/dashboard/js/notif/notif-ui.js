/* ============================================================================
   NOTIFICATION UI (D49, stages 2–4): the bell, the flyout panel, the full
   page and the Settings preference matrix. Laws: the ribbon is untouched;
   nothing here is ever red — attention renders amber; the badge is neutral,
   caps at 99+, hides at zero; opening the panel does NOT mark read; every
   row deep-links to its source; lists never render more than PAGE_N rows
   without "Show more".
   ============================================================================ */
window.EKO_NF = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const N = () => window.EKO_NOTIF;
  const T = () => window.EKO_NOTIF_TYPES;
  const esc = s => C().esc(s);
  const PAGE_N = 50;

  function st(E){
    if(!E.state.nf) E.state.nf = {
      open: false, tab: 'all', menu: false, loading: false, loaded: false,
      exp: {}, undo: null, others: false, page: { q: '', from: '', to: '', limit: PAGE_N },
      prefs: false, error: false };
    return E.state.nf;
  }

  /* ------------------------------ helpers --------------------------------- */
  function rel(E, iso2){
    const s = (Date.now() - new Date(iso2).getTime())/1000;
    if(s < 60) return E.t('nfNow');
    if(s < 3600) return Math.floor(s/60) + E.t('nfMinS');
    if(s < 86400) return Math.floor(s/3600) + E.t('nfHourS');
    return Math.floor(s/86400) + E.t('nfDayS');
  }
  function dayLabel(E, iso2){
    const d = new Date(iso2), now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if(d.getTime() >= d0) return E.t('todayW');
    if(d.getTime() >= d0 - 86400000) return E.t('yesterdayW');
    return d.toLocaleDateString(E.lang === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'short' });
  }
  function params2(E, n){
    const p = Object.assign({}, n.params), ar = E.lang === 'ar';
    if(p.catKey) p.cat = E.t(p.catKey);
    /* D122: content resolves per language — an {en, ar} pair picks its
       side; a site param is a site id (estate nameEn/nameAr); an alarm
       param is an alarm id (techEn/techAr). Unknown ids render as-is. */
    Object.keys(p).forEach(k => { const v = p[k]; if(v && typeof v === 'object' && 'en' in v) p[k] = v[E.lang] ?? v.en; });
    if(typeof p.site === 'string' && window.EKO_EST){ const s = window.EKO_EST.site(E, p.site); if(s) p.site = ar ? (s.nameAr || s.nameEn) : s.nameEn; }
    if(typeof p.alarm === 'string'){ const a = E.alarm(p.alarm); if(a) p.alarm = ar ? (a.techAr || a.techEn) : a.techEn; }
    /* string params that are PHRASES (module names, expiry wording, names,
       connector labels) go through the paramAr table in Arabic; codes and
       numbers pass through untouched because the table has no entry (D56) */
    if(ar){
      Object.keys(p).forEach(k => { if(typeof p[k] === 'string') p[k] = E.ph(p[k]); });
    }
    return p;
  }

  /* threading: rows sharing a groupKey render as ONE item (latest state),
     expandable to the history. Input is newest-first. */
  function threaded(rows){
    const seen = {}, out = [];
    rows.forEach(n => {
      if(n.groupKey){
        if(seen[n.groupKey]){ seen[n.groupKey]._thread.push(n); return; }
        const t2 = Object.assign({}, n, { _thread: [] });
        seen[n.groupKey] = t2; out.push(t2);
      } else out.push(n);
    });
    return out;
  }
  function filtered(E, rows){
    const tab = st(E).tab;
    if(tab === 'unread') return rows.filter(n => !n.readAt);
    if(tab === 'wo') return rows.filter(n => n.category === 'workOrder');
    if(tab === 'system') return rows.filter(n => n.category === 'integration' || n.category === 'platform');
    return rows;
  }
  function ordered(rows){
    return rows.slice().sort((a, b) =>
      ((a.readAt?1:0) - (b.readAt?1:0)) ||
      (new Date(b.createdAt) - new Date(a.createdAt)));
  }
  function activeRows(E){ return N().list().filter(n => n.siteId === N().SITE); }
  function otherRows(E){ return N().list().filter(n => n.siteId !== N().SITE); }

  /* --------------------------- deep-link resolver -------------------------- */
  function follow(E, n){
    N().markRead(n.id);
    st(E).open = false;
    const kind = n.type === 'flood.summary' ? 'overview' : (T().byType[n.type]||{}).deepLink;
    const p = n.params || {};
    const openAsset = (asset, tab2) => {
      /* INBOX pattern (D61): on the notifications page the item's context
         opens in the right pane and the list stays — like Linear's inbox;
         everywhere else the deep link navigates to the register. */
      if(E.state.pageId === 'notifications'){
        st(E).sel = n.id;
        E.set({ assetSel: asset, apTab: tab2, born: 'asset' });
        return;
      }
      E.go('assets-register', 'assets', 'reg');
      E.set({ assetSel: asset, apTab: tab2 });
    };
    switch(kind){
      case 'workOrder':   if(p.asset){ openAsset(p.asset, 'alarms'); return; } break;
      case 'asset':       if(p.asset || (n.source&&n.source.id)){ openAsset(p.asset || n.source.id, 'analytics'); return; } break;
      case 'alarm':       if(p.asset){ openAsset(p.asset, 'alarms'); return; }
                          E.go('marsa-overview', 'overview', null); return;
      case 'controlTab':  if(p.asset){ openAsset(p.asset, 'control'); return; } break;
      case 'staleAssets': E.go('assets-register', 'assets', 'reg'); E.set({ regStF: 'stale' }); return;
      case 'security':    if(window.EKO_CTL){ window.EKO_CTL.ACTS.ctlSecurity(); return; } break;
      case 'module':      E.go(p.pageId || 'marsa-overview', p.moduleId || 'overview', null); return;
      case 'report': {   /* D90: the immutable document itself */
        const doc = p.id && window.EKO_R ? window.EKO_R.store.get(p.id) : null;
        if(doc){ E.state.report = doc; E.go('report-preview', 'reports', null); return; }
        break; }
      default: break;
    }
    E.go('marsa-overview', 'overview', null);
  }

  /* ------------------------------ row renderer ----------------------------- */
  function row(E, n, wide){
    const def = T().byType[n.type];
    const icon = n.type === 'flood.summary' ? T().CATEGORIES[n.category].icon : (def ? def.icon : 'bell');
    const unread = !n.readAt;
    const cnt = (n.children && n.children.length > 1) ? n.children.length : (n.params && n.params.n > 1 && n.dedupKey ? n.params.n : 0);
    const threadN = n._thread ? n._thread.length : 0;
    const exp = st(E).exp[n.groupKey || n.id];
    const acts = (n.actions||[]).slice(0,2).map(a =>
      `<button class="nfact ${a.kind==='primary'?'nfactP':''}" data-act="nfRowAct" data-id="${esc(n.id)}" data-target="${esc(a.target||'')}">${esc(E.t(a.labelKey))}</button>`).join('');
    const kids = exp && n.children && n.children.length
      ? `<div class="nfkids">${n.children.map(k => `<span class="nfkid tMonoS">${esc(k)}</span>`).join('')}</div>` : '';
    const hist = exp && threadN
      ? `<div class="nfhist">${n._thread.map(h =>
          `<div class="nfhrow"><span class="nfhT">${esc(E.t(h.titleKey))}</span>
           <span class="nfhtime">${esc(rel(E, h.createdAt))}</span></div>`).join('')}</div>` : '';
    const expBtn = (threadN || (n.children && n.children.length > 1))
      ? `<button class="nfexp" data-act="nfExp" data-k="${esc(n.groupKey || n.id)}" aria-expanded="${!!exp}">${esc(E.t('nfHistory',{n: threadN ? threadN + 1 : n.children.length}))}</button>` : '';
    return `<div class="nfrow${unread?' nfunread':''}${n.level==='attention'?' nfatt':''}" data-act="nfRow" data-id="${esc(n.id)}" data-sel="${st(E).sel===n.id && E.state.pageId==='notifications' ? 1 : 0}" role="button" tabindex="0">
      <span class="nficon">${C().icon(icon, 14)}</span>
      <div class="nfbody">
        <div class="nftitle">${unread?'<span class="nfdot"></span>':''}${esc(E.t(n.titleKey))}
          ${cnt?`<span class="cbadge">${cnt}</span>`:''}${n.level==='attention'?`<span class="statchip nfattchip" data-sev="high" data-tip="${esc(E.t('nfAttentionTip'))}">${esc(E.t('nfAttention'))}</span>`:''}</div>
        <div class="nftext">${esc(E.t(n.bodyKey, params2(E, n)))}</div>
        ${expBtn}${kids}${hist}
        ${acts?`<div class="nfacts hst">${acts}</div>`:''}
      </div>
      <span class="nftime">${esc(rel(E, n.createdAt))}</span>
      <button class="nfarch hst" data-act="nfArch" data-id="${esc(n.id)}" aria-label="${esc(E.t('nfArchiveTip'))}" data-tip="${esc(E.t('nfArchiveTip'))}">${C().icon('x', 11)}</button>
    </div>`;
  }

  function dayGrouped(E, rows, limit){
    let out = '', lastDay = null, shown = 0;
    for(const n of rows){
      if(shown >= limit){ break; }
      const dl = n.readAt ? dayLabel(E, n.createdAt) : E.t('nfUnreadH');
      if(dl !== lastDay){ out += `<div class="nfday">${esc(dl)}</div>`; lastDay = dl; }
      out += row(E, n);
      shown++;
    }
    return { html: out, more: rows.length > limit };
  }

  /* The server notifications' state for this browser (notif-store confirmSession): why the list is
     empty or stale, said once above it. Sign-in happens where the app signs in (Studio FIN Connect,
     the viewer's sign-in), so the notice says so rather than offering a form of its own. */
  function remoteNotice(E){
    const N2 = N();
    if(!N2 || !N2.REMOTE || !N2.remoteState) return '';
    const state = N2.remoteState();
    if(state === 'ok' || state === 'checking') return '';
    const key = state === 'signin' ? 'nfSignIn'
      : state === 'mismatch' ? (N2.remoteCode() === 'session_project_mismatch' ? 'nfSessionOtherProject' : 'nfServerOtherProject')
      : 'nfError';
    return `<div class="nfempty nfauth" data-state="${esc(state)}" role="status"><span class="nfemoji">!</span>${esc(E.t(key))}
      ${state === 'error' ? `<button class="btnG btnSm" data-act="nfRetryRemote">${esc(E.t('retryBtn'))}</button>` : ''}</div>`;
  }

  /* ------------------------------- the panel ------------------------------- */
  function panel(E){
    const s = st(E);
    if(!s.open) return '';
    const tabs = [['all','nfTabAll'],['unread','nfTabUnread'],['wo','nfTabWo'],['system','nfTabSystem']];
    let body;
    if(s.loading){
      body = `<div class="nfload">${[0,1,2].map(()=>`<div class="nfshim"></div>`).join('')}</div>`;
    } else if(s.error){
      body = `<div class="nfempty"><span class="nfemoji">!</span>${esc(E.t('nfError'))}
        <button class="btnG btnSm" data-act="nfRetryLoad">${esc(E.t('retryBtn'))}</button></div>`;
    } else {
      const rows = ordered(filtered(E, threaded(activeRows(E))));
      const notice = remoteNotice(E);
      if(!rows.length){
        body = notice || `<div class="nfempty">${esc(E.t(s.tab==='all'||s.tab==='unread' ? 'nfCaughtUp' : 'nfFilterEmpty'))}</div>`;
      } else if(notice){
        body = notice + dayGrouped(E, rows, PAGE_N).html;
      } else {
        const g = dayGrouped(E, rows, PAGE_N);
        body = g.html;
      }
      const others = otherRows(E);
      if(others.length){
        body += `<button class="nfothers" data-act="nfOthers" aria-expanded="${s.others}">${esc(E.t('nfOther',{n: others.length}))}</button>`;
        if(s.others) body += ordered(threaded(others)).slice(0, 10).map(n => row(E, n)).join('');
      }
    }
    const menu = s.menu ? `<div class="nfmenu">
      <button data-act="nfMarkAll">${esc(E.t('nfMarkAll'))}</button>
      <button data-act="nfArchRead">${esc(E.t('nfArchRead'))}</button>
      <button data-act="nfPrefsOpen">${esc(E.t('nfSettings'))}</button></div>` : '';
    return `<div class="scrim scrimclear" data-act="nfClose"></div>
    <div class="dlg nfpanel" role="dialog" aria-label="${esc(E.t('nfTitle'))}">
      <div class="draghandle"></div>
      <div class="nfhead"><h2>${esc(E.t('nfTitle'))}</h2>
        <button class="iconbtn icon26 msA" data-act="nfMenu" aria-haspopup="menu" aria-label="${esc(E.t('nfMenuTip'))}">${C().icon('dots',14)}</button>
        <button class="iconbtn icon26" data-act="nfClose" aria-label="${esc(E.t('close'))}">${C().icon('x',12)}</button>
        ${menu}</div>
      <div class="nftabs">${tabs.map(t2 =>
        `<button class="seg" data-on="${s.tab===t2[0]}" data-act="nfTab" data-v="${t2[0]}">${esc(E.t(t2[1]))}</button>`).join('')}</div>
      <div class="nflist">${body}</div>
      <button class="nffoot" data-act="nfViewAll">${esc(E.t('nfViewAll'))}</button>
    </div>
`;
  }

  /* --------------------------- the full page ------------------------------- */
  function page(E){
    const s = st(E);
    let rows = ordered(filtered(E, threaded(activeRows(E).concat(otherRows(E)))));
    const q = (s.page.q||'').toLowerCase();
    if(q) rows = rows.filter(n =>
      (E.t(n.titleKey)+' '+E.t(n.bodyKey, params2(E,n))).toLowerCase().includes(q));
    if(s.page.from) rows = rows.filter(n => n.createdAt >= s.page.from);
    if(s.page.to) rows = rows.filter(n => n.createdAt <= s.page.to + 'T23:59:59');
    const g = dayGrouped(E, rows, s.page.limit);
    const tabs = [['all','nfTabAll'],['unread','nfTabUnread'],['wo','nfTabWo'],['system','nfTabSystem']];
    return `<div class="pwarea" data-pg="notifs">
      <div class="pwheadrow"><div class="row gap10 aiC">
        <button class="nfpageback" data-act="nfBack" aria-label="${esc(E.t('nfBack'))}">${C().icon('chevL',12)} ${esc(E.t('nfBack'))}</button>
        <div><span class="alcardt pgtitle">${esc(E.t('nfPageT'))}</span>
        <span class="alcardm"> ${esc(E.t('nfPageSub',{n: rows.length}))}</span></div></div>
        <span class="nfinboxhint deskonly">${esc(E.t('nfInboxHint'))}</span></div>
      <div class="row gap8 wrap aiC">
        <span class="segbox row">${tabs.map(t2 =>
          `<button class="seg" data-on="${s.tab===t2[0]}" data-act="nfTab" data-v="${t2[0]}">${esc(E.t(t2[1]))}</button>`).join('')}</span>
        <input class="nfsearch" data-chg="nfSearch" value="${esc(s.page.q)}" placeholder="${esc(E.t('nfSearchPh'))}" aria-label="${esc(E.t('nfSearchPh'))}">
        <label class="nfdate">${esc(E.t('nfFrom'))} <input type="date" data-chg="nfFrom" value="${esc(s.page.from)}"></label>
        <label class="nfdate">${esc(E.t('nfTo'))} <input type="date" data-chg="nfTo" value="${esc(s.page.to)}"></label>
      </div>
      <div class="pwwidget nfpage">${remoteNotice(E)}${g.html || (remoteNotice(E) ? '' : `<div class="nfempty">${esc(E.t('nfFilterEmpty'))}</div>`)}
        ${g.more ? `<button class="btnG" data-act="nfMore">${esc(E.t('nfShowMore'))}</button>` : ''}</div>
    </div>`;
  }

  /* -------------------- Settings: preference matrix ------------------------ */
  /* the personal switch above is the user's own; whether the SITE creates critical-alarm notifications is the
     server's word and not changeable here, so say which it is, and say "not known" when it is not known */
  function siteNote(E){
    const site = N().siteCritical(), state = site === true ? 'on' : site === false ? 'off' : 'unknown';
    return `<div class="nfpsite" data-state="${state}" role="note">
      <b>${esc(E.t('nfSiteLbl'))}</b> ${esc(E.t(state === 'on' ? 'nfSiteOn' : state === 'off' ? 'nfSiteOff' : 'nfSiteUnknown'))}</div>`;
  }
  function prefsDlg(E){
    const s = st(E);
    if(!s.prefs) return '';
    const cats = {};
    T().TYPES.forEach(t2 => { (cats[t2.category] = cats[t2.category] || []).push(t2); });
    const rows = Object.keys(cats).map(cat => `
      <div class="tLbl seclbl">${esc(E.t(T().CATEGORIES[cat].labelKey))}</div>
      ${cats[cat].map(t2 => `<div class="nfprow">
        <span class="nfpname">${esc(E.t(t2.titleKey))}</span>
        <button class="nfptgl" data-on="${N().prefOn(t2.type)}" data-act="nfPrefTgl" data-v="${esc(t2.type)}" role="switch" aria-checked="${N().prefOn(t2.type)}"><span></span></button>
        <button class="nfpres tipU" disabled data-tip="${esc(E.t('nfChannelSoon'))}">${esc(E.t('nfEmail'))}</button>
        <button class="nfpres tipU" disabled data-tip="${esc(E.t('nfChannelSoon'))}">${esc(E.t('nfTeams'))}</button>
      </div>${t2.type === 'alarm.critical' ? siteNote(E) : ''}`).join('')}`).join('');
    return `<div class="scrim" data-act="nfPrefsClose"></div>
    <div class="dlg ctldlg nfprefs" role="dialog" aria-label="${esc(E.t('nfPrefsT'))}">
      <div class="dlghead"><h2>${esc(E.t('nfPrefsT'))}</h2>
        <button class="iconbtn msA" data-act="nfPrefsClose" aria-label="${esc(E.t('close'))}">${C().icon('x',14)}</button></div>
      <div class="nfphead"><span></span><span>${esc(E.t('nfInApp'))}</span><span>${esc(E.t('nfEmail'))}</span><span>${esc(E.t('nfTeams'))}</span></div>
      ${rows}
      <p class="ctlfoot">${esc(E.t('nfPrefsFoot'))}</p></div>`;
  }

  function overlays(E){ return panel(E) + prefsDlg(E); }

  /* ------------------------------ bell markup ------------------------------ */
  function bell(E){
    const b = N().badge();
    const other = N().otherUnread().length;
    return `<button class="iconbtn tipU notifbtn" data-act="nfTgl" data-tip="${esc(E.t('nfTitle'))}" aria-label="${esc(E.t('nfTitle'))}" aria-haspopup="dialog">
      ${C().icon('bell',18)}${b?`<span class="cbadge notifpos">${esc(b)}</span>`:''}${(!b&&other)?`<span class="nfodotb"></span>`:''}</button>`;
  }

  /* -------------------------------- actions -------------------------------- */
  let undoTimer = null;
  const ACTS = {
    nfTgl(){ const E = window.EKO, s = st(E);
      s.open = !s.open; s.menu = false;
      /* anchor the popover under the bell (D61): its inline-end edge aligns
         with the bell's; the CSS falls back to 96px if the bell is not found */
      const b = document.querySelector('.notifbtn');
      if(b){ const r = b.getBoundingClientRect();
        const end = (window.DASHBOARD_ROOT||document.documentElement).dir === 'rtl' ? r.left : window.innerWidth - r.right;
        (window.DASHBOARD_ROOT||document.documentElement).style.setProperty('--nfEnd', Math.max(8, Math.round(end)) + 'px'); }
      if(s.open && !s.loaded){ s.loading = true; s.loaded = true;
        setTimeout(() => { st(E).loading = false; E.set({}); }, 400); }
      E.set({}); },
    nfClose(){ const E = window.EKO; st(E).open = false; st(E).menu = false; E.set({}); },
    nfTab(el){ const E = window.EKO; st(E).tab = el.dataset.v; E.set({}); },
    nfMenu(){ const E = window.EKO, s = st(E); s.menu = !s.menu; E.set({}); },
    nfMarkAll(){ const E = window.EKO; N().markAllRead(N().SITE); st(E).menu = false; E.set({}); },
    nfArchRead(){ const E = window.EKO; N().archiveRead(N().SITE); st(E).menu = false; E.set({}); },
    /* a dialog above its parent: the panel stays open and is returned to (D67) */
    nfPrefsOpen(){ const E = window.EKO, s = st(E); s.prefs = true; s.menu = false; E.set({}); },
    nfPrefsClose(){ const E = window.EKO; st(E).prefs = false; E.set({}); },
    nfPrefTgl(el){ const E = window.EKO;
      N().setPref(el.dataset.v, !N().prefOn(el.dataset.v)); E.set({}); },
    nfRow(el, ev){ const E = window.EKO;
      if(ev && ev.target.closest('[data-act="nfArch"],[data-act="nfExp"],[data-act="nfRowAct"]')) return;
      const n = N().list().find(x => x.id === el.dataset.id);
      if(n) follow(E, n); E.set({}); },
    nfRowAct(el){ const E = window.EKO;
      const n = N().list().find(x => x.id === el.dataset.id);
      if(el.dataset.target === 'retryQueue'){
        if(n) N().markRead(n.id);
        if(window.EKO_CMMS) window.EKO_CMMS.retryNow();
        E.set({}); return;
      }
      if(n) follow(E, n); E.set({}); },
    nfExp(el){ const E = window.EKO, s = st(E);
      s.exp[el.dataset.k] = !s.exp[el.dataset.k]; E.set({}); },
    nfArch(el){ const E = window.EKO, s = st(E);
      N().archive(el.dataset.id);
      s.undo = el.dataset.id;
      if(undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(() => { st(window.EKO).undo = null; }, 6000);
      if(window.EKO_FB) window.EKO_FB.toast({ tone:'info', text: E.t('nfArchived'), action: { label: E.t('nfUndo'), act:'nfUndo' }, ms: 6000 });   /* D75 */
      E.set({}); },
    nfUndo(){ const E = window.EKO, s = st(E);
      if(s.undo){ N().unarchive(s.undo); s.undo = null;
        if(undoTimer) clearTimeout(undoTimer); }
      E.set({}); },
    nfOthers(){ const E = window.EKO, s = st(E); s.others = !s.others; E.set({}); },
    nfViewAll(){ const E = window.EKO, s = st(E); s.open = false;
      /* remember where the user came from so the inbox has a way back */
      if(E.state.pageId !== 'notifications')
        s.back = { pageId: E.state.pageId, module: E.state.module, sub: E.state.sub };
      E.go('notifications', 'overview', null); },
    nfBack(){ const E = window.EKO, s = st(E); const b = s.back || { pageId:'marsa-overview', module:'overview', sub:null };
      s.sel = null; E.set({ assetSel: null });
      E.go(b.pageId, b.module, b.sub); },
    nfMore(){ const E = window.EKO; st(E).page.limit += PAGE_N; E.set({}); },
    nfSearch(el){ const E = window.EKO; st(E).page.q = el.value; E.set({});
      const i = document.querySelector('.nfsearch');
      if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
    nfFrom(el){ const E = window.EKO; st(E).page.from = el.value; E.set({}); },
    nfTo(el){ const E = window.EKO; st(E).page.to = el.value; E.set({}); },
    nfRetryRemote(){ if(N() && N().confirmSession) N().confirmSession(); },
    nfRetryLoad(){ const E = window.EKO, s = st(E); s.error = false; s.loading = true;
      setTimeout(() => { st(E).loading = false; E.set({}); }, 400); E.set({}); }
  };

  return { bell, overlays, page, ACTS, st, follow };
})();
