(function () {
  'use strict';
  if (!window.DASHBOARD_OVERLAY) return;

  function sev(s) {
    s = String(s || '').toLowerCase();
    if (s === 'critical') return 'critical';
    if (s === 'warning' || s === 'high') return 'high';
    return 'medium';
  }

  function parseWhen(occurred) {
    if (!occurred) return null;
    var d = new Date(String(occurred).replace(/ [A-Za-z_\/]+$/, ''));
    return isNaN(d.getTime()) ? null : d;
  }

  function ageH(occurred) {
    var d = parseWhen(occurred);
    if (!d) return 0;
    return Math.max(0, (Date.now() - d.getTime()) / 36e5);
  }

  function raised(occurred) {
    var d = parseWhen(occurred);
    if (!d) return '';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function assetId(source) {
    var s = String(source || '').trim();
    var m = s.match(/\b([A-Z]{2,}[-_A-Z0-9.]+)\b/);
    return m ? m[1] : (s.slice(0, 40) || 'FIN');
  }

  function mapAlarm(a, i) {
    var src = a.source || '';
    var msg = a.message || src;
    return {
      id: 'fin-' + i + '-' + String(a.occurred || '').replace(/\W/g, '').slice(0, 16),
      fam: 'sys',
      asset: assetId(src),
      sev: sev(a.severity),
      cat: a.diagnosed ? 'fdd' : 'sys',
      sys: src || 'FIN',
      ack: null,
      ageH: ageH(a.occurred),
      locEn: src,
      locAr: src,
      plainEn: msg,
      plainAr: msg,
      techEn: msg,
      techAr: msg,
      impactAedMo: null,
      raised: raised(a.occurred),
      lifecycle: []
    };
  }

  function applyAlarms(payload) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !payload || !Array.isArray(payload.alarms)) return;
    site.alarms = payload.alarms.map(mapAlarm);
    if (Array.isArray(site.assets)) {
      site.assets.forEach(function (asset) {
        asset.alarms = site.alarms.filter(function (a) { return a.asset === asset.id; }).map(function (a) { return a.id; });
      });
    }
    paint();
  }

  function asNum(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      if (isFinite(n)) return n;
    }
    return null;
  }

  function toMw(v) {
    return v > 50 ? v / 1000 : v;
  }

  function toMwh(v) {
    return v >= 200 ? v / 1000 : v;
  }

  function applyPower(p) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !p || !site.metrics) return;
    var m = site.metrics;
    var el = site.energyLanding;
    var changed = false;
    function set(obj, key, val) {
      if (!obj || val == null) return;
      if (obj[key] === val) return;
      obj[key] = val;
      changed = true;
    }
    var loadKw = asNum(p.total_power);
    if (loadKw != null) { set(m, "loadNowMw", toMw(loadKw)); set(el, "currentKw", loadKw); }
    var daily = asNum(p.daily_energy);
    if (daily != null) set(m, "energyTodayMwh", toMwh(daily));
    var peak = asNum(p.peak_demand);
    if (peak != null) set(m, "peakTodayMw", toMw(peak));
    var iaq = asNum(p.iaq_index);
    if (iaq != null) set(m, "iaq", iaq);
    var comfort = asNum(p.comfort_compliance);
    if (comfort != null) set(m, "comfortIndex", comfort);
    var water = asNum(p.total_water);
    if (water != null) set(m, "waterTodayM3", water);
    var gas = asNum(p.total_gas);
    if (gas != null) set(m, "gasTodayM3", gas);
    var mtd = asNum(p.current_month);
    if (mtd != null) set(el, "mtdKwh", mtd);
    var perf = asNum(p.energy_performance);
    if (perf != null) set(el, "performancePct", perf);
    
    if (p.power_history) {
      function extractDaily(histId) {
        var hist = p.power_history[histId];
        if (!hist) return [];
        var dArr = [];
        for (var year in hist) {
          for (var month in hist[year]) {
            for (var day in hist[year][month]) {
              var hData = hist[year][month][day];
              var sum = 0, count = 0;
              for (var hr in hData) {
                if (hData[hr] != null) { sum += parseFloat(hData[hr]); count++; }
              }
              if (count > 0) dArr.push(Math.trunc((sum / count) * 100) / 100);
            }
          }
        }
        return dArr.slice(-7);
      }

      function applySparkAndDelta(summaryObj, sparkArr) {
        if (!summaryObj) return;
        summaryObj.spark = sparkArr;
        if (sparkArr.length >= 2) {
          var last = sparkArr[sparkArr.length - 1];
          var prevSum = 0;
          for (var i = 0; i < sparkArr.length - 1; i++) prevSum += sparkArr[i];
          var typical = prevSum / (sparkArr.length - 1);
          if (typical > 0) {
            var pct = Math.round(((last - typical) / typical) * 100);
            var sign = pct > 0 ? "+" : "";
            summaryObj.deltaEn = sign + pct + "% vs typical";
            summaryObj.deltaAr = sign + pct + "% مقارنة بالمعتاد";
          } else {
            summaryObj.deltaEn = null; summaryObj.deltaAr = null;
          }
        } else {
          summaryObj.deltaEn = null; summaryObj.deltaAr = null;
        }
      }

      var enSpark = extractDaily("Total_Power_Consumption_his");
      if (site.summary) { applySparkAndDelta(site.summary[0], enSpark); changed = true; }
      var wtSpark = extractDaily("Total_Water_Consumption_his");
      if (site.summary) { applySparkAndDelta(site.summary[1], wtSpark); changed = true; }
      var gsSpark = extractDaily("Total_Gas_Consumption_his");
      if (site.summary) { applySparkAndDelta(site.summary[2], gsSpark); changed = true; }
      
      if (el) set(el, "perfSpark", enSpark);
      
      function extractTodayHourly(histId) {
        var hist = p.power_history[histId];
        if (!hist) return [];
        var years = Object.keys(hist).sort();
        if (!years.length) return [];
        var y = years[years.length - 1];
        var months = Object.keys(hist[y]);
        var m_ = months[months.length - 1]; 
        var days = Object.keys(hist[y][m_]);
        var d_ = days[days.length - 1];
        
        var hData = hist[y][m_][d_];
        var hourly = [];
        var maxHourIndex = -1;
        var ampm = ["12:00 AM", "01:00 AM", "02:00 AM", "03:00 AM", "04:00 AM", "05:00 AM", "06:00 AM", "07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM", "11:00 AM",
                    "12:00 PM", "01:00 PM", "02:00 PM", "03:00 PM", "04:00 PM", "05:00 PM", "06:00 PM", "07:00 PM", "08:00 PM", "09:00 PM", "10:00 PM", "11:00 PM"];
        for (var i = 0; i < ampm.length; i++) {
           var val = hData[ampm[i]];
           if (val != null) {
              hourly.push(Math.trunc(parseFloat(val) * 100) / 100);
              maxHourIndex = i;
           } else {
              hourly.push(0);
           }
        }
        return maxHourIndex >= 0 ? hourly.slice(0, maxHourIndex + 1) : [];
      }
      
      if (site.power && window.EKO && window.EKO.state) {
         var peakArr = extractTodayHourly("Peak_Demand_his");
         if (peakArr.length > 0) { site.power.peakSeries = peakArr; changed = true; }
         
         var z0 = extractTodayHourly("Hourly_EC_MCC1_his");
         var z1 = extractTodayHourly("Hourly_EC_MCC2_his");
         var z2 = extractTodayHourly("Hourly_EC_SMDB_KIT_his");
         var z3 = extractTodayHourly("Hourly_EC_LVFP_his");
         var z4 = extractTodayHourly("Hourly_EC_ATS_his");
         var z5 = extractTodayHourly("Hourly_EC_SP_his");
         
         if (z0.length > 0 || z1.length > 0) {
            var maxLen = Math.max(z0.length, z1.length, z2.length, z3.length, z4.length, z5.length);
            var align = function(arr) { while (arr.length < maxLen) arr.push(0); return arr; };
            site.power.zoneHourly = [align(z0), align(z1), align(z2), align(z3), align(z4), align(z5)];
            changed = true;
         }
      }
    }
    if (changed) paint();
  }

  function paint() {
    var E = window.EKO;
    if (E && typeof E.set === 'function') E.set({});
  }

  function norm(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function namesMatch(a, b) {
    if (!a || !b) return false;
    var x = norm(a), y = norm(b);
    return x === y || (x.length >= 3 && y.indexOf(x) !== -1) || (y.length >= 3 && x.indexOf(y) !== -1);
  }

  function applyMeters(meters) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !meters || !site.power || !Array.isArray(site.power.pmus)) return;
    var names = Object.keys(meters);
    if (!names.length) return;
    var changed = false;
    site.power.pmus.forEach(function (pmu) {
      var key = names.find(function (n) { return namesMatch(pmu.id, n); });
      if (!key) return;
      var row = meters[key];
      var kw = asNum(row.active_power);
      var a = asNum(row.current);
      var hz = asNum(row.frequency);
      var kwh = asNum(row.total_energy);
      var v = asNum(row.voltage);
      if (kw != null && pmu.kw !== kw) { pmu.kw = kw; changed = true; }
      if (a != null && pmu.a !== a) { pmu.a = a; changed = true; }
      if (hz != null && pmu.hz !== hz) { pmu.hz = hz; changed = true; }
      if (kwh != null && pmu.kwh !== kwh) { pmu.kwh = kwh; changed = true; }
      if (v != null && pmu.v !== v) { pmu.v = v; changed = true; }
    });
    if (changed) paint();
  }

  
  var historyCache = {};
  function applyEquipment(payload) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    var list = payload && payload.equipment;
    if (!site || !Array.isArray(list)) return;
    
    // Build fresh asset list from FIN live data
    var newAssets = list.map(function (eq) {
      var crit = "C";
      if (/chiller|pump|mcc|smdb|facp/i.test(eq.type)) crit = "A";
      else if (/ahu|fahu|mahu|lift/i.test(eq.type)) crit = "B";

      var sys = "hvac";
      if (/mcc|smdb|elec/i.test(eq.type)) sys = "elec";
      if (/facp|fm200|is|cctv/i.test(eq.type)) sys = "sec";
      if (/fan|exhaust|extract|vav/i.test(eq.type)) sys = "vent";

      var params = (eq.points || []).filter(function(p) { return p.reporting; }).slice(0, 4).map(function(p) {
        return [p.navName, "BMS", p.currentValue];
      });

      var assetData = {
        id: eq.name,
        bimId: eq.bimId,
        sys: sys,
        crit: crit,
        wtyEnd: null,
        tags: eq.tags || [],
        st: eq.inAlarm ? "alarm" : "ok",
        alarms: (site.alarms || []).filter(function(a) { return namesMatch(a.asset, eq.name) || namesMatch(a.asset, eq.bimId); }).map(function(a) { return a.id; }),
        floor: eq.floor || "Unknown",
        zone: "General",
        zoneAr: "عام",
        typeEn: (eq.type || "equipment").toUpperCase(),
        typeAr: (eq.type || "معدات").toUpperCase(),
        level: eq.floor || "Level",
        levelAr: eq.floor || "الطابق",
        wos: 0,
        wost: null,
        make: "--",
        serial: "--",
        svc: "--",
        cafm: "--",
        trend7: null,
        params: params,
        activity: [],
        spark7: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
      };

      if (historyCache[eq.name] && historyCache[eq.name].trend7) {
        assetData.trend7 = historyCache[eq.name].trend7;
        assetData.spark7 = historyCache[eq.name].spark7;
      } else {
        var hisPoints = (eq.points || []).filter(function(p) { return p.his; });
        var target = null;
        if (hisPoints.length > 0) {
           var prio = /temp|valve|power|co2|flow/i;
           target = hisPoints.find(function(p) { return prio.test(p.navName); }) || hisPoints[0];
        }

        if (target) {
          historyCache[eq.name] = { fetching: true };
                    if (window.DashboardData && window.DashboardData.getPointHistory) {
            window.DashboardData.getPointHistory(target.id, 7).then(function(res) {
              if (res && res.history) {
                var dailyAverages = [];
                var hist = res.history;
                // Parse nested year->month->day->hour structure
                for (var year in hist) {
                  for (var month in hist[year]) {
                    for (var day in hist[year][month]) {
                      var hData = hist[year][month][day];
                      var sum = 0, count = 0;
                      for (var hr in hData) {
                        if (hData[hr] != null) {
                          sum += parseFloat(hData[hr]);
                          count++;
                        }
                      }
                      if (count > 0) {
                        var avg = sum / count;
                        // Truncate to 2 decimal places without rounding (e.g. 88.469 -> 88.46)
                        dailyAverages.push(Math.trunc(avg * 100) / 100);
                      }
                    }
                  }
                }
                
                var vals = dailyAverages.slice(-7); // take last 7 days
                
                if (vals.length >= 1) {
                  var min = Math.min.apply(null, vals);
                  var max = Math.max.apply(null, vals);
                  var range = max - min || 1;
                  var spark7 = vals.map(function(v) { return (v - min) / range; });
                  
                  historyCache[eq.name] = {
                    trend7: { point: target.navName, unit: res.unit || "", vals: vals },
                    spark7: spark7
                  };
                                    paint();
                } else {
                                    historyCache[eq.name] = { failed: true };
                }
              } else {
                                  historyCache[eq.name] = { failed: true };
              }
            }).catch(function(err) {
                            historyCache[eq.name] = { failed: true };
            });
          }
        }
      }

      return assetData;
    });

    site.assets = newAssets;
    paint();
  }
window.addEventListener('dashboard-data', function (e) {
    var d = e.detail || {};
    if (d.type === 'alarms') applyAlarms(d.data);
    if (d.type === 'power') applyPower(d.data);
    if (d.type === 'meters') applyMeters(d.data);
    if (d.type === 'equipment') applyEquipment(d.data);
  });

  if (window.DashboardData && window.DashboardData.alarms) applyAlarms(window.DashboardData.alarms);
  if (window.DashboardData && window.DashboardData.power) applyPower(window.DashboardData.power);
  if (window.DashboardData && window.DashboardData.meters) applyMeters(window.DashboardData.meters);
  if (window.DashboardData && window.DashboardData.equipment) applyEquipment(window.DashboardData.equipment);
})();
