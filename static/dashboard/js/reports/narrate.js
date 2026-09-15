/* ============================================================================
   NARRATION (D91) — the platform computes, the model narrates.
   For a built ReportDoc: an executive summary, one commentary per section
   that has figures, and recommendations. Each is generated from a
   STRUCTURED CONTEXT (the section's figures with their formatted values and
   basis lines) and carries a SOURCES LINE naming the points, the window and
   the bases used — the same pattern as the Ask EKO answers.

   THE NUMBER GUARDRAIL: every number token in the returned prose must
   appear as a number token in the supplied context. Otherwise the section
   is rejected, regenerated ONCE with the rule restated, and if it fails
   again the section falls back to the computed figures with no prose. Every
   rejection is logged to the audit trail and the console.
   If no adapter is configured or reachable, narration.status = 'off' and
   the report header says so; the figures are untouched.
   ============================================================================ */
window.EKO_RN = (function(){
  'use strict';
  const NUM_RE = /\d+(?:[.,]\d+)*/g;
  const norm = s => s.replace(/,/g, '');
  const numbersIn = s => new Set((String(s).match(NUM_RE) || []).map(norm));
  /* returns the offending numbers (empty = clean) */
  function offending(text, ctx){
    const allowed = numbersIn(JSON.stringify(ctx));
    const out = [];
    numbersIn(text).forEach(n => { if(!allowed.has(n)) out.push(n); });
    return out;
  }
  const tl = (E, lang) => (k, v) => E.t.call({ lang }, k, v);

  function figCtx(E, doc, f){
    const t = tl(E, doc.lang);
    return { id:f.id, label:t(f.labelKey), fmt:f.fmt, unit:f.unit, basis:window.EKO_R.basisText(E, f.basis, f.flagged, doc.lang), flagged:!!f.flagged };
  }
  function sectionFigures(s){
    const out = [];
    s.widgets.forEach(w => { if(w.figures) out.push(...w.figures); });
    return out;
  }
  function sourcesOf(E, doc, figs){
    const t = tl(E, doc.lang);
    const points = [...new Set(figs.flatMap(f => f.sources || []))];
    const bases = [];
    figs.forEach(f => { if(f.basis.tariff) bases.push(t('rpB.tariff', { id:f.basis.tariff.id, v:f.basis.tariff.version || '', rate:window.EKO_R.fmt(f.basis.tariff.rate, 2), unit:f.basis.tariff.unit }) + (f.basis.tariff.provisional ? ' ' + t('rpB.prov') : ''));
      if(f.basis.emission) bases.push(t('rpB.emission', { id:f.basis.emission.id, f:window.EKO_R.fmt(f.basis.emission.factor, 2), unit:f.basis.emission.unit }) + (f.basis.emission.provisional ? ' ' + t('rpB.prov') : '')); });
    return { points, windowKey:doc.period.labelKey, windowParams:doc.period.params, bases:[...new Set(bases)] };
  }
  function prompt(E, doc, ctx, attempt){
    const t = tl(E, doc.lang);
    return [t('rpPrompt.role'), t('rpPrompt.rule'), attempt > 1 ? t('rpPrompt.retry') : '', t('rpPrompt.lang'), 'CONTEXT: ' + JSON.stringify(ctx)].filter(Boolean).join('\n');
  }
  /* one narrated block, with the guardrail and the single retry */
  async function block(E, doc, ctx, sources, n){
    const LLM = window.EKO_LLM;
    for(let attempt = 1; attempt <= 2; attempt++){
      let r;
      try{ r = await LLM.generate(prompt(E, doc, ctx, attempt), ctx, { lang:doc.lang, attempt }); }
      catch(e){ n.errors.push({ kind:ctx.kind, id:ctx.id, error:String(e.message || e) }); return { text:null, sources, rejected:false, unavailable:true }; }
      const bad = offending(r.text, ctx);
      if(!bad.length) return { text:r.text, sources, rejected:false, model:r.model };
      n.rejections.push({ sectionId:ctx.id, attempt, numbers:bad });
      console.warn('[report ' + doc.id + '] narration rejected for ' + ctx.id + ' (attempt ' + attempt + '): numbers not in context: ' + bad.join(', '));
      window.EKO_R.audit(E, 'report.narration.rejected', doc.id, { sectionId:ctx.id, attempt, numbers:bad, model:r.model });
    }
    window.EKO_R.audit(E, 'report.narration.fallback', doc.id, { sectionId:ctx.id });
    return { text:null, sources, rejected:true };
  }

  async function narrate(E, doc){
    const LLM = window.EKO_LLM;
    const t = tl(E, doc.lang);
    const n = { status:'off', adapter: LLM ? LLM.kind : 'none', reasonKey:null, summary:null, sections:{}, recommendations:null, rejections:[], errors:[] };
    doc.narration = n;
    if(!LLM || LLM.kind === 'none' || !LLM.adapter){ n.reasonKey = 'rpNarr.none'; return n; }
    if(!(await LLM.available())){ n.reasonKey = 'rpNarr.unreachable'; n.reasonParams = { adapter: LLM.kind }; return n; }
    const site = doc.lang === 'ar' ? doc.site.nameAr : doc.site.nameEn;
    const win = t(doc.period.labelKey, doc.period.params);
    const allFigs = Object.values(doc.figures);
    /* the summary sees one figure per section (the first), across the report */
    const sumFigs = doc.sections.map(s => sectionFigures(s)[0]).filter(Boolean).slice(0, 6);
    const dqList = doc.dataQuality.map(d => window.EKO_R.sourceLabel(E, d.sourceId, doc.lang));
    /* executive summary */
    const sumCtx = { kind:'summary', id:'summary', site, window:win, sectionCount:doc.sections.length, figures: sumFigs.map(f => figCtx(E, doc, f)), dataQuality:dqList };
    n.summary = await block(E, doc, sumCtx, sourcesOf(E, doc, sumFigs), n);
    /* per section */
    for(const s of doc.sections){
      const figs = sectionFigures(s);
      if(!figs.length) continue;   /* locked, missing or table-only sections have nothing for the model to say */
      const ctx = { kind:'section', id:s.id, title:t(s.titleKey), window:win, status:s.status, figures:figs.map(f => figCtx(E, doc, f)), flagged:figs.filter(f => f.flagged).map(f => t(f.labelKey)), missing: s.missing ? t(s.missing.reasonKey, s.missing.params) : null };
      n.sections[s.id] = await block(E, doc, ctx, sourcesOf(E, doc, figs), n);
    }
    /* recommendations */
    const recCtx = { kind:'recommendations', id:'recommendations', site, window:win, figures: allFigs.filter(f => /avoidable|waste|impact/i.test(f.id)).map(f => figCtx(E, doc, f)), dqCount:doc.dataQuality.length, dataQuality:dqList };
    n.recommendations = await block(E, doc, recCtx, sourcesOf(E, doc, allFigs.filter(f => /avoidable|waste|impact/i.test(f.id))), n);
    const blocks = [n.summary, n.recommendations, ...Object.values(n.sections)];
    const withText = blocks.filter(b => b && b.text).length;
    n.status = withText === 0 ? 'off' : (withText < blocks.length ? 'partial' : 'on');
    if(n.status === 'off') n.reasonKey = n.errors.length ? 'rpNarr.failed' : 'rpNarr.rejectedAll';
    return n;
  }
  return { narrate, offending, numbersIn };
})();
