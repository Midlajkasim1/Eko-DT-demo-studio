/* ============================================================================
   REPORT EXPORT (D90) — PDF and XLSX from the SAME ReportDoc the preview
   renders. Both carry the non-removable footer block.

   PDF: the document is rendered into a print view (light theme, the brand
   slot's mark, full RTL for Arabic, the footer repeated on every page) and
   handed to the browser's print-to-PDF. No PDF library, so it works
   air-gapped; production renders the same HTML server-side (see
   handoff/reporting.md).
   XLSX: a minimal Office Open XML workbook written here — one sheet per
   table plus Figures (with basis columns), Data quality and Footer — as a
   stored ZIP (no compression library needed). Arabic sheets are right-to-
   left.
   ============================================================================ */
window.EKO_RX = (function(){
  'use strict';
  const R = () => window.EKO_R, RV = () => window.EKO_RV;
  const enc = new TextEncoder();

  /* ------------------------------- PDF ------------------------------------- */
  let printState = null;
  function printView(E, doc){
    removePrintView();
    const host = document.createElement('div');
    host.id = 'rpprint'; host.dir = doc.lang === 'ar' ? 'rtl' : 'ltr'; host.lang = doc.lang;
    host.innerHTML = `<table class="rpprintt"><thead><tr><td><div class="rpprinthead"></div></td></tr></thead><tfoot><tr><td><div class="rpfootspace"></div></td></tr></tfoot><tbody><tr><td>${RV().doc(E, doc, { print:true })}</td></tr></tbody></table>`;
    document.body.appendChild(host);
    const html = (window.DASHBOARD_ROOT||document.documentElement);
    printState = { theme: html.getAttribute('data-theme'), title: document.title };
    html.setAttribute('data-theme', 'light');
    document.body.dataset.print = '1';
    document.title = doc.id + ' ' + R().title(E, doc);
    return host;
  }
  function removePrintView(){
    const old = document.getElementById('rpprint'); if(old) old.remove();
    delete document.body.dataset.print;
    if(printState){ if(printState.theme) (window.DASHBOARD_ROOT||document.documentElement).setAttribute('data-theme', printState.theme); document.title = printState.title; printState = null; }
  }
  /* D132: any HTML (the Ask EKO conversation) through the same print path as a report */
  function printHtml(E, o){
    removePrintView();
    const host = document.createElement('div');
    host.id = 'rpprint'; host.dir = o.lang === 'ar' ? 'rtl' : 'ltr'; host.lang = o.lang;
    host.innerHTML = `<table class="rpprintt"><thead><tr><td><div class="rpprinthead"></div></td></tr></thead><tfoot><tr><td><div class="rpfootspace"></div></td></tr></tfoot><tbody><tr><td><div class="rpdoc">${o.html}</div></td></tr></tbody></table>`;
    document.body.appendChild(host);
    const html = (window.DASHBOARD_ROOT||document.documentElement);
    printState = { theme: html.getAttribute('data-theme'), title: document.title };
    html.setAttribute('data-theme', 'light');
    document.body.dataset.print = '1';
    document.title = o.id + ' ' + o.title;
    const done = () => { window.removeEventListener('afterprint', done); removePrintView(); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { try{ window.print(); }catch(e){ done(); } }, 30);
    return host;
  }
  function pdf(E, doc){
    printView(E, doc);
    R().audit(E, 'report.export', doc.id, { format:'pdf', lang:doc.lang });
    const done = () => { window.removeEventListener('afterprint', done); removePrintView(); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { try{ window.print(); }catch(e){ done(); } }, 30);
  }

  /* ------------------------------- XLSX ------------------------------------ */
  const xml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = i => { let s = ''; i++; while(i > 0){ const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function sheetXml(rows, rtl){
    const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
      const ref = col(ci) + (ri + 1);
      if(typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('') + '</row>').join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${body}</sheetData></worksheet>`;
  }
  const safeName = s => String(s).replace(/[\\\/\?\*\[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  /* the footer block as rows — appended to EVERY sheet */
  function footerRows(E, doc){
    const t = (k, v) => E.t.call({ lang:doc.lang }, k, v);
    const site = doc.lang === 'ar' ? doc.site.nameAr : doc.site.nameEn;
    const prov = t('rpB.prov');
    return [[], [t('rpFt.label')],
      [t('rpFt.id'), doc.id], [t('rpFt.title'), R().title(E, doc)], [t('rpFt.site'), site], [t('rpFt.window'), t(doc.period.labelKey, doc.period.params)],
      [t('rpFt.generated'), doc.generatedAtLabel], [t('rpFt.by'), doc.generatedBy],
      [t('rpFt.tariff'), doc.basisVersions.tariff + (doc.basisVersions.tariffProvisional ? ' ' + prov : '')],
      [t('rpFt.emission'), doc.basisVersions.emission + (doc.basisVersions.emissionProvisional ? ' ' + prov : '')],
      [t('rpFt.eko'), doc.ekoVersion],
      doc.provisional.length ? [t('rpProv.note', { list: doc.provisional.map(p => t('rpProv.' + p)).join(', ') })] : []];
  }
  function workbookSheets(E, doc){
    const t = (k, v) => E.t.call({ lang:doc.lang }, k, v);
    const sheets = [];
    const foot = footerRows(E, doc);
    /* Figures */
    const figRows = [[t('rpCol.figure'), t('rpXl.value'), t('rpXl.unit'), t('rpXl.window'), t('rpCol.source'), t('rpXl.tariff'), t('rpXl.emission'), t('rpXl.formula'), t('rpXl.flag'), t('rpBasisLbl')]];
    Object.values(doc.figures).forEach(f => { const b = f.basis;
      figRows.push([t(f.labelKey), f.value, f.unit, t(b.windowKey, b.windowParams || {}), (b.sources || []).map(s => R().sourceLabel(E, s, doc.lang)).join(' + '),
        b.tariff ? b.tariff.id + ' ' + (b.tariff.version || '') + ' · ' + b.tariff.rate + ' ' + b.tariff.unit + (b.tariff.provisional ? ' ' + t('rpB.prov') : '') : '',
        b.emission ? b.emission.id + ' · ' + b.emission.factor + ' ' + b.emission.unit + (b.emission.provisional ? ' ' + t('rpB.prov') : '') : '',
        b.formulaKey ? t(b.formulaKey) : '', f.flagged ? t('rpB.flagged') : '', R().basisText(E, b, f.flagged, doc.lang)]); });
    sheets.push({ name:t('rpXl.figures'), rows:figRows.concat(foot) });
    /* tables */
    doc.sections.forEach(s => s.widgets.forEach(w => {
      const tab = RV().tableOf(E, doc, w); if(!tab) return;
      const rows = [[t(s.titleKey) + (w.labelKey ? ' · ' + t(w.labelKey) : '')], tab.head].concat(tab.rows);
      if(tab.basis) rows.push([], [t('rpBasisLbl'), tab.basis]);
      sheets.push({ name:safeName(t(s.titleKey)), rows: rows.concat(foot) });
    }));
    /* narration */
    if(doc.narration && doc.narration.status !== 'off'){
      const rows = [[t('rpS.narration')]];
      const put = (title, b) => { if(b && b.text){ rows.push([title, b.text]); rows.push(['', t('rpSrcLine', { line: RV().sourcesText(E, doc, b.sources) })]); } };
      put(t('rpS.execSummary'), doc.narration.summary);
      doc.sections.forEach(s => put(t(s.titleKey), doc.narration.sections[s.id]));
      put(t('rpS.recommendations'), doc.narration.recommendations);
      sheets.push({ name:t('rpS.narration'), rows: rows.concat(foot) });
    }
    /* data quality */
    const dq = [[t('rpCol.source'), t('rpCol.state'), t('rpCol.period'), t('rpCol.note')]];
    doc.dataQuality.forEach(d => dq.push([R().sourceLabel(E, d.sourceId, doc.lang), t('rpDQs.' + d.state), (d.from || '—') + ' → ' + (d.to || ''), t(d.noteKey, d.params)]));
    if(!doc.dataQuality.length) dq.push([t('rpDQ.clean')]);
    sheets.push({ name:t('rpS.dataQuality'), rows: dq.concat(foot) });
    /* footer sheet */
    sheets.push({ name:t('rpFt.label'), rows: foot.slice(1) });
    /* unique names */
    const seen = {}; sheets.forEach(s => { let n = safeName(s.name), b = n, i = 2; while(seen[n]){ n = safeName(b.slice(0, 28) + ' ' + i++); } seen[n] = 1; s.name = n; });
    return sheets;
  }
  /* D100: any [{name, rows}] list → a workbook (the data grid exports through this too) */
  function workbook(sheets, rtl){
    const files = [];
    const add = (name, text) => files.push({ name, data: enc.encode(text) });
    add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
    add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
    add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    add('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
    sheets.forEach((s, i) => add('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s.rows, rtl)));
    return new Blob([zipStored(files)], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function xlsxBlob(E, doc){ return workbook(workbookSheets(E, doc), doc.lang === 'ar'); }
  /* stored (uncompressed) ZIP writer */
  const CRC = (() => { const t = new Uint32Array(256); for(let i = 0; i < 256; i++){ let c = i; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
  function crc32(u8){ let c = 0xFFFFFFFF; for(let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStored(files){
    const parts = [], central = []; let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    files.forEach(f => {
      const name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(name.length), ...u16(0)]);
      parts.push(local, name, f.data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += local.length + name.length + sz;
    });
    const cdStart = offset, cdLen = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdLen), ...u32(cdStart), ...u16(0)]);
    const all = [...parts, ...central, eocd]; const total = all.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total); let p = 0; all.forEach(a => { out.set(a, p); p += a.length; });
    return out;
  }
  function download(blob, name){
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function xlsx(E, doc){
    const blob = xlsxBlob(E, doc);
    R().audit(E, 'report.export', doc.id, { format:'xlsx', lang:doc.lang, bytes:blob.size });
    download(blob, doc.id + '.xlsx');
    return blob;
  }
  return { pdf, printView, printHtml, removePrintView, xlsx, xlsxBlob, workbook, workbookSheets, crc32, download };
})();
