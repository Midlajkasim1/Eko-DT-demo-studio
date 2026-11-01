/* ============================================================================
   PRIORITY 2 PAGES (D180, screen specs), simple working versions on demo data:
     S5  Intrusion             Security > Intrusion       areas by state, motion counts per area, bypassed inputs
     S9  Health and compliance Security > Health          offline devices, detector and generator test history, scheduled reports
     D1  Data health           Systems > Data health      points by state (3 times interval rule), integrations with a 24 h log
     D2  Other building systems Systems > Other systems   lifts, generator and UPS, medical gas, dialysis water plant, EV chargers
     D3  Space and occupancy   Spaces > Occupancy         count against capacity, carpet plot, best and worst rooms, occupancy against CO2
   Each page reads its own block when the site has one (data.dataHealth, data.otherSystems, data.occupancy,
   security.intrusion.areas) and otherwise derives what it can from the site's existing data.
   Read only. People appear as counts only. handoff/screens/ marks these "part built".
   ============================================================================ */
window.EKO_P2 = (function(){
  'use strict';
  const C = () => window.EKO_C, A = () => window.EKO_A;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d), icon = (n, s) => C().icon(n, s);
  const L = (E, en, ar) => E.lang === 'ar' ? (ar || en) : en;
  const th = (E, ks) => ks.map(k => `<th scope="col">${esc(E.t(k))}</th>`).join('');
  const table = (E, ks, rows, empty) => `<div class="mnttblwrap"><table class="mnttbl"><thead><tr>${th(E, ks)}</tr></thead><tbody>${rows || `<tr><td colspan="${ks.length}" class="alempty">${esc(E.t(empty || 'p2.none'))}</td></tr>`}</tbody></table></div>`;
  const wrap = (pg, heroes, inner) => `<div class="pwarea secpage" data-pg="${pg}">${heroes.length ? `<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>` : ''}${inner}</div>`;
  const hero = (E, ...a) => A().heroTile(E, ...a), widget = (E, ...a) => A().widget(E, ...a);
  const link = (E, k) => `<p class="p2link">${icon('external', 12)} <span class="statlink" aria-disabled="true">${esc(E.t(k))}</span> <span class="tCap">${esc(E.t('p2.linkNote'))}</span></p>`;
  const bars = (vals, max) => `<span class="p2spark">${vals.map(v => `<i style="height:${Math.max(4, v / Math.max(1, max) * 100).toFixed(0)}%"></i>`).join('')}</span>`;
  const sec = E => E.data.security || {};
  const zoneName = (E, id) => { const z = (sec(E).zones || []).find(x => x.id === id); return z ? L(E, z.en, z.ar) : (id || ''); };

  /* S5. INTRUSION */
  function intrPage(E){
    const t = E.t.bind(E), ir = sec(E).intrusion || {};
    const areas = ir.areas || (ir.zones || []).map(z => ({ zone: z.id, state: z.armed ? 'armed' : 'disarmed', motion24h: null }));
    const evAlarm = new Set((ir.events || []).filter(e => e.active).map(e => e.zone));
    const st = a => evAlarm.has(a.zone) ? 'alarm' : a.state;
    const cnt = k => areas.filter(a => st(a) === k).length, mx = Math.max(1, ...areas.map(a => a.motion24h || 0));
    const heroes = [hero(E, t('p2.in.armed'), String(cnt('armed')), '', t('p2.in.of', { n: areas.length })), hero(E, t('p2.in.disarmed'), String(cnt('disarmed') + cnt('ready')), '', t('p2.in.readyCap', { n: cnt('ready') })),
      hero(E, t('p2.in.alarm'), String(cnt('alarm')), '', t('p2.in.alarmCap')), hero(E, t('p2.in.bypassed'), String((ir.bypassed || []).length), '', t('p2.in.bypassedCap'))];
    const rows = areas.map(a => `<tr><th scope="row">${esc(zoneName(E, a.zone))}</th><td><span class="p2st" data-st="${st(a)}">${esc(t('p2.in.st.' + st(a)))}</span></td>
      <td class="tMonoS">${a.motion24h != null ? fmt(a.motion24h, 0) : t('emptyDash')}</td><td>${a.motionHourly ? bars(a.motionHourly, Math.max(...a.motionHourly)) : ''}</td></tr>`).join('');
    const byp = (ir.bypassed || []).map(b => `<tr><th scope="row" class="tMonoS">${esc(b.device)}</th><td>${esc(zoneName(E, b.zone))}</td><td>${esc(L(E, b.reasonEn, b.reasonAr))}</td><td class="tCap">${esc(L(E, b.since, b.sinceAr))}</td></tr>`).join('');
    return wrap('sec-intr', heroes, widget(E, t('p2.in.areasT'), t('p2.in.areasCap'), table(E, ['sec.c.zone', 'sec.c.state', 'p2.in.c.motion', 'p2.in.c.hourly'], rows) + `<p class="tCap">${esc(t('p2.in.motionNote'))}</p>`)
      + widget(E, t('p2.in.bypT'), '', table(E, ['sec.c.device', 'sec.c.zone', 'sec.c.reason', 'sec.c.since'], byp, 'p2.in.bypNone')) + link(E, 'p2.openIntr'));
  }

  /* S9. HEALTH AND COMPLIANCE */
  function healthPage(E){
    const t = E.t.bind(E), s = sec(E), f = s.fire || {}, pw = s.power || {};
    const offCams = (s.cameras || []).filter(c => c.online === false), offDoors = (s.doors || []).filter(d => d.online === false);
    const panelsBad = (f.panels || []).filter(p => p.status !== 'normal');
    /* E9: the generator's last COMPLETED test and the next due, from the one schedule Emergency power reads (power.genSchedule);
       without it, the last test in the log that is not a due date */
    const gs = pw.genSchedule || (() => { const done = (pw.genTests || []).find(x => x.result !== 'overdue' && x.result !== 'due'), due = (pw.genTests || []).find(x => x.result === 'overdue' || x.result === 'due');
      return done ? { last: done.date, next: due ? due.date : null, overdueD: null } : null; })();
    const nOff = offCams.length + offDoors.length + panelsBad.length, ft0 = (f.tests || [])[0];
    const heroes = [hero(E, t('p2.h.off'), String(nOff), '', t('p2.h.offCap')),
      hero(E, t('p2.h.lastFire'), ft0 ? ft0.date : t('emptyDash'), '', ft0 ? t('p2.test.' + ft0.result) : t('p2.h.noTests')),
      hero(E, t('p2.h.lastGen'), gs ? gs.last : t('emptyDash'), '', gs ? (gs.overdueD ? t('p2.h.genNextOver', { n: gs.next, d: gs.overdueD }) : gs.next ? t('p2.h.genNext', { n: gs.next }) : '') : t('p2.h.noTests'))];
    const hl = window.EKO_OPS.headline(E, t(gs && gs.overdueD ? 'p2.h.hlOver' : 'p2.h.hl', { n: nOff, c: offCams.length, r: offDoors.length, p: panelsBad.length, l: gs ? gs.last : t('emptyDash'), d: gs ? gs.overdueD : 0, f: ft0 ? ft0.date : t('emptyDash') }), nOff || (gs && gs.overdueD) ? 'attn' : 'ok');
    const off = offCams.map(c => `<tr><th scope="row" class="tMonoS">${esc(c.id)}</th><td>${esc(t('p2.h.camera'))}</td><td>${esc(zoneName(E, c.zone))}</td><td>${esc(t('sec.cam.offline'))}</td></tr>`)
      .concat(panelsBad.map(p => `<tr><th scope="row" class="tMonoS">${esc(p.id)}</th><td>${esc(t('p2.h.panel'))}</td><td>${t('emptyDash')}</td><td>${esc(t('sec.panel.' + p.status))}</td></tr>`)).join('');
    const ft = (f.tests || []).map(x => `<tr><th scope="row" class="tMonoS">${esc(x.date)}</th><td>${esc(L(E, x.en, x.ar))}</td><td class="tMonoS">${x.devices}</td><td class="tMonoS">${x.failed}</td><td>${esc(t('p2.test.' + x.result))}</td></tr>`).join('');
    const gt = (pw.genTests || []).map(x => `<tr><th scope="row" class="tMonoS">${esc(x.date)}</th><td>${esc(L(E, x.type, x.typeAr))}</td><td class="tMonoS">${x.transferS != null ? x.transferS + ' s' : t('emptyDash')}</td><td>${esc(t('p2.test.' + x.result))}</td></tr>`).join('');
    const rp = (s.reports || []).map(r => `<tr><th scope="row">${esc(L(E, r.en, r.ar))}</th><td>${esc(t('p2.every.' + r.every))}</td><td class="tMonoS">${esc(r.next)}</td></tr>`).join('');
    /* E9: a headline; the tables in tabs (devices, tests, reports); the scheduled reports card only when reports are configured */
    const G = window.EKO_FRAME.group;
    return `<div class="pwarea secpage" data-pg="sec-health">${hl}<div class="pwhero" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>`
      + G('dev', t('p2.h.tab.dev'), widget(E, t('p2.h.offT'), t('p2.h.offTCap'), table(E, ['sec.c.device', 'p2.c.type', 'sec.c.zone', 'sec.c.state'], off, 'p2.h.offNone')))
      + G('tests', t('p2.h.tab.tests'), widget(E, t('p2.h.genT'), gs ? t('p2.h.genCap', { l: gs.last, n: gs.next || t('emptyDash') }) : '', table(E, ['p2.c.date', 'p2.c.test', 'p2.c.transfer', 'p2.c.result'], gt, 'p2.h.noTests')) + widget(E, t('p2.h.fireT'), '', table(E, ['p2.c.date', 'p2.c.test', 'sec.c.devices', 'p2.c.failed', 'p2.c.result'], ft, 'p2.h.noTests')))
      + ((s.reports || []).length ? G('rep', t('p2.h.tab.rep'), widget(E, t('p2.h.repT'), t('p2.h.repCap'), table(E, ['p2.c.report', 'p2.c.every', 'p2.c.next'], rp, 'p2.h.noReports'))) : '') + `</div>`;
  }

  /* D1. DATA HEALTH (online: data within 3 times the expected interval) */
  function dataPage(E){
    const t = E.t.bind(E);
    const dh = E.data.dataHealth || (() => { const ig = E.data.integrations || [], pts = ig.reduce((s, i) => s + (i.pointsTotal || 0), 0), stale = ig.reduce((s, i) => s + (i.pointsStale || 0), 0);
      return { points: pts, online: pts - stale, stale, flat: null, oor: null, never: null, integrations: ig.map(i => ({ name: i.name, state: /live/i.test(i.st) ? 'live' : 'degraded', lastMin: null, healthPct: pts ? (1 - (i.pointsStale || 0) / Math.max(1, i.pointsTotal || 1)) * 100 : null, log: null, hb: i.hb })) }; })();
    const band = p => p == null ? 'none' : p >= 75 ? 'green' : p >= 50 ? 'amber' : 'red';
    const heroes = [hero(E, t('p2.d.online'), dh.points ? fmt(dh.online / dh.points * 100, 1) : t('emptyDash'), dh.points ? '%' : '', t('p2.d.onlineCap', { a: fmt(dh.online, 0), b: fmt(dh.points, 0) })),
      hero(E, t('p2.d.stale'), dh.stale != null ? fmt(dh.stale, 0) : t('emptyDash'), '', t('p2.d.staleCap')),
      ...(dh.offline != null ? [hero(E, t('p2.d.offline'), fmt(dh.offline, 0), '', t('p2.d.offlineCap'))] : []),   /* E5: devices that do not answer (the engine's data states) */
      hero(E, t('p2.d.flat'), dh.flat != null ? fmt(dh.flat, 0) + ' · ' + fmt(dh.oor, 0) : t('emptyDash'), '', t('p2.d.flatCap')),
      hero(E, t('p2.d.never'), dh.never != null ? fmt(dh.never, 0) : t('emptyDash'), '', t('p2.d.neverCap'))];
    const rows = (dh.integrations || []).map(i => `<tr><th scope="row">${esc(i.name)}</th><td><span class="p2st" data-st="${i.state === 'live' ? 'armed' : i.state === 'offline' ? 'alarm' : 'ready'}">${esc(t('p2.d.st.' + i.state))}</span></td>
      <td class="tMonoS">${i.lastMin != null ? esc(E.fmtAge(i.lastMin / 60)) : esc(i.hb || t('emptyDash'))}</td><td><span class="p2band" data-b="${band(i.healthPct)}">${i.healthPct != null ? fmt(i.healthPct, 0) + '%' : t('emptyDash')}</span></td>
      <td>${i.log ? `<span class="p2log">${i.log.map(v => `<i data-b="${band(v * 100)}"></i>`).join('')}</span>` : ''}</td></tr>`).join('');
    return wrap('sys-data', heroes, widget(E, t('p2.d.intT'), t('p2.d.intCap'), table(E, ['p2.c.integration', 'sec.c.state', 'p2.c.last', 'p2.c.health', 'p2.c.log24'], rows)) + `<p class="tCap">${esc(t('p2.d.rule'))}</p>`);
  }

  /* D2. OTHER BUILDING SYSTEMS (equipment status only) */
  function otherPage(E){
    const t = E.t.bind(E), o = E.data.otherSystems, pw = sec(E).power || {};
    if(!o) return wrap('sys-other', [], `<p class="alempty">${esc(t('p2.none'))}</p>`);
    const tile = (k, head, body, go) => `<article class="pwwidget p2tile"><div class="pwwh"><span class="alcardt">${esc(t('p2.o.' + k))}</span>${go || ''}</div>${head ? `<p class="p2head">${head}</p>` : ''}${body}</article>`;
    const lifts = (o.lifts || []).map(l => `<tr><th scope="row">${esc(L(E, l.en, l.ar))}</th><td><span class="p2st" data-st="${l.state === 'in service' ? 'armed' : 'alarm'}">${esc(t('p2.o.lift.' + (l.state === 'in service' ? 'in' : 'out')))}</span></td><td class="tMonoS">${l.trips24h}</td><td class="tMonoS">${fmt(l.availPct, 1)}%</td></tr>`).join('');
    const gases = (o.gases || []).map(g => `<tr><th scope="row">${esc(L(E, g.en, g.ar))}</th><td><span class="p2st" data-st="${g.state === 'normal' ? 'armed' : 'alarm'}">${esc(t('p2.o.gas.' + g.state))}</span></td><td class="tCap">${esc(g.room)}</td></tr>`).join('');
    const w = o.water ? o.water.states.map(([k, v]) => `<span class="p2chip" data-on="${v ? 1 : 0}" data-k="${k}">${esc(t('p2.o.w.' + k))}</span>`).join('') : '';
    const ev = (o.ev || []).map(c => `<span class="p2chip" data-on="1" data-k="${c.state}">${esc(c.id)} · ${esc(t('p2.o.ev.' + c.state))}</span>`).join('');
    const g0 = (pw.generators || [])[0], u0 = (pw.ups || [])[0];
    return wrap('sys-other', [], `<div class="p2grid">
      ${tile('lifts', '', table(E, ['p2.c.unit', 'sec.c.state', 'p2.c.trips', 'p2.c.avail'], lifts))}
      ${tile('power', esc(g0 ? g0.id + ': ' + t('sec.run.' + (g0.run || 'standby')) : t('emptyDash')) + ' · ' + esc(u0 ? u0.id + ': ' + t('sec.bat.' + (u0.battery || 'float')) : ''), `<p class="tCap">${esc(t('p2.o.powerCap'))}</p>`, `<button class="statlink" data-act="secGo" data-v="sec-power" data-sub="power">${esc(t('sec.nav.power'))}</button>`)}
      ${tile('gas', '', table(E, ['p2.c.service', 'sec.c.state', 'sec.c.where'], gases))}
      ${o.water ? tile('water', esc(L(E, o.water.en, o.water.ar)) + ' · ' + esc(o.water.room), `<div class="p2chips">${w}</div><p class="tCap">${esc(t('p2.o.waterCap'))}</p>`) : ''}
      ${tile('ev', '', `<div class="p2chips">${ev}</div>`)}</div><p class="tCap">${esc(t('p2.o.foot'))}</p>`);
  }

  /* D3. SPACE AND OCCUPANCY (counts per room, never people) */
  function occPage(E){
    if(window.EKO_OCC && window.EKO_OCC.applies(E)) return window.EKO_OCC.page(E);   /* E10: dots by count and space use on the engine site */
    const t = E.t.bind(E), h = E.data.heat || {};
    const oc = E.data.occupancy || (() => { const z = (h.zones || []).filter(q => !q.kind && q.occ != null), now = z.reduce((s, q) => s + q.occ, 0);
      return { capacity: Math.round(now * 2.2), nowCount: now, peakToday: Math.round(now * 1.2), avg30Peak: Math.round(now * 1.12), carpet: null, rooms: z.map(q => ({ name: q.nameEn, nameAr: q.nameAr, cap: Math.max(2, Math.round(q.occ * 1.6)), occ: q.occ, co2: q.co2Ppm })) }; })();
    const util = oc.capacity ? oc.nowCount / oc.capacity * 100 : null;
    const heroes = [hero(E, t('p2.oc.now'), fmt(oc.nowCount, 0), '', t('p2.oc.nowCap', { c: fmt(oc.capacity, 0) })), hero(E, t('p2.oc.util'), util != null ? fmt(util, 0) : t('emptyDash'), util != null ? '%' : '', t('p2.oc.utilCap')),
      hero(E, t('p2.oc.peak'), fmt(oc.peakToday, 0), '', t('p2.oc.peakCap', { a: fmt(oc.avg30Peak, 0) }))];
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const carpet = oc.carpet ? `<table class="todm p2carpet"><tbody>${oc.carpet.map((r, i) => `<tr><td class="tCap">${esc(t('p2.day.' + days[i]))}</td>${r.map(v => `<td><span class="todc" style="background:color-mix(in srgb, var(--btnP) ${(v * 90).toFixed(0)}%, var(--s3))"></span></td>`).join('')}</tr>`).join('')}
      <tr><td></td>${Array.from({ length: 24 }, (_, i) => `<td class="tCap">${i % 6 === 0 ? String(i).padStart(2, '0') : ''}</td>`).join('')}</tr></tbody></table>` : `<p class="alempty">${esc(t('p2.oc.noCarpet'))}</p>`;
    const rooms = (oc.rooms || []).map(r => Object.assign({}, r, { u: r.cap ? r.occ / r.cap : 0 })).sort((a, b) => b.u - a.u);
    const rrow = r => `<tr><th scope="row">${esc(L(E, r.name, r.nameAr))}</th><td class="tMonoS">${r.occ} / ${r.cap}</td><td class="tMonoS">${fmt(r.u * 100, 0)}%</td></tr>`;
    const W = 300, H = 140, mxO = Math.max(1, ...rooms.map(r => r.occ)), withC = rooms.filter(r => r.co2 != null), loC = 400, hiC = Math.max(1100, ...withC.map(r => r.co2));
    const scatter = `<svg class="p2scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('p2.oc.scT'))}"><line x1="30" y1="${(H - 20 - (1000 - loC) / (hiC - loC) * (H - 30)).toFixed(1)}" x2="${W}" y2="${(H - 20 - (1000 - loC) / (hiC - loC) * (H - 30)).toFixed(1)}" class="p2ref"/>
      ${withC.map(r => `<circle cx="${(30 + r.occ / mxO * (W - 40)).toFixed(1)}" cy="${(H - 20 - (r.co2 - loC) / (hiC - loC) * (H - 30)).toFixed(1)}" r="4"><title>${esc(L(E, r.name, r.nameAr) + ' · ' + r.occ + ' · ' + r.co2 + ' ppm')}</title></circle>`).join('')}
      <text x="30" y="${H - 4}" class="nctick">${esc(t('p2.oc.axOcc'))}</text><text x="2" y="12" class="nctick">CO2</text></svg>`;
    return wrap('spaces-occ', heroes, `<div class="secgrid2">${widget(E, t('p2.oc.carpetT'), t('p2.oc.carpetCap'), carpet)}${widget(E, t('p2.oc.scT'), t('p2.oc.scCap'), scatter)}</div>
      <div class="secgrid2">${widget(E, t('p2.oc.bestT'), '', table(E, ['p2.c.room', 'p2.c.occCap', 'p2.c.util'], rooms.slice(0, 5).map(rrow).join('')))}${widget(E, t('p2.oc.worstT'), '', table(E, ['p2.c.room', 'p2.c.occCap', 'p2.c.util'], rooms.slice(-5).reverse().map(rrow).join('')))}</div>
      <p class="tCap">${esc(t('p2.oc.privacy'))}</p>`);
  }
  /* S4 coverage (Priority 2): doors with no camera within 15 m on the same level. A geometric estimate on the plan:
     no view direction and no walls are taken into account. */
  function coverage(E){
    const t = E.t.bind(E), s = sec(E), cams = (s.cameras || []).filter(c => c.x != null), doors = (s.doors || []).filter(d => d.x != null);
    if(!cams.length || !doors.length) return '';
    const m = (p, q) => Math.hypot((p.x - q.x) * 16.4, (p.y - q.y) * 12.6) / 7.115;   /* plan percent to metres (the medical plan's scale) */
    const out = doors.filter(d => !cams.some(c => c.storey === d.storey && c.online !== false && m(c, d) <= 15));
    return widget(E, t('p2.cov.T'), t('p2.cov.cap', { n: out.length, of: doors.length }), out.length ? table(E, ['sec.c.door', 'sec.c.zone', 'p2.c.level'], out.slice(0, 12).map(d => `<tr><th scope="row" class="tMonoS">${esc(d.id)}</th><td>${esc(zoneName(E, d.zone))}</td><td>${esc(d.storey)}</td></tr>`).join('')) : `<p class="alempty">${esc(t('p2.cov.none'))}</p>`, t('p2.cov.foot'));
  }
  /* E9: the headline sentence of each page that had none (js/shell/frame.js reads them), from the same figures as its tiles */
  const HL = {
    'sec-intr': E => { const t = E.t.bind(E), ir = sec(E).intrusion || {}, areas = ir.areas || [], al = new Set((ir.events || []).filter(e => e.active).map(e => e.zone)), st = q => al.has(q.zone) ? 'alarm' : q.state;
      const a = areas.filter(q => st(q) === 'armed').length, n = areas.length, al2 = areas.filter(q => st(q) === 'alarm').length, b = (ir.bypassed || []).length;
      return { text: t(al2 ? 'p2.in.hlAlarm' : 'p2.in.hl', { a, n, d: n - a - al2, b, x: al2 }), tone: al2 ? 'alarm' : b ? 'attn' : 'ok' }; },
    'sys-data': E => { const t = E.t.bind(E), dh = E.data.dataHealth; if(!dh || !dh.points) return null;
      const ig = dh.integrations || [], bad = ig.filter(i => i.state !== 'live');
      return { text: t(bad.length ? 'p2.d.hlBad' : 'p2.d.hl', { p: fmt(dh.online / dh.points * 100, 1), s: fmt(dh.stale || 0, 0), n: bad.length, l: bad.map(i => i.name).join(E.lang === 'ar' ? '، ' : ', ') }), tone: bad.length ? 'attn' : 'ok' }; },
    'sys-other': E => { const t = E.t.bind(E), o = E.data.otherSystems; if(!o) return null;
      const lo = (o.lifts || []).filter(l => l.state !== 'in service'), go = (o.gases || []).filter(g => g.state !== 'normal');
      return { text: t(lo.length || go.length ? 'p2.o.hlBad' : 'p2.o.hl', { l: lo.length, n: (o.lifts || []).length, g: go.length, m: (o.gases || []).length }), tone: lo.length || go.length ? 'attn' : 'ok' }; },
    'spaces-occ': E => { const t = E.t.bind(E), oc = E.data.occupancy; if(!oc || oc.nowCount == null) return null;
      return { text: t('p2.oc.hl', { n: fmt(oc.nowCount, 0), c: fmt(oc.capacity, 0), p: oc.capacity ? fmt(oc.nowCount / oc.capacity * 100, 0) : t('emptyDash'), k: fmt(oc.peakToday, 0), a: fmt(oc.avg30Peak, 0) }), tone: 'ok' }; }
  };
  setTimeout(() => { if(window.EKO_FRAME) Object.assign(window.EKO_FRAME.HEADLINES, HL); }, 0);
  return { intrPage, healthPage, dataPage, otherPage, occPage, coverage };
})();
