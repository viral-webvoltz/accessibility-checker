// One streaming scan, transport-agnostic: validates the request, runs the
// scan, and writes newline-delimited JSON events through `write(event)`.
// Used by both the Express route (index.js) and the Lambda handler (lambda.js).
//
// Event types, in rough order:
//   status, plan, page-start, page-progress, challenge, page-preview,
//   page-complete | page-failed, report, done   (or: error)
const { buildHtmlReport, calculateScore } = require("./reportTemplate");
const { CUSTOM_RULE_IDS } = require("./customAxeRules");
const { isUrlSafe, runScan, failureDetails, LOW_PAGE_YIELD_THRESHOLD, MAX_CRAWL_PAGES } = require("./scanner");
const { flagIncident } = require("./alerts");
const logger = require("./logger");

const MAX_INPUT_URLS = parseInt(process.env.MAX_INPUT_URLS) || 20;
// Network rows kept per page in the downloadable report, to keep its size sane.
const REPORT_NETWORK_ROWS = 150;

function parseScanRequest(body) {
  const rawUrls = Array.isArray(body?.urls) ? body.urls : body?.url ? [body.url] : [];
  const urls = rawUrls
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))
    .slice(0, MAX_INPUT_URLS);
  return {
    urls,
    crawl: urls.length === 1 && Boolean(body?.crawl),
    maxPages: parseInt(body?.maxPages) || MAX_CRAWL_PAGES,
  };
}

function buildReport(pageResults, requestedUrl) {
  const pages = pageResults.map((p) => ({
    ...p,
    network: { ...p.network, requests: (p.network?.requests || []).slice(0, REPORT_NETWORK_ROWS) },
  }));
  return buildHtmlReport({ requestedUrl, timestamp: Date.now(), pages }, CUSTOM_RULE_IDS);
}

function reportFilename(urls) {
  const hosts = [...new Set(urls.map((u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "site"; } }))];
  const name = hosts.length <= 2 ? hosts.join("+") : `${hosts[0]}+${hosts.length - 1}more`;
  return `accessibility-report-${name}.html`;
}

function average(values) {
  const nums = values.filter((v) => typeof v === "number");
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

async function streamScan(body, write) {
  const startedAt = Date.now();
  const { urls, crawl, maxPages } = parseScanRequest(body);

  if (urls.length === 0) {
    write({ type: "error", message: "Please enter at least one URL." });
    return;
  }
  for (const u of urls) {
    if (!(await isUrlSafe(u))) {
      write({ type: "error", message: `That URL can't be scanned (invalid, unreachable, or private): ${u}` });
      return;
    }
  }

  logger.info("scan-started", { urls, crawl, maxPages });

  let result;
  try {
    result = await runScan({ urls, crawl, maxPages, emit: write });
  } catch (err) {
    logger.error("scan-crashed", { urls, error: err.message, stack: err.stack });
    await flagIncident("audit-failed", { url: urls, reason: "crash", detail: err.message });
    write({ type: "error", message: "The scanner hit an unexpected error. Please try again." });
    return;
  }

  const { pageResults, failures } = result;
  const failed = failureDetails(failures);

  if (pageResults.length === 0) {
    const botBlocked = failed.find((f) => f.reason === "bot-challenge");
    const message = botBlocked
      ? `${botBlocked.vendor} blocked the automated browser with a "verify you are human" check. You can still scan it from your own browser below.`
      : "We couldn't load that page. It may be down, very slow, or blocking automated browsers.";
    await flagIncident("audit-failed", {
      url: urls.length > 1 ? urls : urls[0],
      reason: botBlocked ? "bot-challenge" : failed[0]?.reason || "unknown",
      failures: failed,
    });
    write({ type: "error", message, failures: failed, botBlocked: Boolean(botBlocked) });
    return;
  }

  if (crawl && pageResults.length < LOW_PAGE_YIELD_THRESHOLD && maxPages > pageResults.length) {
    await flagIncident("low-page-yield", { url: urls[0], pagesScanned: pageResults.length, maxPages, failures: failed });
  }

  try {
    write({ type: "report", filename: reportFilename(urls), html: buildReport(pageResults, urls.length > 1 ? urls : urls[0]) });
  } catch (err) {
    logger.error("report-build-failed", { error: err.message });
  }

  write({
    type: "done",
    durationMs: Date.now() - startedAt,
    pagesScanned: pageResults.length,
    failures: failed,
    accessibilityScore: average(
      pageResults.map(({ accessibility: a }) => calculateScore(a.violations || [], a.passes || [], a.incomplete || []))
    ),
    performanceScore: average(pageResults.map((p) => p.performance?.score)),
  });
  logger.info("scan-finished", { urls, pages: pageResults.length, failures: failed.length, ms: Date.now() - startedAt });
}

module.exports = { streamScan, parseScanRequest, buildReport };
