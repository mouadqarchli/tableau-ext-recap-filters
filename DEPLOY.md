# Deploying to Tableau Cloud (self-hosted)

1. Copy `tableau.extensions.1.latest.min.js` (from the tableau/extensions-api repo, `lib/` folder) into `lib/`.
2. Upload this whole folder to an HTTPS static host, e.g. `https://<host>/recap-filtres/`.
   Check that `https://<host>/recap-filtres/index.html` opens in a browser.
3. In `RecapFiltres.trex`, replace `https://YOUR-HOST/recap-filtres/index.html` with the real URL.
4. Tableau Cloud site admin: Settings > Extensions
   - enable "Let users run extensions on this site";
   - add the URL `https://<host>/recap-filtres/index.html` to the safe list,
     Full data access: Denied (not needed), Prompt users: Hidden.
5. In Tableau Desktop: remove the localhost extension from the dashboard, add the new `RecapFiltres.trex`,
   reconfigure it if needed, then publish to Tableau Cloud.

Updating: overwrite the files on the host and bump the `?v=` numbers in the .html files
so browsers reload the new version. No republish needed unless the URL changes.
