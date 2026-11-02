/* Générateur XLSX minimal, sans dépendance (onglets, en-têtes figés, filtres
 * automatiques, nombres/dates typés). Compression via CompressionStream quand
 * le navigateur la propose, sinon archive non compressée (toujours valide). */
(function (root) {
  'use strict';

  var enc = new TextEncoder();

  // ---- CRC32 ------------------------------------------------------------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32 (bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function deflateRaw (bytes) {
    if (typeof CompressionStream !== 'function') return Promise.resolve(null);
    try {
      var cs = new CompressionStream('deflate-raw');
      return new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer()
        .then(function (b) { return new Uint8Array(b); }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  // ---- ZIP ----------------------------------------------------------------
  function zip (files) { // files: [{ name, data: Uint8Array }]
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    return Promise.all(files.map(function (f) {
      return deflateRaw(f.data).then(function (comp) {
        var useComp = comp && comp.length < f.data.length;
        return { name: enc.encode(f.name), raw: f.data, body: useComp ? comp : f.data, method: useComp ? 8 : 0, crc: crc32(f.data) };
      });
    })).then(function (entries) {
      var chunks = []; var central = []; var offset = 0;
      entries.forEach(function (e) {
        var h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
        h.setUint16(8, e.method, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true);
        h.setUint32(14, e.crc, true); h.setUint32(18, e.body.length, true); h.setUint32(22, e.raw.length, true);
        h.setUint16(26, e.name.length, true); h.setUint16(28, 0, true);
        chunks.push(new Uint8Array(h.buffer), e.name, e.body);

        var c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
        c.setUint16(10, e.method, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
        c.setUint32(16, e.crc, true); c.setUint32(20, e.body.length, true); c.setUint32(24, e.raw.length, true);
        c.setUint16(28, e.name.length, true); c.setUint32(42, offset, true);
        central.push(new Uint8Array(c.buffer), e.name);
        offset += 30 + e.name.length + e.body.length;
      });
      var cdSize = central.reduce(function (s, a) { return s + a.length; }, 0);
      var end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
      end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
      return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    });
  }

  // ---- XML helpers ----------------------------------------------------------
  function esc (s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colName (i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function excelDate (d) { return d.getTime() / 864e5 + 25569 - d.getTimezoneOffset() / 1440; }

  // Styles : 0 défaut, 1 en-tête, 2 date, 3 date-heure, 4 titre, 5 libellé gras, 6 texte gris
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts>' +
    '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="14"/><name val="Calibri"/></font><font><color rgb="FF6B7280"/><sz val="10"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F2328"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  // cell : null | string | number | boolean | Date | { v, s } (s = style)
  function cellXml (ref, cell) {
    if (cell == null || cell === '') return '';
    var style = 0; var v = cell;
    if (typeof cell === 'object' && !(cell instanceof Date)) { style = cell.s || 0; v = cell.v; if (v == null || v === '') return style ? '<c r="' + ref + '" s="' + style + '"/>' : ''; }
    var s = style ? ' s="' + style + '"' : '';
    if (typeof v === 'number') return isFinite(v) ? '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>' : '';
    if (typeof v === 'boolean') return '<c r="' + ref + '"' + s + ' t="b"><v>' + (v ? 1 : 0) + '</v></c>';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      var hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
      return '<c r="' + ref + '" s="' + (style || (hasTime ? 3 : 2)) + '"><v>' + excelDate(v) + '</v></c>';
    }
    var str = String(v);
    if (str.length > 32767) str = str.slice(0, 32764) + '...';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(str) + '</t></is></c>';
  }

  // sheet : { name, rows: [[cell]], widths?: [n], freezeRow?: n (lignes figées), autoFilterRow?: n (1-based) }
  function sheetXml (sh) {
    var rows = sh.rows; var parts = [];
    var maxCols = 0;
    for (var r = 0; r < rows.length; r++) if (rows[r].length > maxCols) maxCols = rows[r].length;
    parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    if (sh.freezeRow) {
      parts.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + sh.freezeRow + '" topLeftCell="A' + (sh.freezeRow + 1) +
        '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    }
    var widths = sh.widths || autoWidths(rows, maxCols);
    if (widths.length) {
      parts.push('<cols>');
      widths.forEach(function (w, i) { parts.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'); });
      parts.push('</cols>');
    }
    parts.push('<sheetData>');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]; var cells = '';
      for (var j = 0; j < row.length; j++) cells += cellXml(colName(j) + (i + 1), row[j]);
      parts.push('<row r="' + (i + 1) + '">' + cells + '</row>');
    }
    parts.push('</sheetData>');
    if (sh.autoFilterRow && maxCols && rows.length >= sh.autoFilterRow) {
      parts.push('<autoFilter ref="A' + sh.autoFilterRow + ':' + colName(maxCols - 1) + rows.length + '"/>');
    }
    parts.push('</worksheet>');
    return parts.join('');
  }

  function autoWidths (rows, maxCols) {
    var w = []; var sample = Math.min(rows.length, 300);
    for (var c = 0; c < maxCols; c++) {
      var m = 8;
      for (var r = 0; r < sample; r++) {
        var cell = rows[r][c]; if (cell == null) continue;
        var v = typeof cell === 'object' && !(cell instanceof Date) ? cell.v : cell;
        var len = v instanceof Date ? 16 : String(v == null ? '' : v).length;
        if (len > m) m = len;
      }
      w.push(Math.min(60, m + 2));
    }
    return w;
  }

  function safeSheetNames (sheets) {
    var used = {};
    return sheets.map(function (s) {
      var base = String(s.name || 'Sheet').replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
      var name = base; var k = 2;
      while (used[name.toLowerCase()]) { var suf = ' (' + (k++) + ')'; name = base.slice(0, 31 - suf.length) + suf; }
      used[name.toLowerCase()] = true;
      return name;
    });
  }

  function build (sheets) {
    var names = safeSheetNames(sheets);
    var files = [];
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
      '</Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map(function (n, i) { return '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
      '</sheets>' + definedNames(sheets, names) + '</workbook>';
    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    files.push({ name: '[Content_Types].xml', data: enc.encode(ct) });
    files.push({ name: '_rels/.rels', data: enc.encode(rels) });
    files.push({ name: 'xl/workbook.xml', data: enc.encode(wb) });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) });
    files.push({ name: 'xl/styles.xml', data: enc.encode(STYLES) });
    sheets.forEach(function (s, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: enc.encode(sheetXml(s)) }); });
    return zip(files);
  }

  // Filtre automatique : Excel exige le nom défini _xlnm._FilterDatabase
  function definedNames (sheets, names) {
    var out = [];
    sheets.forEach(function (s, i) {
      if (!s.autoFilterRow || !s.rows.length) return;
      var maxCols = 0; s.rows.forEach(function (r) { if (r.length > maxCols) maxCols = r.length; });
      if (!maxCols || s.rows.length < s.autoFilterRow) return;
      out.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + esc(names[i].replace(/'/g, "''")) + '\'!$A$' + s.autoFilterRow + ':$' + colName(maxCols - 1) + '$' + s.rows.length + '</definedName>');
    });
    return out.length ? '<definedNames>' + out.join('') + '</definedNames>' : '';
  }

  root.RecapXlsx = { build: build, _crc32: crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
