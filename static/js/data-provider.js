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
      severityBands: fin.severityBands || raw.severity_bands || null,
      equipmentClasses: fin.equipmentClasses || raw.equipment_classes || null,
      realtimeEndpoints: fin.realtimeEndpoints || raw.realtime_endpoints || null,
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
    return state.powerHistory ? { ...live, power_history: state.powerHistory } : live;
  }

  // Every poll checks, after its await, that this poller was not stopped meanwhile: a stopped
  // poller (the previous project's dashboard) must not hand its late answers to the next one.
  async function pollLive() {
    const generation = state.generation;
    const data = await state.provider.getLiveValues();
    if (generation !== state.generation) return;
    if (data && data.otherProject) { retrySoon(generation); return; }
    if (usable(data)) {
      state.power = withHistory(data);
      emit('power', state.power);
    }
    setConnected(usable(data));
  }

  async function pollRealtime() {
    const generation = state.generation;
    const [equipment, alarms, meters, history, documents, workorders, alarmHistory] = await Promise.all([
      state.provider.getEquipment(),
      state.provider.getAlarms(),
      state.provider.getMeters(),
      state.provider.getPowerHistory(),
      state.provider.getDocuments(),
      state.provider.getWorkOrders(),
      state.provider.getAlarmHistory(2),
    ]);
    if (generation !== state.generation) return;
    if ([equipment, alarms, meters, history, documents, workorders, alarmHistory].some(function (d) { return d && d.otherProject; })) retrySoon(generation);
    if (usable(history)) {
      state.powerHistory = history;
      if (state.power) {
        state.power = withHistory(state.power);
        emit('power', state.power);
      }
    }
    if (usable(equipment)) { state.equipment = equipment; emit('equipment', equipment); }
    if (usable(alarms)) { state.alarms = alarms; emit('alarms', alarms); }
    if (usable(meters)) { state.meters = meters; emit('meters', meters); }
    if (usable(documents)) { state.documents = documents; emit('documents', documents); }
    if (usable(workorders)) { state.workorders = workorders; emit('workorders', workorders); }
    if (usable(alarmHistory)) { state.alarmHistory = alarmHistory; emit('alarmHistory', alarmHistory); }
  }

  async function start() {
    stop();
    const generation = state.generation;
    state.config = await resolveConfig();
    if (generation !== state.generation) return;
    state.provider = state.config && state.config.directMode ? new DirectProvider(state.config) : new BackendProvider(state.config && state.config.projectId);
    await Promise.all([pollRealtime(), pollLive()]);
    // stop() during either await would otherwise be undone by the timers below
    if (generation !== state.generation) return;
    state.timers.push(setInterval(pollLive, state.config ? state.config.liveMs : 5000));
    state.timers.push(setInterval(pollRealtime, state.config ? state.config.realtimeMs : 30000));
  }

  function stop() {
    state.generation++;
    state.timers.forEach(clearInterval);
    state.timers = [];
    if (catchUp) { clearTimeout(catchUp); catchUp = null; }
  }

  window.DashboardData = {
    start,
    stop,
    evalQuery(expr) { return state.provider ? state.provider.evalQuery(expr) : Promise.resolve(null); },
    getHisPoints() { return state.provider ? state.provider.getHisPoints() : Promise.resolve(null); },
    getPointHistory(id, days) { return state.provider ? state.provider.getPointHistory(id, days) : Promise.resolve(null); },
    getAlarmHistory(days) { return state.provider ? state.provider.getAlarmHistory(days) : Promise.resolve(null); },
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
