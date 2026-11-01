/* ============================================================================
   OCCUPANCY BY COUNT AND SPACE USE (E10, Spaces > Occupancy, the Demo Medical
   Centre). Each room shows one dot per person counted, placed inside the room's
   floor outline from the model (spaceGeo.rooms), never across a wall. The place
   of a dot inside its room is illustrative: dot k of a room always sits at the
   same seeded spot, so a dot comes or goes when the count changes and the rest
   move only gently (a small drift by the hour). No individual is tracked.
   The counts are the building data engine's room counts (demo). The model's
   motion detectors say occupied or not, never a count: in production the
   counts come from people counting sensors, or from access control or Wi-Fi.
   A time scrubber runs over today by the hour. The Space use tab gives, for
   each room and department over the last 7 days, the hours used against the
   hours open and the peak count against the room's configured capacity, and
   lists the rooms under the configured use threshold.
   ============================================================================ */
window.EKO_OCC = (function(){
  'use strict';
  const C = () => window.EKO_C, A = () => window.EKO_A, O = () => window.EKO_OPS;
  const esc = s => C().esc(s), fmt = (v, d) => C().fmt(v, d);
  const HOUR = 36e5, DAY = 864e5;
  const V = x => (x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'note' in x) ? x.v : x;
  const applies = E => !!(E.sim && E.data.spaceGeo && (E.data.spaceGeo.rooms || []).length);
  const rooms = E => E.data.spaceGeo.rooms;
  const h32 = s => { let h = 2166136261; for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const inPoly = (x, y, p) => { let c = false; for(let i = 0, j = p.length - 1; i < p.length; j = i++){ if(((p[i][1] > y) !== (p[j][1] > y)) && (x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0])) c = !c; } return c; };
  const bbox = p => { const xs = p.map(q => q[0]), ys = p.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const centroid = p => { let a = 0, x = 0, y = 0; p.forEach((q, i) => { const r = p[(i + 1) % p.length], c = q[0] * r[1] - r[0] * q[1]; a += c; x += (q[0] + r[0]) * c; y += (q[1] + r[1]) * c; }); return a ? [x / (3 * a), y / (3 * a)] : p[0]; };
  /* a dot's place: seeded inside the outline, a margin from every wall (the dot's own radius around it stays inside) */
  const M = 0.12;   /* percent of the scene, about 0.15 m */
  const inside = (x, y, p) => inPoly(x, y, p) && inPoly(x + M, y, p) && inPoly(x - M, y, p) && inPoly(x, y + M, p) && inPoly(x, y - M, p);
  const spotCache = new Map();
  function spot(r, k){
    const key = r.gid + '|' + k; if(spotCache.has(key)) return spotCache.get(key);
    const b = r._bb || (r._bb = bbox(r.poly)); let pt = null;
    for(let i = 0; i < 60 && !pt; i++){ const x = b[0] + (b[2] - b[0]) * h32(key + 'x' + i), y = b[1] + (b[3] - b[1]) * h32(key + 'y' + i); if(inside(x, y, r.poly)) pt = [x, y]; }
    if(!pt){ const c = centroid(r.poly); pt = inPoly(c[0], c[1], r.poly) ? c : null; }
    spotCache.set(key, pt); return pt;
  }
  /* the hour's drift: a small seeded step from the spot, kept only if it stays inside */
  const drift = (r, k, h, pt) => { const dx = (h32(r.gid + k + 'dx' + h) - 0.5) * 0.5, dy = (h32(r.gid + k + 'dy' + h) - 0.5) * 0.5; return inside(pt[0] + dx, pt[1] + dy, r.poly) ? [pt[0] + dx, pt[1] + dy] : pt; };

  /* the engine's count in a room at a time (the same function the evacuation reads for the people on site) */
  const sp = r => ({ gid: r.gid, name: r.en, area: r.area, storey: r.level });
  const countAt = (E, r, ms) => E.sim.room(sp(r), ms).occ;
  /* the counts of every room at an hour of today, cached for the load day */
  const hourCache = new Map();
  /* E11: the counts are the engine's head count (E.sim.headcount), the one people count the Overview, Evacuation, the Brief, Ask EKO and the reports read */
  const countsAt = (E, h) => { const k = E.sim.today0 + '|' + h; if(!hourCache.has(k)){ if(hourCache.size > 60) hourCache.clear(); hourCache.set(k, new Map(E.sim.headcount(E.sim.today0 + h * HOUR + HOUR / 2).rooms.map(r => [r.gid, r.n]))); } return hourCache.get(k); };
  const typeOf = (E, r) => E.sim.typeOf(r.en);
  const capacity = (E, r) => E.sim.roomCapacity(sp(r));   /* E11: the one capacity definition (space.capacityPerM2) */
  const hourMs = (E, h) => E.sim.today0 + h * HOUR + HOUR / 2;
  const hourNow = E => Math.floor((E.sim.now - E.sim.today0) / HOUR);
  const hourOf = E => E.state.occHour != null ? E.state.occHour : hourNow(E);
  const lvOf = E => E.state.occLv || 'L1';
  /* E11: "Waiting, Haemodialysis Satellite Unit (05-C.004)": the model's own words for the room (a fragment such as "seats" or "seat" reads as its
     type, Waiting), its department, and the room's code (the model's space is a part of that room, so the code stops at the room: 05-C.004) */
  const FRAG = /^(seats?|seat|play area|alcove|workstations?)\b/i;
  const roomName = (E, r) => { const m = /^(.*?)\s+((\d\d-[A-Z]\.\d+)(?:\.[\d.]+)?|\d+(?:\.\d+)*)$/.exec(r.en || ''), words = m ? m[1] : (r.en || ''), code = m ? (m[3] || m[2]) : '';
    const ty = typeOf(E, r), what = FRAG.test(words) && (ty === 'wait' || /seat/i.test(words)) ? E.t('occ.type.wait') : words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
    return what + ', ' + deptName(E, r.dept) + (code ? ' (' + code + ')' : ''); };
  const deptName = (E, z) => { const q = ((E.data.security || {}).zones || []).find(x => x.id === z); return q ? (E.lang === 'ar' ? q.ar || q.en : q.en) : z; };

  /* the last 7 days, hour by hour: hours open, hours used, the peak count, per room (cached for the load day) */
  let useCache = null;
  function use(E){
    const key = E.sim.today0; if(useCache && useCache.key === key) return useCache.v;
    const R = rooms(E), used = V(E.sim.cfg.space.usedFromCount), v = new Map();
    R.forEach(r => v.set(r.gid, { open: 0, used: 0, peak: 0 }));
    for(let dd = 7; dd >= 1; dd--) for(let h = 0; h < 24; h++){ const ms = E.sim.today0 - dd * DAY + h * HOUR + HOUR / 2; if(!E.sim.isOpen(ms)) continue;
      R.forEach(r => { const u = v.get(r.gid), n = countAt(E, r, ms); u.open++; if(n >= used) u.used++; if(n > u.peak) u.peak = n; }); }
    useCache = { key, v }; return v;
  }

  function page(E){
    const t = E.t.bind(E), R = rooms(E), h = hourOf(E), ms = hourMs(E, h), lv = lvOf(E), G = window.EKO_FRAME.group;
    const counts = countsAt(E, h), total = [...counts.values()].reduce((s, n) => s + n, 0);
    const onLv = R.filter(r => r.level === lv), busiest = R.filter(r => typeOf(E, r) !== 'circ').sort((a, b) => counts.get(b.gid) - counts.get(a.gid))[0], inUse = R.filter(r => counts.get(r.gid) > 0).length;
    const cap = R.reduce((s, r) => s + capacity(E, r), 0), open = E.sim.isOpen(ms);
    let peakH = 0, peakN = 0; for(let q = 0; q <= Math.min(23, hourNow(E)); q++){ const cq = countsAt(E, q), n = R.reduce((s2, r) => s2 + cq.get(r.gid), 0); if(n > peakN){ peakN = n; peakH = q; } }
    const hh = q => String(q).padStart(2, '0') + ':00';
    const hl = O().headline(E, total ? t('occ.hl2', { n: total, h: hh(h), r: busiest ? roomName(E, busiest) : '', c: busiest ? counts.get(busiest.gid) : 0, u: inUse, all: R.length }) : t('occ.hlEmpty', { h: hh(h) }), 'ok');
    const heroes = [O().hero(E, t('occ.k.now', { h: hh(h) }), fmt(total, 0), '', t('occ.k.nowCap')), O().hero(E, t('occ.k.cap'), fmt(cap ? total / cap * 100 : 0, 0), '%', t('occ.k.capCap', { c: fmt(cap, 0) })),
      O().hero(E, t('occ.k.peak'), fmt(peakN, 0), '', t('occ.k.peakCap', { h: hh(peakH) })), O().hero(E, t('occ.k.rooms'), fmt(inUse, 0), '', t('occ.k.roomsCap', { n: R.length }))];
    /* the plan: the level's rooms, each with its dots; the count on hover, and written in the room when zoomed in */
    const zoom = E.state.occZoom || 1, cv = ((E.data.security || {}).coverage || {}), lb = (cv.levelBox || {})[lv];
    let box = lb ? lb.slice() : null;
    if(box && zoom > 1){ const fc = E.state.occFocus || [box[0] + box[2] / 2, box[1] + box[3] / 2], w = box[2] / zoom, hgt = box[3] / zoom; box = [Math.max(lb[0], Math.min(lb[0] + lb[2] - w, fc[0] - w / 2)), Math.max(lb[1], Math.min(lb[1] + lb[3] - hgt, fc[1] - hgt / 2)), w, hgt]; }
    const SW = cv.sceneW || 1640, SH = cv.sceneH || 1260, X = v => (v / 100 * SW).toFixed(1), Y = v => (v / 100 * SH).toFixed(1), rDot = (lb ? lb[2] : 45) / 100 * SW / 150 / Math.sqrt(zoom);   /* E11: larger at the fitted zoom (was / 230) */
    const maxN = Math.max(1, ...onLv.map(r => counts.get(r.gid)));
    const SP = window.EKO_SECP, plan = SP && SP.levelPlan && box ? SP.levelPlan(E, lv, () => {
      const polys = onLv.map(r => { const n = counts.get(r.gid); return `<polygon class="occroom" data-n="${n ? 1 : 0}" style="--k:${(n / maxN).toFixed(2)}" points="${r.poly.map(q => X(q[0]) + ',' + Y(q[1])).join(' ')}" data-act="occRoom" data-v="${esc(r.gid)}"><title>${esc(roomName(E, r) + ': ' + t('occ.tip', { n }))}</title></polygon>`; }).join('');
      const dots = onLv.map(r => { const n = counts.get(r.gid), out = []; for(let k = 0; k < n; k++){ const p0 = spot(r, k); if(!p0) continue; const p = drift(r, k, h, p0); out.push(`<circle class="occdot" data-key="${esc(r.gid)}-${k}" r="${rDot.toFixed(1)}" style="cx:${X(p[0])}px;cy:${Y(p[1])}px"></circle>`); } return out.join(''); }).join('');
      const labels = zoom > 1 ? onLv.filter(r => counts.get(r.gid) > 0).map(r => { const c = centroid(r.poly); return `<text class="occn" x="${X(c[0])}" y="${Y(c[1])}" style="font-size:${(rDot * 5 / zoom).toFixed(1)}px">${counts.get(r.gid)}</text>`; }).join('') : '';
      return polys + dots + labels; }, t('occ.planAria', { l: lv }), box) : '';
    const lvs = [...new Set(R.map(r => r.level))].sort();
    const seg = (act, v, lbl, on) => `<button class="seg" data-act="${act}" data-v="${esc(v)}" data-on="${on}" aria-pressed="${on}">${esc(lbl)}</button>`;
    const ctl = `<div class="row gap8 occctl" data-frame="top"><div class="segbox row" role="group" aria-label="${esc(t('occ.level'))}">${lvs.map(l => seg('occLv', l, t('lvlName', { n: l.slice(1) }), l === lv)).join('')}</div>
      <button class="btnG btnSm" data-act="occPlay" aria-pressed="${!!playing}">${esc(t(playing ? 'occ.pause' : 'occ.play'))}</button>
      <label class="occscrub"><span class="tLbl">${esc(t('occ.hour'))}</span><input type="range" min="0" max="23" step="1" value="${h}" data-chg="occHour" aria-label="${esc(t('occ.hourAria'))}"><b class="tMonoS">${hh(h)}</b></label>
      <span class="tCap">${esc(open ? t('occ.open') : t('occ.closed'))}</span><span class="grow"></span>
      <span class="pwchip" tabindex="0" data-tip="${esc(t('how.spaces-occ.s'))}">${esc(t('occ.counts'))}</span>
      <button class="iconbtn icon26" data-act="occZoom" data-v="-1" aria-label="${esc(t('occ.zoomOut'))}" ${zoom <= 1 ? 'disabled' : ''}>−</button><button class="iconbtn icon26" data-act="occZoom" data-v="1" aria-label="${esc(t('occ.zoomIn'))}" ${zoom >= 4 ? 'disabled' : ''}>+</button></div>`;
    const visual = `<div data-frame="visual">${A().widget(E, t('occ.planT', { l: t('lvlName', { n: lv.slice(1) }), h: hh(h) }), t('occ.legend'), plan)}</div>`;   /* the truth line heads the Rooms now tab, so the plan fills the card */
    /* the rooms at this hour */
    const circ = R.filter(r => typeOf(E, r) === 'circ'), cN = circ.reduce((s2, r) => s2 + counts.get(r.gid), 0), cCap = circ.reduce((s2, r) => s2 + capacity(E, r), 0);
    const rRows = R.filter(r => counts.get(r.gid) > 0 && typeOf(E, r) !== 'circ').sort((a, b) => counts.get(b.gid) - counts.get(a.gid)).slice(0, 60).map(r => `<tr data-act="occLocate" data-v="${esc(r.gid)}" data-st="${esc(r.level)}" tabindex="0"><th scope="row">${esc(roomName(E, r))}</th><td>${esc(r.level)}</td><td class="tMonoS">${counts.get(r.gid)}</td><td class="tMonoS">${capacity(E, r)}</td></tr>`).join('')
      + (circ.length ? `<tr class="occcirc"><th scope="row">${esc(t('occ.circRow', { n: circ.length }))}</th><td>${esc(t('occ.allLevels'))}</td><td class="tMonoS">${cN}</td><td class="tMonoS">${cCap}</td></tr>` : '');
    const roomsW = A().widget(E, t('occ.roomsT', { h: hh(h) }), t('occ.roomsCap'), O().table(E, ['occ.c.room', 'occ.c.level', 'occ.c.count', 'occ.c.cap'], rRows, 'occ.none'));
    /* space use, the last 7 days */
    const U = use(E), thr = V(E.sim.cfg.space.underUsePct), pct = u => u.open ? u.used / u.open * 100 : 0;
    const depts = {}; R.forEach(r => { const u = U.get(r.gid), d = depts[r.dept] || (depts[r.dept] = { open: 0, used: 0, peak: 0, cap: 0, n: 0 }); d.open += u.open; d.used += u.used; d.peak += u.peak; d.cap += capacity(E, r); d.n++; });
    const dRows = Object.keys(depts).sort((a, b) => pct(depts[a]) - pct(depts[b])).map(z => { const d = depts[z]; return `<tr><th scope="row">${esc(deptName(E, z))}</th><td class="tMonoS">${d.n}</td><td class="tMonoS">${fmt(pct(d), 0)}%</td><td class="tMonoS">${d.peak} / ${d.cap}</td></tr>`; }).join('');
    const under = R.map(r => ({ r, u: U.get(r.gid) })).filter(x => x.u.open && pct(x.u) < thr && typeOf(E, x.r) !== 'circ' && typeOf(E, x.r) !== 'plant' && typeOf(E, x.r) !== 'store').sort((a, b) => pct(a.u) - pct(b.u));
    const roomRow = x => `<tr data-act="occLocate" data-v="${esc(x.r.gid)}" data-st="${esc(x.r.level)}" tabindex="0"><th scope="row">${esc(roomName(E, x.r))}</th><td>${esc(deptName(E, x.r.dept))}</td><td class="tMonoS">${x.u.used} / ${x.u.open}</td><td class="tMonoS">${fmt(pct(x.u), 0)}%</td><td class="tMonoS">${x.u.peak} / ${capacity(E, x.r)}</td></tr>`;
    const allRooms = R.filter(r => !['circ', 'plant', 'store'].includes(typeOf(E, r))).map(r => ({ r, u: U.get(r.gid) })).sort((a, b) => pct(b.u) - pct(a.u));
    const useW = `<p class="occpersona">${esc(t('occ.persona'))}</p>`
      + A().widget(E, t('occ.deptT'), t('occ.deptCap'), O().table(E, ['occ.c.dept', 'occ.c.rooms', 'occ.c.use', 'occ.c.peakCap'], dRows))
      + A().widget(E, t('occ.underT'), t('occ.under', { p: thr, n: under.length }), O().table(E, ['occ.c.room', 'occ.c.dept', 'occ.c.hours', 'occ.c.use', 'occ.c.peakCap'], under.slice(0, 40).map(roomRow).join(''), 'occ.underNone'), t('occ.useFoot'))
      + A().widget(E, t('occ.allT'), t('occ.allCap'), O().table(E, ['occ.c.room', 'occ.c.dept', 'occ.c.hours', 'occ.c.use', 'occ.c.peakCap'], allRooms.slice(0, 80).map(roomRow).join('')));
    /* the day by the hour: the site's count */
    const byH = []; for(let q = 0; q < 24; q++){ const cq = countsAt(E, q); byH.push(R.reduce((s2, r) => s2 + cq.get(r.gid), 0)); } const mx = Math.max(1, ...byH), Wd = 520, Hd = 120, bw = Wd / 24;
    const day = `<svg class="nchours" viewBox="0 0 ${Wd} ${Hd}" role="img" aria-label="${esc(t('occ.dayAria'))}">${byH.map((n, q) => `<rect x="${(q * bw + 2).toFixed(1)}" y="${(Hd - 18 - n / mx * (Hd - 26)).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(n / mx * (Hd - 26)).toFixed(1)}" class="ncbar" data-on="${q === h ? 1 : 0}" data-act="occHourSet" data-v="${q}"><title>${esc(hh(q) + ': ' + n)}</title></rect><text x="${(q * bw + bw / 2).toFixed(1)}" y="${Hd - 4}" text-anchor="middle" class="nctick">${q % 3 ? '' : String(q).padStart(2, '0')}</text>`).join('')}</svg>`;
    const dayW = A().widget(E, t('occ.dayT'), t('occ.dayCap'), day);
    return `<div class="pwarea secpage occpage" data-pg="spaces-occ">${hl}<div class="pwhero evxstrip" style="grid-template-columns:repeat(${heroes.length},1fr)">${heroes.join('')}</div>${ctl}${visual}`
      + G('rooms', t('occ.tab.rooms'), `<p class="tCap occtruth">${esc(t('occ.truth'))}</p>` + roomsW) + G('use', t('occ.tab.use'), useW) + G('day', t('occ.tab.day'), dayW) + `</div>`;
  }

  /* the scrubber plays the clinic day: one hour a second */
  let playing = null;
  const ACTS = {
    occLv(el){ window.EKO.set({ occLv: el.dataset.v, occFocus: null }); },
    occHourSet(el){ window.EKO.set({ occHour: +el.dataset.v }); },
    occZoom(el){ const E = window.EKO; E.set({ occZoom: Math.max(1, Math.min(4, (E.state.occZoom || 1) * (+el.dataset.v > 0 ? 2 : 0.5))) }); },
    occRoom(el){ const E = window.EKO, r = rooms(E).find(q => q.gid === el.dataset.v); if(!r) return; const c = centroid(r.poly); E.set({ occFocus: c, occZoom: Math.max(2, E.state.occZoom || 1) }); },
    occPlay(){ const E = window.EKO; if(playing){ clearInterval(playing); playing = null; E.set({}); return; }
      let h = hourOf(E) >= 21 ? 6 : hourOf(E); E.set({ occHour: h });
      playing = setInterval(() => { const E2 = window.EKO; if(E2.state.pageId !== 'spaces-occ'){ clearInterval(playing); playing = null; return; } h = h >= 22 ? 6 : h + 1; E2.set({ occHour: h }); }, 1000); },
    /* a room on the model: the Spaces view with the room's level isolated, the camera on the room */
    occLocate(el){ const E = window.EKO, d = el.dataset; if(E.state.dock) E.state.dock.level = d.st; E.go('spaces', 'spaces', null);
      let n = 0; const go = () => { const eng = E.engine; if(!(eng && eng.ready && eng.ready())){ if(n++ < 60) setTimeout(go, 100); return; } if(eng.flyToGid){ eng.flyToGid(d.v); if(eng.highlightGid) eng.highlightGid(d.v); } }; setTimeout(go, 60); }
  };
  const CHG = { occHour(el){ window.EKO.set({ occHour: +el.value }); } };
  /* E13: the rooms to review (under the threshold of use over 7 days), as the Space use tab counts them; the persona headlines read it */
  function underUse(E){ const R = rooms(E), U = use(E), thr = V(E.sim.cfg.space.underUsePct), pct = u => u.open ? u.used / u.open * 100 : 0;
    return { thr, n: R.filter(r => { const u = U.get(r.gid), ty = typeOf(E, r); return u.open && pct(u) < thr && ty !== 'circ' && ty !== 'plant' && ty !== 'store'; }).length }; }
  return { applies, page, use, underUse, ACTS, CHG, countAt, spot };
})();
