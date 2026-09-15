/* ============================================================================
   EKO control + PIN authorisation (D43).
   The approved reference supplies the ANATOMY (panel control tab, PIN dialog,
   override dialog, engineering view); the control law supplies the BEHAVIOUR
   (hashed PIN, first-time setup, weak-PIN rules, attempts and lockout, the
   five-minute window with extension on action, auto-lock triggers, clamped
   writes with read-back, audit and notification).
   MOCK NOTICE — this is a client-side prototype service: the PIN is stored
   ONLY as a salted SHA-256 hash in localStorage, attempts/lockout guard
   likewise; production moves verification, lockout, audit and notification
   server-side. See handoff/control-and-pin.md.
   ============================================================================ */
window.EKO_CTL = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = s => C().esc(s);

  /* ------------------ compact synchronous SHA-256 (mock only) -------------- */
  function sha256(ascii){
    function rr(v,c){ return (v>>>c)|(v<<(32-c)); }
    const mathPow = Math.pow, maxWord = mathPow(2,32);
    let result = '', words = [], asciiBitLength = ascii.length*8;
    let hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [];
    let primeCounter = k.length;
    const isComposite = {};
    for(let candidate = 2; primeCounter < 64; candidate++){
      if(!isComposite[candidate]){
        for(let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, .5)*maxWord)|0;
        k[primeCounter++] = (mathPow(candidate, 1/3)*maxWord)|0;
      }
    }
    ascii += '\x80';
    while(ascii.length%64 - 56) ascii += '\x00';
    for(let i = 0; i < ascii.length; i++){
      const j = ascii.charCodeAt(i);
      if(j>>8) return '';                       /* ASCII input only */
      words[i>>2] |= j << ((3-i)%4)*8;
    }
    words[words.length] = ((asciiBitLength/maxWord)|0);
    words[words.length] = (asciiBitLength);
    for(let j = 0; j < words.length;){
      const w = words.slice(j, j += 16);
      const oldHash = hash.slice(0);
      for(let i = 0; i < 64; i++){
        const w15 = w[i-15], w2 = w[i-2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + (rr(e,6) ^ rr(e,11) ^ rr(e,25))
          + ((e&hash[5]) ^ ((~e)&hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
              w[i-16]
              + (rr(w15,7) ^ rr(w15,18) ^ (w15>>>3))
              + w[i-7]
              + (rr(w2,17) ^ rr(w2,19) ^ (w2>>>10))
            )|0);
        const temp2 = (rr(a,2) ^ rr(a,13) ^ rr(a,22))
          + ((a&hash[1]) ^ (a&hash[2]) ^ (hash[1]&hash[2]));
        hash = [(temp1+temp2)|0].concat(hash);
        hash[4] = (hash[4]+temp1)|0;
      }
      for(let i = 0; i < 8; i++) hash[i] = (hash[i]+oldHash[i])|0;
    }
    for(let i = 0; i < 8; i++)
      for(let j = 3; j+1; j--){
        const b = (hash[i]>>(j*8))&255;
        result += ((b>>4).toString(16)) + ((b&15).toString(16));
      }
    return result;
  }

  /* --------------------------- mock PIN service ---------------------------- */
  const LS_PIN = 'eko-pin-mock', LS_GUARD = 'eko-pin-guard';
  const svc = {
    read(){ try{ return JSON.parse(localStorage.getItem(LS_PIN)||'null'); }catch(e){ return null; } },
    hasPin(){ return !!svc.read(); },
    setPin(pin){ try{ localStorage.setItem(LS_PIN, JSON.stringify({ hash: sha256('eko-salt:'+pin) })); }catch(e){} },
    clearPin(){ try{ localStorage.removeItem(LS_PIN); }catch(e){} },   /* admin reset */
    check(pin){ const r = svc.read(); return !!r && r.hash === sha256('eko-salt:'+pin); },
    guard(){ try{ return JSON.parse(localStorage.getItem(LS_GUARD)||'{}'); }catch(e){ return {}; } },
    setGuard(g){ try{ localStorage.setItem(LS_GUARD, JSON.stringify(g)); }catch(e){} }
  };

  /* the failed RULE is surfaced, never a generic error; extension/employee
     number is unknown in the prototype (open-questions.md) */
  function weakRule(pin){
    if(!/^\d{6}$/.test(pin)) return 'pinRule6';
    if(/^(\d)\1{5}$/.test(pin)) return 'pinRuleRepeat';
    let asc = true, desc = true;
    for(let i = 1; i < 6; i++){
      const d = pin.charCodeAt(i) - pin.charCodeAt(i-1);
      if(d !== 1) asc = false;
      if(d !== -1) desc = false;
    }
    if(asc || desc) return 'pinRuleSeq';
    return null;
  }

  /* session audit trail + operator notifications (contract: data-contracts.md) */
  const audit = [];
  const notifs = [];
  const WINDOW_S = 300, MAX_ATTEMPTS = 3, LOCKOUT_MIN = 15,
        IDLE_LOCK_S = 60, HIDDEN_LOCK_S = 120;

  function st(E){
    if(!E.state.ctl) E.state.ctl = {
      dlg: null, unlockedUntil: 0, unlockAsset: null, pinVal: '', pin2Val: '',
      pinErr: null, reason: '', ovrPt: null, ovrVal: '', ovrExp: '8h',
      write: null, big: false, lastAct: Date.now(), hiddenAt: 0 };
    return E.state.ctl;
  }
  function siteControl(E){ const v = (E.data.features||{}).control || 'off'; return v === 'demo' && !(window.EKO_BUILD && window.EKO_BUILD.demo) ? 'off' : v; }   /* D129: the demo capability exists only in demo builds */
  function canControl(E){ return !!(E.data.user||{}).canControl; }
  function showsControl(E, r){
    return !!(r && r.controllable && (r.points||[]).length
      && siteControl(E) !== 'off' && canControl(E));
  }
  function unlocked(E){ return st(E).unlockedUntil > Date.now(); }
  function remainTxt(E){
    const s = Math.max(0, Math.round((st(E).unlockedUntil - Date.now())/1000));
    return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0');
  }
  function lockedOut(){ return (svc.guard().until||0) > Date.now(); }
  function lockoutMin(){ return Math.ceil(((svc.guard().until||0) - Date.now())/60000); }
  /* bilingual composer: writes store BOTH languages so a later language
     switch renders the override note correctly (no frozen-language text) */
  function T(lang, k, a){
    let str = ((window.EKO_I18N||{})[lang]||{})[k] || k;
    Object.keys(a||{}).forEach(kk => { str = str.replace('{'+kk+'}', a[kk]); });
    return str;
  }
  function nowTxt(){ const d = new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }

  function logAudit(E, entry){
    audit.unshift(Object.assign({
      ts: nowTxt(), user: (E.data.user||{}).name || '—', role: (E.data.user||{}).role || '—',
      site: 'Marsa Al Arab', source: 'EKO' }, entry));
  }
  function notifyOthers(E, text){
    ((E.data.controlUsers)||[]).filter(u => u !== (E.data.user||{}).name)
      .forEach(u => notifs.push({ to: u, type: 'admin.setpoint_changed', text, ts: nowTxt() }));
  }

  function doLock(E, why){
    const s = st(E);
    if(s.unlockedUntil){
      s.unlockedUntil = 0; s.big = false; s.unlockAsset = null;
      logAudit(E, { pinEvent: 'lock', point: null, result: why });
      E.set({});
    }
  }

  /* -------- auto-lock engine: expiry, idle, hidden tab, navigation --------- */
  let tickTimer = null;
  function ensureTick(E){
    if(tickTimer) return;
    document.addEventListener('visibilitychange', () => {
      const s = st(E);
      s.hiddenAt = document.hidden ? Date.now() : 0;
    });
    document.addEventListener('click', ev => {
      const s = st(E);
      if(ev.target.closest && (ev.target.closest('#assetpanel') || ev.target.closest('#engview')))
        s.lastAct = Date.now();
    }, true);
    tickTimer = setInterval(() => {
      const s = st(E);
      if(!s.unlockedUntil) return;
      if(Date.now() >= s.unlockedUntil) return doLock(E, 'expired');
      if(s.unlockAsset && E.state.assetSel !== s.unlockAsset) return doLock(E, 'navigated away');
      if(Date.now() - s.lastAct > IDLE_LOCK_S*1000) return doLock(E, 'idle 60s');
      if(s.hiddenAt && Date.now() - s.hiddenAt > HIDDEN_LOCK_S*1000) return doLock(E, 'tab hidden 2m');
      document.querySelectorAll('[data-ctlcount]').forEach(el => { el.textContent = remainTxt(E); });
    }, 1000);
  }

  /* ------------------------------- renderers ------------------------------- */
  function ptVal(p){ if(p.kind === 'binary') return p.value;
    const v = (p.dp != null) ? Number(p.value).toFixed(p.dp) : p.value;
    return v + (p.unit ? ' ' + p.unit : ''); }

  function controlTab(E, r){
    const s = st(E), ar = E.lang === 'ar', un = unlocked(E);
    ensureTick(E);
    const rows = (r.points||[]).map(p => {
      const note = p.override
        ? `<span class="ctlnote">${esc(E.t('ovrNote',{u: ar?(p.override.byAr||p.override.byEn):p.override.byEn, when: ar?(p.override.whenAr||p.override.whenEn):p.override.whenEn, exp: ar?(p.override.expAr||p.override.expEn):p.override.expEn}))}${p.override.revert!=null?` · ${esc(E.t('revertsTo',{v:p.override.revert+(p.unit||'')}))}`:''}</span>`
        : '';
      const cmd = un && p.writable;
      return `<${cmd?'button':'div'} class="ctlrow${cmd?' ctlcmd':''}" ${cmd?`data-act="ctlOvrOpen" data-pt="${esc(p.id)}"`:''}>
        <div class="ctlrow1"><span class="ctlname">${esc(ar?(p.nameAr||p.nameEn):p.nameEn)}</span>
          <span class="ctlval">${esc(ptVal(p))}</span>
          <span class="ctlmode" data-m="${p.mode}">${esc(E.t(p.mode==='manual'?'modeManual':'modeAuto'))}</span></div>
        ${note}</${cmd?'button':'div'}>`;
    }).join('');
    const gate = lockedOut()
      ? `<div class="ctllock"><span class="ctllockic">${C().icon('lock',20)}</span>
          <span class="ctllockt">${esc(E.t('lockoutMsg',{m:lockoutMin()}))}</span></div>`
      : un
      ? `<div class="ctlunbar"><span class="ctlundot"></span>
          <span>${esc(E.t('ctlUnlockedBar'))} <b class="tMonoS" data-ctlcount>${remainTxt(E)}</b> ${esc(E.t('remainW'))}</span>
          <button class="ctllocknow" data-act="ctlLockNow">${esc(E.t('lockNow'))}</button></div>
        <button class="ctlthumb" data-act="ctlBigOpen">
          <span class="ctlthumbh"><span>${esc(E.t('engView'))}</span><span class="cAcc">${esc(E.t('openLarge'))} ⛶</span></span>
          <img src="${esc(r.finImg)}" alt="${esc(E.t('engView'))}" loading="lazy"></button>`
      : `<div class="ctllock"><span class="ctllockic">${C().icon('lock',20)}</span>
          <span class="ctllockt">${esc(E.t('ctlLockedT'))}</span>
          <button class="btnP btnSm" data-act="ctlUnlockOpen">${esc(E.t('ctlUnlockBtn'))}</button></div>`;
    const demo = siteControl(E) === 'demo'
      ? ` <span class="ctldemo">${esc(E.t('ctlDemoTag'))}</span>` : '';
    return `<div class="ctlmeta">${esc(E.t('ctlMeta'))}${demo}</div>
      ${rows}${gate}
      <p class="apnote">${esc(E.t('lifeSafety'))}</p>`;
  }

  /* audit rows scoped to one asset, for the Activity tab */
  function assetAudit(id){ return audit.filter(a => a.asset === id && a.point); }

  /* D45 — six REAL inputs per row (native focus, masking, numeric keypad).
     The old anatomy (inert spans + one hidden pointer-events:none input that
     every re-render destroyed) could not receive user input at all. The row
     is forced dir="ltr": PIN digits fill left to right in Arabic too. */
  function pinBoxes(E, row, val){
    return `<div class="pinrow" dir="ltr">${[0,1,2,3,4,5].map(i =>
      `<input class="pinbox" type="password" inputmode="numeric" pattern="[0-9]*"
        maxlength="6" autocomplete="off" data-pinrow="${row}" data-idx="${i}" tabindex="${i===0?0:-1}"
        value="${(val||'')[i]||''}" aria-label="${esc(E.t('pin6'))} ${i+1}">`).join('')}</div>`;
  }
  /* rows present per dialog view, in tab order */
  function pinRowsFor(s){
    if(s.dlg === 'security' && s.secView === 'changepin') return ['cur','pin','pin2'];
    if(s.dlg === 'setup') return ['pin','pin2'];
    return ['pin'];
  }
  const ROWKEY = { cur: 'curVal', pin: 'pinVal', pin2: 'pin2Val' };
  function pinFocusFirst(){
    const b = document.querySelector('.pinbox');
    if(b) b.focus();
  }
  function pinSyncButtons(E){
    const s = st(E);
    const full = k => (s[k]||'').length === 6;
    const setBtn = document.querySelector('[data-act="ctlSetupGo"]');
    if(setBtn) setBtn.disabled = !(full('pinVal') && full('pin2Val'));
    const chgBtn = document.querySelector('[data-act="ctlChangePinGo"]');
    if(chgBtn) chgBtn.disabled = !(full('curVal') && full('pinVal') && full('pin2Val'));
  }
  function pinReadRow(row){
    return [...document.querySelectorAll(`.pinbox[data-pinrow="${row}"]`)]
      .map(b => b.value).join('');
  }
  function pinWriteState(E, row){
    const s = st(E);
    s[ROWKEY[row]] = pinReadRow(row);
    /* typing clears a shown error without a re-render (focus survives) */
    if(s.pinErr){ s.pinErr = null; const e = document.querySelector('.pinerr'); if(e) e.remove(); }
    pinSyncButtons(E);
  }
  /* movement is ROW-SCOPED: typing, Backspace and arrows stay inside their
     set; only Tab (row-to-row tab stops) or a click moves to the next set. */
  function pinMove(box, delta){
    const i = +box.dataset.idx + delta;
    if(i < 0 || i > 5) return null;
    return document.querySelector(`.pinbox[data-pinrow="${box.dataset.pinrow}"][data-idx="${i}"]`);
  }
  /* advancement is driven by the INPUT event: it fires for real keyboards,
     IMEs, autofill and text-insertion alike (keydown alone does not). Extra
     characters are redistributed forward, so a box is never "full" and
     silent. */
  document.addEventListener('input', ev => {
    const box = ev.target.closest && ev.target.closest('.pinbox');
    if(!box) return;
    const E = window.EKO;
    const digits = box.value.replace(/\D/g, '');
    box.value = digits.slice(0, 1);
    let cur = box, rest = digits.slice(1);
    while(rest){
      const n = pinMove(cur, 1);
      if(!n) break;
      n.value = rest[0]; rest = rest.slice(1); cur = n;
    }
    pinWriteState(E, box.dataset.pinrow);
    if(digits){ const n = pinMove(cur, 1); (n || cur).focus(); }   /* row end: stay */
  });
  document.addEventListener('keydown', ev => {
    const box = ev.target.closest && ev.target.closest('.pinbox');
    if(!box) return;
    const E = window.EKO;
    if(ev.key === 'Escape'){ ev.preventDefault(); ACTS.ctlDlgClose(); return; }
    if(ev.key === 'ArrowLeft' || ev.key === 'ArrowRight'){
      ev.preventDefault();
      const n = pinMove(box, ev.key === 'ArrowRight' ? 1 : -1);
      if(n) n.focus();
      return;
    }
    if(ev.key === 'Backspace'){
      ev.preventDefault();
      if(box.value){ box.value = ''; }
      else { const p = pinMove(box, -1); if(p){ p.value = ''; p.focus();
        pinWriteState(E, p.dataset.pinrow); return; } }
      pinWriteState(E, box.dataset.pinrow);
      return;
    }
    if(/^[0-9]$/.test(ev.key)){
      /* clear the box so the native input event carries just this digit */
      box.value = '';
      return;
    }
    if(ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) ev.preventDefault(); /* non-digits ignored */
  });
  document.addEventListener('paste', ev => {
    const box = ev.target.closest && ev.target.closest('.pinbox');
    if(!box) return;
    ev.preventDefault();
    const digits = (ev.clipboardData.getData('text')||'').replace(/\D/g, '');
    if(digits.length !== 6) return;   /* anything but 6 digits is ignored */
    const row = box.dataset.pinrow;
    document.querySelectorAll(`.pinbox[data-pinrow="${row}"]`)
      .forEach((b, i) => { b.value = digits[i]; });
    pinWriteState(window.EKO, row);
    const last = document.querySelector(`.pinbox[data-pinrow="${row}"][data-idx="5"]`);
    if(last) last.focus();          /* stay in this set; Tab/click moves on */
  });

  function overlays(E){
    const s = st(E), ar = E.lang === 'ar';
    let out = '';
    const r = E.data.assets.find(a => a.id === E.state.assetSel);
    if(s.dlg === 'pin' || s.dlg === 'setup'){
      const setup = s.dlg === 'setup';
      out += `<div class="scrim" data-act="ctlDlgClose"></div>
      <div class="dlg ctldlg" role="dialog" aria-modal="true" aria-label="${esc(E.t(setup?'setupT':'pinDlgT'))}">
        <div class="dlghead"><h2>${esc(E.t(setup?'setupT':'pinDlgT'))}</h2>
          <button class="iconbtn msA" data-act="ctlDlgClose" aria-label="${esc(E.t('close'))}">${C().icon('x',14)}</button></div>
        <div class="ctldlgsub">${esc(E.t('signedInAs',{id: E.state.assetSel||'', u: ar?((E.data.user||{}).nameAr||(E.data.user||{}).name):((E.data.user||{}).name||'')}))}</div>
        ${setup ? `<p class="ctlexp">${esc(E.t('setupBody'))}</p>
          <div class="tLbl">${esc(E.t('setupNew'))}</div>${pinBoxes(E, 'pin', s.pinVal)}
          <div class="tLbl mbs8">${esc(E.t('setupConfirm'))}</div>${pinBoxes(E, 'pin2', s.pin2Val)}`
        : `<div class="tLbl">${esc(E.t('pin6'))}</div>${pinBoxes(E, 'pin', s.pinVal)}`}
        ${s.pinErr ? `<div class="pinerr">${esc(E.t(s.pinErr, s.pinErrArgs||{}))}</div>` : ''}
        ${setup ? '' : `<div class="tLbl mbs10">${esc(E.t('reasonOpt'))}</div>
          <input class="ctlreason" data-chg="ctlReason" value="${esc(s.reason||'')}" placeholder="${esc(E.t('reasonPh'))}">`}
        <div class="row gap8 mbs12">
          <button class="btnP grow" data-act="${setup?'ctlSetupGo':'ctlVerify'}" ${setup&&!((s.pinVal||'').length===6&&(s.pin2Val||'').length===6)?'disabled':''}>${esc(E.t(setup?'setupBtn':'verifyBtn'))}</button>
          <button class="btnG" data-act="ctlDlgClose">${esc(E.t('cancelW'))}</button></div>
        <p class="ctlfoot">${esc(E.t('pinFoot'))}${setup?'':' '+esc(E.t('forgotNote',{u:'S. Khan'}))}</p></div>`;
    }
    if(s.dlg === 'security'){
      out += securityDlg(E, s);
    }
    if(s.dlg === 'ovr' && r){
      const p = (r.points||[]).find(x => x.id === s.ovrPt);
      if(p){
        const w = s.write;
        const exps = [['1h','exp1h'],['8h','exp8h'],['24h','exp24h'],['rel','expRel']];
        out += `<div class="scrim" data-act="ctlDlgClose"></div>
        <div class="dlg ctldlg" role="dialog" aria-modal="true" aria-label="${esc(E.t('ovrTitle',{p:ar?(p.nameAr||p.nameEn):p.nameEn, v:s.ovrVal}))}">
          <div class="dlghead"><h2>${esc(E.t('ovrTitle',{p:ar?(p.nameAr||p.nameEn):p.nameEn, v:(s.ovrVal||'—')+(p.unit?' '+p.unit:'')}))}</h2>
            <button class="iconbtn msA" data-act="ctlDlgClose" aria-label="${esc(E.t('close'))}">${C().icon('x',14)}</button></div>
          <div class="ovrline"><span class="cT2">${esc(E.t('ovrCurrent'))}</span> <b class="tMonoS">${esc(ptVal(p))}</b>
            <span class="cT3">→</span> <span class="cT2">${esc(E.t('ovrNew'))}</span>
            <input class="ovrin tMonoS" data-chg="ctlOvrVal" inputmode="decimal" value="${esc(s.ovrVal)}" aria-label="${esc(E.t('ovrNew'))}"> <span class="cT2">${esc(p.unit||'')}</span></div>
          <div class="ovrrange${s.ovrRangeErr?' cCrit':''}">${esc(E.t(s.ovrRangeErr?'ovrOutOfRange':'ovrRange',{lo:p.min, hi:p.max, u:p.unit||''}))}</div>
          <div class="tLbl mbs10">${esc(E.t('ovrExpires'))}</div>
          <div class="row gap6 wrap">${exps.map(x =>
            `<button class="ovrexp" data-on="${s.ovrExp===x[0]?1:0}" data-act="ctlOvrExp" data-v="${x[0]}">${esc(E.t(x[1]))}</button>`).join('')}</div>
          ${w==='sending' ? `<div class="ovrstate">${esc(E.t('wSending'))}</div>` : ''}
          ${w==='failed' ? `<div class="ovrstate cCrit">${esc(E.t('wFailed'))}</div>` : ''}
          ${w&&w.ok ? `<div class="ovrstate cPos">${esc(E.t('wWritten',{v:w.v+(p.unit?' '+p.unit:''), t:w.t}))}</div>` : ''}
          <div class="row gap8 mbs12">
            ${w==='failed'
              ? `<button class="btnP grow" data-act="ctlOvrApply">${esc(E.t('retryBtn'))}</button>`
              : `<button class="btnP grow" data-act="ctlOvrApply" ${w?'disabled':''}>${esc(E.t('ovrApply'))}</button>`}
            <button class="btnG" data-act="ctlDlgClose">${esc(E.t('cancelW'))}</button></div>
          <p class="ctlfoot">${esc(E.t('ovrRecorded'))}</p></div>`;
      }
    }
    if(s.big && unlocked(E) && r){
      out += `<div id="engview">
        <div class="engbar">
          <span class="engt">⧉ ${esc(E.t('engView'))} · <span class="tMonoS">${esc(r.id)}</span></span>
          <span class="engun"><span class="ctlundot"></span>${esc(E.t('unlockedW'))} · <b class="tMonoS" data-ctlcount>${remainTxt(E)}</b></span>
          <span class="msA row gap8">
            <button class="btnG btnSm" data-act="ctlLockNow">${esc(E.t('lockNow'))}</button>
            <button class="iconbtn icon26" data-act="ctlBigClose" aria-label="${esc(E.t('close'))}">${C().icon('x',13)}</button></span>
        </div>
        ${r.finGraphicUrl
          ? `<iframe class="engframe" src="${esc(r.finGraphicUrl)}" title="${esc(E.t('engView'))}"></iframe>`
          : `<button class="engimg" data-act="ctlOvrOpen" data-pt="${esc(((r.points||[]).find(p=>p.writable)||{}).id||'')}" aria-label="${esc(E.t('ovrDefaultTip'))}">
          <img src="${esc(r.finImg)}" alt="${esc(E.t('engView'))}"></button>`}
        <div class="engfoot">${esc(E.t('engFoot'))}</div>
      </div>`;
    }
    return out;
  }

  /* -------------------- Settings > Security (D44) -------------------------- */
  function audRows(E, filt){
    return audit.filter(a => filt === 'writes' ? (!a.pinEvent && a.point)
      : filt === 'pin' ? !!a.pinEvent : true);
  }
  function securityBody(E, s){
    const ar = E.lang === 'ar';
    const rows = audRows(E, s.audFilter || 'all');
    const chip = (v, k) => `<button class="seg" data-on="${(s.audFilter||'all')===v}" data-act="ctlAudFilter" data-v="${v}">${esc(E.t(k))}</button>`;
    const changing = s.secView === 'changepin';
    let pinSec;
    if(changing){
      pinSec = `<div class="tLbl">${esc(E.t('curPin'))}</div>${pinBoxes(E, 'cur', s.curVal)}
        <div class="tLbl mbs8">${esc(E.t('setupNew'))}</div>${pinBoxes(E, 'pin', s.pinVal)}
        <div class="tLbl mbs8">${esc(E.t('setupConfirm'))}</div>${pinBoxes(E, 'pin2', s.pin2Val)}
        ${s.pinErr ? `<div class="pinerr">${esc(E.t(s.pinErr, s.pinErrArgs||{}))}</div>` : ''}
        ${s.secMsg ? `<div class="secok">${esc(E.t(s.secMsg))}</div>` : ''}
        <div class="row gap8 mbs12">
          <button class="btnP grow" data-act="ctlChangePinGo" ${((s.curVal||'').length===6&&(s.pinVal||'').length===6&&(s.pin2Val||'').length===6)?'':'disabled'}>${esc(E.t('changePinBtn'))}</button>
          <button class="btnG" data-act="ctlSecBack">${esc(E.t('cancelW'))}</button></div>`;
    } else {
      pinSec = `<p class="ctlexp">${esc(svc.hasPin() ? E.t('secPinSet',{u:(E.data.user||{}).name}) : E.t('secPinNone'))}</p>
        ${s.secMsg ? `<div class="secok">${esc(E.t(s.secMsg))}</div>` : ''}
        <div class="row gap8 wrap">
          ${svc.hasPin() ? `<button class="btnG btnSm" data-act="ctlSecChangePin">${esc(E.t('changePinBtn'))}</button>` : ''}
          <button class="btnG btnSm" data-act="ctlAdminReset" data-on="${s.adminConfirm?1:0}">${esc(E.t(s.adminConfirm ? 'adminResetConfirm' : 'adminResetBtn'))}</button></div>
        <p class="ctlfoot bare mbs8">${esc(E.t('forgotNote',{u:'S. Khan'}))}</p>`;
    }
    const tbl = rows.length ? `<div class="audwrap"><table class="audt"><thead><tr>
        <th>${esc(E.t('audColTime'))}</th><th>${esc(E.t('audColUser'))}</th><th>${esc(E.t('audColWhat'))}</th>
        <th>${esc(E.t('audColChange'))}</th><th>${esc(E.t('audColResult'))}</th><th>${esc(E.t('audColReason'))}</th></tr></thead>
      <tbody>${rows.map(a => `<tr>
        <td class="tMonoS">${esc(a.ts)}</td><td>${esc(a.user)} <span class="cT3">${esc(a.role)}</span></td>
        <td class="tMonoS">${esc([a.asset, a.point].filter(Boolean).join(' \u00b7 ') || '\u2014')}</td>
        <td class="tMonoS">${a.old!=null ? esc(a.old + ' \u2192 ' + a.val) : '\u2014'}</td>
        <td>${esc(a.pinEvent ? a.pinEvent + ' \u00b7 ' + a.result : a.result)}</td>
        <td>${esc(a.reason || '\u2014')}</td></tr>`).join('')}</tbody></table></div>`
      : `<p class="alempty">${esc(E.t('audEmpty'))}</p>`;
    return `<span class="tLbl">${esc(E.t('secPinT'))}</span>
        ${pinSec}
        <span class="tLbl seclbl">${esc(E.t('secAudT'))}</span>
        <div class="row gap6 wrap aiC">
          <span class="segbox row">${chip('all','audAll')}${chip('writes','audWrites')}${chip('pin','audPin')}</span>
          <button class="btnG btnSm msA" data-act="ctlAudCsv">${esc(E.t('exportCsv'))}</button></div>
        ${tbl}
        <p class="ctlfoot">${esc(E.t('audMockNote'))}</p>`;
  }
  /* the stand-alone dialog frame (kept for the ctl dialog state); Settings › Security embeds securityBody */
  function securityDlg(E, s){
    return `<div class="scrim" data-act="ctlDlgClose"></div>
      <div class="dlg ctldlg secdlg" role="dialog" aria-modal="true" aria-label="${esc(E.t('secT'))}">
        <div class="dlghead"><h2>${esc(E.t('secT'))}</h2>
          <button class="iconbtn msA" data-act="ctlDlgClose" aria-label="${esc(E.t('close'))}">${C().icon('x',14)}</button></div>
        ${securityBody(E, s)}</div>`;
  }

  /* -------------------------------- actions -------------------------------- */
  const ACTS = {
    ctlUnlockOpen(){ const E = window.EKO, s = st(E);
      if(lockedOut()){ E.set({}); return; }
      s.dlg = svc.hasPin() ? 'pin' : 'setup';
      s.pinVal = ''; s.pin2Val = ''; s.pinErr = null; s.reason = '';
      E.set({}); pinFocusFirst(); },
    ctlDlgClose(){ const E = window.EKO, s = st(E); s.dlg = null; s.write = null; E.set({}); },
    ctlVerify(){ const E = window.EKO, s = st(E);
      if(lockedOut()){ s.pinErr = 'lockoutMsg'; s.pinErrArgs = {m:lockoutMin()}; E.set({}); return; }
      if(svc.check(s.pinVal)){
        svc.setGuard({ fails: 0, until: 0 });
        s.dlg = null; s.unlockedUntil = Date.now() + WINDOW_S*1000; if(window.EKO_PWA) window.EKO_PWA.haptic('unlock');
        s.unlockAsset = E.state.assetSel; s.lastAct = Date.now(); s.big = true;  /* reference: auto-open */
        logAudit(E, { pinEvent: 'unlock', asset: E.state.assetSel, reason: s.reason || null, result: 'unlocked' });
      } else {
        const g = svc.guard(); const fails = (g.fails||0) + 1;
        if(fails >= MAX_ATTEMPTS){
          svc.setGuard({ fails: 0, until: Date.now() + LOCKOUT_MIN*60000 });
          s.pinErr = 'lockoutMsg'; s.pinErrArgs = {m: LOCKOUT_MIN};
          logAudit(E, { pinEvent: 'lockout', asset: E.state.assetSel, result: '15m lockout' });
        } else {
          svc.setGuard({ fails, until: 0 });
          s.pinErr = 'pinIncorrect'; s.pinErrArgs = null;
          logAudit(E, { pinEvent: 'failed_attempt', asset: E.state.assetSel, result: 'attempt '+fails });
        }
        s.pinVal = '';
      }
      E.set({}); if(s.pinErr) pinFocusFirst(); },
    ctlSetupGo(){ const E = window.EKO, s = st(E);
      const rule = weakRule(s.pinVal);
      if(rule){ s.pinErr = rule; s.pinVal=''; s.pin2Val=''; E.set({}); pinFocusFirst(); return; }
      if(s.pinVal !== s.pin2Val){ s.pinErr = 'pinRuleMatch'; s.pin2Val=''; E.set({}); pinFocusFirst(); return; }
      svc.setPin(s.pinVal);
      logAudit(E, { pinEvent: 'pin_set', asset: E.state.assetSel, result: 'pin set' });
      s.dlg = null; s.unlockedUntil = Date.now() + WINDOW_S*1000; if(window.EKO_PWA) window.EKO_PWA.haptic('unlock');   /* unlocks immediately */
      s.unlockAsset = E.state.assetSel; s.lastAct = Date.now(); s.big = true;
      E.set({}); },
    ctlLockNow(){ doLock(window.EKO, 'manual'); },
    ctlBigOpen(){ const E = window.EKO, s = st(E); s.big = true; s.lastAct = Date.now(); E.set({}); },
    ctlBigClose(){ const E = window.EKO, s = st(E); s.big = false; E.set({}); },
    ctlOvrOpen(el){ const E = window.EKO, s = st(E);
      if(!unlocked(E)) return;
      const r = E.data.assets.find(a => a.id === E.state.assetSel);
      const p = r && (r.points||[]).find(x => x.id === el.dataset.pt);
      if(!p || !p.writable) return;
      s.dlg = 'ovr'; s.ovrPt = p.id; s.ovrVal = String(p.demoTarget != null ? p.demoTarget : p.value);
      s.ovrExp = '8h'; s.ovrRangeErr = false; s.write = null; s.lastAct = Date.now();
      E.set({}); },
    ctlOvrExp(el){ const E = window.EKO, s = st(E); s.ovrExp = el.dataset.v; E.set({}); },
    ctlOvrApply(){ const E = window.EKO, s = st(E);
      const r = E.data.assets.find(a => a.id === E.state.assetSel);
      const p = r && (r.points||[]).find(x => x.id === s.ovrPt);
      if(!p) return;
      const v = parseFloat(s.ovrVal);
      /* clamp law: out-of-range is rejected inline with the range stated */
      if(isNaN(v) || v < p.min || v > p.max){ s.ovrRangeErr = true; E.set({}); return; }
      s.ovrRangeErr = false; s.write = 'sending'; E.set({});
      setTimeout(() => {
        const s2 = st(E);
        if(p.mockFailOnce && !p._failedOnce){
          p._failedOnce = true; s2.write = 'failed';
          logAudit(E, { asset: r.id, point: p.nameEn, old: p.value, val: v, result: 'failed' });
          E.set({}); return;
        }
        /* read-back before showing written (mock echoes the controller value) */
        const old = p.value;
        p.value = v; p.mode = 'manual';
        const expKey = { '1h': 'exp1h', '8h': 'exp8h', '24h': 'exp24h', 'rel': 'expRel' }[s2.ovrExp];
        const expTxt = E.t(expKey);
        p.override = { byEn: (E.data.user||{}).name, byAr: (E.data.user||{}).nameAr || (E.data.user||{}).name,
          whenEn: T('en','whenToday'), whenAr: T('ar','whenToday'),
          expEn: s2.ovrExp==='rel' ? T('en','expRel') : T('en','expiresIn',{d:T('en',expKey)}),
          expAr: s2.ovrExp==='rel' ? T('ar','expRel') : T('ar','expiresIn',{d:T('ar',expKey)}),
          revert: s2.ovrExp==='rel' ? null : old };
        s2.write = { ok: true, v: v, t: nowTxt() };
        s2.unlockedUntil = Date.now() + WINDOW_S*1000;    /* window extends on ACTION */
        logAudit(E, { asset: r.id, point: p.nameEn, old: old, val: v,
          expiry: expTxt, reason: st(E).reason || null, result: 'written' });
        notifyOthers(E, r.id + ' · ' + p.nameEn + ' ' + old + (p.unit||'') + ' → ' + v + (p.unit||''));
        r.activity = r.activity || [];
        r.activity.unshift([E.t('overrideActT'),
          p.nameEn + ' ' + old + (p.unit||'') + ' → ' + v + (p.unit||'') + ' · ' + expTxt + ' · ' + (E.data.user||{}).name,
          E.t('whenToday'), 'prog']);
        E.set({});
        setTimeout(() => { const s3 = st(E); if(s3.dlg === 'ovr'){ s3.dlg = null; s3.write = null; E.set({}); } }, 1200);
      }, 650);
    },
    ctlSecurity(){ const E = window.EKO, s = st(E);   /* D129: Security is a Settings section */
      s.dlg = null; s.secView = 'main'; s.secMsg = null; s.adminConfirm = false;
      s.pinErr = null; s.curVal = ''; s.pinVal = ''; s.pin2Val = ''; E.set({ born:'dlg', dlg:'settings', settingsTab:'security' }); },
    ctlSecChangePin(){ const E = window.EKO, s = st(E);
      s.secView = 'changepin'; s.secMsg = null; s.pinErr = null;
      s.curVal = ''; s.pinVal = ''; s.pin2Val = ''; E.set({}); pinFocusFirst(); },
    ctlSecBack(){ const E = window.EKO, s = st(E);
      s.secView = 'main'; s.pinErr = null; E.set({}); },
    ctlChangePinGo(){ const E = window.EKO, s = st(E);
      if(!svc.check(s.curVal)){ s.pinErr = 'pinWrongCurrent'; s.curVal=''; s.pinVal=''; s.pin2Val=''; E.set({}); pinFocusFirst(); return; }
      const rule = weakRule(s.pinVal);
      if(rule){ s.pinErr = rule; s.pinVal=''; s.pin2Val=''; E.set({}); pinFocusFirst(); return; }
      if(s.pinVal !== s.pin2Val){ s.pinErr = 'pinRuleMatch'; s.pin2Val=''; E.set({}); pinFocusFirst(); return; }
      svc.setPin(s.pinVal);
      logAudit(E, { pinEvent: 'pin_changed', result: 'pin changed' });
      /* admin.pin_changed goes to the USER ONLY (never broadcast) */
      notifs.push({ to: (E.data.user||{}).name, type: 'admin.pin_changed', ts: nowTxt(), text: 'Control PIN changed' });
      s.secView = 'main'; s.secMsg = 'pinChangedOk'; s.pinErr = null;
      s.curVal=''; s.pinVal=''; s.pin2Val=''; E.set({}); },
    ctlAdminReset(){ const E = window.EKO, s = st(E);
      if(!s.adminConfirm){ s.adminConfirm = true; E.set({}); return; }
      s.adminConfirm = false;
      svc.clearPin(); svc.setGuard({});
      doLock(E, 'pin reset');
      /* audit carries BOTH ids: the admin actor and the target user */
      audit.unshift({ ts: nowTxt(), user: 'S. Khan', role: 'admin',
        site: 'Marsa Al Arab', source: 'EKO',
        targetUser: (E.data.user||{}).name,
        pinEvent: 'pin_reset_by_admin', result: 'cleared for ' + (E.data.user||{}).name });
      s.secMsg = 'adminResetDone'; s.dlg = 'security'; E.set({}); },
    ctlAudFilter(el){ const E = window.EKO, s = st(E); s.audFilter = el.dataset.v; E.set({}); },
    ctlAudCsv(){ const E = window.EKO, s = st(E);
      const rows = audRows(E, s.audFilter || 'all');
      const head = ['ts','user','role','site','source','asset','point','old','new','expiry','reason','result','pinEvent','targetUser'];
      const csv = [head.join(',')].concat(rows.map(a =>
        head.map(k => { const v = k==='new' ? a.val : a[k];
          return v==null ? '' : '"'+String(v).replace(/"/g,'""')+'"'; }).join(','))).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a2 = document.createElement('a');
      a2.href = url; a2.download = 'eko-control-audit.csv';
      document.body.appendChild(a2); a2.click(); a2.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000); },
    ctlReason(el){ st(window.EKO).reason = el.value; },
    ctlOvrVal(el){ const s = st(window.EKO); s.ovrVal = el.value; s.ovrRangeErr = false; }
  };

  /* load-time contract validation: a life-safety point can never be writable */
  function validate(data){
    (data.assets||[]).forEach(a => (a.points||[]).forEach(p => {
      if(p.lifeSafety && p.writable){
        p.writable = false;
        console.error('[EKO control] life-safety point forced read-only:', a.id, p.id);
      }
    }));
  }

  return { securityBody: E => securityBody(E, st(E)), controlTab, overlays, showsControl, unlocked, remainTxt, ACTS, validate,
           audit, notifs, svc, weakRule, assetAudit,
           /* surface manager accessors (D67): which dialog / big view is open, and closers */
           dialog: E => st(E).dlg, big: E => !!st(E).big,
           closeDialog: E => { const s = st(E); s.dlg = null; s.write = null; },
           closeBig: E => { st(E).big = false; } };
})();
