/*!
 * Récap filtres & paramètres — Tableau Dashboard Extension
 * v2.0.0 — vanilla JS, aucune dépendance (hors Tableau Extensions API)
 *
 * Principes :
 *  - N'affiche QUE ce qui est exposé dans le dashboard : cartes de filtre et
 *    contrôles de paramètre visibles, dans l'ordre visuel du dashboard.
 *  - Mises à jour incrémentales : un changement de filtre ne relit que CE
 *    filtre (pas tous les worksheets) ; les filtres techniques non exposés
 *    sont ignorés sans aucun aller-retour vers Tableau.
 *  - Caches (domaines, métadonnées de champ), file d'attente sérialisée,
 *    rendu DOM « keyed » qui ne touche que les tuiles réellement modifiées.
 */
(function () {
  'use strict';

  /* =====================================================================
   * Configuration
   * ===================================================================== */
  var VERSION = '2.19.2';
  // Servie depuis /dev/ (branche develop) : badge DEV et cache local séparé de la prod
  var IS_DEV = /\/dev\//.test(window.location.pathname || '');
  var SETTINGS_KEY = 'recapConfig';
  var DEFAULTS = {
    title: '',               // vide = titre par défaut, traduit
    language: 'en',          // en | fr | auto (langue de Tableau)
    showExport: true,
    accent: '#A05546',       // bordeaux SMCP (palette limitée à la charte, cf. BRAND_ACCENTS)
    theme: 'light',          // light | ecru | dark | transparent
    density: 'comfortable',  // comfortable | compact
    layout: 'auto',          // auto | grid | bar
    showParams: true,
    showReset: true,
    showInactive: false,     // afficher aussi les filtres exposés sur « Tout »
    showRatio: true,         // barre « x sur N valeurs » (1 requête domaine / champ, mise en cache)
    maxChips: 4,
    useWorkbookFont: false,   // charte SMCP : Verdana / Georgia par défaut
    includeHiddenCards: true, // cartes dans un conteneur replié (panneau de filtres)
    includeHiddenParams: true, // contrôles de paramètre dans un conteneur replié
    sortOrder: 'alpha',       // alpha (ordre alphabétique) | dashboard (ordre du dashboard)
    showDataExport: true,     // bouton « Export data » (données des feuilles + récap)
    dataSheets: null,         // feuilles exportables (null = toutes les feuilles visibles)
    dataDefaults: null,       // feuilles cochées par défaut
    dataMaxRows: 1000000,     // plafond de lignes par feuille (Excel : 1 048 576 lignes max)
    dataColumns: null,        // { feuille: [{ n: nom, l: libellé, on: bool }] } ordre/choix manuels des colonnes
    dataValues: 'raw',        // raw (nombres/dates typés) | display (texte tel qu'affiché)
    csvSep: 'auto',           // auto (selon la langue du poste) | ';' | ',' | 'tab'
    overrides: null,          // { f: {cléFiltre: 'show'|'hide'}, p: {cléParam: 'show'|'hide'} } — par dashboard
    checkAllSelected: true,   // détecter « toutes les valeurs cochées une à une » (requête de fond)
    ignoreNullOnly: true      // « Tout sauf Null » = non restrictif (comme la carte « (Tout) »)
  };
  // Charte SMCP 2026 : couleurs d'accent autorisées (primaires + secondaires)
  var BRAND_ACCENTS = ['#a05546', '#28282d', '#8c9b69', '#aa8250', '#cdd7e1', '#faf073'];
  var t = window.RecapI18n.make('en'); // traductions (mises à jour par loadSettings)
  var EXCEPT_MAX = 12;        // au-delà, on affiche les valeurs retenues plutôt que les exclues
  var BAR_MAX_HEIGHT = 140;       // en dessous : mode bandeau automatique
  var PERSIST_TTL_MS = 12 * 3600e3; // cache local (domaines + dernier affichage)
  var DOMAIN_CONCURRENCY = 2;       // requêtes de domaine simultanées max (tâche de fond)
  var EVENT_DEBOUNCE_MS = 40;
  var LAYOUT_DEBOUNCE_MS = 150;
  var MAX_EXPANDED_CHIPS = 150;
  var XLSX_MAX_ROWS = 1048000;   // limite Excel : 1 048 576 lignes par onglet (en-tête + récap compris)
  var COPY_MAX_ROWS = 100000;     // au-delà, le presse-papiers échoue sans prévenir : export fichier conseillé
  var NO_VALUE_RE = /^\s*(|-|\u2013|\u2014|null|\(null\))\s*$/i; // paramètre « vide » (« - », « — »…)

  var GENERATED_NAME_RE = [
    /^measure names$/i, /^noms? de mesures?$/i,
    /^measure values$/i, /^valeurs? de mesures?$/i,
    /^number of records$/i, /^nombre d'?enregistrements$/i,
    /^(latitude|longitude)\s*\((generated|générée?)\)$/i
  ];

  var TYPE_META = {
    categorical: { cls: 'tile--cat', icon: 'i-list' },
    range: { cls: 'tile--range', icon: 'i-range' },
    'relative-date': { cls: 'tile--date', icon: 'i-calendar' },
    hierarchical: { cls: 'tile--tree', icon: 'i-tree' },
    other: { cls: 'tile--cat', icon: 'i-filter' }
  };
  var PARAM_ICON = { int: 'i-hash', float: 'i-hash', date: 'i-calendar', 'date-time': 'i-calendar', bool: 'i-toggle', string: 'i-text' };

  /* =====================================================================
   * État
   * ===================================================================== */
  var T = null;          // window.tableau
  var dashboard = null;
  var cfg = assign({}, DEFAULTS);

  var state = {
    filters: new Map(),        // key -> item affiché
    filterObjs: new Map(),     // key -> dernier objet Filter lu (évite de relire les worksheets)
    params: new Map(),         // key -> item
    fieldSheets: new Map(),    // key -> [worksheetName]
    exposedNames: new Set(),   // noms normalisés des filtres exposés (tri des événements)
    expanded: new Set(),       // tuiles dont la liste de valeurs est dépliée
    exposureSig: '',           // empreinte des cartes/contrôles : évite les relectures inutiles
    routes: null,              // { cards:Set, sheets:Set } : worksheets utiles à relire
    diag: [],                  // lignes du diagnostic
    diagOpen: false,
    stale: false,              // affichage issu du cache local, en attente de confirmation
    firstRenderDone: false
  };
  var caches = {
    domain: new Map(),         // key|range -> bornes ou null
    values: new Map(),         // key -> { vals:[libellés], nulls:Set } (mémoire uniquement)
    counts: new Map(),         // key -> nombre total de valeurs
    verdicts: new Map(),       // key|empreinte sélection -> { all, reason, missing, n }
    inflight: new Map()        // key|kind -> Promise
  };
  // Durées des appels à Tableau (affichées dans le diagnostic)
  var timings = [];
  function timed (label, p) {
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var done = function () {
      var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      timings.push({ label: label, ms: Math.round(t1 - t0), at: Date.now() });
      if (timings.length > 200) timings.splice(0, timings.length - 200);
      if (state.diagOpen) scheduleRender();
    };
    return Promise.resolve(p).then(function (v) { done(); return v; }, function (e) { done(); throw e; });
  }

  var listeners = {
    sheets: new Map(),         // worksheetName -> unregister
    params: new Map()          // paramKey -> unregister
  };
  var queue = { full: false, hard: false, fields: new Map(), params: new Map(), timer: 0, running: false };

  var el = {};

  /* =====================================================================
   * Bootstrap
   * ===================================================================== */
  function boot () {
    cacheDom();
    if (IS_DEV) {
      el.app.classList.add('is-dev');
      var badge = document.createElement('span'); badge.className = 'dev-badge'; badge.textContent = 'DEV'; badge.title = 'develop';
      el.title.parentNode.parentNode.insertBefore(badge, el.title.parentNode); // entre l'icône et le titre
    }
    T = window.tableau;
    if (!T || !T.extensions) {
      fail(t('err_lib'));
      return;
    }

    T.extensions.initializeAsync({ configure: openConfig }).then(function () {
      dashboard = T.extensions.dashboardContent.dashboard;
      loadSettings();
      applyAppearance();
      loadPersisted();          // affichage instantané depuis le dernier état connu
      wireUi();
      wireTableauEvents();
      schedule('full', null, 0);
    }, function (err) {
      fail(t('err_init', { e: errText(err) }));
    });
  }

  function cacheDom () {
    ['app', 'title', 'summary', 'btnRefresh', 'btnConfig', 'btnDiag', 'btnExport', 'btnData', 'btnClear', 'content', 'toast',
      'dataPanel', 'dxSheets', 'dxRecap', 'dxStatus', 'dxGo', 'dxCopy', 'dxSep', 'dxSepRow', 'dxCols', 'dxLimit',
      'errorBanner', 'errorMessage', 'btnRetry', 'emptyState',
      'filtersSection', 'filtersGrid', 'filtersCount',
      'paramsSection', 'paramsGrid', 'paramsCount', 'updatedAt', 'diagPanel', 'diagBody'
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  function wireUi () {
    el.btnRefresh.addEventListener('click', function () {
      spin(el.btnRefresh);
      schedule('hard', null, 0);
    });
    el.btnRetry.addEventListener('click', function () { schedule('hard', null, 0); });
    el.btnClear.addEventListener('click', onClearAllClick);
    el.btnDiag.addEventListener('click', toggleDiag);
    el.btnExport.addEventListener('click', openExport);
    el.btnData.addEventListener('click', toggleDataPanel);
    el.dxGo.addEventListener('click', function () {
      if (dx.busy) { dx.cancel = true; el.dxGo.disabled = true; return; } // bouton « Arrêter » pendant la lecture
      var partial = dx.allowPartial; dx.allowPartial = false;
      runDataExport('file', partial);
    });
    Array.prototype.forEach.call(el.dataPanel.querySelectorAll('input[name=dxFmt]'), function (r) { r.addEventListener('change', function () { resetPartial(); syncSepRow(); }); });
    el.dxCopy.addEventListener('click', function () {
      if (dx.pendingCopy != null) { copyPending(); return; } // 2e clic : copie dans le geste utilisateur
      runDataExport('copy');
    });
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) toggleDiag();
    });

    // Délégation : 1 seul listener pour toutes les tuiles.
    el.content.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!t) return;
      var action = t.getAttribute('data-action');
      if (action === 'close-diag') { toggleDiag(); return; }
      if (action === 'close-data') { el.dataPanel.hidden = true; return; }
      var tile = t.closest('.tile');
      var key = tile && tile.getAttribute('data-key');
      if (!key) return;
      if (action === 'expand') toggleExpand(key);
      else if (action === 'clear') clearOne(key);
    });

    // Bandeau : molette verticale -> défilement horizontal.
    el.content.addEventListener('wheel', function (e) {
      if (!el.app.classList.contains('is-bar') || !e.deltaY || e.deltaX) return;
      el.content.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    if (window.matchMedia) {
      var mq = window.matchMedia('(max-height: ' + BAR_MAX_HEIGHT + 'px)');
      var onMq = function () { applyLayout(); };
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    }

    // Boutons « Configurer » et « Diagnostic » : visibles uniquement en mode création.
    var authoring = false;
    try { authoring = T.extensions.environment.mode === 'authoring'; } catch (e) { /* ignore */ }
    el.btnConfig.hidden = !authoring;
    el.btnDiag.hidden = !authoring;
    el.btnConfig.addEventListener('click', openConfig);
  }

  function wireTableauEvents () {
    var E = T.TableauEventType;
    // Tableau émet cet événement très souvent (y compris après un simple
    // filtrage) : on ne relit que si les cartes/contrôles ont réellement changé.
    dashboard.addEventListener(E.DashboardLayoutChanged, function () {
      checkLayout();
      setTimeout(checkLayout, 400); // filet si les objets sont mis à jour après l'événement
    });
    try {
      T.extensions.settings.addEventListener(E.SettingsChanged, function () {
        loadSettings(); applyAppearance(); render();
      });
    } catch (e) { /* ignore */ }
    if (E.WorkbookFormattingChanged) {
      try { dashboard.addEventListener(E.WorkbookFormattingChanged, applyWorkbookFont); } catch (e) { /* ignore */ }
    }
  }

  function checkLayout () {
    if (exposureSignature() !== state.exposureSig) schedule('full', null, LAYOUT_DEBOUNCE_MS);
  }

  /* =====================================================================
   * File d'attente sérialisée (aucun appel concurrent, aucune réponse périmée)
   * ===================================================================== */
  function schedule (kind, payload, delay) {
    if (kind === 'full' || kind === 'hard') {
      queue.full = true;
      if (kind === 'hard') queue.hard = true;
    } else if (kind === 'field') {
      if (!queue.fields.has(payload.key)) queue.fields.set(payload.key, payload.ev);
    } else if (kind === 'param') {
      queue.params.set(payload.key, payload.ev);
    }
    clearTimeout(queue.timer);
    queue.timer = setTimeout(pump, delay == null ? EVENT_DEBOUNCE_MS : delay);
  }

  function pump () {
    if (queue.running) return; // la boucle en cours consommera les nouvelles demandes
    queue.running = true;
    setBusy(true);

    var step = function () {
      if (queue.full) {
        var hard = queue.hard;
        queue.full = false; queue.hard = false;
        queue.fields.clear(); queue.params.clear();
        return fullScan(hard);
      }
      var f = new Map(queue.fields); var p = new Map(queue.params);
      queue.fields.clear(); queue.params.clear();
      return incremental(f, p);
    };

    var loop = function () {
      if (!(queue.full || queue.fields.size || queue.params.size)) return Promise.resolve();
      return step().then(function () { hideError(); state.stale = false; render(); return loop(); });
    };

    loop().catch(function (err) {
      console.error('[recap] ', err);
      showError(t('err_read', { e: errText(err) }));
      render();
    }).then(function () {
      queue.running = false;
      setBusy(false);
      if (queue.full || queue.fields.size || queue.params.size) pump();
      else { enrichLater(); kickBackground(); }
    });
  }

  /* =====================================================================
   * Exposition : cartes de filtre et contrôles de paramètre du dashboard
   * ===================================================================== */
  function exposureObjects () {
    var DOT = T.DashboardObjectType;
    var qf = []; var pc = [];
    dashboard.objects.forEach(function (o) {
      if (o.type !== DOT.QuickFilter && o.type !== DOT.ParameterControl) return;
      // Une carte dans un conteneur replié (panneau de filtres « afficher/masquer »)
      // est isVisible=false mais fait bien partie du dashboard.
      var isQf = o.type === DOT.QuickFilter;
      if (o.isVisible === false && !(isQf ? cfg.includeHiddenCards : cfg.includeHiddenParams)) return;
      (isQf ? qf : pc).push(o);
    });
    qf.sort(byPosition); pc.sort(byPosition);
    return { qf: qf, pc: pc };
  }

  function exposureSignature () {
    var x = exposureObjects();
    return x.qf.concat(x.pc).map(function (o) {
      var p = o.position || {};
      return o.id + '|' + (o.fieldId || '') + '|' + o.name + '|' + (cfg.includeHiddenCards && cfg.includeHiddenParams ? '' : o.isVisible) +
        '|' + Math.round((p.x || 0) / 12) + ',' + Math.round((p.y || 0) / 12);
    }).join(';');
  }

  function readExposure () {
    var x = exposureObjects();
    var byId = new Map(); var byName = new Map(); var byBase = new Map();
    var cards = x.qf.map(function (o, i) {
      var card = { id: o.id, order: i, name: o.name || '', hidden: o.isVisible === false, fieldId: o.fieldId || '' };
      if (o.fieldId) {
        byId.set(o.fieldId, card);
        var b = baseKey(o.fieldId);
        if (b && !byBase.has(b)) byBase.set(b, card);
      }
      var n = norm(o.name);
      if (n && !byName.has(n)) byName.set(n, card);
      return card;
    });
    return {
      cards: cards,
      // Rapprochement filtre <-> carte, du plus strict au plus souple :
      // identifiant exact, nom affiché, puis champ de base (sans dérivation
      // « none: / yr: / :nk » qui diffère parfois entre carte et filtre).
      matchFilter: function (f) {
        if (f.fieldId && byId.has(f.fieldId)) return byId.get(f.fieldId);
        var n = norm(f.fieldName);
        if (n && byName.has(n)) return byName.get(n);
        var b = baseKey(f.fieldId);
        if (b && byBase.has(b)) return byBase.get(b);
        return null;
      },
      paramControls: x.pc.map(function (o, i) { return { id: o.id, name: o.name || '', order: i, fieldId: o.fieldId || '', hidden: o.isVisible === false }; })
    };
  }

  function baseKey (fieldId) {
    var m = /^\[(.*?)\]\.\[(.*)\]$/.exec(String(fieldId || ''));
    if (!m) return '';
    var f = m[2].replace(/^[a-z]{2,8}:/i, '').replace(/:[a-z]{1,3}(:\d+)?$/i, '');
    return m[1] + '|' + norm(f);
  }

  // Ordre de lecture : par ligne (tolérance 12 px), puis de gauche à droite.
  function byPosition (a, b) {
    var pa = a.position || { x: 0, y: 0 }; var pb = b.position || { x: 0, y: 0 };
    var ra = Math.round(pa.y / 12); var rb = Math.round(pb.y / 12);
    return ra !== rb ? ra - rb : pa.x - pb.x;
  }

  /* =====================================================================
   * Lecture complète (init, changement de cartes, actualisation)
   * ===================================================================== */
  function fullScan (hard, forceAll) {
    if (hard) { caches.domain.clear(); caches.values.clear(); caches.counts.clear(); caches.verdicts.clear(); caches.inflight.clear(); state.routes = null; }
    var exposure = readExposure();
    state.exposureSig = exposureSignature();
    var all = dashboard.worksheets;
    syncSheetListeners(all);

    // Routage : on ne relit que les worksheets qui portaient les cartes la
    // fois précédente (souvent 1 ou 2 au lieu de tous).
    var routed = !forceAll && !state.diagOpen && state.routes &&
      exposure.cards.every(function (c) { return state.routes.cards.has(c.id); });
    // Première lecture : d'abord les feuilles visibles du dashboard ; les feuilles
    // techniques masquées ne sont lues que si une carte reste sans filtre.
    var phase1 = !routed && !forceAll && !state.diagOpen;
    var visibleNames = {};
    if (phase1) {
      dashboard.objects.forEach(function (o) {
        if (o.type === T.DashboardObjectType.Worksheet && o.isVisible !== false) visibleNames[o.worksheet ? o.worksheet.name : o.name] = true;
      });
    }
    var targets = routed ? all.filter(function (ws) { return state.routes.sheets.has(ws.name); }) :
      phase1 ? all.filter(function (ws) { return visibleNames[ws.name]; }) : all;
    var scanStart = Date.now();

    var filtersP = Promise.all(targets.map(function (ws) {
      return timed(t('tm_filters', { s: ws.name }), ws.getFiltersAsync()).then(
        function (fs) { return { ws: ws, fs: fs }; },
        function (err) { console.warn('[recap] getFiltersAsync', ws.name, err); return { ws: ws, fs: [], err: err }; }
      );
    }));
    var paramsP = cfg.showParams ? readExposedParams(exposure.paramControls) : Promise.resolve([]);
    state.paramDiag = [];

    return Promise.all([filtersP, paramsP]).then(function (res) {
      var byKey = new Map(); var fieldSheets = new Map(); var diag = [];
      var matchedCards = new Set(); var usefulSheets = new Set();
      var ov = overrides(); var forcedIdx = 0;

      res[0].forEach(function (r) {
        if (r.err) diag.push({ sheet: r.ws.name, field: '—', type: '—', status: t('st_read_err'), tone: 'err' });
        r.fs.forEach(function (f) {
          var key = filterKey(f);
          var o = ov.f[key];
          var card = exposure.matchFilter(f);
          var row = { sheet: r.ws.name, field: f.fieldName, type: f.filterType, status: '', tone: 'off' };
          diag.push(row);
          if (o === 'hide') { if (card) matchedCards.add(card.id); row.status = t('st_forced_hide'); return; }
          if (!card && o !== 'show') { row.status = t('st_no_card'); return; }
          if (!card) {
            var prevForced = byKey.get(key);
            card = prevForced ? prevForced.card : { id: 'forced:' + key, order: 1000 + (forcedIdx++), hidden: false, forced: true, virtual: true };
          } else if (o === 'show') card = assign({}, card, { forced: true });
          if (isGeneratedName(f.fieldName) && o !== 'show') { matchedCards.add(card.id); row.status = t('st_generated'); return; }
          if (!card.virtual) matchedCards.add(card.id);
          usefulSheets.add(r.ws.name);
          if (!fieldSheets.has(key)) fieldSheets.set(key, []);
          fieldSheets.get(key).push(r.ws.name);
          if (byKey.has(key)) { row.status = t('st_dup'); return; }
          byKey.set(key, { f: f, card: card, row: row });
        });
      });

      // Cartes sans filtre correspondant trouvé en mode routé : relecture complète.
      var forcedMissing = Object.keys(ov.f).some(function (k) { return ov.f[k] === 'show' && !byKey.has(k); });
      if ((routed || phase1) && (matchedCards.size < exposure.cards.length || forcedMissing)) { state.routes = null; return fullScan(false, true); }
      timings.push({ label: t('tm_scan', { n: targets.length, total: all.length }), ms: Date.now() - scanStart, at: Date.now() });

      var fMap = new Map(); var objs = new Map(); var names = new Set();
      byKey.forEach(function (x, key) {
        var it = buildFilterItem(x.f, x.card);
        if (x.card.forced) { it.forced = true; finalize(it); }
        objs.set(key, x.f);
        fMap.set(key, it);
        names.add(norm(x.f.fieldName));
        x.row.status = x.card.forced ? t('st_forced_show') : it.pending ? t('st_pending') :
          it.active ? t('st_shown') + (it.except ? t('st_shown_except') : '') + (x.card.hidden ? t('st_hidden_card') : '') :
          t(it.reason || 'st_all');
        x.row.tone = it.active || x.card.forced ? 'ok' : 'off';
      });
      exposure.cards.forEach(function (c) {
        if (!matchedCards.has(c.id)) diag.push({ sheet: '—', field: c.name, type: t('type_card'), status: t('st_card_nofilter'), tone: 'err' });
      });

      // Conserve les feuilles connues pour « effacer » quand la lecture est routée.
      if (routed || phase1) state.fieldSheets.forEach(function (v, k) { if (!fieldSheets.has(k)) fieldSheets.set(k, v); });

      state.filters = fMap;
      state.filterObjs = objs;
      state.fieldSheets = fieldSheets;
      state.exposedNames = names;
      state.routes = { cards: matchedCards, sheets: usefulSheets };
      if (!routed) state.diag = diag.concat(state.paramDiag || []);

      var pMap = new Map();
      res[1].forEach(function (it) { pMap.set(it.key, it); });
      state.params = pMap;
    });
  }

  /* =====================================================================
   * Mise à jour incrémentale (événements) : 1 seul appel par champ modifié
   * ===================================================================== */
  function incremental (fieldEvents, paramEvents) {
    var jobs = [];
    fieldEvents.forEach(function (ev) {
      jobs.push(ev.getFilterAsync().then(function (f) {
        var key = filterKey(f);
        var prev = state.filters.get(key);
        if (!prev) { queue.full = true; return; } // nouveau filtre exposé -> relecture complète
        state.filterObjs.set(key, f);
        var nextIt = buildFilterItem(f, { order: prev.order, hidden: prev.hiddenCard });
        if (prev.forced) { nextIt.forced = true; finalize(nextIt); }
        state.filters.set(key, nextIt);
      }, function () { queue.full = true; }));
    });
    paramEvents.forEach(function (ev, key) {
      jobs.push(ev.getParameterAsync().then(function (p) {
        var prev = state.params.get(key);
        if (prev) state.params.set(key, buildParamItem(p, prev.order, prev.label));
      }, function () { queue.full = true; }));
    });
    return Promise.all(jobs);
  }

  function syncSheetListeners (sheets) {
    var E = T.TableauEventType;
    var alive = new Set();
    sheets.forEach(function (ws) {
      alive.add(ws.name);
      if (listeners.sheets.has(ws.name)) return;
      listeners.sheets.set(ws.name, ws.addEventListener(E.FilterChanged, onFilterChanged));
    });
    listeners.sheets.forEach(function (unreg, name) {
      if (!alive.has(name)) { safeCall(unreg); listeners.sheets.delete(name); }
    });
  }

  function onFilterChanged (ev) {
    if (ev.fieldName == null) { schedule('full'); return; }
    // Filtre technique / non exposé : ignoré sans aucun appel à Tableau.
    var n = norm(ev.fieldName);
    if (!state.exposedNames.has(n)) return;
    schedule('field', { key: n, ev: ev });
  }

  /* =====================================================================
   * Filtres -> modèle d'affichage (synchrone : aucune requête bloquante)
   * Les domaines (« toutes les valeurs cochées ? », bornes, totaux) sont
   * calculés en tâche de fond puis mis en cache.
   * ===================================================================== */
  function buildFilterItem (f, card) {
    var key = filterKey(f);
    var type = f.filterType;
    var custom = overrides().labels[key];
    var base = { key: key, kind: 'filter', type: type, label: custom || f.fieldName, fieldName: f.fieldName, order: card.order, hiddenCard: !!card.hidden, needs: null };

    if (type === 'categorical') return buildCategorical(f, base);
    if (type === 'range') return buildRange(f, base);
    if (type === 'relative-date') return finalize(assign(base, buildRelative(f)));
    var vals = (f.appliedValues || []).map(fmt);
    return finalize(assign(base, {
      type: type === 'hierarchical' ? 'hierarchical' : 'other',
      active: true, values: vals, exclude: false
    }));
  }

  // Intelligence d'affichage des filtres « liste » :
  //  - toutes les valeurs cochées (ou seule « Null » décochée)  -> masqué
  //  - peu de valeurs décochées                                  -> « Sauf X, Y »
  //  - sinon                                                     -> valeurs retenues
  // Tant que le verdict n'est pas connu, la tuile reste cachée (pas d'apparition
  // puis disparition) ; le verdict est mémorisé 12 h.
  function buildCategorical (f, base) {
    var key = base.key;
    var values = (f.appliedValues || []).map(fmt);
    var exclude = !!f.isExcludeMode;
    var item = assign(base, { values: values, exclude: exclude, total: undefined, except: null, pending: false });

    if (f.isAllSelected || values.length === 0) {
      item.active = false; item.total = null; item.reason = 'st_all';
      return finalize(item);
    }
    var count = caches.counts.has(key) ? caches.counts.get(key) : undefined;
    if (count != null) item.total = count;

    if (exclude) {
      item.active = true;
      return finalize(item);
    }

    if (!cfg.checkAllSelected || overrides().nc[key]) {
      item.active = true;
      if (overrides().nc[key]) { item.total = count != null ? count : undefined; return finalize(item); } // aucune requête de valeurs
      return finalize(item);
    }

    var vkey = key + '|' + hashList(values);
    var v = caches.verdicts.get(vkey);
    if (!v) {
      var dom = caches.values.get(key);
      if (dom) { v = computeVerdict(dom, values); caches.verdicts.set(vkey, v); persistSoon(); }
    }
    if (!v) {
      if (values.length === 1) {
        item.active = true; // une seule valeur retenue : forcément restrictif, affiché tout de suite
          return finalize(item);
      }
      item.active = true; item.pending = true; item.needs = 'verdict';
      return finalize(item);
    }

    item.total = v.n;
    if (v.all) { item.active = false; item.reason = v.reason; return finalize(item); }
    item.active = true;
    if (v.missing && v.missing.length && v.missing.length < values.length && v.missing.length <= EXCEPT_MAX) item.except = v.missing;
    return finalize(item);
  }

  function computeVerdict (dom, values) {
    var sel = new Set(values);
    var missing = []; var onlyNull = true;
    for (var i = 0; i < dom.vals.length; i++) {
      var val = dom.vals[i];
      if (!sel.has(val)) { missing.push(val); if (!dom.nulls.has(val)) onlyNull = false; }
    }
    var v = { n: dom.vals.length, all: false, reason: '', missing: null, missingCount: missing.length };
    if (!missing.length) { v.all = true; v.reason = 'st_all_ticked'; }
    else if (onlyNull && cfg.ignoreNullOnly) { v.all = true; v.reason = 'st_null_only'; }
    else if (missing.length <= EXCEPT_MAX) v.missing = missing;
    return v;
  }

  function hashList (arr) {
    var h1 = 5381; var h2 = 52711;
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i];
      for (var j = 0; j < s.length; j++) { var c = s.charCodeAt(j); h1 = (h1 * 33) ^ c; h2 = (h2 * 33) ^ c; }
      h1 = (h1 * 33) ^ 124; h2 = (h2 * 33) ^ 59;
    }
    return arr.length + ':' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }

  function buildRange (f, base) {
    var min = f.minValue; var max = f.maxValue;
    var item = assign(base, {
      min: min && min.value != null ? fmt(min) : null,
      max: max && max.value != null ? fmt(max) : null,
      nulls: !!f.includeNullValues
    });
    if (item.min == null && item.max == null) { item.active = false; return finalize(item); }
    item.active = true;
    var d = domainPeek(base.key, 'range');
    if (d === undefined) { if (!overrides().nc[base.key]) item.needs = 'range'; return finalize(item); }
    if (d) {
      var a = item.min != null ? toNum(min.value) : d.lo;
      var b = item.max != null ? toNum(max.value) : d.hi;
      item.dMin = d.dMin; item.dMax = d.dMax;
      if (isFinite(a) && isFinite(b)) {
        item.pos = [clamp((a - d.lo) / (d.hi - d.lo)), clamp((b - d.lo) / (d.hi - d.lo))];
        // Curseur aux bornes du domaine = aucun filtrage réel.
        var eps = 1e-9 * Math.abs(d.hi - d.lo);
        if (a <= d.lo + eps && b >= d.hi - eps) item.active = false;
      }
    }
    return finalize(item);
  }

  function buildRelative (f) {
    var anchor = null;
    try { if (f.anchorDate && f.anchorDate.value != null) anchor = fmt(f.anchorDate); } catch (e) { /* ignore */ }
    return { active: true, text: t.relative(f.rangeType, f.periodType, f.rangeN), anchor: anchor };
  }

  /* =====================================================================
   * Domaines : tâche de fond, concurrence limitée, priorité à l'utilisateur
   * ===================================================================== */
  var bg = { tasks: [], active: 0 };

  function enrichLater () {
    state.filters.forEach(function (it) {
      if (!it.needs) return;
      var f = state.filterObjs.get(it.key);
      if (!f) return;
      fetchDomain(f, it.needs).then(function () {
        var cur = state.filterObjs.get(it.key); var curItem = state.filters.get(it.key);
        if (!cur || !curItem) return;
        var nx = buildFilterItem(cur, { order: curItem.order, hidden: curItem.hiddenCard });
        if (curItem.forced) { nx.forced = true; finalize(nx); }
        state.filters.set(it.key, nx);
        scheduleRender();
      });
    });
  }

  function domainPeek (key, kind) {
    var k = key + '|' + kind;
    return caches.domain.has(k) ? caches.domain.get(k) : undefined;
  }

  // kind : 'verdict' (prioritaire : conditionne l'affichage), 'ratio' (confort), 'range'
  function fetchDomain (f, kind) {
    var key = filterKey(f);
    var k = key + '|' + (kind === 'range' ? 'range' : 'cat');
    if (kind === 'range' && caches.domain.has(k)) return Promise.resolve();
    if (kind !== 'range' && caches.values.has(key)) return Promise.resolve();
    if (caches.inflight.has(k)) return caches.inflight.get(k);
    var p = new Promise(function (resolve) {
      var task = function () {
        return timed(t('tm_domain', { f: f.fieldName }), f.getDomainAsync(T.FilterDomainType.Database)).then(function (d) {
          if (kind === 'range') { caches.domain.set(k, rangeInfo(d)); return; }
          var vals = []; var nulls = new Set();
          ((d && d.values) || []).forEach(function (dv) {
            var s = fmt(dv); vals.push(s);
            if (dv.value == null || s === '' || /^(null|\(null\))$/i.test(s)) nulls.add(s);
          });
          caches.values.set(key, { vals: vals, nulls: nulls });
          caches.counts.set(key, vals.length);
        }, function () {
          if (kind === 'range') caches.domain.set(k, null);
          else { caches.values.set(key, { vals: [], nulls: new Set(), failed: true }); }
        }).then(function () {
          caches.inflight.delete(k); persistSoon(); resolve();
        });
      };
      if (kind === 'verdict') bg.tasks.unshift(task); else bg.tasks.push(task);
      kickBackground();
    });
    caches.inflight.set(k, p);
    return p;
  }

  function kickBackground () {
    // Les requêtes de fond ne passent jamais devant une interaction utilisateur.
    while (!queue.running && bg.active < DOMAIN_CONCURRENCY && bg.tasks.length) {
      var task = bg.tasks.shift();
      bg.active++;
      task().then(function () { bg.active--; kickBackground(); });
    }
  }

  function rangeInfo (d) {
    if (!d || !d.min || !d.max) return null;
    var lo = toNum(d.min.value); var hi = toNum(d.max.value);
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return null;
    return { lo: lo, hi: hi, dMin: fmt(d.min), dMax: fmt(d.max) };
  }

  /* =====================================================================
   * Persistance locale (12 h) : verdicts, totaux, bornes, feuilles utiles,
   * dernier affichage. Les listes de valeurs complètes restent en mémoire.
   * ===================================================================== */
  // Clé propre à CE dashboard (le stockage est partagé par tous les classeurs
  // servis depuis la même adresse : un simple nom « Overview » ne suffit pas).
  var storeId = '';
  function storeKey (kind) {
    if (!storeId && dashboard) {
      var parts = [dashboard.name];
      dashboard.worksheets.forEach(function (w) { parts.push(w.name); });
      dashboard.objects.forEach(function (o) { parts.push(o.type + ':' + o.name); });
      storeId = hashList(parts);
    }
    return 'recap:' + (IS_DEV ? 'dev:' : '') + VERSION + ':' + kind + ':' + storeId;
  }

  function loadPersisted () {
    try {
      var c = JSON.parse(localStorage.getItem(storeKey('cache')) || 'null');
      if (c && Date.now() - c.t < PERSIST_TTL_MS) {
        (c.dom || []).forEach(function (e) { caches.domain.set(e[0], e[1]); });
        (c.counts || []).forEach(function (e) { caches.counts.set(e[0], e[1]); });
        (c.verdicts || []).forEach(function (e) { caches.verdicts.set(e[0], e[1]); });
        if (c.routes) state.routes = { cards: new Set(c.routes.cards), sheets: new Set(c.routes.sheets) };
      }
      var snap = JSON.parse(localStorage.getItem(storeKey('snap')) || 'null');
      if (snap && Date.now() - snap.t < PERSIST_TTL_MS) {
        snap.f.forEach(function (it) { state.filters.set(it.key, it); state.exposedNames.add(norm(it.fieldName || it.label)); });
        snap.p.forEach(function (it) { state.params.set(it.key, it); });
        state.stale = true;
        render();
      }
    } catch (e) { /* stockage indisponible : ignoré */ }
  }

  var persistTimer = 0;
  function persistSoon () {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      try {
        var toArr = function (m, max) { var a = []; m.forEach(function (v, k) { if (!max || a.length < max) a.push([k, v]); }); return a; };
        localStorage.setItem(storeKey('cache'), JSON.stringify({
          t: Date.now(), dom: toArr(caches.domain), counts: toArr(caches.counts), verdicts: toArr(caches.verdicts, 400),
          routes: state.routes ? { cards: Array.from(state.routes.cards), sheets: Array.from(state.routes.sheets) } : null
        }));
        var f = []; state.filters.forEach(function (it) { f.push(it); });
        var p = []; state.params.forEach(function (it) { p.push(it); });
        localStorage.setItem(storeKey('snap'), JSON.stringify({ t: Date.now(), f: f, p: p }));
      } catch (e) { /* quota / stockage indisponible */ }
    }, 600);
  }

  /* =====================================================================
   * Paramètres
   * ===================================================================== */
  function readExposedParams (controls) {
    var ov = overrides();
    var anyForced = Object.keys(ov.p).some(function (k) { return ov.p[k] === 'show'; });
    if (!controls.length && !anyForced) { syncParamListeners([]); state.paramDiag = []; return Promise.resolve([]); }
    return timed(t('tm_params'), dashboard.getParametersAsync()).then(function (params) {
      var res = matchParams(params, controls);
      var diag = [];
      var shown = [];
      var matchedKeys = new Set();
      res.matched.forEach(function (m) {
        var key = paramKey(m.p);
        matchedKeys.add(key);
        if (ov.p[key] === 'hide') { diag.push(pRow(m.label, t('st_forced_hide'), 'off')); return; }
        shown.push(m);
        diag.push(pRow(m.label + (m.p.name !== m.label ? ' → ' + m.p.name : ''), t(ov.p[key] === 'show' ? 'st_forced_show' : m.manual ? 'st_p_manual' : 'st_p_shown') + (m.hidden ? t('st_hidden_control') : ''), 'ok'));
      });
      res.unmatched.forEach(function (c) { diag.push(pRow(c.name, t('st_p_unlinked'), 'err')); });
      var extra = 0;
      params.forEach(function (p) {
        var key = paramKey(p);
        if (matchedKeys.has(key)) return;
        if (ov.p[key] === 'show') {
          shown.push({ p: p, order: 1000 + (extra++), label: p.name });
          diag.push(pRow(p.name, t('st_forced_show'), 'ok'));
        } else diag.push(pRow(p.name, t('st_p_nocontrol'), 'off'));
      });
      state.paramDiag = diag;
      syncParamListeners(shown);
      return shown.map(function (m) { return buildParamItem(m.p, m.order, m.label); });
    });
  }

  // Un paramètre sans valeur (« - », « — », vide) n'apporte rien : tuile masquée, absent des exports
  function hasParamValue (it) { return !NO_VALUE_RE.test(String(it.text == null ? '' : it.text)); }

  // Colonnes pilotées par un paramètre : une colonne (ou un filtre) qui porte le nom d'un
  // paramètre texte (ex. « Customer Dimension 1 ») est renommée avec la valeur actuelle de ce
  // paramètre (ex. « Customer Name ») dans les exports. Lecture fraîche de TOUS les paramètres.
  function paramRenamer () {
    if (!dashboard) return Promise.resolve(null);
    return dashboard.getParametersAsync().then(function (params) {
      var map = {};
      var add = function (name, v) { var k = norm(name); if (k && !map[k]) map[k] = v; };
      params.forEach(function (p) {
        if (p.dataType && p.dataType !== 'string') return; // « Top N = 10 » ne renomme rien
        var cv = p.currentValue || {};
        var v = String(cv.formattedValue != null && cv.formattedValue !== '' ? cv.formattedValue : cv.value == null ? '' : cv.value).trim();
        if (NO_VALUE_RE.test(v)) return;
        add(p.name, v);
        var it = state.params.get(paramKey(p));
        if (it && it.label) add(it.label, v); // libellé du contrôle s'il diffère du nom du paramètre
      });
      if (!Object.keys(map).length) return null;
      return function (name) {
        var raw = String(name == null ? '' : name).trim();
        var m = /^[A-Za-z]+\((.*)\)$/.exec(raw); // ATTR(Customer Dimension 1)
        return map[norm(m ? m[1] : raw)] || null;
      };
    }, function (e) { console.warn('[recap] parameters for column names', e); return null; });
  }

  function pRow (name, status, tone) { return { sheet: '—', field: name, type: t('type_param'), status: status, tone: tone }; }

  // L'API ne relie pas explicitement un contrôle à son paramètre. Ordre des
  // tentatives : identifiant (si Tableau le fournit), nom exact, nom
  // normalisé, puis nom partiel UNIQUEMENT s'il n'y a qu'un seul candidat
  // (évite d'associer « Season » au mauvais « Catalog Season Code 1/2 »).
  function matchParams (params, controls) {
    var taken = new Set(); var matched = []; var pending = controls.slice();
    var idOf = function (s) { return norm(String(s || '').replace(/^\[parameters\]\./i, '')); };
    var take = function (p, c, manual) { taken.add(paramKey(p)); matched.push({ p: p, order: c.order, label: c.name, hidden: !!c.hidden, manual: !!manual }); };
    // 1) Associations forcées dans Configure > Recap content
    var pc = overrides().pc;
    params.forEach(function (p) {
      var m = pc[paramKey(p)];
      if (!m) return;
      if (m.id === 'none') { taken.add(paramKey(p)); return; } // « aucun contrôle » : pas d'association auto
      var c = null;
      for (var i = 0; i < pending.length && !c; i++) if (String(pending[i].id) === String(m.id)) c = pending[i];
      for (var j = 0; j < pending.length && !c; j++) if (pending[j].name === m.name) c = pending[j];
      if (c) { take(p, c, true); pending = pending.filter(function (x) { return x !== c; }); }
    });
    var exactPasses = [
      function (p, c) { return c.fieldId && p.id && (c.fieldId === p.id || idOf(c.fieldId) === idOf(p.id)); },
      function (p, c) { return p.name === c.name; },
      function (p, c) { return norm(p.name) && norm(p.name) === norm(c.name); }
    ];
    exactPasses.forEach(function (test) {
      pending = pending.filter(function (c) {
        for (var i = 0; i < params.length; i++) {
          var p = params[i];
          if (!taken.has(paramKey(p)) && test(p, c)) { take(p, c); return false; }
        }
        return true;
      });
    });
    pending = pending.filter(function (c) {
      var b = norm(c.name);
      if (b.length < 4) return true;
      var cands = params.filter(function (p) {
        var a = norm(p.name);
        return !taken.has(paramKey(p)) && a.length >= 4 && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1);
      });
      if (cands.length !== 1) return true;
      take(cands[0], c);
      return false;
    });
    if (pending.length) console.info('[recap] parameter control(s) not linked:', pending.map(function (c) { return c.name; }).join(', '));
    return { matched: matched, unmatched: pending };
  }

  // f/p : 'show'|'hide' ; pc : paramètre -> { id, name } du contrôle (ou { id: 'none' }) ; labels : clé -> libellé
  function overrides () {
    var o = cfg.overrides || {};
    return { f: o.f || {}, p: o.p || {}, pc: o.pc || {}, labels: o.labels || {}, nc: o.nc || {} };
  }

  function syncParamListeners (matched) {
    var E = T.TableauEventType;
    var alive = new Set();
    matched.forEach(function (m) {
      var key = paramKey(m.p);
      alive.add(key);
      if (listeners.params.has(key)) return;
      listeners.params.set(key, m.p.addEventListener(E.ParameterChanged, function (ev) {
        schedule('param', { key: key, ev: ev });
      }));
    });
    listeners.params.forEach(function (unreg, key) {
      if (!alive.has(key)) { safeCall(unreg); listeners.params.delete(key); }
    });
  }

  // Libellé = nom du contrôle tel qu'affiché dans le dashboard (souvent plus
  // lisible que le nom technique du paramètre, ex. « p_top_n » -> « Top N »).
  function buildParamItem (p, order, label) {
    var cv = p.currentValue || {};
    var item = {
      key: paramKey(p), kind: 'param', type: 'param', label: overrides().labels[paramKey(p)] || (label && String(label).trim()) || p.name, paramName: p.name, order: order, active: true,
      dataType: p.dataType, text: cv.formattedValue != null ? String(cv.formattedValue) : '—'
    };
    var av = p.allowableValues;
    if (av && av.type === 'range' && av.minValue && av.maxValue) {
      var lo = toNum(av.minValue.value); var hi = toNum(av.maxValue.value); var v = toNum(cv.value);
      if (isFinite(lo) && isFinite(hi) && isFinite(v) && hi > lo) {
        item.pos = clamp((v - lo) / (hi - lo)); item.dMin = fmt(av.minValue); item.dMax = fmt(av.maxValue);
      }
    } else if (av && av.type === 'list' && av.allowableValues && av.allowableValues.length) {
      item.options = av.allowableValues.length;
    }
    return finalize(item);
  }

  /* =====================================================================
   * Rendu
   * ===================================================================== */
  var renderQueued = false;
  function scheduleRender () {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; render(); });
  }

  function render () {
    var pending = 0;
    var filters = sortedVisible(state.filters, function (it) {
      if (it.pending) { pending++; return false; } // verdict inconnu : pas d'apparition/disparition
      return it.active || it.forced || cfg.showInactive;
    });
    var params = cfg.showParams ? sortedVisible(state.params, hasParamValue) : [];
    var activeCount = filters.filter(function (it) { return it.active; }).length;

    reconcile(el.filtersGrid, filters);
    reconcile(el.paramsGrid, params);

    el.filtersSection.hidden = filters.length === 0;
    el.paramsSection.hidden = params.length === 0;
    el.filtersCount.textContent = activeCount + (cfg.showInactive && filters.length !== activeCount ? '/' + filters.length : '');
    el.paramsCount.textContent = params.length;
    el.emptyState.hidden = filters.length + params.length > 0 || !el.errorBanner.hidden;

    el.btnClear.hidden = !cfg.showReset;
    el.btnClear.disabled = activeCount === 0;
    if (activeCount === 0) disarm();

    el.summary.innerHTML = summaryHtml(activeCount, params.length) + (pending ? ' · <span class="muted">' + t('sum_pending', { n: pending }) + '</span>' : '');
    el.app.classList.remove('is-loading');
    el.app.classList.toggle('is-stale', !!state.stale);
    el.app.setAttribute('aria-busy', 'false');
    renderDiag();
    if (!state.stale) persistSoon();

    var now = new Date();
    el.updatedAt.textContent = t('updated', { time: pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()) });
    el.updatedAt.hidden = false;
    state.firstRenderDone = true;
  }

  function summaryHtml (nf, np) {
    if (!nf && !np) return escapeHtml(t('empty_title'));
    var parts = [];
    if (nf) parts.push(escapeHtml(t.plural('sum_filters', nf)).replace(String(nf), '<b>' + nf + '</b>'));
    if (np) parts.push(escapeHtml(t.plural('sum_params', np)).replace(String(np), '<b>' + np + '</b>'));
    return parts.join(' · ');
  }

  function sortedVisible (map, pred) {
    var arr = [];
    map.forEach(function (it) { if (!pred || pred(it)) arr.push(it); });
    var coll = window.Intl && Intl.Collator ? new Intl.Collator(t.lang, { numeric: true, sensitivity: 'base' }) : null;
    var byLabel = function (a, b) { return coll ? coll.compare(a.label, b.label) : a.label.localeCompare(b.label); };
    arr.sort(cfg.sortOrder === 'dashboard' ? function (a, b) { return a.order - b.order || byLabel(a, b); } : byLabel);
    return arr;
  }

  // Rendu « keyed » : création / mise à jour / déplacement minimal des tuiles.
  function reconcile (container, items) {
    var existing = new Map();
    for (var c = container.firstElementChild; c; c = c.nextElementSibling) existing.set(c.getAttribute('data-key'), c);

    items.forEach(function (it, i) {
      var sig = it.sig + (state.expanded.has(it.key) ? '|x' : '') + '|' + cfg.maxChips;
      var node = existing.get(it.key);
      if (node) {
        existing.delete(it.key);
        if (node.__sig !== sig) {
          var fresh = buildTile(it);
          fresh.__sig = sig;
          var changed = node.__val !== it.vsig;
          container.replaceChild(fresh, node);
          node = fresh;
          if (changed) flash(node);
        }
      } else {
        node = buildTile(it);
        node.__sig = sig;
        if (state.firstRenderDone) node.classList.add('is-new');
      }
      node.__val = it.vsig;
      var ref = container.children[i];
      if (ref !== node) container.insertBefore(node, ref || null);
    });
    existing.forEach(function (n) { n.remove(); });
  }

  function buildTile (it) {
    var isParam = it.kind === 'param';
    var meta = isParam ? { cls: 'tile--param', icon: PARAM_ICON[it.dataType] || 'i-param' } : (TYPE_META[it.type] || TYPE_META.other);

    var tile = h('article', 'tile ' + meta.cls + (it.exclude ? ' is-exclude' : '') + (it.except ? ' is-except' : '') + (it.active ? '' : ' is-inactive'));
    tile.setAttribute('data-key', it.key);
    tile.setAttribute('role', 'listitem');

    var head = h('header', 'tile__head');
    head.appendChild(icon(meta.icon, 'tile__icon'));
    var name = h('span', 'tile__name', it.label);
    name.title = it.paramName && it.paramName !== it.label ? it.label + ' (' + it.paramName + ')' : it.label;
    head.appendChild(name);
    var badge = null;
    if (it.exclude) badge = h('span', 'tile__badge', t('badge_excluded'));
    else if (it.except && it.active) badge = h('span', 'tile__badge', t('badge_except'));
    if (badge) { badge.title = t(it.exclude ? 'tip_excluded' : 'tip_except'); head.appendChild(badge); }
    tile.appendChild(head);

    var body = h('div', 'tile__body');
    tile.appendChild(body);
    if (isParam) renderParam(tile, body, it);
    else if (!it.active) body.appendChild(h('div', 'tile__value tile__value--muted', t('all_values')));
    else if (it.type === 'categorical' || it.type === 'hierarchical' || it.type === 'other') renderCategorical(tile, body, it);
    else if (it.type === 'range') renderRange(tile, body, it);
    else if (it.type === 'relative-date') renderRelative(tile, body, it);

    if (!isParam && it.active && cfg.showReset) {
      var btn = h('button', 'tile__clear');
      btn.type = 'button';
      btn.setAttribute('data-action', 'clear');
      btn.setAttribute('aria-label', t('clear_filter_aria', { name: it.label }));
      btn.title = t('clear_filter');
      btn.appendChild(svg('i-x'));
      tile.appendChild(btn);
    }
    return tile;
  }

  function renderCategorical (tile, body, it) {
    // Mode « sauf » : on montre les quelques valeurs décochées, plus lisible
    // que 45 valeurs retenues sur 47.
    var values = it.except || it.values || [];
    var expanded = state.expanded.has(it.key);
    var limit = expanded ? MAX_EXPANDED_CHIPS : Math.max(1, cfg.maxChips | 0);
    var chips = h('div', 'chips');
    var frag = document.createDocumentFragment();
    var n = Math.min(values.length, limit);
    for (var i = 0; i < n; i++) {
      var c = h('span', 'chip', values[i]);
      c.title = values[i] + '\n' + t(it.exclude ? 'tip_chip_excluded' : it.except ? 'tip_chip_except' : 'tip_chip_kept');
      frag.appendChild(c);
    }
    if (values.length > limit || expanded) {
      var more = h('button', 'chip chip--more', expanded ? t('show_less') : '+' + (values.length - limit));
      more.type = 'button';
      more.setAttribute('data-action', 'expand');
      more.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (!expanded) more.title = values.slice(limit, limit + 40).join('\n') + (values.length > limit + 40 ? '\n…' : '');
      frag.appendChild(more);
    }
    chips.appendChild(frag);
    body.appendChild(chips);

    // Plus de ligne « 1 valeur sur 4 / Toutes sauf 1 (4 sur 5) » ni de barre : l'étiquette SAUF / EXCLU
    // et les couleurs suffisent (retour utilisateurs v2.11)
  }

  function renderRange (tile, body, it) {
    var r = h('div', 'range');
    if (it.min != null && it.max != null) {
      r.appendChild(h('span', null, it.min)); r.appendChild(svg('i-arrow')); r.appendChild(h('span', null, it.max));
    } else if (it.min != null) {
      r.appendChild(h('span', 'range__op', '≥')); r.appendChild(h('span', null, it.min));
    } else {
      r.appendChild(h('span', 'range__op', '≤')); r.appendChild(h('span', null, it.max));
    }
    body.appendChild(r);
    if (it.pos) {
      var wrap = h('div', 'range-bar');
      wrap.appendChild(bar(it.pos[0], it.pos[1]));
      var ends = h('div', 'range-bar__ends');
      ends.appendChild(h('span', null, it.dMin)); ends.appendChild(h('span', null, it.dMax));
      wrap.appendChild(ends);
      tile.appendChild(wrap);
    }
    if (it.nulls) { var m = h('div', 'tile__meta'); m.appendChild(h('span', null, t('nulls_included'))); tile.appendChild(m); }
  }

  function renderRelative (tile, body, it) {
    var pill = h('span', 'pill-date', it.text);
    body.appendChild(pill);
    if (it.anchor) { var m = h('div', 'tile__meta'); m.appendChild(h('span', null, t('anchor', { d: it.anchor }))); tile.appendChild(m); }
  }

  function renderParam (tile, body, it) {
    var v = h('div', 'tile__value', it.text); v.title = it.text;
    body.appendChild(v);
    if (it.pos != null) {
      var wrap = h('div', 'range-bar');
      var b = h('div', 'bar bar--dot');
      var dot = h('span', 'bar__dot'); dot.style.left = (it.pos * 100).toFixed(2) + '%';
      b.appendChild(dot); wrap.appendChild(b);
      var ends = h('div', 'range-bar__ends');
      ends.appendChild(h('span', null, it.dMin)); ends.appendChild(h('span', null, it.dMax));
      wrap.appendChild(ends);
      tile.appendChild(wrap);
    }
  }

  function bar (from, to) {
    var b = h('div', 'bar');
    var f = h('span', 'bar__fill');
    f.style.left = (from * 100).toFixed(2) + '%';
    f.style.width = (Math.max(to - from, 0.015) * 100).toFixed(2) + '%';
    b.appendChild(f);
    return b;
  }

  function flash (node) {
    node.classList.remove('is-changed');
    // force reflow pour rejouer l'animation
    void node.offsetWidth;
    node.classList.add('is-changed');
  }

  function toggleExpand (key) {
    if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
    render();
  }

  /* =====================================================================
   * Actions : effacer un filtre / réinitialiser (affichage optimiste)
   * ===================================================================== */
  function markCleared (key) {
    var it = state.filters.get(key);
    if (!it || !it.active) return false;
    state.filters.set(key, finalize(assign({}, it, { active: false, needs: null })));
    return true;
  }

  function clearOne (key) {
    var it = state.filters.get(key);
    var sheets = state.fieldSheets.get(key) || [];
    if (!it || !sheets.length) return;
    markCleared(key);
    render(); // la tuile disparaît immédiatement ; Tableau confirme ensuite
    Promise.all(sheets.map(function (name) {
      var ws = findSheet(name);
      return ws ? ws.clearFilterAsync(it.fieldName || it.label).catch(function (e) { console.warn('[recap] clear', name, e); }) : null;
    })).then(function () {
      // Filet de sécurité si l'événement FilterChanged n'arrive pas.
      schedule('field', { key: norm(it.fieldName || it.label), ev: syntheticEvent(sheets[0], key) }, 300);
    });
  }

  var armTimer = 0;
  function onClearAllClick () {
    if (el.btnClear.disabled) return;
    if (!el.btnClear.classList.contains('is-armed')) {
      el.btnClear.classList.add('is-armed');
      el.btnClear.title = t('confirm_title');
      armTimer = setTimeout(disarm, 3500);
      return;
    }
    disarm();
    clearAll();
  }
  function disarm () {
    clearTimeout(armTimer);
    el.btnClear.classList.remove('is-armed');
    el.btnClear.title = t('reset_all');
  }

  // Ne touche QUE les filtres affichés par l'extension (jamais les filtres
  // techniques ni les paramètres).
  function clearAll () {
    var jobs = [];
    var targets = [];
    state.filters.forEach(function (it, key) { if (it.active) targets.push([it, key]); });
    targets.forEach(function (x) {
      markCleared(x[1]);
      (state.fieldSheets.get(x[1]) || []).forEach(function (name) {
        var ws = findSheet(name);
        if (ws) jobs.push(ws.clearFilterAsync(x[0].fieldName || x[0].label).catch(function (e) { console.warn('[recap] clear', name, e); }));
      });
    });
    render();
    Promise.all(jobs).then(function () { schedule('full', null, 0); });
  }

  function syntheticEvent (sheetName, key) {
    return {
      getFilterAsync: function () {
        var ws = findSheet(sheetName);
        if (!ws) return Promise.reject(new Error('worksheet'));
        return ws.getFiltersAsync().then(function (fs) {
          for (var i = 0; i < fs.length; i++) if (filterKey(fs[i]) === key) return fs[i];
          throw new Error('filter');
        });
      }
    };
  }

  /* =====================================================================
   * Export : rapport complet (toutes les valeurs) dans une fenêtre dédiée
   * ===================================================================== */
  var EXPORT_MAX_VALUES = 5000; // par filtre, pour garder la fenêtre fluide

  function buildReport (rename) {
    var now = new Date();
    var filters = sortedVisible(state.filters, function (it) { return it.active && !it.pending; }).map(function (it) {
      // Libellé personnalisé dans Configure : conservé ; sinon nom du champ remplacé par la valeur du paramètre
      var custom = overrides().labels[it.key];
      var r = { name: (!custom && rename && rename(it.label)) || it.label, type: it.type, mode: 'include', values: [], count: null, total: it.total || null, truncated: false };
      if (it.type === 'range') {
        r.mode = 'range';
        r.values = [it.min != null && it.max != null ? it.min + ' → ' + it.max : it.min != null ? '≥ ' + it.min : '≤ ' + it.max];
        if (it.nulls) r.values.push(t('nulls_included'));
      } else if (it.type === 'relative-date') {
        r.mode = 'date';
        r.values = [it.text + (it.anchor ? ' — ' + t('anchor', { d: it.anchor }) : '')];
      } else {
        var list = it.except || it.values || [];
        r.mode = it.exclude ? 'exclude' : it.except ? 'except' : 'include';
        r.count = it.except ? it.values.length : list.length;
        r.truncated = list.length > EXPORT_MAX_VALUES;
        r.values = list.slice(0, EXPORT_MAX_VALUES);
        r.listed = list.length;
      }
      return r;
    });
    var params = (cfg.showParams ? sortedVisible(state.params, hasParamValue) : []).map(function (it) {
      return { name: it.label, mode: 'param', values: [it.text] };
    });
    return {
      lang: t.lang,
      title: displayTitle(),
      dashboard: dashboard ? dashboard.name : '',
      exportedAt: now.toISOString(),
      exportedLabel: now.toLocaleString(t.lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
      accent: cfg.accent,
      csvSep: csvSep(cfg.csvSep),
      filters: filters,
      params: params
    };
  }

  function openExport () {
    paramRenamer().then(function (rn) { openExportWith(buildReport(rn)); });
  }

  function openExportWith (report) {
    var url = new URL('export.html', window.location.href).href;
    var opened = null;
    try {
      opened = T.extensions.ui.displayDialogAsync(url, JSON.stringify(report), { width: 760, height: 680 });
    } catch (e) { opened = null; }
    if (!opened) { copyText(reportToText(report, t), true); return; }
    opened.catch(function (err) {
      if (T.ErrorCodes && err && err.errorCode === T.ErrorCodes.DialogClosedByUser) return;
      console.warn('[recap] export dialog', err);
      copyText(reportToText(report, t), true); // repli : copie du récap en texte
    });
  }

  // Texte lisible (mail, Teams) — même format que la fenêtre d'export.
  function reportToText (rep, tr) {
    var sep = tr.lang === 'fr' ? ' : ' : ': ';
    var lines = [rep.title + (rep.dashboard ? ' — ' + rep.dashboard : ''), tr('ex_exported', { d: rep.exportedLabel }), ''];
    lines.push(tr('sec_filters').toUpperCase() + ' (' + rep.filters.length + ')');
    if (!rep.filters.length) lines.push('  ' + tr('ex_no_filter'));
    rep.filters.forEach(function (f) {
      var prefix = f.mode === 'except' ? tr('ex_mode_except') + ' ' : f.mode === 'exclude' ? tr('ex_mode_exclude') + sep : '';
      lines.push('• ' + f.name + sep + prefix + f.values.join(', ') + (f.truncated ? ' ' + tr('ex_truncated') : ''));
    });
    if (rep.params.length) {
      lines.push('', tr('sec_params').toUpperCase() + ' (' + rep.params.length + ')');
      rep.params.forEach(function (p) { lines.push('• ' + p.name + sep + p.values.join(', ')); });
    }
    return lines.join('\n');
  }

  // Renvoie une promesse : true si le texte est réellement dans le presse-papiers.
  // (Avant : « Copié » s'affichait même en cas d'échec, et l'ancien contenu restait collé.)
  function copyText (text, withToast) {
    return new Promise(function (resolve) {
      var legacy = function () {
        var ok = false;
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy') !== false; } catch (e) { console.warn('[recap] copy', e); ok = false; }
        document.body.removeChild(ta);
        resolve(ok);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function (e) { console.warn('[recap] clipboard', e); legacy(); });
      } else legacy();
    }).then(function (ok) {
      if (withToast) toast(t(ok ? 'copied' : 'copy_failed'));
      return ok;
    });
  }

  var toastTimer = 0;
  function toast (msg) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  /* =====================================================================
   * Export des données d'une ou plusieurs feuilles + récap (Excel / CSV)
   * Données récapitulatives (ce que montre la feuille, filtres appliqués) :
   * aucune permission « full data » n'est nécessaire.
   * ===================================================================== */
  var dx = { busy: false, pendingCopy: null, pendingRows: 0 };

  // Le presse-papiers refuse souvent une écriture lancée longtemps après le clic (lecture de
  // milliers de lignes) : le texte est alors gardé et le bouton devient « Copier maintenant ».
  function setPendingCopy (text, rows) {
    dx.pendingCopy = text; dx.pendingRows = rows || 0;
    el.dxCopy.textContent = t(text == null ? 'dx_copy' : 'dx_copy_now');
    el.dxCopy.classList.toggle('btn--primary', text != null);
  }
  function copyPending () {
    var text = dx.pendingCopy; var rows = dx.pendingRows;
    copyText(text).then(function (ok) {
      if (ok) { setPendingCopy(null); dxStatus(t('dx_copied', { n: rows.toLocaleString() }), 'ok'); }
      else dxStatus(t('dx_copy_failed'), 'err');
    });
  }

  function exportableSheets () {
    var DOT = T.DashboardObjectType; var list = []; var seen = {};
    dashboard.objects.slice().sort(byPosition).forEach(function (o) {
      if (o.type !== DOT.Worksheet || o.isVisible === false) return;
      var name = o.worksheet ? o.worksheet.name : o.name;
      if (!name || seen[name]) return;
      seen[name] = true; list.push(name);
    });
    if (Array.isArray(cfg.dataSheets)) list = list.filter(function (n) { return cfg.dataSheets.indexOf(n) !== -1; });
    return list;
  }

  function toggleDataPanel () {
    setPendingCopy(null);
    dx.allowPartial = false; if (!dx.busy) el.dxGo.textContent = t('dx_export');
    if (!el.dataPanel.hidden) { el.dataPanel.hidden = true; return; }
    var sheets = exportableSheets();
    var defs = Array.isArray(cfg.dataDefaults) && cfg.dataDefaults.length ? cfg.dataDefaults : sheets.slice(0, 1);
    el.dxSheets.textContent = '';
    if (!sheets.length) el.dxSheets.appendChild(h('p', 'dpanel__empty', t('dx_no_sheet')));
    sheets.forEach(function (name) {
      var lab = h('label', 'check');
      var cb = h('input'); cb.type = 'checkbox'; cb.value = name; cb.checked = defs.indexOf(name) !== -1;
      lab.appendChild(cb); lab.appendChild(h('span', null, name));
      el.dxSheets.appendChild(lab);
      cb.addEventListener('change', function () { resetPartial(); renderColPickers(); syncLimit(); });
    });
    dx.cols = {}; dx.pivot = {}; dx.rename = null;
    renderColPickers();
    paramRenamer().then(function (rn) { dx.rename = rn; renderColPickers(); });
    var desktop = false;
    try { desktop = T.extensions.environment.context === 'desktop'; } catch (e) { /* ignore */ }
    dxStatus(desktop ? t('dx_desktop_hint') : '', '');
    if (el.dxSep) el.dxSep.value = [';', ',', 'tab'].indexOf(cfg.csvSep) !== -1 ? cfg.csvSep : 'auto';
    syncSepRow();
    var vm = el.dataPanel.querySelector('input[name=dxVal][value=' + (cfg.dataValues === 'display' ? 'display' : 'raw') + ']');
    if (vm) vm.checked = true;
    el.dataPanel.hidden = false;
    el.content.scrollTop = 0;
  }

  function syncSepRow () {
    if (!el.dxSepRow) return;
    var f = el.dataPanel.querySelector('input[name=dxFmt]:checked');
    el.dxSepRow.hidden = !f || f.value !== 'csv';
    syncLimit();
    var autoOpt = el.dxSep && el.dxSep.querySelector('option[value=auto]');
    if (autoOpt) autoOpt.textContent = t('dx_sep_auto', { s: csvSep('auto') === ';' ? ';' : ',' });
  }

  /* ---- Limite de lignes ------------------------------------------------------
   * Les lignes passent par l'API Extensions page par page, puis le fichier entier est
   * construit en mémoire dans le navigateur avant d'être proposé au téléchargement
   * (une extension tourne dans un cadre isolé : pas d'écriture directe sur le disque).
   * Excel ne dépasse pas 1 048 576 lignes par onglet. Au-delà de la limite, l'utilisateur
   * est orienté vers Télécharger > Données de Tableau (export natif, sans limite). */
  function fileMaxRows (fmt) {
    var m = Math.max(1000, cfg.dataMaxRows | 0 || DEFAULTS.dataMaxRows);
    return fmt === 'xlsx' ? Math.min(m, XLSX_MAX_ROWS) : m;
  }

  /* Avec Measure Names / Values, Tableau envoie UNE LIGNE PAR MESURE : la limite porte sur ces
   * lignes lues, pas sur les lignes du fichier (une par combinaison de dimensions). Le message
   * annonce donc, feuille par feuille, le nombre de lignes réellement exportables : limite ÷ mesures. */
  function fileRowsFor (n, m) { return m > 1 ? Math.floor(n / m) : n; }
  var limitTok = 0;
  function syncLimit () {
    if (!el.dxLimit) return;
    var f = el.dataPanel.querySelector('input[name=dxFmt]:checked');
    var n = fileMaxRows(f ? f.value : 'xlsx');
    var names = dxSelection();
    var tok = ++limitTok;
    var paint = function (counts) {
      if (tok !== limitTok) return;
      el.dxLimit.textContent = '';
      var piv = names.filter(function (s) { return counts[s] > 1; });
      var line = function (txt, cls) { el.dxLimit.appendChild(h('span', 'dpanel__hintline' + (cls ? ' ' + cls : ''), txt)); };
      if (!piv.length) line(t('dx_limit_simple', { n: n.toLocaleString() }));
      else {
        names.forEach(function (s) {
          var m = counts[s];
          if (m > 1) line(t('dx_limit_pivot', { s: s, k: fileRowsFor(n, m).toLocaleString(), m: m, n: n.toLocaleString() }));
          else if (m === 0) line(t('dx_limit_sheet', { s: s, n: n.toLocaleString() }));
        });
        line(t('dx_limit_pivot_why', { n: n.toLocaleString() }), 'is-sub');
      }
      line(t('dx_limit_native'), 'is-sub');
    };
    var counts = {};
    names.forEach(function (s) { if (dx.pivot && dx.pivot[s] != null) counts[s] = dx.pivot[s]; });
    paint(counts);
    var todo = names.filter(function (s) { return counts[s] == null; });
    if (!todo.length) return;
    Promise.all(todo.map(function (s) {
      return loadSheetCols(s).then(function (a) { counts[s] = a.pivot > 1 ? a.pivot : 0; }, noop);
    })).then(function () { paint(counts); });
  }

  /* ---- Choix des colonnes par l'utilisateur final ---------------------------
   * Par feuille, liste dépliable des colonnes (ordre, libellés et choix par défaut
   * du concepteur dans Configure). Les choix de l'utilisateur sont mémorisés dans
   * son navigateur pour ce dashboard ; « Par défaut » revient au réglage du concepteur. */
  var readLock = Promise.resolve(); // Tableau n'accepte qu'un lecteur de données à la fois
  function withReader (fn) { var p = readLock.then(fn); readLock = p.then(noop, noop); return p; }
  function noop () {}

  function picksKey () { storeKey('x'); return 'recap:' + (IS_DEV ? 'dev:' : '') + 'cols:' + storeId; }
  function loadPicks () { try { return JSON.parse(localStorage.getItem(picksKey()) || '{}') || {}; } catch (e) { return {}; } }
  function sheetPick (name) { var p = loadPicks()[name]; return p && typeof p === 'object' ? p : null; }
  function saveSheetPick (name, pick) {
    var all = loadPicks();
    if (pick && Object.keys(pick).length) all[name] = pick; else delete all[name];
    try { localStorage.setItem(picksKey(), JSON.stringify(all)); } catch (e) { /* stockage indisponible : choix pour cette session */ }
  }

  function loadSheetCols (name) {
    if (!dx.cols[name]) {
      dx.cols[name] = withReader(function () {
        var ws = findSheet(name);
        if (!ws) throw new Error(t('dx_sheet_missing', { s: name }));
        return RS.sheetColumns(ws);
      });
      dx.cols[name].then(function (auto) { dx.pivot[name] = auto.pivot > 1 ? auto.pivot : 0; }, function () { delete dx.cols[name]; });
    }
    return dx.cols[name];
  }

  function renderColPickers () {
    if (!el.dxCols) return;
    var open = {};
    Array.prototype.forEach.call(el.dxCols.querySelectorAll('details[open]'), function (d) { open[d.getAttribute('data-sheet')] = true; });
    el.dxCols.textContent = '';
    var names = dxSelection();
    if (!names.length) return;
    el.dxCols.appendChild(h('p', 'dpanel__label', t('dx_cols')));
    names.forEach(function (name) {
      var d = h('details', 'dcols'); d.setAttribute('data-sheet', name);
      var sum = h('summary', 'dcols__sum');
      var sName = h('span', 'dcols__sheet', name);
      var sTag = h('span', 'dcols__tag');
      var sCount = h('span', 'dcols__count');
      sum.appendChild(sName); sum.appendChild(sTag); sum.appendChild(sCount);
      var body = h('div', 'dcols__body');
      d.appendChild(sum); d.appendChild(body);
      var setSum = function (on, total) {
        var custom = !!sheetPick(name);
        sTag.textContent = custom ? t('dx_cols_tag_custom') : '';
        sTag.hidden = !custom;
        sCount.textContent = total != null ? t('dx_cols_count', { n: on, total: total }) : t('dx_cols_choose');
        sCount.className = 'dcols__count' + (total != null && on === 0 ? ' is-err' : '');
      };
      setSum(null, null);
      var load = function () {
        if (body.getAttribute('data-ready')) return;
        body.textContent = ''; body.appendChild(h('p', 'dcols__note', t('dx_cols_loading')));
        loadSheetCols(name).then(function (auto) {
          body.setAttribute('data-ready', '1');
          fillColPicker(name, auto, body, setSum);
        }, function (err) {
          body.textContent = ''; body.appendChild(h('p', 'dcols__note is-err', t('dx_cols_error', { e: errText(err) })));
        });
      };
      d.addEventListener('toggle', function () { if (d.open) load(); });
      el.dxCols.appendChild(d);
      if (open[name] || names.length === 1) d.open = true; // une seule feuille : liste dépliée d'office
    });
  }

  var COL_GROUPS = ['all']; // un seul bloc : l'ordre de la liste = l'ordre des colonnes exportées
  function typeBadge (ty) {
    if (ty === 'int' || ty === 'float') return '#';
    if (ty === 'date' || ty === 'date-time') return t('dx_cols_t_date');
    if (ty === 'bool') return t('dx_cols_t_bool');
    return 'Abc';
  }

  // Sélecteur de colonnes : recherche, groupes (dans la vue / mesures / détail-info-bulle)
  // avec case de groupe, actions rapides sur tout ou sur les résultats de la recherche,
  // Maj+clic pour cocher une plage.
  function fillColPicker (name, auto, body, setSum) {
    var plan = RS.columnPlan(auto, (cfg.dataColumns || {})[name], dx.rename);
    var pick = sheetPick(name) || {};
    var has = function (n) { return Object.prototype.hasOwnProperty.call(pick, n); };
    var items = plan.map(function (p) {
      return { p: p, on: has(p.n) ? !!pick[p.n] : p.on, key: RS.norm(p.label + ' ' + p.n), g: 'all' };
    });
    var query = '';
    var last = null; // dernier élément cliqué (Maj+clic)
    body.textContent = '';
    if (!items.length) { body.appendChild(h('p', 'dcols__note', t('dx_cols_empty'))); setSum(0, 0); return; }

    // -- barre d'outils : recherche + actions rapides
    var tools = h('div', 'dcols__tools');
    var sbox = h('div', 'dcols__search');
    var input = h('input'); input.type = 'search'; input.placeholder = t('dx_cols_search'); input.setAttribute('aria-label', t('dx_cols_search'));
    var clear = h('button', 'dcols__clear', '×'); clear.type = 'button'; clear.title = t('dx_cols_clear'); clear.hidden = true;
    sbox.appendChild(input); sbox.appendChild(clear);
    var quick = h('div', 'dcols__quick');
    var mk = function (fn) { var b = h('button', 'dcols__btn'); b.type = 'button'; b.addEventListener('click', fn); quick.appendChild(b); return b; };
    var bAll = mk(function () { setMany(visible(), true); });
    var bNone = mk(function () { setMany(visible(), false); });
    var bDef = mk(function () { items.forEach(function (it) { it.on = it.p.on; }); pick = {}; sync(); });
    bDef.textContent = t('dx_cols_reset');
    tools.appendChild(sbox); tools.appendChild(quick);
    body.appendChild(tools);

    // -- liste groupée
    var list = h('div', 'dcols__list');
    var groups = {};
    COL_GROUPS.forEach(function (g) {
      var members = items.filter(function (it) { return it.g === g; });
      if (!members.length) return;
      var head = h('label', 'dcols__group');
      var gcb = h('input'); gcb.type = 'checkbox';
      var gcount = h('span', 'dcols__gcount');
      head.appendChild(gcb); head.appendChild(h('span', 'dcols__gname', t('dx_cols_g_' + g))); head.appendChild(gcount);
      if (g === 'hidden') head.title = t('dx_cols_g_hidden_tip');
      gcb.addEventListener('change', function () { setMany(members.filter(isVisible), gcb.checked); });
      // pas d'en-tête de groupe : Toutes / Aucune et le compteur du résumé suffisent
      var box = h('div', 'dcols__items');
      members.forEach(function (it) {
        var row = h('div', 'dcols__item'); // div (pas label) : Maj+clic fiable aussi sur le nom
        var cb = h('input'); cb.type = 'checkbox'; cb.checked = it.on;
        row.appendChild(cb);
        row.appendChild(h('span', 'dcols__type', typeBadge(it.p.t)));
        row.appendChild(h('span', 'dcols__name', it.p.label));
        row.title = it.p.label !== it.p.n ? it.p.label + ' (' + it.p.n + ')' : it.p.label;
        row.addEventListener('click', function (e) {
          var on = e.target === cb ? cb.checked : !it.on; // clic sur la case : déjà basculée par le navigateur
          if (e.shiftKey && last && last !== it) { // Maj+clic : toute la plage visible entre les deux
            var vis = visible(); var i1 = vis.indexOf(last); var i2 = vis.indexOf(it);
            if (i1 !== -1 && i2 !== -1) { setMany(vis.slice(Math.min(i1, i2), Math.max(i1, i2) + 1), on); last = it; return; }
          }
          last = it; setMany([it], on);
        });
        it.cb = cb; it.row = row;
        box.appendChild(row);
      });
      list.appendChild(box);
      groups[g] = { head: head, cb: gcb, count: gcount, members: members, box: box };
    });
    var none = h('p', 'dcols__note', t('dx_cols_nomatch')); none.hidden = true;
    list.appendChild(none);
    body.appendChild(list);
    body.appendChild(h('p', 'dcols__hint', t('dx_cols_hint')));
    if (auto.pivot > 1) body.appendChild(h('p', 'dcols__tip', t('dx_cols_pivot_tip', { m: auto.pivot })));

    function isVisible (it) { return !query || it.key.indexOf(query) !== -1; }
    function visible () { var out = []; COL_GROUPS.forEach(function (g) { if (groups[g]) groups[g].members.forEach(function (it) { if (isVisible(it)) out.push(it); }); }); return out; }
    function setMany (arr, on) {
      arr.forEach(function (it) { it.on = on; if (on === it.p.on) delete pick[it.p.n]; else pick[it.p.n] = on; });
      sync();
    }
    function sync () {
      items.forEach(function (it) { it.cb.checked = it.on; it.row.classList.toggle('is-on', it.on); it.row.hidden = !isVisible(it); });
      var shown = 0;
      COL_GROUPS.forEach(function (g) {
        var G = groups[g]; if (!G) return;
        var vis = G.members.filter(isVisible); var on = vis.filter(function (it) { return it.on; }).length;
        G.head.hidden = G.box.hidden = !vis.length;
        G.cb.checked = vis.length > 0 && on === vis.length;
        G.cb.indeterminate = on > 0 && on < vis.length;
        G.count.textContent = G.members.filter(function (it) { return it.on; }).length + ' / ' + G.members.length;
        shown += vis.length;
      });
      none.hidden = shown > 0;
      var n = visible().length;
      bAll.textContent = query ? t('dx_cols_check_n', { n: n }) : t('dx_cols_all');
      bNone.textContent = query ? t('dx_cols_uncheck_n', { n: n }) : t('dx_cols_none');
      bAll.disabled = bNone.disabled = !n;
      bDef.disabled = !Object.keys(pick).length;
      clear.hidden = !query;
      saveSheetPick(name, pick);
      setSum(items.filter(function (it) { return it.on; }).length, items.length);
    }
    var onSearch = function () { query = RS.norm(input.value); last = null; sync(); };
    input.addEventListener('input', onSearch);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; onSearch(); }
      if (e.key === 'Enter') { e.preventDefault(); var v = visible(); if (v.length) setMany(v, !v.every(function (it) { return it.on; })); } // Entrée : coche/décoche les résultats
    });
    clear.addEventListener('click', function () { input.value = ''; onSearch(); input.focus(); });
    sync();
  }

  function dxStatus (msg, tone) { el.dxStatus.textContent = msg || ''; el.dxStatus.className = 'dpanel__status' + (tone ? ' is-' + tone : ''); }

  function dxSelection () {
    var names = [];
    Array.prototype.forEach.call(el.dxSheets.querySelectorAll('input[type=checkbox]'), function (cb) { if (cb.checked) names.push(cb.value); });
    return names;
  }

  // Feuille au-delà de la limite : l'export s'arrête dès la 1re page avec un message ;
  // le bouton propose alors d'exporter quand même les N premières lignes (2e clic).
  function resetPartial () {
    if (!dx.allowPartial) return;
    dx.allowPartial = false; dx.partialN = 0;
    if (!dx.busy) { el.dxGo.textContent = t('dx_export'); dxStatus('', ''); }
  }

  /* Lecture allégée : sans Measure Names / Values, chaque mesure est une colonne -> on ne
   * demande à Tableau QUE les colonnes cochées (columnsToIncludeById) : pages bien plus légères.
   * Avec Measure Names / Values, Tableau renvoie une ligne par mesure : le nombre de lignes est
   * fixé par la vue et l'API ne permet pas de filtrer des lignes -> lecture complète. */
  function readProjection (ws, name, rename) {
    if (typeof ws.getSummaryColumnsInfoAsync !== 'function') return Promise.resolve({ extra: null, pivot: null });
    return Promise.all([ws.getSummaryColumnsInfoAsync(), vizSpec(ws)]).then(function (r) {
      var info = r[0] || []; var spec = r[1];
      if (!info.length) return { extra: null, pivot: null };
      if (info.some(function (c) { return RS.isPivotCol(c.fieldName); })) return { extra: null, pivot: true };
      var fake = { header: info.map(function (c) { return c.fieldName; }), types: info.map(function (c) { return c.dataType; }), measures: [] };
      var pick = sheetPick(name);
      var kept = {};
      RS.columnPlan(RS.autoColumns(fake, spec), (cfg.dataColumns || {})[name], rename).forEach(function (p) {
        var on = pick && Object.prototype.hasOwnProperty.call(pick, p.n) ? !!pick[p.n] : p.on;
        if (on) kept[p.n] = true;
      });
      var ids = info.filter(function (c) { return kept[c.fieldName] && c.fieldId; }).map(function (c) { return c.fieldId; });
      if (!ids.length || ids.length >= info.length) return { extra: null, pivot: false };
      return { extra: { columnsToIncludeById: ids }, pivot: false, kept: ids.length, total: info.length };
    }).catch(function (e) { console.warn('[recap] columns info', e); return { extra: null, pivot: null }; });
  }

  function runDataExport (mode, partialOk) { // mode : 'file' | 'copy'
    if (dx.busy) return;
    var names = dxSelection();
    if (!names.length) { dxStatus(t('dx_pick_one'), 'err'); return; }
    var fmt = el.dataPanel.querySelector('input[name=dxFmt]:checked');
    fmt = fmt ? fmt.value : 'xlsx';
    var withRecap = el.dxRecap.checked;
    var valMode = el.dataPanel.querySelector('input[name=dxVal]:checked');
    valMode = valMode ? valMode.value : (cfg.dataValues || 'raw');
    var maxRows = Math.max(1000, cfg.dataMaxRows | 0 || DEFAULTS.dataMaxRows);
    if (fmt === 'xlsx' || mode === 'copy') maxRows = Math.min(maxRows, XLSX_MAX_ROWS);
    if (mode === 'copy') maxRows = Math.min(maxRows, COPY_MAX_ROWS); // au-delà : export fichier
    setPendingCopy(null);
    var rename = null;
    dx.busy = true; dx.cancel = false; dx.maxRows = maxRows;
    el.dxCopy.disabled = true;
    if (mode === 'file') el.dxGo.textContent = t('dx_stop'); else el.dxGo.disabled = true;
    setBusy(true);

    var tables = []; var pivotSheets = [];
    var chain = readLock.then(paramRenamer).then(function (rn) { rename = rn; });
    names.forEach(function (name) {
      chain = chain.then(function () {
        var ws = findSheet(name);
        if (!ws) throw new Error(t('dx_sheet_missing', { s: name }));
        dxStatus(t('dx_reading', { s: name, n: 0 }), '');
        var t0 = Date.now();
        return readProjection(ws, name, rename).then(function (proj) {
        if (proj.pivot) pivotSheets.push(name);
        return timed(t('tm_export', { s: name }), readSheetTable(ws, maxRows, function (n, total) {
          if (dx.cancel) { var c = new Error('cancelled'); c.cancelled = true; throw c; }
          // Copie : inutile de lire 100 000 lignes pour finalement refuser -> arrêt dès la 1re page
          if (mode === 'copy' && total > maxRows) { var e = new Error('too_many'); e.tooMany = name; throw e; }
          // Export fichier : au-delà de la limite, on s'arrête tout de suite et on prévient
          if (mode === 'file' && !partialOk && total > maxRows) { var o = new Error('over_limit'); o.overLimit = { s: name, total: total, m: (dx.pivot || {})[name] || 0, pivot: !!proj.pivot }; throw o; }
          dxStatus(readingText(name, n, total, maxRows, t0, (dx.pivot || {})[name] || 0), '');
        }, valMode, proj.extra)).then(function (raw) {
          return vizSpec(ws).then(function (spec) {
            var tb = shapeTable(raw, spec, (cfg.dataColumns || {})[name], rename, sheetPick(name));
            if (!tb.header.length && raw.header.length) throw new Error(t('dx_cols_none_sel', { s: name }));
            tb.name = name; tables.push(tb);
          });
        });
        });
      });
    });

    readLock = chain.then(noop, noop); // le sélecteur de colonnes attend la fin de la lecture
    return chain.then(function () {
      var report = buildReport(rename);
      if (mode === 'copy') {
        var cut = tables.filter(function (tb) { return tb.truncated; });
        if (cut.length) { // copie partielle = piège : on refuse et on oriente vers l'export fichier
          dxStatus(t('dx_copy_too_many', { s: cut.map(function (tb) { return tb.name; }).join(', '), n: maxRows.toLocaleString() }), 'err');
          return;
        }
        var text = tablesToTsv(report, tables, withRecap);
        var nRows = tables.reduce(function (a, tb) { return a + tb.rows.length; }, 0);
        return copyText(text).then(function (ok) {
          if (ok) dxStatus(t('dx_copied', { n: nRows.toLocaleString() }), 'ok');
          else { setPendingCopy(text, nRows); dxStatus(t('dx_copy_ready', { n: nRows.toLocaleString() }), 'warn'); }
        });
      }
      dxStatus(t('dx_building'), '');
      if (fmt === 'csv') {
        var sepChar = csvSep(el.dxSep ? el.dxSep.value : cfg.csvSep);
        tables.forEach(function (tb) { saveBlob(new Blob(tableToCsv(report, tb, withRecap, sepChar), { type: 'text/csv;charset=utf-8' }), exportFileName(tables.length > 1 ? tb.name : '', 'csv')); });
        return finishMsg(tables);
      }
      // Une feuille Excel par feuille Tableau : données en haut, récap EN DESSOUS des lignes
      var sheets = tables.map(function (tb) {
        var rows = [tb.header.map(function (x) { return { v: x, s: 1 }; })].concat(tb.rows);
        var dataEnd = rows.length;
        if (withRecap) rows = rows.concat([[], []], recapRowsXlsx(report, tb));
        return { name: tb.name, rows: rows, freezeRow: 1, autoFilterRow: 1, autoFilterEnd: dataEnd, widthRows: dataEnd };
      });
      return window.RecapXlsx.build(sheets).then(function (blob) { saveBlob(blob, exportFileName('', 'xlsx')); finishMsg(tables); });
    }).catch(function (err) {
      if (err && err.cancelled) { dxStatus(t('dx_cancelled'), 'warn'); return; }
      if (err && err.tooMany) { dxStatus(t('dx_copy_too_many', { s: err.tooMany, n: maxRows.toLocaleString() }), 'err'); return; }
      if (err && err.overLimit) {
        var ol = err.overLimit;
        if (ol.m > 1) {
          dx.partialN = fileRowsFor(maxRows, ol.m);
          dxStatus(t('dx_over_limit_pivot', { s: ol.s, rows: Math.round(ol.total / ol.m).toLocaleString(), m: ol.m, total: ol.total.toLocaleString(), n: maxRows.toLocaleString(), k: dx.partialN.toLocaleString() }), 'err');
        } else {
          dx.partialN = maxRows;
          dxStatus(t(ol.pivot ? 'dx_over_limit_pivot_nom' : 'dx_over_limit', { s: ol.s, total: ol.total.toLocaleString(), n: maxRows.toLocaleString() }), 'err');
        }
        dx.allowPartial = true;
        return;
      }
      console.warn('[recap] data export', err);
      dxStatus(t('dx_error', { e: errText(err) }), 'err');
    }).then(function () {
      dx.busy = false; dx.cancel = false; el.dxGo.disabled = el.dxCopy.disabled = false; setBusy(false);
      el.dxGo.textContent = t(dx.allowPartial ? 'dx_export_partial' : 'dx_export', { n: (dx.partialN || maxRows).toLocaleString() });
    });
  }

  function finishMsg (tables) {
    var rows = tables.reduce(function (s, tb) { return s + tb.rows.length; }, 0);
    var cut = tables.some(function (tb) { return tb.truncated; });
    // Measure Names / Measure Values : Tableau renvoie une ligne PAR MESURE ; l'export les remet
    // en colonnes (une ligne par combinaison de dimensions) -> moins de lignes que lues. On l'explique.
    var piv = tables.filter(function (tb) { return tb.measureCount > 1 && tb.read > tb.rows.length; }).map(function (tb) {
      return t('dx_pivot_note', { s: tb.name, read: tb.read.toLocaleString(), m: tb.measureCount, n: tb.rows.length.toLocaleString() });
    });
    var cutMsg = tables.filter(function (tb) { return tb.truncated; }).map(function (tb) {
      return t('dx_truncated_sheet', { s: tb.name, n: tb.rows.length.toLocaleString() });
    });
    dxStatus(t('dx_done', { n: rows.toLocaleString() }) + (piv.length ? ' ' + piv.join(' ') : '') + (cut ? ' ' + cutMsg.join(' ') + ' ' + t('dx_truncated') : ''), cut ? 'warn' : 'ok');
  }

  // « Lecture de "X"… 140 000 / 1 000 000 lignes — encore ~2 min (la feuille en compte 7 777 454 : 1 000 000 premières) »
  function readingText (name, n, total, maxRows, t0, m) {
    var goal = total ? Math.min(total, maxRows) : 0;
    var txt = t('dx_reading', { s: name, n: n.toLocaleString() + (goal ? ' / ' + goal.toLocaleString() : '') });
    var secs = (Date.now() - t0) / 1000;
    if (goal && n > 0 && n < goal && secs > 2) {
      var left = Math.round((goal - n) * secs / n);
      txt += t('dx_eta', { t: left < 90 ? left + ' s' : Math.round(left / 60) + ' min' });
    }
    if (total > maxRows) txt += m > 1 ? t('dx_capped_pivot', { k: fileRowsFor(maxRows, m).toLocaleString() }) : t('dx_capped', { total: total.toLocaleString(), max: maxRows.toLocaleString() });
    return txt;
  }

  // Lecture paginée (Tableau 2022.4+), repli sur getSummaryDataAsync
  // Lecture des données de feuille : module partagé avec la fenêtre de configuration
  var RS = window.RecapSheet;
  var readSheetData = RS.readSheetData; var readSheetTable = RS.readSheetTable; var toTable = RS.toTable; var vizSpec = RS.vizSpec;
  var shapeTable = RS.shapeTable; var sheetColumns = RS.sheetColumns;

  // Récap : la colonne « Valeurs » (souvent longue) est placée en dernier
  // pour qu'elle puisse déborder librement à droite dans Excel.
  function recapLines (report) {
    var out = [];
    report.filters.forEach(function (f) { out.push([t('ex_type_filter'), f.name, modeText(f.mode), f.count == null ? '' : f.count, f.total || '', f.values.join(', ') + (f.truncated ? ' ' + t('ex_truncated') : '')]); });
    report.params.forEach(function (p) { out.push([t('ex_type_param'), p.name, modeText('param'), '', '', p.values.join(', ')]); });
    return out;
  }
  function modeText (m) {
    return t({ include: 'ex_mode_include', exclude: 'ex_mode_exclude', except: 'ex_mode_except', range: 'ex_mode_range', date: 'ex_mode_date', param: 'ex_mode_param' }[m] || 'ex_mode_include');
  }
  function recapHeader () { return [t('ex_col_type'), t('ex_col_name'), t('ex_col_mode'), t('ex_col_count'), t('ex_col_total'), t('ex_col_values')]; }
  function recapTitle (report) { return report.title + (report.dashboard ? ' — ' + report.dashboard : ''); }
  function sheetLine (tb) { return t('dx_sheet_line', { s: tb.name, n: tb.rows.length.toLocaleString(t.lang === 'fr' ? 'fr-FR' : 'en-GB') }) + (tb.truncated ? ' ' + t('ex_truncated') : ''); }

  // Bloc récap placé sous les données (Excel). Styles : 4 titre, 6 note, 7 en-tête récap
  function recapRowsXlsx (report, tb) {
    var rows = [
      [{ v: t('dx_recap_sheet').toUpperCase(), s: 4 }],
      [{ v: recapTitle(report), s: 6 }],
      [{ v: t('ex_exported', { d: report.exportedLabel }) + ' — ' + sheetLine(tb), s: 6 }],
      recapHeader().map(function (x) { return { v: x, s: 7 }; })
    ];
    var lines = recapLines(report);
    if (!lines.length) rows.push([t('ex_no_filter')]);
    return rows.concat(lines.map(function (l) { return l.map(function (v) { return v === '' ? null : v; }); }));
  }

  /* ---- Nettoyage des textes exportés (CSV / copier-coller) -------------
   * - retours à la ligne et tabulations internes -> espace (une ligne Tableau = une ligne)
   * - caractères invisibles (zéro-largeur, BOM, contrôles) supprimés
   * - guillemets ajoutés UNIQUEMENT si la valeur contient le séparateur réellement
   *   utilisé ou un guillemet (avant : toute valeur contenant « , » ou « ; »)
   * --------------------------------------------------------------------- */
  function cleanText (v) {
    return String(v)
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\r\n|[\r\n\t\u2028\u2029]/g, ' ')
      .replace(/[\u0000-\u001F\u007F]/g, '');
  }

  // Séparateur CSV : « ; » pour un Excel en français (virgule décimale), « , » sinon.
  // Auto = langue de l'extension si FR, puis langue du poste.
  function csvSep (pref) {
    if (pref === ';' || pref === ',') return pref;
    if (pref === 'tab') return '\t';
    if (t.lang === 'fr') return ';';
    var loc = '';
    try { loc = navigator.language || ''; } catch (e) { /* ignore */ }
    if (!loc) { try { loc = T.extensions.environment.locale || ''; } catch (e) { /* ignore */ } }
    return /^(fr|de|es|it|pt|nl|da|sv|nb|nn|no|fi|pl|cs|sk|ru|uk|tr|el|hu|ro|bg|hr|sl|lt|lv|et|id|vi)\b/i.test(String(loc)) ? ';' : ',';
  }

  function csvValue (v, d) {
    if (v == null) return '';
    if (v instanceof Date) {
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate()) + (v.getHours() || v.getMinutes() || v.getSeconds() ? ' ' + p(v.getHours()) + ':' + p(v.getMinutes()) + ':' + p(v.getSeconds()) : '');
    }
    if (typeof v === 'number') return d === ';' || (d === '\t' && csvSep('auto') === ';') ? String(v).replace('.', ',') : String(v); // Excel FR : virgule décimale
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    v = cleanText(v);
    return v.indexOf(d) !== -1 || v.indexOf('"') !== -1 ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  // Renvoie une liste de morceaux de texte (pour un Blob) : jamais une chaîne géante en mémoire
  function tableToCsv (report, tb, withRecap, d) {
    d = d || csvSep(cfg.csvSep);
    var line = function (arr) { var o = new Array(arr.length); for (var i = 0; i < arr.length; i++) o[i] = csvValue(arr[i], d); return o.join(d); };
    var parts = ['\ufeff' + line(tb.header)];
    var buf = [];
    for (var r = 0; r < tb.rows.length; r++) {
      buf.push(line(tb.rows[r]));
      if (buf.length === 20000) { parts.push('\r\n' + buf.join('\r\n')); buf = []; }
    }
    if (buf.length) parts.push('\r\n' + buf.join('\r\n'));
    if (withRecap) { // récap SOUS les données
      var out = ['', ''];
      out.push(line([t('dx_recap_sheet').toUpperCase()]));
      out.push(line([recapTitle(report)]));
      out.push(line([t('ex_exported', { d: report.exportedLabel }) + ' — ' + sheetLine(tb)]));
      out.push(line(recapHeader()));
      var lines = recapLines(report);
      if (!lines.length) out.push(line([t('ex_no_filter')]));
      lines.forEach(function (l) { out.push(line(l)); });
      parts.push('\r\n' + out.join('\r\n'));
    }
    return parts;
  }

  // Copier-coller vers Excel (tabulations). Une valeur contenant un guillemet est
  // protégée, sinon Excel fusionne les cellules au collage.
  function tablesToTsv (report, tables, withRecap) {
    var dec = csvSep(cfg.csvSep) === ';' ? ';' : ',';
    var cell = function (v) {
      if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return csvValue(v, dec);
      if (v == null) return '';
      v = cleanText(v);
      return v.indexOf('"') !== -1 ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var out = [];
    tables.forEach(function (tb, i) {
      if (tables.length > 1) out.push(cell(tb.name));
      out.push(tb.header.map(cell).join('\t'));
      tb.rows.forEach(function (r) { out.push(r.map(cell).join('\t')); });
      if (i < tables.length - 1) out.push('');
    });
    if (withRecap) { // récap SOUS les données
      out.push('', '');
      out.push(cell(t('dx_recap_sheet').toUpperCase()));
      out.push(cell(recapTitle(report)), cell(t('ex_exported', { d: report.exportedLabel })));
      out.push(recapHeader().map(cell).join('\t'));
      var lines = recapLines(report);
      if (!lines.length) out.push(cell(t('ex_no_filter')));
      lines.forEach(function (l) { out.push(l.map(cell).join('\t')); });
    }
    return out.join('\r\n');
  }

  function exportFileName (suffix, ext) {
    var base = (dashboard && dashboard.name || 'dashboard') + (suffix ? ' - ' + suffix : '');
    var d = new Date(); var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + 'h' + p(d.getMinutes());
    return (base.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'export') + ' - ' + stamp + '.' + ext;
  }

  function saveBlob (blob, name) {
    if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, name); return; }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  /* =====================================================================
   * Diagnostic (mode création) : pourquoi un filtre est affiché ou non
   * ===================================================================== */
  function toggleDiag () {
    state.diagOpen = !state.diagOpen;
    el.diagPanel.hidden = !state.diagOpen;
    if (state.diagOpen) { el.diagBody.textContent = t('diag_scanning'); schedule('full', null, 0); }
  }

  function renderDiag () {
    if (!state.diagOpen) return;
    var rows = state.diag.slice().sort(function (a, b) {
      var r = { ok: 0, err: 1, off: 2 };
      return (r[a.tone] - r[b.tone]) || String(a.field).localeCompare(String(b.field));
    });
    var table = h('table', 'diag__table');
    var thead = h('tr');
    ['h_field', 'h_sheet', 'h_type', 'h_status'].forEach(function (k) { thead.appendChild(h('th', null, t(k))); });
    table.appendChild(thead);
    rows.forEach(function (r) {
      var tr = h('tr', 'is-' + r.tone);
      tr.appendChild(h('td', null, r.field)); tr.appendChild(h('td', null, r.sheet));
      tr.appendChild(h('td', null, r.type)); tr.appendChild(h('td', null, r.status));
      table.appendChild(tr);
    });
    el.diagBody.textContent = '';
    el.diagBody.appendChild(h('p', 'diag__hint',
      t('diag_hint', { cards: exposureObjects().qf.length, sheets: dashboard.worksheets.length })));
    el.diagBody.appendChild(table);
    if (timings.length) {
      var slow = timings.slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, 25);
      el.diagBody.appendChild(h('p', 'diag__hint diag__sub', t('tm_title')));
      var tt = h('table', 'diag__table');
      var th = h('tr'); th.appendChild(h('th', null, t('tm_step'))); th.appendChild(h('th', 'num', t('tm_ms'))); tt.appendChild(th);
      slow.forEach(function (x) {
        var tr = h('tr', x.ms >= 2000 ? 'is-err' : x.ms >= 500 ? 'is-warn' : 'is-off');
        tr.appendChild(h('td', null, x.label)); tr.appendChild(h('td', 'num', (x.ms / 1000).toFixed(2) + ' s'));
        tt.appendChild(tr);
      });
      el.diagBody.appendChild(tt);
      if (window.console && console.table) console.table(slow);
    }
    if (window.console && console.table) console.table(rows);
  }

  /* =====================================================================
   * Réglages & apparence
   * ===================================================================== */
  function loadSettings () {
    var raw = null;
    try { raw = T.extensions.settings.get(SETTINGS_KEY); } catch (e) { /* ignore */ }
    var parsed = {};
    if (raw) { try { parsed = JSON.parse(raw) || {}; } catch (e) { console.warn('[recap] réglages illisibles'); } }
    var prev = cfg;
    cfg = assign({}, DEFAULTS, parsed);
    // Charte SMCP : une couleur hors palette (ancien réglage) revient au bordeaux
    // Ancien plafond par défaut (200 000) jamais modifié volontairement : nouveau défaut
    if (+cfg.dataMaxRows === 200000) cfg.dataMaxRows = DEFAULTS.dataMaxRows;
    if (BRAND_ACCENTS.indexOf(String(cfg.accent || '').toLowerCase()) === -1) cfg.accent = DEFAULTS.accent;
    if (['light', 'ecru', 'dark', 'transparent'].indexOf(cfg.theme) === -1) cfg.theme = 'light';
    var envLang = '';
    try { envLang = T.extensions.environment.language; } catch (e) { /* ignore */ }
    var lang = window.RecapI18n.resolve(cfg.language, envLang);
    var langChanged = lang !== t.lang;
    if (langChanged) t = window.RecapI18n.make(lang);
    if (dashboard && (langChanged || prev.showParams !== cfg.showParams || prev.includeHiddenCards !== cfg.includeHiddenCards ||
        prev.checkAllSelected !== cfg.checkAllSelected || prev.ignoreNullOnly !== cfg.ignoreNullOnly ||
        prev.includeHiddenParams !== cfg.includeHiddenParams || JSON.stringify(prev.overrides || null) !== JSON.stringify(cfg.overrides || null))) {
      if (prev.ignoreNullOnly !== cfg.ignoreNullOnly) caches.verdicts.clear();
      schedule('full', null, 0);
    }
  }

  function applyAppearance () {
    var root = document.documentElement;
    window.RecapI18n.apply(document, t);
    var title = displayTitle();
    el.title.textContent = title;
    document.title = title;
    el.btnExport.hidden = !cfg.showExport;
    el.btnData.hidden = !cfg.showDataExport;
    if (!cfg.showDataExport) el.dataPanel.hidden = true;
    root.style.setProperty('--accent', cfg.accent);
    root.style.setProperty('--accent-soft', hexToRgba(cfg.accent, 0.12));
    root.style.setProperty('--accent-ink', inkFor(cfg.accent));
    root.className = 'theme-' + cfg.theme + ' density-' + cfg.density;
    applyLayout();
    applyWorkbookFont();
  }

  // Un titre resté à une valeur par défaut (FR ou EN) suit la langue choisie.
  function displayTitle () {
    var d = window.RecapI18n.dict;
    var custom = (cfg.title || '').trim();
    if (!custom || custom === d.en.title_default || custom === d.fr.title_default) return t('title_default');
    return custom;
  }

  function applyLayout () {
    var bar = cfg.layout === 'bar' || (cfg.layout === 'auto' && window.innerHeight <= BAR_MAX_HEIGHT);
    el.app.classList.toggle('is-bar', bar);
  }

  function applyWorkbookFont () {
    if (!cfg.useWorkbookFont) { document.documentElement.style.removeProperty('--font'); return; }
    try {
      var wf = T.extensions.environment.workbookFormatting;
      var sheets = (wf && wf.formattingSheets) || [];
      var pick = null;
      for (var i = 0; i < sheets.length; i++) {
        var s = sheets[i];
        if (s.classNameKey === 'tableau-worksheet') { pick = s; break; }
      }
      var fam = pick && pick.cssProperties && pick.cssProperties.fontFamily;
      if (fam) document.documentElement.style.setProperty('--font', '"' + fam.replace(/"/g, '') + '", ' + DEFAULTS_FONT);
    } catch (e) { /* API indisponible (< 2021.4) : police par défaut */ }
  }
  var DEFAULTS_FONT = 'Verdana, Geneva, "DejaVu Sans", sans-serif';

  function openConfig () {
    var url = new URL('configure.html', window.location.href).href;
    return timed(t('tm_inventory'), buildInventory()).catch(function (e) { console.warn('[recap] inventory', e); return null; }).then(function (inv) {
      return T.extensions.ui.displayDialogAsync(url, JSON.stringify({ cfg: cfg, inventory: inv }), { width: 560, height: 720 });
    }).then(function () { loadSettings(); applyAppearance(); render(); })
      .catch(function (err) {
        if (T.ErrorCodes && err && err.errorCode === T.ErrorCodes.DialogClosedByUser) return;
        console.warn('[recap] config', err);
      });
  }

  // Inventaire complet pour l'onglet « Contenu » de la configuration :
  // tous les filtres de toutes les feuilles et tous les paramètres, avec ce
  // que le mode automatique en fait.
  function buildInventory () {
    var exposure = readExposure();
    var sheets = dashboard.worksheets;
    return Promise.all([
      Promise.all(sheets.map(function (ws) { return timed(t('tm_filters', { s: ws.name }), ws.getFiltersAsync()).catch(function () { return []; }); })),
      timed(t('tm_params'), dashboard.getParametersAsync())
    ]).then(function (res) {
      // auto : 'card' (carte de filtre trouvée), 'nocard' (filtre appliqué sans carte : non reconnu),
      // 'generated' (champ technique : Noms de mesures, Latitude générée…). Les champs techniques
      // sont désormais listés pour pouvoir être forcés dans le récap.
      var seen = new Map();
      res[0].forEach(function (fs, i) {
        var sheetName = sheets[i] ? sheets[i].name : '';
        fs.forEach(function (f) {
          var key = filterKey(f);
          var cur = seen.get(key);
          if (cur) { if (sheetName && cur.sheets.indexOf(sheetName) === -1) cur.sheets.push(sheetName); return; }
          var card = exposure.matchFilter(f);
          var gen = isGeneratedName(f.fieldName);
          seen.set(key, {
            key: key, name: f.fieldName, type: f.filterType || '', sheets: sheetName ? [sheetName] : [],
            auto: gen ? 'generated' : card ? 'card' : 'nocard', hiddenCard: !!(card && card.hidden),
            order: card ? card.order : 1000 + seen.size
          });
        });
      });
      var filters = Array.from(seen.values()).sort(function (a, b) { return a.order - b.order || a.name.localeCompare(b.name); });
      var m = matchParams(res[1], exposure.paramControls);
      var byKey = new Map();
      m.matched.forEach(function (x) { byKey.set(paramKey(x.p), x); });
      var params = res[1].map(function (p) {
        var x = byKey.get(paramKey(p));
        return { key: paramKey(p), name: p.name, auto: x ? (x.manual ? 'manual' : 'control') : 'nocontrol', control: x ? x.label : '', order: x ? x.order : 1000 };
      }).sort(function (a, b) { return a.order - b.order || a.name.localeCompare(b.name); });
      // Tous les contrôles du dashboard (même masqués) pour l'association manuelle
      var controls = [];
      dashboard.objects.forEach(function (o) {
        if (o.type === T.DashboardObjectType.ParameterControl) controls.push({ id: o.id, name: o.name || ('#' + o.id), hidden: o.isVisible === false, position: o.position });
      });
      controls.sort(byPosition);
      controls = controls.map(function (c) { return { id: c.id, name: c.name, hidden: c.hidden }; });
      var worksheets = []; var seenWs = {};
      dashboard.objects.slice().sort(byPosition).forEach(function (o) {
        if (o.type !== T.DashboardObjectType.Worksheet) return;
        var n = o.worksheet ? o.worksheet.name : o.name;
        if (!n || seenWs[n]) return;
        seenWs[n] = true; worksheets.push({ name: n, hidden: o.isVisible === false });
      });
      // Les colonnes de chaque feuille sont lues à la demande dans la fenêtre de configuration
      return { filters: filters, params: params, controls: controls, worksheets: worksheets, unlinked: m.unmatched.map(function (c) { return c.name; }) };
    });
  }

  /* =====================================================================
   * Feedback
   * ===================================================================== */
  // Indicateur affiché seulement si l'attente dépasse 250 ms (pas de clignotement).
  var busyTimer = 0;
  function setBusy (on) {
    clearTimeout(busyTimer);
    if (on) busyTimer = setTimeout(function () { el.app.classList.add('is-busy'); }, 250);
    else el.app.classList.remove('is-busy');
  }
  function spin (btn) {
    btn.classList.remove('is-spinning'); void btn.offsetWidth; btn.classList.add('is-spinning');
  }
  function showError (msg) { el.errorMessage.textContent = msg; el.errorBanner.hidden = false; }
  function hideError () { el.errorBanner.hidden = true; }
  function fail (msg) {
    showError(msg);
    el.app.classList.remove('is-loading');
    el.summary.textContent = t('unavailable');
    el.btnRetry.hidden = true;
  }

  /* =====================================================================
   * Utilitaires
   * ===================================================================== */
  function finalize (item) {
    // Signature = contenu affiché ; si elle ne change pas, le DOM n'est pas touché.
    // vsig = valeurs seules (sert à décider du « flash » visuel de changement).
    var copy = {}; var vals = {};
    for (var k in item) {
      if (k === 'sig' || k === 'vsig' || k === 'order' || k === 'needs') continue;
      copy[k] = item[k];
      if (k !== 'total' && k !== 'dMin' && k !== 'dMax' && k !== 'pos' && k !== 'options' && k !== 'hiddenCard' && k !== 'pending' && k !== 'reason') vals[k] = item[k];
    }
    item.sig = JSON.stringify(copy);
    item.vsig = JSON.stringify(vals);
    return item;
  }
  function filterKey (f) { return f.fieldId || ('n:' + norm(f.fieldName)); }
  function paramKey (p) { return 'p:' + (p.id || p.name); }
  function isGeneratedName (n) {
    var s = String(n || '').trim();
    for (var i = 0; i < GENERATED_NAME_RE.length; i++) if (GENERATED_NAME_RE[i].test(s)) return true;
    return false;
  }
  function norm (s) {
    s = String(s == null ? '' : s).toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.replace(/[^a-z0-9]/g, '');
  }
  function fmt (v) {
    if (!v) return '—';
    if (v.formattedValue != null && v.formattedValue !== '') return String(v.formattedValue);
    return v.value == null ? 'Null' : String(v.value);
  }
  function toNum (v) {
    if (v == null) return NaN;
    if (typeof v === 'number') return v;
    if (v instanceof Date) return v.getTime();
    var s = String(v).trim();
    if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) return parseFloat(s);
    var t = Date.parse(s.replace(' ', 'T'));
    return isNaN(t) ? NaN : t;
  }
  function escapeHtml (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clamp (x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function pad2 (n) { return (n < 10 ? '0' : '') + n; }
  function assign (t) {
    for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; }
    return t;
  }
  function findSheet (name) {
    var ws = dashboard.worksheets;
    for (var i = 0; i < ws.length; i++) if (ws[i].name === name) return ws[i];
    return null;
  }
  function safeCall (fn) { try { fn(); } catch (e) { /* ignore */ } }
  function errText (e) { return (e && (e.message || e.toString())) || t('unknown_error'); }
  function hexToRgba (hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return 'rgba(160,85,70,' + a + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  // Texte sur fond coloré : noir ou blanc selon la luminance (charte : textes noirs ou blancs)
  function inkFor (hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return '#ffffff';
    var n = parseInt(m[1], 16);
    var lin = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
    return L > 0.4 ? '#28282D' : '#ffffff';
  }
  function h (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg (id) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('class', 'ic');
    s.setAttribute('aria-hidden', 'true');
    var u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', '#' + id);
    u.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + id);
    s.appendChild(u);
    return s;
  }
  function icon (id, cls) { var w = h('span', cls); w.appendChild(svg(id)); return w; }

  window.addEventListener('resize', function () { if (cfg.layout === 'auto') applyLayout(); });

  // Expose quelques fonctions pures pour les tests (sans effet en production).
  window.__recap = { timings: function () { return timings.slice(); }, dataExport: function (m) { return runDataExport(m); }, toTable: function (d) { return toTable(d); }, inventory: function () { return buildInventory(); }, report: function () { return reportToText(buildReport(), t); }, buildReport: function () { return buildReport(); }, paramRenamer: paramRenamer, version: VERSION, relativeLabel: function (a, b, c) { return t.relative(a, b, c); }, matchParams: matchParams, norm: norm, toNum: toNum, isGeneratedName: isGeneratedName };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
