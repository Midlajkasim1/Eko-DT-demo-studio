/* ============================================================================
   REPORT RENDERER (D88–D92) — the in-app preview of a ReportDoc, the print
   document (same markup, light, RTL when Arabic), the quick launcher behind
   the top-bar icon, the Reports hub page and the intent confirmation.
   Charts reuse the shared chart primitives so a report and its screen cannot
   disagree. Every figure prints its basis line; a missing, partial or locked
   section prints an honest statement; provisional bases are marked wherever
   they appear; every page carries the non-removable footer block.
   The document is rendered in ITS OWN language (doc.lang), fixed at
   generation, not the UI's current language.
   ============================================================================ */
window.EKO_RV = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const R = () => window.EKO_R;
  const esc = s => C().esc(s);
  const ctx = (E, d) => ({ lang:d.lang, t:R().tr(E, d.lang), ar: d.lang === 'ar' });
  const or = v => v == null || v === '' ? R().MISSING : v;
  const num2 = v => { const x = R().num(v); return x == null ? null : +x.toFixed(2); };
  const HUB = () => window.EKO_LAYOUTS.reports || { families:{} };
  /* a family's colour is the identity hue of the Overview summary row it
     names (hueKey) — the same colour that domain has everywhere — or none */
  const fam = tpl => HUB().families[tpl.family] || { icon:'doc' };
  const famHue = (E, tpl) => { const f = fam(tpl); if(!f.hueKey) return '';
    const row = (E.data.summary || []).find(s => s.key === f.hueKey); return row ? row.dom : ''; };
  const hueAttr = (E, tpl) => { const h = famHue(E, tpl); return h ? ` data-hue="1" style="--hue:${esc(h)}"` : ''; };
  /* a template's name where no asset is chosen yet (tiles, selects) */
  const tplName = (E, tpl) => E.t(tpl.titleKey, { asset:'' }).replace(/\s*·\s*$/, '');

  const prov = (c, on) => on ? `<span class="rpprov">${esc(c.t('rpB.prov'))}</span>` : '';
  const basisHtml = (E, c, b, flagged) => `<span class="rpbasis">${esc(c.t('rpBasisLbl'))}: ${esc(R().basisText(E, b, flagged, c.lang))}</span>`;
  /* formatted from the stored value, so documents saved before the MISSING rule (fmt:"null") render the same way */
  const figCard = (E, c, f) => { const v = R().fmt(f.value, f.d), miss = v === R().MISSING;
    return `<div class="rpfig" data-flag="${f.flagged ? 1 : 0}" data-missing="${miss ? 1 : 0}" data-prov="${(f.basis.tariff && f.basis.tariff.provisional) || (f.basis.emission && f.basis.emission.provisional) ? 1 : 0}">
      <span class="rpflbl">${esc(c.t(f.labelKey))}</span>
      <span class="rpfval"><b class="tMono">${esc(v)}</b>${miss || !f.unit ? '' : `<span class="rpfunit">${esc(f.unit)}</span>`}</span>
      ${basisHtml(E, c, f.basis, f.flagged)}</div>`; };

  function chartLine(E, c, w){
    const vs = (w.values || []).filter(Number.isFinite);
    if(!vs.length) return `<p class="rpmiss">${esc(c.t('rpMiss.noData', { what: w.series }))}</p>`;
    const tr = ekoTrend(w.values, 480, 60);
    const mx = Math.max(...vs), mn = Math.min(...vs);
    return `<figure class="rpchart"><figcaption class="rpflbl">${esc(c.t(w.labelKey))}</figcaption>
      <svg viewBox="0 0 480 60" preserveAspectRatio="none" aria-label="${esc(c.t(w.labelKey))}"><path d="${tr.line}" fill="none" stroke="var(--acc)" stroke-width="1.6"/></svg>
      <span class="rpaxis tMonoS">${esc(R().fmt(mn, 1))} – ${esc(R().fmt(mx, 1))} ${esc(w.unit)}</span>
      ${basisHtml(E, c, w.basis)}</figure>`;
  }
  const tableHtml = (c, head, rows, label) => `${label ? `<div class="rpflbl">${esc(label)}</div>` : ''}<div class="rptw"><table class="rptable"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(x => x == null || x === '' ? `<td>${esc(R().MISSING)}</td>` : `<td${x.cls ? ` class="${x.cls}"` : ''}>${x.html != null ? x.html : esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const mono = s => ({ html: esc(s), cls:'tMonoS' });

  /* tabular views also feed the XLSX writer: head + rows + basis text */
  function tableOf(E, doc, w){
    const c = ctx(E, doc);
    if(w.type === 'table.alarms') return { head:[c.t('rpCol.sev'), c.t('colAssetId'), c.t('rpCol.what'), c.t('rpCol.age'), c.t('rpCol.state')],
      rows: w.rows.map(a => [c.t('rpSev.' + a.sev), a.asset, c.ar ? (a.techAr || a.techEn) : a.techEn, E.fmtAge.call({ t:c.t }, a.ageH), a.ack ? c.t('ackShort', { time:a.ack.time, who:a.ack.who }) : C().sevAction({ t:c.t }, a.sev)]),
      basis: c.t('rpWin.lastH', { h:w.hours, to:E.data.basis.asOf }) + ' · ' + c.t('rpSrc.alarms') };
    if(w.type === 'table.boards') return { head:[c.t('rpCol.board'), 'kW'], rows:w.rows.map(r => [r[0], R().fmt(r[1], 1)]), basis:R().basisText(E, w.basis, false, c.lang) };
    if(w.type === 'table.waste') return { head:[c.t('rpCol.driver'), 'kWh', E.data.basis.currency || 'AED', c.t('rpCol.state')], rows:w.rows.map(k => [c.ar ? k.labelAr : k.labelEn, num2(k.wasteKwh), num2(R().mul(k.wasteKwh, w.tariff.rate)), c.ar ? k.stateAr : k.stateEn]), basis:R().basisText(E, w.basis, false, c.lang) };
    if(w.type === 'table.anom') return { head:[c.t('colAssetId'), c.t('rpCol.what'), 'kWh MTD', E.data.basis.currency || 'AED'], rows:w.rows.map(a => [a.id, (c.ar ? a.titleAr : a.titleEn) + ' · ' + (c.ar ? a.zoneAr : a.zone), R().num(a.kwhMtd), num2(R().mul(a.kwhMtd, w.tariff.rate))]), basis:R().basisText(E, w.basis, false, c.lang) };
    if(w.type === 'table.bench') return { head:[c.t('rpCol.system'), 'Wh/m²', c.t('rpCol.band'), c.t('rpCol.note')], rows:w.rows.map(r => [c.ar ? r.sysAr : r.sysEn, R().num(r.whm2), r.bandLo == null || r.bandHi == null ? null : r.bandLo + '–' + r.bandHi, c.ar ? r.noteAr : r.noteEn]), basis:R().basisText(E, w.basis, false, c.lang) };
    if(w.type === 'table') return { head:w.head, rows:w.rows, basis:w.basis ? R().basisText(E, w.basis, false, c.lang) : '' };
    if(w.type === 'kv') return { head:[c.t('rpCol.field'), c.t('rpXl.value')], rows:w.rows, basis:w.basis ? R().basisText(E, w.basis, false, c.lang) : '' };
    return null;
  }
  function widget(E, c, w, doc){
    switch(w.type){
      case 'figures':      return `<div class="rpfigs">${w.figures.map(f => figCard(E, c, f)).join('')}</div>`;
      case 'chart.line':   return chartLine(E, c, w);
      case 'table.alarms': {
        if(!w.rows.length) return `<p class="rpmiss rpok">${esc(c.t('rpEmpty.alarms'))}</p>`;
        const tab = tableOf(E, doc, w);
        return tableHtml(c, [''].concat(tab.head.slice(1).map(esc)), w.rows.map((a, i) => [{ html: C().sevGlyph(a.sev, !!a.ack, 12) }, mono(tab.rows[i][1]), tab.rows[i][2], mono(tab.rows[i][3]), tab.rows[i][4]]))
          + `<span class="rpbasis">${esc(c.t('rpBasisLbl'))}: ${esc(tab.basis)}</span>`; }
      case 'table.boards': case 'table.waste': case 'table.anom': case 'table.bench': case 'table': {
        const tab = tableOf(E, doc, w);
        if(!tab.rows.length) return `<div class="rpflbl">${esc(c.t(w.labelKey))}</div><p class="rpmiss rpok">${esc(c.t(w.emptyKey || 'rpEmpty.rows'))}</p>`;
        return tableHtml(c, tab.head.map(esc), tab.rows.map(r => r.map(x => typeof x === 'number' ? mono(R().fmt(x, Number.isInteger(x) ? 0 : 1)) : (/^[A-Z]{2,5}-[A-Z0-9-]+$/.test(String(x)) ? mono(x) : x))), c.t(w.labelKey))
          + (tab.basis ? `<span class="rpbasis">${esc(c.t('rpBasisLbl'))}: ${esc(tab.basis)}</span>` : ''); }
      case 'kv': {
        return `<div class="rpflbl">${esc(c.t(w.labelKey))}</div><dl class="rpkv">${w.rows.map(r => `<dt>${esc(r[0])}</dt><dd>${esc(or(r[1]))}</dd>`).join('')}</dl>${w.basis ? basisHtml(E, c, w.basis) : ''}`; }
      case 'status.leak':  return `<p class="rpmiss ${w.ready ? 'rpok' : ''}">${esc(c.t(w.ready ? 'rpLeak.ready' : 'rpLeak.pending', w.params))}</p>`;
      case 'period.energy':return w.available ? `<div class="rpfigs">${w.figures.map(f => figCard(E, c, f)).join('')}</div>` : '';
      case 'text':         return `<div class="rpflbl">${esc(c.t(w.labelKey))}</div><p class="rpmiss">${esc(c.t(w.textKey))}</p>`;
      default: return '';
    }
  }
  const sourcesText = (E, doc, s) => { const c = ctx(E, doc);
    return [[...new Set(s.points.map(p => R().sourceLabel(E, p, c.lang)))].join(' + '), c.t(s.windowKey, s.windowParams || {})].concat(s.bases).filter(Boolean).join(' · '); };
  function narrBlock(E, c, doc, b, cls){
    if(!b) return '';
    if(b.rejected) return `<p class="rpmiss rpnarrrej">${esc(c.t('rpNarr.rejected'))}</p>`;
    if(!b.text) return '';
    return `<div class="rpnarrb ${cls || ''}"><p class="rpprose">${esc(b.text)}</p><span class="rpsrc">${esc(c.t('rpSrcLine', { line: sourcesText(E, doc, b.sources) }))}</span></div>`;
  }
  function section(E, c, s, doc){
    const n = doc.narration && doc.narration.sections[s.id];
    const state = s.status !== 'ok' ? `<span class="statchip" data-sev="${s.status === 'locked' ? 'medium' : 'high'}">${esc(c.t('rpSt.' + s.status))}</span>` : '';
    const body = (s.status === 'missing' || s.status === 'locked')
      ? `<p class="rpmiss ${s.status === 'locked' ? 'rplocked' : ''}">${esc(c.t(s.missing.reasonKey, s.missing.params))}</p>`
      : (s.status === 'partial' && s.missing ? `<p class="rpmiss">${esc(c.t(s.missing.reasonKey, s.missing.params))}</p>` : '') + s.widgets.map(w => widget(E, c, w, doc)).join('');
    return `<section class="rpsec" data-status="${s.status}"><h3 class="rph3">${esc(c.t(s.titleKey))}${state}</h3>${narrBlock(E, c, doc, n)}${body}</section>`;
  }
  function dataQuality(E, c, doc){
    const rows = doc.dataQuality;
    return `<section class="rpsec rpdq"><h3 class="rph3">${esc(c.t('rpS.dataQuality'))}</h3>
      ${rows.length ? tableHtml(c, [c.t('rpCol.source'), c.t('rpCol.state'), c.t('rpCol.period'), c.t('rpCol.note')].map(esc), rows.map(d => [mono(R().sourceLabel(E, d.sourceId, c.lang)), c.t('rpDQs.' + d.state), mono((d.from || '—') + ' → ' + (d.to || '')), c.t(d.noteKey, d.params)]))
      : `<p class="rpmiss rpok">${esc(c.t('rpDQ.clean'))}</p>`}
      <p class="rpbasis">${esc(c.t('rpDQ.rule'))}</p></section>`;
  }
  function footer(E, c, doc){
    const site = c.ar ? doc.site.nameAr : doc.site.nameEn;
    const cells = [
      ['rpFt.id', doc.id], ['rpFt.title', R().title(E, doc)], ['rpFt.site', site],
      ['rpFt.window', c.t(doc.period.labelKey, doc.period.params)], ['rpFt.generated', doc.generatedAtLabel],
      ['rpFt.by', doc.generatedBy], ['rpFt.tariff', doc.basisVersions.tariff, doc.basisVersions.tariffProvisional], ['rpFt.emission', doc.basisVersions.emission, doc.basisVersions.emissionProvisional], ['rpFt.eko', doc.ekoVersion]
    ];
    return `<footer class="rpfoot" aria-label="${esc(c.t('rpFt.label'))}">${cells.map(([k, v, p]) => `<span><i>${esc(c.t(k))}</i> ${esc(or(v))}${p ? ' ' : ''}${prov(c, p)}</span>`).join('')}</footer>`;
  }
  function narrHead(c, doc){
    const n = doc.narration;
    if(!n || n.status === 'off') return `<span class="rpnarr statchip">${esc(c.t('rpNarr.off'))}${n && n.reasonKey ? ' · ' + esc(c.t(n.reasonKey, n.reasonParams || {})) : ''}</span>`;
    return `<span class="rpnarr statchip" data-sev="${n.status === 'partial' ? 'medium' : 'low'}">${esc(c.t(n.status === 'partial' ? 'rpNarr.partial' : 'rpNarr.on', { adapter:n.adapter }))}</span>`;
  }
  /* The document itself (preview and print share it). */
  function doc(E, d, opts){
    const c = ctx(E, d);
    const site = c.ar ? d.site.nameAr : d.site.nameEn;
    const n = d.narration;
    return `<article class="rpdoc" dir="${c.ar ? 'rtl' : 'ltr'}" lang="${c.lang}" data-id="${esc(d.id)}" data-print="${opts && opts.print ? 1 : 0}">
      <header class="rphead">${C().brandLogo ? C().brandLogo(E) : ''}
        <div class="col"><h2 class="rph2">${esc(R().title(E, d))}</h2>
          <span class="rpsub">${esc(site)} · ${esc(c.t(d.period.labelKey, d.period.params))} · <span class="tMonoS">${esc(d.id)}</span></span></div>
        ${narrHead(c, d)}</header>
      ${d.provisional.length ? `<p class="rpprovnote">${esc(c.t('rpProv.note', { list: d.provisional.map(p => c.t('rpProv.' + p)).join(', ') }))}</p>` : ''}
      ${n && n.summary && (n.summary.text || n.summary.rejected) ? `<section class="rpsec rpexec"><h3 class="rph3">${esc(c.t('rpS.execSummary'))}</h3>${narrBlock(E, c, d, n.summary)}</section>` : ''}
      ${d.sections.map(s => section(E, c, s, d)).join('')}
      ${n && n.recommendations && (n.recommendations.text || n.recommendations.rejected) ? `<section class="rpsec"><h3 class="rph3">${esc(c.t('rpS.recommendations'))}</h3>${narrBlock(E, c, d, n.recommendations)}</section>` : ''}
      ${dataQuality(E, c, d)}
      ${footer(E, c, d)}</article>`;
  }
  /* Preview page: Back + actions above the document, the audit trail below. */
  function page(E){
    const d = E.state.report;
    if(!d) return `<div class="rpwrap"><p class="alempty">${esc(E.t('rpNone'))}</p></div>`;
    const audit = R().auditFor(d.id);
    const removed = R().store.isRemoved(d.id);
    return `<div class="rpwrap"><div class="rpbar">
        <button class="nfpageback" data-act="pageBack">${C().icon('chevL', 13)} ${esc(E.t('nfBack'))}</button>
        <button class="btnG btnSm" data-act="rpHub">${C().icon('grid', 13)} ${esc(E.t('rpHubT'))}</button>
        <span class="grow"></span>
        <button class="btnG btnSm" data-act="rpPdf" data-tip="${esc(E.t('rpPdfTip'))}">${C().icon('download', 13)} ${esc(E.t('rpPdf'))}</button>
        <button class="btnG btnSm" data-act="rpXlsx" data-tip="${esc(E.t('rpXlsxTip'))}">${C().icon('download', 13)} ${esc(E.t('rpXlsx'))}</button>
        <button class="btnG btnSm" data-act="rpRegen" data-tip="${esc(E.t('rpRegenTip'))}">${C().icon('reset', 13)} ${esc(E.t('rpRegen'))}</button>
        ${removed ? `<button class="btnG btnSm" data-act="rpRestore" data-v="${esc(d.id)}">${C().icon('undo', 13)} ${esc(E.t('rpRestore'))}</button>`
                  : `<button class="btnG btnSm rpdanger" data-act="rpDel" data-v="${esc(d.id)}" data-tip="${esc(E.t('rpDelTip'))}">${C().icon('trash', 13)} ${esc(E.t('rpDel'))}</button>`}
      </div>${removed ? `<p class="rpprovnote rpremoved">${esc(E.t('rpRemovedNote'))}</p>` : ''}${doc(E, d)}
      <section class="rpaudit" aria-label="${esc(E.t('rpAuditT'))}"><span class="tLbl">${esc(E.t('rpAuditT'))} · <span class="tMonoS">${esc(d.id)}</span> · ${esc(E.t('rpImmutable'))}</span>
        <ul>${audit.map(a => `<li><span class="tMonoS">${esc(new Date(a.t).toLocaleTimeString(E.lang === 'ar' ? 'ar-AE' : 'en-GB'))}</span> ${esc(E.t('rpAct.' + a.action, a.params))} · ${esc(a.user)}</li>`).join('')}</ul></section></div>`;
  }

  /* ---- shared pieces: suggestion card and template tile ------------------- */
  function suggCard(E, wide){
    const s = window.EKO_RI.suggest(E), tpl = R().templates()[s.templateId], f = fam(tpl);
    return `<button class="rpsugg${wide ? ' rpsuggw' : ''}" data-act="rpSugg">
      <span class="rptico"${hueAttr(E, tpl)}>${C().icon(f.icon, 16)}</span>
      <span class="grow taS"><b>${esc(window.EKO_RI.summary(E, s))}</b><span class="tCap">${esc(E.t('rpSuggWhy.' + s.why))}</span></span>
      <span class="rpgo">${C().icon('chevR', 14)}</span></button>`;
  }
  function tile(E, tpl, big){
    const f = fam(tpl);
    return `<button class="rptile${big ? ' rptilebig' : ''}" data-act="rpPick" data-v="${esc(tpl.id)}" ${big ? '' : `data-tip="${esc(E.t(tpl.descKey))}" data-tipat="start"`}>
      <span class="rptico"${hueAttr(E, tpl)}>${C().icon(f.icon, big ? 18 : 15)}</span>
      <span class="rptname">${esc(tplName(E, tpl))}</span>
      ${big ? `<span class="rptdesc">${esc(E.t(tpl.descKey))}</span>` : ''}
      <span class="tCap rptper">${esc(E.t('rpPer.' + R().periodId(tpl.defaultPeriod)))}</span></button>`;
  }

  /* ---- the quick launcher (top-bar icon): suggestion · tiles · two ways out */
  function panel(E){
    const born = E.state.born === 'dlg' ? 1 : 0;
    const tpls = Object.values(R().templates());
    return `<div class="scrim scrimclear" data-born="${born}" data-act="closeDlg"></div>
      <div class="dlg dlgdrop dropEnd rppanel" data-born="${born}" role="dialog" aria-label="${esc(E.t('rpPanelT'))}" data-busy="${E.state.rpBusy ? 1 : 0}">
        <div class="draghandle"></div>
        <div class="dlghead"><h2>${esc(E.t('rpPanelT'))}</h2><span class="grow"></span>
          <button class="btnG btnSm" data-act="rpHub">${C().icon('grid', 13)} ${esc(E.t('rpHubT'))}</button>
          <button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(E.t('close'))}">${C().icon('x', 14)}</button></div>
        ${suggCard(E, false)}
        <div class="rptiles">${tpls.map(t => tile(E, t, false)).join('')}</div>
        <button class="rpaskrow" data-act="rpAskFocus"><span class="aiglyph">${C().icon('spark', 16)}</span><span class="grow taS"><b>${esc(E.t('rpAskEko'))}</b><span class="tCap">${esc(E.t('rpAskEkoSub'))}</span></span>${C().icon('chevR', 14)}</button>
      </div>`;
  }

  /* ---- the Reports hub page: create · ask · library ----------------------- */
  function hub(E){
    const tpls = Object.values(R().templates());
    const q = (E.state.rpHubQ || '').toLowerCase(), fF = E.state.rpHubF || 'all', showRemoved = !!E.state.rpHubRemoved;
    const fams = HUB().families;
    return `<div class="rphub">
      <header class="rphubhead"><div class="col"><h1 class="rph1">${esc(E.t('rpHubT'))}</h1><p class="tCap">${esc(E.t('rpHubSub'))}</p></div>
        <button class="btnP btnSm rpaskbtn" data-act="rpAskFocus"><span class="aiglyph">${C().icon('spark', 14)}</span> ${esc(E.t('rpAskEko'))}</button></header>
      <section class="rphubsec"><h2 class="rph3">${esc(E.t('rpCreateT'))}</h2>
        ${suggCard(E, true)}
        <div class="rptiles rptilesbig">${tpls.map(t => tile(E, t, true)).join('')}</div></section>
      <section class="rphubsec"><h2 class="rph3">${esc(E.t('rpLibT'))} <span class="tCap">${esc(E.t('rpLibSub'))}</span></h2>
        <div class="rplibbar">
          <div class="askbox rpaskbox">${C().icon('search', 14)}<input class="rphubq" placeholder="${esc(E.t('rpLibSearch'))}" aria-label="${esc(E.t('rpLibSearch'))}" value="${esc(E.state.rpHubQ || '')}"></div>
          <div class="row gap6 rpfams"><button class="chip" data-on="${fF === 'all' ? 1 : 0}" data-act="rpHubF" data-v="all">${esc(E.t('rpFam.all'))}</button>
            ${Object.keys(fams).map(k => `<button class="chip" data-on="${fF === k ? 1 : 0}" data-act="rpHubF" data-v="${k}">${esc(E.t(fams[k].labelKey))}</button>`).join('')}
            <button class="chip" data-on="${showRemoved ? 1 : 0}" data-act="rpHubRemoved">${C().icon('trash', 12)} ${esc(E.t('rpLibRemoved'))}</button></div>
        </div>
        ${library(E)}</section></div>`;
  }
  function library(E){
    const q = (E.state.rpHubQ || '').toLowerCase(), fF = E.state.rpHubF || 'all', showRemoved = !!E.state.rpHubRemoved;
    const all = R().store.list({ removed: showRemoved });
    const rows = all.filter(d => { const tpl = R().templates()[d.templateId] || {};
      if(fF !== 'all' && tpl.family !== fF) return false;
      if(q && !(R().title(E, d, E.lang) + ' ' + d.id + ' ' + d.generatedBy).toLowerCase().includes(q)) return false;
      return true; });
    if(!rows.length) return `<div class="rplib"><p class="alempty">${esc(E.t(all.length ? 'rpLibNoMatch' : 'rpLibEmpty'))}</p></div>`;
    return `<div class="rplib"><div class="rptw"><table class="rptable rplibt"><thead><tr><th>${esc(E.t('rpFt.id'))}</th><th>${esc(E.t('rpFt.window'))}</th><th>${esc(E.t('rpFt.generated'))}</th><th>${esc(E.t('rpFt.by'))}</th><th>${esc(E.t('rpS.narration'))}</th><th>${esc(E.t('rpBasisLbl'))}</th><th></th></tr></thead><tbody>
      ${rows.map(d => { const tpl = R().templates()[d.templateId] || {}, f = fam(tpl), removed = R().store.isRemoved(d.id), c = ctx(E, d);
        return `<tr data-removed="${removed ? 1 : 0}">
          <td><button class="rplibopen" data-act="rpOpen" data-v="${esc(d.id)}"><span class="rptico"${hueAttr(E, tpl)}>${C().icon(f.icon, 14)}</span><span class="col"><b>${esc(R().title(E, d, E.lang))}</b><span class="tMonoS tCap">${esc(d.id)}${d.lang !== E.lang ? ' · ' + d.lang.toUpperCase() : ''}</span></span></button></td>
          <td>${esc(c.t(d.period.labelKey, d.period.params))}</td>
          <td class="tMonoS">${esc(d.generatedAtLabel)}</td>
          <td>${esc(d.generatedBy)}</td>
          <td><span class="statchip" data-sev="${d.narration && d.narration.status === 'on' ? 'low' : d.narration && d.narration.status === 'partial' ? 'medium' : ''}">${esc(E.t('rpNs.' + ((d.narration && d.narration.status) || 'off')))}</span></td>
          <td>${d.provisional.length ? `<span class="rpprov">${esc(E.t('rpB.prov'))}</span>` : esc(E.t('rpVal.confirmed'))}</td>
          <td class="rplibact">${removed
            ? `<button class="btnG btnSm" data-act="rpRestore" data-v="${esc(d.id)}">${C().icon('undo', 12)} ${esc(E.t('rpRestore'))}</button>`
            : `<button class="iconbtn" data-act="rpOpen" data-v="${esc(d.id)}" data-tip="${esc(E.t('rpOpenTip'))}" aria-label="${esc(E.t('rpOpenTip'))}">${C().icon('eye', 14)}</button>
               <button class="iconbtn" data-act="rpPdfId" data-v="${esc(d.id)}" data-tip="${esc(E.t('rpPdfTip'))}" aria-label="${esc(E.t('rpPdf'))}">${C().icon('download', 14)}</button>
               <button class="iconbtn rpdanger" data-act="rpDel" data-v="${esc(d.id)}" data-tip="${esc(E.t('rpDelTip'))}" aria-label="${esc(E.t('rpDel'))}">${C().icon('trash', 14)}</button>`}</td></tr>`; }).join('')}
      </tbody></table></div></div>`;
  }

  /* ---- the intent confirmation: a centred dialog, what was understood ----- */
  function confirmDialog(E){
    const rp = E.state.rp || {}, it = rp.intent;
    const born = E.state.born === 'dlg' ? 1 : 0;
    if(!it) return '';
    const tpls = Object.values(R().templates());
    const tpl = it.templateId ? R().templates()[it.templateId] : null;
    const per = R().periodId(it.period || (tpl && tpl.defaultPeriod));
    const needsAlarm = tpl && tpl.needsAlarm;
    const alarms = E.data.alarms;
    const f = tpl ? fam(tpl) : { icon:'doc' };
    const sel = (name, opts, val, label) => `<label class="rpfld"><span class="tCap">${esc(label)}</span><select class="rpf" data-f="${name}">${opts.map(o => `<option value="${esc(o.v)}"${o.v === val ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>`;
    return `<div class="scrim" data-born="${born}" data-act="closeDlg"></div>
      <div class="dlg rpconfirm" data-born="${born}" role="dialog" aria-label="${esc(E.t('rpNewT'))}" data-busy="${E.state.rpBusy ? 1 : 0}">
        <div class="dlghead"><span class="rptico"${tpl ? hueAttr(E, tpl) : ''}>${C().icon(f.icon, 16)}</span><h2>${esc(E.t('rpNewT'))}</h2><span class="grow"></span><button class="iconbtn msA" data-act="closeDlg" aria-label="${esc(E.t('close'))}">${C().icon('x', 14)}</button></div>
        ${rp.text ? `<p class="rpask-q"><span class="aiglyph">${C().icon('spark', 13)}</span> “${esc(rp.text)}”</p>` : ''}
        <p class="rpundr">${esc(E.t(it.ambiguous ? 'rpAsk.ambiguous' : 'rpAsk.understood'))}</p>
        <p class="rpsummary"><b>${esc(window.EKO_RI.summary(E, it))}</b></p>
        <div class="rpform">
        ${sel('templateId', [{ v:'', l:E.t('rpAsk.choose') }].concat(tpls.map(t => ({ v:t.id, l:tplName(E, t) }))), it.templateId || '', E.t('rpAsk.fTemplate'))}
        ${sel('period', R().PERIODS.map(p => ({ v:p, l:E.t('rpPer.' + p) })), per, E.t('rpAsk.fPeriod'))}
        ${needsAlarm ? sel('alarmId', alarms.map(a => ({ v:a.id, l:a.asset + ' · ' + (E.lang === 'ar' ? (a.techAr || a.techEn) : a.techEn) })), it.params.alarmId || '', E.t('rpAsk.fAlarm')) : ''}
        </div>
        ${tpl && tpl.id !== 'alarm-summary' && !needsAlarm ? `<label class="rpfld rpchk"><input type="checkbox" class="rpf" data-f="includeAlarms"${it.params.includeAlarms ? ' checked' : ''}><span>${esc(E.t('rpAsk.withAlarms'))}</span></label>` : ''}
        <div class="row gap8 rpactions"><button class="btnG btnSm" data-act="closeDlg">${esc(E.t('cancelW'))}</button><span class="grow"></span><button class="btnP btnSm" data-act="rpConfirm"${it.templateId ? '' : ' data-off="1" aria-disabled="true"'}>${C().icon('check', 13)} ${esc(E.t('rpGenerate'))}</button></div>
      </div>`;
  }
  return { page, panel, hub, library, confirmDialog, doc, tableOf, sourcesText };
})();
