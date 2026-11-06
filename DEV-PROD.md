# Prod & dev in the same repository

```
tableau-ext-recap-filters/        (branch main, GitHub Pages "Deploy from a branch": main / root)
├─ index.html, configure.html, export.html, css/, js/, version.json   ← PROD
├─ lib/tableau.extensions.1.latest.min.js                               ← shared by prod and dev
├─ RecapFiltres.trex                                                    ← PROD manifest (unchanged)
├─ RecapFiltres-DEV.trex                                                ← DEV manifest
└─ dev/
   ├─ index.html, configure.html, export.html, css/, js/, version.json ← DEV
```

| | URL to safe-list in Tableau Cloud | Manifest |
|---|---|---|
| PROD | https://<owner>.github.io/tableau-ext-recap-filters/index.html | RecapFiltres.trex |
| DEV  | https://<owner>.github.io/tableau-ext-recap-filters/dev/index.html | RecapFiltres-DEV.trex |

The DEV version shows a yellow (SMCP palette) DEV badge and uses its own local cache.
The two manifests have different extension ids: a workbook knows which one it uses.

## Day to day
1. Change files in `dev/` only, bump `dev/version.json`, commit. Test with RecapFiltres-DEV.trex.
2. Promote to prod: copy `dev/index.html, dev/configure.html, dev/export.html, dev/css/, dev/js/`
   to the root (overwrite), set the root `version.json` to the new version, commit.
3. Never copy `version.json` from dev to root as is, never touch `lib/` or the .trex files when promoting.

## Switching a workbook between prod and dev
Remove the extension object, add the other .trex, reconfigure (Configure… settings are stored per
extension object, so they do not carry over automatically), republish.
Tip: test DEV in a copy of the workbook.
