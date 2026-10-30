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
  var VERSION = '2.4.0';
  var SETTINGS_KEY = 'recapConfig';
  var DEFAULTS = {
    title: '',               // vide = titre par défaut, traduit
    language: 'en',          // en | fr | auto (langue de Tableau)
    showExport: true,
    accent: '#ff6d00',
    theme: 'light',          // light | dark | transparent
    density: 'comfortable',  // comfortable | compact
    layout: 'auto',          // auto | grid | bar
    showParams: true,
    showReset: true,
    showInactive: false,     // afficher aussi les filtres exposés sur « Tout »
    showRatio: true,         // barre « x sur N valeurs » (1 requête domaine / champ, mise en cache)
    maxChips: 4,
    useWorkbookFont: true,
    includeHiddenCards: true, // cartes dans un conteneur replié (panneau de filtres)
    includeHiddenParams: true, // contrôles de paramètre dans un conteneur replié
    overrides: null,          // { f: {cléFiltre: 'show'|'hide'}, p: {cléParam: 'show'|'hide'} } — par dashboard
    checkAllSelected: true,   // détecter « toutes les valeurs cochées une à une » (requête de fond)
    ignoreNullOnly: true      // « Tout sauf Null » = non restrictif (comme la carte « (Tout) »)
  };
  var t = window.RecapI18n.make('en'); // traductions (mises à jour par loadSettings)
  var EXCEPT_MAX = 12;        // au-delà, on affiche les valeurs retenues plutôt que les exclues
  var BAR_MAX_HEIGHT = 140;       // en dessous : mode bandeau automatique
  var PERSIST_TTL_MS = 12 * 3600e3; // cache local (domaines + dernier affichage)
  var DOMAIN_CONCURRENCY = 2;       // requêtes de domaine simultanées max (tâche de fond)
  var EVENT_DEBOUNCE_MS = 40;
  var LAYOUT_DEBOUNCE_MS = 150;
  var MAX_EXPANDED_CHIPS = 150;

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
    ['app', 'title', 'summary', 'btnRefresh', 'btnConfig', 'btnDiag', 'btnExport', 'btnClear', 'content', 'toast',
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
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) toggleDiag();
    });

    // Délégation : 1 seul listener pour toutes les tuiles.
    el.content.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!t) return;
      var action = t.getAttribute('data-action');
      if (action === 'close-diag') { toggleDiag(); return; }
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
    var targets = routed ? all.filter(function (ws) { return state.routes.sheets.has(ws.name); }) : all;

    var filtersP = Promise.all(targets.map(function (ws) {
      return ws.getFiltersAsync().then(
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
      if (routed && (matchedCards.size < exposure.cards.length || forcedMissing)) { state.routes = null; return fullScan(false, true); }

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
      if (routed) state.fieldSheets.forEach(function (v, k) { if (!fieldSheets.has(k)) fieldSheets.set(k, v); });

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
    var base = { key: key, kind: 'filter', type: type, label: f.fieldName, order: card.order, hiddenCard: !!card.hidden, needs: null };

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
      if (count === undefined && cfg.showRatio) item.needs = 'ratio';
      return finalize(item);
    }

    if (!cfg.checkAllSelected) {
      item.active = true;
      if (count === undefined && cfg.showRatio) item.needs = 'ratio';
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
        if (count === undefined && cfg.showRatio) item.needs = 'ratio';
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
    if (d === undefined) { item.needs = 'range'; return finalize(item); }
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
        return f.getDomainAsync(T.FilterDomainType.Database).then(function (d) {
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
    return 'recap:' + VERSION + ':' + kind + ':' + storeId;
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
        snap.f.forEach(function (it) { state.filters.set(it.key, it); state.exposedNames.add(norm(it.label)); });
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
    return dashboard.getParametersAsync().then(function (params) {
      var res = matchParams(params, controls);
      var diag = [];
      var shown = [];
      var matchedKeys = new Set();
      res.matched.forEach(function (m) {
        var key = paramKey(m.p);
        matchedKeys.add(key);
        if (ov.p[key] === 'hide') { diag.push(pRow(m.label, t('st_forced_hide'), 'off')); return; }
        shown.push(m);
        diag.push(pRow(m.label + (m.p.name !== m.label ? ' → ' + m.p.name : ''), t(ov.p[key] === 'show' ? 'st_forced_show' : 'st_p_shown') + (m.hidden ? t('st_hidden_control') : ''), 'ok'));
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

  function pRow (name, status, tone) { return { sheet: '—', field: name, type: t('type_param'), status: status, tone: tone }; }

  // L'API ne relie pas explicitement un contrôle à son paramètre. Ordre des
  // tentatives : identifiant (si Tableau le fournit), nom exact, nom
  // normalisé, puis nom partiel UNIQUEMENT s'il n'y a qu'un seul candidat
  // (évite d'associer « Season » au mauvais « Catalog Season Code 1/2 »).
  function matchParams (params, controls) {
    var taken = new Set(); var matched = []; var pending = controls.slice();
    var idOf = function (s) { return norm(String(s || '').replace(/^\[parameters\]\./i, '')); };
    var take = function (p, c) { taken.add(paramKey(p)); matched.push({ p: p, order: c.order, label: c.name, hidden: !!c.hidden }); };
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

  function overrides () {
    var o = cfg.overrides || {};
    return { f: o.f || {}, p: o.p || {} };
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
      key: paramKey(p), kind: 'param', type: 'param', label: (label && String(label).trim()) || p.name, paramName: p.name, order: order, active: true,
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
    var params = cfg.showParams ? sortedVisible(state.params) : [];
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
    arr.sort(function (a, b) { return a.order - b.order || a.label.localeCompare(b.label); });
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
    if (it.exclude) head.appendChild(h('span', 'tile__badge', t('badge_excluded')));
    else if (it.except && it.active) head.appendChild(h('span', 'tile__badge', t('badge_except')));
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
      var c = h('span', 'chip', values[i]); c.title = values[i]; frag.appendChild(c);
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

    var label;
    if (it.except) {
      label = t('meta_except', { n: it.except.length }) + (it.total ? t('meta_except_detail', { sel: it.values.length, total: it.total }) : '');
    } else {
      label = t.plural(it.exclude ? 'excluded' : 'values', values.length);
      if (it.total) label += t('of_total', { total: it.total });
    }
    var metaRow = h('div', 'tile__meta');
    metaRow.appendChild(h('span', null, label));
    if (cfg.showRatio && it.total) {
      var share = it.exclude ? (it.total - values.length) / it.total : (it.values || values).length / it.total;
      metaRow.appendChild(bar(0, clamp(share)));
      metaRow.title = t('kept_pct', { p: Math.round(clamp(share) * 100) });
    }
    tile.appendChild(metaRow);
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
    } else if (it.options) {
      var m = h('div', 'tile__meta'); m.appendChild(h('span', null, t('option_of', { n: it.options }))); tile.appendChild(m);
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
      return ws ? ws.clearFilterAsync(it.label).catch(function (e) { console.warn('[recap] clear', name, e); }) : null;
    })).then(function () {
      // Filet de sécurité si l'événement FilterChanged n'arrive pas.
      schedule('field', { key: norm(it.label), ev: syntheticEvent(sheets[0], key) }, 300);
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
        if (ws) jobs.push(ws.clearFilterAsync(x[0].label).catch(function (e) { console.warn('[recap] clear', name, e); }));
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

  function buildReport () {
    var now = new Date();
    var filters = sortedVisible(state.filters, function (it) { return it.active && !it.pending; }).map(function (it) {
      var r = { name: it.label, type: it.type, mode: 'include', values: [], count: null, total: it.total || null, truncated: false };
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
    var params = (cfg.showParams ? sortedVisible(state.params) : []).map(function (it) {
      return { name: it.label, mode: 'param', values: [it.text] };
    });
    return {
      lang: t.lang,
      title: displayTitle(),
      dashboard: dashboard ? dashboard.name : '',
      exportedAt: now.toISOString(),
      exportedLabel: now.toLocaleString(t.lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
      accent: cfg.accent,
      filters: filters,
      params: params
    };
  }

  function openExport () {
    var report = buildReport();
    var url = new URL('export.html', window.location.href).href;
    var opened = null;
    try {
      opened = T.extensions.ui.displayDialogAsync(url, JSON.stringify(report), { width: 760, height: 680 });
    } catch (e) { opened = null; }
    if (!opened) { copyText(reportToText(report, t)); return; }
    opened.catch(function (err) {
      if (T.ErrorCodes && err && err.errorCode === T.ErrorCodes.DialogClosedByUser) return;
      console.warn('[recap] export dialog', err);
      copyText(reportToText(report, t)); // repli : copie du récap en texte
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

  function copyText (text) {
    var done = function () { toast(t('copied')); };
    var legacy = function () {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { console.warn('[recap] copy', e); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, legacy);
    else legacy();
  }

  var toastTimer = 0;
  function toast (msg) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2200);
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
    root.style.setProperty('--accent', cfg.accent);
    root.style.setProperty('--accent-soft', hexToRgba(cfg.accent, 0.12));
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
  var DEFAULTS_FONT = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif';

  function openConfig () {
    var url = new URL('configure.html', window.location.href).href;
    return buildInventory().catch(function (e) { console.warn('[recap] inventory', e); return null; }).then(function (inv) {
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
      Promise.all(sheets.map(function (ws) { return ws.getFiltersAsync().catch(function () { return []; }); })),
      dashboard.getParametersAsync()
    ]).then(function (res) {
      var seen = new Map();
      res[0].forEach(function (fs) {
        fs.forEach(function (f) {
          var key = filterKey(f);
          if (seen.has(key) || isGeneratedName(f.fieldName)) return;
          var card = exposure.matchFilter(f);
          seen.set(key, { key: key, name: f.fieldName, auto: card ? 'card' : 'nocard', order: card ? card.order : 1000 + seen.size });
        });
      });
      var filters = Array.from(seen.values()).sort(function (a, b) { return a.order - b.order || a.name.localeCompare(b.name); });
      var m = matchParams(res[1], exposure.paramControls);
      var byKey = new Map();
      m.matched.forEach(function (x) { byKey.set(paramKey(x.p), x); });
      var params = res[1].map(function (p) {
        var x = byKey.get(paramKey(p));
        return { key: paramKey(p), name: p.name, auto: x ? 'control' : 'nocontrol', control: x ? x.label : '', order: x ? x.order : 1000 };
      }).sort(function (a, b) { return a.order - b.order || a.name.localeCompare(b.name); });
      return { filters: filters, params: params, unlinked: m.unmatched.map(function (c) { return c.name; }) };
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
    if (!m) return 'rgba(255,109,0,' + a + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
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
  window.__recap = { inventory: function () { return buildInventory(); }, report: function () { return reportToText(buildReport(), t); }, buildReport: function () { return buildReport(); }, version: VERSION, relativeLabel: function (a, b, c) { return t.relative(a, b, c); }, matchParams: matchParams, norm: norm, toNum: toNum, isGeneratedName: isGeneratedName };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
