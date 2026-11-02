/* Export window — full, readable report of the filters & parameters */
(function () {
  'use strict';
  var I = window.RecapI18n;
  var t = I.make('en');
  var rep = null;
  var PREVIEW = 60; // values shown per filter before "Show all"

  function $ (id) { return document.getElementById(id); }
  function h (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function modeLabel (m) {
    return t({ include: 'ex_mode_include', exclude: 'ex_mode_exclude', except: 'ex_mode_except', range: 'ex_mode_range', date: 'ex_mode_date', param: 'ex_mode_param' }[m] || 'ex_mode_include');
  }

  function countLabel (f) {
    if (f.count == null) return '';
    if (f.mode === 'except') return t('ex_count_of', { n: f.count, total: f.total || '?' });
    return f.total ? t('ex_count_of', { n: f.count, total: f.total }) : t.plural(f.mode === 'exclude' ? 'excluded' : 'values', f.count);
  }

  function row (item, isParam) {
    var r = h('article', 'ex-row ex-row--' + item.mode);
    r.setAttribute('data-search', (item.name + ' ' + item.values.join(' ')).toLowerCase());
    var head = h('div', 'ex-row__head');
    head.appendChild(h('span', 'ex-row__name', item.name));
    if (!isParam) head.appendChild(h('span', 'ex-badge ex-badge--' + item.mode, modeLabel(item.mode)));
    var cnt = countLabel(item);
    if (cnt) head.appendChild(h('span', 'ex-row__count', cnt));
    r.appendChild(head);

    var vals = h('p', 'ex-row__values');
    var render = function (all) {
      vals.textContent = '';
      var list = all ? item.values : item.values.slice(0, PREVIEW);
      vals.appendChild(document.createTextNode(list.join(', ')));
      if (!all && item.values.length > PREVIEW) {
        vals.appendChild(document.createTextNode(' ' + t('ex_more', { n: item.values.length - PREVIEW }) + ' '));
        var b = h('button', 'link-btn', t('ex_show_all')); b.type = 'button';
        b.addEventListener('click', function () { render(true); });
        vals.appendChild(b);
      }
      if (item.truncated) vals.appendChild(h('span', 'ex-row__trunc', ' ' + t('ex_truncated')));
    };
    render(false);
    r.appendChild(vals);
    return r;
  }

  function draw () {
    $('exTitle').textContent = rep.title + (rep.dashboard ? ' — ' + rep.dashboard : '');
    $('exMeta').textContent = t('ex_exported', { d: rep.exportedLabel });
    $('exFiltersCount').textContent = rep.filters.length;
    $('exParamsCount').textContent = rep.params.length;
    var fWrap = $('exFilters'); fWrap.textContent = '';
    if (!rep.filters.length) fWrap.appendChild(h('p', 'ex__empty', t('ex_no_filter')));
    rep.filters.forEach(function (f) { fWrap.appendChild(row(f, false)); });
    var pWrap = $('exParams'); pWrap.textContent = '';
    $('exParamsSection').hidden = !rep.params.length;
    rep.params.forEach(function (p) { pWrap.appendChild(row(p, true)); });
  }

  // ---- formats ----
  function sep () { return t.lang === 'fr' ? ' : ' : ': '; }
  function asText () {
    var s = sep();
    var lines = [rep.title + (rep.dashboard ? ' — ' + rep.dashboard : ''), t('ex_exported', { d: rep.exportedLabel }), ''];
    lines.push(t('sec_filters').toUpperCase() + ' (' + rep.filters.length + ')');
    if (!rep.filters.length) lines.push('  ' + t('ex_no_filter'));
    rep.filters.forEach(function (f) {
      var prefix = f.mode === 'except' ? t('ex_mode_except') + ' ' : f.mode === 'exclude' ? t('ex_mode_exclude') + s : '';
      lines.push('• ' + f.name + s + prefix + f.values.join(', ') + (f.truncated ? ' ' + t('ex_truncated') : ''));
    });
    if (rep.params.length) {
      lines.push('', t('sec_params').toUpperCase() + ' (' + rep.params.length + ')');
      rep.params.forEach(function (p) { lines.push('• ' + p.name + s + p.values.join(', ')); });
    }
    return lines.join('\r\n');
  }

  function asCsv () {
    var d = t.lang === 'fr' ? ';' : ','; // séparateur attendu par Excel selon la langue
    var q = function (v) { v = v == null ? '' : String(v); return /[",;\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [[t('ex_col_type'), t('ex_col_name'), t('ex_col_mode'), t('ex_col_values'), t('ex_col_count'), t('ex_col_total')].map(q).join(d)];
    rep.filters.forEach(function (f) {
      lines.push([t('ex_type_filter'), f.name, modeLabel(f.mode), f.values.join(' | '), f.count == null ? '' : f.count, f.total || ''].map(q).join(d));
    });
    rep.params.forEach(function (p) {
      lines.push([t('ex_type_param'), p.name, modeLabel('param'), p.values.join(' | '), '', ''].map(q).join(d));
    });
    return '\ufeff' + lines.join('\r\n');
  }

  function fileName (ext) {
    var base = (rep.dashboard || 'dashboard').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'dashboard';
    return base + ' - filters ' + rep.exportedAt.slice(0, 16).replace('T', ' ').replace(':', 'h') + '.' + ext;
  }

  function download (content, ext, mime) {
    try {
      var blob = new Blob([content], { type: mime });
      if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, fileName(ext)); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = fileName(ext); a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    } catch (e) { copy(content); }
  }

  function copy (text) {
    var done = function () { toast(t('copied')); };
    var legacy = function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, legacy); else legacy();
  }

  var toastTimer = 0;
  function toast (msg) {
    var el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  function filterRows (q) {
    q = String(q || '').trim().toLowerCase();
    var rows = document.querySelectorAll('.ex-row');
    for (var i = 0; i < rows.length; i++) rows[i].hidden = !!q && rows[i].getAttribute('data-search').indexOf(q) === -1;
  }

  /* ---- Impression / PDF ----------------------------------------------
   * window.print() est bloqué dans les fenêtres d'extension (Tableau Desktop,
   * iframe Tableau Server). On ouvre donc le rapport dans le navigateur (le
   * navigateur par défaut, depuis Tableau Desktop), données passées dans l'URL
   * (#print/…, compressées), et l'impression s'y lance automatiquement.
   * ------------------------------------------------------------------- */
  var standalone = false;
  var printUrl = null;

  function toB64url (bytes) {
    var s = ''; var CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url (str) {
    var b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  function encodeReport (obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()
        .then(function (buf) { return 'z.' + toB64url(new Uint8Array(buf)); }, function () { return 'r.' + toB64url(bytes); });
    }
    return Promise.resolve('r.' + toB64url(bytes));
  }
  function decodeReport (code) {
    var kind = code.slice(0, 2); var bytes = fromB64url(code.slice(2));
    var text = kind === 'z.'
      ? new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).text()
      : Promise.resolve(new TextDecoder().decode(bytes));
    return text;
  }
  function baseUrl () { return window.location.href.split('#')[0]; }
  function prepPrintUrl () {
    printUrl = null;
    encodeReport(rep).then(function (code) { printUrl = baseUrl() + '#print/' + code; });
  }

  function doPrint () {
    if (standalone) { expandAll(); setTimeout(function () { window.print(); }, 50); return; }
    // URL préparée à l'avance : l'ouverture reste synchrone (sinon bloquée comme pop-up).
    var url = printUrl || (baseUrl() + '#print/r.' + toB64url(new TextEncoder().encode(JSON.stringify(rep))));
    var w = null;
    try { w = window.open(url, '_blank'); } catch (e) { w = null; }
    if (!w) { expandAll(); try { window.print(); } catch (e) { /* ignore */ } }
  }

  function expandAll () { PREVIEW = 1e9; draw(); filterRows($('search').value); }

  function close () { if (standalone) { window.close(); return; } try { tableau.extensions.ui.closeDialog('closed'); } catch (e) { window.close(); } }

  function start (payload) {
    try { rep = JSON.parse(payload); } catch (e) { rep = null; }
    if (!rep) { document.body.textContent = 'No data.'; return; }
    t = I.make(rep.lang || 'en');
    I.apply(document, t);
    document.title = t('ex_title');
    if (rep.accent) document.documentElement.style.setProperty('--accent', rep.accent);
    draw();
    $('btnCopy').addEventListener('click', function () { copy(asText()); });
    $('btnCsv').addEventListener('click', function () { download(asCsv(), 'csv', 'text/csv;charset=utf-8'); });
    $('btnTxt').addEventListener('click', function () { download(asText(), 'txt', 'text/plain;charset=utf-8'); });
    $('btnPrint').addEventListener('click', doPrint);
    $('btnPrint').title = standalone ? '' : t('ex_print_hint');
    if (!standalone) prepPrintUrl();
    else {
      document.body.classList.add('is-standalone');
      document.title = fileName('pdf').replace(/\.pdf$/, ''); // nom proposé pour le PDF
    }
    $('btnClose').addEventListener('click', close);
    $('search').addEventListener('input', function (e) { filterRows(e.target.value); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  function init () {
    var m = /^#(print|view)\/(.+)$/.exec(window.location.hash || '');
    if (m) { // ouvert dans le navigateur : pas d'API Tableau, données dans l'URL
      standalone = true;
      decodeReport(m[2]).then(function (json) {
        start(json);
        if (m[1] === 'print') { expandAll(); setTimeout(function () { window.print(); }, 400); }
      }, function () { document.body.textContent = 'Unable to read the report.'; });
      return;
    }
    if (window.tableau && tableau.extensions && tableau.extensions.initializeDialogAsync) {
      tableau.extensions.initializeDialogAsync().then(start);
    }
  }

  window.__recapExport = { encode: function (o) { return encodeReport(o); }, decode: function (c) { return decodeReport(c); }, start: start, asText: function () { return asText(); }, asCsv: function () { return asCsv(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
