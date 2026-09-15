/* ============================================================================
   ASK EKO (D132) — the one AI surface: a docked conversation panel, opened
   from the Ask EKO bar and from every sparkle in the product.
   THE LAW (shared with reports, narrate.js): the platform computes every
   figure and passes them as structured context; the model narrates. A
   number the platform did not supply rejects the turn; one regeneration,
   then the computed figures with a note, and the rejection is logged.
   One panel, many doors: a sparkle sets the CONTEXT CHIP (the widget's
   metric, timeframe, filters) and its suggestions; removing the chip widens
   the scope back to the site. The thread survives navigation and closing.
   Persistence (prototype): localStorage `eko-ai-conv-v1` (conversations)
   and `eko-ai-feedback-v1` (thumbs + notes); production sends both to a
   store (handoff/ask-eko.md).
   ============================================================================ */
window.EKO_AI = (function(){
  'use strict';
  let E = null;
  const LS = 'eko-ai-conv-v1', LSF = 'eko-ai-feedback-v1', MAX_CONV = 10;
  const C = () => window.EKO_C, R = () => window.EKO_R, RN = () => window.EKO_RN, LLM = () => window.EKO_LLM, RX = () => window.EKO_RX;
  const esc = s => C().esc(s);
  const icon = (n, s) => C().icon(n, s);
  const t = (k, v) => E.t(k, v);
  const hhmm = d => { d = d instanceof Date ? d : new Date(d); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const dateLbl = iso => { try{ return new Date(iso).toLocaleDateString(E.lang === 'ar' ? 'ar-AE' : 'en-GB', { day:'numeric', month:'short' }); }catch(e){ return ''; } };
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* --------------------------------- state --------------------------------- */
  const S = { open:false, ctx:null, ctxFresh:false, hist:false, menu:false, streaming:null, fbOpen:null, lastCopy:null, lastExport:null, log:[], unread:false, route:null };
  let store = null;
  function load(){ if(store) return store; try{ store = JSON.parse(localStorage.getItem(LS) || 'null'); }catch(e){ store = null; } if(!store || !Array.isArray(store.convs)) store = { convs:[], cur:null }; return store; }
  function save(){ try{ localStorage.setItem(LS, JSON.stringify(store)); }catch(e){} }
  function convs(){ return load().convs; }
  function cur(){ const s = load(); return s.convs.find(c => c.id === s.cur) || null; }
  function ensureConv(){ let c = cur(); if(!c){ c = { id: uid(), title:'', at: new Date().toISOString(), updated: new Date().toISOString(), turns:[] }; load().convs.unshift(c); load().cur = c.id; trim(); save(); } return c; }
  function trim(){ const s = load(); if(s.convs.length > MAX_CONV) s.convs.length = MAX_CONV; }
  function feedbackStore(){ try{ return JSON.parse(localStorage.getItem(LSF) || '[]') || []; }catch(e){ return []; } }

  /* ------------------------------- the engine ------------------------------ */
  /* topics: what a question is about → which computed metrics answer it */
  const TOPICS = [
    { id:'alarms',  re:/alarm|fault|equipment|in alarm|what is wrong|تنبيه|عطل|أعطال|معدات/i, metrics:['alarms.open','alarms.critical','alarms.high','alarms.medium','alarms.acked','alarms.oldestH'], evidence:'alarms', actions:'alarm' },
    { id:'stale',   re:/not reporting|stale|units|reporting|لا تُبلّغ|قديم|وحدات/i, metrics:['assets.stale','assets.inAlarm','alarms.open'], evidence:'alarms', actions:'stale' },
    { id:'waste',   re:/wast|avoidable|saving|هدر|توفير|تبذير/i, metrics:['derived.wasteAedMtd','derived.avoidableAedMo','energy.mtdKwh','derived.energyCostMtdAed'], evidence:'load' },
    { id:'water',   re:/water|autonomy|مياه|ماء|استقلالية/i, metrics:['metrics.waterTodayM3','derived.waterAutonomyDays','water.meterUptimePct'] },
    { id:'gas',     re:/\bgas\b|غاز/i, metrics:['metrics.gasTodayM3','derived.gasCostMtdAed'] },
    { id:'peak',    re:/peak|demand|contract|power factor|ذروة|طلب|معامل القدرة/i, metrics:['metrics.peakTodayMw','power.contractedKw','metrics.loadNowMw','metrics.pfNow'], evidence:'load' },
    { id:'compare', re:/compare|last week|previous|last month|versus|مقارنة|الأسبوع الماضي|الشهر الماضي/i, metrics:['energy.mtdKwh','power.prevMonthKwh','derived.energyCostMtdAed','derived.energyCostPrevMonthAed'], evidence:'load' },
    { id:'comfort', re:/comfort|iaq|air quality|راحة|جودة الهواء/i, metrics:['metrics.comfortIndex','metrics.iaq'] },
    { id:'energy',  re:/energy|spike|load|consumption|kwh|afternoon|baseline|cost|طاقة|حمل|استهلاك|تكلفة|خط الأساس|الظهيرة/i, metrics:['metrics.energyTodayMwh','energy.currentKw','energy.baselineKw','energy.performancePct','derived.energyCostTodayAed'], evidence:'load' }
  ];
  const GENERIC = { id:'generic', metrics:['metrics.energyTodayMwh','alarms.open','wo.open','derived.energyCostTodayAed'] };
  function topicOf(q, ctx){
    if(ctx && ctx.topic) return TOPICS.find(x => x.id === ctx.topic) || GENERIC;
    return TOPICS.find(x => x.re.test(q)) || GENERIC;
  }
  /* card titles are upper-case labels; an answer speaks in sentences */
  const LABELS = { 'metrics.energyTodayMwh':'ai.lbl.energyToday', 'metrics.waterTodayM3':'ai.lbl.waterToday', 'metrics.gasTodayM3':'ai.lbl.gasToday', 'metrics.comfortIndex':'ai.lbl.comfortIdx', 'metrics.iaq':'ai.lbl.iaq', 'metrics.peakTodayMw':'ai.lbl.peakToday', 'energy.currentKw':'ai.lbl.currentKw', 'energy.mtdKwh':'ai.lbl.mtdKwh', 'power.prevMonthKwh':'ai.lbl.prevMonthKwh' };
  /* a figure the platform computed, in the report engine's shape */
  function figure(id){
    const FIG = R().FIG; if(!FIG || !FIG[id]) return null;
    let per = null; try{ per = R().period(E, 'today'); }catch(e){ per = { kind:'today' }; }
    let r = null; try{ r = FIG[id](E, per, {}); }catch(e){ return null; }
    if(!r || r.value == null || isNaN(r.value)) return null;
    const dq = R().dataQuality(E), flagged = (r.sources || []).some(s => dq.some(d => d.sourceId === s));
    return Object.assign({ id, fmt: R().fmt(r.value, r.d), flagged, label: t(LABELS[id] || r.labelKey) }, r);
  }
  function figuresFor(topic, ctx){
    const ids = (ctx && ctx.metrics && ctx.metrics.length ? ctx.metrics : topic.metrics);
    return ids.map(figure).filter(Boolean);
  }
  /* the mandatory sources line: points · window · bases (+ data-as-of when stale) */
  function sourcesOf(figs){
    const lang = E.lang;
    const points = [...new Set(figs.flatMap(f => f.sources || []))].map(s => R().sourceLabel(E, s, lang));
    const wins = [...new Set(figs.map(f => (f.basis && f.basis.windowKey) ? t(f.basis.windowKey, f.basis.windowParams || {}) : ''))].filter(Boolean);
    const bases = [];
    figs.forEach(f => { const b = f.basis || {};
      if(b.averagingKey) bases.push(t(b.averagingKey));
      if(b.tariff) bases.push(t('rpB.tariff', { id:b.tariff.id, v:b.tariff.version || '', rate:R().fmt(b.tariff.rate, 2), unit:b.tariff.unit }) + (b.tariff.provisional ? ' ' + t('rpB.prov') : '') + ' ' + t('ai.setInAdmin'));
      if(b.emission) bases.push(t('rpB.emission', { id:b.emission.id, f:R().fmt(b.emission.factor, 2), unit:b.emission.unit }) + (b.emission.provisional ? ' ' + t('rpB.prov') : ''));
      if(b.formulaKey) bases.push(t(b.formulaKey)); });
    const parts = points.concat(wins, [...new Set(bases)]);
    const F = window.EKO_PWA && window.EKO_PWA.feed ? window.EKO_PWA.feed() : null;
    if(E.state.stale) parts.push(t('ai.staleNote', { t: E.state.offlineSince || E.state.degradedSince || (F && F.ts ? hhmm(F.ts) : '') }));
    if(figs.some(f => f.flagged)) parts.push(t('rpB.flagged'));
    return { text: t('ai.sources', { list: parts.join(' · ') }), window: wins[0] || '', stale: !!E.state.stale };
  }
  function alarmRows(){ return E.data.alarms.slice().sort((a, b) => ({ critical:0, high:1, medium:2 }[a.sev] - { critical:0, high:1, medium:2 }[b.sev])).slice(0, 4).map(a => ({ id:a.id, asset:a.asset, sev:a.sev, what:E.alarmLines(a, false).main, tech:E.alarmLines(a, false).sub, age:E.hhmmAgo ? E.hhmmAgo(a.ageH) : '' })); }
  function evidenceOf(topic){
    if(topic.evidence === 'alarms') return { kind:'alarms', rows: alarmRows() };
    if(topic.evidence === 'load'){ const b = (((E.data.power || {}).bva || {}).ranges || {}).today; if(b && b.actual) return { kind:'load', actual:b.actual.slice(), baseline:(b.baseline || []).slice(), labels:(b.labels || []).slice(), unit:b.unit || 'kWh' }; }
    return null;
  }
  function actionsOf(topic, ev){
    if(topic.actions !== 'alarm' && topic.actions !== 'stale') return [];
    const worst = ev && ev.rows && ev.rows[0]; if(!worst) return [];
    return [{ act:'locate', asset:worst.asset, key:'locate3d' }, { act:'openAsset', asset:worst.asset, key:'details' }, { act:'cwo', asset:worst.asset, key:'cwo' }];
  }
  function computedText(figs){ return figs.map(f => t('ai.figSent', { label:f.label, value:f.fmt, unit:f.unit ? ' ' + f.unit : '' })).join(' '); }
  function prompt(ctx, attempt){ return [t('rpPrompt.role'), t('rpPrompt.rule'), attempt > 1 ? t('rpPrompt.retry') : '', t('rpPrompt.lang'), 'CONTEXT: ' + JSON.stringify(ctx)].filter(Boolean).join('\n'); }

  /* answer one question: figures → context → narration (guardrail, one retry) → turn */
  async function answer(question, ctxChip, turn){
    const topic = topicOf(question, ctxChip);
    const figs = figuresFor(topic, ctxChip);
    const src = sourcesOf(figs);
    const ev = evidenceOf(topic);
    const site = E.lang === 'ar' ? E.data.nameAr : E.data.nameEn;
    const ctx = { kind:'ask', question, topic:topic.id, site, window:src.window, scope: ctxChip ? ctxChip.label : site,
      figures: figs.map(f => ({ id:f.id, label:f.label, fmt:f.fmt, unit:f.unit, basis:R().basisText(E, f.basis || {}, f.flagged, E.lang) })),
      alarms: ev && ev.kind === 'alarms' ? ev.rows.map(r => ({ asset:r.asset, sev:t('rpSev.' + r.sev), what:r.what, tech:r.tech })) : [] };
    Object.assign(turn.a, { figures: figs.map(f => ({ id:f.id, label:f.label, fmt:f.fmt, unit:f.unit, flagged:f.flagged })), sources: src.text, window: src.window, evidence: ev, actions: actionsOf(topic, ev), topic: topic.id, stale: src.stale });
    const L = LLM();
    if(!L || L.kind === 'none' || !L.adapter){ turn.a.text = computedText(figs); turn.a.status = 'unreachable'; return; }
    let avail = false; try{ avail = await L.available(); }catch(e){ avail = false; }
    if(!avail){ turn.a.text = computedText(figs); turn.a.status = 'unreachable'; return; }
    for(let attempt = 1; attempt <= 2; attempt++){
      let r;
      try{ r = await L.generate(prompt(ctx, attempt), ctx, { lang:E.lang, attempt }); }
      catch(e){ turn.a.status = 'error'; turn.a.error = String(e && e.message || e); return; }
      const bad = RN() ? RN().offending(r.text, ctx) : [];
      if(!bad.length){ turn.a.text = r.text; turn.a.status = attempt > 1 ? 'regenerated' : 'ok'; turn.a.model = r.model; turn.a.rejected = attempt - 1; return; }
      const entry = { t:new Date().toISOString(), conv: load().cur, question, attempt, numbers:bad, model:r.model };
      S.log.push(entry); console.warn('[ask eko] narration rejected (attempt ' + attempt + '): numbers not in context: ' + bad.join(', '));
      try{ R().audit(E, 'ask.narration.rejected', load().cur, { attempt, numbers:bad, model:r.model }); }catch(e){}
    }
    turn.a.text = computedText(figs); turn.a.status = 'fallback'; turn.a.rejected = 2;
    try{ R().audit(E, 'ask.narration.fallback', load().cur, {}); }catch(e){}
  }

  /* ------------------------------- streaming ------------------------------- */
  /* progressive rendering of a finished answer (the mock adapter does not
     stream; a streaming adapter feeds the same reveal); Stop keeps what is on
     screen and says so */
  function stream(turn){
    const full = turn.a.text || ''; const words = full.split(/(\s+)/);
    let i = 0; turn.a.shown = '';
    S.streaming = { turn, timer: setInterval(() => {
      if(!S.streaming || S.streaming.turn !== turn) return;
      i = Math.min(words.length, i + 2); turn.a.shown = words.slice(0, i).join('');   /* a word (plus its space) per tick */
      patchMsgs();
      if(i >= words.length){ clearInterval(S.streaming.timer); S.streaming = null; delete turn.a.shown; if(!S.open) S.unread = true; save(); E.set({}); }   /* D133: finished while closed → the launcher's dot */
    }, 30) };
    E.set({});   /* the input row shows Stop while the answer streams */
  }
  function stop(){ if(!S.streaming) return; const turn = S.streaming.turn; clearInterval(S.streaming.timer); S.streaming = null; turn.a.text = turn.a.shown || ''; turn.a.stopped = true; delete turn.a.shown; save(); E.set({}); }

  /* ---------------------------------- ask ---------------------------------- */
  async function ask(question, opts){
    opts = opts || {};
    const q = String(question || '').trim(); if(!q) return;
    if(opts.regenerateOf == null && S.route && S.route(q)) return;   /* D133: a report ask is the report engine's */
    S.ctxFresh = false;
    if(S.streaming) stop();
    const c = ensureConv();
    if(!c.title) c.title = q.slice(0, 80);
    const turn = { q:{ text:q, at:new Date().toISOString() }, a:{ text:'', at:null, status:'pending' } };
    if(opts.regenerateOf != null) c.turns.splice(opts.regenerateOf, 1, turn); else c.turns.push(turn);
    c.updated = new Date().toISOString();
    open(); save(); E.set({});
    await answer(q, S.ctx, turn);
    turn.a.at = new Date().toISOString();
    if(turn.a.status === 'error'){ if(!S.open) S.unread = true; save(); E.set({}); return; }
    stream(turn);
  }

  /* ------------------------------- open / close ---------------------------- */
  function open(ctx){
    if(ctx !== undefined){ S.ctx = ctx; S.ctxFresh = !!ctx; }
    S.unread = false;
    if(!S.open){ S.open = true; S.opening = true; }   /* D132c: a floating pop-up over the page — the page and its panels stay as they are */
    S.hist = false; S.menu = false;
  }
  function close(){ if(!S.open) return; S.open = false; S.hist = false; S.menu = false; S.fbOpen = null; if(S.streaming) stop(); }
  const isOpen = () => S.open;

  /* -------------------------------- context -------------------------------- */
  /* a sparkle's context: what the card measures → topic, metrics, timeframe, filters */
  const CTX_TOPIC = [[/alarm|تنبيه/i, 'alarms'], [/water|مياه/i, 'water'], [/gas|غاز/i, 'gas'], [/waste|opportunit|هدر|فرص/i, 'waste'], [/peak|demand|power factor|ذروة|طلب/i, 'peak'], [/comfort|iaq|راحة|جودة/i, 'comfort'], [/not reporting|stale|لا تُبلّغ/i, 'stale'], [/energy|consumption|load|kwh|طاقة|استهلاك|حمل/i, 'energy']];
  const nice = s => (s && /\s/.test(s) && !/[a-z]/.test(s) && /[A-Z]/.test(s)) ? s.charAt(0) + s.slice(1).toLowerCase() : s;   /* "ENERGY TODAY" → "Energy today"; a code like CH-2 keeps its case */
  function contextFrom(el){
    const raw = el.dataset.aiLabel || '', cap = el.dataset.aiCap || '', label = nice(raw);
    const topic = el.dataset.aiTopic || (CTX_TOPIC.find(([re]) => re.test(raw + ' ' + cap)) || [null, null])[1];
    /* the card's own timeframe and filters, read at the moment of the click */
    const card = el.closest('.pwwidget, .pwtile, .ovk, #modpanel, #assetpanel, .wmaxbox');
    const seg = card ? [...card.querySelectorAll('.seg[data-on="true"]')].map(x => x.textContent.trim()).filter(Boolean) : [];
    const fch = card ? [...card.querySelectorAll('.fchip[data-on="true"], .fchip[aria-pressed="true"]')].map(x => x.textContent.trim()).filter(Boolean) : [];
    const tf = el.dataset.aiWindow || seg[0] || '';
    return { label, cap, topic, window: tf, filters: el.dataset.aiFilters || fch.join(', '), metrics: topic ? (TOPICS.find(x => x.id === topic) || GENERIC).metrics : null };
  }
  function suggestions(){
    if(S.ctx && S.ctx.topic) return [1, 2, 3].map(i => 'ai.sug.' + S.ctx.topic + '.' + i).filter(k => E.t(k) !== k);
    const page = (window.EKO_LAYOUTS[E.state.pageId] || {}).askChips || [];
    const keys = page.map(k => k.startsWith('!') ? k.slice(1) : k);
    return keys.length ? keys : ['chipWaste', 'chipFaults', 'chipSpike'];
  }

  /* ------------------------------- clipboard ------------------------------- */
  function copyText(text){ S.lastCopy = text; try{ if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {}); }catch(e){} }
  function turnText(turn, withSources){ return turn.a.text + (withSources && turn.a.sources ? '\n' + turn.a.sources : ''); }
  function convText(c){ return c.turns.map(tr => t('ai.youLbl') + ': ' + tr.q.text + '\n' + t('ai.ekoLbl') + ': ' + tr.a.text + (tr.a.sources ? '\n' + tr.a.sources : '') + '\n' + hhmm(tr.a.at || tr.q.at)).join('\n\n'); }

  /* -------------------------------- export --------------------------------- */
  function footerRows(){
    const b = E.data.basis || {}, prov = t('rpB.prov');
    const site = E.lang === 'ar' ? E.data.nameAr : E.data.nameEn;
    return [[t('rpFt.site'), site], [t('rpFt.generated'), new Date().toLocaleString(E.lang === 'ar' ? 'ar-AE' : 'en-GB')], [t('rpFt.by'), (E.data.user && (E.lang === 'ar' ? E.data.user.nameAr : E.data.user.name)) || ''],
      [t('rpFt.tariff'), (b.tariffId || '') + ' ' + (b.tariffVersion || '') + (b.tariffStatus === 'provisional' ? ' ' + prov : '')], [t('rpFt.emission'), (b.co2FactorId || '') + (b.co2FactorStatus === 'provisional' ? ' ' + prov : '')], [t('rpFt.eko'), window.EKO_VERSION || '']];
  }
  function exportMd(c){
    const lines = ['# ' + t('ai.exportTitle'), '', t('ai.convLine', { n:c.turns.length, d:dateLbl(c.at) }), ''];
    c.turns.forEach(tr => { lines.push('## ' + t('ai.youLbl') + ' · ' + hhmm(tr.q.at)); lines.push(tr.q.text, ''); lines.push('**' + t('ai.ekoLbl') + '** · ' + hhmm(tr.a.at || tr.q.at) + (tr.a.window ? ' · ' + tr.a.window : '')); lines.push(tr.a.text || '', '');
      if(tr.a.figures && tr.a.figures.length){ lines.push('| ' + t('ai.colFig') + ' | ' + t('ai.colVal') + ' |', '|---|---|'); tr.a.figures.forEach(f => lines.push('| ' + f.label + ' | ' + f.fmt + (f.unit ? ' ' + f.unit : '') + ' |')); lines.push(''); }
      if(tr.a.sources) lines.push('_' + tr.a.sources + '_', ''); });
    lines.push('---', '**' + t('rpFt.label') + '**'); footerRows().forEach(([k, v]) => lines.push('- ' + k + ': ' + v));
    const md = lines.join('\n'); S.lastExport = { kind:'md', text:md, name:'ask-eko-' + c.id + '.md' };
    if(RX() && RX().download) RX().download(new Blob([md], { type:'text/markdown' }), S.lastExport.name);
    try{ R().audit(E, 'ask.export', c.id, { format:'md' }); }catch(e){}
  }
  function exportPdf(c){
    const body = `<div class="aiprint"><h1>${esc(t('ai.exportTitle'))}</h1><p class="tCap">${esc(t('ai.convLine', { n:c.turns.length, d:dateLbl(c.at) }))}</p>
      ${c.turns.map(tr => `<section class="aiprintturn"><h3>${esc(t('ai.youLbl'))} · ${esc(hhmm(tr.q.at))}</h3><p>${esc(tr.q.text)}</p>
        <h3>${esc(t('ai.ekoLbl'))} · ${esc(hhmm(tr.a.at || tr.q.at))}${tr.a.window ? ' · ' + esc(tr.a.window) : ''}</h3>${(tr.a.text || '').split(/\n+/).map(p => `<p>${esc(p)}</p>`).join('')}
        ${tr.a.figures && tr.a.figures.length ? `<table class="rpt"><thead><tr><th>${esc(t('ai.colFig'))}</th><th>${esc(t('ai.colVal'))}</th></tr></thead><tbody>${tr.a.figures.map(f => `<tr><td>${esc(f.label)}</td><td class="tMonoS">${esc(f.fmt)}${f.unit ? ' ' + esc(f.unit) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
        ${tr.a.sources ? `<p class="tCap">${esc(tr.a.sources)}</p>` : ''}</section>`).join('')}
      <div class="rpfootblock"><b>${esc(t('rpFt.label'))}</b>${footerRows().map(([k, v]) => `<div class="rpfootrow"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div></div>`;
    S.lastExport = { kind:'pdf', html:body, name:'ask-eko-' + c.id };
    if(RX() && RX().printHtml) RX().printHtml(E, { id:'ask-eko-' + c.id, lang:E.lang, title:t('ai.exportTitle'), html:body });
    try{ R().audit(E, 'ask.export', c.id, { format:'pdf' }); }catch(e){}
  }

  /* --------------------------------- views --------------------------------- */
  function evidenceHtml(ev){
    if(!ev) return '';
    if(ev.kind === 'load' && ev.actual && ev.actual.length > 1){
      const W = 160, H = 36, act = C().sparkPath(ev.actual, W, H), base = ev.baseline && ev.baseline.filter(x => x != null).length > 1 ? C().sparkPath(ev.baseline.map((v, i) => v == null ? ev.actual[i] : v), W, H) : null;
      return `<div class="aievid" aria-label="${esc(t('ai.evidLoad'))}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${base ? `<path d="${base}" fill="none" stroke="var(--t3)" stroke-width="1" stroke-dasharray="3 2"/>` : ''}<path d="${act}" fill="none" stroke="var(--ai-accent)" stroke-width="1.5"/></svg><span class="tCap">${esc(t('ai.evidLoad'))} · ${esc((ev.labels[0] || '') + '–' + (ev.labels[ev.labels.length - 1] || ''))} · ${esc(ev.unit)}</span></div>`;
    }
    if(ev.kind === 'alarms' && ev.rows && ev.rows.length){
      return `<table class="aitbl"><tbody>${ev.rows.map(r => `<tr><td class="tMonoS">${esc(r.asset)}</td><td><span class="statchip" data-sev="${esc(r.sev)}">${esc(t('rpSev.' + r.sev))}</span></td><td>${esc(r.what)}</td></tr>`).join('')}</tbody></table>`;
    }
    return '';
  }
  function figsHtml(figs){
    if(!figs || !figs.length) return '';
    return `<table class="aifigs"><tbody>${figs.map(f => `<tr><td>${esc(f.label)}</td><td class="tMonoS">${esc(f.fmt)}${f.unit ? ` <span class="tCap">${esc(f.unit)}</span>` : ''}${f.flagged ? ` <span class="aiflag tipU" data-tip="${esc(t('rpB.flagged'))}" role="img" aria-label="${esc(t('rpB.flagged'))}">${icon('warn', 12)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  function turnHtml(tr, i){
    const a = tr.a, streaming = S.streaming && S.streaming.turn === tr, text = streaming ? (a.shown || '') : (a.text || '');
    const paras = text.split(/\n+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');
    const note = a.status === 'unreachable' ? t('ai.unreachable') : a.status === 'fallback' ? t('ai.fallback') : a.stopped ? t('ai.stopped') : a.status === 'regenerated' ? t('ai.regenerated') : '';
    const fb = a.feedback || null;
    const fbForm = S.fbOpen === i ? `<div class="aifb"><input class="aifbin" data-chg="aiFbNote" data-i="${i}" value="${esc((fb && fb.note) || '')}" placeholder="${esc(t('ai.fbNotePh'))}" maxlength="140"><button class="btnG btnSm" data-act="aiFbSave" data-i="${i}">${esc(t('saveW'))}</button></div>` : '';
    return `<div class="aiturn aiq"><div class="aibubble">${esc(tr.q.text)}</div><span class="aitime tMonoS">${esc(hhmm(tr.q.at))}</span></div>
      <div class="aiturn aia" data-status="${esc(a.status || '')}" data-i="${i}">
        <div class="aibubble">
          ${a.status === 'pending' ? `<div class="aityping" aria-label="${esc(t('ai.typing'))}"><span></span><span></span><span></span></div>` : ''}
          ${a.status === 'error' ? `<p class="aierr">${esc(t('ai.error'))}</p><button class="btnG btnSm" data-act="aiRetry" data-i="${i}">${esc(t('ai.retry'))}</button>` : `<div class="aitext">${paras}${streaming ? '<span class="aicaret"></span>' : ''}</div>`}
          ${!streaming && a.status !== 'pending' && a.status !== 'error' ? `${evidenceHtml(a.evidence)}${figsHtml(a.figures)}
            ${a.sources ? `<p class="aisrc">${esc(a.sources)}</p>` : ''}
            ${a.actions && a.actions.length ? `<div class="aiacts2">${a.actions.map(x => `<button class="btnG btnSm" data-act="${esc(x.act)}" data-asset="${esc(x.asset)}">${esc(t(x.key))}</button>`).join('')}</div>` : ''}
            <div class="aimeta tCap"><span class="tMonoS">${esc(hhmm(a.at || tr.q.at))}</span>${a.window ? ` · ${esc(a.window)}` : ''}${note ? ` · <span class="ainote">${esc(note)}</span>` : ''}</div>` : ''}
        </div>
        ${!streaming && a.status !== 'pending' && a.status !== 'error' ? `<div class="aiturnacts hst" role="group" aria-label="${esc(t('ai.turnActs'))}">
          <button class="wcb tipU" data-act="aiCopy" data-i="${i}" data-tip="${esc(t('ai.copy'))}" aria-label="${esc(t('ai.copy'))}">${icon('copy', 13)}</button>
          <button class="wcb tipU" data-act="aiRegen" data-i="${i}" data-tip="${esc(t('ai.regen'))}" aria-label="${esc(t('ai.regen'))}">${icon('reset', 13)}</button>
          <button class="wcb tipU" data-act="aiFb" data-i="${i}" data-v="up" data-on="${fb && fb.v === 'up'}" data-tip="${esc(t('ai.up'))}" aria-label="${esc(t('ai.up'))}" aria-pressed="${fb && fb.v === 'up'}">${icon('thumbUp', 13)}</button>
          <button class="wcb tipU" data-act="aiFb" data-i="${i}" data-v="down" data-on="${fb && fb.v === 'down'}" data-tip="${esc(t('ai.down'))}" aria-label="${esc(t('ai.down'))}" aria-pressed="${fb && fb.v === 'down'}">${icon('thumbDown', 13)}</button>
        </div>${fbForm}` : ''}
      </div>`;
  }
  function msgsHtml(){
    const c = cur();
    if(!c || !c.turns.length) return `<div class="aiempty"><span class="aiglyph">${icon('spark', 20)}</span><p>${esc(t('ai.empty'))}</p><p class="tCap">${esc(t('ai.onprem'))}</p></div>`;
    return c.turns.map(turnHtml).join('');
  }
  function patchMsgs(){ const box = document.querySelector('#aipanel .aimsgs'); if(!box) return; box.innerHTML = msgsHtml(); box.scrollTop = box.scrollHeight; }
  function histHtml(){
    const list = convs();
    return `<div class="aihist"><div class="aihisth"><b>${esc(t('ai.history'))}</b><span class="grow"></span>${list.length ? `<button class="btnG btnSm" data-act="aiClear">${esc(t('ai.clearAll'))}</button>` : ''}<button class="iconbtn icon26" data-act="aiHist" aria-label="${esc(t('close'))}">${icon('x', 12)}</button></div>
      ${list.length ? list.map(c => `<button class="aihrow" data-act="aiHistOpen" data-id="${esc(c.id)}" data-on="${c.id === load().cur}"><span class="grow taS">${esc(c.title || t('ai.convTitleNew'))}</span><span class="tCap">${esc(dateLbl(c.at))} · ${esc(t('ai.turnsN', { n:c.turns.length }))}</span></button>`).join('') : `<p class="tCap aihempty">${esc(t('ai.histEmpty'))}</p>`}</div>`;
  }
  function panel(app){
    E = E || app;
    (window.DASHBOARD_ROOT||document.documentElement).toggleAttribute('data-ai-open', S.open);
    if(!S.open) return '';
    const c = cur(), chips = suggestions();
    return `<div class="aiscrim" aria-hidden="true"></div><aside id="aipanel" class="aipanel" role="dialog" aria-label="${esc(t('ai.title'))}" data-stale="${E.state.stale ? 1 : 0}" data-born="${E.state.born === 'ai' ? 1 : 0}">
      <div class="draghandle"></div>
      <div class="aihead"><span class="aiglyph aiavatar" aria-hidden="true">${icon('spark', 16)}</span><b>${esc(t('ai.title'))}</b>
        ${S.ctx ? `<span class="aictx" data-tip="${esc([S.ctx.label, S.ctx.window, S.ctx.filters, S.ctx.cap].filter(Boolean).join(' · ') + ' — ' + t('ai.ctxTip'))}"><span class="taS">${esc(S.ctx.label)}${S.ctx.window ? ` · ${esc(S.ctx.window)}` : ''}${S.ctx.filters ? ` · ${esc(S.ctx.filters)}` : ''}</span><button class="aictxx" data-act="aiCtxRemove" aria-label="${esc(t('ai.ctxRemove'))}" data-tip="${esc(t('ai.ctxRemove'))}">${icon('x', 10)}</button></span>` : ''}
        <span class="grow"></span>
        <button class="iconbtn icon26 tipU" data-act="aiHist" data-tip="${esc(t('ai.history'))}" aria-label="${esc(t('ai.history'))}" aria-expanded="${!!S.hist}">${icon('clock', 14)}</button>
        <button class="iconbtn icon26 tipU" data-act="aiNew" data-tip="${esc(t('ai.new'))}" aria-label="${esc(t('ai.new'))}">${icon('plus', 14)}</button>
        <button class="iconbtn icon26 tipU" data-act="aiMenu" data-tip="${esc(t('ai.more'))}" aria-label="${esc(t('ai.more'))}" aria-haspopup="menu" aria-expanded="${!!S.menu}">${icon('dots', 14)}</button>
        <button class="iconbtn icon26" data-act="aiClose" aria-label="${esc(t('close'))}">${icon('x', 13)}</button></div>
      ${S.menu ? `<div class="aimenu" role="menu"><button role="menuitem" data-act="aiExport" data-v="md" ${c && c.turns.length ? '' : 'disabled'}>${icon('download', 13)} ${esc(t('ai.exportMd'))}</button><button role="menuitem" data-act="aiExport" data-v="pdf" ${c && c.turns.length ? '' : 'disabled'}>${icon('doc', 13)} ${esc(t('ai.exportPdf'))}</button><button role="menuitem" data-act="aiCopyConv" ${c && c.turns.length ? '' : 'disabled'}>${icon('copy', 13)} ${esc(t('ai.copyConv'))}</button></div>` : ''}
      ${S.hist ? histHtml() : ''}
      <div class="aimsgs" aria-live="polite">${msgsHtml()}</div>
      <div class="aiinput" data-hint="${esc(E.state.askHint || '')}"><input id="aiin" autocomplete="off" placeholder="${esc(t(E.state.askHint === 'report' ? 'rpAskPh' : 'askPh'))}" aria-label="${esc(t('ai.title'))}">${S.streaming ? `<button class="btnG btnSm aistop" data-act="aiStop">${icon('x', 12)} ${esc(t('ai.stop'))}</button>` : `<button class="aisend" data-act="aiSend" aria-label="${esc(t('ai.send'))}">${icon('chevR', 16)}</button>`}</div>
      ${(!(c && c.turns.length) || S.ctxFresh) ? `<div class="aichips">${chips.map(k => `<button class="chip" data-act="aiChip" data-k="${esc(k)}">${esc(t(k))}</button>`).join('')}</div>` : ''}
    </aside>`;
  }
  /* D133: the launcher — a persistent pill (a FAB on the phone) at the canvas's bottom-end corner; hidden while the conversation is open, absent on the wall */
  function launcher(app){
    E = E || app;
    if(S.open || E.state.wall || E.state.signedOut) return '';
    return `<button id="ailaunch" class="ailaunch tipU" data-act="aiOpen" data-ai="bar" data-unread="${S.unread ? 1 : 0}" data-tip="${esc(t('ai.launchTip'))}" aria-label="${esc(t('ai.launchTip'))}" aria-keyshortcuts="Control+/"><span class="aiglyph" aria-hidden="true">${icon('spark', 18)}</span><span class="ailbl">${esc(t('ai.title'))}</span>${S.unread ? `<span class="aidot" role="status" aria-label="${esc(t('ai.unread'))}"></span>` : ''}</button>`;
  }
  function setRoute(fn){ S.route = fn; }
  /* after each render: the panel's geometry (below the top bar; above the phone tabs when stacked), the newest turn in view */
  function after(){
    const p = document.getElementById('aipanel'); if(!p) return;
    const sm = document.getElementById('shellmain');
    if(sm){ const r = sm.getBoundingClientRect(); p.style.setProperty('--aiTop', Math.round(r.top) + 'px'); }
    const foot = [document.getElementById('mobtabs')].find(x => x && x.getBoundingClientRect().height > 0);   /* the phone tabs when stacked */
    p.style.setProperty('--aiBottom', (foot ? Math.round(Math.max(0, window.innerHeight - foot.getBoundingClientRect().top)) : 0) + 'px');
    const box = p.querySelector('.aimsgs'); if(box) box.scrollTop = box.scrollHeight;
    if(S.opening){ S.opening = false; const inp = p.querySelector('#aiin');
      if(window.innerWidth < 768){ if(inp && document.activeElement === inp) inp.blur(); }   /* the phone sheet opens at half, keyboard down */
      else if(inp) inp.focus({ preventScroll:true }); }
  }

  /* -------------------------------- actions -------------------------------- */
  const ACTS = {
    aiOpen(el){ const ctx = el && el.dataset.aiLabel ? contextFrom(el) : null; open(ctx || (el && el.dataset.ai === 'bar' ? S.ctx : null)); if(window.EKO_SURF) window.EKO_SURF.noteOpener({ act:'aiOpen', v:'' }); E.set({ born:'ai' }); },
    aiClose(){ close(); E.set({}); },
    aiSend(){ const inp = document.getElementById('aiin'); if(!inp || !inp.value.trim()) return; const q = inp.value.trim(); inp.value = ''; ask(q); },
    aiChip(el){ ask(t(el.dataset.k)); },
    aiStop(){ stop(); },
    aiRetry(el){ const c = cur(); const tr = c && c.turns[+el.dataset.i]; if(tr) ask(tr.q.text, { regenerateOf:+el.dataset.i }); },
    aiRegen(el){ const c = cur(); const tr = c && c.turns[+el.dataset.i]; if(tr) ask(tr.q.text, { regenerateOf:+el.dataset.i }); },
    aiCopy(el){ const c = cur(); const tr = c && c.turns[+el.dataset.i]; if(tr){ copyText(turnText(tr, true)); if(window.EKO_FB) window.EKO_FB.toast({ text:t('ai.copied'), tone:'ok' }); } },   /* D132b: one Copy — the answer with its sources line (the sources are part of the answer) */
    aiFb(el){ const c = cur(); const i = +el.dataset.i; const tr = c && c.turns[i]; if(!tr) return; tr.a.feedback = Object.assign({}, tr.a.feedback || {}, { v:el.dataset.v, at:new Date().toISOString() }); S.fbOpen = i; save(); persistFeedback(c, i); E.set({}); },
    aiFbNote(el){ const c = cur(); const tr = c && c.turns[+el.dataset.i]; if(tr){ tr.a.feedback = Object.assign({}, tr.a.feedback || {}, { note:el.value }); } },
    aiFbSave(el){ const c = cur(); const i = +el.dataset.i; if(c && c.turns[i]){ save(); persistFeedback(c, i); } S.fbOpen = null; if(window.EKO_FB) window.EKO_FB.toast({ text:t('ai.fbSaved'), tone:'ok' }); E.set({}); },
    aiNew(){ if(S.streaming) stop(); const c = cur(); if(c && !c.turns.length){ E.set({}); return; } load().cur = null; S.ctx = null; S.hist = false; ensureConv(); E.set({}); },
    aiHist(){ S.hist = !S.hist; S.menu = false; E.set({}); },
    aiHistOpen(el){ load().cur = el.dataset.id; S.hist = false; save(); E.set({}); },
    aiClear(){ const s = load(); s.convs = []; s.cur = null; save(); S.hist = false; E.set({}); },
    aiMenu(){ S.menu = !S.menu; S.hist = false; E.set({}); },
    aiExport(el){ const c = cur(); S.menu = false; if(!c || !c.turns.length){ E.set({}); return; } if(el.dataset.v === 'pdf') exportPdf(c); else exportMd(c); E.set({}); },
    aiCopyConv(){ const c = cur(); S.menu = false; if(c && c.turns.length){ copyText(convText(c)); if(window.EKO_FB) window.EKO_FB.toast({ text:t('ai.copiedConv'), tone:'ok' }); } E.set({}); },
    aiCtxRemove(){ S.ctx = null; E.set({}); }
  };
  function persistFeedback(c, i){
    const tr = c.turns[i]; const list = feedbackStore().filter(f => !(f.conv === c.id && f.turn === i));
    list.push({ conv:c.id, turn:i, question:tr.q.text, answer:tr.a.text, sources:tr.a.sources || '', v:tr.a.feedback.v, note:tr.a.feedback.note || '', at:tr.a.feedback.at, model:tr.a.model || '' });
    try{ localStorage.setItem(LSF, JSON.stringify(list)); }catch(e){}
  }
  /* keyboard in the input, press-and-hold on a turn (touch) */
  function wire(app){
    E = app;
    document.addEventListener('keydown', ev => {
      if(ev.key === 'Enter' && ev.target && ev.target.id === 'aiin' && ev.target.value.trim()){ ev.preventDefault(); ACTS.aiSend(); }
    });
    /* the phone sheet: full while typing (the input sits above the keyboard), back to half when the user leaves the input —
       not when a re-render replaced it (the answer arriving must not shrink the sheet under the reader) */
    document.addEventListener('focusin', ev => { if(S.opening) return; if(ev.target && ev.target.id === 'aiin' && window.innerWidth < 768 && window.EKO_SHEET){ window.EKO_SHEET.heights.ai = 92; window.EKO_SHEET.sync(); } });
    document.addEventListener('focusout', ev => { const el = ev.target; if(!(el && el.id === 'aiin' && window.innerWidth < 768 && window.EKO_SHEET)) return;
      setTimeout(() => { if(!document.contains(el)) return; window.EKO_SHEET.heights.ai = window.EKO_SHEET.SNAPS[1]; window.EKO_SHEET.sync(); }, 0); });
    let hold = null;
    document.addEventListener('pointerdown', ev => {
      const turn = ev.target.closest && ev.target.closest('.aiturn.aia'); if(!turn || ev.pointerType === 'mouse') return;
      hold = setTimeout(() => { turn.toggleAttribute('data-acts', true); if(window.EKO_PWA) window.EKO_PWA.haptic('snap'); }, 450);
    }, true);
    ['pointerup', 'pointercancel', 'pointermove'].forEach(k => document.addEventListener(k, () => { if(hold){ clearTimeout(hold); hold = null; } }, true));
  }

  return { ACTS, ask, open, close, isOpen, panel, launcher, setRoute, after, wire, stop, state:S, convs, cur, feedback:feedbackStore, log:() => S.log.slice(), contextFrom, suggestions, exportMd, exportPdf, get ctx(){ return S.ctx; } };
})();
