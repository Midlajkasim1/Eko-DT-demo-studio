/* ============================================================================
   METER STATUS (D96) — metering data quality as a first-class panel.
   ONE SOURCE: E.data.meters. The report engine's Data quality section reads
   the same array (js/reports/report-api.js dataQuality), so the panel and a
   report can never disagree. Quality is a STATE CHIP from our vocabulary
   (ok · intermittent · offline · unconfirmed), never a coloured dot alone;
   the domain hue is a dot that identifies the utility and nothing else.
   The table uses the register's table anatomy (table.reg: selection row
   state, tooltip truncation, compact column drops) and becomes stacked cards
   on phones — never a horizontally scrolling table.
   ============================================================================ */
window.EKO_MT = (function(){
  'use strict';
  const C = () => window.EKO_C;
  const esc = s => C().esc(s);
  const fmt = (v, d) => (typeof v === 'number' && isFinite(v)) ? v.toLocaleString('en-US', { minimumFractionDigits:d == null ? 0 : d, maximumFractionDigits:d == null ? 2 : d }) : '—';
  const HUE = { energy:'var(--domEnergy)', water:'var(--domWater)', gas:'var(--domGas)' };
  const meters = E => E.data.meters || [];
  function counts(E){ const c = { n:0, ok:0, intermittent:0, offline:0, unconfirmed:0 }; meters(E).forEach(m => { c.n++; c[m.quality] = (c[m.quality] || 0) + 1; }); return c; }
  const since = (E, m) => E.lang === 'ar' ? (m.sinceAr || m.sinceEn || '') : (m.sinceEn || '');
  const ageText = (E, h) => h < 48 ? E.t('ageH', { n: Math.round(h) }) : E.fmtAge(h);
  function qualityTip(E, m){
    switch(m.quality){
      case 'intermittent': return E.t('mtTip.intermittent', { got:m.intervalsGot, exp:m.intervalsTotal, since:since(E, m) });
      case 'offline':      return E.t('mtTip.offline', { since:since(E, m), age:ageText(E, m.sinceAgeH || 0) });
      case 'unconfirmed':  return E.t('mtTip.unconfirmed', { since:since(E, m) });
      default:             return E.t('mtTip.ok', { t:m.lastAt });
    }
  }
  function recv(E, m){ const n = m.receivedMin; if(n < 60) return E.t('mtRecvMin', { n }); if(n < 48 * 60) return E.t('mtRecvH', { n:Math.round(n / 60) }); return E.t('mtRecvD', { n:Math.round(n / 1440) }); }
  function spark(E, m){
    const vals = (m.spark7 || []).filter(v => v != null);
    if(vals.length < 2) return `<span class="tCap">${esc(E.t('emptyDash'))}</span>`;
    const lo = Math.min(...vals), hi = Math.max(...vals), tr = ekoTrend(vals, 80, 20);
    return `<span class="mtsparkw" data-tip="${esc(E.t('mtSparkTip', { lo:fmt(lo, 1), hi:fmt(hi, 1), u:m.sparkUnit || m.unit }))}"><svg class="mtspark" viewBox="0 0 80 20" aria-hidden="true"><path d="${tr.line}" fill="none" stroke="${HUE[m.domain] || 'var(--t3)'}" stroke-width="1.5"/></svg></span>`;
  }
  function metaText(E){
    const c = counts(E), parts = [E.t('mtMeta', { n:c.n })];
    ['ok', 'intermittent', 'offline', 'unconfirmed'].forEach(k => { if(c[k]) parts.push(E.t('mtMeta.' + k, { n:c[k] })); });
    return parts.join(' · ');
  }
  function panel(E){
    const t = E.t.bind(E), ar = E.lang === 'ar';
    const rows = meters(E).map(m => {
      const name = ar ? (m.nameAr || m.nameEn) : m.nameEn;
      return `<tr data-act="openAsset" data-asset="${esc(m.id)}" data-on="${E.state.assetSel === m.id}" tabindex="0">
        <td class="mtm"><span class="mono">${esc(m.id)}</span><span class="mtname" data-tip="${esc(name)}" data-tipif="trunc">${esc(name)}</span></td>
        <td class="mtt"><i class="mtdot" style="background:${HUE[m.domain] || 'var(--t3)'}" aria-hidden="true"></i>${esc(t('mtType.' + m.domain))}</td>
        <td class="mtl"><span class="mono">${esc(fmt(m.last, m.last >= 1000 ? 0 : 1))}</span> <span class="tCap">${esc(m.unit)}</span></td>
        <td class="mtr"><span data-tip="${esc(t('mtRecvTip', { t:m.lastAt }))}">${esc(recv(E, m))}</span></td>
        <td class="mtq"><span class="statchip" data-q="${esc(m.quality)}" data-tip="${esc(qualityTip(E, m))}">${esc(t('mtQ.' + m.quality))}</span></td>
        <td class="mts">${spark(E, m)}</td></tr>`; }).join('');
    return `<article class="pwwidget mtcard" aria-label="${esc(t('mtTitle'))}">
      <div class="pwwh"><span class="alcardt">${esc(t('mtTitle'))}</span><span class="alcardm">${esc(metaText(E))}</span>${window.EKO_A.chrome(E)}</div>
      <div class="mtwrap"><table class="reg mtable"><thead><tr>
        <th>${esc(t('mtColMeter'))}</th><th>${esc(t('mtColType'))}</th><th>${esc(t('mtColLast'))}</th><th>${esc(t('mtColRecv'))}</th><th>${esc(t('mtColQuality'))}</th><th>${esc(t('mtColTrend'))}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <span class="ovkcap">${esc(t('mtFoot'))}</span></article>`;
  }
  /* a meter row opens the asset panel: the meter presented in the asset shape */
  function meterAsAsset(E, id){
    const m = meters(E).find(x => x.id === id); if(!m) return null;
    const t = E.t.bind(E), ar = E.lang === 'ar';
    const q = t('mtQ.' + m.quality) + (m.intervalsTotal ? ' · ' + m.intervalsGot + '/' + m.intervalsTotal : '');
    return { id:m.id, isMeter:true, st: m.quality === 'offline' ? 'stale' : 'ok', staleH:m.sinceAgeH || 0, alarms:[], wos:0, wost:null,
      floor:'', level:t('mtType.' + m.domain), levelAr:t('mtType.' + m.domain), zone:m.nameEn, zoneAr:m.nameAr || m.nameEn,
      typeEn:t('mtAssetType.' + m.domain), typeAr:t('mtAssetType.' + m.domain),
      params:[[t('mtColLast'), t('mtSrcMeter'), fmt(m.last, m.last >= 1000 ? 0 : 1) + ' ' + m.unit], [t('mtColRecv'), m.lastAt, recv(E, m)], [t('mtColQuality'), t('mtSrcDerived'), q]],
      activity:[], make:'', serial:'', svc:'', cafm:'' };
  }
  return { panel, counts, metaText, qualityTip, meterAsAsset, recv };
})();
