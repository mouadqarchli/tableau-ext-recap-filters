/* Configuration dialog — Filters & parameters recap */
(function () {
  'use strict';
  var KEY = 'recapConfig';
  var DEFAULTS = {
    title: '', language: 'en', accent: '#ff6d00', theme: 'light', density: 'comfortable', layout: 'auto',
    showParams: true, showReset: true, showExport: true, showInactive: false, showRatio: true, maxChips: 4,
    useWorkbookFont: true, includeHiddenCards: true, includeHiddenParams: true, checkAllSelected: true, ignoreNullOnly: true,
    overrides: null, showDataExport: true, dataSheets: null, dataDefaults: null, dataMaxRows: 200000, dataColumns: null, dataValues: 'raw', sortOrder: 'alpha'
  };
  var PALETTE = ['#ff6d00', '#111827', '#5b5fc7', '#0969da', '#0e9f6e', '#c2410c', '#be185d', '#7c3aed', '#b08d57'];
  var BOOLS = ['showDataExport', 'showParams', 'showReset', 'showExport', 'showInactive', 'showRatio', 'useWorkbookFont', 'includeHiddenCards', 'includeHiddenParams', 'checkAllSelected', 'ignoreNullOnly'];
  var inventory = null;
  var dataSel = { sheets: null, defaults: null, columns: {} };
  var ov = { f: {}, p: {}, pc: {}, labels: {}, nc: {} };
  var accent = DEFAULTS.accent;
  var I = window.RecapI18n;
  var t = I.make('en');
  var envLang = '';

  function $ (id) { return document.getElementById(id); }

  function translate (pref) {
    t = I.make(I.resolve(pref, envLang));
    I.apply(document, t);
    document.title = t('configure');
    $('title').placeholder = t('title_default');
    var custom = $('customColor'); if (custom) custom.title = t('cf_custom_color');
    renderContent();
  }

  function fill (c) {
    $('language').value = c.language;
    var d = I.dict;
    $('title').value = c.title === d.en.title_default || c.title === d.fr.title_default ? '' : (c.title || '');
    $('theme').value = c.theme;
    $('density').value = c.density;
    $('layout').value = c.layout;
    $('maxChips').value = c.maxChips;
    BOOLS.forEach(function (k) { $(k).checked = !!c[k]; });
    setAccent(c.accent);
    $('dataMaxRows').value = c.dataMaxRows || DEFAULTS.dataMaxRows;
    $('sortOrder').value = c.sortOrder === 'dashboard' ? 'dashboard' : 'alpha';
    dataSel = { sheets: Array.isArray(c.dataSheets) ? c.dataSheets.slice() : null, defaults: Array.isArray(c.dataDefaults) ? c.dataDefaults.slice() : null,
      columns: JSON.parse(JSON.stringify(c.dataColumns || {})) };
    $('dataValues').value = c.dataValues === 'display' ? 'display' : 'raw';
    var o = c.overrides || {};
    ov = { f: assignObj({}, o.f), p: assignObj({}, o.p), pc: assignObj({}, o.pc), labels: assignObj({}, o.labels), nc: assignObj({}, o.nc) };
    translate(c.language);
  }

  function assignObj (a, b) { for (var k in b || {}) a[k] = b[k]; return a; }

  // ---- Onglet « Contenu du récap » ----
  function renderContent () {
    $('invMissing').hidden = !!inventory;
    if (!inventory) return;
    drawList($('ovFilters'), inventory.filters, 'f', function (it) { return t(it.auto === 'card' ? 'cf_auto_card' : 'cf_auto_nocard'); });
    drawList($('ovParams'), inventory.params, 'p', function (it) {
      return it.auto === 'manual' ? t('cf_auto_manual', { c: it.control }) : it.auto === 'control' ? t('cf_auto_control', { c: it.control }) : t('cf_auto_nocontrol');
    });
    drawSheets();
    var un = inventory.unlinked || [];
    $('unlinked').hidden = !un.length;
    if (un.length) $('unlinked').textContent = t('cf_unlinked', { list: un.join(', ') });
  }

  function drawList (wrap, items, kind, autoText) {
    wrap.textContent = '';
    items = items.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name), t.lang, { numeric: true, sensitivity: 'base' }); });
    if (!items.length) { var e = document.createElement('div'); e.className = 'ov-empty'; e.textContent = '—'; wrap.appendChild(e); return; }
    items.forEach(function (it) {
      var row = document.createElement('div');
      var cur = ov[kind][it.key] || 'auto';
      row.className = 'ov-row is-' + cur;
      var txt = document.createElement('div'); txt.className = 'ov-row__text';
      var n = document.createElement('div'); n.className = 'ov-row__name'; n.textContent = it.name; n.title = it.name;
      var a = document.createElement('div'); a.className = 'ov-row__auto'; a.textContent = autoText(it); a.title = a.textContent;
      txt.appendChild(n); txt.appendChild(a);
      var sel = document.createElement('select');
      [['auto', 'cf_ov_auto'], ['show', 'cf_ov_show'], ['hide', 'cf_ov_hide']].forEach(function (o) {
        var opt = document.createElement('option'); opt.value = o[0]; opt.textContent = t(o[1]); sel.appendChild(opt);
      });
      sel.value = cur;
      sel.addEventListener('change', function () {
        if (sel.value === 'auto') delete ov[kind][it.key]; else ov[kind][it.key] = sel.value;
        row.className = 'ov-row is-' + sel.value;
      });
      var top = document.createElement('div'); top.className = 'ov-row__top';
      top.appendChild(txt); top.appendChild(sel);
      row.appendChild(top);

      var extra = document.createElement('div'); extra.className = 'ov-row__extra';
      if (kind === 'p') extra.appendChild(controlPicker(it));
      extra.appendChild(labelInput(it, kind));
      if (kind === 'f') {
        var nc = document.createElement('label'); nc.className = 'check check--inline ov-nc'; nc.title = t('cf_nc_hint');
        var ncb = document.createElement('input'); ncb.type = 'checkbox'; ncb.checked = !!ov.nc[it.key];
        ncb.addEventListener('change', function () { if (ncb.checked) ov.nc[it.key] = true; else delete ov.nc[it.key]; });
        var ns = document.createElement('span'); ns.textContent = t('cf_nc');
        nc.appendChild(ncb); nc.appendChild(ns); extra.appendChild(nc);
      }
      row.appendChild(extra);
      wrap.appendChild(row);
    });
  }

  // ---- Onglet « Export des données » ----
  function drawSheets () {
    var wrap = $('dataSheets'); wrap.textContent = '';
    var ws = (inventory.worksheets || []).filter(function (w) { return !w.hidden; });
    if (!ws.length) { var e = document.createElement('div'); e.className = 'ov-empty'; e.textContent = '—'; wrap.appendChild(e); return; }
    var all = ws.map(function (w) { return w.name; });
    var exp = dataSel.sheets || all;
    var defs = dataSel.defaults || all.slice(0, 1);
    ws.forEach(function (w) {
      var row = document.createElement('div'); row.className = 'ov-row';
      var top = document.createElement('div'); top.className = 'ov-row__top';
      var n = document.createElement('div'); n.className = 'ov-row__text';
      var nm = document.createElement('div'); nm.className = 'ov-row__name'; nm.textContent = w.name; nm.title = w.name; n.appendChild(nm);
      top.appendChild(n);
      var mk = function (label, checked, onChange) {
        var l = document.createElement('label'); l.className = 'check check--inline';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked;
        cb.addEventListener('change', function () { onChange(cb.checked); });
        var s = document.createElement('span'); s.textContent = label;
        l.appendChild(cb); l.appendChild(s); return l;
      };
      top.appendChild(mk(t('cf_data_exportable'), exp.indexOf(w.name) !== -1, function (on) {
        var cur = (dataSel.sheets || all).filter(function (x) { return x !== w.name; });
        if (on) cur.push(w.name);
        dataSel.sheets = cur.length === all.length ? null : cur;
      }));
      top.appendChild(mk(t('cf_data_default'), defs.indexOf(w.name) !== -1, function (on) {
        var cur = (dataSel.defaults || all.slice(0, 1)).filter(function (x) { return x !== w.name; });
        if (on) cur.push(w.name);
        dataSel.defaults = cur;
      }));
      row.appendChild(top);
      row.appendChild(columnsEditor(w));
      wrap.appendChild(row);
    });
  }

  // Éditeur de colonnes d'une feuille : inclure, renommer, réordonner
  // Lecture des colonnes à la demande (une feuille à la fois : Tableau n'accepte
  // qu'un lecteur de données actif). La fenêtre de configuration a accès au dashboard.
  var colQueue = Promise.resolve();
  function loadColumns (w) {
    if (w._loading) return w._loading;
    var p = colQueue.then(function () {
      var dash = null;
      try { dash = tableau.extensions.dashboardContent.dashboard; } catch (e) { dash = null; }
      if (!dash) throw new Error(t('cf_cols_noapi'));
      var ws = dash.worksheets.filter(function (x) { return x.name === w.name; })[0];
      if (!ws) throw new Error(t('dx_sheet_missing', { s: w.name }));
      return window.RecapSheet.sheetColumns(ws);
    }).then(function (cols) { w.columns = cols; w.columnsError = null; }, function (err) {
      w.columns = null; w.columnsError = (err && (err.message || String(err))) || 'error';
    });
    colQueue = p.then(function () {}, function () {});
    w._loading = p.then(function () { w._loading = null; });
    return w._loading;
  }

  function columnsEditor (w) {
    var box = document.createElement('details'); box.className = 'cols';
    var sum = document.createElement('summary');
    var body = document.createElement('div'); body.className = 'cols__body';
    var setSum = function () { sum.textContent = t('cf_data_columns') + (dataSel.columns[w.name] ? '' : ' — ' + t('cf_data_columns_auto')); };
    setSum();
    box.appendChild(sum); box.appendChild(body);
    var dragFrom = null;
    var list = null;

    var buildList = function () {
      var manual = dataSel.columns[w.name];
      list = (manual || []).map(function (m) { return { n: m.n, l: m.l || '', on: m.on !== false }; });
      (w.columns || []).forEach(function (c) { if (!list.some(function (x) { return x.n === c.n; })) list.push({ n: c.n, l: '', on: c.on }); });
    };
    var save = function () { dataSel.columns[w.name] = list.map(function (x) { var o = { n: x.n, on: x.on }; if (x.l) o.l = x.l; return o; }); setSum(); };

    var renderBody = function (state) {
      body.textContent = '';
      var note = function (cls, txt) { var e = document.createElement('p'); e.className = cls; e.textContent = txt; body.appendChild(e); return e; };
      if (state === 'loading') { note('cfg__note', t('cf_cols_loading')); return; }
      if (w.columnsError && !dataSel.columns[w.name]) note('cfg__warn', t('cf_data_columns_none') + ' (' + w.columnsError + ')');
      buildList();
      if (!list.length) { body.appendChild(reloadBtn()); return; }
      note('cfg__note', t('cf_data_columns_hint'));
      var ul = document.createElement('div'); ul.className = 'cols__list'; body.appendChild(ul);
      var draw = function () {
        ul.textContent = '';
        list.forEach(function (x, i) {
          var r = document.createElement('div'); r.className = 'cols__row' + (x.on ? '' : ' is-off');
          r.draggable = true;
          r.addEventListener('dragstart', function (e) { dragFrom = i; r.classList.add('is-drag'); try { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; } catch (er) { /* ignore */ } });
          r.addEventListener('dragend', function () { r.classList.remove('is-drag'); });
          r.addEventListener('dragover', function (e) { e.preventDefault(); r.classList.add('is-over'); });
          r.addEventListener('dragleave', function () { r.classList.remove('is-over'); });
          r.addEventListener('drop', function (e) {
            e.preventDefault(); r.classList.remove('is-over');
            if (dragFrom == null || dragFrom === i) return;
            var item = list.splice(dragFrom, 1)[0]; list.splice(i, 0, item); dragFrom = null; save(); draw();
          });
          var grip = document.createElement('span'); grip.className = 'cols__grip'; grip.textContent = '⋮⋮'; r.appendChild(grip);
          var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = x.on;
          cb.addEventListener('change', function () { x.on = cb.checked; save(); draw(); });
          var name = document.createElement('span'); name.className = 'cols__name'; name.textContent = x.n; name.title = x.n;
          var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = x.n; inp.value = x.l; inp.maxLength = 80;
          inp.addEventListener('input', function () { x.l = inp.value.trim(); save(); });
          var mv = function (d, label, txt) {
            var b = document.createElement('button'); b.type = 'button'; b.className = 'cols__btn'; b.textContent = txt; b.title = label;
            b.disabled = (d < 0 && i === 0) || (d > 0 && i === list.length - 1);
            b.addEventListener('click', function () { var tmp = list[i]; list[i] = list[i + d]; list[i + d] = tmp; save(); draw(); });
            return b;
          };
          r.appendChild(cb); r.appendChild(name); r.appendChild(inp); r.appendChild(mv(-1, t('cf_up'), '↑')); r.appendChild(mv(1, t('cf_down'), '↓'));
          ul.appendChild(r);
        });
      };
      draw();
      var bar = document.createElement('div'); bar.className = 'cols__bar';
      bar.appendChild(reloadBtn());
      var reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn btn--ghost cols__reset'; reset.textContent = t('cf_data_reset');
      reset.addEventListener('click', function () {
        delete dataSel.columns[w.name]; setSum();
        if (w.columns) renderBody(); else { renderBody('loading'); loadColumns(w).then(function () { renderBody(); }); }
      });
      bar.appendChild(reset);
      body.appendChild(bar);
    };

    var reloadBtn = function () {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--ghost cols__reset'; b.textContent = t('cf_cols_reload');
      b.addEventListener('click', function () { w.columns = null; renderBody('loading'); loadColumns(w).then(function () { renderBody(); }); });
      return b;
    };

    var opened = false;
    box.addEventListener('toggle', function () {
      if (!box.open || opened) return;
      opened = true;
      // Réglage manuel existant : affiché tout de suite, sans interroger Tableau
      if (dataSel.columns[w.name] || w.columns) { renderBody(); return; }
      renderBody('loading');
      loadColumns(w).then(function () { renderBody(); });
    });
    return box;
  }


  // Choix du contrôle qui pilote ce paramètre (prend sa place et son ordre dans le récap)
  function controlPicker (it) {
    var box = document.createElement('label'); box.className = 'ov-field';
    var cap = document.createElement('span'); cap.textContent = t('cf_ctrl'); box.appendChild(cap);
    var sel = document.createElement('select');
    var add = function (v, txt) { var o = document.createElement('option'); o.value = v; o.textContent = txt; sel.appendChild(o); };
    add('', t('cf_ctrl_auto'));
    add('none', t('cf_ctrl_none'));
    (inventory.controls || []).forEach(function (c) { add(String(c.id), c.name + (c.hidden ? t('cf_hidden_suffix') : '')); });
    var cur = ov.pc[it.key];
    sel.value = cur ? String(cur.id) : '';
    if (cur && sel.value !== String(cur.id)) sel.value = ''; // contrôle disparu
    sel.addEventListener('change', function () {
      if (!sel.value) { delete ov.pc[it.key]; return; }
      if (sel.value === 'none') { ov.pc[it.key] = { id: 'none' }; return; }
      var c = (inventory.controls || []).filter(function (x) { return String(x.id) === sel.value; })[0];
      ov.pc[it.key] = { id: c.id, name: c.name };
    });
    box.appendChild(sel);
    return box;
  }

  function labelInput (it, kind) {
    var box = document.createElement('label'); box.className = 'ov-field ov-field--grow';
    var cap = document.createElement('span'); cap.textContent = t('cf_label'); box.appendChild(cap);
    var inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 80;
    inp.placeholder = kind === 'p' && it.control ? it.control : it.name;
    inp.value = ov.labels[it.key] || '';
    inp.addEventListener('input', function () {
      var v = inp.value.trim();
      if (v) ov.labels[it.key] = v; else delete ov.labels[it.key];
    });
    box.appendChild(inp);
    return box;
  }

  function wireTabs () {
    var tabs = document.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle('is-active', x === tab); });
        Array.prototype.forEach.call(document.querySelectorAll('[data-panel]'), function (p) { p.hidden = p.getAttribute('data-panel') !== tab.getAttribute('data-tab'); });
      });
    });
  }

  function read () {
    var c = { accent: accent };
    c.language = $('language').value;
    c.title = $('title').value.trim();
    c.theme = $('theme').value;
    c.density = $('density').value;
    c.layout = $('layout').value;
    c.maxChips = Math.min(20, Math.max(1, parseInt($('maxChips').value, 10) || DEFAULTS.maxChips));
    BOOLS.forEach(function (k) { c[k] = $(k).checked; });
    c.dataMaxRows = Math.min(1000000, Math.max(1000, parseInt($('dataMaxRows').value, 10) || DEFAULTS.dataMaxRows));
    c.dataSheets = dataSel.sheets;
    c.dataDefaults = dataSel.defaults;
    c.dataValues = $('dataValues').value;
    c.dataColumns = Object.keys(dataSel.columns).length ? dataSel.columns : null;
    var hasOv = Object.keys(ov.f).length || Object.keys(ov.p).length || Object.keys(ov.pc).length || Object.keys(ov.labels).length || Object.keys(ov.nc).length;
    c.overrides = hasOv ? { f: ov.f, p: ov.p, pc: ov.pc, labels: ov.labels, nc: ov.nc } : null;
    c.sortOrder = $('sortOrder').value;
    return c;
  }

  function setAccent (hex) {
    accent = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULTS.accent;
    document.documentElement.style.setProperty('--accent', accent);
    var btns = document.querySelectorAll('.swatch');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-c') === accent.toLowerCase() ? 'true' : 'false');
    var custom = $('customColor'); if (custom) custom.value = accent;
  }

  function buildSwatches () {
    var wrap = $('swatches');
    PALETTE.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.style.background = c;
      b.setAttribute('data-c', c.toLowerCase()); b.setAttribute('aria-label', c);
      b.addEventListener('click', function () { setAccent(c); });
      wrap.appendChild(b);
    });
    var input = document.createElement('input');
    input.type = 'color'; input.id = 'customColor'; input.className = 'swatch-custom';
    input.addEventListener('input', function () { setAccent(input.value); });
    wrap.appendChild(input);
  }

  function init () {
    buildSwatches();
    wireTabs();
    tableau.extensions.initializeDialogAsync().then(function (payload) {
      try { envLang = tableau.extensions.environment.language; } catch (e) { envLang = ''; }
      var current = {}; var pl = {};
      try { pl = JSON.parse(payload || '{}') || {}; } catch (e) { pl = {}; }
      inventory = pl.inventory || null;
      try { current = JSON.parse(tableau.extensions.settings.get(KEY) || 'null') || pl.cfg || {}; } catch (e) { current = pl.cfg || {}; }
      var c = {}; for (var k in DEFAULTS) c[k] = k in current ? current[k] : DEFAULTS[k];
      fill(c);

      $('language').addEventListener('change', function () { translate($('language').value); });
      $('form').addEventListener('submit', function (e) {
        e.preventDefault();
        tableau.extensions.settings.set(KEY, JSON.stringify(read()));
        tableau.extensions.settings.saveAsync().then(function () {
          tableau.extensions.ui.closeDialog('saved');
        }, function (err) { alert(t('cf_save_error', { e: (err && err.message) || err })); });
      });
      $('btnCancel').addEventListener('click', function () { tableau.extensions.ui.closeDialog('cancel'); });
      $('btnReset').addEventListener('click', function () {
        var keep = ov; fill(DEFAULTS); ov = keep; renderContent(); // garde les choix de contenu
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
