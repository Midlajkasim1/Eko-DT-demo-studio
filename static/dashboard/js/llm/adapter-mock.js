/* ============================================================================
   LLM adapter — MOCK (D91). Used by the prototype. Writes deterministic prose
   from the structured context it is given, using ONLY the figures in that
   context, so the platform's guardrail can be exercised end to end.
   Fault injection for the rejection test:
     EKO_LLM_MOCK.fault = 'fabricate'      every attempt adds a number that
                                            is not in the context
     EKO_LLM_MOCK.fault = 'fabricateOnce'  only the first attempt does
     EKO_LLM_MOCK.fault = null             clean
   ============================================================================ */
window.EKO_LLM_MOCK = (function(){
  'use strict';
  let E = null;
  const api = {
    name:'mock',
    capabilities:{ narrate:true, stream:false, languages:['en','ar'] },
    fault:null, latencyMs:60, calls:0, down:false,   /* down: simulate an unreachable model (D132) */
    init(app){ E = app; },
    async available(){ return !api.down; },
    async generate(prompt, ctx, opts){
      api.calls++;
      await new Promise(r => setTimeout(r, api.latencyMs));
      const lang = (opts && opts.lang) || 'en';
      const t = (k, v) => E.t.call({ lang }, k, v);
      const figs = (ctx.figures || []).slice(0, 4);
      const win = ctx.window || '';
      let text = '';
      if(ctx.kind === 'ask'){
        /* D132: prose from the figures only; the first alarm row when the topic is alarms */
        text = t('rpMock.ask', { scope: ctx.scope || ctx.site, window: win }) + ' ' + figs.map(f => t('rpMock.figure', { label: f.label, value: f.fmt, unit: f.unit ? ' ' + f.unit : '' })).join(' ');
        if(ctx.alarms && ctx.alarms.length) text += ' ' + t('rpMock.askAlarm', { asset: ctx.alarms[0].asset, sev: ctx.alarms[0].sev, what: ctx.alarms[0].what });
      } else if(ctx.kind === 'summary'){
        text = t('rpMock.summary', { site: ctx.site, window: win, n: String(ctx.sectionCount) }) + ' ' + figs.map(f => t('rpMock.figure', { label: f.label, value: f.fmt, unit: f.unit ? ' ' + f.unit : '' })).join(' ');
      } else if(ctx.kind === 'recommendations'){
        text = t('rpMock.reco', { first: figs[0] ? figs[0].label : '', dq: String(ctx.dqCount) });
      } else {
        text = figs.length ? t('rpMock.section', { title: ctx.title, window: win }) + ' ' + figs.map(f => t('rpMock.figure', { label: f.label, value: f.fmt, unit: f.unit ? ' ' + f.unit : '' })).join(' ')
                           : t('rpMock.sectionNoFig', { title: ctx.title });
        if(ctx.flagged && ctx.flagged.length) text += ' ' + t('rpMock.flagged', { list: ctx.flagged.join(', ') });
      }
      const attempt = (opts && opts.attempt) || 1;
      if(api.fault === 'fabricate' || (api.fault === 'fabricateOnce' && attempt === 1)) text += ' ' + t('rpMock.fabricated');
      return { text, model:'mock-narrator' };
    }
  };
  return api;
})();
