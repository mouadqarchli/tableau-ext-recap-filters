/* Traductions partagées (extension, configuration, export) — EN / FR */
(function (root) {
  'use strict';

  var DICT = {
    en: {
      title_default: 'Filters & parameters',
      loading: 'Loading…',
      refresh: 'Refresh',
      configure: 'Configure',
      diagnostics: 'Diagnostics (Ctrl+Alt+D)',
      export: 'Export',
      reset_all: 'Reset displayed filters',
      confirm: 'Confirm?',
      confirm_title: 'Click again to confirm',
      retry: 'Retry',
      empty_title: 'No restrictive selection',
      empty_text: 'All dashboard data is displayed.',
      sec_filters: 'Filters',
      sec_params: 'Parameters',
      diag_title: 'Filter diagnostics',
      close: 'Close',
      err_lib: 'The Tableau Extensions API library could not be found (lib/tableau.extensions.1.latest.min.js).',
      err_init: 'Initialization failed: {e}',
      err_read: 'Unable to read filters: {e}',
      unavailable: 'Unavailable',
      unknown_error: 'unknown error',
      st_read_err: 'Unable to read',
      st_no_card: 'No filter card on the dashboard',
      st_generated: 'Tableau-generated field',
      st_dup: 'Duplicate (same field on another sheet)',
      st_pending: 'Checking (all values selected?)',
      st_shown: 'Displayed',
      st_shown_except: ' as "except"',
      st_hidden_card: ' (card in a hidden container)',
      st_hidden_control: ' (control in a hidden container)',
      st_all: 'Not restrictive (all values)',
      st_all_ticked: 'Not restrictive (all values selected)',
      st_null_only: 'Not restrictive (only Null is unselected)',
      st_card_nofilter: 'Card with no matching filter',
      st_forced_hide: 'Hidden manually (Configure > Recap content)',
      st_forced_show: 'Shown manually (Configure > Recap content)',
      st_p_shown: 'Displayed (parameter control on the dashboard)',
      st_p_manual: 'Displayed (control linked manually)',
      cf_ctrl: 'Control',
      cf_ctrl_auto: 'Automatic',
      cf_ctrl_none: 'No control',
      cf_hidden_suffix: ' (hidden)',
      cf_label: 'Label in the recap',
      cf_auto_manual: 'Linked manually to control "{c}"',
      st_p_unlinked: 'Parameter control not linked to a parameter (rename it like the parameter, or force it in Configure)',
      st_p_nocontrol: 'No parameter control on the dashboard',
      type_param: 'parameter',
      cf_tab_look: 'Appearance',
      cf_tab_content: 'Recap content',
      cf_content_intro: 'By default the recap shows the filters that have a filter card and the parameters that have a control on this dashboard. Here you can force an item to show or hide, link a parameter to the control that drives it (it then takes that control\'s place in the recap), and rename what the recap displays. Settings apply to this dashboard only.',
      cf_ov_auto: 'Auto', cf_ov_show: 'Always show', cf_ov_hide: 'Never show',
      cf_auto_card: 'Auto: shown when restrictive (filter card)',
      cf_auto_nocard: 'Auto: hidden (no filter card)',
      cf_auto_control: 'Auto: shown (control "{c}")',
      cf_auto_nocontrol: 'Auto: hidden (no control found)',
      cf_unlinked: 'Controls not linked to a parameter: {list}. Pick them in the "Control" list of the matching parameter below.',
      cf_inventory_missing: 'The list of filters and parameters could not be loaded. Close and reopen this window.',
      cf_includeHiddenParams: 'Include parameter controls placed in a hidden or collapsed container',
      type_card: 'card',
      h_field: 'Field', h_sheet: 'Sheet', h_type: 'Type', h_status: 'Status',
      diag_scanning: 'Scanning all sheets…',
      diag_hint: '{cards} filter card(s), {sheets} sheet(s) scanned. Take a screenshot of this table if in doubt.',
      sum_filters_1: '{n} active filter',
      sum_filters_n: '{n} active filters',
      sum_params_1: '{n} parameter',
      sum_params_n: '{n} parameters',
      sum_pending: 'analysing {n} filter(s)…',
      updated: 'Updated at {time}',
      all_values: 'All values',
      clear_filter: 'Clear this filter',
      clear_filter_aria: 'Clear filter {name}',
      show_less: 'Show less',
      badge_except: 'Except',
      badge_excluded: 'Excluded',
      meta_except: 'All except {n}',
      meta_except_detail: ' ({sel} of {total})',
      values_1: '{n} value', values_n: '{n} values',
      excluded_1: '{n} excluded', excluded_n: '{n} excluded',
      of_total: ' of {total}',
      kept_pct: '{p}% of values kept',
      nulls_included: 'Null values included',
      anchor: 'Anchor: {d}',
      option_of: '1 option of {n}',
      copied: 'Copied to clipboard',
      // Export
      ex_title: 'Filters & parameters export',
      ex_dashboard: 'Dashboard',
      ex_exported: 'Exported on {d}',
      ex_copy: 'Copy as text',
      ex_csv: 'Download CSV',
      ex_txt: 'Download text',
      ex_print: 'Print / PDF',
      ex_print_hint: 'Opens the report in your web browser, ready to print or save as PDF',
      ex_search: 'Search a filter or a value…',
      ex_no_filter: 'No restrictive filter.',
      ex_no_param: 'No parameter.',
      ex_more: '… and {n} more',
      ex_show_all: 'Show all',
      ex_download_hint: 'Print / PDF opens the report in your web browser. If nothing downloads (Tableau Desktop), use "Copy as text" or download from the browser tab.',
      ex_mode_include: 'Selected',
      ex_mode_exclude: 'Excluded',
      ex_mode_except: 'All except',
      ex_mode_range: 'Range',
      ex_mode_date: 'Relative date',
      ex_mode_param: 'Value',
      ex_col_type: 'Type', ex_col_name: 'Name', ex_col_mode: 'Mode', ex_col_values: 'Values', ex_col_count: 'Count', ex_col_total: 'Total',
      ex_type_filter: 'Filter', ex_type_param: 'Parameter',
      ex_count_of: '{n} of {total}',
      ex_truncated: '(list truncated)',
      // Configure
      cf_title: 'Filters & parameters recap',
      cf_intro: 'Appearance and behaviour of the extension. Settings are saved in the workbook.',
      cf_language: 'Language',
      cf_lang_auto: 'Automatic (Tableau language)',
      cf_title_label: 'Title',
      cf_accent: 'Accent colour',
      cf_custom_color: 'Custom colour',
      cf_theme: 'Theme', cf_theme_light: 'Light', cf_theme_dark: 'Dark', cf_theme_transparent: 'Transparent',
      cf_density: 'Density', cf_density_comfortable: 'Comfortable', cf_density_compact: 'Compact',
      cf_layout: 'Layout', cf_layout_auto: 'Automatic (banner when the zone is short)', cf_layout_grid: 'Cards', cf_layout_bar: 'Horizontal banner',
      cf_maxchips: 'Visible values per filter',
      cf_showParams: 'Show exposed parameters',
      cf_showReset: 'Allow clearing filters from the recap',
      cf_showExport: 'Show the export button',
      cf_showRatio: 'Show the share of values kept',
      cf_showInactive: 'Also show exposed filters set to "All"',
      cf_useWorkbookFont: 'Use the workbook font',
      cf_includeHiddenCards: 'Include cards placed in a hidden or collapsed container',
      cf_checkAllSelected: 'Hide filters where every value is selected (background query)',
      cf_ignoreNullOnly: 'Treat "all except Null" as not restrictive',
      cf_defaults: 'Reset to defaults',
      cf_cancel: 'Cancel',
      cf_save: 'Save',
      cf_save_error: 'Unable to save: {e}'
    },
    fr: {
      title_default: 'Filtres & paramètres',
      loading: 'Chargement…',
      refresh: 'Actualiser',
      configure: 'Configurer',
      diagnostics: 'Diagnostic (Ctrl+Alt+D)',
      export: 'Exporter',
      reset_all: 'Réinitialiser les filtres affichés',
      confirm: 'Confirmer ?',
      confirm_title: 'Cliquer à nouveau pour confirmer',
      retry: 'Réessayer',
      empty_title: 'Aucune sélection restrictive',
      empty_text: 'Toutes les données du tableau de bord sont affichées.',
      sec_filters: 'Filtres',
      sec_params: 'Paramètres',
      diag_title: 'Diagnostic des filtres',
      close: 'Fermer',
      err_lib: 'La bibliothèque Tableau Extensions API est introuvable (lib/tableau.extensions.1.latest.min.js).',
      err_init: 'Initialisation impossible : {e}',
      err_read: 'Lecture des filtres impossible : {e}',
      unavailable: 'Indisponible',
      unknown_error: 'erreur inconnue',
      st_read_err: 'Lecture impossible',
      st_no_card: 'Pas de carte de filtre dans le dashboard',
      st_generated: 'Champ généré par Tableau',
      st_dup: 'Doublon (même champ sur une autre feuille)',
      st_pending: 'Vérification en cours (toutes les valeurs cochées ?)',
      st_shown: 'Affiché',
      st_shown_except: ' en « sauf »',
      st_hidden_card: ' (carte dans un conteneur masqué)',
      st_hidden_control: ' (contrôle dans un conteneur masqué)',
      st_all: 'Non restrictif (toutes les valeurs)',
      st_all_ticked: 'Non restrictif (toutes les valeurs cochées)',
      st_null_only: 'Non restrictif (seule la valeur Null est décochée)',
      st_card_nofilter: 'Carte sans filtre correspondant',
      st_forced_hide: 'Masqué manuellement (Configurer > Contenu du récap)',
      st_forced_show: 'Affiché manuellement (Configurer > Contenu du récap)',
      st_p_shown: 'Affiché (contrôle de paramètre dans le dashboard)',
      st_p_manual: 'Affiché (contrôle associé manuellement)',
      cf_ctrl: 'Contrôle',
      cf_ctrl_auto: 'Automatique',
      cf_ctrl_none: 'Aucun contrôle',
      cf_hidden_suffix: ' (masqué)',
      cf_label: 'Libellé dans le récap',
      cf_auto_manual: 'Associé manuellement au contrôle « {c} »',
      st_p_unlinked: 'Contrôle non relié à un paramètre (nommez-le comme le paramètre, ou forcez-le dans Configurer)',
      st_p_nocontrol: 'Pas de contrôle de paramètre dans le dashboard',
      type_param: 'paramètre',
      cf_tab_look: 'Apparence',
      cf_tab_content: 'Contenu du récap',
      cf_content_intro: "Par défaut, le récap affiche les filtres qui ont une carte de filtre et les paramètres qui ont un contrôle dans ce dashboard. Ici, vous pouvez forcer l'affichage ou le masquage, associer un paramètre au contrôle qui le pilote (il prend alors sa place dans le récap) et renommer ce qui est affiché. Réglages propres à ce dashboard.",
      cf_ov_auto: 'Auto', cf_ov_show: 'Toujours afficher', cf_ov_hide: 'Ne jamais afficher',
      cf_auto_card: 'Auto : affiché si restrictif (carte de filtre)',
      cf_auto_nocard: 'Auto : masqué (pas de carte de filtre)',
      cf_auto_control: 'Auto : affiché (contrôle « {c} »)',
      cf_auto_nocontrol: 'Auto : masqué (aucun contrôle trouvé)',
      cf_unlinked: 'Contrôles non reliés à un paramètre : {list}. Choisissez-les dans la liste « Contrôle » du paramètre correspondant ci-dessous.',
      cf_inventory_missing: 'La liste des filtres et paramètres n’a pas pu être chargée. Fermez puis rouvrez cette fenêtre.',
      cf_includeHiddenParams: 'Inclure les contrôles de paramètre placés dans un conteneur masqué ou replié',
      type_card: 'carte',
      h_field: 'Champ', h_sheet: 'Feuille', h_type: 'Type', h_status: 'Statut',
      diag_scanning: 'Analyse de toutes les feuilles…',
      diag_hint: '{cards} carte(s) de filtre, {sheets} feuille(s) analysée(s). Faites une capture de ce tableau en cas de doute.',
      sum_filters_1: '{n} filtre actif',
      sum_filters_n: '{n} filtres actifs',
      sum_params_1: '{n} paramètre',
      sum_params_n: '{n} paramètres',
      sum_pending: 'analyse de {n} filtre(s)…',
      updated: 'Mis à jour à {time}',
      all_values: 'Toutes les valeurs',
      clear_filter: 'Effacer ce filtre',
      clear_filter_aria: 'Effacer le filtre {name}',
      show_less: 'Réduire',
      badge_except: 'Sauf',
      badge_excluded: 'Exclu',
      meta_except: 'Toutes sauf {n}',
      meta_except_detail: ' ({sel} sur {total})',
      values_1: '{n} valeur', values_n: '{n} valeurs',
      excluded_1: '{n} exclue', excluded_n: '{n} exclues',
      of_total: ' sur {total}',
      kept_pct: '{p} % des valeurs conservées',
      nulls_included: 'Valeurs nulles incluses',
      anchor: 'Ancre : {d}',
      option_of: '1 option sur {n}',
      copied: 'Copié dans le presse-papiers',
      ex_title: 'Export des filtres & paramètres',
      ex_dashboard: 'Tableau de bord',
      ex_exported: 'Exporté le {d}',
      ex_copy: 'Copier en texte',
      ex_csv: 'Télécharger CSV',
      ex_txt: 'Télécharger texte',
      ex_print: 'Imprimer / PDF',
      ex_print_hint: 'Ouvre le rapport dans votre navigateur, prêt à imprimer ou enregistrer en PDF',
      ex_search: 'Rechercher un filtre ou une valeur…',
      ex_no_filter: 'Aucun filtre restrictif.',
      ex_no_param: 'Aucun paramètre.',
      ex_more: '… et {n} de plus',
      ex_show_all: 'Tout afficher',
      ex_download_hint: 'Imprimer / PDF ouvre le rapport dans votre navigateur. Si rien ne se télécharge (Tableau Desktop), utilisez « Copier en texte » ou téléchargez depuis l’onglet du navigateur.',
      ex_mode_include: 'Sélection',
      ex_mode_exclude: 'Exclusion',
      ex_mode_except: 'Toutes sauf',
      ex_mode_range: 'Plage',
      ex_mode_date: 'Date relative',
      ex_mode_param: 'Valeur',
      ex_col_type: 'Type', ex_col_name: 'Nom', ex_col_mode: 'Mode', ex_col_values: 'Valeurs', ex_col_count: 'Nombre', ex_col_total: 'Total',
      ex_type_filter: 'Filtre', ex_type_param: 'Paramètre',
      ex_count_of: '{n} sur {total}',
      ex_truncated: '(liste tronquée)',
      cf_title: 'Récap filtres & paramètres',
      cf_intro: "Apparence et comportement de l'extension. Les réglages sont enregistrés dans le classeur.",
      cf_language: 'Langue',
      cf_lang_auto: 'Automatique (langue de Tableau)',
      cf_title_label: 'Titre',
      cf_accent: "Couleur d'accent",
      cf_custom_color: 'Couleur personnalisée',
      cf_theme: 'Thème', cf_theme_light: 'Clair', cf_theme_dark: 'Sombre', cf_theme_transparent: 'Transparent',
      cf_density: 'Densité', cf_density_comfortable: 'Confortable', cf_density_compact: 'Compacte',
      cf_layout: 'Disposition', cf_layout_auto: 'Automatique (bandeau si zone basse)', cf_layout_grid: 'Cartes', cf_layout_bar: 'Bandeau horizontal',
      cf_maxchips: 'Valeurs visibles par filtre',
      cf_showParams: 'Afficher les paramètres exposés',
      cf_showReset: "Autoriser l'effacement des filtres depuis le récap",
      cf_showExport: "Afficher le bouton d'export",
      cf_showRatio: 'Afficher la proportion de valeurs retenues',
      cf_showInactive: 'Afficher aussi les filtres exposés sur « Tout »',
      cf_useWorkbookFont: 'Utiliser la police du classeur',
      cf_includeHiddenCards: 'Inclure les cartes placées dans un conteneur masqué ou replié',
      cf_checkAllSelected: 'Masquer les filtres dont toutes les valeurs sont cochées (requête en arrière-plan)',
      cf_ignoreNullOnly: 'Considérer « tout sauf Null » comme non restrictif',
      cf_defaults: 'Valeurs par défaut',
      cf_cancel: 'Annuler',
      cf_save: 'Enregistrer',
      cf_save_error: 'Enregistrement impossible : {e}'
    }
  };

  // Libellés des dates relatives
  var REL = {
    en: {
      units: { years: ['year', 'years'], quarters: ['quarter', 'quarters'], months: ['month', 'months'], weeks: ['week', 'weeks'], days: ['day', 'days'], hours: ['hour', 'hours'], minutes: ['minute', 'minutes'], seconds: ['second', 'seconds'] },
      current: { years: 'This year', quarters: 'This quarter', months: 'This month', weeks: 'This week', days: 'Today', hours: 'This hour', minutes: 'This minute', seconds: 'This second' },
      last: { years: 'Last year', quarters: 'Last quarter', months: 'Last month', weeks: 'Last week', days: 'Yesterday', hours: 'Last hour' },
      next: { years: 'Next year', quarters: 'Next quarter', months: 'Next month', weeks: 'Next week', days: 'Tomorrow', hours: 'Next hour' },
      todate: { years: 'Year to date', quarters: 'Quarter to date', months: 'Month to date', weeks: 'Week to date', days: 'Day to date' },
      lastN: function (n, u) { return 'Last ' + n + ' ' + u; },
      nextN: function (n, u) { return 'Next ' + n + ' ' + u; },
      fbCurrent: 'Current period', fbLast: 'Previous {u}', fbNext: 'Next {u}', fbToDate: '{u} to date'
    },
    fr: {
      units: { years: ['année', 'années', 'f'], quarters: ['trimestre', 'trimestres'], months: ['mois', 'mois'], weeks: ['semaine', 'semaines', 'f'], days: ['jour', 'jours'], hours: ['heure', 'heures', 'f'], minutes: ['minute', 'minutes', 'f'], seconds: ['seconde', 'secondes', 'f'] },
      current: { years: 'Cette année', quarters: 'Ce trimestre', months: 'Ce mois-ci', weeks: 'Cette semaine', days: "Aujourd'hui", hours: 'Cette heure', minutes: 'Cette minute', seconds: 'Cette seconde' },
      last: { years: "L'année dernière", quarters: 'Le trimestre dernier', months: 'Le mois dernier', weeks: 'La semaine dernière', days: 'Hier', hours: "L'heure précédente" },
      next: { years: "L'année prochaine", quarters: 'Le trimestre prochain', months: 'Le mois prochain', weeks: 'La semaine prochaine', days: 'Demain', hours: "L'heure suivante" },
      todate: { years: "Depuis le début de l'année", quarters: 'Depuis le début du trimestre', months: 'Depuis le début du mois', weeks: 'Depuis le début de la semaine', days: 'Depuis le début de la journée' },
      lastN: function (n, u, fem) { return 'Les ' + n + (fem ? ' dernières ' : ' derniers ') + u; },
      nextN: function (n, u, fem) { return 'Les ' + n + (fem ? ' prochaines ' : ' prochains ') + u; },
      fbCurrent: 'Période en cours', fbLast: 'Période précédente ({u})', fbNext: 'Période suivante ({u})', fbToDate: 'Depuis le début ({u})'
    }
  };

  function resolve (pref, tableauLang) {
    if (pref === 'en' || pref === 'fr') return pref;
    return /^fr/i.test(String(tableauLang || '')) ? 'fr' : 'en';
  }

  function make (lang) {
    var d = DICT[lang] || DICT.en;
    var t = function (key, vars) {
      var s = d[key] != null ? d[key] : (DICT.en[key] != null ? DICT.en[key] : key);
      if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
      return s;
    };
    // Pluriel simple : clé_1 / clé_n
    t.plural = function (key, n, vars) {
      var v = vars || {}; v.n = n;
      return t(key + (n === 1 || (lang === 'fr' && n === 0) ? '_1' : '_n'), v);
    };
    t.lang = lang;
    t.relative = function (rangeType, period, n) {
      var R = REL[lang] || REL.en;
      var iso = /^iso-/.test(period || '') ? ' ISO' : '';
      var p = String(period || '').replace(/^iso-/, '');
      var u = R.units[p] || [p, p];
      var fem = u[2] === 'f';
      n = n | 0;
      var fb = function (tpl) { return tpl.replace('{u}', u[0] + iso); };
      switch (rangeType) {
        case 'current': return (R.current[p] || R.fbCurrent) + iso;
        case 'last': return R.last[p] ? R.last[p] + iso : fb(R.fbLast);
        case 'next': return R.next[p] ? R.next[p] + iso : fb(R.fbNext);
        case 'last-n': return n <= 1 ? (R.last[p] ? R.last[p] + iso : fb(R.fbLast)) : R.lastN(n, u[1] + iso, fem);
        case 'next-n': return n <= 1 ? (R.next[p] ? R.next[p] + iso : fb(R.fbNext)) : R.nextN(n, u[1] + iso, fem);
        case 'to-date': return R.todate[p] ? R.todate[p] + iso : fb(R.fbToDate);
        default: return u[0] + iso;
      }
    };
    return t;
  }

  // Traduit les éléments statiques : data-i18n (texte), data-i18n-title, data-i18n-aria, data-i18n-ph
  function apply (rootEl, t) {
    var q = function (sel) { return (rootEl || document).querySelectorAll(sel); };
    Array.prototype.forEach.call(q('[data-i18n]'), function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
    Array.prototype.forEach.call(q('[data-i18n-title]'), function (n) { n.title = t(n.getAttribute('data-i18n-title')); });
    Array.prototype.forEach.call(q('[data-i18n-aria]'), function (n) { n.setAttribute('aria-label', t(n.getAttribute('data-i18n-aria'))); });
    Array.prototype.forEach.call(q('[data-i18n-ph]'), function (n) { n.setAttribute('placeholder', t(n.getAttribute('data-i18n-ph'))); });
    if (document.documentElement) document.documentElement.setAttribute('lang', t.lang);
  }

  root.RecapI18n = { make: make, resolve: resolve, apply: apply, dict: DICT };
})(typeof window !== 'undefined' ? window : globalThis);
