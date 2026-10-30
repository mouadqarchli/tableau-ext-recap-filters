/* Configuration dialog — Filters & parameters recap */
(function () {
  'use strict';
  var KEY = 'recapConfig';
  var DEFAULTS = {
    title: '', language: 'en', accent: '#ff6d00', theme: 'light', density: 'comfortable', layout: 'auto',
    showParams: true, showReset: true, showExport: true, showInactive: false, showRatio: true, maxChips: 4,
    useWorkbookFont: true, includeHiddenCards: true, includeHiddenParams: true, checkAllSelected: true, ignoreNullOnly: true,
    overrides: null
  };
  var PALETTE = ['#ff6d00', '#111827', '#5b5fc7', '#0969da', '#0e9f6e', '#c2410c', '#be185d', '#7c3aed', '#b08d57'];
  var BOOLS = ['showParams', 'showReset', 'showExport', 'showInactive', 'showRatio', 'useWorkbookFont', 'includeHiddenCards', 'includeHiddenParams', 'checkAllSelected', 'ignoreNullOnly'];
  var inventory = null;
  var ov = { f: {}, p: {} };
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
    var o = c.overrides || {};
    ov = { f: assignObj({}, o.f), p: assignObj({}, o.p) };
    translate(c.language);
  }

  function assignObj (a, b) { for (var k in b || {}) a[k] = b[k]; return a; }

  // ---- Onglet « Contenu du récap » ----
  function renderContent () {
    $('invMissing').hidden = !!inventory;
    if (!inventory) return;
    drawList($('ovFilters'), inventory.filters, 'f', function (it) { return t(it.auto === 'card' ? 'cf_auto_card' : 'cf_auto_nocard'); });
    drawList($('ovParams'), inventory.params, 'p', function (it) { return it.auto === 'control' ? t('cf_auto_control', { c: it.control }) : t('cf_auto_nocontrol'); });
    var un = inventory.unlinked || [];
    $('unlinked').hidden = !un.length;
    if (un.length) $('unlinked').textContent = t('cf_unlinked', { list: un.join(', ') });
  }

  function drawList (wrap, items, kind, autoText) {
    wrap.textContent = '';
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
      row.appendChild(txt); row.appendChild(sel);
      wrap.appendChild(row);
    });
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
    var hasOv = Object.keys(ov.f).length || Object.keys(ov.p).length;
    c.overrides = hasOv ? { f: ov.f, p: ov.p } : null;
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
