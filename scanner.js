// Scanning core shared by the Express server (index.js) and the AWS Lambda
// handler (lambda.js): browser lifecycle, page auditing, crawling, and the
// progress events streamed to the frontend.
const fs = require("fs");
const { URL } = require("url");
const dns = require("dns").promises;
const net = require("net");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const axeSource = require("axe-core").source;
const { calculateScore } = require("./reportTemplate");
const { attachNetworkCapture } = require("./networkCapture");
const { customChecks, customRules, CUSTOM_RULE_IDS } = require("./customAxeRules");
const { KNOWN_NOISE_SELECTORS, isFontProbeSpan, isWordMeasureDiv } = require("./noiseFilters");
const { PERF_OBSERVER_SCRIPT, readPerformanceMetrics, scorePerformance } = require("./performance");
const logger = require("./logger");

const IS_LAMBDA = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

// Default depth for a crawl that doesn't specify maxPages.
const MAX_CRAWL_PAGES = parseInt(process.env.MAX_CRAWL_PAGES) || 20;
// Hard ceiling no request can exceed — the real cost/timeout guardrail.
const ABSOLUTE_MAX_PAGES = parseInt(process.env.ABSOLUTE_MAX_PAGES) || 50;
// Ordinary sites with constant background traffic (analytics, chat widgets)
// often never reach networkidle2 quickly; 30s keeps a ceiling without
// flagging normal sites as failures.
const PAGE_NAVIGATION_TIMEOUT_MS = parseInt(process.env.PAGE_NAVIGATION_TIMEOUT_MS) || 30000;
// Concurrent tabs during a crawl. Each is a renderer process, so this is a
// memory dial as much as a speed one.
const AUDIT_CONCURRENCY = parseInt(process.env.AUDIT_CONCURRENCY) || 4;
// How long to wait for a Cloudflare/WAF interstitial to clear by itself.
const BOT_CHALLENGE_TIMEOUT_MS = parseInt(process.env.BOT_CHALLENGE_TIMEOUT_MS) || 20000;
// Ceiling for the pre-scan auto-scroll.
const SCROLL_TIMEOUT_MS = parseInt(process.env.SCROLL_TIMEOUT_MS) || 15000;
// Pause after scrolling so lazy content and deferred scripts finish mounting.
const POST_SCROLL_SETTLE_MS = parseInt(process.env.POST_SCROLL_SETTLE_MS) || 7000;
// Max element screenshots per page. Every violation gets one first, then
// extras until this runs out.
const ELEMENT_SCREENSHOT_LIMIT = parseInt(process.env.ELEMENT_SCREENSHOT_LIMIT) || 30;
// Max nodes per violation sent to the frontend (the HTML report keeps all).
const CLIENT_NODES_PER_VIOLATION = 15;

const REALISTIC_USER_AGENT =
  process.env.SCAN_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const VIEWPORT = { width: 1280, height: 800 };

// ---------- Browser lifecycle ----------
// Chrome launches lazily and is reused while audits keep arriving. On a
// long-running server it's closed after an idle window; on Lambda the handler
// closes it at the end of each invocation (timers don't run while frozen).
const BROWSER_IDLE_TIMEOUT_MS = parseInt(process.env.BROWSER_IDLE_TIMEOUT_MS) || 60 * 1000;

let browser = null;
let browserLaunchPromise = null;
let browserIdleTimer = null;
let activeAudits = 0;

const COMMON_ARGS = [
  `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
  "--disable-dev-shm-usage",
  `--renderer-process-limit=${AUDIT_CONCURRENCY}`,
  "--disk-cache-size=0",
  "--media-cache-size=0",
  "--force-color-profile=srgb",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=AudioServiceOutOfProcess,TranslateUI,Translate",
  "--disable-notifications",
  "--hide-scrollbars",
  "--mute-audio",
  "--no-first-run",
  "--no-default-browser-check",
  "--log-level=3",
];

async function launchBrowser() {
  if (IS_LAMBDA) {
    // Installed only in the Lambda image (see Dockerfile.lambda).
    const chromium = require("@sparticuz/chromium");
    return puppeteer.launch({
      args: puppeteer.defaultArgs({ args: [...chromium.args, ...COMMON_ARGS], headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
      acceptInsecureCerts: true,
      ignoreDefaultArgs: ["--enable-automation"],
      defaultViewport: VIEWPORT,
    });
  }

  return puppeteer.launch({
    headless: true,
    executablePath: getChromeExecutablePath(),
    acceptInsecureCerts: true,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--headless=new",
      "--window-position=-32000,-32000",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--no-zygote",
      "--js-flags=--max-old-space-size=512",
      ...COMMON_ARGS,
    ],
  });
}

function getChromeExecutablePath() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((candidate) => Boolean(candidate) && fs.existsSync(candidate));
}

// Concurrent callers during a cold launch share one in-flight launch.
async function getBrowser() {
  if (browser?.connected) return browser;
  if (browserLaunchPromise) return browserLaunchPromise;
  browserLaunchPromise = launchBrowser()
    .then((b) => {
      browser = b;
      return b;
    })
    .finally(() => {
      browserLaunchPromise = null;
    });
  return browserLaunchPromise;
}

function acquireBrowserSlot() {
  activeAudits++;
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
}

function releaseBrowserSlot() {
  activeAudits = Math.max(0, activeAudits - 1);
  if (activeAudits > 0 || !browser || IS_LAMBDA) return;
  browserIdleTimer = setTimeout(() => {
    browserIdleTimer = null;
    if (activeAudits === 0) closeBrowser();
  }, BROWSER_IDLE_TIMEOUT_MS);
}

async function closeBrowser() {
  if (!browser) return;
  const toClose = browser;
  browser = null;
  try {
    await toClose.close();
    logger.info("browser-closed");
  } catch (err) {
    logger.warn("browser-close-failed", { error: err.message });
  }
}

// ---------- SSRF protection ----------
async function isUrlSafe(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;

  try {
    const addresses = await dns.lookup(parsed.hostname, { all: true });
    for (const { address } of addresses) {
      if (!net.isIP(address)) continue;
      if (
        address.startsWith("127.") ||
        address.startsWith("10.") ||
        address.startsWith("192.168.") ||
        address.startsWith("169.254.") ||
        address.startsWith("0.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
        address === "::1" ||
        /^f[cd]/i.test(address) ||
        /^fe80:/i.test(address)
      ) {
        return false;
      }
    }
  } catch {
    return false;
  }
  return true;
}

// ---------- URL helpers ----------
// Two-letter locale segment a path starts with (e.g. "/en/about" -> "en"), or null.
function getLocalePrefix(rawUrl) {
  try {
    const match = new URL(rawUrl).pathname.match(/^\/([a-z]{2})(\/|$)/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// True when the link is under a *different* locale than the site's own.
function isLocaleUrl(rawUrl, ownLocale) {
  const linkLocale = getLocalePrefix(rawUrl);
  return linkLocale !== null && linkLocale !== ownLocale;
}

function normalizePageUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    // "/index.html" and "/" are the same page.
    u.pathname = u.pathname.replace(/\/index\.(html?|php)$/i, "/");
    let str = u.toString();
    if (u.pathname.length > 1 && str.endsWith("/")) str = str.slice(0, -1);
    return str;
  } catch {
    return rawUrl;
  }
}

// ---------- Bot / WAF challenge detection ----------
const CHALLENGE_TEXT_PATTERNS = [
  /Just a moment/i,
  /Attention Required! \| Cloudflare/i,
  /Checking your browser before accessing/i,
  /Enable JavaScript and cookies to continue/i,
  /Verify you are human/i,
  /cdn-cgi\/challenge-platform/i,
];

async function readPageText(page) {
  try {
    const title = await page.title();
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || "");
    return `${title} ${body}`;
  } catch {
    return null; // mid-navigation, no usable DOM yet
  }
}

async function detectBotChallenge(page, response) {
  const headers = response.headers();
  const server = headers["server"] || "";
  const vendor = /cloudflare/i.test(server) ? "Cloudflare" : "the site's bot-protection service";

  if (headers["cf-mitigated"]) return { vendor, waitable: true };
  const text = (await readPageText(page)) || "";
  if (CHALLENGE_TEXT_PATTERNS.some((p) => p.test(text))) return { vendor, waitable: true };
  // A bare Cloudflare 403 with no challenge markers is a static WAF/IP block,
  // not a JS check that will clear by itself.
  if (response.status() === 403 && /cloudflare/i.test(server)) return { vendor, waitable: false };
  return null;
}

// Cloudflare's automatic JS check usually clears within a few seconds and
// then reloads the page. Polls manually (instead of waitForFunction) so that
// reload doesn't throw "execution context destroyed" and count as a failure.
async function waitForChallengeClear(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1000);
    const text = await readPageText(page);
    if (text !== null && !CHALLENGE_TEXT_PATTERNS.some((p) => p.test(text))) {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

// ---------- Pre-audit interaction ----------
// Optimizer plugins (WP Rocket "delay JS", Perfmatters, FlyingPress) hold
// scripts back until the first real input event — sometimes including
// accessibility widgets that fix real issues. CDP mouse input counts as
// trusted, so this unsticks them. Mouse-only on purpose: a real Tab press
// moves focus and can pop open floating widgets on every page.
async function triggerDeferredScriptLoad(page) {
  await page.mouse.move(40, 40);
  await page.mouse.move(160, 220);
  await page.mouse.wheel({ deltaY: 1 });
}

// Some sites only apply fixes once something in the footer receives focus.
async function focusFooterLandmark(page) {
  await page.evaluate(() => {
    const footer = document.querySelector("footer, [role='contentinfo']");
    if (!footer) return;
    const focusable = footer.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable && typeof focusable.focus === "function") focusable.focus();
  });
}

// Closes anything the steps above may have opened. No-op otherwise.
async function dismissAnyOpenOverlay(page) {
  await page.keyboard.press("Escape");
}

// Smooth-scrolls to the bottom so lazy content mounts, then back to top.
async function autoScrollToBottom(page, timeoutMs = SCROLL_TIMEOUT_MS) {
  await page.evaluate((maxDurationMs) => {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let lastHeight = document.body.scrollHeight;
      let stableRounds = 0;
      const timer = setInterval(() => {
        const timedOut = Date.now() - startedAt > maxDurationMs;
        window.scrollBy(0, 200);
        const currentHeight = document.body.scrollHeight;
        const reachedBottom = window.innerHeight + window.scrollY >= currentHeight - 2;
        if (currentHeight === lastHeight) stableRounds += 1;
        else {
          stableRounds = 0;
          lastHeight = currentHeight;
        }
        if ((reachedBottom && stableRounds >= 3) || timedOut) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
    });
  }, timeoutMs);
}

// ---------- Screenshots ----------
async function capturePageScreenshot(page) {
  try {
    const data = await page.screenshot({ type: "jpeg", quality: 60, encoding: "base64" });
    return `data:image/jpeg;base64,${data}`;
  } catch (err) {
    logger.warn("page-screenshot-failed", { error: err.message });
    return null;
  }
}

const IMPACT_RANK = { critical: 4, serious: 3, moderate: 2, minor: 1 };

// Screenshots offending elements, highlighted with a red outline and a bit
// of surrounding context. Pass 1 tries to get one image for *every*
// violation (walking its nodes until one is capturable); pass 2 adds a few
// extra examples per violation while the page budget lasts. Images are
// stored on node.screenshot; nodes that can't be shown (hidden, zero-size,
// inside an iframe/shadow DOM, in <head>) get node.screenshotSkipped.
const SHOT_PADDING = 24;
const SHOT_MAX_HEIGHT = 480;
const EXTRA_SHOTS_PER_VIOLATION = 2;
const ATTEMPTS_PER_VIOLATION = 6;

async function screenshotNode(page, node) {
  if (!Array.isArray(node.target) || node.target.length !== 1 || typeof node.target[0] !== "string") {
    node.screenshotSkipped = "nested";
    return false;
  }
  let handle = null;
  try {
    handle = await page.$(node.target[0]);
    if (!handle) return false;
    await handle.scrollIntoView().catch(() => {});
    const box = await handle.boundingBox();
    if (!box || box.width < 2 || box.height < 2) {
      node.screenshotSkipped = "not-visible";
      return false;
    }
    const [pageLeft, pageTop] = await page.evaluate(() => [window.visualViewport.pageLeft, window.visualViewport.pageTop]);
    const padX = Math.min(SHOT_PADDING, box.x + pageLeft);
    const padY = Math.min(SHOT_PADDING, box.y + pageTop);

    await handle.evaluate((el) => {
      el.__a11yPrev = [el.style.outline, el.style.outlineOffset, el.style.boxShadow];
      el.style.outline = "3px solid #e11d48";
      el.style.outlineOffset = "2px";
      el.style.boxShadow = "0 0 0 7px rgba(225,29,72,.25)";
    });
    // clip is relative to the element's own box here.
    const data = await handle.screenshot({
      type: "jpeg",
      quality: 60,
      encoding: "base64",
      scrollIntoView: false,
      clip: {
        x: -padX,
        y: -padY,
        width: Math.min(box.width + padX + SHOT_PADDING, VIEWPORT.width),
        height: Math.min(box.height + padY + SHOT_PADDING, SHOT_MAX_HEIGHT),
      },
    });
    node.screenshot = `data:image/jpeg;base64,${data}`;
    return true;
  } catch {
    node.screenshotSkipped = "not-visible";
    return false;
  } finally {
    if (handle) {
      await handle
        .evaluate((el) => {
          if (el.__a11yPrev) [el.style.outline, el.style.outlineOffset, el.style.boxShadow] = el.__a11yPrev;
        })
        .catch(() => {});
      await handle.dispose().catch(() => {});
    }
  }
}

async function captureViolationScreenshots(page, violations) {
  const ordered = [...violations].sort((a, b) => (IMPACT_RANK[b.impact] || 0) - (IMPACT_RANK[a.impact] || 0));
  let taken = 0;
  const firstShot = new Map();

  // Pass 1: one image per violation.
  for (const v of ordered) {
    if (taken >= ELEMENT_SCREENSHOT_LIMIT) break;
    for (let i = 0; i < Math.min(v.nodes.length, ATTEMPTS_PER_VIOLATION); i++) {
      if (await screenshotNode(page, v.nodes[i])) {
        firstShot.set(v, i);
        taken++;
        break;
      }
    }
  }

  // Pass 2: a couple more examples per violation.
  for (const v of ordered) {
    const start = firstShot.has(v) ? firstShot.get(v) + 1 : ATTEMPTS_PER_VIOLATION;
    let extras = 0;
    for (let i = start; i < Math.min(v.nodes.length, CLIENT_NODES_PER_VIOLATION); i++) {
      if (taken >= ELEMENT_SCREENSHOT_LIMIT || extras >= EXTRA_SHOTS_PER_VIOLATION) break;
      if (await screenshotNode(page, v.nodes[i])) {
        taken++;
        extras++;
      }
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

// ---------- Client-facing page summary ----------
const CUSTOM_RULE_ID_SET = new Set(CUSTOM_RULE_IDS);

function truncate(str, max) {
  if (!str) return str;
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// Slim version of a page result for the live frontend: violations with a
// capped node list, counts instead of full pass/incomplete lists.
function toClientPage(pageResult) {
  const a = pageResult.accessibility;
  const violations = a.violations || [];
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  let affectedElements = 0;
  for (const v of violations) {
    counts[v.impact || "minor"] = (counts[v.impact || "minor"] || 0) + 1;
    affectedElements += v.nodes.length;
  }

  return {
    url: pageResult.url,
    finalUrl: pageResult.finalUrl,
    title: pageResult.title || "",
    screenshot: pageResult.screenshot || null,
    score: calculateScore(violations, a.passes || [], a.incomplete || []),
    counts: {
      violations: violations.length,
      ...counts,
      affectedElements,
      passes: (a.passes || []).length,
      incomplete: (a.incomplete || []).length,
      inapplicable: (a.inapplicable || []).length,
    },
    violations: violations
      .map((v) => ({
        id: v.id,
        impact: v.impact || "minor",
        help: v.help,
        description: v.description,
        helpUrl: v.helpUrl,
        tags: v.tags,
        custom: CUSTOM_RULE_ID_SET.has(v.id),
        nodeCount: v.nodes.length,
        nodes: v.nodes.slice(0, CLIENT_NODES_PER_VIOLATION).map((n) => ({
          target: n.target,
          html: truncate(n.html, 600),
          failureSummary: n.failureSummary,
          screenshot: n.screenshot || null,
          screenshotSkipped: n.screenshotSkipped || null,
        })),
      }))
      .sort((x, y) => (IMPACT_RANK[y.impact] || 0) - (IMPACT_RANK[x.impact] || 0)),
    passes: (a.passes || []).map((p) => ({ id: p.id, help: p.help })),
    performance: pageResult.performance || null,
    network: pageResult.network?.summary || null,
  };
}

// ---------- Page auditor ----------
const SERIALIZED_CHECKS = customChecks.map((check) => ({ ...check, evaluate: check.evaluate.toString() }));

// Opens a page, captures screenshot + performance, runs axe + custom rules,
// and optionally collects same-origin links.
// Returns { pageResult, finalUrl, links } or { failed: true, reason, ... }.
async function auditPage(url, { collectLinks = false, emit = () => {} } = {}) {
  let page;
  let netCapture;
  const consoleLogs = [];
  const step = (stage, message) => emit({ type: "page-progress", url, stage, message });

  try {
    const activeBrowser = await getBrowser();
    page = await activeBrowser.newPage();
    await page.setUserAgent(REALISTIC_USER_AGENT);
    await page.setViewport(VIEWPORT);
    // Audit the default (light) look regardless of the host machine's theme.
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await page.evaluateOnNewDocument(PERF_OBSERVER_SCRIPT);

    netCapture = await attachNetworkCapture(page);
    page.on("console", (msg) => consoleLogs.push({ type: msg.type(), text: msg.text(), location: msg.location() }));
    page.on("pageerror", (err) => consoleLogs.push({ type: "pageerror", text: err.message, location: null }));

    step("loading", "Loading page");
    let response;
    try {
      response = await page.goto(url, { waitUntil: ["domcontentloaded", "networkidle2"], timeout: PAGE_NAVIGATION_TIMEOUT_MS });
    } catch (navError) {
      logger.warn("page-navigation-failed", { url, error: navError.message });
      return { failed: true, reason: "navigation-error", detail: navError.message, url };
    }

    let finalUrl = page.url();
    if (!response || finalUrl === "about:blank") return { failed: true, reason: "no-response", url };

    const challenge = await detectBotChallenge(page, response);
    if (challenge) {
      emit({ type: "challenge", url, vendor: challenge.vendor, state: "waiting" });
      const cleared = challenge.waitable && (await waitForChallengeClear(page, BOT_CHALLENGE_TIMEOUT_MS));
      if (!cleared) {
        emit({ type: "challenge", url, vendor: challenge.vendor, state: "blocked" });
        logger.warn("bot-challenge-blocked", { url, vendor: challenge.vendor, status: response.status() });
        return { failed: true, reason: "bot-challenge", vendor: challenge.vendor, status: response.status(), url };
      }
      emit({ type: "challenge", url, vendor: challenge.vendor, state: "cleared" });
      finalUrl = page.url();
    } else if (!response.ok() && response.status() >= 400) {
      return { failed: true, reason: "http-error", status: response.status(), url };
    }

    // Measured before any scrolling/interaction so CLS/LCP reflect a normal first view.
    step("performance", "Measuring performance");
    const rawPerf = await readPerformanceMetrics(page).catch(() => null);
    const screenshot = await capturePageScreenshot(page);
    const title = await page.title().catch(() => "");
    emit({ type: "page-preview", url, finalUrl, title, screenshot });

    step("interacting", "Scrolling and loading lazy content");
    for (const [name, fn] of [
      ["interaction-trigger", () => triggerDeferredScriptLoad(page)],
      ["autoscroll", () => autoScrollToBottom(page)],
      ["footer-focus", () => focusFooterLandmark(page)],
      ["dismiss-overlay", () => dismissAnyOpenOverlay(page)],
    ]) {
      try {
        await fn();
      } catch (err) {
        logger.warn(`page-${name}-failed`, { url, error: err.message }); // non-fatal
      }
    }
    await sleep(POST_SCROLL_SETTLE_MS);

    step("auditing", "Running accessibility checks");
    await page.evaluate(axeSource);
    await page.evaluate(
      (checks, rules) => {
        const reconstructed = checks.map((check) => ({
          ...check,
          // eslint-disable-next-line no-new-func
          evaluate: new Function("return (" + check.evaluate + ").apply(this, arguments);"),
        }));
        axe.configure({ checks: reconstructed, rules });
      },
      SERIALIZED_CHECKS,
      customRules
    );
    await page.evaluate(
      (selectors, isFontProbeSpanSrc, isWordMeasureDivSrc) => {
        selectors.forEach((sel) => document.querySelectorAll(sel).forEach((el) => el.remove()));
        // eslint-disable-next-line no-new-func
        const isFontProbe = new Function("return (" + isFontProbeSpanSrc + ")")();
        // eslint-disable-next-line no-new-func
        const isWordMeasure = new Function("return (" + isWordMeasureDivSrc + ")")();
        document.querySelectorAll("body > span").forEach((el) => isFontProbe(el, document.body) && el.remove());
        document.querySelectorAll("body > div").forEach((el) => isWordMeasure(el, document.body) && el.remove());
      },
      KNOWN_NOISE_SELECTORS,
      isFontProbeSpan.toString(),
      isWordMeasureDiv.toString()
    );
    const results = await page.evaluate(async () => axe.run());

    step("screenshots", "Capturing problem elements");
    await captureViolationScreenshots(page, results.violations);

    const networkRecords = netCapture.getRecords();
    const networkSummary = netCapture.getSummary(networkRecords);

    let links = [];
    if (collectLinks) {
      // Post-redirect origin so http→https redirects don't drop links.
      const actualOrigin = new URL(finalUrl).origin;
      links = await page.evaluate((origin) => {
        const hrefs = new Set();
        document.querySelectorAll("a[href]").forEach((a) => {
          try {
            const u = new URL(a.href);
            if (u.origin === origin) {
              u.hash = "";
              hrefs.add(u.toString());
            }
          } catch {}
        });
        document.querySelectorAll("form[action]").forEach((f) => {
          if (!f.method || f.method.toLowerCase() === "get") {
            try {
              const u = new URL(f.action);
              if (u.origin === origin) hrefs.add(u.toString());
            } catch {}
          }
        });
        return Array.from(hrefs);
      }, actualOrigin);
    }

    return {
      pageResult: {
        url,
        finalUrl,
        title,
        screenshot,
        performance: scorePerformance(rawPerf, networkSummary),
        accessibility: results,
        network: { summary: networkSummary, requests: networkRecords },
        console: consoleLogs,
      },
      finalUrl,
      links,
    };
  } catch (pageError) {
    logger.warn("page-audit-failed", { url, error: pageError.message });
    return { failed: true, reason: "unknown", detail: pageError.message, url };
  } finally {
    // The tab may already be gone — never let cleanup mask the real result.
    if (netCapture) await netCapture.detach().catch(() => {});
    if (page) await page.close().catch(() => {});
  }
}

// Runs fn over items with at most `concurrency` in flight, preserving order.
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    for (let i = nextIndex++; i < items.length; i = nextIndex++) {
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ---------- Scan orchestration ----------
// urls: one or more. Multiple URLs → each audited directly (no crawl).
// One URL + crawl → homepage first (to collect links), then subpages.
// emit(event) receives progress events for streaming to the frontend.
// Returns { pageResults, failures } — full results, for the HTML report.
async function runScan({ urls, crawl = false, maxPages = MAX_CRAWL_PAGES, emit = () => {} }) {
  const multiMode = urls.length > 1;
  const shouldCrawl = !multiMode && crawl;
  const pageLimit = Math.min(Math.max(parseInt(maxPages) || MAX_CRAWL_PAGES, 1), ABSOLUTE_MAX_PAGES);

  const pageResults = [];
  const failures = [];
  let completed = 0;
  let total = shouldCrawl ? 1 : urls.length;

  const runOne = async (url, collectLinks = false) => {
    emit({ type: "page-start", url, total });
    const result = await auditPage(url, { collectLinks, emit });
    completed++;
    if (!result || result.failed) {
      const failure = result || { failed: true, reason: "unknown", url };
      failures.push(failure);
      emit({
        type: "page-failed",
        url,
        reason: failure.reason,
        status: failure.status,
        vendor: failure.vendor,
        detail: failure.detail,
        completed,
        total,
      });
      return null;
    }
    pageResults.push(result.pageResult);
    emit({ type: "page-complete", page: toClientPage(result.pageResult), completed, total });
    return result;
  };

  acquireBrowserSlot();
  try {
    emit({ type: "status", stage: "launching", message: "Starting a browser" });
    await getBrowser();

    if (!shouldCrawl) {
      emit({ type: "plan", urls, total });
      await mapWithConcurrency(urls, AUDIT_CONCURRENCY, (url) => runOne(url));
    } else {
      const url = urls[0];
      emit({ type: "plan", urls: [url], total });
      const home = await runOne(url, true);
      if (home) {
        const ownLocale = getLocalePrefix(url);
        const visited = new Set([normalizePageUrl(url), normalizePageUrl(home.finalUrl)]);
        const subpageUrls = [];
        for (const link of home.links) {
          if (subpageUrls.length >= pageLimit - 1) break;
          if (isLocaleUrl(link, ownLocale)) continue;
          if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|mp4|mp3)(\?|$)/i.test(link)) continue;
          const norm = normalizePageUrl(link);
          if (visited.has(norm)) continue;
          visited.add(norm);
          subpageUrls.push(link);
        }
        total = 1 + subpageUrls.length;
        emit({ type: "plan", urls: [url, ...subpageUrls], total });
        await mapWithConcurrency(subpageUrls, AUDIT_CONCURRENCY, (subUrl) => runOne(subUrl));
      }
    }
  } finally {
    releaseBrowserSlot();
  }

  return { pageResults, failures };
}

function failureDetails(failures) {
  return failures.map(({ url, reason, status, vendor, detail }) => ({ url, reason, status, vendor, detail }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  IS_LAMBDA,
  MAX_CRAWL_PAGES,
  ABSOLUTE_MAX_PAGES,
  LOW_PAGE_YIELD_THRESHOLD: parseInt(process.env.LOW_PAGE_YIELD_THRESHOLD) || 5,
  isUrlSafe,
  runScan,
  closeBrowser,
  failureDetails,
  toClientPage,
};
