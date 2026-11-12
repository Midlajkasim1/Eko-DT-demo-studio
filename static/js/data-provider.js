(function () {
  'use strict';

  // A previous closure's pollers are unreachable once DashboardData is rebound
  if (window.DashboardData && typeof window.DashboardData.stop === 'function') {
    window.DashboardData.stop();
  }

  const EVENT_NAME = 'dashboard-data';

  function filled(value) {
    if (value == null || value === '') return false;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }

  function normalizeConfig(raw) {
    if (!raw) return null;
    const fin = raw.fin || raw;
    const polling = raw.polling || {};
    return {
      directMode: !!(fin.directMode || fin.direct_mode),
      liveMs: Number(fin.interval || fin.liveMs || polling.live_ms || raw.polling_interval) || 5000,
      realtimeMs: Number(fin.realtimeMs || polling.realtime_ms) || 30000,
      project: fin.project || fin.project_name || raw.project_name || '',
      displayName: raw.display_name || fin.displayName || '',
      livePoints: fin.livePoints || raw.live_point_ids || {},
      powerEndpoints: fin.endpoints || fin.powerEndpoints || raw.power_endpoints || {},
      workorderExpr: fin.workorderExpr || raw.workorder_expr || '',
      meterProfile: fin.meterProfile || raw.meter_profile || null,
      meterNames: Array.isArray(fin.meterNames) ? fin.meterNames : [],
      severityBands: fin.severityBands || raw.severity_bands || null,
      equipmentClasses: fin.equipmentClasses || raw.equipment_classes || null,
      realtimeEndpoints: fin.realtimeEndpoints || raw.realtime_endpoints || null,
      documents: Array.isArray(fin.documents) ? fin.documents
        : (Array.isArray(raw.documents) ? raw.documents
          : (raw.documents && Array.isArray(raw.documents.families) ? raw.documents.families : undefined)),
      // The Eko-DT project this dashboard shows. Only the Studio and the exported viewer know it.
      projectId: raw.projectId || '',
    };
  }

  function overlaySite(cfg, site) {
    if (!cfg || !site) return cfg;
    const next = { ...cfg, directMode: cfg.directMode };
    ['livePoints', 'powerEndpoints', 'workorderExpr', 'meterProfile', 'severityBands', 'equipmentClasses', 'realtimeEndpoints'].forEach((key) => {
      if (filled(site[key])) next[key] = site[key];
    });
    if (site.realtimeMs) next.realtimeMs = site.realtimeMs;
    if (!next.project && site.project) next.project = site.project;
    if (!Array.isArray(next.documents) && Array.isArray(site.documents)) next.documents = site.documents;
    return next;
  }

  async function readConfig(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      return normalizeConfig(await res.json());
    } catch (_) {
      return null;
    }
  }

  async function resolveConfig() {
    let cfg = window.INJECTED_PROJECT_CONFIG ? normalizeConfig(window.INJECTED_PROJECT_CONFIG) : null;
    if (!cfg) {
      cfg = await readConfig('api-config.json') || await readConfig('/api/fin/config');
    }
    if (cfg && cfg.directMode) {
      // The studio serves the audited backend file. A FIN-hosted zip already
      // carries the same maps on the injected config, and this fetch 404s.
      // A blank project still has to be filled from api-config.json, or the
      // reader calls /api//eval and @p::r: instead of /api/marsaAlArab/eval.
      const site = await readConfig('/backend/config.json');
      // config.json's maps are its own site's point IDs: never another (or an unnamed) project's
      if (site && cfg.project && site.project === cfg.project) cfg = overlaySite(cfg, site);
      if (!cfg.project || !filled(cfg.livePoints)) {
        const shipped = await readConfig('api-config.json');
        if (shipped) cfg = overlaySite(cfg, shipped);
      }
    }
    return cfg;
  }

  class BackendProvider {
    constructor(projectId) { this.projectId = projectId || ''; }
    async _json(url) {
      try {
        const res = await fetch(url);
        if (res.status === 401) return { unauthorized: true };
        if (!res.ok) return null;
        // The backend stamps data with the project it polled it for. Right after a project
        // switch it can still be serving the previous one: that answer is not this project's.
        const stamp = res.headers.get('X-Eko-Project');
        if (this.projectId && stamp !== null && decodeURIComponent(stamp) !== this.projectId) {
          return { otherProject: true };
        }
        return await res.json();
      } catch (_) {
        return null;
      }
    }
    getStatus() { return this._json('/api/fin/status'); }
    getLiveValues() { return this._json('/api/fin/power-live'); }
    getPowerHistory() { return this._json('/api/fin/power-history'); }
    getEquipment() { return this._json('/api/fin/equip-live'); }
    getAlarms() { return this._json('/api/fin/alarms'); }
    getDocuments() { return this._json('/api/fin/documents'); }
    getWorkOrders() { return this._json('/api/fin/workorders'); }
    async writePoint(pointId, action, value) {
      try {
        const res = await fetch('/api/fin/point-write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ point_id: pointId, action, value }),
        });
        const body = await res.json().catch(() => ({}));
        return res.ok ? { ok: true, data: body } : { ok: false, status: res.status, error: (body && body.detail) || `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, status: 0, error: e.message };
      }
    }
    getMeters() { return this._json('/api/fin/pmu-live'); }
    getHisPoints() { return this._json('/api/fin/his-points'); }
    getPointHistory(id, days) {
      return this._json(`/api/fin/point-history?id=${encodeURIComponent(id)}&days=${days || 7}`);
    }
    getAlarmHistory(days) { return this._json(`/api/fin/alarm-history?days=${days || 30}`); }
    async evalQuery(expr) {
      try {
        const res = await fetch('/api/fin/eval?expr=' + encodeURIComponent(expr));
        return res.ok ? await res.text() : null;
      } catch (_) {
        return null;
      }
    }
  }


  class DirectProvider {
    constructor(config) {
      this.fin = window.FinDirect ? window.FinDirect.session(config) : null;
    }
    _miss() { return this.fin ? null : Promise.resolve(null); }
    getStatus() { return this.fin ? this.fin.status() : Promise.resolve({ connected: false }); }
    getLiveValues() { return this.fin ? this.fin.live() : this._miss(); }
    getPowerHistory() { return this.fin ? this.fin.powerHistory() : this._miss(); }
    getEquipment() { return this.fin ? this.fin.equipment() : this._miss(); }
    getAlarms() { return this.fin ? this.fin.alarms() : this._miss(); }
    getDocuments() { return this.fin ? this.fin.documents() : this._miss(); }
    getWorkOrders() { return this.fin ? this.fin.workorders() : this._miss(); }
    getMeters() { return this.fin ? this.fin.meters() : this._miss(); }
    getHisPoints() { return this.fin ? this.fin.hisPoints() : this._miss(); }
    getPointHistory(id, days) { return this.fin ? this.fin.pointHistory(id, days) : this._miss(); }
    getAlarmHistory(days) { return this.fin ? this.fin.alarmHistory(days) : this._miss(); }
    evalQuery(expr) { return this.fin ? this.fin.evalQuery(expr) : this._miss(); }
  }

  const state = {
    config: null,
    provider: null,
    connected: false,
    power: null,
    powerHistory: null,
    historyUnits: null,
    equipment: null,
    alarms: null,
    meters: null,
    documents: null,
    workorders: null,
    alarmHistory: null,
    timers: [],
    generation: 0,
  };

  function emit(type, data) {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { type, data } }));
  }

  function setConnected(ok) {
    if (state.connected === ok) return;
    state.connected = ok;
    emit('status', { connected: ok });
  }

  function usable(data) {
    return !!data && !data.unauthorized && !data.otherProject;
  }

  // While the backend is still on another project, ask again soon rather than at the next
  // 30 s realtime tick, so the project's own equipment and alarms follow the switch quickly
  let catchUp = null;
  function retrySoon(generation) {
    if (catchUp) return;
    catchUp = setTimeout(function () {
      catchUp = null;
      if (generation === state.generation) pollRealtime();
    }, 2000);
  }

  // Consumers read power_history off the live payload, so it is spliced back in
  // here rather than re-sent with every 5 s poll
  function withHistory(live) {
    if (!state.powerHistory) return live;
    var units = Object.assign({}, live && live.units, state.historyUnits);
    return Object.assign({}, live, { power_history: state.powerHistory, units: units });
  }

  // Every poll checks, after its await, that this poller was not stopped meanwhile: a stopped
  // poller (the previous project's dashboard) must not hand its late answers to the next one.
  let liveBusy = false;
  let alarmBusy = false;
  let slowBusy = false;
  let cachedBusy = false;

  async function pollLive() {
    if (liveBusy) return;
    liveBusy = true;
    const generation = state.generation;
    try {
      const data = await state.provider.getLiveValues();
      if (generation !== state.generation) return;
      if (data && data.otherProject) { retrySoon(generation); return; }
      if (usable(data) && data.timestamp) {
        state.power = withHistory(data);
        emit('power', state.power);
      }
      setConnected(usable(data));
    } finally {
      liveBusy = false;
    }
  }

  async function pollAlarms() {
    if (alarmBusy) return;
    alarmBusy = true;
    const generation = state.generation;
    try {
      const alarms = await state.provider.getAlarms();
      if (generation !== state.generation) return;
      if (alarms && alarms.otherProject) { retrySoon(generation); return; }
      if (usable(alarms) && alarms.timestamp) { state.alarms = alarms; emit('alarms', alarms); }
    } finally {
      alarmBusy = false;
    }
  }

  function takeOne(generation, data, apply) {
    if (generation !== state.generation) return;
    if (data && data.otherProject) { retrySoon(generation); return; }
    if (usable(data)) apply(data);
  }

  // Names and markers first. pointsReady stays false until the points grid is joined, and this
  // poll is not held behind history, so the page can ask again as soon as the readings land.
  let equipBusy = false;
  async function pollEquipment() {
    if (equipBusy) return;
    equipBusy = true;
    const generation = state.generation;
    try {
      const data = await state.provider.getEquipment();
      takeOne(generation, data, function (equipment) {
        if (!equipment.timestamp && state.equipment) return;
        state.equipment = equipment;
        emit('equipment', equipment);
      });
    } finally {
      equipBusy = false;
    }
  }

  function equipmentSettled() {
    return !!(state.equipment && state.equipment.timestamp && state.equipment.pointsReady !== false);
  }

  // The backend's cached reads; alarm history is a FIN query on every call, so it waits for the slower cycle
  async function pollCached() {
    if (cachedBusy) return;
    cachedBusy = true;
    const generation = state.generation;
    const provider = state.provider;
    const jobs = [
      provider.getMeters().then(function (data) {
        takeOne(generation, data, function (meters) { state.meters = meters; emit('meters', meters); });
      }),
      provider.getPowerHistory().then(function (history) {
        takeOne(generation, history, function (data) {
          if (!data || !Object.keys(data).filter(function (k) { return k !== '_units'; }).length) return;
          state.historyUnits = data._units || null;
          var series = Object.assign({}, data);
          delete series._units;
          state.powerHistory = series;
          if (state.power) {
            state.power = withHistory(state.power);
            emit('power', state.power);
          }
        });
      }),
      provider.getWorkOrders().then(function (data) {
        takeOne(generation, data, function (workorders) { state.workorders = workorders; emit('workorders', workorders); });
      }),
    ];
    try {
      await Promise.all(jobs);
    } finally {
      cachedBusy = false;
    }
  }

  async function pollRealtime() {
    await Promise.all([pollCached(), pollSlow(), pollEquipment()]);
  }

  async function pollSlow() {
    if (slowBusy) return;
    slowBusy = true;
    const generation = state.generation;
    const provider = state.provider;
    const jobs = [
      provider.getDocuments().then(function (data) {
        takeOne(generation, data, function (documents) { state.documents = documents; emit('documents', documents); });
      }),
      provider.getAlarmHistory(2).then(function (data) {
        takeOne(generation, data, function (alarmHistory) { state.alarmHistory = alarmHistory; emit('alarmHistory', alarmHistory); });
      }),
    ];
    try {
      await Promise.all(jobs);
    } finally {
      slowBusy = false;
    }
  }

  let firstFill = null;
  function armFirstFill(generation) {
    if (firstFill) clearInterval(firstFill);
    let tries = 0;
    // A backend that just started or switched project needs FIN's first full pass; direct mode reads FIN on each try
    const maxTries = state.config && state.config.directMode ? 12 : 90;
    firstFill = setInterval(function () {
      if (generation !== state.generation || ++tries > maxTries) {
        clearInterval(firstFill);
        firstFill = null;
        return;
      }
      const ready = state.power && state.power.timestamp && state.alarms && state.alarms.timestamp
        && equipmentSettled() && state.powerHistory;
      if (ready) {
        clearInterval(firstFill);
        firstFill = null;
        return;
      }
      if (!state.power || !state.power.timestamp) pollLive();
      if (!state.alarms || !state.alarms.timestamp) pollAlarms();
      if (!equipmentSettled()) pollEquipment();
      if (!state.powerHistory) pollCached();
    }, 1000);
  }

  // The backend polls FIN only while a dashboard holds this id. A closed tab stops
  // refreshing it, and the loops end on their own after the hold goes stale.
  let watchId = null;
  let watchTimer = null;

  function postWatch(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      keepalive: true,
    }).catch(function () { return null; });
  }

  async function beatWatch() {
    const res = await postWatch('/api/fin/watch', watchId ? { id: watchId } : {});
    if (!res || !res.ok) return;
    try {
      const data = await res.json();
      if (data && data.id) watchId = data.id;
    } catch (_) {}
  }

  function onPageHide() { releaseWatch(); }

  function holdWatch() {
    if (watchTimer) return;
    watchTimer = setInterval(beatWatch, 5000);
    window.addEventListener('pagehide', onPageHide);
  }

  function releaseWatch() {
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    window.removeEventListener('pagehide', onPageHide);
    const id = watchId;
    watchId = null;
    if (id) postWatch('/api/fin/unwatch', { id: id });
  }

  async function start() {
    stop();
    const generation = state.generation;
    state.config = await resolveConfig();
    if (generation !== state.generation) return;
    state.provider = state.config && state.config.directMode ? new DirectProvider(state.config) : new BackendProvider(state.config && state.config.projectId);
    // The watch is what starts the FIN reads. Wait for it so the first equipment and alarm
    // requests find those reads already running and can be held until the lists are filled.
    await beatWatch();
    if (generation !== state.generation) return;
    holdWatch();
    armFirstFill(generation);
    await Promise.all([pollRealtime(), pollLive(), pollAlarms()]);
    // stop() during either await would otherwise be undone by the timers below
    if (generation !== state.generation) return;
    state.timers.push(setInterval(pollLive, state.config ? state.config.liveMs : 5000));
    state.timers.push(setInterval(pollAlarms, 15000));
    state.timers.push(setInterval(pollRealtime, state.config ? state.config.realtimeMs : 30000));
  }

  function stop() {
    state.generation++;
    state.timers.forEach(clearInterval);
    state.timers = [];
    state.historyUnits = null;
    if (firstFill) { clearInterval(firstFill); firstFill = null; }
    if (catchUp) { clearTimeout(catchUp); catchUp = null; }
    releaseWatch();
  }

  window.DashboardData = {
    start,
    stop,
    evalQuery(expr) { return state.provider ? state.provider.evalQuery(expr) : Promise.resolve(null); },
    getHisPoints() { return state.provider ? state.provider.getHisPoints() : Promise.resolve(null); },
    getPointHistory(id, days) { return state.provider ? state.provider.getPointHistory(id, days) : Promise.resolve(null); },
    getAlarmHistory(days) { return state.provider ? state.provider.getAlarmHistory(days) : Promise.resolve(null); },
    writePoint(pointId, action, value) {
      return state.provider && state.provider.writePoint
        ? state.provider.writePoint(pointId, action, value)
        : Promise.resolve({ ok: false, status: 0, error: 'Changing equipment needs the EKO backend.' });
    },
    get config() { return state.config; },
    get connected() { return state.connected; },
    get power() { return state.power; },
    get equipment() { return state.equipment; },
    get alarms() { return state.alarms; },
    get meters() { return state.meters; },
    get documents() { return state.documents; },
    get workorders() { return state.workorders; },
    get alarmHistory() { return state.alarmHistory; },
  };

  start();
})();
