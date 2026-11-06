/* ============================================================================
   SHIFT HANDOVER WITH RECEIPT (D144) — EKO_HO.

   Near the end of a shift the outgoing person opens "Prepare handover". It is
   PRE-FILLED with their shift's Brief — what was raised, cleared and
   acknowledged, the work orders that moved, what is still open — plus a note in
   their own words, and may MENTION a named person or the on-call engineer.

   ADDRESSED TO THE SITE AND THE NEXT SHIFT WINDOW, never to a person: whoever
   signs in for that site during the next shift sees it at the top of their
   Brief. The FIRST person to press "Handover received" records the receipt;
   everyone else then reads "Received by [name] at [time]". An unreceived
   handover stays at the top of the Brief until someone receives it, and a
   person holding canReviewHandovers sees the handovers that were never received.

   IMMUTABLE. On submit the handover is stored with the author and the time and
   deep-frozen; nothing edits it. Later additions are timestamped ADDENDA by the
   author; the receipt is a separate record. Every step is audited (the report
   engine's audit log): handover.submit, .notify, .mention, .email, .receive,
   .addendum, .export.

   DELIVERY: the top of the Brief; the shift.handover notification to the site
   (deep link: the Brief); handover.mention to the person named; email ONLY when
   the client's mail relay is configured (data.handover.emailRelay). The PDF is
   the report engine's Shift handover template with the standard footer; the
   acknowledgement is recorded in EKO only, never by the document.

   NO SHIFT PATTERN (wall.shifts.starts), NO FEATURE: every entry point hides.
   IDENTITY: the prototype has one demo user; a demo build can "Preview as user"
   to show the receipt. Sign-in is a deployment decision (handoff/brief.md §14).
   PRODUCTION keeps the store server-side; here it is localStorage, and a demo
   build re-seeds the stand-in handovers on every load.
   ============================================================================ */
window.EKO_HO = (function(){
  'use strict';
  const C = () => window.EKO_C, R = () => window.EKO_R, B = () => window.EKO_BRIEF;
  const esc = s => C().esc(s), icon = (n, s) => C().icon(n, s);
  let E = null;
  const LS = 'eko-handovers-v1';
  const demo = () => !!(window.EKO_BUILD && window.EKO_BUILD.demo);
  const cfg = () => (E && E.data.handover) || null;
  const ls = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
               set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} } };
  const freeze = o => { if(o && typeof o === 'object' && !Object.isFrozen(o)){ Object.freeze(o); Object.keys(o).forEach(k => freeze(o[k])); } return o; };
  /* DEMO ONLY: the shift clock can be moved to the next shift, to show the handover
     arriving there. Only this module reads it; a client build never sets it. */
  let offsetMs = 0;
  const now = () => Date.now() + offsetMs;
  const me = () => (E.data.user || {}).name || '';
  const pad = n => String(n).padStart(2, '0');
  const hhmm = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  /* ------------------------------ the shift pattern ------------------------- */
  function starts(){
    const s = (((E.data.wall || {}).shifts) || {}).starts || [];
    return s.map(x => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(x)); return m ? +m[1] * 60 + +m[2] : null; }).filter(x => x != null).sort((a, b) => a - b);
  }
  const enabled = () => !!(E && cfg() && starts().length);
  /* the shift that contains ms: { from, to } in ms */
  function shiftAt(ms){
    const mins = starts(), d0 = new Date(ms); d0.setHours(0, 0, 0, 0);
    const b = []; for(let k = -1; k <= 1; k++) mins.forEach(m => { const x = new Date(d0); x.setDate(x.getDate() + k); x.setHours(0, m, 0, 0); b.push(x.getTime()); });
    b.sort((x, y) => x - y);
    for(let i = 0; i < b.length - 1; i++) if(b[i] <= ms && ms < b[i + 1]) return { from: b[i], to: b[i + 1] };
    return null;
  }
  const nextOf = sh => shiftAt(sh.to + 1000), prevOf = sh => shiftAt(sh.from - 1000);
  const iso = ms => new Date(ms).toISOString(), ms = s => Date.parse(s);
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  function shiftLbl(sh){
    const f = typeof sh.from === 'string' ? ms(sh.from) : sh.from, t = typeof sh.to === 'string' ? ms(sh.to) : sh.to;
    const lbl = E.t('ho.shiftLbl', { from: hhmm(f), to: hhmm(t) });
    return sameDay(f, now()) ? lbl : E.t('ho.onDay', { day: new Date(f).toLocaleDateString(E.lang === 'ar' ? 'ar-AE' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), lbl });
  }
  const whenLbl = s => sameDay(ms(s), now()) ? hhmm(ms(s)) : E.t('ho.onDay', { day: new Date(ms(s)).toLocaleDateString(E.lang === 'ar' ? 'ar-AE' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), lbl: hhmm(ms(s)) });

  /* ---------------------------------- store --------------------------------- */
  let list = null, seq = 0;
  const key = () => LS + ':' + (E.data.nameEn || 'site');
  function seedRecords(){
    const cur = shiftAt(now());
    return ((cfg() || {}).seed || []).map(s => {
      let fr = cur; for(let k = 0; k < (s.shiftsAgo || 0); k++) fr = prevOf(fr);
      const from = prevOf(fr), at = fr.from - (s.minBeforeEnd || 10) * 60000;
      /* DEMO ONLY: a scenario can have the stand-ins already received (E.state.scnHoReceived) */
      /* E14c: the demo state: the stand-in is received a few minutes into its shift (seed.receivedBy, receivedAfterMin), once that time has come */
      const auto = s.receivedBy && now() >= fr.from + (s.receivedAfterMin || 7) * 60000 ? freeze({ by: s.receivedBy, at: iso(fr.from + (s.receivedAfterMin || 7) * 60000) }) : null;
      const rcv = demo() && E.state.scnHoReceived ? freeze({ by: E.state.scnHoReceived.by, at: iso(fr.from + (E.state.scnHoReceived.afterMin || 10) * 60000) }) : auto;
      return { body: freeze({ id: s.id, standIn: true, site: E.data.id || E.data.nameEn, by: s.by, at: iso(at),
        fromShift: { from: iso(from.from), to: iso(from.to) }, forShift: { from: iso(fr.from), to: iso(fr.to) },
        content: s.content, note: { en: s.noteEn || '', ar: s.noteAr || s.noteEn || '' }, mentions: [], delivery: { brief: true, notification: true, email: 'off' } }),
        addenda: [], receipt: rcv };
    });
  }
  function load(){
    if(list) return list;
    let a = null; try{ a = JSON.parse(ls.get(key()) || 'null'); }catch(e){ a = null; }
    const stored = Array.isArray(a);
    a = stored ? a : [];
    /* a demo build re-seeds the stand-ins every load (the demo never drifts); a client
       build seeds only an empty store, as the Brief's memory does */
    if(demo() || !stored) a = a.filter(r => !r.body.standIn).concat(seedRecords());
    a.forEach(r => { freeze(r.body); (r.addenda || []).forEach(freeze); if(r.receipt) freeze(r.receipt); });
    /* E14: the handovers on the EKO server for this site, beside this browser's own */
    const ids = new Set(a.map(r => r.body.id));
    list = a.concat(srvRecs.filter(r => r.body.site === siteKey() && !ids.has(r.body.id))); return list;
  }
  /* this browser keeps the stand-ins and what it saved while the server did not answer; the server keeps the rest */
  const save = () => ls.set(key(), JSON.stringify((list || []).filter(r => !r.body.server)));

  /* --------------------------- the server store (E14) ------------------------ */
  /* tools/serve.py answers /api/handover (handoff/handover-backend.md). It is used when it
     answers; otherwise this browser's localStorage is, and the footer says which. */
  const SRV = () => Object.assign({ api: '/api/handover', pollSec: 30 }, (cfg() || {}).server || {});
  let mode = 'unknown', srvRecs = [], sig = '', pollT = null, lastSync = 0;
  const siteKey = () => E.data.id || E.data.key || E.data.nameEn;   /* the site's key (med-dxb1), the display name only as a last resort */
  const meId = () => (E.data.user || {}).initials || me();
  const who = () => ({ id: meId(), name: me(), role: E.role() });
  function fromSrv(h){
    return { body: freeze({ id: h.id, server: true, site: h.site, by: { user: h.author.name, role: h.author.role, id: h.author.id }, at: h.at, storedAt: h.storedAt,
        fromShift: h.fromShift || h.shift, forShift: h.shift, content: h.sections, note: h.note || { text: '' }, mentions: h.mention || [], delivery: h.delivery || {} }),
      addenda: (h.addenda || []).map(x => freeze({ by: x.by.name, at: x.at, text: x.text, lang: x.lang })),
      receipt: h.receipt ? freeze({ by: h.receipt.by.name, at: h.receipt.at }) : null };
  }
  async function api(method, path, body){
    if(typeof fetch !== 'function' || location.protocol === 'file:' || /[?&]hostore=local\b/.test(location.search)) throw new Error('no server');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null, to = ctl ? setTimeout(() => ctl.abort(), 5000) : 0;
    try{
      const r = await fetch(SRV().api + path, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined });
      const j = await r.json().catch(() => null);
      if(!j) throw new Error('not the EKO server');
      return { status: r.status, body: j };
    } finally { if(to) clearTimeout(to); }
  }
  /* one record from the server replaces the browser's copy */
  function put(h){ const i = srvRecs.findIndex(r => r.body.id === h.id), r = fromSrv(h); if(i >= 0) srvRecs[i] = r; else srvRecs.push(r); list = null; return find(h.id); }
  /* the poll: every pollSec (configuration), so a second browser sees a new handover and a receipt */
  async function refresh(){
    if(!E || !enabled()) return;
    const was = mode;
    try{
      const r = await api('GET', '?site=' + encodeURIComponent(siteKey()) + '&user=' + encodeURIComponent(meId()));
      if(r.status !== 200 || !Array.isArray(r.body.handovers)) throw new Error('status ' + r.status);
      mode = 'server'; lastSync = Date.now();
      const s = JSON.stringify(r.body.handovers.map(h => [h.id, h.receipt && h.receipt.by.id, h.addenda.length]));
      if(s !== sig || was !== mode){ sig = s; srvRecs = r.body.handovers.map(fromSrv); list = null; rerender(); }
    }catch(e){ mode = 'local'; if(was !== mode) rerender(); }
  }
  /* a poll never redraws under someone typing their note */
  function rerender(){ if(!E || !E.set) return; if(E.state.dlg === 'handover' && st().mode === 'prepare') return; E.set({}); }
  const onServer = () => mode === 'server';
  const storeLabel = app => { if(app) E = app; return E.t(onServer() ? 'ho14.store.server' : 'ho14.store.local'); };
  const find = id => load().find(r => r.body.id === id) || null;
  /* the audit carries the handover clock's time too (they differ only when a demo moves the clock) */
  const audit = (action, id, params) => { try{ R().audit(E, action, id, Object.assign({ at: iso(now()) }, params || {})); }catch(e){} };

  /* the handovers the Brief shows at its top: every one whose shift has begun and
     that nobody has received (they stay until received), and the one addressed to
     the shift now running once it has been received ("Received by …") */
  function visible(){
    const t = now();
    return load().filter(r => ms(r.body.forShift.from) <= t && (!r.receipt || t < ms(r.body.forShift.to)))
      .sort((x, y) => ms(y.body.forShift.from) - ms(x.body.forShift.from) || ms(y.body.at) - ms(x.body.at));
  }
  const pending = app => { if(app) E = app; return enabled() && visible().some(r => !r.receipt && r.body.by.user !== me()); };
  /* the newest handover waiting for THIS reader (never the author's own), or null */
  const pendingId = app => { if(app) E = app; if(!enabled()) return null; const r = visible().find(x => !x.receipt && x.body.by.user !== me()); return r ? r.body.id : null; };
  const neverReceived = r => !r.receipt && now() >= ms(r.body.forShift.to);

  /* ------------------------------- composition ------------------------------ */
  /* the outgoing person's shift, from the Brief's own delta engine */
  const SEVR = { critical: 3, high: 2, medium: 1 };
  function compose(){
    const sw = B().shiftWindow(), d = B().deltas(E, sw);
    const log = (E.data.eventLog || []).filter(e => e.h <= sw.gapH);
    const K = { woCreated: 'created', woAssigned: 'assigned', woCompleted: 'completed', woOverdue: 'overdue' };
    const open = (E.data.alarms || []).filter(a => !a.ack).sort((a, b) => (SEVR[b.sev] || 0) - (SEVR[a.sev] || 0) || b.ageH - a.ageH)
      .map(a => ({ kind: 'alarm', id: a.id, asset: a.asset, sev: a.sev }))
      .concat(d.woLate.map(e => ({ kind: 'wo', wo: e.wo, asset: e.asset })));
    /* E14: each line carries its time and its source, for the ticked form (mock 7) */
    const t0 = Date.now(), at = h => h == null ? null : iso(t0 - h * 36e5);
    const src = a => srcOf(a && a.fam, a && a.asset);
    return { window: { from: iso(sw.atMs), to: iso(Date.now()) },
      raised: d.raised.map(a => ({ alarm: a.id, asset: a.asset, sev: a.sev, at: at(a.ageH), src: src(a) })),
      cleared: d.cleared.map(e => ({ asset: e.asset, at: at(e.h), src: src({ asset: e.asset }) })),
      acked: d.acked.map(a => ({ asset: a.asset, who: a.ack.who, at: at(a.ack.ageH), src: src(a) })),
      wos: log.filter(e => K[e.kind]).map(e => ({ wo: e.wo, asset: e.asset, kind: K[e.kind], at: at(e.h), src: 'cmms' })),
      open: open.map(x => Object.assign(x, { src: x.kind === 'wo' ? 'cmms' : src((E.data.alarms || []).find(a => a.id === x.id)) })) };
  }
  /* where a line comes from: the door and card reader alarms from access control, the rest from FIN */
  function srcOf(fam, asset){
    if(!fam && asset){ const a = (E.data.alarms || []).concat(E.data.alarmCatalog || []).find(x => x.asset === asset); fam = a && a.fam; }
    return fam === 'sec' ? 'access' : 'fin';
  }
  /* each section as text, in the reader's language (the record is language-free) */
  function sections(c){
    const t = (k, v) => E.t(k, v), sev = s => t('rpSev.' + s);
    return [
      ['ho.raised', c.raised.map(x => t('ho.itemSev', { asset: x.asset, sev: sev(x.sev) }))],
      ['ho.cleared', c.cleared.map(x => x.asset)],
      ['ho.acked', c.acked.map(x => t('ho.itemBy', { asset: x.asset, who: nameOf(x.who) }))],
      ['ho.wos', c.wos.map(x => t('ho.itemWo', { wo: x.wo, asset: x.asset, kind: t('ho.wo.' + x.kind) }))],
      ['ho.open', c.open.map(x => x.kind === 'wo' ? t('ho.itemWo', { wo: x.wo, asset: x.asset, kind: t('ho.wo.overdue') }) : t('ho.itemSev', { asset: x.asset, sev: sev(x.sev) }))]
    ];
  }
  /* E14: the same sections as one ticked line each (mock 7): its key, time, text and source */
  const SECK = [['raised', 'raised'], ['cleared', 'cleared'], ['acked', 'acked'], ['wos', 'wos'], ['open', 'open']];
  function lines(c){
    const t = (k, v) => E.t(k, v), sev = s => t('rpSev.' + s);
    const al = id => (E.data.alarms || []).find(a => a.id === id) || (E.data.alarmCatalog || []).find(a => a.id === id);
    const plainOf = (id, asset) => { const a = (id && al(id)) || (E.data.alarmCatalog || []).find(x => x.asset === asset); return a ? (E.lang === 'ar' ? (a.plainAr || a.plainEn) : a.plainEn) : ''; };
    const alTx = (x, id) => t('ho14.lineAl', { asset: x.asset, what: plainOf(id, x.asset) || sev(x.sev) });
    const tx = {
      raised: x => alTx(x, x.alarm),
      cleared: x => plainOf(null, x.asset) ? alTx(x, null) : x.asset,
      acked: x => t('ho.itemBy', { asset: alTx(x, null), who: nameOf(x.who) }),
      wos: x => t('ho.itemWo', { wo: x.wo, asset: x.asset, kind: t('ho.wo.' + x.kind) }),
      open: x => x.kind === 'wo' ? t('ho.itemWo', { wo: x.wo, asset: x.asset, kind: t('ho.wo.overdue') }) : alTx(x, x.id)
    };
    return SECK.map(([k]) => [k, (c[k] || []).map((x, i) => ({ key: k + ':' + i, at: x.at || null, src: x.src || (k === 'wos' || x.kind === 'wo' ? 'cmms' : 'fin'), text: tx[k](x) }))]);
  }
  /* the shift's name from its start: morning, afternoon or night */
  function shiftName(sh){
    const f = sh == null ? now() : typeof sh === 'object' ? (typeof sh.from === 'string' ? ms(sh.from) : sh.from) : typeof sh === 'string' ? ms(sh) : sh;
    const h = new Date(f).getHours();
    return h >= 4 && h < 12 ? 'morning' : h >= 12 && h < 20 ? 'afternoon' : 'night';
  }
  /* the sections without the unticked lines */
  function picked(c, off){
    const o = {}; SECK.forEach(([k]) => { o[k] = (c[k] || []).filter((x, i) => !(off || {})[k + ':' + i]); }); return o;
  }
  const summary = c => E.t('ho.sum', { r: c.raised.length, c: c.cleared.length, a: c.acked.length, w: c.wos.length, o: c.open.length });
  const noteOf = b => b.note ? (b.note.text != null ? b.note.text : (E.lang === 'ar' ? b.note.ar : b.note.en)) : '';
  const nameOf = (u, head) => E.person ? E.person(u, head) : u;   /* D146: the one person-name rule (app.js person()); head: shown on its own (D171) */
  const receiptText = r => E.t('ho.received', { who: nameOf(r.receipt.by), t: whenLbl(r.receipt.at) });

  /* ------------------------------ the Brief's part --------------------------- */
  function forBrief(app){
    E = app;
    if(!enabled()) return null;
    const v = visible(); if(!v.length) return null;
    const top = v[0], b = top.body;
    return { id: b.id, by: b.by, at: b.at, fromShift: b.fromShift, forShift: b.forShift, standIn: !!b.standIn,
      counts: { raised: b.content.raised.length, cleared: b.content.cleared.length, acknowledged: b.content.acked.length, woMoved: b.content.wos.length, open: b.content.open.length },
      receipt: top.receipt ? { by: top.receipt.by, at: top.receipt.at } : null, addenda: top.addenda.length,
      earlierUnreceived: v.slice(1).filter(r => !r.receipt).map(r => r.body.id) };
  }
  function block(app, h){
    E = app;
    if(!h) return '';
    const t = (k, v) => app.t(k, v), r = find(h.id); if(!r) return '';
    const mine = h.by.user === me();
    const state = h.receipt ? 'received' : mine ? 'mine' : 'waiting';
    const note = noteOf(r.body);
    const act = h.receipt ? `<span class="cuhorcv">${icon('check', 13)}${esc(receiptText(r))}</span>`
      : mine ? `<span class="cuhorcv">${esc(t('ho.waiting', { t: hhmm(ms(h.forShift.from)) }))}</span>`
      : `<button class="btnP btnSm cuhoack" data-act="hoReceive" data-v="${esc(h.id)}">${esc(t('ho.receive'))}</button>`;
    const earlier = h.earlierUnreceived.length ? `<button class="cumore cuhoearlier" data-act="${app.can('canReviewHandovers') ? 'hoReview' : 'hoView'}" data-v="${esc(h.earlierUnreceived[0])}">${esc(t('ho.earlier', { n: h.earlierUnreceived.length }))}</button>` : '';
    return `<section class="cuho" data-state="${state}" aria-label="${esc(t('ho.title'))}">
      <div class="cuhohead"><span class="cuneu">${icon('doc', 13)}</span><b>${esc(t('ho.from', { who: nameOf(h.by.user) }))}</b>
        <span class="cuhowhen">${esc(t('ho.written', { t: whenLbl(h.at), shift: shiftLbl(h.forShift) }))}</span></div>
      ${note ? `<p class="cuhonote" data-tip="${esc(note)}">${esc(note)}</p>` : ''}
      <p class="cuhosum">${esc(summary(r.body.content))}${h.addenda ? esc(t('cu.lblSep') + t('ho.addendaN', { n: h.addenda })) : ''}</p>
      <div class="cuhoacts">${act}<button class="btnG btnSm" data-act="hoView" data-v="${esc(h.id)}">${esc(t('ho.openBtn'))}</button>${earlier}</div>
    </section>`;
  }
  /* E14c: the handover in the Brief is ONE line: which shift's handover, its state and what is still open, with Read
     (the full document, which shows the same state) and, before a receipt, an outlined Receive. No note, no chips. */
  function line14(app, h){
    E = app;
    if(!h) return '';
    const t = (k, v) => app.t(k, v), r = find(h.id); if(!r) return '';
    const b = r.body, mine = h.by.user === me(), open = (b.content.open || []).length;
    const name = t('ho14c.name.' + shiftName(b.fromShift));
    const state = r.receipt ? t('ho14c.rcv', { t: whenLbl(r.receipt.at), who: r.receipt.by === me() ? t('ho14c.you') : nameOf(r.receipt.by) })
      : mine ? t('ho14c.sent', { t: whenLbl(b.at), s: hhmm(ms(b.forShift.from)) }) : t('ho14c.waiting');
    /* E14d: one dashed row: the dot (green once received), the shift's handover in bold, its state, what is still open; Receive (outlined) before a receipt, Read */
    const rest = [state, t('ho14d.open', { n: open })].join(t('cu.lblSep'));
    const recv = !r.receipt && !mine && ms(b.forShift.from) <= now() ? `<button class="br14btn" data-act="hoReceive" data-v="${esc(h.id)}">${esc(t('ho14.receive'))}</button>` : '';
    return `<div class="br14ho br14hol" data-state="${r.receipt ? 'received' : mine ? 'mine' : 'waiting'}"><span class="br14okd" aria-hidden="true"></span><div class="br14t"><b>${esc(name)}</b>${esc(t('cu.lblSep') + rest)}</div>
      <span class="br14hob">${recv}<button class="br14btn" data-act="hoView" data-v="${esc(h.id)}">${esc(t('ho14c.read'))}</button></span></div>`;
  }
  /* E14: the handover store's events for the Brief's timeline: each handover written, and its receipt */
  function events(app, from, to){
    E = app;
    if(!enabled()) return [];
    const t = (k, v) => app.t(k, v), out = [];
    load().forEach(r => {
      const at = ms(r.body.at); if(at >= from && at <= to) out.push({ ms: at, text: t('br14.tl.hoWritten', { who: nameOf(r.body.by.user) }), kind: 'ho', src: 'ho' });
    });
    return out;
  }
  /* D152: the Brief's shift log carries the handover as ONE line: who, when, and its
     two controls; the whole note and the sections stay one click away in Open. */
  function line(app, h){
    E = app;
    if(!h) return '';
    const t = (k, v) => app.t(k, v), r = find(h.id); if(!r) return '';
    const mine = h.by.user === me();
    const act = h.receipt ? `<span class="cuhorcv">${icon('check', 12)}${esc(receiptText(r))}</span>`
      : mine ? `<span class="cuhorcv">${esc(t('ho.waiting', { t: hhmm(ms(h.forShift.from)) }))}</span>`
      : `<button class="btnP btnSm" data-act="hoReceive" data-v="${esc(h.id)}" data-tip="${esc(t('ho.receive'))}">${esc(t('cu.hoRcvShort'))}</button>`;
    return `<div class="bho" data-state="${h.receipt ? 'received' : mine ? 'mine' : 'waiting'}">
      <span class="cuneu">${icon('doc', 13)}</span><span class="bholb">${esc(t('cu.hoLbl'))}</span>
      <span class="bhotx" data-tip="${esc(t('ho.from', { who: nameOf(h.by.user) }) + t('cu.lblSep') + whenLbl(h.at) + '\n' + noteOf(r.body))}"><b>${esc(nameOf(h.by.user, true))}</b><i>${esc(t('cu.lblSep') + whenLbl(h.at))}</i></span>
      ${act}<button class="btnG btnSm" data-act="hoView" data-v="${esc(h.id)}">${esc(t('ho.openBtn'))}</button></div>`;
  }
  /* the Brief's foot: "Prepare handover", near the end of the shift (always in a demo) */
  function canPrepare(){
    if(!enabled() || !E.data.user) return false;
    if(demo()) return true;
    const sh = shiftAt(now());
    return sh && (sh.to - now()) <= ((cfg().prepareBeforeMin || 90) * 60000);
  }
  function prepareButton(app){
    E = app;
    if(!canPrepare()) return '';
    const sh = shiftAt(now()), nx = nextOf(sh);
    return `<button class="btnG btnSm cuhoprep" data-act="hoPrepare" data-tip="${esc(app.t('ho.prepTip', { end: hhmm(sh.to), shift: shiftLbl({ from: nx.from, to: nx.to }) }))}">${icon('doc', 13)}${esc(app.t('ho.prepare'))}</button>`;
  }

  /* --------------------------------- dialog --------------------------------- */
  const st = () => E.state.ho || (E.state.ho = { mode: 'prepare', id: null, note: '', mention: '', add: '', draft: null });
  const secHtml = c => `<dl class="hosecs">${sections(c).map(([k, xs]) => `<div class="hosec"><dt>${esc(E.t(k))}</dt><dd>${xs.length ? esc(xs.join(E.t('cu.join'))) : `<span class="hoempty">${esc(E.t('ho.none'))}</span>`}</dd></div>`).join('')}</dl>`;
  function people(){
    const onCall = (cfg() || {}).onCall;
    const names = [...new Set((onCall ? [onCall] : []).concat((E.data.demoUsers || []).map(u => u.name)))].filter(n => n && n !== me());
    return names.map(n => ({ v: n, lbl: n === onCall ? E.t('ho.onCall', { who: nameOf(n) }) : nameOf(n, true) }));
  }
  function dialog(app){
    E = app;
    const t = (k, v) => app.t(k, v), s = st();
    const head = title => `<div class="draghandle"></div><div class="dlghead"><h2>${esc(title)}</h2><button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(t('close'))}">${icon('x', 14)}</button></div>`;
    let body = '';
    /* E14 (mock 7): a wide form, the shift's lines ticked on the left, the note, the mention
       and where it goes on the right; Send shows what happened, step by step */
    const head14 = sub => `<div class="draghandle"></div><div class="dlghead ho14head"><h2>${esc(t('ho.prepare'))}</h2><span class="ho14sub">${esc(sub)}</span><span class="grow"></span>
      <button class="btnL btnSm" data-act="hoBack">${esc(t('ho14.back'))}</button><button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(t('close'))}">${icon('x', 14)}</button></div>`;
    if(s.mode === 'prepare'){
      const sh = shiftAt(now()), nx = nextOf(sh), off = s.off || (s.off = {});
      if(!s.draft) s.draft = compose();
      const site = app.lang === 'ar' ? app.data.nameAr : app.data.nameEn;
      const groups = lines(s.draft).map(([k, xs]) => `<div class="ho14grp" role="group" aria-label="${esc(t('ho.' + k))}">
          <div class="ho14gt">${esc(t('ho.' + k))}${esc(t('cu.lblSep'))}${xs.filter(x => !off[x.key]).length}</div>
          ${xs.length ? xs.map(x => `<label class="ho14row"><input type="checkbox" data-chg="hoTick" data-v="${esc(x.key)}"${off[x.key] ? '' : ' checked'}>
            <span class="ho14t tMonoS">${esc(x.at ? hhmm(ms(x.at)) : '')}</span><span class="ho14tx">${esc(x.text)}</span><span class="ho14src">${esc(t('ho14.src.' + x.src))}</span></label>`).join('')
            : `<div class="ho14none">${esc(t('ho14.none.' + k))}</div>`}</div>`).join('');
      body = `${head14(t('ho14.sub', { name: t('ho14.shift.' + shiftName(sh)), range: shiftLbl({ from: sh.from, to: sh.to }), who: nameOf(me()) }))}
        <div class="ho14body">
          <div class="ho14left">
            <p class="ho14intro">${esc(t('ho14.intro'))}</p>
            ${groups}
          </div>
          <div class="ho14right">
            <label class="ho14lbl" for="ho14note">${esc(t('ho14.yourNote'))}</label>
            <textarea id="ho14note" class="dgfin honote ho14in" rows="5" placeholder="${esc(t('ho.notePh'))}">${esc(s.note)}</textarea>
            <label class="ho14lbl" for="ho14men">${esc(t('ho.mention'))}</label>
            <select id="ho14men" class="ho14in" data-chg="hoMention"><option value="">${esc(t('ho14.nobody'))}</option>${people().map(p => `<option value="${esc(p.v)}"${p.v === s.mention ? ' selected' : ''}>${esc(p.lbl)}</option>`).join('')}</select>
            <div class="ho14info">
              <div><b>${esc(t('ho14.goesL'))}</b> ${esc(t('ho14.goes', { t: hhmm(nx.from), site }))}</div>
              <div><b>${esc(t('ho14.emailL'))}</b> ${esc(t((cfg() || {}).emailRelay ? 'ho14.emailOn' : 'ho14.emailOff'))}</div>
              <div><b>${esc(t('ho14.afterL'))}</b> ${esc(t('ho14.after'))}</div>
              <div><b>${esc(t('ho14.storeL'))}</b> ${esc(storeLabel())}</div>
            </div>
            <button class="btnP ho14send" data-act="hoSubmit"${s.busy ? ' disabled aria-busy="true"' : ''}>${esc(t('ho14.send'))}</button>
          </div>
        </div>`;
    } else if(s.mode === 'sent' && s.sent){
      const x = s.sent, r = find(x.id);
      const sh = shiftAt(ms(x.fromShift.from) + 1000);
      body = `${head14(t('ho14.sub', { name: t('ho14.shift.' + shiftName(sh)), range: shiftLbl({ from: ms(x.fromShift.from), to: ms(x.fromShift.to) }), who: nameOf(me()) }))}
        <div class="ho14sent">
          <div class="ho14ok">${icon('check', 22)}<span>${esc(t('ho14.sentAt', { t: hhmm(ms(x.at)) }))}</span></div>
          <p class="ho14wait">${esc(r && r.receipt ? receiptText(r) : t('ho14.waitLong', { t: hhmm(ms(x.forShift.from)) }))}</p>
          <div class="row gap8 ho14acts">
            <button class="btnG btnSm" data-act="hoView" data-v="${esc(x.id)}">${esc(t('ho14.addNote'))}</button>
            <button class="btnG btnSm" data-act="hoPdf" data-v="${esc(x.id)}">${esc(t('ho14.pdf'))}</button>
            ${demo() ? `<button class="btnG btnSm" data-act="hoAsNext" data-v="${esc(x.id)}">${esc(t('ho14.asNext.' + shiftName(x.forShift.from)))}</button>` : ''}
            <button class="btnL btnSm" data-act="hoPrepare">${esc(t('ho14.again'))}</button>
          </div>
          <div class="ho14what">
            <div class="ho14whatT">${esc(t(x.server ? 'ho14.whatS' : 'ho14.whatL'))}</div>
            <ol>${x.steps.map(k => `<li>${esc(t(k[0], k[1]))}</li>`).join('')}</ol>
            <div class="ho14store">${esc(t(x.server ? 'ho14.store.server' : 'ho14.store.local'))}</div>
          </div>
        </div>`;
    } else if(s.mode === 'view'){
      const r = find(s.id); if(!r){ return ''; }
      const b = r.body, mine = b.by.user === me(), hist = (R() && R().auditFor ? R().auditFor(b.id) : []).slice().reverse();
      const rc = r.receipt ? `<p class="horcv">${icon('check', 13)}${esc(receiptText(r))}</p>`
        : neverReceived(r) ? `<p class="horcv honever">${esc(t('ho.never', { t: whenLbl(b.forShift.to) }))}</p>`
        : mine ? `<p class="horcv">${esc(t('ho.waiting', { t: hhmm(ms(b.forShift.from)) }))}</p>`
        : ms(b.forShift.from) <= now() ? `<p class="horcv honever">${esc(t('ho14.notRcv', { t: shiftLbl(b.forShift) }))}</p><div class="row gap8"><button class="btnG btnSm" data-act="hoReceive" data-v="${esc(b.id)}">${esc(t('ho14.receive'))}</button></div>` : `<p class="horcv">${esc(t('ho.notYet', { t: shiftLbl(b.forShift) }))}</p>`;
      body = `${head(t('ho.from', { who: nameOf(b.by.user) }))}
        <p class="tCap hointro">${esc(t('ho.written', { t: whenLbl(b.at), shift: shiftLbl(b.forShift) }))}${b.standIn ? esc(t('cu.lblSep') + t('ho.standIn')) : ''}</p>
        ${rc}
        ${noteOf(b) ? `<blockquote class="honoteq">${esc(noteOf(b))}</blockquote>` : ''}
        ${b.mentions && b.mentions.length ? `<p class="tCap">${esc(t('ho.mentioned', { who: b.mentions.map(nameOf).join(t('cu.join')) }))}</p>` : ''}
        ${secHtml(b.content)}
        ${r.addenda.length ? `<div class="tLbl hosub">${esc(t('ho.addenda'))}</div><ul class="hoadds">${r.addenda.map(a => `<li><span class="tMonoS">${esc(whenLbl(a.at))}</span> <b>${esc(nameOf(a.by, true))}</b> ${esc(a.text)}</li>`).join('')}</ul>` : ''}
        ${mine ? `<label class="rpfld"><span class="tCap">${esc(t('ho.addendum'))}</span><textarea class="dgfin hoadd" rows="2" aria-label="${esc(t('ho.addendum'))}" placeholder="${esc(t('ho.addPh'))}">${esc(s.add)}</textarea></label>
          <div class="row gap8 jcE"><button class="btnG btnSm" data-act="hoAddendum" data-v="${esc(b.id)}">${esc(t('ho.addBtn'))}</button></div>` : ''}
        ${hist.length ? `<details class="hohist"><summary class="tCap">${esc(t('ho.history', { n: hist.length }))}</summary><ul>${hist.map(e => `<li><span class="tMonoS">${esc(whenLbl((e.params && e.params.at) || e.t))}</span> ${esc(nameOf(e.user))} · ${esc(t('ho.aud.' + e.action.replace('handover.', '')))}</li>`).join('')}</ul></details>` : ''}
        <p class="tCap honotice">${esc(t('ho.pdfNote'))}</p>
        <div class="row gap8 jcE hofoot"><button class="btnG btnSm" data-act="hoPdf" data-v="${esc(b.id)}">${icon('download', 13)}${esc(t('ho.pdf'))}</button>${app.can('canReviewHandovers') ? `<button class="btnG btnSm" data-act="hoReview">${esc(t('ho.reviewAll'))}</button>` : ''}</div>`;
    } else {
      /* the manager's view: every handover, the never-received ones first */
      const all = load().slice().sort((x, y) => (neverReceived(y) - neverReceived(x)) || ms(y.body.forShift.from) - ms(x.body.forShift.from));
      const never = all.filter(neverReceived).length;
      const state = r => r.receipt ? receiptText(r) : neverReceived(r) ? t('ho.never', { t: whenLbl(r.body.forShift.to) }) : ms(r.body.forShift.from) > now() ? t('ho.notYet', { t: shiftLbl(r.body.forShift) }) : t('ho.notReceived');
      body = `${head(t('ho.review'))}
        <p class="tCap hointro">${esc(t('ho.reviewIntro', { n: never }))}</p>
        <div class="audwrap"><table class="audt horev"><thead><tr><th>${esc(t('ho.colFrom'))}</th><th>${esc(t('ho.colFor'))}</th><th>${esc(t('ho.colState'))}</th></tr></thead><tbody>
        ${all.map(r => `<tr data-never="${neverReceived(r)}"><td><button class="holink" data-act="hoView" data-v="${esc(r.body.id)}">${esc(nameOf(r.body.by.user, true))}</button> <span class="tMonoS">${esc(whenLbl(r.body.at))}</span></td><td>${esc(shiftLbl(r.body.forShift))}</td><td class="hostate">${esc(state(r))}</td></tr>`).join('')}
        </tbody></table></div>`;
    }
    return `<div class="scrim" data-born="${E.state.born === 'dlg' ? 1 : 0}" data-act="closeDlg"></div>
      <div class="dlg dlgho${s.mode === 'prepare' || s.mode === 'sent' ? ' dlgho14' : ''}" data-mode="${esc(s.mode)}" data-born="${E.state.born === 'dlg' ? 1 : 0}" role="dialog" aria-label="${esc(t('ho.title'))}">${body}</div>`;
  }

  /* -------------------------------- actions --------------------------------- */
  function newId(){ const d = new Date(now()); seq++; return 'HO-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '-' + String(seq).padStart(2, '0'); }
  const toast = (text, tone) => { if(window.EKO_FB) window.EKO_FB.toast({ text, tone: tone || 'info' }); };
  function openDlg(mode, id){ const s = st(); s.mode = mode; s.id = id || null; if(mode === 'prepare'){ s.draft = null; } s.add = ''; E.set({ dlg: 'handover', born: 'dlg' }); }
  const ACTS = {
    hoPrepare(){ if(!canPrepare()) return; const s = st(); s.off = {}; s.sent = null; s.busy = false; openDlg('prepare'); },
    hoView(el){ openDlg('view', el.dataset.v); },
    hoReview(){ if(E.can('canReviewHandovers')) openDlg('review'); },
    hoMention(el){ st().mention = el.value; },
    /* E14: untick a line so it does not go in */
    hoTick(el){ const s = st(), off = s.off || (s.off = {}); off[el.dataset.v] = !el.checked; E.set({}); },
    /* E14: back to the Brief, the form kept as it is */
    hoBack(){ E.state.dlg = null; if(B()) B().open('shift'); else E.set({}); },
    /* E14, DEMO ONLY: see the handover as the next shift: the clock moves to its start and
       the view is previewed as another demo user (Preview as user) */
    hoAsNext(){
      if(!demo()) return;
      const p = (E.data.demoUsers || []).find(u => u.name !== me() && u.role === 'engineer') || (E.data.demoUsers || []).find(u => u.name !== me());
      offsetMs = nextOf(shiftAt(Date.now())).from + 5 * 60000 - Date.now(); E.state.hoClock = 'next';
      E.state.ho = null; E.state.dlg = null;
      if(p && E.runAct) E.runAct('previewUser', { v: p.name });
      if(B()){ B().reset(); B().open('shift'); } else E.set({});
    },
    async hoSubmit(){
      if(!canPrepare()) return;
      const s = st(); if(s.busy) return;
      const sh = shiftAt(now()), nx = nextOf(sh), relay = (cfg() || {}).emailRelay || null;
      const content = picked(s.draft || compose(), s.off), note = { text: (s.note || '').trim(), lang: E.lang }, mentions = s.mention ? [s.mention] : [];
      const delivery = { brief: true, notification: true, email: relay ? 'relay' : 'off' };
      const fromShift = { from: iso(sh.from), to: iso(sh.to) }, forShift = { from: iso(nx.from), to: iso(nx.to) }, at = iso(now());
      s.busy = true; E.set({});
      /* E14: the EKO server first; this browser only when it does not answer */
      let rec = null;
      try{
        const r = await api('POST', '', { site: siteKey(), shift: forShift, fromShift, author: who(), at, sections: content, note, mention: mentions, delivery });
        if(r.status === 201 && r.body.handover){ mode = 'server'; rec = put(r.body.handover); }
      }catch(e){ mode = 'local'; }
      if(!rec){
        mode = 'local';
        const body = freeze({ id: newId(), site: siteKey(), by: { user: me(), role: E.role(), id: meId() }, at, fromShift, forShift, content, note, mentions, delivery });
        rec = { body, addenda: [], receipt: null }; load().push(rec); save();
      }
      const body = rec.body, server = !!body.server;
      audit('handover.submit', body.id, { forShift: body.forShift, open: body.content.open.length, mentions: body.mentions, email: body.delivery.email, store: server ? 'server' : 'browser' });
      const site = E.data.id || E.data.key || 'marsa';   /* D169 */
      R().deliver(E, { type: 'shift.handover', actorId: me(), siteId: site, targetUsers: ['@site:' + site],
        params: { user: me(), n: body.content.open.length, at: iso(now()) }, source: { kind: 'handover', id: body.id } }, 'handover.notify', body.id);
      body.mentions.forEach(w => R().deliver(E, { type: 'handover.mention', actorId: me(), siteId: site, targetUsers: [w],
        params: { user: me(), t: hhmm(nx.from), at: iso(now()) }, source: { kind: 'handover', id: body.id } }, 'handover.mention', body.id));
      if(relay) audit('handover.email', body.id, { relay, to: ['site:' + site].concat(body.mentions) });
      /* what happened, step by step (mock 7), from what actually happened */
      const T = { t: hhmm(nx.from) };
      const steps = [server ? ['ho14.step1s'] : ['ho14.step1l'], [server ? 'ho14.step2s' : 'ho14.step2l', T],
        [body.mentions.length ? 'ho14.step3m' : 'ho14.step3', { who: body.mentions.map(nameOf).join(E.t('cu.join')) }]]
        .concat(relay ? [['ho14.stepMail']] : []).concat([['ho14.step4']]);
      s.busy = false; s.mode = 'sent'; s.note = ''; s.mention = ''; s.draft = null;
      s.sent = { id: body.id, at: body.at, fromShift: body.fromShift, forShift: body.forShift, server, steps };
      E.set({});
    },
    /* the FIRST press records the receipt; a later press finds it taken and changes nothing.
       E14: on the server the first receipt wins in a transaction; a later press gets the first back */
    async hoReceive(el){
      const r = find(el.dataset.v); if(!r || r.body.by.user === me()) return;
      if(r.receipt){ toast(receiptText(r)); E.set({}); return; }
      if(r.body.server){
        try{
          const x = await api('POST', '/' + encodeURIComponent(r.body.id) + '/receipt', { by: who(), at: iso(now()) });
          if(!x.body.handover) throw new Error(x.body.error || 'refused');
          const n = put(x.body.handover);
          audit('handover.receive', r.body.id, { by: me(), store: 'server', first: !!x.body.first });
          if(x.body.first) toast(E.t('ho.receivedToast'), 'success'); else toast(receiptText(n));
        }catch(e){ toast(E.t('ho14.srvDown'), 'warn'); }
        E.set({}); return;
      }
      r.receipt = freeze({ by: me(), at: iso(now()) }); save();
      audit('handover.receive', r.body.id, { by: me() });
      toast(E.t('ho.receivedToast'), 'success'); E.set({});
    },
    async hoAddendum(el){
      const r = find(el.dataset.v), s = st(), text = (s.add || '').trim();
      if(!r || r.body.by.user !== me() || !text) return;
      if(r.body.server){
        try{
          const x = await api('POST', '/' + encodeURIComponent(r.body.id) + '/addendum', { by: who(), text, lang: E.lang, at: iso(now()) });
          if(x.status !== 201) throw new Error(x.body.error || 'refused');
          const n = put(x.body.handover);
          audit('handover.addendum', r.body.id, { n: n.addenda.length, store: 'server' });
          s.add = '';
        }catch(e){ toast(E.t('ho14.srvDown'), 'warn'); }
        E.set({}); return;
      }
      r.addenda.push(freeze({ by: me(), at: iso(now()), text, lang: E.lang })); save();
      audit('handover.addendum', r.body.id, { n: r.addenda.length });
      s.add = ''; E.set({});
    },
    async hoPdf(el){
      const r = find(el.dataset.v); if(!r || !R()) return;
      const h = Math.max(1, Math.round((ms(r.body.fromShift.to) - ms(r.body.fromShift.from)) / 36e5));
      const doc = await R().generate(E, { templateId: 'shift-handover', period: { kind: 'last', h }, params: { handoverId: r.body.id } });
      audit('handover.export', r.body.id, { report: doc.id, format: 'pdf' });
      if(window.EKO_RX) window.EKO_RX.pdf(E, doc);
      E.set({});
    },
    /* DEMO ONLY: the shift clock — now, or the start of the next shift */
    hoClock(el){ if(!demo()) return; offsetMs = el.dataset.v === 'next' ? (nextOf(shiftAt(Date.now())).from + 5 * 60000 - Date.now()) : 0;
      E.state.hoClock = el.dataset.v === 'next' ? 'next' : 'now'; E.state.dlg = null; if(B()){ B().reset(); } E.set({}); }
  };

  /* the report engine's notes section, for a handover's PDF: the note, the addenda,
     and that the receipt lives in EKO only */
  function notesFor(app, id){
    E = app;
    const r = find(id); if(!r) return null;
    const b = r.body, t = (k, v) => app.t(k, v);
    return [t('ho.from', { who: nameOf(b.by.user) }) + t('cu.lblSep') + t('ho.written', { t: whenLbl(b.at), shift: shiftLbl(b.forShift) }), noteOf(b)]
      .concat(sections(b.content).map(([k, xs]) => t(k) + ': ' + (xs.length ? xs.join(t('cu.join')) : t('ho.none'))))
      .concat(r.addenda.map(a => t('ho.addendumLine', { t: whenLbl(a.at), who: nameOf(a.by), text: a.text })))
      .concat([t('ho.pdfNote')]).filter(Boolean);
  }
  /* a notification's deep link: the Brief, where the handover sits on top; a handover
     not yet addressed to the running shift opens by itself */
  function openFrom(id){
    const r = id && find(id);
    if(r && visible().includes(r) && B()){ B().open('shift'); return; }
    if(r){ openDlg('view', id); return; }
    if(B()) B().open('shift');
  }

  function init(app){
    E = app; list = null;
    document.addEventListener('input', ev => {
      if(!ev.target.matches) return;
      if(ev.target.matches('.honote')) st().note = ev.target.value;
      if(ev.target.matches('.hoadd')) st().add = ev.target.value;
    });
    /* E14: the server store answers or not; then the poll (configuration: handover.server.pollSec, 30 s) */
    setTimeout(refresh, 0);
    if(pollT) clearInterval(pollT);
    pollT = setInterval(() => { if(!document.hidden) refresh(); }, Math.max(5, +SRV().pollSec || 30) * 1000);
  }
  return { init, enabled, pending, pendingId, forBrief, block, line, prepareButton, dialog, ACTS, notesFor, openFrom, canPrepare,
           shiftAt: m => shiftAt(m == null ? now() : m), store: () => load(), find, get offsetMs(){ return offsetMs; }, reload(){ list = null; },
           storeLabel, onServer, refresh, events, line14, get mode(){ return mode; }, get lastSync(){ return lastSync; } };
})();
