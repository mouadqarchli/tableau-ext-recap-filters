/* Lecture des données de feuilles (export + détection des colonnes).
 * Partagé par l'extension et la fenêtre de configuration. */
(function (root) {
  'use strict';
  var MN_RE = /^(measure names|noms? de mesures?)$/i;
  var MV_RE = /^(measure values|valeurs? de mesures?)$/i;
  function assign (t) {
    for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; }
    return t;
  }
  function norm (s) {
    s = String(s == null ? '' : s).toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.replace(/[^a-z0-9]/g, '');
  }

  function readSheetData (ws, maxRows, onProgress, pageSize) {
    var opts = { ignoreSelection: true };
    var legacy = function () {
      return ws.getSummaryDataAsync(assign({ maxRows: maxRows }, opts)).then(function (tb) {
        onProgress(tb.data.length, tb.totalRowCount);
        return { cols: tb.columns, rows: tb.data, truncated: tb.totalRowCount > tb.data.length };
      });
    };
    if (typeof ws.getSummaryDataReaderAsync === 'function') {
      return ws.getSummaryDataReaderAsync(pageSize || 10000, opts).catch(function (err) {
        console.warn('[recap] summary reader unavailable, fallback', err);
        return null;
      }).then(function (reader) {
        if (!reader) return legacy();
        var cols = null; var rows = []; var truncated = false;
        var page = function (i) {
          if (i >= reader.pageCount || rows.length >= maxRows) return Promise.resolve();
          return reader.getPageAsync(i).then(function (tb) {
            if (!cols) cols = tb.columns;
            for (var r = 0; r < tb.data.length; r++) { if (rows.length >= maxRows) { truncated = true; break; } rows.push(tb.data[r]); }
            onProgress(rows.length, reader.totalRowCount);
            return page(i + 1);
          });
        };
        var release = function () { return Promise.resolve(reader.releaseAsync ? reader.releaseAsync() : null).catch(function () {}); };
        return page(0).then(function () {
          return release().then(function () {
            return { cols: cols || [], rows: rows, truncated: truncated || reader.totalRowCount > rows.length };
          });
        }, function (err) { return release().then(function () { throw err; }); });
      });
    }
    return ws.getSummaryDataAsync(assign({ maxRows: maxRows }, opts)).then(function (tb) {
      onProgress(tb.data.length, tb.totalRowCount);
      return { cols: tb.columns, rows: tb.data, truncated: tb.totalRowCount > tb.data.length };
    });
  }

  // Valeurs typées (nombres, dates, booléens) ; Measure Names/Values remis en colonnes
  function toTable (d, valMode) {
    var display = valMode === 'display';
    var cols = d.cols.slice().sort(function (a, b) { return a.index - b.index; });
    var mn = -1; var mv = -1;
    cols.forEach(function (c, i) { if (MN_RE.test(c.fieldName)) mn = i; else if (MV_RE.test(c.fieldName)) mv = i; });
    var conv = function (dv, col) {
      if (!dv) return null;
      var v = dv.value; var f = dv.formattedValue;
      if (v == null || v === '%null%' || (f === 'Null' && (v === '' || v == null))) return display && f ? String(f) : null;
      if (display) return f != null ? String(f) : String(v);
      switch (col.dataType) {
        case 'int': case 'float': { var n = typeof v === 'number' ? v : Number(v); return isFinite(n) ? n : f; }
        case 'bool': return v === true || v === 'true' || v === 1;
        case 'date': case 'date-time': { var dt = toDate(v); return dt || f; }
        default: return f != null && f !== '' ? String(f) : String(v);
      }
    };
    if (mn === -1 || mv === -1) {
      return {
        header: cols.map(function (c) { return c.fieldName; }),
        measures: [],
        rows: d.rows.map(function (row) { return cols.map(function (c) { return conv(row[c.index], c); }); }),
        truncated: d.truncated
      };
    }
    var dims = cols.filter(function (c, i) { return i !== mn && i !== mv; });
    var mnCol = cols[mn]; var mvCol = cols[mv];
    var measures = []; var mIdx = {}; var groups = new Map(); var order = [];
    d.rows.forEach(function (row) {
      var mName = String(row[mnCol.index] ? row[mnCol.index].formattedValue : '');
      if (!(mName in mIdx)) { mIdx[mName] = measures.length; measures.push(mName); }
      var key = dims.map(function (c) { var x = row[c.index]; return x ? String(x.value) : ''; }).join('\u0001');
      var g = groups.get(key);
      if (!g) { g = { dims: dims.map(function (c) { return conv(row[c.index], c); }), vals: {} }; groups.set(key, g); order.push(key); }
      g.vals[mName] = conv(row[mvCol.index], mvCol);
    });
    return {
      header: dims.map(function (c) { return c.fieldName; }).concat(measures),
      measures: measures.slice(),
      rows: order.map(function (k) { var g = groups.get(k); return g.dims.concat(measures.map(function (m) { return g.vals[m] == null ? null : g.vals[m]; })); }),
      truncated: d.truncated
    };
  }

  // Structure visuelle de la feuille (Tableau 2023.3+ / API 1.11) : ordre des
  // champs en lignes/colonnes, champs seulement en Détail/Info-bulle.
  function vizSpec (ws) {
    if (typeof ws.getVisualSpecificationAsync !== 'function') return Promise.resolve(null);
    return ws.getVisualSpecificationAsync().then(function (spec) {
      if (!spec) return null;
      var nm = function (f) { return f ? String(f.name || f.fieldName || f.fieldId || '') : ''; };
      var shelf = [];
      (spec.rowFields || []).forEach(function (f) { shelf.push(nm(f)); });
      (spec.columnFields || []).forEach(function (f) { shelf.push(nm(f)); });
      var ms = (spec.marksSpecifications || [])[spec.activeMarksSpecificationIndex || 0] || {};
      var other = []; var hiddenOnly = [];
      (ms.encodings || []).forEach(function (e) {
        var ty = String(e.type || '').toLowerCase();
        (ty === 'detail' || ty === 'tooltip' ? hiddenOnly : other).push(nm(e.field));
      });
      return { shelf: shelf, other: other, hiddenOnly: hiddenOnly };
    }, function () { return null; });
  }

  function fieldKey (name) { return norm(String(name || '').replace(/^[A-Za-z]+\((.*)\)$/, '$1')); }

  // Ordre et choix des colonnes : réglage manuel (Configure > Data export)
  // sinon automatique (lignes, colonnes, autres encodages, puis mesures ;
  // champs uniquement en Détail/Info-bulle exclus).
  function autoColumns (tb, spec) {
    var cols = tb.header.map(function (n, i) { return { n: n, i: i, on: true, rank: 500 + i }; });
    if (!spec) return cols;
    var pos = function (list, n) {
      var k = fieldKey(n);
      for (var i = 0; i < list.length; i++) if (fieldKey(list[i]) === k) return i;
      return -1;
    };
    var isMeasure = {}; tb.measures.forEach(function (m) { isMeasure[m] = true; });
    cols.forEach(function (c) {
      if (isMeasure[c.n]) { c.rank = 1000 + c.i; return; } // ordre des mesures : non fourni par l'API -> réglage manuel
      var a = pos(spec.shelf, c.n); var b = pos(spec.other, c.n); var z = pos(spec.hiddenOnly, c.n);
      if (a !== -1) c.rank = a;
      else if (b !== -1) c.rank = 100 + b;
      else if (z !== -1) { c.on = false; c.rank = 3000 + c.i; }
    });
    return cols.sort(function (x, y) { return x.rank - y.rank; });
  }

  function shapeTable (tb, spec, manual) {
    var auto = autoColumns(tb, spec);
    var plan;
    if (Array.isArray(manual) && manual.length) {
      var byName = {}; auto.forEach(function (c) { byName[c.n] = c; });
      var used = {};
      plan = [];
      manual.forEach(function (m) {
        var c = byName[m.n];
        if (!c || used[m.n]) return;
        used[m.n] = true;
        if (m.on !== false) plan.push({ i: c.i, label: m.l || c.n });
      });
      auto.forEach(function (c) { if (!used[c.n] && c.on) plan.push({ i: c.i, label: c.n }); }); // nouvelles colonnes
    } else {
      plan = auto.filter(function (c) { return c.on; }).map(function (c) { return { i: c.i, label: c.n }; });
    }
    return {
      header: plan.map(function (p) { return p.label; }),
      rows: tb.rows.map(function (r) { return plan.map(function (p) { return r[p.i]; }); }),
      truncated: tb.truncated
    };
  }

  // Colonnes détectées (échantillon) pour l'onglet Data export de Configure
  // Lecture séquentielle (Tableau n'accepte qu'un lecteur de données actif à la fois)
  function sheetColumns (ws) {
    return readSheetData(ws, 2000, function () {}, 2000).then(function (d) {
      return vizSpec(ws).then(function (spec) {
        var tb = toTable(d, 'raw');
        return autoColumns(tb, spec).map(function (c) { return { n: c.n, on: c.on }; });
      });
    });
  }

  function toDate (v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(v));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  root.RecapSheet = {
    readSheetData: readSheetData, toTable: toTable, vizSpec: vizSpec, autoColumns: autoColumns,
    shapeTable: shapeTable, sheetColumns: sheetColumns, toDate: toDate
  };
})(typeof window !== 'undefined' ? window : globalThis);
