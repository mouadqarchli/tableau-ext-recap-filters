/* Configuration dialog — Filters & parameters recap */
(function () {
  'use strict';
  var KEY = 'recapConfig';
  var DEFAULTS = {
    title: '', language: 'en', accent: '#ff6d00', theme: 'light', density: 'comfortable', layout: 'auto',
    showParams: true, showReset: true, showExport: true, showInactive: false, showRatio: true, maxChips: 4,
    useWorkbookFont: true, includeHiddenCards: true, checkAllSelected: true, ignoreNullOnly: true
  };
  var PALETTE = ['#ff6d00', '#111827', '#5b5fc7', '#0969da', '#0e9f6e', '#c2410c', '#be185d', '#7c3aed', '#b08d57'];
  var BOOLS = ['showParams', 'showReset', 'showExport', 'showInactive', 'showRatio', 'useWorkbookFont', 'includeHiddenCards', 'checkAllSelected', 'ignoreNullOnly'];
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
    translate(c.language);
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
    tableau.extensions.initializeDialogAsync().then(function (payload) {
      try { envLang = tableau.extensions.environment.language; } catch (e) { envLang = ''; }
      var current = {};
      try { current = JSON.parse(tableau.extensions.settings.get(KEY) || payload || '{}'); } catch (e) { current = {}; }
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
      $('btnReset').addEventListener('click', function () { fill(DEFAULTS); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
