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

  var ZONE_NAMES = ["MCC 1","MCC 2","Kitchen SMDB","LVFP","ATS","Sump pump"];
  var ZONE_HUES = ["#4EA3E8","#F0A93B","#45C79A","#E48FC4","#A78BFA","#E06C75"];
  var BOARD_KEYS = ["mcc1","mcc2","smdb_kit","lvfp","ats","sump_pump"];
  var PMU_IDS = ["PMU09","PMU04","PMU05","PMU06","PMU07","PMU08"];
  var PMU_HIS = {
    PMU09: "PMU09_MCC_01_his",
    PMU04: "PMU04_MCC_02_his",
    PMU05: "PMU05_SMDB_KIT_his",
    PMU06: "PMU06_LVFP_Z7_01_his",
    PMU07: "PMU07_ATS_E_his",
    PMU08: "PMU08_SWPS02_his"
  };

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
    if (perf != null && perf >= 0 && perf <= 500) {
      set(el, "performancePct", perf);
    } else {
      el.performancePct = null;
    }
    
    // Wire live endpoints to Energy Landing summary cards
    if (el) {
      var rawOvernight = asNum(p.after_hours_load);
      var rawEnDev = asNum(p.energy_deviation);
      
      var overnight = (rawOvernight != null && rawOvernight >= 0 && rawOvernight <= 100) ? rawOvernight : null;
      var enDev = (rawEnDev != null && rawEnDev >= -100 && rawEnDev <= 100) ? rawEnDev : null;
      
      set(el, "overnightDeviationPct", overnight);
      
      if (el.sumGauges) {
        el.sumGauges.forEach(function(g) {
          if (g.key === "enDev" && enDev != null) {
            set(g, "val", Math.trunc(enDev * 10) / 10);
            set(g, "wordEn", Math.abs(enDev) <= 5 ? "Healthy" : "Deviation");
            set(g, "wordAr", Math.abs(enDev) <= 5 ? "سليم" : "انحراف");
            set(g, "tone", Math.abs(enDev) <= 5 ? "ok" : "warn");
          }
        });
      }
    }
    
    // Wire live endpoints to the Systems HVAC & Mechanical stat cards
    // Sanity-checked: reject any value outside a physically plausible range → stays null → shows '--'
    if (site.systems && site.systems.groups) {
      var hvacGrp = site.systems.groups.find(function(g) { return g.id === "hvac"; });
      if (hvacGrp && hvacGrp.cards) {
        var rawTempDev  = asNum(p.temp_deviation);
        var rawEnPerf   = asNum(p.energy_performance);
        var rawComfIdx  = asNum(p.comfort_compliance);
        // Plausible ranges — anything outside is treated as null (raw FIN KPI calc artifact)
        var tempDev  = (rawTempDev  != null && rawTempDev  >= 0 && rawTempDev  <= 50)  ? rawTempDev  : null;
        var enPerf   = (rawEnPerf   != null && rawEnPerf   >= 0 && rawEnPerf   <= 5)   ? rawEnPerf   : null;
        var comfIdx  = (rawComfIdx  != null && rawComfIdx  >= 0 && rawComfIdx  <= 100) ? rawComfIdx  : null;
        hvacGrp.cards.forEach(function(c) {
          if (c.labelEn === "TEMPERATURE DEVIATION INDEX") {
            if (tempDev != null) {
              set(c, "v", String(Math.trunc(tempDev * 10) / 10));
              set(c, "capEn", tempDev > 2 ? "Warning" : "Normal");
              set(c, "capAr", tempDev > 2 ? "تحذير" : "طبيعي");
              set(c, "tone", tempDev > 2 ? "warn" : "ok");
            }
          }
          if (c.labelEn === "ENERGY PERFORMANCE RATIO") {
            if (enPerf != null) {
              set(c, "v", String(Math.trunc(enPerf * 100) / 100));
              set(c, "capEn", enPerf < 1.2 ? "Healthy" : "Above target");
              set(c, "capAr", enPerf < 1.2 ? "سليم" : "فوق الهدف");
              set(c, "tone", enPerf < 1.2 ? "ok" : "warn");
            }
          }
          if (c.labelEn === "COMFORT ENERGY INDEX") {
            if (comfIdx != null) {
              set(c, "v", String(Math.trunc(comfIdx * 100) / 100));
              set(c, "capEn", comfIdx >= 60 ? "Good" : comfIdx >= 40 ? "Fair" : "Poor");
              set(c, "capAr", comfIdx >= 60 ? "جيد" : comfIdx >= 40 ? "مقبول" : "ضعيف");
              set(c, "tone", comfIdx >= 60 ? "ok" : "warn");
            }
          }
        });
      }
    }
    
    // Wire live endpoints to the Systems Electrical stat cards
    if (site.systems && site.systems.groups) {
      var elecGrp = site.systems.groups.find(function(g) { return g.id === "electrical"; });
      if (elecGrp && elecGrp.cards) {
        var rawEnDev = asNum(p.energy_deviation);
        var rawPeak  = asNum(p.peak_demand);
        // Plausible ranges
        var enDev = (rawEnDev != null && rawEnDev >= -100 && rawEnDev <= 100) ? rawEnDev : null;
        var peakD = (rawPeak  != null && rawPeak >= 0) ? rawPeak : null;
        
        elecGrp.cards.forEach(function(c) {
          if (c.labelEn === "ENERGY DEVIATION" && enDev != null) {
            set(c, "v", String(Math.trunc(enDev * 10) / 10));
            set(c, "capEn", Math.abs(enDev) <= 5 ? "Healthy" : "Deviation");
            set(c, "capAr", Math.abs(enDev) <= 5 ? "سليم" : "انحراف");
            set(c, "tone", Math.abs(enDev) <= 5 ? "ok" : "warn");
          }
          if (c.labelEn === "PEAK DEMAND" && peakD != null) {
            set(c, "v", String(Math.trunc(peakD * 10) / 10));
            set(c, "capEn", "Recorded");
            set(c, "capAr", "مسجل");
            set(c, "tone", "ok");
          }
        });
      }
    }
    
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
      
      if (el && enSpark.length > 0) {
        set(el, "perfSpark", enSpark);
        if (enSpark.length >= 2) {
          var last = enSpark[enSpark.length - 1];
          var prevSum = 0;
          for (var i = 0; i < enSpark.length - 1; i++) prevSum += enSpark[i];
          var typical = prevSum / (enSpark.length - 1);
          if (typical > 0) {
            var pct = Math.round(((last - typical) / typical) * 100);
            var sign = pct > 0 ? "+" : "";
            set(el, "perfDeltaEn", sign + pct + "% vs 7d avg");
            set(el, "perfDeltaAr", sign + pct + "% عن متوسط 7 أيام");
            set(el, "perfWordEn", pct <= 5 ? "Excellent" : "Check Load");
            set(el, "perfWordAr", pct <= 5 ? "ممتاز" : "فحص الحمل");
          }
        }
      }

      var MONTH_I = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
      };
      var HOUR_I = {};
      (function () {
        var h, h12, ap, AP;
        for (h = 0; h < 24; h++) {
          h12 = h % 12 === 0 ? 12 : h % 12;
          ap = h < 12 ? "am" : "pm";
          AP = h < 12 ? "AM" : "PM";
          HOUR_I[h12 + " " + ap] = h;
          HOUR_I[String(h12).padStart(2, "0") + " " + ap] = h;
          HOUR_I[h12 + ":00 " + AP] = h;
          HOUR_I[h12 + ":00 " + ap] = h;
          HOUR_I[String(h12).padStart(2, "0") + ":00 " + AP] = h;
          HOUR_I[String(h12).padStart(2, "0") + ":00 " + ap] = h;
          HOUR_I[String(h)] = h;
        }
      })();
      var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

      function flattenHist(hist) {
        var out = [];
        if (!hist) return out;
        Object.keys(hist).forEach(function (year) {
          var y = parseInt(year, 10);
          if (!isFinite(y)) return;
          Object.keys(hist[year] || {}).forEach(function (month) {
            var mo = MONTH_I[String(month).toLowerCase()];
            if (mo == null) {
              var mn = parseInt(month, 10);
              mo = isFinite(mn) ? mn - 1 : null;
            }
            if (mo == null) return;
            Object.keys(hist[year][month] || {}).forEach(function (day) {
              var da = parseInt(String(day).split(" ").pop(), 10);
              if (!isFinite(da)) return;
              var hData = hist[year][month][day];
              Object.keys(hData || {}).forEach(function (hr) {
                if (hData[hr] == null || hData[hr] === "") return;
                var v = parseFloat(hData[hr]);
                if (!isFinite(v)) return;
                var hi = HOUR_I[String(hr).toLowerCase()];
                if (hi == null) hi = HOUR_I[hr];
                if (hi == null) {
                  var hn = parseInt(hr, 10);
                  hi = isFinite(hn) ? hn : null;
                }
                if (hi == null) return;
                out.push({ y: y, m: mo, d: da, h: hi, val: v });
              });
            });
          });
        });
        out.sort(function (a, b) { return a.y - b.y || a.m - b.m || a.d - b.d || a.h - b.h; });
        return out;
      }

      function nowParts() {
        try {
          var parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Dubai",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            hourCycle: "h23"
          }).formatToParts(new Date());
          var get = function (t) {
            var x = parts.find(function (p) { return p.type === t; });
            return x ? parseInt(x.value, 10) : NaN;
          };
          var h = get("hour");
          if (h === 24) h = 0;
          return { y: get("year"), m: get("month") - 1, d: get("day"), h: h };
        } catch (e) {
          var n = new Date();
          return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate(), h: n.getHours() };
        }
      }

      function todayHourly(flat) {
        var now = nowParts();
        var n = Math.min(24, Math.max(1, now.h + 1));
        var hours = [], i;
        for (i = 0; i < n; i++) hours[i] = 0;
        (flat || []).forEach(function (p) {
          if (p.y === now.y && p.m === now.m && p.d === now.d && p.h >= 0 && p.h < n) {
            hours[p.h] = Math.trunc(p.val * 100) / 100;
          }
        });
        return hours;
      }

      function cmpPoint(a, b) {
        return a.y - b.y || a.m - b.m || a.d - b.d || a.h - b.h;
      }

      function latestPoint(flats) {
        var latest = null;
        (flats || []).forEach(function (flat) {
          (flat || []).forEach(function (p) {
            if (!latest || cmpPoint(p, latest) > 0) latest = p;
          });
        });
        return latest;
      }

      function firstPoint(flats) {
        var first = null;
        (flats || []).forEach(function (flat) {
          (flat || []).forEach(function (p) {
            if (!first || cmpPoint(p, first) < 0) first = p;
          });
        });
        return first;
      }

      function mondayOf(p) {
        var dt = new Date(p.y, p.m, p.d);
        dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
        return dt;
      }

      function weekKey(dt) {
        return dt.getFullYear() + "-" + (dt.getMonth() + 1) + "-" + dt.getDate();
      }

      function lastNWeeks(flats, n) {
        var now = nowParts();
        var end = mondayOf(now);
        var keys = [], i, dt;
        for (i = n - 1; i >= 0; i--) {
          dt = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i * 7);
          keys.push({ k: weekKey(dt), y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() });
        }
        return keys;
      }

      function lastNMonths(flats, n) {
        var now = nowParts();
        var keys = [], i, mm, yy;
        for (i = n - 1; i >= 0; i--) {
          mm = now.m - i;
          yy = now.y;
          while (mm < 0) { mm += 12; yy -= 1; }
          keys.push({ k: yy + "-" + (mm + 1), y: yy, m: mm });
        }
        return keys;
      }

      function lastNHours(flats, n) {
        var now = nowParts();
        var end = new Date(now.y, now.m, now.d, now.h);
        var keys = [], i, dt;
        for (i = n - 1; i >= 0; i--) {
          dt = new Date(end.getTime() - i * 36e5);
          keys.push({
            k: dt.getFullYear() + "-" + (dt.getMonth() + 1) + "-" + dt.getDate() + "-" + dt.getHours(),
            y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate(), h: dt.getHours()
          });
        }
        return keys;
      }

      function bucket(flat, keyFn, keys, mode) {
        var map = {};
        (flat || []).forEach(function (p) {
          var k = keyFn(p);
          if (!map[k]) map[k] = { sum: 0, max: -Infinity };
          map[k].sum += p.val;
          if (p.val > map[k].max) map[k].max = p.val;
        });
        return keys.map(function (dk) {
          var row = map[dk.k];
          if (!row) return 0;
          var v = mode === "max" ? row.max : row.sum;
          return Math.trunc(v * 100) / 100;
        });
      }

      function pointWeekKey(p) {
        return weekKey(mondayOf(p));
      }

      function pointMonthKey(p) {
        return p.y + "-" + (p.m + 1);
      }

      function byHour(flat, keys) {
        var map = {};
        (flat || []).forEach(function (p) {
          map[p.y + "-" + (p.m + 1) + "-" + p.d + "-" + p.h] = p.val;
        });
        return keys.map(function (hk) {
          var v = map[hk.k];
          return v == null ? 0 : Math.trunc(v * 100) / 100;
        });
      }

      function weekBarLabels(keys) {
        return keys.map(function (dk) {
          var sun = new Date(dk.y, dk.m, dk.d + 6);
          return dk.d + "–" + sun.getDate();
        });
      }

      function weekSpanLabel(keys) {
        if (!keys.length) return "";
        var a = keys[0], b = keys[keys.length - 1];
        var sun = new Date(b.y, b.m, b.d + 6);
        if (a.m === sun.getMonth() && a.y === sun.getFullYear()) return a.d + "–" + sun.getDate();
        return a.d + " " + MON[a.m] + "–" + sun.getDate() + " " + MON[sun.getMonth()];
      }

      function monthLabels(keys) {
        var years = {};
        keys.forEach(function (dk) { years[dk.y] = 1; });
        var multi = Object.keys(years).length > 1;
        return keys.map(function (dk) {
          return multi ? MON[dk.m] + " " + String(dk.y).slice(2) : MON[dk.m];
        });
      }

      function hourLabels(n) {
        var out = [], i;
        for (i = 0; i < n; i++) out.push((i % 2 === 0 || i === n - 1) ? String(i).padStart(2, "0") : "");
        return out;
      }

      function hourLabelsFromKeys(keys) {
        return keys.map(function (hk, i) {
          return (i % 2 === 0) ? String(hk.h).padStart(2, "0") : "";
        });
      }

      function align(arr, len) {
        var a = arr.slice();
        while (a.length < len) a.push(0);
        return a.slice(0, len);
      }

      if (site.power) {
        var ids = ["Hourly_EC_MCC1_his","Hourly_EC_MCC2_his","Hourly_EC_SMDB_KIT_his","Hourly_EC_LVFP_his","Hourly_EC_ATS_his","Hourly_EC_SP_his"];
        var flats = ids.map(function (id) { return flattenHist(p.power_history[id]); });
        site.power.pmuFlats = {};
        PMU_IDS.forEach(function (id) {
          site.power.pmuFlats[id] = flattenHist(p.power_history[PMU_HIS[id]]);
        });
        var peakFlat = flattenHist(p.power_history.Peak_Demand_his);
        var allFlats = flats.concat([peakFlat]);
        if (flats.some(function (f) { return f.length; })) {
          site.power.zones = ZONE_NAMES;
          site.power.zonesAr = ZONE_NAMES;
          site.power.zoneHues = ZONE_HUES;
        }
        var todayZ = flats.map(todayHourly);
        var todayLen = todayZ[0] ? todayZ[0].length : 0;
        site.power.zoneHourly = todayZ;
        changed = true;
        var hourKeys = lastNHours(allFlats, 1);
        site.power.zoneLast24 = flats.map(function (f) { return byHour(f, hourKeys); });
        site.power.peakLast24 = byHour(peakFlat, hourKeys);
        var weekKeys = lastNWeeks(allFlats, 6);
        var monthKeys = lastNMonths(allFlats, 6);
        site.power.zoneWeekly = flats.map(function (f) { return bucket(f, pointWeekKey, weekKeys, "sum"); });
        site.power.peakWeekly = bucket(peakFlat, pointWeekKey, weekKeys, "max");
        site.power.weekRange = weekSpanLabel(weekKeys);
        if (monthKeys.length) {
          site.power.zoneMonthly = flats.map(function (f) { return bucket(f, pointMonthKey, monthKeys, "sum"); });
          site.power.peakMonthly = bucket(peakFlat, pointMonthKey, monthKeys, "max");
          changed = true;
        }
        var now = nowParts();
        var weekStart = mondayOf(now);
        function sumIf(flat, test) {
          var sum = 0, n = 0;
          (flat || []).forEach(function (pt) {
            if (test(pt)) { sum += pt.val; n++; }
          });
          return n ? Math.trunc(sum * 100) / 100 : null;
        }
        site.power.zoneWTD = flats.map(function (flat) {
          return sumIf(flat, function (pt) {
            var dt = new Date(pt.y, pt.m, pt.d);
            return dt.getTime() >= weekStart.getTime() && (pt.y < now.y || (pt.y === now.y && (pt.m < now.m || (pt.m === now.m && pt.d <= now.d))));
          });
        });
        site.power.zoneMTD = flats.map(function (flat) {
          return sumIf(flat, function (pt) { return pt.y === now.y && pt.m === now.m; });
        });
        var yest = new Date(now.y, now.m, now.d - 1);
        site.power.zoneYesterday = flats.map(function (flat) {
          return sumIf(flat, function (pt) {
            return pt.y === yest.getFullYear() && pt.m === yest.getMonth() && pt.d === yest.getDate();
          });
        });
        var prevMon = new Date(weekStart.getTime() - 7 * 864e5);
        var prevSun = new Date(weekStart.getTime() - 864e5);
        site.power.zonePrevWeek = flats.map(function (flat) {
          return sumIf(flat, function (pt) {
            var dt = new Date(pt.y, pt.m, pt.d);
            return dt.getTime() >= prevMon.getTime() && dt.getTime() <= prevSun.getTime();
          });
        });
        var pm = now.m - 1, py = now.y;
        if (pm < 0) { pm = 11; py -= 1; }
        site.power.zonePrevMonth = flats.map(function (flat) {
          return sumIf(flat, function (pt) { return pt.y === py && pt.m === pm; });
        });
        changed = true;
        var peakToday = todayHourly(peakFlat);
        site.power.peakSeries = align(peakToday, todayLen);
        if (peakToday.length) {
          var pkSum = 0;
          peakToday.forEach(function (v) { pkSum += v; });
          site.power.peakAvgKw = Math.trunc((pkSum / peakToday.length) * 10) / 10;
        }
        var nH = todayLen;
        var hourLab = hourKeys.length
          ? String(hourKeys[hourKeys.length - 1].h).padStart(2, "0") + ":00"
          : "";
        site.power.trendX = {
          hourly: hourLab ? [hourLab] : [],
          today: hourLabels(nH),
          weekly: weekBarLabels(weekKeys),
          monthly: monthLabels(monthKeys)
        };
        if (site.water) {
          site.water.todayM3 = null;
          site.water.avgDrawM3Day = null;
          site.water.sparkToday = [];
          site.water.hourly = [];
          site.water.todayH = [];
          site.water.weekly = [];
          site.water.monthly = [];
          var wRaw = flattenHist(p.power_history.Total_Water_Consumption_his);
          var wFlat = [];
          var wi;
          for (wi = 1; wi < wRaw.length; wi++) {
            var dlt = wRaw[wi].val - wRaw[wi - 1].val;
            if (!isFinite(dlt) || dlt < 0) dlt = 0;
            wFlat.push({ y: wRaw[wi].y, m: wRaw[wi].m, d: wRaw[wi].d, h: wRaw[wi].h, val: dlt });
          }
          if (wFlat.length) {
            var wToday = todayHourly(wFlat);
            var wHourK = lastNHours([wFlat], 1);
            var wWeekK = lastNWeeks([wFlat], 6);
            var wMonthK = lastNMonths([wFlat], 6);
            site.water.hourly = byHour(wFlat, wHourK);
            site.water.todayH = wToday;
            site.water.weekly = bucket(wFlat, pointWeekKey, wWeekK, "sum");
            site.water.monthly = bucket(wFlat, pointMonthKey, wMonthK, "sum");
            site.water.trendX = {
              hourly: wHourK.length ? [String(wHourK[wHourK.length - 1].h).padStart(2, "0") + ":00"] : [],
              today: hourLabels(wToday.length),
              weekly: weekBarLabels(wWeekK),
              monthly: monthLabels(wMonthK)
            };
            site.water.weekRange = weekSpanLabel(wWeekK);
            var wtSum = 0, wtN = 0;
            for (wi = 0; wi < wToday.length; wi++) {
              if (wToday[wi]) { wtSum += wToday[wi]; wtN++; }
            }
            if (wtN) site.water.todayM3 = Math.trunc(wtSum * 100) / 100;
            var dayKeys7 = [], di, ddt;
            for (di = 6; di >= 0; di--) {
              ddt = new Date(now.y, now.m, now.d - di);
              dayKeys7.push({
                k: ddt.getFullYear() + "-" + (ddt.getMonth() + 1) + "-" + ddt.getDate(),
                y: ddt.getFullYear(), m: ddt.getMonth(), d: ddt.getDate()
              });
            }
            var last7 = bucket(wFlat, function (pt) { return pt.y + "-" + (pt.m + 1) + "-" + pt.d; }, dayKeys7, "sum");
            var a7 = 0, n7 = 0;
            last7.forEach(function (v) { if (v) { a7 += v; n7++; } });
            if (n7) site.water.avgDrawM3Day = Math.trunc((a7 / n7) * 10) / 10;
            if (wToday.length > 1) site.water.sparkToday = wToday;
            else if (n7) site.water.sparkToday = last7;
            changed = true;
          }
        }
      }

      // ---- GAS page wiring ------------------------------------------------
      if (site.gas) {
        if (p.total_gas != null) {
          site.gas.todayM3 = Math.trunc(asNum(p.total_gas) * 100) / 100;
          changed = true;
        }
        if (p.power_history && p.power_history.Total_Gas_Consumption_his) {
          // Gas meters report cumulative m³ — derive consumption via delta
          var gRaw = flattenHist(p.power_history.Total_Gas_Consumption_his);
          var gFlat = [];
          var gi;
          for (gi = 1; gi < gRaw.length; gi++) {
            var gdlt = gRaw[gi].val - gRaw[gi - 1].val;
            if (!isFinite(gdlt) || gdlt < 0) gdlt = 0;
            gFlat.push({ y: gRaw[gi].y, m: gRaw[gi].m, d: gRaw[gi].d, h: gRaw[gi].h, val: gdlt });
          }
          if (gFlat.length) {
            var gNow    = nowParts();
            var gToday  = todayHourly(gFlat);
            var gHourK  = lastNHours([gFlat], 1);
            var gWeekK  = lastNWeeks([gFlat], 6);
            var gMonthK = lastNMonths([gFlat], 6);
  
            site.gas.hourly  = byHour(gFlat, gHourK);
            site.gas.todayH  = gToday;
            site.gas.weekly  = bucket(gFlat, pointWeekKey, gWeekK, "sum");
            site.gas.monthly = bucket(gFlat, pointMonthKey, gMonthK, "sum");
            site.gas.trendX  = {
              hourly:  gHourK.length ? [String(gHourK[gHourK.length - 1].h).padStart(2, "0") + ":00"] : [],
              today:   hourLabels(gToday.length),
              weekly:  weekBarLabels(gWeekK),
              monthly: monthLabels(gMonthK)
            };
            site.gas.weekRange = weekSpanLabel(gWeekK);
  
            // Today total (sum of hourly deltas) overrides the scalar if history exists
            var gtSum = 0, gtN = 0;
            for (gi = 0; gi < gToday.length; gi++) {
              if (gToday[gi]) { gtSum += gToday[gi]; gtN++; }
            }
            if (gtN) site.gas.todayM3 = Math.trunc(gtSum * 100) / 100;
  
            // 7-day average
            var gDay7 = [], gdi, gddt;
            for (gdi = 6; gdi >= 0; gdi--) {
              gddt = new Date(gNow.y, gNow.m, gNow.d - gdi);
              gDay7.push({ k: gddt.getFullYear() + "-" + (gddt.getMonth() + 1) + "-" + gddt.getDate(),
                           y: gddt.getFullYear(), m: gddt.getMonth(), d: gddt.getDate() });
            }
            var gLast7 = bucket(gFlat, function(pt){ return pt.y + "-" + (pt.m + 1) + "-" + pt.d; }, gDay7, "sum");
            var ga7 = 0, gn7 = 0;
            gLast7.forEach(function(v){ if (v) { ga7 += v; gn7++; } });
            if (gn7) site.gas.avg7M3 = Math.trunc((ga7 / gn7) * 10) / 10;
  
            // Month-to-date
            var gmtdSum = 0;
            gFlat.forEach(function(pt){
              if (pt.y === gNow.y && pt.m === gNow.m) gmtdSum += pt.val;
            });
            if (gmtdSum > 0) site.gas.mtdM3 = Math.trunc(gmtdSum * 10) / 10;
  
            // daily14 — last 14 days for the bar chart (replaces mock array)
            var g14 = [], g14i, g14dt;
            for (g14i = 13; g14i >= 0; g14i--) {
              g14dt = new Date(gNow.y, gNow.m, gNow.d - g14i);
              g14.push({ k: g14dt.getFullYear() + "-" + (g14dt.getMonth() + 1) + "-" + g14dt.getDate(),
                         y: g14dt.getFullYear(), m: g14dt.getMonth(), d: g14dt.getDate() });
            }
            var gDaily14 = bucket(gFlat, function(pt){ return pt.y + "-" + (pt.m + 1) + "-" + pt.d; }, g14, "sum");
            if (gDaily14.some(function(v){ return v > 0; })) {
              site.gas.daily14          = gDaily14.map(function(v){ return v || 0; });
              site.gas.daily14StartDay  = g14[0].d;
            }
  
            changed = true;
          }
        }
      }
    }
    if (site.power) {
      var boards = ZONE_NAMES.map(function (name, i) {
        var kw = asNum(p[BOARD_KEYS[i]]);
        if (kw == null) {
          var series = (site.power.zoneLast24 && site.power.zoneLast24[i]) || (site.power.zoneHourly && site.power.zoneHourly[i]) || [];
          if (series.length) kw = series[series.length - 1];
        }
        return [name, kw == null ? 0 : kw];
      });
      var prev = site.power.boards;
      var same = prev && prev.length === boards.length && boards.every(function (b, i) {
        return prev[i] && prev[i][0] === b[0] && prev[i][1] === b[1];
      });
      if (!same) {
        site.power.boards = boards;
        site.power.zones = ZONE_NAMES;
        site.power.zonesAr = ZONE_NAMES;
        site.power.zoneHues = ZONE_HUES;
        changed = true;
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

  var PMU_CANON = [
    { id: "PMU09", db: "MCC 1" },
    { id: "PMU04", db: "MCC 2" },
    { id: "PMU05", db: "Kitchen SMDB" },
    { id: "PMU06", db: "LVFP" },
    { id: "PMU07", db: "ATS" },
    { id: "PMU08", db: "Sump pump" }
  ];

  function pmuKey(s) {
    var m = String(s || "").toUpperCase().match(/PMU\d+/);
    return m ? m[0] : "";
  }

  function applyMeters(meters) {
    var site = window.EKO_DATA && window.EKO_DATA.marsa;
    if (!site || !meters || !site.power) return;
    var byKey = {};
    Object.keys(meters).forEach(function (name) {
      var k = pmuKey(name);
      if (k) byKey[k] = { name: name, row: meters[name] || {} };
    });
    function rowOf(meta, live) {
      var r = live && live.row;
      var db = meta.db;
      if (!db && live && live.name) db = live.name.replace(/^PMU\d+[_\- ]*/i, "").replace(/_/g, " ").trim();
      return {
        id: meta.id,
        db: db || meta.id,
        kw: r ? asNum(r.active_power) : null,
        a: r ? asNum(r.current) : null,
        hz: r ? asNum(r.frequency) : null,
        kwh: r ? asNum(r.total_energy) : null,
        v: r ? asNum(r.voltage) : null,
        pf: null
      };
    }
    site.power.pmus = PMU_CANON.map(function (meta) {
      return rowOf(meta, byKey[meta.id]);
    });
    paint();
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

    // Dynamically update the HVAC Equipment and Overall Health cards from live data
    if (site.systems && site.systems.groups) {
      var hvacGrp = site.systems.groups.find(function(g) { return g.id === "hvac"; });
      if (hvacGrp && hvacGrp.cards) {
        var hvacAssets = newAssets.filter(function(a) { return a.sys === "hvac" || a.sys === "vent"; });
        var hvacTotal = hvacAssets.length;
        var hvacAlarm = hvacAssets.filter(function(a) { return a.st === "alarm"; }).length;
        var hvacActive = hvacTotal - hvacAlarm;
        var healthPct = hvacTotal > 0 ? Math.round((hvacActive / hvacTotal) * 1000) / 10 : null;
        var inactiveCount = hvacAlarm;

        hvacGrp.cards.forEach(function(c) {
          if (c.labelEn === "OVERALL HEALTH" && healthPct != null) {
            c.v = String(healthPct);
            c.capEn = healthPct >= 95 ? "Healthy" : healthPct >= 80 ? "Fair" : "Critical";
            c.capAr = healthPct >= 95 ? "سليم" : healthPct >= 80 ? "مقبول" : "حرج";
            c.tone = healthPct >= 95 ? "ok" : "warn";
          }
          if (c.labelEn === "HVAC EQUIPMENT" && hvacTotal > 0) {
            c.v = hvacActive + " / " + hvacTotal;
            c.capEn = "Total: " + hvacTotal;
            c.capAr = "الإجمالي: " + hvacTotal;
            c.chipEn = inactiveCount > 0 ? inactiveCount + " inactive" : null;
            c.chipAr = inactiveCount > 0 ? inactiveCount + " غير نشطة" : null;
            c.tone = inactiveCount > 0 ? "warn" : "ok";
          }
        });
      }
      
      var elecGrp = site.systems.groups.find(function(g) { return g.id === "electrical"; });
      if (elecGrp && elecGrp.cards) {
        var elecAssets = newAssets.filter(function(a) { return a.sys === "elec"; });
        var elecTotal = elecAssets.length;
        var elecAlarm = elecAssets.filter(function(a) { return a.st === "alarm"; }).length;
        var elecActive = elecTotal - elecAlarm;
        var elecHealthPct = elecTotal > 0 ? Math.round((elecActive / elecTotal) * 1000) / 10 : null;
        var elecInactiveCount = elecAlarm;

        elecGrp.cards.forEach(function(c) {
          if (c.labelEn === "OVERALL HEALTH" && elecHealthPct != null) {
            c.v = String(elecHealthPct);
            c.capEn = elecHealthPct >= 95 ? "Healthy" : elecHealthPct >= 80 ? "Fair" : "Critical";
            c.capAr = elecHealthPct >= 95 ? "سليم" : elecHealthPct >= 80 ? "مقبول" : "حرج";
            c.tone = elecHealthPct >= 95 ? "ok" : "warn";
          }
          if (c.labelEn === "ELECTRICAL EQUIPMENT" && elecTotal > 0) {
            c.v = elecActive + " / " + elecTotal;
            c.capEn = "Total: " + elecTotal;
            c.capAr = "الإجمالي: " + elecTotal;
            c.chipEn = elecInactiveCount > 0 ? elecInactiveCount + " inactive" : null;
            c.chipAr = elecInactiveCount > 0 ? elecInactiveCount + " غير نشطة" : null;
            c.tone = elecInactiveCount > 0 ? "warn" : "ok";
          }
        });
      }
    }

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