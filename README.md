# Sales KPI Dashboard

Static, backend-free executive dashboard. It reads a published Google Sheet (CSV) in the browser and shows Target vs. Actual sellout by Salesperson, Product Classification, Channel, Store Format and Customer, with a Pareto (80/20) customer analysis, automated insights and exports.

## File structure

```
index.html            page shell + CDN libraries
css/styles.css        theme (light/dark), layout, traffic-light styles
js/utils.js           formatting, number/date parsing, KPI status rules
js/dataService.js     CSV fetch, column detection, records, aggregation
js/insightEngine.js   executive insights + Pareto calculation
js/filters.js         sticky multi-select filters
js/chartManager.js    Apache ECharts charts, PNG export, fullscreen, drill-down
js/tableManager.js    detail table (search, sort, paging, column visibility)
js/exportManager.js   CSV / Excel / PDF export
js/app.js             controller (config, loading, rendering, events)
assets/               optional images (empty)
```

## GitHub Pages deployment

1. Create a GitHub repository and upload all files, keeping the folder structure (`index.html` at the repo root).
2. Repo **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, select `main` and `/ (root)`, then Save.
3. After a minute the site is live at `https://<user>.github.io/<repo>/`.

No build step is needed. Libraries load from public CDNs, so the site needs internet access.

## Local setup

Option A — open `index.html` directly in a browser.
Option B (recommended) — serve it locally:

```bash
cd sales-kpi-dashboard
python3 -m http.server 8080      # then open http://localhost:8080
```

## Google Sheets configuration

1. In Google Sheets: **File → Share → Publish to web**, pick the sheet tab, choose **Comma-separated values (.csv)**, then Publish.
2. Copy the link and set `CONFIG.csvUrl` at the top of `js/app.js`. Use plain `&` in the URL (not `&amp;`).
3. Row 1 must contain headers. Columns are matched case-insensitively:

| Field | Accepted headers |
|---|---|
| Target (required) | target, sellout target, monthly target, sales target |
| Actual (required) | actual, actual sellout, sellout, sales, actual sales |
| Salesperson | salesperson, sales person, sales rep, representative, agent |
| Customer | customer, client, account, buyer |
| Channel | channel, sales channel, route to market |
| Store Format | store format, format, outlet format |
| Product Classification | product classification, classification, category, product category |
| Date | date, transaction date, month, period |

Column order does not matter. Missing optional columns hide the related filter, chart and KPI. A missing Target or Actual column disables the KPI and chart sections and shows a warning. The footer's **Detected columns** list shows which header was matched to each field.

Number cells may contain thousands separators, currency symbols, `%` or parentheses for negatives. Dates are grouped by month; month names ("March") and text periods are kept as written.

## Calculation rules

- Target = SUM(Target), Actual = SUM(Actual), Gap = Actual − Target.
- Achievement % = SUM(Actual) / SUM(Target) × 100, always computed after aggregation (the per-row value in the detail table is for reference only).
- Status: **green** ≥ 100% (Above Target), **yellow** 90–99% (Near Target), **red** < 90% (Below Target). Items with no target show grey.
- Pareto: customers ranked by Actual; Contribution % = customer / total; Cumulative % = running total; the "80% core" is the smallest set reaching 80%. Customers with zero or negative Actual are excluded from the Pareto.

## Features

- **Header:** title, last-updated time, Refresh Data, Auto-refresh (every 5 min, saved in the browser), dark/light theme.
- **Filters:** searchable multi-select with Select all / Deselect all for Salesperson, Channel, Store Format, Product Classification, Customer and Date; everything updates immediately; on mobile the panel collapses.
- **KPI cards:** 8 cards, 4 / 2 / 1 per row on desktop / tablet / mobile.
- **Charts:** Target and Actual bars with an achievement-% label, a dashed Gap connector (green surplus, red shortfall), top and lowest markers, sort by achievement, tooltips, legend toggles, zoom slider for long lists, PNG export, fullscreen. **Clicking a bar drills down** by filtering the whole dashboard to that item; click again to clear.
- **Insights:** generated from the calculated numbers under every chart (key finding, top and lowest performer, gap analysis, risk area, recommended action, plus dimension-specific notes).
- **Pareto:** chart with 80% line, ranking table, concentration-risk rules (top customer > 40% raises an alert).
- **Detail table:** global search, per-column search, sorting, pagination, column visibility; shows every CSV column plus Gap and Achievement %.
- **Exports:** table → CSV and Excel (current search, sort and visible columns; the Excel file also gets summary sheets per dimension); whole dashboard → landscape PDF including the applied filters; each chart → PNG.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "The link returned a web page instead of CSV" | The sheet is not published. Repeat the Publish to web step and choose CSV. |
| "Could not reach Google Sheets" | Check your connection; confirm the URL in `js/app.js`; make sure it uses `&`, not `&amp;`. |
| Required column not found | Rename the header to one of the accepted names above. The banner lists the headers that were found. |
| Charts or KPIs show N/A | The related column is missing or has no Target values. |
| Numbers look wrong | Check for text values in Target/Actual cells; the banner reports skipped or coerced rows. |
| PDF export is blank or fails | Wait for charts to render, then retry; disable ad/script blockers that block the CDNs. |
| Data does not change | Google republishes edits after a short delay (up to a few minutes); then click Refresh Data. |
| Layout unstyled | The Tailwind CDN was blocked; the core layout still works from `css/styles.css`. |

## Notes

- Tailwind is loaded through its Play CDN for convenience. For a strict production build, replace it with a compiled stylesheet (`npx tailwindcss -o css/tailwind.css`).
- Pin or self-host the CDN libraries if your policy requires it.
- The published CSV is public to anyone with the link; do not publish confidential data.
