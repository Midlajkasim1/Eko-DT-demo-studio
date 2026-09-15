/* ============================================================================
   LLM adapter — OLLAMA (D91), the on-prem model server. A documented stub:
   the request shape is real, the endpoint and model are configuration, and
   nothing here is tuned to a particular model.

   CONFIGURATION (site data, data.llm.ollama):
     baseUrl    e.g. "http://ollama.internal:11434"   — inside the perimeter
     model      e.g. "llama3.1:8b" or "qwen2.5:7b"   — any instruct model that
                                                       follows a prompt; Arabic
                                                       needs a multilingual one
     timeoutMs  per call; a report narrates section by section, so keep it
                short (20 s) and let the fallback carry the figures
     stream     false in the prototype. Streaming (/api/generate with
                stream:true returns NDJSON chunks) is worth it only for the
                in-app preview; exports need the whole text anyway.
   ENDPOINTS used:
     GET  {baseUrl}/api/tags          reachability probe (cached 30 s)
     POST {baseUrl}/api/generate      { model, prompt, stream:false,
                                        options:{ temperature:0.2 } }
                                      → { response, model, done, ... }
   SERVER-SIDE NOTE (handoff/reporting.md): in production the browser must
   not call Ollama directly — the EKO server proxies the call, adds the
   audit entry and applies the same guardrail before returning prose.
   ============================================================================ */
window.EKO_LLM_OLLAMA = (function(){
  'use strict';
  let E = null, cfg = null, probe = { at:0, ok:false };
  const DEFAULTS = { baseUrl:'http://localhost:11434', model:'llama3.1:8b', timeoutMs:20000, stream:false, probeMs:1500, probeTtlMs:30000 };
  function withTimeout(p, ms){ return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('ollama: timeout after ' + ms + ' ms')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); }); }
  const api = {
    name:'ollama',
    capabilities:{ narrate:true, stream:false, languages:['en','ar'] },
    init(app){ E = app; cfg = Object.assign({}, DEFAULTS, (E.data.llm && E.data.llm.ollama) || {}); probe = { at:0, ok:false }; },
    config(){ return cfg; },
    async available(){
      if(!cfg) return false;
      if(Date.now() - probe.at < cfg.probeTtlMs) return probe.ok;
      try{ const r = await withTimeout(fetch(cfg.baseUrl + '/api/tags', { method:'GET' }), cfg.probeMs); probe = { at:Date.now(), ok:!!(r && r.ok) }; }
      catch(e){ probe = { at:Date.now(), ok:false }; }
      return probe.ok;
    },
    async generate(prompt, ctx, opts){
      if(!cfg) throw new Error('ollama: not initialised');
      const body = { model: cfg.model, prompt, stream:false, options:{ temperature:0.2 } };
      const r = await withTimeout(fetch(cfg.baseUrl + '/api/generate', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) }), (opts && opts.timeoutMs) || cfg.timeoutMs);
      if(!r.ok) throw new Error('ollama: HTTP ' + r.status);
      const j = await r.json();
      return { text: String(j.response || ''), model: j.model || cfg.model };
    }
  };
  return api;
})();
