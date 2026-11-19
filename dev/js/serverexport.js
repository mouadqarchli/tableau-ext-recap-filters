/* Export « serveur » : au lieu de lire les lignes une à une via l'API Extensions
 * (lent, limité par la mémoire du navigateur), on demande à Tableau Server / Cloud
 * de générer lui-même le CSV de la feuille, avec les filtres et paramètres
 * actuels passés dans l'adresse :  .../views/<classeur>/<feuille>.csv?Champ=a,b&Param=x
 * Le fichier est produit par le serveur et téléchargé directement par le navigateur
 * (session de l'utilisateur, droits « Télécharger les données récapitulatives »).
 * Fonctions pures : aucune dépendance à Tableau, testables seules. */
(function (root) {
  'use strict';

  // Accepte toute adresse d'une vue publiée du classeur :
  //  https://h/#/site/S/views/WB/Vue?:iid=1   https://h/t/S/views/WB/Vue
  //  https://h/#/views/WB/Vue                 https://h/views/WB/Vue
  // -> { origin, site, workbook } ou null
  function parseViewUrl (u) {
    var s = String(u || '').trim();
    if (!s) return null;
    var m = /^(https?:\/\/[^/#?]+)(.*)$/i.exec(s);
    if (!m) return null;
    var rest = m[2].replace(/^\/?#/, '').split('?')[0];
    var sm = /\/(?:site|t)\/([^/]+)\/views\/([^/]+)(?:\/|$)/i.exec(rest);
    if (sm) return { origin: m[1], site: decodeURIComponent(sm[1]), workbook: decodeURIComponent(sm[2]) };
    var dm = /\/views\/([^/]+)(?:\/|$)/i.exec(rest);
    if (dm) return { origin: m[1], site: '', workbook: decodeURIComponent(dm[1]) };
    return null;
  }

  // Nom d'URL d'une feuille tel que Tableau le génère à la publication :
  // espaces et ponctuation supprimés, tirets et soulignés conservés.
  // « Sell in - Details Table » -> « Sellin-DetailsTable ». Surcharge possible dans Configure.
  function viewUrlName (sheetName) {
    var s = String(sheetName || '');
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.replace(/[^A-Za-z0-9_-]+/g, '');
  }

  // Lignes « Nom de feuille = NomDansLURL » -> { feuille: nom }
  function parseOverrides (text) {
    var map = {};
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf('=');
      if (i <= 0) return;
      var k = line.slice(0, i).trim(); var v = line.slice(i + 1).trim();
      if (k && v) map[k] = v;
    });
    return map;
  }

  function csvUrl (base, sheetName, overrides) {
    var view = (overrides && overrides[sheetName]) || viewUrlName(sheetName);
    var path = (base.site ? '/t/' + encodeURIComponent(base.site) : '') +
      '/views/' + encodeURIComponent(base.workbook) + '/' + encodeURIComponent(view) + '.csv';
    return base.origin + path;
  }

  // Valeur brute d'un DataValue Tableau -> texte pour l'URL (dates en AAAA-MM-JJ)
  function rawText (dv) {
    if (dv == null) return null;
    var v = dv.value !== undefined ? dv.value : dv;
    if (v == null || v === '%null%') return null;
    if (v instanceof Date) return isoDate(v);
    var s = String(v);
    var m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/.exec(s);
    if (m) return m[2] && m[2] !== '00:00:00' ? m[1] + ' ' + m[2] : m[1];
    return s;
  }
  function isoDate (d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var day = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    return d.getHours() || d.getMinutes() || d.getSeconds() ? day + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) : day;
  }

  // Une virgule dans une valeur se protège par une barre oblique inverse (syntaxe des filtres d'URL Tableau)
  function escValue (s) { return String(s).replace(/\\/g, '\\\\').replace(/,/g, '\\,'); }

  // params : [{ name, value }] ; filters : [{ field, values: [texte] }]
  function buildQuery (filters, params) {
    var q = [];
    params.forEach(function (p) { if (p.value != null && p.value !== '') q.push(encodeURIComponent(p.name) + '=' + encodeURIComponent(p.value)); });
    filters.forEach(function (f) {
      q.push(encodeURIComponent(f.field) + '=' + f.values.map(function (v) { return encodeURIComponent(escValue(v)); }).join(','));
    });
    return q.join('&');
  }

  var URL_SAFE_LENGTH = 7500; // au-delà, certains serveurs / proxys refusent l'adresse

  root.RecapServer = {
    parseViewUrl: parseViewUrl, viewUrlName: viewUrlName, parseOverrides: parseOverrides,
    csvUrl: csvUrl, rawText: rawText, buildQuery: buildQuery, escValue: escValue, URL_SAFE_LENGTH: URL_SAFE_LENGTH
  };
})(typeof window !== 'undefined' ? window : globalThis);
