/* ============================================================================
   The four page archetypes. A page = layout document + data binding; every
   current and future screen maps to one of these. Widget types resolve
   through WIDGETS below — adding a page never adds page code.
   The reference's shell anatomy is preserved: the viewer owns the centre,
   the summary (#ovp) overlays it, the module panel docks right, and the
   asset panel replaces the module panel while open (model never covered).
   ============================================================================ */
window.EKO_P = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const V = () => window.EKO_V;

  /* Widget registry: layout "type" → renderer. */
  const WIDGETS = {
    executiveSummary: E => C().execSummary(E),
    energySummary:    E => C().energySummary(E),
    alarmPanel:       E => C().alarmModPanel(E),
    energyPanel:      E => C().energyModPanel(E),
    powerPage:        E => C().powerPage(E),
    powerMv:          () => '',   /* D96: rendered by powerPage inside its scroll area */
    consModelPanel:   E => C().consModelPanel(E),
    notifPage:        E => window.EKO_NF.page(E),
    registerTable:    (E,w) => window.EKO_DG.render(E, window.EKO_DG.specs.assets),   /* D100: the shared data grid */
    utilitiesSummary: E => C().utilitiesSummary(E),
    utilitiesPanel:   E => C().utilitiesPanel(E),
    systemsSummary:   E => window.EKO_A.systemsSummary(E),
    systemsPanel:     E => window.EKO_A.systemsPanel(E),
    sysPage:          (E,w) => window.EKO_A.sysPage(E, w),
    lockedSummary:    E => window.EKO_A.lockedSummary(E),
    spacesSummary:    E => window.EKO_A.spacesSummary(E),
    assetsSummary:    E => window.EKO_A.assetsSummary(E),
    modRows:          (E,w) => window.EKO_A.modRowsPanel(E, w),
    benchPage:        E => window.EKO_A.benchPage(E),
    anomPage:         E => window.EKO_A.anomPage(E),
    fcstPage:         E => window.EKO_A.fcstPage(E),
    waterPage:        E => window.EKO_A.waterPage(E),
    gasPage:          E => window.EKO_A.gasPage(E),
    heatPanel:        E => window.EKO_A.heatPanel(E),
    stubPanel:        E => C().modShell(E, E.t(E.state.moduleLabel||'modOverview'), '', '',
                        `<p class="alempty">${C().esc(E.t('stubBody'))}</p>`)
  };
  const widget = (E,w) => (WIDGETS[w.type] || (()=>''))(E,w);
  const byType = (doc,t) => (doc.widgets||[]).find(w => w.type===t);

  /* Stacked shell (D94, ≤1023): a landing is a scrolling page — the model as
     a PEEK card (Overview) or behind the header's Model button (modules),
     opening full screen with its tools; the summary as a compact KPI grid;
     the module panel as sections. One engine host per render. */
  function stackedLanding(E, doc, summary, panel, peek){
    const model = byType(doc,'viewer3d');
    const cfg = Object.assign({}, (model&&model.config)||{ markers:true });
    const scene = E.state.modelFs
      ? `<div id="modelfs" role="region" aria-label="${C().esc(E.t('mModel'))}">${V().viewer(E, Object.assign({}, cfg, { timeline:false }), '')}
           ${E.state.locFocus ? '' : `<button class="btnG btnSm mfsclose" data-act="modelFs">${C().icon('x',14)} ${C().esc(E.t('mCloseModel'))}</button>`}</div>`   /* in focus, Back to Assets closes it */
      : (peek ? `<div class="mpeek">${V().viewer(E, Object.assign({}, cfg, { dock:'none', pills:false, timeline:false }), '')}
           <button class="btnP btnSm mpeekopen" data-act="modelFs">${C().icon('maximize',14)} ${C().esc(E.t('mOpenModel'))}</button></div>` : '');
    if(E.state.locFocus) return `<div class="mpage">${scene}</div>`;   /* stacked Locate in 3D: model surface */
    return `<div class="mpage">${scene}${summary ? widget(E,summary) : ''}${E.state.assetSel ? C().assetPanel(E) : (panel ? widget(E,panel) : '')}</div>`;
  }

  /* 1. siteOverview: 3D + executive summary overlay + alarms panel + timeline. */
  function siteOverview(E, doc){
    const summary = byType(doc,'executiveSummary');
    const model = byType(doc,'viewer3d');
    const alarms = byType(doc,'alarmPanel');
    if(E.stacked()) return stackedLanding(E, doc, summary, alarms, true);
    return V().viewer(E, (model&&model.config)||{}, summary ? widget(E,summary) : '')
      + (E.state.assetSel ? C().assetPanel(E) : (alarms ? widget(E,alarms) : ''));
  }

  /* 2. categoryLanding: summary tier over the model + module panel. */
  function categoryLanding(E, doc){
    const model = byType(doc,'viewer3d');
    const summary = (doc.widgets||[]).find(w => /Summary$/.test(w.type));
    const panel = (doc.widgets||[]).find(w => /Panel$|^modRows$/.test(w.type));
    if(E.stacked()) return stackedLanding(E, doc, summary, panel || { type:'stubPanel' }, false);
    return V().viewer(E, (model&&model.config)||{ markers:true }, summary ? widget(E,summary) : '')
      + (E.state.assetSel ? C().assetPanel(E) : (panel ? widget(E,panel) : WIDGETS.stubPanel(E)));
  }

  /* 3. detailPage: full-width analytics (KPI strip + cards). No summary tier. */
  function detailPage(E, doc){
    const page = (doc.widgets||[]).map(w => widget(E,w)).join('');
    return page + (E.state.assetSel ? C().assetPanel(E) : '');
  }

  /* 4. registerPage: table + docked asset panel + model kept visible. */
  function registerPage(E, doc){
    const model = byType(doc,'viewerStrip');
    const table = byType(doc,'registerTable');
    /* Locate in 3D (locFocus) also shows the Assets Overview over the model's left, as on the Assets landing */
    const mn = !!E.state.regMin && !E.state.locFocus;   /* D128: the strip collapses like the side panels (chevron, Home/Enter on the splitter); Locate in 3D opens it */
    return (model ? `<div class="regmodelwrap deskwide" data-min="${mn ? 1 : 0}">${
        V().viewer(E, (model&&model.config)||{ markers:true, dock:'none', pills:false }, E.state.locFocus ? widget(E, { type:'assetsSummary' }) : '')}
        <button class="ovcollapse regcollapse tipU" data-act="regMin" data-tip="${C().esc(E.t(mn ? 'mpExpand' : 'mpCollapse'))}" aria-label="${C().esc(E.t(mn ? 'mpExpand' : 'mpCollapse'))}" aria-expanded="${!mn}">${C().icon(mn ? 'chevR' : 'chevL', 12)}</button>
        <span class="tCap regmodelhint">${C().esc(E.t('regModelHint'))}</span></div>` : '')
      + (table ? widget(E,table) : '')
      + (E.state.assetSel ? C().assetPanel(E) : '');
  }

  function stub(E){
    return V().viewer(E, { markers:true }, '') + WIDGETS.stubPanel(E);
  }

  /* 5. reportPage (D88): the in-app preview of a generated report. */
  function reportPage(E){ return window.EKO_RV.page(E); }
  /* 6. reportsHub (D92): create · ask · library. */
  function reportsHub(E){ return window.EKO_RV.hub(E); }
  /* 7. portfolioPage (D103): the estate landing above one twin. */
  function portfolioPage(E){ return window.EKO_PF.page(E); }
  function portfolioSite(E){ return window.EKO_PF.sitePage(E); }   /* D104 */
  const ARCH = { siteOverview, categoryLanding, detailPage, registerPage, reportPage, reportsHub, portfolioPage, portfolioSite };

  function renderPage(E){
    const doc = window.EKO_LAYOUTS[E.state.pageId];
    if(!doc) return stub(E);
    const fn = ARCH[doc.archetype];
    return fn ? fn(E, doc) : stub(E);
  }

  return { renderPage, WIDGETS };
})();
