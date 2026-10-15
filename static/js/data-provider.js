(function () {
  'use strict';

  // A previous closure's pollers are unreachable once DashboardData is rebound
  if (window.DashboardData && typeof window.DashboardData.stop === 'function') {
    window.DashboardData.stop();
  }

  const EVENT_NAME = 'dashboard-data';

  function normalizeConfig(raw) {
    if (!raw) return null;
    const fin = raw.fin || raw;
    return {
      directMode: !!(fin.directMode || fin.direct_mode),
      liveMs: Number(fin.interval || (raw.polling && raw.polling.live_ms)) || 5000,
      realtimeMs: Number(raw.polling && raw.polling.realtime_ms) || 30000,
      project: fin.project || fin.project_name || '',
      displayName: raw.display_name || fin.displayName || '',
    };
  }

  async function resolveConfig() {
    if (window.INJECTED_PROJECT_CONFIG) return normalizeConfig(window.INJECTED_PROJECT_CONFIG);
    for (const url of ['api-config.json', '/api/fin/config']) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return normalizeConfig(await res.json());
      } catch (_) { /* source not present in this deployment */ }
    }
    return null;
  }

  class BackendProvider {
    async _json(url) {
      try {
        const res = await fetch(url);
        if (res.status === 401) return { unauthorized: true };
        if (!res.ok) return null;
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
    async getStatus() { return { connected: false }; }
    async getLiveValues() { return null; }
    async getPowerHistory() { return null; }
    async getEquipment() { return null; }
    async getAlarms() { return null; }
    async getDocuments() { return null; }
    async getWorkOrders() { return null; }
    async getMeters() { return null; }
    async getHisPoints() { return null; }
    async getPointHistory() { return null; }
    async getAlarmHistory() { return null; }
    async evalQuery() { return null; }
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
    return !!data && !data.unauthorized;
  }

  // Consumers read power_history off the live payload, so it is spliced back in
  // here rather than re-sent with every 5 s poll
  function withHistory(live) {
    return state.powerHistory ? { ...live, power_history: state.powerHistory } : live;
  }

  async function pollLive() {
    const data = await state.provider.getLiveValues();
    if (usable(data)) {
      state.power = withHistory(data);
      emit('power', state.power);
    }
    setConnected(usable(data));
  }

  async function pollRealtime() {
    const [equipment, alarms, meters, history, documents, workorders, alarmHistory] = await Promise.all([
      state.provider.getEquipment(),
      state.provider.getAlarms(),
      state.provider.getMeters(),
      state.provider.getPowerHistory(),
      state.provider.getDocuments(),
      state.provider.getWorkOrders(),
      state.provider.getAlarmHistory(2),
    ]);
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
    state.provider = state.config && state.config.directMode ? new DirectProvider() : new BackendProvider();
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
