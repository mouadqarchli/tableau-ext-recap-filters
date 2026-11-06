/* Configuration dialog — Filters & parameters recap */
(function () {
  'use strict';
  var KEY = 'recapConfig';
  var DEFAULTS = {
    title: '', language: 'en', accent: '#A05546', theme: 'light', density: 'comfortable', layout: 'auto',
    showParams: true, showReset: true, showExport: true, showInactive: false, showRatio: true, maxChips: 4,
    useWorkbookFont: false, includeHiddenCards: true, includeHiddenParams: true, checkAllSelected: true, ignoreNullOnly: true,
    overrides: null, showDataExport: true, dataSheets: null, dataDefaults: null, dataMaxRows: 200000, dataColumns: null, dataValues: 'raw', sortOrder: 'alpha', csvSep: 'auto'
  };
  // Charte SMCP 2026 : couleurs primaires puis secondaires (pas de couleur libre)
  var PALETTE = [
    { c: '#A05546', n: 'Bordeaux' }, { c: '#28282D', n: 'Noir' }, { c: '#8C9B69', n: 'Olive' },
    { c: '#AA8250', n: 'Ocre' }, { c: '#CDD7E1', n: 'Bleu gris' }, { c: '#FAF073', n: 'Jaune' }
  ];
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
    $('csvSep').value = [';', ',', 'tab'].indexOf(c.csvSep) !== -1 ? c.csvSep : 'auto';
    $('theme').value = ['light', 'ecru', 'dark', 'transparent'].indexOf(c.theme) !== -1 ? c.theme : 'light';
    var o = c.overrides || {};
    ov = { f: assignObj({}, o.f), p: assignObj({}, o.p), pc: assignObj({}, o.pc), labels: assignObj({}, o.labels), nc: assignObj({}, o.nc) };
    translate(c.language);
  }

  function assignObj (a, b) { for (var k in b || {}) a[k] = b[k]; return a; }

  // ---- Onglet « Contenu du récap » ----------------------------------------
  // Un seul choix par élément : Auto | Inclure | Exclure, avec en clair ce qui
  // se passera dans le récap. Filtres regroupés par ce que l'extension a
  // reconnu automatiquement ; recherche et remise à zéro globale.
  var ovQuery = '';

  function renderContent () {
    $('invMissing').hidden = !!inventory;
    $('ovTools').hidden = !inventory;
    if (!inventory) return;
    drawFilters();
    drawParams();
    drawSheets();
    var un = inventory.unlinked || [];
    $('unlinked').hidden = !un.length;
    if (un.length) $('unlinked').textContent = t('cf_unlinked', { list: un.join(', ') });
    applySearch();
  }

  function el (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function byName (a, b) { return String(a.name).localeCompare(String(b.name), t.lang, { numeric: true, sensitivity: 'base' }); }
  function typeLabel (ty) { return t({ categorical: 'cf_ft_list', range: 'cf_ft_range', 'relative-date': 'cf_ft_date', hierarchical: 'cf_ft_tree' }[ty] || 'cf_ft_other'); }

  // Ce que l'élément devient dans le récap, selon le mode automatique et le choix
  function filterStatus (it) {
    var o = ov.f[it.key];
    if (o === 'show') return { inRecap: true, text: t('cf_st_f_show') };
    if (o === 'hide') return { inRecap: false, text: t('cf_st_hide') };
    if (it.auto === 'card') return { inRecap: true, text: t('cf_st_f_card') + (it.hiddenCard ? t('cf_st_hidden_card') : '') };
    if (it.auto === 'generated') return { inRecap: false, text: t('cf_st_f_generated') };
    return { inRecap: false, text: t('cf_st_f_nocard') };
  }
  function paramStatus (it) {
    var o = ov.p[it.key];
    var pc = ov.pc[it.key];
    var ctrl = pc && pc.id !== 'none' ? pc.name : pc && pc.id === 'none' ? '' : it.control;
    if (o === 'show') return { inRecap: true, text: t('cf_st_p_show') };
    if (o === 'hide') return { inRecap: false, text: t('cf_st_hide') };
    if (pc && pc.id !== 'none') return { inRecap: true, text: t('cf_auto_manual', { c: ctrl }) };
    if (ctrl) return { inRecap: true, text: t('cf_st_p_control', { c: ctrl }) };
    return { inRecap: false, text: t('cf_st_p_nocontrol') };
  }

  function segmented (kind, it, onChange) {
    var box = el('div', 'seg'); box.setAttribute('role', 'radiogroup'); box.setAttribute('aria-label', it.name);
    var cur = ov[kind][it.key] || 'auto';
    [['auto', 'cf_ov_auto', 'cf_ov_auto_hint'], ['show', 'cf_ov_show', 'cf_ov_show_hint'], ['hide', 'cf_ov_hide', 'cf_ov_hide_hint']].forEach(function (o) {
      var b = el('button', 'seg__btn seg__btn--' + o[0], t(o[1]));
      b.type = 'button'; b.title = t(o[2]);
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', cur === o[0] ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (o[0] === 'auto') delete ov[kind][it.key]; else ov[kind][it.key] = o[0];
        Array.prototype.forEach.call(box.children, function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
        onChange();
      });
      box.appendChild(b);
    });
    return box;
  }

  function itemRow (kind, it) {
    var row = el('div', 'ov-row');
    row.setAttribute('data-search', [it.name, ov.labels[it.key] || '', (it.sheets || []).join(' '), it.control || ''].join(' ').toLowerCase());
    var top = el('div', 'ov-row__top');
    var txt = el('div', 'ov-row__text');
    var name = el('div', 'ov-row__name', it.name); name.title = it.name;
    txt.appendChild(name);
    if (kind === 'f') {
      var meta = [typeLabel(it.type)];
      if (it.sheets && it.sheets.length) meta.push(t(it.sheets.length > 1 ? 'cf_sheets' : 'cf_sheet', { s: it.sheets.join(', ') }));
      var m = el('div', 'ov-row__meta', meta.join(' · ')); m.title = m.textContent;
      txt.appendChild(m);
    }
    var status = el('div', 'ov-row__status');
    txt.appendChild(status);
    var refresh = function () {
      var st = kind === 'f' ? filterStatus(it) : paramStatus(it);
      var o = ov[kind][it.key];
      row.className = 'ov-row ' + (st.inRecap ? 'is-in' : 'is-out') + (o ? ' is-forced' : '');
      status.textContent = st.text;
      updateSummary();
    };
    top.appendChild(txt);
    top.appendChild(segmented(kind, it, refresh));
    row.appendChild(top);

    var extra = el('div', 'ov-row__extra');
    if (kind === 'p') extra.appendChild(controlPicker(it, refresh));
    extra.appendChild(customize(it, kind));
    row.appendChild(extra);
    refresh();
    return row;
  }

  // Réglages secondaires repliés : libellé affiché, vérification des valeurs
  function customize (it, kind) {
    var d = el('details', 'ov-more');
    var sum = el('summary');
    var setSum = function () {
      var bits = [];
      if (ov.labels[it.key]) bits.push(t('cf_more_label', { l: ov.labels[it.key] }));
      if (kind === 'f' && ov.nc[it.key]) bits.push(t('cf_nc'));
      sum.textContent = t('cf_more') + (bits.length ? ' — ' + bits.join(' · ') : '');
      d.classList.toggle('is-set', !!bits.length);
    };
    d.appendChild(sum);
    var body = el('div', 'ov-more__body');
    body.appendChild(labelInput(it, kind, setSum));
    if (kind === 'f') {
      var nc = el('label', 'check check--inline ov-nc'); nc.title = t('cf_nc_hint');
      var ncb = el('input'); ncb.type = 'checkbox'; ncb.checked = !!ov.nc[it.key];
      ncb.addEventListener('change', function () { if (ncb.checked) ov.nc[it.key] = true; else delete ov.nc[it.key]; setSum(); });
      nc.appendChild(ncb); nc.appendChild(el('span', null, t('cf_nc')));
      body.appendChild(nc);
      body.appendChild(el('p', 'ov-more__hint', t('cf_nc_hint')));
    }
    d.appendChild(body);
    setSum();
    return d;
  }

  function group (wrap, titleKey, hintKey, items, kind, collapsed) {
    if (!items.length) return;
    var g = el('details', 'ov-group'); g.open = !collapsed;
    var sum = el('summary', 'ov-group__head');
    sum.appendChild(el('span', 'ov-group__title', t(titleKey)));
    sum.appendChild(el('span', 'ov-group__count', String(items.length)));
    g.appendChild(sum);
    if (hintKey) g.appendChild(el('p', 'ov-group__hint', t(hintKey)));
    var list = el('div', 'ov-list');
    items.slice().sort(byName).forEach(function (it) { list.appendChild(itemRow(kind, it)); });
    g.appendChild(list);
    wrap.appendChild(g);
  }

  function drawFilters () {
    var wrap = $('ovFilters'); wrap.textContent = '';
    var f = inventory.filters || [];
    if (!f.length) { wrap.appendChild(el('div', 'ov-empty', t('cf_none'))); return; }
    var pick = function (a) { return f.filter(function (x) { return (x.auto || 'nocard') === a; }); };
    var gen = pick('generated');
    group(wrap, 'cf_g_card', 'cf_g_card_hint', pick('card'), 'f');
    group(wrap, 'cf_g_nocard', 'cf_g_nocard_hint', pick('nocard'), 'f');
    group(wrap, 'cf_g_generated', 'cf_g_generated_hint', gen, 'f', !gen.some(function (x) { return ov.f[x.key]; }));
  }

  function drawParams () {
    var wrap = $('ovParams'); wrap.textContent = '';
    var p = inventory.params || [];
    if (!p.length) { wrap.appendChild(el('div', 'ov-empty', t('cf_none'))); return; }
    var list = el('div', 'ov-list');
    p.slice().sort(byName).forEach(function (it) { list.appendChild(itemRow('p', it)); });
    wrap.appendChild(list);
  }

  function updateSummary () {
    if (!inventory) return;
    var sum = function (items, kind, fn) {
      var inR = 0; var forced = 0;
      items.forEach(function (it) { if (fn(it).inRecap) inR++; if (ov[kind][it.key]) forced++; });
      return t('cf_summary', { n: inR, total: items.length }) + (forced ? ' · ' + t('cf_summary_forced', { n: forced }) : '');
    };
    $('ovFiltersSum').textContent = sum(inventory.filters || [], 'f', filterStatus);
    $('ovParamsSum').textContent = sum(inventory.params || [], 'p', paramStatus);
    $('ovResetAll').disabled = !Object.keys(ov.f).length && !Object.keys(ov.p).length;
  }

  function applySearch () {
    var q = ovQuery.trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll('[data-panel=content] .ov-row'), function (r) {
      r.hidden = !!q && r.getAttribute('data-search').indexOf(q) === -1;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-panel=content] .ov-group'), function (g) {
      var any = g.querySelector('.ov-row:not([hidden])');
      g.hidden = !any;
      if (q && any) g.open = true;
    });
  }

  function wireContentTools () {
    $('ovSearch').addEventListener('input', function (e) { ovQuery = e.target.value || ''; applySearch(); });
    $('ovResetAll').addEventListener('click', function () { ov.f = {}; ov.p = {}; renderContent(); });
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
  function controlPicker (it, onChange) {
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
      if (!sel.value) delete ov.pc[it.key];
      else if (sel.value === 'none') ov.pc[it.key] = { id: 'none' };
      else {
        var c = (inventory.controls || []).filter(function (x) { return String(x.id) === sel.value; })[0];
        ov.pc[it.key] = { id: c.id, name: c.name };
      }
      if (onChange) onChange();
    });
    box.appendChild(sel);
    return box;
  }

  function labelInput (it, kind, onChange) {
    var box = document.createElement('label'); box.className = 'ov-field ov-field--grow';
    var cap = document.createElement('span'); cap.textContent = t('cf_label'); box.appendChild(cap);
    var inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 80;
    inp.placeholder = kind === 'p' && it.control ? it.control : it.name;
    inp.value = ov.labels[it.key] || '';
    inp.addEventListener('input', function () {
      var v = inp.value.trim();
      if (v) ov.labels[it.key] = v; else delete ov.labels[it.key];
      if (onChange) onChange();
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
    c.csvSep = $('csvSep').value;
    c.dataColumns = Object.keys(dataSel.columns).length ? dataSel.columns : null;
    var hasOv = Object.keys(ov.f).length || Object.keys(ov.p).length || Object.keys(ov.pc).length || Object.keys(ov.labels).length || Object.keys(ov.nc).length;
    c.overrides = hasOv ? { f: ov.f, p: ov.p, pc: ov.pc, labels: ov.labels, nc: ov.nc } : null;
    c.sortOrder = $('sortOrder').value;
    return c;
  }

  function inPalette (hex) {
    hex = String(hex || '').toLowerCase();
    return PALETTE.some(function (p) { return p.c.toLowerCase() === hex; });
  }

  function setAccent (hex) {
    accent = inPalette(hex) ? hex : DEFAULTS.accent; // ancienne couleur hors charte -> bordeaux SMCP
    document.documentElement.style.setProperty('--accent', accent);
    var btns = document.querySelectorAll('.swatch');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-c') === accent.toLowerCase() ? 'true' : 'false');
  }

  function buildSwatches () {
    var wrap = $('swatches');
    PALETTE.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.style.background = p.c;
      b.setAttribute('data-c', p.c.toLowerCase()); b.setAttribute('aria-label', p.n + ' ' + p.c); b.title = p.n + ' — ' + p.c;
      b.addEventListener('click', function () { setAccent(p.c); });
      wrap.appendChild(b);
    });
  }

  function init () {
    buildSwatches();
    wireTabs();
    wireContentTools();
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
