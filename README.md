# Accessibility Checker — by Viral Deshle

Automated WCAG accessibility and performance auditing for websites.

- **`web/`** — the Next.js frontend (deploys to Vercel): live scan progress, screenshots of every problem element, and an Accessibility ↔ Performance view with animated scores.
- **Repo root** — the scanner (Node + Puppeteer + axe-core). Runs as an Express server locally, or on AWS Lambda via `lambda.js`, streaming progress to the frontend.

See **[DEPLOY.md](DEPLOY.md)** for Lambda + Vercel setup.

### Streaming API

`POST /api/scan` with `{ "urls": ["https://example.com"], "crawl": false, "maxPages": 10 }` returns newline-delimited JSON events: `status`, `plan`, `page-start`, `page-progress`, `challenge`, `page-preview` (screenshot), `page-complete` (results + performance), `page-failed`, `report` (full HTML report), and finally `done` or `error`. See `scanStream.js`.

---

Automated WCAG accessibility auditing for websites — crawl a site (or scan a list of URLs), run [axe-core](https://github.com/dequelabs/axe-core) plus a curated set of custom rules, and get back a clean, shareable HTML report.

Built with Express + Puppeteer. No client-side app, no build step — one Node process serves the UI, runs the audits, and renders the report.

## Features

- **Single-page or full-site crawl** — audit one URL, or crawl same-origin subpages (locale variants excluded) up to a configurable page limit.
- **Multi-URL batch mode** — pass multiple `?url=` params to audit an arbitrary list of pages in one combined report, no crawling.
- **axe-core + custom rules** — runs the full axe-core 4.x ruleset plus additional rules covering gaps in the built-in set (see [`customAxeRules.js`](customAxeRules.js) for what's included and why).
- **Bounded concurrency** — pages are audited in parallel batches (tunable via `AUDIT_CONCURRENCY`) instead of one Chrome tab at a time.
- **Bot-challenge detection** — recognizes Cloudflare/WAF interstitials and waits for them to clear before giving up.
- **Manual-scan fallback** — for sites that block every automated browser: open the site in your own browser, paste one console snippet, and it runs the same audit client-side and posts results back for a report.
- **Noise filtering** — strips known scratch-DOM elements (font-metrics probes, analytics benchmarking divs) that plugins inject and that would otherwise pollute results with false positives.
- **SSRF-safe by design** — validates and blocks requests to private/internal IP ranges before fetching any user-submitted URL.
- **Structured logging + failure alerting** — JSON-line logs, with optional Slack/ClickUp notifications on audit failures or suspiciously low crawl yield ([`logger.js`](logger.js), [`alerts.js`](alerts.js)).
- **Self-cleaning reports** — generated reports are viewable, downloadable once, and swept off disk automatically.

## Quick start

**Requirements:** Node 22+, and either a local Chrome/Chromium install (see [Chrome setup](#chrome-setup)) or Docker.

```bash
git clone <your-fork-or-repo-url>
cd accessibility-checker
npm install
cp .env.example .env   # optional — every setting has a working default
npm run dev            # nodemon, auto-restarts on change
# or
npm start               # node index.js
```

Open `http://localhost:4000`, enter a URL, and run a scan.

### Chrome setup

The app looks for a Chrome/Chromium binary in this order: `CHROME_BIN` / `CHROMIUM_BIN` env var → common system install paths → Puppeteer's bundled Chromium (if installed). On macOS/Linux with Chrome already installed, no extra config is needed.

### Docker

```bash
docker build -t accessibility-checker .
docker run -p 3000:3000 --env-file .env accessibility-checker
```

The image installs system Google Chrome and skips Puppeteer's bundled Chromium download, keeping the image lean.

## Usage

### Web UI

Visit `/` and submit one or more URLs through the form. Under the hood this calls the same `/audit` endpoint below.

### API

**`GET /audit`** — run an audit, get back a report link.

| Param | Type | Default | Description |
|---|---|---|---|
| `url` | string, repeatable | — | URL to audit. Repeat (`?url=a&url=b`) to batch-scan multiple pages in one report. |
| `crawl` | boolean | `true` | Single-URL mode only. `true` crawls same-origin subpages; `false` audits just that page. Ignored (forced off) when multiple `url` params are given. |
| `maxPages` | integer | `20` | Max pages to include in a crawl. Capped by `ABSOLUTE_MAX_PAGES` regardless of what's requested. |

```bash
# Single page, no crawling
curl "http://localhost:3000/audit?url=https://example.com&crawl=false"

# Crawl up to 10 pages from the homepage
curl "http://localhost:3000/audit?url=https://example.com&maxPages=10"

# Batch-scan a specific list of pages
curl "http://localhost:3000/audit?url=https://example.com/&url=https://example.com/about"
```

Response:
```json
{ "success": true, "reportId": "...", "viewUrl": "/reports/<id>/view", "downloadUrl": "/reports/<id>/download", "failures": [] }
```

- **`GET /reports/:id/view`** — view a report inline (repeatable; not deleted after viewing).
- **`GET /reports/:id/download`** — download the report as HTML (single-shot — deleted from disk once downloaded).
- **`GET /health`** — liveness check, returns `{ "success": true, "status": "ok" }`.

### Manual scan (for bot-protected sites)

Some sites block every automated browser outright. For those, the UI offers a manual fallback: open the site yourself, solve any challenge, then run a one-line snippet in DevTools. It loads the same axe-core + custom rules used server-side and posts results back to build a normal report — no server-side page load required.

## Configuration

All settings are optional — every value has a sensible built-in default. Copy `.env.example` to `.env` to override any of them.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on. |
| `NODE_ENV` | — | Set to `production` in deployed environments. |
| `AUTO_OPEN_BROWSER` | — | Opens the app in your default browser on local start. |
| `PUBLIC_BASE_URL` | request-derived | Explicit public URL, needed behind a proxy/CDN where the forwarded host can't be trusted. |
| `MAX_CRAWL_PAGES` | `20` | Default crawl depth when `maxPages` isn't specified. |
| `ABSOLUTE_MAX_PAGES` | `50` | Hard ceiling no request can exceed, regardless of `maxPages`. |
| `AUDIT_CONCURRENCY` | `4` | Concurrent Chrome tabs during a crawl/batch. Each slot is a full renderer process — tune alongside available memory. |
| `PAGE_NAVIGATION_TIMEOUT_MS` | `30000` | Per-page navigation timeout before it's counted as a failure. |
| `BOT_CHALLENGE_TIMEOUT_MS` | `8000` | How long to wait for a Cloudflare/WAF interstitial to clear. |
| `LOW_PAGE_YIELD_THRESHOLD` | `5` | Below this page count on a deeper-allowed crawl, a `low-page-yield` incident is flagged (likely a link-discovery issue). |
| `BROWSER_IDLE_TIMEOUT_MS` | `60000` | How long an idle browser instance stays warm before closing. |
| `SCAN_USER_AGENT` | realistic Chrome UA | Override if a target site fingerprint-blocks the default. |
| `CHROME_BIN` / `CHROMIUM_BIN` | auto-detected | Explicit path to a Chrome/Chromium binary. |
| `SLACK_WEBHOOK_URL` | unset (skipped) | Incoming webhook for failure/incident alerts. |
| `CLICKUP_API_TOKEN` / `CLICKUP_LIST_ID` | unset (skipped) | Creates a ClickUp task on incidents when both are set. |

See [`.env.example`](.env.example) for the full annotated list.

## How it works

1. A request hits `/audit` with one or more URLs.
2. Each URL is validated (`isUrlSafe`) to block private/internal IP targets before anything is fetched.
3. Puppeteer (with the stealth plugin) launches or reuses a shared Chrome instance and loads each page — auto-scrolling to trigger lazy content, waiting out any bot challenge, and giving deferred scripts a moment to settle.
4. axe-core plus the custom rule set run against the fully-rendered DOM, after known noise elements (font-probe spans, tracking-benchmark divs) are stripped out.
5. In single-URL crawl mode, same-origin links are collected from the homepage and audited concurrently up to `maxPages`.
6. Results are assembled into a report and rendered to static HTML (`reportTemplate.js`), saved to disk, and returned as a `viewUrl`/`downloadUrl` pair.
7. A background sweep removes reports once downloaded or after they age out.

## Project structure

```
index.js              Express app, routes, crawl/audit orchestration, browser lifecycle
customAxeRules.js      Custom axe-core rules layered on top of the built-in ruleset
reportTemplate.js      Pure JSON → HTML report renderer (no Node-specific deps)
networkCapture.js      Attaches request/response capture to a Puppeteer page
views/home.js          Server-rendered HTML for the scan form UI
logger.js              Structured, human-readable line logging
alerts.js              Slack/ClickUp incident notifications with a durable local fallback log
public/                Static assets (favicon, etc.)
reports/               Generated report HTML (created at runtime, gitignored)
logs/                  Local JSONL incident log (fallback if Slack/ClickUp are unset)
```

## Deployment

- **Docker** — `Dockerfile` builds a Node 22 + system Chrome image; works on any container host.
- **Render** — `render.yaml` is a ready-to-use blueprint (Docker runtime, `/health` check).
- **AWS Lambda** — a serverless migration plan (S3 + CloudFront-hosted reports, batched-concurrency audit Lambda) is documented in [`PLAN.md`](PLAN.md) for scaling this beyond a single always-on server.

## License

ISC
