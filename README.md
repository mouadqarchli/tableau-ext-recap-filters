# Filters & parameters recap — Tableau dashboard extension (v2.3.1)

Shows a visual recap of **what the user has selected on the dashboard**, in English (default) or French, with a full **export**.

* **Filters**: only those with a **filter card on the dashboard**, including cards in a collapsed filter panel (configurable). Technical filters, action filters and generated fields (*Measure Names*) are ignored.
* **Parameters**: only those with a **parameter control**, shown with the control's caption.
* **Same order as the dashboard** (row by row, left to right).
* Filters equivalent to "All" are hidden: "(All)", every value ticked one by one, only Null unticked (the card then shows "(All)"), or a range slider at its bounds.
* **"Except" display**: when few values are unticked (≤ 12 and fewer than the kept values), the recap shows "Except Australia, New Zealand" instead of "45 values of 47".
* A filter whose status is not yet known is **not shown** (no appear-then-disappear); the summary says "analysing N filters…".

## Export

The **Export** button (download icon) opens a window with the full report — every value of every filter, no truncation — plus a search box. From there:

| Action | Result |
|---|---|
| Copy as text | Readable list, ready to paste into Outlook, Teams or Excel |
| Download CSV | One row per filter/parameter (Type, Name, Mode, Values, Count, Total); `,` separator in English, `;` in French |
| Download text | Same content as "Copy as text", as a .txt file |
| Print / PDF | Opens the report in your web browser (default browser from Tableau Desktop) and launches printing with complete lists — choose "Save as PDF" |

Tableau Desktop may block downloads from extension windows: use **Copy as text** there. On Tableau Server / Cloud in a browser, all four actions work.

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
| Accent colour | #ff6d00 | Preset palette + custom colour |
| Theme | Light | Light / Dark / Transparent |
| Density | Comfortable | Compact for small zones |
| Layout | Automatic | Cards, banner, or banner automatically when the zone is ≤ 140 px high |
| Visible values per filter | 4 | Beyond that: clickable "+N" chip |
| Show parameters / clear buttons / export / share of values | On | |
| Show filters set to "All" | Off | Shown greyed out |
| Workbook font | On | Uses the sheets' font (Tableau 2021.4+) |
| Cards in hidden containers | On | Includes a collapsed filter panel |
| Hide "every value ticked" filters | On | Background query; turn off on very large sources |
| "All except Null" = not restrictive | On | Matches the "(All)" shown by Tableau |

## Diagnostics

In authoring mode, the bug button (or Ctrl+Alt+D) lists every filter of every sheet with the reason it is shown or not.

## Performance

* No external dependency (no jQuery, web fonts or icon fonts).
* Incremental updates: a filter change re-reads **that filter only**; changes to non-exposed filters trigger no Tableau call.
* Layout events are ignored unless cards/controls actually changed; only sheets carrying the cards are re-read.
* Domain queries run in the background (2 at a time, never ahead of a user action) and verdicts are cached for 12 h, as are totals, bounds and the last display (instant reopen).
* Optimistic clearing, targeted DOM updates, loading bar only after 250 ms.

## Demo

`python -m http.server 8765` from the repo root, then open `http://localhost:8765/Samples/Dashboard/RecapFiltres/demo/preview.html`.
