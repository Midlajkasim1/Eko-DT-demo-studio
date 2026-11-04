/* ============================================================================
   EKO-CHAT CLIENT (Phase 3) — Ask EKO's only way to the model.
   POST /api/chat { message, stream:true } and read the Server-Sent Events:
     start  { model, project }
     tool   { tool, status:'running'|'completed'|'failed', reason? }
     token  { text }                 the grounded answer, a piece at a time
     done   { answer, grounded, card, tool_calls, model, project, timestamp }
     error  { error, message }
   The backend owns the model, its address, its key, the tools and the
   grounding check; nothing about them is known here. The request names the
   open project (X-Eko-Project, as the dashboard's other data calls do): the
   backend answers only the signed-in user of that project, and an answer that
   comes back for any other project is refused here too. A request is cancelled
   with its AbortController; a session runs one request at a time and drops
   every callback of a request it has replaced, so an old answer can never
   write into a newer one.
   Selected per site by data.features.ask = "eko-chat" (ai/ask.js).
   ============================================================================ */
(function(root){
  'use strict';
  const ENDPOINT = '/api/chat';
  /* the Eko-DT project the dashboard has open: injected by the Studio or the exported viewer, never typed or stored here */
  const openProject = () => { const c = root.INJECTED_PROJECT_CONFIG; return c && typeof c.projectId === 'string' && c.projectId ? c.projectId : null; };

  /* SSE text → { event, data } blocks; input may arrive in arbitrary pieces */
  function createParser(onEvent){
    let buf = '';
    function block(text){
      let event = 'message'; const data = [];
      text.split('\n').forEach(line => {
        if(!line || line.charAt(0) === ':') return;
        const i = line.indexOf(':'), field = i < 0 ? line : line.slice(0, i);
        let value = i < 0 ? '' : line.slice(i + 1); if(value.charAt(0) === ' ') value = value.slice(1);
        if(field === 'event') event = value; else if(field === 'data') data.push(value);
      });
      if(!data.length) return;
      let parsed; try{ parsed = JSON.parse(data.join('\n')); }catch(e){ parsed = undefined; }
      onEvent({ event, data: parsed, invalid: parsed === undefined });
    }
    return {
      push(text){
        buf = (buf + text).replace(/\r\n?/g, '\n');
        let i;
        while((i = buf.indexOf('\n\n')) >= 0){ const b = buf.slice(0, i); buf = buf.slice(i + 2); block(b); }
      },
      get pending(){ return buf; }
    };
  }

  /* backend error codes (HTTP detail.error or the SSE error event) → what the user is told */
  const CODES = {
    chat_disabled:'chat_disabled', llm_not_configured:'llm_not_configured',
    fin_not_connected:'session', unauthorized:'session', session_required:'session', session_expired:'session',
    project_required:'project', project_not_supported:'project', project_mismatch:'project', session_project_mismatch:'project', project_not_validated:'project',
    llm_unavailable:'llm_unavailable', llm_http_error:'llm_unavailable',
    llm_timeout:'timeout',
    llm_invalid_response:'invalid_response', llm_empty_response:'invalid_response',
    answer_not_grounded:'grounding',
    max_tool_rounds_exceeded:'tool_error', tool_error:'tool_error',
    stream_interrupted:'stream_interrupted', connection_error:'connection_error'
  };
  function errorCode(code, status){
    if(code && CODES[code]) return CODES[code];
    if(status === 401 || status === 403) return 'session';
    if(status === 409) return 'project';
    if(status === 504) return 'timeout';
    if(status === 502 || status === 503) return 'llm_unavailable';
    return 'error';
  }

  const isAbort = (signal, e) => !!(signal && signal.aborted) || !!(e && e.name === 'AbortError');

  /* one request; handlers: { start, tool, token, done, error }. Resolves to
     { status:'done'|'error'|'aborted', code?, result? }; never rejects. */
  async function ask(message, handlers, opts){
    const h = handlers || {}, o = opts || {}, signal = o.signal || null;
    const doFetch = o.fetch || (root.fetch && root.fetch.bind(root));
    const pid = openProject();
    const wrongProject = d => !!(pid && d && d.project && typeof d.project.id === 'string' && d.project.id && d.project.id !== pid);
    const call = (name, data) => { if(!(signal && signal.aborted) && typeof h[name] === 'function') h[name](data); };
    const fail = (code, message) => { if(signal && signal.aborted) return { status:'aborted' }; call('error', { code, message: message || '' }); return { status:'error', code }; };
    let res;
    try{
      res = await doFetch(ENDPOINT, { method:'POST', credentials:'same-origin', signal: signal || undefined,
        headers: Object.assign({ 'Content-Type':'application/json', 'Accept':'text/event-stream' }, pid ? { 'X-Eko-Project': encodeURIComponent(pid) } : {}),
        body: JSON.stringify({ message: String(message || ''), stream: true }) });
    }catch(e){ return isAbort(signal, e) ? { status:'aborted' } : fail('connection_error'); }
    if(!res.ok){
      let code = null;
      try{ const j = await res.json(); code = j && j.detail && j.detail.error; }catch(e){}
      return fail(errorCode(code, res.status));
    }
    if(!res.body || typeof res.body.getReader !== 'function') return fail('invalid_response');
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let final = null;
    const parser = createParser(ev => {
      if(final || (signal && signal.aborted)) return;
      if(ev.invalid || !ev.data || typeof ev.data !== 'object'){ final = fail('invalid_response'); return; }
      const d = ev.data;
      if((ev.event === 'start' || ev.event === 'done') && wrongProject(d)){ final = fail('project'); return; }   /* another project's answer is never shown */
      if(ev.event === 'start') call('start', { model: d.model || '', project: d.project || null });
      else if(ev.event === 'tool') call('tool', { tool: String(d.tool || 'unknown'), status: String(d.status || ''), reason: d.reason || null });
      else if(ev.event === 'token') call('token', { text: String(d.text == null ? '' : d.text) });
      else if(ev.event === 'done'){ call('done', d); final = { status:'done', result:d }; }
      else if(ev.event === 'error') final = fail(errorCode(d.error), d.message);
    });
    const onAbort = () => { try{ reader.cancel(); }catch(e){} };
    if(signal) signal.addEventListener('abort', onAbort);
    try{
      while(!final){
        if(signal && signal.aborted) return { status:'aborted' };
        let chunk;
        try{ chunk = await reader.read(); }
        catch(e){ return isAbort(signal, e) ? { status:'aborted' } : fail('stream_interrupted'); }
        if(chunk.done){ parser.push(decoder.decode()); break; }
        parser.push(decoder.decode(chunk.value, { stream:true }));
      }
    }finally{
      if(signal) signal.removeEventListener('abort', onAbort);
      if(final){ try{ reader.cancel(); }catch(e){} }
    }
    if(signal && signal.aborted) return { status:'aborted' };
    return final || fail('stream_interrupted');
  }

  /* one request at a time: send() aborts the previous one, whose callbacks then never fire */
  function session(opts){
    const o = opts || {};
    let cur = null, seq = 0;
    function cancel(){ if(cur){ const c = cur; cur = null; c.ctrl.abort(); } }
    function send(message, handlers){
      cancel();
      const id = ++seq, ctrl = new AbortController(), h = handlers || {};
      cur = { id, ctrl };
      const live = () => !!cur && cur.id === id && !ctrl.signal.aborted;
      const guarded = {};
      ['start', 'tool', 'token', 'done', 'error'].forEach(k => { guarded[k] = d => { if(live() && typeof h[k] === 'function') h[k](d); }; });
      const promise = ask(message, guarded, { signal: ctrl.signal, fetch: o.fetch })
        .then(r => { if(cur && cur.id === id) cur = null; return r; });
      return { id, promise, abort(){ if(cur && cur.id === id) cancel(); }, get live(){ return live(); } };
    }
    return { send, cancel, get active(){ return !!cur; } };
  }

  root.EKO_CHAT = { ENDPOINT, ask, session, createParser, errorCode };
})(typeof window !== 'undefined' ? window : globalThis);
