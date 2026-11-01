/* ============================================================================
   THE DEMO SCENARIO ON THE 3D (D182, functional spec 7). The timeline is js/scenario.js;
   this module puts it on the Security overview's model and side panel:
     0:00  the model flies to Level 2 and isolates it; headline "Pre-alarm, ..."
     0:03  the pre-alarm detector pulses; the fire zone volume appears
     0:07 to 0:30  detectors go to alarm one by one; the sequence grows in the side panel
     0:11 to 0:24  cause and effect rows turn Observed; the released doors change on the model
     0:25  AHU-3&4 (2) stays Not observed: the unit turns red; the headline says check on site
     0:30  the ranked cameras show their cones; the top camera's clip opens in a corner card
     0:40  the generator and UPS confirm Ready
     0:50  Level 2 beds appear by status, needs assistance highlighted, the route to the stairs drawn
     1:10  the muster panel's counts rise
     2:00  the end card, with links to each page
   Replay only. Nothing is sent to any system. Every surface says "Demo scenario".
   ============================================================================ */
window.EKO_SCN3 = (function(){
  'use strict';
  const C = () => window.EKO_C, O = () => window.EKO_OPS, SC = () => window.EKO_SCN;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d), icon = (n, s) => C().icon(n, s);
  const L = (E, en, ar) => E.lang === 'ar' ? (ar || en) : en;
  const mmss = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const SD = E => ((E.data.security || {}).scenario) || null;
  const flag = (E, k) => { const s = SD(E), v = SC().view(E); return s.steps.some(x => x.k === k && x.t <= v.now); };
  const zoneOf = E => (((E.data.security || {}).fire || {}).zones || []).find(z => z.id === SD(E).zone) || {};

  /* the headline for the moment */
  function headline(E){
    /* the zone first, then its level: "Diagnostic Imaging, Level 2" */
    const t = E.t.bind(E), v = SC().view(E), z = zoneOf(E), zn = L(E, z.en, z.ar).replace(/^((?:Level|المستوى) \d+), (.+)$/, '$2, $1'), miss = v.outputs.find(o => o.observed === 'no');
    if(flag(E, 'end')) return O().headline(E, t('s3.hl.end', { a: v.devs.filter(d => d.state === 'alarm').length, o: v.outputs.filter(o => o.observed === 'yes').length, n: v.outputs.length }), 'attn');
    if(miss) return O().headline(E, t('s3.hl.miss', { u: miss.asset || L(E, miss.en, miss.ar) }), 'alarm');
    if(v.panel === 'alarm') return O().headline(E, t('s3.hl.alarm', { z: zn, n: v.devs.filter(d => d.state === 'alarm').length }), 'alarm');
    return O().headline(E, t('s3.hl.pre', { z: zn }), 'attn');
  }

  /* ------------------------------ the model ------------------------------ */
  let last = {};
  function sync(E){
    const eng = E.engine; if(!eng || !SC().on(E)) return;
    const s = SD(E), v = SC().view(E), z = zoneOf(E), key = k => JSON.stringify(k);
    if(E.state.dock.level !== s.level && eng.isolateLevel){ E.state.dock.level = s.level; eng.isolateLevel(s.level); }
    /* D182 polish: the whole level in a three quarter view; at the beds step the camera moves in on the beds and routes; at the end, the level again */
    const bedsOn = flag(E, 'beds') && !flag(E, 'end'), frame = bedsOn ? 'beds' : 'level';
    if(last.frame !== frame && eng.frameLevel){ last.frame = frame; const bg = ((((E.data.security || {}).evac || {}).beds) || []).filter(b => b.floor === s.level && b.roomGid).map(b => b.roomGid);
      if(frame === 'beds' && bg.length && eng.flyToGids) eng.flyToGids(bg); else eng.frameLevel(s.level); }
    const zv = v.devs.some(d => d.state !== 'normal');
    if(last.zone !== zv && eng.setZoneVolume){ last.zone = zv; eng.setZoneVolume(zv && z.spaces ? { spaces: z.spaces, storey: z.storey, color: 'var(--sevCrit)' } : null); }
    const act = v.seq.filter(x => x.d).slice(-1)[0], hg = act ? act.d.gid : null;
    if(last.hg !== hg && eng.highlightGid){ last.hg = hg; eng.highlightGid(hg); }
    const miss = v.outputs.find(o => o.observed === 'no'), mk = miss ? miss.asset : null;
    if(last.miss !== mk && eng.setAssetColor){ if(last.miss) eng.setAssetColor(last.miss, null); if(mk) eng.setAssetColor(mk, 'var(--sevCrit)'); last.miss = mk; }
    /* labels on the model: the fire zone once it is active, the unit whose response was not observed */
    const lbls = []; if(zv && z.spaces && z.spaces.length) lbls.push({ gid: 'space:' + z.spaces[0], text: E.t('s3.lblZone', { z: L(E, z.en, z.ar).replace(/^((?:Level|المستوى) \d+)[,،] ?(.+)$/, '$2') }), tone: 'alarm', lift: 3 });
    if(mk) lbls.push({ asset: mk, text: E.t('s3.lblMiss', { u: mk }), tone: 'alarm', lift: 2.2, level: 'any' });
    if(last.lbl !== key(lbls) && eng.setLabels){ last.lbl = key(lbls); eng.setLabels(lbls); }
    const cams = flag(E, 'cams') ? SC().rankCams(E, v.devs[0]).list.slice(0, 3).filter(c => c.gid).map(c => ({ gid: c.gid })) : [];
    if(last.cones !== key(cams) && eng.setCones){ last.cones = key(cams); eng.setCones(cams.length ? { cams, occlusion: true } : null); eng._conesKey = 'scn'; }
    const ev = (E.data.security || {}).evac || {}, routes = flag(E, 'beds') ? ((window.EKO_EVACP && (window.EKO_EVACP.scenarioRoutes(E, s.level) || {}).segs) || (ev.routes || []).filter(r => r.level === s.level)) : [];   /* E2: the computed plan's routes */
    if(last.route !== key(routes) && eng.setRoutes){ last.route = key(routes); eng.setRoutes(routes.map(r => ({ pts: r.pts, level: r.level }))); }
  }
  function clear(E){
    const eng = E && E.engine; last = {};
    if(!eng) return;
    if(eng.setZoneVolume) eng.setZoneVolume(null); if(eng.highlightGid) eng.highlightGid(null); if(eng.setCones){ eng.setCones(null); eng._conesKey = ''; }
    if(eng.setRoutes) eng.setRoutes(null); if(eng.setLabels) eng.setLabels(null);
    const miss = (SD(E) || { outputs: [] }).outputs.find(o => o.missing); if(miss && miss.asset && eng.setAssetColor) eng.setAssetColor(miss.asset, null);
  }

  /* markers: the released doors, the Level 2 beds by status (assistance ringed), the corner clip card */
  function markers(E){
    if(!SC().on(E)) return '';
    const t = E.t.bind(E), s = SD(E), v = SC().view(E), sec = E.data.security || {}, out = [];
    const doorsOut = (s.outputs.find(o => o.id === 'doors') || {}), released = v.outputs.find(o => o.id === 'doors' && o.observed === 'yes');
    if(released) (doorsOut.doors || []).forEach(id => { const d = (sec.doors || []).find(r => r.id === id); if(d && d.x != null) out.push(`<span class="mk s3door" data-x="${d.x}" data-y="${d.y}" data-tip="${esc(id + ' · ' + t('s3.released'))}">${icon('lock', 10)}</span>`); });
    if(flag(E, 'beds')) (window.EKO_EVAC ? window.EKO_EVAC.bedsNow(E) : ((sec.evac || {}).beds || [])).filter(b => b.floor === s.level && b.x != null).forEach(b => out.push(`<span class="mk s3bed" data-st="${esc(b.status)}" data-assist="${b.assist ? 1 : 0}" data-x="${b.x}" data-y="${b.y}" data-tip="${esc(b.id + ' · ' + t('evac.st.' + b.status) + (b.assist ? ' · ' + t('evac.st.assist') : ''))}"></span>`));
    return out.join('') + corner(E);
  }
  function corner(E){
    if(!flag(E, 'cams') || flag(E, 'end')) return '';
    const t = E.t.bind(E), v = SC().view(E), top = SC().rankCams(E, v.devs[0]).list[0]; if(!top) return '';
    const W = window.EKO_SECW, cams = (E.data.security || {}).cameras || [];
    return `<div class="s3corner" role="group" aria-label="${esc(t('s3.cornerAria17'))}">${W ? W.videoEl(E, top, cams.indexOf(cams.find(c => c.id === top.id)), 'autoplay muted loop playsinline') : ''}
      <span class="swvtag">${esc(top.id)}</span></div>`;
  }

  /* ------------------------------ the side panel ------------------------------ */
  function sidePanel(E){
    const t = E.t.bind(E), s = SD(E), v = SC().view(E), sec = E.data.security || {}, at = x => '+' + mmss(x);
    if(flag(E, 'end')) return endCard(E);
    const seq = v.seq.map(x => `<li><span class="tMonoS">${esc(at(x.s))}</span><span class="scnseqd" data-k="${x.k}" aria-hidden="true"></span><span>${esc(x.k === 'panel' ? t('scn.seq.panel') : t(x.k === 'pre' ? 'scn.seq.pre' : 'scn.seq.alarm', { id: x.d.id, room: L(E, x.d.room, x.d.roomAr) || '' }))}</span></li>`).join('');
    const ce = v.outputs.map(o => `<li data-obs="${o.observed}"><span>${esc(L(E, o.en, o.ar))}</span><span class="scnobs" data-obs="${o.observed}">${esc(t('s3.obs.' + o.observed, { at: o.atS != null ? at(o.atS) : '' }))}</span></li>`).join('');
    const pw = sec.power || {}, g0 = (pw.generators || [])[0] || {}, u0 = (pw.ups || [])[0] || {};
    const power = flag(E, 'power') ? `<div class="s3cards"><div class="s3card" data-ok="1"><span class="tLbl">${esc(g0.id || t('sec.pw.gens'))}</span><b>${esc(genReady(E))}</b><span class="tCap">${esc(t('s3.genCap', { f: fmt(g0.fuelPct, 0) }))}</span></div>
      <div class="s3card" data-ok="1"><span class="tLbl">${esc(u0.id || 'UPS')}</span><b>${esc(t('s3.ready'))}</b><span class="tCap">${esc(t('s3.upsCap', { l: fmt(u0.loadPct, 0), r: u0.runtimeMin }))}</span></div></div><p class="tCap">${esc(t('s3.powerNote'))}</p>` : `<p class="tCap">${esc(t('s3.waiting'))}</p>`;
    const beds = (window.EKO_EVAC ? window.EKO_EVAC.bedsNow(E) : ((sec.evac || {}).beds || [])).filter(b => b.floor === s.level), occ = beds.filter(b => b.status === 'occ' || b.status === 'isolated').length, asg = beds.filter(b => b.assist).length;
    const evp = flag(E, 'beds') && window.EKO_EVACP ? window.EKO_EVACP.scenarioRoutes(E, s.level) : null, ept = evp && evp.plan.totals;   /* E2: the plan the evacuation engine computed for this fire */
    const bedsH = flag(E, 'beds') ? `<p>${esc(t('s3.beds', { o: occ, n: beds.length, a: asg }))}</p>${ept ? `<p class="tCap">${esc(t('s3.evPlan', { c: ept.total_readable, k: ept.critical_clear_minutes == null ? t('emptyDash') : C().fmt(ept.critical_clear_minutes, 0), s: ept.stranded }))}</p>` : ''}<button class="statlink" data-act="secGo" data-v="sec-evac" data-sub="evac">${esc(t('sec.nav.evac'))} ${icon('chevR', 11)}</button>` : `<p class="tCap">${esc(t('s3.waiting'))}</p>`;
    const must = v.musterOn ? `<ul class="s3must">${v.muster.map(m => `<li><span>${esc(L(E, m.en, m.ar))}</span><span class="tMonoS">${esc(t('s3.must', { s: m.safe, u: m.unknown }))}</span></li>`).join('')}</ul><p class="tCap">${esc(t('scn.musterCap'))}</p>` : `<p class="tCap">${esc(t('s3.waiting'))}</p>`;
    return `<div class="s3panel"><span class="scnchip">${esc(t('scn.chip'))}</span>
      <h4 class="tLbl">${esc(t('scn.seqT'))}</h4>${seq ? `<ol class="scnseq">${seq}</ol>` : `<p class="tCap">${esc(t('scn.seqNone'))}</p>`}
      <h4 class="tLbl">${esc(t('scn.ceT'))}</h4><ul class="s3ce">${ce}</ul>
      <h4 class="tLbl">${esc(t('s3.camsT'))}</h4>${flag(E, 'cams') ? `<p class="tCap">${esc(t('s3.camsCap'))}</p>` : `<p class="tCap">${esc(t('s3.waiting'))}</p>`}
      <h4 class="tLbl">${esc(t('s3.powerT'))}</h4>${power}
      <h4 class="tLbl">${esc(t('s3.bedsT', { l: t('lvlName', { n: s.level.slice(1) }) }))}</h4>${bedsH}
      <h4 class="tLbl">${esc(t('scn.musterT'))}</h4>${must}</div>`;
  }
  /* E7: ready, and the monthly run overdue when it is (PM-0311) */
  const genReady = E => { const g = ((((E.data.security || {}).power || {}).generators) || [])[0] || {}, ago = (g.lastTest || {}).agoD; return g.testOverdue && ago != null && ago > 30 ? E.t('s3.readyOverdue', { d: ago - 30 }) : E.t('s3.ready'); };
  function endCard(E){
    const t = E.t.bind(E), s = SD(E), v = SC().view(E), sec = E.data.security || {};
    const ackS = (s.steps.find(x => x.k === 'ack') || {}).t, firstAl = (v.devs.filter(d => d.alS != null).map(d => d.alS).sort((a, b) => a - b))[0];
    const beds = (window.EKO_EVAC ? window.EKO_EVAC.bedsNow(E) : ((sec.evac || {}).beds || [])).filter(b => b.floor === s.level);
    const row = (k, val, pg, sub) => `<li><span>${esc(t(k))}</span><b class="tMonoS">${esc(val)}</b>${pg ? `<button class="statlink" data-act="secGo" data-v="${pg}" data-sub="${sub || ''}">${icon('chevR', 11)}</button>` : ''}</li>`;
    const SM = s.summary || null;   /* E4: the end card's figures from the fire engine */
    return `<div class="s3end"><span class="scnchip">${esc(t('scn.chip'))}</span><h3>${esc(t('s3.endT'))}</h3><ul>
      ${row('s3.e.alarms', String(SM ? SM.alarms : v.devs.filter(d => d.state === 'alarm').length), 'sec-fire', 'fire')}
      ${row('s3.e.resp', t('s3.e.respV', { o: SM ? SM.observed : v.outputs.filter(o => o.observed === 'yes').length, n: SM ? SM.outputs : v.outputs.length }), 'sec-fire', 'fire')}
      ${row('s3.e.cams', String(SC().rankCams(E, v.devs[0]).list.filter(c => c.clear !== false).length), 'sec-cams', 'cams')}
      ${row('s3.e.assist', String(SM ? SM.assist : beds.filter(b => b.assist).length), 'sec-evac', 'evac')}
      ${row('s3.e.ack', SM ? SM.ackAfterS + ' s' : ackS != null && firstAl != null ? (ackS - firstAl) + ' s' : t('emptyDash'), 'sec', '')}
      ${row('s3.e.power', genReady(E), 'sec-power', 'power')}
      ${SM && SM.fault ? `<li><span>${esc(t('s3.e.wo'))}</span><b class="tMonoS">${esc(SM.fault.wo)}</b><button class="statlink" data-act="woOpen" data-asset="${esc(SM.fault.asset)}">${icon('chevR', 11)}</button></li>` : ''}</ul>${SM && SM.fault ? `<p class="tCap">${esc(t('s3.e.cause', { u: SM.fault.asset, c: L(E, SM.fault.cause, SM.fault.causeAr) }))}</p>` : ''}
      <p class="tCap">${esc(t('s3.endNote'))}</p></div>`;
  }
  return { headline, sync, clear, markers, sidePanel };
})();
