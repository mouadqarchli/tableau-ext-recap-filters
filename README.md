# Filters & parameters recap — Tableau dashboard extension (v2.8.0)

Shows a visual recap of **what the user has selected on the dashboard**, in English (default) or French, with a full **export**.

* **Filters**: only those with a **filter card on the dashboard**, including cards in a collapsed filter panel (configurable). Technical filters, action filters and generated fields (*Measure Names*) are ignored.
* **Parameters**: only those with a **parameter control**, shown with the control's caption.
* **Alphabetical order** of filters and parameters by default (Configure… > Order: Alphabetical / Dashboard order).
* Filters equivalent to "All" are hidden: "(All)", every value ticked one by one, only Null unticked (the card then shows "(All)"), or a range slider at its bounds.
* **"Except" display**: when few values are unticked (≤ 12 and fewer than the kept values), the recap shows "Except Australia, New Zealand" instead of "45 values of 47".
* A filter whose status is not yet known is **not shown** (no appear-then-disappear); the summary says "analysing N filters…".

## Export

The **Export** button (download icon) opens a window with the full report — every value of every filter, no truncation — plus a search box. From there:

| Action | Result |
|---|---|
| Copy as text | Readable list, ready to paste into Outlook, Teams or Excel |
| Download CSV | One row per filter/parameter (Type, Name, Mode, Count, Total, Values); separator chosen in Configure… > Data export (automatic: `;` for French Excel, `,` otherwise); quotes only where needed |
| Download text | Same content as "Copy as text", as a .txt file |
| Print / PDF | Opens the report in your web browser (default browser from Tableau Desktop) and launches printing with complete lists — choose "Save as PDF" |

Tableau Desktop may block downloads from extension windows: use **Copy as text** there. On Tableau Server / Cloud in a browser, all four actions work.

## Data export (sheets + recap)

The **Export data** button (table icon) opens a panel listing the dashboard's visible sheets. Tick one or more, choose **Excel** or **CSV**, keep "Add the filters & parameters recap below the data" ticked, then **Export**:

* **Excel (.xlsx)**: one tab per sheet — the data first (header row frozen, automatic filter on the data only, numbers and dates typed), then two empty rows and the **recap below the data** (dashboard, date, row count, every filter and parameter). SMCP styling: Verdana, black header, bordeaux recap header.
* **CSV**: one file per sheet, the data first then the recap below. Separator: Automatic (`;` with decimal comma when the extension or the computer is in French, `,` otherwise), or forced to `;`, `,` or Tab. Values are quoted **only** when they contain the separator or a double quote; line breaks, tabs and invisible characters inside values are removed so that one Tableau row stays one CSV row.
* **Copy**: same layout (data, then recap) as tab-separated text, to paste into Excel — use it in Tableau Desktop, which may block downloads.

The export contains the **summary data** of each sheet (what the sheet displays, with filters and parameters applied, selection ignored). *Measure Names / Measure Values* are pivoted back into one column per measure. Grand totals and subtotals are not part of the summary data. No "full data" permission is required.

**Columns.** By default the export follows the sheet: dimensions in the order of the Rows/Columns shelves, then the measures (Tableau does not expose their display order: set it once in Columns), and fields placed only on Detail or Tooltip (helper calculations, titles…) are left out — this needs Tableau 2023.3+ (API 1.11). For full control, Configure… > Data export > **Columns** lets the designer tick, reorder and rename the columns of each sheet. The export panel also offers **Values: Raw** (typed numbers and dates) or **As displayed** (exactly the text shown in the view, e.g. "42%").

In Configure… > **Data export** the designer chooses which sheets are exportable, which are ticked by default, and the maximum number of rows per sheet (200,000 by default).

> Governance: check with your Tableau Cloud admin how the "Download Summary Data" capability applies to extensions, and test with a user who does not have it.

## Quick start with the tableau/extensions-api repo (`npm start`)

1. Copy the **`RecapFiltres`** folder into `<repo>/Samples/Dashboard/`.
2. From the repo root: `npm start` (not `npm run start-sandbox`).
3. Check `http://localhost:8765/Samples/Dashboard/RecapFiltres/index.html` opens in a browser ("Initialization failed" is expected outside Tableau).
4. In Tableau: add `RecapFiltres.trex`.

The Tableau library is found automatically in the folder's `lib/`, or else in the repo's `lib/`.

## Production deployment

1. Put `tableau.extensions.1.latest.min.js` in `lib/`.
2. Host the folder on an **HTTPS** server and update `<url>` in `RecapFiltres.trex`.
3. Tableau Server / Cloud: add the URL to the extensions safe list. Full data access is **not** required.
4. Do not deploy `demo/` or `tests/`.

## Settings (extension menu → Configure…)

| Setting | Default | Purpose |
|---|---|---|
| Language | English | English / Français / Automatic (Tableau language) |
| Title | Filters & parameters | Header text (follows the language when left empty) |
| Accent colour | #A05546 (SMCP bordeaux) | SMCP 2026 palette only (bordeaux, black, olive, ochre, blue grey, yellow); an older colour outside the palette falls back to bordeaux |
| Theme | Light | Light / Ecru (SMCP) / Dark / Transparent |
| Density | Comfortable | Compact for small zones |
| Layout | Automatic | Cards, banner, or banner automatically when the zone is ≤ 140 px high |
| Visible values per filter | 4 | Beyond that: clickable "+N" chip |
| Show parameters / clear buttons / export / share of values | On | |
| Show filters set to "All" | Off | Shown greyed out |
| Workbook font | Off | Off = SMCP fonts (Verdana for titles and labels, Georgia for values). On = the sheets' font (Tableau 2021.4+) |
| Cards in hidden containers | On | Includes a collapsed filter panel |
| Parameter controls in hidden containers | On | Turn off if hidden containers hold technical parameters |
| Hide "every value ticked" filters | On | Background query; turn off on very large sources |
| "All except Null" = not restrictive | On | Matches the "(All)" shown by Tableau |

## Recap content (per dashboard)

Configure… > **Recap content** lists every filter of every sheet and every parameter of the workbook. Each item has **one choice**:

| Choice | Effect |
|---|---|
| **Auto** | The extension decides: filter with a filter card on the dashboard (shown when it actually restricts the data), parameter with a control |
| **Include** | Always in the recap, even when the filter keeps every value |
| **Exclude** | Never in the recap |

Under each item, a line in plain words tells what will happen in the recap, and the coloured edge shows it (olive = in the recap, grey = not in the recap, bordeaux = set manually).

Filters are grouped by what the extension recognised:

* **Recognised automatically**: a filter card exists on the dashboard;
* **Not recognised**: filters applied to the sheets without a filter card (filters pane, actions, sets, hidden sheets…) — choose **Include** to show them;
* **Technical fields** (folded): Measure Names, generated Latitude/Longitude… — can now be included too.

Each row also shows the filter type and the sheets it applies to. A search box filters by filter, parameter or sheet name, and **Set everything back to Auto** clears every Include/Exclude. Secondary settings are folded under **Customise**:

* **Label in the recap**: rename what the recap and the export display;
* **Skip value check** (filters): see Performance.

For parameters, **Control** links the parameter to the control that drives it — useful when the control's name differs from the technical parameter name (e.g. `p__Catalog Season Code` driven by the "Catalog Season Code (Current Year)" control). The parameter then takes that control's place in the recap. "No control" prevents any automatic link.

Parameter controls are linked to their parameter by id when Tableau provides it, otherwise by exact name, then normalized name, then partial name **only when a single parameter matches** (an ambiguous control is reported in Diagnostics and in the Recap content tab instead of being linked to the wrong parameter).

## Diagnostics

In authoring mode, the bug button (or Ctrl+Alt+D) lists every filter of every sheet with the reason it is shown or not.

## Performance

What makes a dashboard slow is the number and cost of calls to Tableau, not the size of the source as such: number of sheets, fields with many values whose full list is read ("every value ticked?", "Except", "x of N"), live connections (each list = one SQL query) and heavy sheets. The diagnostics (bug button) now list the **slowest calls with their duration**.

* First read: only the **visible sheets** are read; hidden technical sheets are read only if a filter card is left without its filter.
* Per filter, Configure… > Recap content > **Skip value check** stops the value-list query for that field (it is then always shown, without "Except" / "x of N").
* Configure… opens without reading any sheet data; a sheet's columns are read only when its **Columns** section is expanded (and not at all when a manual column setup exists).

* No external dependency (no jQuery, web fonts or icon fonts).
* Incremental updates: a filter change re-reads **that filter only**; changes to non-exposed filters trigger no Tableau call.
* Layout events are ignored unless cards/controls actually changed; only sheets carrying the cards are re-read.
* Domain queries run in the background (2 at a time, never ahead of a user action) and verdicts are cached for 12 h, as are totals, bounds and the last display (instant reopen).
* Optimistic clearing, targeted DOM updates, loading bar only after 250 ms.

## Test environment (branch `develop`)

The workflow `.github/workflows/pages.yml` publishes both branches on the same GitHub Pages site:

| Branch | URL | Manifest |
|---|---|---|
| `main` (prod) | `https://<owner>.github.io/<repo>/index.html` | `RecapFiltres.trex` |
| `develop` (test) | `https://<owner>.github.io/<repo>/dev/index.html` | `RecapFiltres-DEV.trex` |

The DEV version shows a purple **DEV** badge and keeps its own local cache. Its manifest has a different extension id, so prod and dev can never be confused in a workbook.

Workflow: work on `develop` → test in a **copy** of the workbook with `RecapFiltres-DEV.trex` → open a pull request `develop` → `main` → merge = production update.

## Publishing an update

1. Replace the changed files in the repository (never `RecapFiltres.trex` nor `lib/`).
2. Change the number in **`version.json`** (e.g. `{ "v": "2.4.2" }`) and commit.

Every page reads `version.json` without cache on each load and loads CSS/JS with that version, so users get the new version as soon as GitHub Pages has deployed (about 1 minute; check the Actions tab). No need to touch the HTML files or republish the workbooks.

## Demo

`python -m http.server 8765` from the repo root, then open `http://localhost:8765/Samples/Dashboard/RecapFiltres/demo/preview.html`.
