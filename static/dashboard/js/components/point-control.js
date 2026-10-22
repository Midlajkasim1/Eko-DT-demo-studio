/* ============================================================================
   Point control: the dialog that changes a setpoint or a status the backend's
   point_control policy allows (the point carries `control`). Writes go through
   DashboardData.writePoint to POST /api/fin/point-write, where the backend
   checks the policy again before writing FIN.
   ============================================================================ */
window.EKO_POINT_CONTROL = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = s => C().esc(s);

  const numberOf = v => { const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  const decimals = step => (String(step).split('.')[1] || '').length;
  const fmtNum = (n, step) => Number(n).toFixed(decimals(step));
  const shownOf = p => p.text || p.currentValue || '—';

  function assetOf(E, id){ return (E.data.assets || []).find(a => a.id === id) || null; }
  function pointOf(E, edit){
    const a = edit && assetOf(E, edit.assetId);
    return a ? ((a.points || []).find(p => p.id === edit.pointId) || null) : null;
  }
  function initialDraft(p){
    const ctl = p.control;
    if(ctl.role === 'status') return typeof p.bool === 'boolean' ? p.bool : null;
    const n = numberOf(p.currentValue);
    return n == null ? ctl.min : Math.min(ctl.max, Math.max(ctl.min, n));
  }
  function valueLabel(p, value){
    const ctl = p.control;
    if(ctl.role === 'status') return (ctl.options.find(o => o.value === value) || {}).label || String(value);
    return `${fmtNum(value, ctl.step)} ${ctl.unit}`.trim();
  }

  function overlay(E){
    const edit = E.state.pointEdit, p = pointOf(E, edit);
    if(!p || !p.control) return '';
    const t = E.t.bind(E), ctl = p.control, born = E.state.born === 'dlg' ? 1 : 0;
    const status = ctl.role === 'status', off = edit.busy ? ' disabled' : '';
    const input = status
      ? `<div class="segbox row pcchoice" role="radiogroup" aria-label="${esc(p.navName)}">${ctl.options.map(o =>
          `<button type="button" class="seg" role="radio" data-act="pointEditChoose" data-v="${o.value}" data-on="${edit.draft === o.value}" aria-checked="${edit.draft === o.value}"${off}>${esc(o.label)}</button>`).join('')}</div>`
      : `<div class="pcnum">
          <button type="button" class="iconbtn" data-act="pointEditStep" data-v="-1" aria-label="${esc(t('pcLower'))}"${off}>−</button>
          <input id="pointEditValue" type="number" inputmode="decimal" min="${ctl.min}" max="${ctl.max}" step="${ctl.step}" value="${esc(fmtNum(edit.draft, ctl.step))}" aria-label="${esc(p.navName)}"${off}>
          <span class="pcunit">${esc(ctl.unit)}</span>
          <button type="button" class="iconbtn" data-act="pointEditStep" data-v="1" aria-label="${esc(t('pcRaise'))}"${off}>+</button>
        </div>
        <p class="tCap">${esc(t('pcRange', { min: fmtNum(ctl.min, ctl.step), max: fmtNum(ctl.max, ctl.step), unit: ctl.unit }))}</p>`;
    const done = edit.result && edit.result.tone === 'ok';
    return `<div class="scrim" data-born="${born}" data-act="pointEditClose"></div>
      <div class="dlg dlgpoint" data-born="${born}" role="dialog" aria-modal="true" aria-label="${esc(t(status ? 'pcTitleStatus' : 'pcTitleSetpoint'))}">
        <div class="draghandle"></div>
        <div class="dlghead"><h2>${esc(t(status ? 'pcTitleStatus' : 'pcTitleSetpoint'))}</h2>
          <button class="iconbtn msA" data-act="pointEditClose" aria-label="${esc(t('close'))}">${C().icon('x', 14)}</button></div>
        <div class="pcwhat"><span class="tMono fw6">${esc(edit.assetId)}</span><span class="cT3">${esc(p.navName)}</span></div>
        <div class="pcnow"><span class="tCap">${esc(t('pcNow'))}</span><b class="tMono">${esc(shownOf(p))}</b>${ctl.manual ? `<span class="apctlman">${esc(t('pcManual'))}</span>` : ''}</div>
        ${input}
        <p class="tCap pchint">${esc(t(ctl.manual ? 'pcManualNote' : 'pcHint'))}</p>
        ${edit.result ? `<p class="pcresult" data-tone="${edit.result.tone}" role="status">${esc(edit.result.text)}</p>` : ''}
        <div class="row gap8 pcfoot">
          ${ctl.manual ? `<button class="btnG" data-act="pointEditAuto"${off}>${esc(t('pcAuto'))}</button>` : ''}
          <span class="grow"></span>
          <button class="btnG" data-act="pointEditClose">${esc(t(done ? 'close' : 'cancelW'))}</button>
          <button class="btnP" data-act="pointEditApply"${edit.busy || (status && edit.draft == null) ? ' disabled' : ''}>${esc(t(edit.busy ? 'pcSending' : 'pcApply'))}</button>
        </div>
      </div>`;
  }

  /* The backend answered with the point as FIN now reports it: show that until the next poll */
  function applyReading(E, assetId, p, data){
    Object.assign(p, { currentValue: data.currentValue, text: data.text, bool: data.bool, control: data.control });
    const asset = assetOf(E, assetId);
    ((asset && asset.analog) || []).forEach(row => { if(row[4] && row[4].id === p.id){ row[4] = p; row[2] = data.text || data.currentValue; } });
  }

  async function send(E, action){
    const edit = E.state.pointEdit, p = pointOf(E, edit);
    if(!p || edit.busy) return;
    const ctl = p.control, t = E.t.bind(E);
    let value = null;
    if(action === 'set'){
      if(ctl.role === 'status') value = edit.draft;
      else {
        const box = document.getElementById('pointEditValue');
        value = numberOf(box ? box.value : edit.draft);
        if(value == null || value < ctl.min || value > ctl.max){
          edit.result = { tone: 'bad', text: t('pcRange', { min: fmtNum(ctl.min, ctl.step), max: fmtNum(ctl.max, ctl.step), unit: ctl.unit }) };
          E.set({}); return;
        }
        edit.draft = value;
      }
    }
    edit.busy = true; edit.result = null; E.set({});
    const res = await window.DashboardData.writePoint(p.id, action, value);
    edit.busy = false;
    if(E.state.pointEdit !== edit) return;
    if(!res.ok){ edit.result = { tone: 'bad', text: t('pcFailed', { msg: res.error }) }; E.set({}); return; }
    applyReading(E, edit.assetId, p, res.data);
    if(action === 'auto') edit.result = { tone: 'ok', text: t(res.data.confirmed ? 'pcReleased' : 'pcReleasePending') };
    else edit.result = res.data.confirmed
      ? { tone: 'ok', text: t('pcConfirmed', { v: valueLabel(p, value) }) }
      : { tone: 'warn', text: t('pcPending', { v: valueLabel(p, value) }) };
    if(action === 'auto') edit.draft = initialDraft(p);
    E.set({});
  }

  function focusInput(){
    requestAnimationFrame(() => {
      const el = document.getElementById('pointEditValue') || document.querySelector('.dlgpoint .pcchoice .seg[data-on="true"], .dlgpoint .pcchoice .seg');
      if(el) el.focus();
    });
  }

  const ACTS = {
    pointEditOpen(el){
      const E = window.EKO, assetId = E.state.assetSel;
      const p = pointOf(E, { assetId, pointId: el.dataset.pt });
      if(!p || !p.control) return;
      E.set({ born: 'dlg', pointEdit: { assetId, pointId: p.id, draft: initialDraft(p), busy: false, result: null } });
      focusInput();
    },
    pointEditClose(){ const E = window.EKO; if(E.state.pointEdit && E.state.pointEdit.busy) return; E.set({ pointEdit: null }); },
    pointEditChoose(el){ const E = window.EKO; E.state.pointEdit.draft = el.dataset.v === 'true'; E.state.pointEdit.result = null; E.set({}); },
    pointEditStep(el){
      const E = window.EKO, edit = E.state.pointEdit, p = pointOf(E, edit);
      if(!p) return;
      const ctl = p.control, box = document.getElementById('pointEditValue');
      const cur = numberOf(box ? box.value : edit.draft);
      const next = (cur == null ? ctl.min : cur) + Number(el.dataset.v) * ctl.step;
      edit.draft = Math.min(ctl.max, Math.max(ctl.min, Math.round(next / ctl.step) * ctl.step));
      edit.result = null;
      E.set({});
      focusInput();
    },
    pointEditApply(){ send(window.EKO, 'set'); },
    pointEditAuto(){ send(window.EKO, 'auto'); }
  };

  document.addEventListener('input', ev => {
    const E = window.EKO;
    if(ev.target.id === 'pointEditValue' && E && E.state.pointEdit){ E.state.pointEdit.draft = numberOf(ev.target.value) ?? E.state.pointEdit.draft; }
  });
  document.addEventListener('keydown', ev => {
    if(ev.key === 'Enter' && ev.target.id === 'pointEditValue'){ ev.preventDefault(); ACTS.pointEditApply(); }
  });

  return { overlay, ACTS };
})();
