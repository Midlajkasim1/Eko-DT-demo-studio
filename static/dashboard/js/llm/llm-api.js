/* ============================================================================
   LLM API (D91) — the pluggable seam, exactly like the viewer and the CMMS.
   ONE CONFIG LINE selects the adapter per site: data.features.llm
   ("mock" | "ollama" | "none"). Nothing model-specific leaks past the
   adapter boundary: endpoint shapes, model names, prompt formats and
   streaming live in the adapter.

   Adapter contract (every adapter implements):
     name                       -- 'mock' | 'ollama'
     capabilities = { narrate, stream, languages:['en','ar'] }
     available()  -> Promise<boolean>     reachable right now (cached briefly)
     generate(prompt, context, opts) -> Promise<{ text, model }>
                                   opts: { lang, timeoutMs, attempt }
                                   rejects on timeout / unreachable

   THE LAW (adapter-agnostic, lives HERE and in narrate.js): the platform
   computes every figure and passes them as structured context; the model
   writes prose only. A model that returns a number not in the context has
   its section rejected (narrate.js). If no adapter is configured or
   reachable, reports still generate with computed figures and say so.
   ============================================================================ */
window.EKO_LLM = (function(){
  'use strict';
  let adapter = null, kind = 'none', E = null;
  const ADAPTERS = () => ({ mock: window.EKO_LLM_MOCK, ollama: window.EKO_LLM_OLLAMA });
  function init(app){ E = app; use((E.data.features || {}).llm || 'none'); }
  function use(k){ kind = k; adapter = ADAPTERS()[k] || null; if(adapter && adapter.init) adapter.init(E); return kind; }
  async function available(){ if(!adapter) return false; try{ return await adapter.available(); }catch(e){ return false; } }
  async function generate(prompt, context, opts){
    if(!adapter) throw new Error('llm: no adapter configured');
    return adapter.generate(prompt, context, opts || {});
  }
  const capabilities = () => adapter ? adapter.capabilities : { narrate:false, stream:false, languages:[] };
  return { init, use, available, generate, capabilities, get kind(){ return kind; }, get adapter(){ return adapter; } };
})();
