require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { spawn } = require("child_process");
const axeSource = require("axe-core").source;
const { buildHtmlReport } = require("./reportTemplate");
const { customRules, CUSTOM_RULE_IDS } = require("./customAxeRules");
const { buildManualScanBundle } = require("./manualScanBundle");
const { renderHomePage } = require("./views/home");
const { isUrlSafe, runScan, closeBrowser, failureDetails, MAX_CRAWL_PAGES, LOW_PAGE_YIELD_THRESHOLD } = require("./scanner");
const { streamScan } = require("./scanStream");
const logger = require("./logger");
const { flagIncident } = require("./alerts");

const app = express();
const PORT = process.env.PORT || 4000;
const REPORTS_DIR = path.join(__dirname, "reports");

// The public URL this server is reachable at — needed so the manual-scan
// bundle (loaded from an arbitrary third-party site) knows where to fetch
// axe-core from and where to POST results back to.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "") || null;

// Comma-separated list of frontend origins allowed to call /api/scan
// (e.g. https://your-app.vercel.app). "*" allows any origin.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.set("trust proxy", true);

function terminalLink(text, url) {
  return `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`;
}

function openInChrome(url) {
  const platform = process.platform;
  const attempts =
    platform === "darwin"
      ? [["open", ["-a", "Google Chrome", url]], ["open", [url]]]
      : platform === "win32"
      ? [["cmd", ["/c", "start", "chrome", url]], ["cmd", ["/c", "start", "", url]]]
      : [["google-chrome", [url]], ["xdg-open", [url]]];
  const tryNext = (index) => {
    if (index >= attempts.length) return;
    const [command, args] = attempts[index];
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => tryNext(index + 1));
    child.unref();
  };
  tryNext(0);
}

// ---------- Report files (legacy /audit + manual scan) ----------
// Anything in reports/ at boot was never downloaded — clear it.
function clearReportsOnBoot() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  for (const file of fs.readdirSync(REPORTS_DIR)) fs.unlinkSync(path.join(REPORTS_DIR, file));
}

// Reports delete themselves on download; this catches ones never downloaded.
function cleanupOldReports() {
  if (!fs.existsSync(REPORTS_DIR)) return;
  const maxAgeMs = 10 * 60 * 1000;
  const now = Date.now();
  for (const file of fs.readdirSync(REPORTS_DIR)) {
    const filePath = path.join(REPORTS_DIR, file);
    if (now - fs.statSync(filePath).mtimeMs > maxAgeMs) fs.unlinkSync(filePath);
  }
}

// ---------- Report writer ----------
// Shared by the automated /audit route and the manual bookmarklet endpoint.
function saveReport(pageResults, requestedUrl) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const timestamp = Date.now();
  const multiMode = Array.isArray(requestedUrl);
  let reportName;
  if (multiMode) {
    const domains = [
      ...new Set(
        requestedUrl.map((u) => {
          try {
            return new URL(u).hostname.replace(/^www\./, "");
          } catch {
            return "unknown";
          }
        })
      ),
    ];
    reportName = domains.length <= 2 ? domains.join("+") : `${domains[0]}+${domains.length - 1}more`;
  } else {
    reportName = new URL(requestedUrl).hostname.replace(/^www\./, "");
  }

  // A random token keeps concurrent scans of the same domain from colliding
  // on disk and makes the download URL unguessable; the human-readable name
  // is kept as the suggested filename when the browser actually downloads it.
  const token = crypto.randomBytes(8).toString("hex");
  const id = `${reportName}-${token}`;
  const htmlFilename = `${id}.html`;

  const combinedReport = { requestedUrl, timestamp, pages: pageResults };
  const html = buildHtmlReport(combinedReport, CUSTOM_RULE_IDS);
  fs.writeFileSync(path.join(REPORTS_DIR, htmlFilename), html);

  const totalViolations = pageResults.reduce((sum, p) => sum + (p.accessibility.violations || []).length, 0);
  const totalPasses = pageResults.reduce((sum, p) => sum + (p.accessibility.passes || []).length, 0);
  const customRuleIdSet = new Set(customRules.map((r) => r.id));
  const totalCustom = pageResults.reduce(
    (sum, p) => sum + (p.accessibility.violations || []).filter((v) => customRuleIdSet.has(v.id)).length,
    0
  );

  return {
    pagesScanned: pageResults.length,
    violations: totalViolations,
    customRuleViolations: totalCustom,
    passes: totalPasses,
    // This route streams the file to the client, then deletes it from
    // disk — each report can only be downloaded once.
    report: `/reports/${id}/download`,
    // Renders the same report inline in the browser without consuming it —
    // can be opened as many times as needed until it expires (download, or
    // the 10-minute cleanup job, whichever comes first).
    viewReport: `/reports/${id}/view`,
  };
}

// ---------- Routes ----------
app.get("/", (req, res) => {
  res.type("html").send(renderHomePage());
});

// ---------- Streaming scan API (used by the web frontend) ----------
function applyCors(req, res) {
  const origin = req.get("origin");
  if (ALLOWED_ORIGINS.includes("*")) res.set("Access-Control-Allow-Origin", "*");
  else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

app.options("/api/scan", (req, res) => {
  applyCors(req, res);
  res.sendStatus(204);
});

// Streams newline-delimited JSON progress events (see scanStream.js).
app.post("/api/scan", express.json({ limit: "64kb" }), async (req, res) => {
  applyCors(req, res);
  res.status(200);
  res.set("Content-Type", "application/x-ndjson; charset=utf-8");
  res.set("Cache-Control", "no-cache, no-transform");
  res.set("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  const write = (event) => {
    if (!closed) res.write(JSON.stringify(event) + "\n");
  };

  try {
    await streamScan(req.body, write);
  } finally {
    res.end();
  }
});

// Legacy JSON endpoint: runs a full scan and returns links to a saved report.
// ?url=a&url=b batches pages; a single url crawls unless ?crawl=false.
app.get("/audit", async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ success: false, message: "Please provide a URL" });
  const urls = Array.isArray(rawUrl) ? rawUrl : [rawUrl];
  const multiMode = urls.length > 1;
  const crawlParam = req.query.crawl;
  const crawl = !multiMode && (crawlParam === undefined || ["true", "1", "on"].includes(String(crawlParam).toLowerCase()));
  const maxPages = parseInt(req.query.maxPages) || MAX_CRAWL_PAGES;

  for (const u of urls) {
    if (!(await isUrlSafe(u))) return res.status(400).json({ success: false, message: `Invalid or unsafe URL: ${u}` });
  }

  try {
    const { pageResults, failures } = await runScan({ urls, crawl, maxPages });
    const failed = failureDetails(failures);

    if (pageResults.length === 0) {
      const botBlocked = failed.find((f) => f.reason === "bot-challenge");
      const message = botBlocked
        ? `${botBlocked.vendor} blocked this scan with a bot-detection challenge` +
          (botBlocked.status ? ` (HTTP ${botBlocked.status})` : "") +
          ". Try again in a few minutes, or use the manual scan from your own browser."
        : "Failed to load the provided URL(s). The site may be blocking automated browsers or redirecting unexpectedly.";
      await flagIncident("audit-failed", {
        url: multiMode ? urls : urls[0],
        reason: botBlocked ? "bot-challenge" : failed[0]?.reason || "unknown",
        failures: failed,
      });
      return res.status(400).json({ success: false, message, failures: failed });
    }

    if (crawl && pageResults.length < LOW_PAGE_YIELD_THRESHOLD && maxPages > pageResults.length) {
      await flagIncident("low-page-yield", { url: urls[0], pagesScanned: pageResults.length, maxPages, failures: failed });
    }

    res.json({ success: true, ...saveReport(pageResults, multiMode ? urls : urls[0]), failures: failed });
  } catch (error) {
    logger.error("audit-request-crashed", { urls, error: error.message, stack: error.stack });
    await flagIncident("audit-failed", { url: multiMode ? urls : urls[0], reason: "crash", detail: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------- Manual scan fallback ----------
// For sites whose bot-protection blocks every automated browser we can
// launch: the user opens the site normally (a real, already-trusted browser
// session), solves any challenge themselves, then pastes a one-line snippet
// into DevTools console. That snippet loads this bundle, which runs the same
// axe-core + custom rules used elsewhere and posts results back for a report.
app.get("/manual-scan/axe-core.js", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.type("application/javascript").send(axeSource);
});

app.get("/manual-scan/bundle.js", (req, res) => {
  const origin = PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  res.set("Access-Control-Allow-Origin", "*");
  res.type("application/javascript").send(buildManualScanBundle({ origin, maxPages: MAX_CRAWL_PAGES }));
});

app.options("/audit/manual", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

app.post("/audit/manual", express.json({ limit: "60mb" }), (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  try {
    const body = req.body || {};
    // Accept either a single-page submission ({url, accessibility}) or a
    // one-level-deep crawl ({requestedUrl, pages: [...]}) from the bundle.
    let pages = Array.isArray(body.pages) ? body.pages : null;
    if (!pages && body.url && body.accessibility) {
      pages = [{ url: body.url, finalUrl: body.url, accessibility: body.accessibility }];
    }
    if (!pages || pages.length === 0) {
      return res.status(400).json({ success: false, message: "Missing page results" });
    }

    const pageResults = pages
      .filter((p) => p && p.url && p.accessibility)
      .map((p) => ({
        url: p.url,
        finalUrl: p.finalUrl || p.url,
        accessibility: p.accessibility,
        network: { summary: null, requests: [] },
        console: [],
      }));
    if (pageResults.length === 0) {
      return res.status(400).json({ success: false, message: "Missing page results" });
    }

    const requestedUrl = body.requestedUrl || pageResults[0].url;
    const reportInfo = saveReport(pageResults, requestedUrl);
    res.json({ success: true, ...reportInfo });
  } catch (error) {
    logger.error("manual-scan-crashed", { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Meant to be pinged periodically (e.g. by an uptime monitor) both to keep
// a free-tier host from idling the service down and to actually catch a
// dead Puppeteer browser (crashed Chrome, disconnected CDP session) rather
// than just confirming the Node process itself is still running.
// Chrome is launched lazily per-request and closed when idle (see
// getBrowser()), so browser being absent here is the normal resting state,
// not a failure — this just confirms the Node process itself is up.
app.get("/health", (req, res) => {
  res.json({ success: true, status: "ok" });
});

app.use(express.static(path.join(__dirname, "public")));

// Reports are single-shot: each is streamed to the client and then removed
// from disk, so a scan's output never lingers on the server longer than it
// takes the user to download it.
app.get("/reports/:id/download", (req, res) => {
  const id = path.basename(req.params.id);
  const htmlPath = path.join(REPORTS_DIR, `${id}.html`);
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send("Report not found — it may have already been downloaded and removed from the server.");
  }
  const downloadName = id.replace(/-[0-9a-f]{16}$/, "") + ".html";
  res.download(htmlPath, downloadName, () => {
    fs.unlink(htmlPath, () => {});
  });
});

// Renders the report inline instead of downloading it, and — unlike
// /download — doesn't delete it afterwards, so it can be opened repeatedly
// (e.g. re-checked in a second tab) until it's downloaded or expires via
// cleanupOldReports.
app.get("/reports/:id/view", (req, res) => {
  const id = path.basename(req.params.id);
  const htmlPath = path.join(REPORTS_DIR, `${id}.html`);
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send("Report not found — it may have already been downloaded and removed from the server.");
  }
  res.type("html").sendFile(htmlPath);
});

// ---------- Startup / shutdown ----------
async function start() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  clearReportsOnBoot();

  setInterval(cleanupOldReports, 60 * 1000);

  app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Accessibility Checker running at ${terminalLink(url, url)}`);

    const autoOpenDisabled =
      process.env.NODE_ENV === "production" || ["false", "0"].includes(process.env.AUTO_OPEN_BROWSER);
    if (!autoOpenDisabled) openInChrome(url);
  });
}

async function shutdown() {
  logger.info("server-shutting-down");
  await closeBrowser();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((err) => {
  logger.error("server-start-failed", { error: err.message, stack: err.stack });
  process.exit(1);
});
