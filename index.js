require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const dns = require("dns").promises;
const net = require("net");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const axeSource = require("axe-core").source;
const { buildHtmlReport } = require("./reportTemplate");
const { attachNetworkCapture } = require("./networkCapture");
const { customChecks, customRules, CUSTOM_RULE_IDS } = require("./customAxeRules");
const { renderHomePage } = require("./views/home");
const logger = require("./logger");
const { flagIncident } = require("./alerts");

const app = express();
const PORT = process.env.PORT || 3000;
const REPORTS_DIR = path.join(__dirname, "reports");
// Default depth for a crawl that doesn't specify ?maxPages. Callers can
// still ask for more per-request (up to ABSOLUTE_MAX_PAGES below).
const MAX_CRAWL_PAGES = parseInt(process.env.MAX_CRAWL_PAGES) || 20;
// Hard ceiling no request can exceed regardless of ?maxPages — the actual
// cost/timeout guardrail, independent of the default above.
const ABSOLUTE_MAX_PAGES = parseInt(process.env.ABSOLUTE_MAX_PAGES) || 50;
// Below this, a crawl that was allowed to go deeper (maxPages was higher
// than what it actually found) probably hit a link-discovery problem
// rather than genuinely being a 1-4 page site — worth a human checking.
const LOW_PAGE_YIELD_THRESHOLD = parseInt(process.env.LOW_PAGE_YIELD_THRESHOLD) || 5;
// A handful of slow-loading pages at the old 60s cap could blow a 20-page
// crawl's whole budget on their own (3-4 min target) — but pages are now
// audited concurrently (AUDIT_CONCURRENCY), so one slow page only occupies
// one worker slot instead of serializing the whole crawl. 10s proved too
// aggressive in practice: ordinary sites with continuous background traffic
// (analytics, chat widgets, ads) often never reach networkidle2 that fast
// and were failing outright. 30s keeps a real ceiling without flagging
// normal sites as failures.
const PAGE_NAVIGATION_TIMEOUT_MS = parseInt(process.env.PAGE_NAVIGATION_TIMEOUT_MS) || 30000;
// How many subpages to audit at once during a crawl. Each concurrent page
// is a separate Chrome renderer process/tab, so this is a memory dial as
// much as a speed one — every extra slot multiplies against the Lambda's
// allocated memory (2GB planned in PLAN.md), not just wall-clock time.
// Keep this conservative and confirm headroom via CloudWatch max-memory-used
// before raising it; it's an env var specifically so it can be tuned without
// a redeploy once real page-weight data is in.
const AUDIT_CONCURRENCY = parseInt(process.env.AUDIT_CONCURRENCY) || 4;
// How long to wait for a Cloudflare/WAF interstitial to clear client-side
// before giving up on a page.
const BOT_CHALLENGE_TIMEOUT_MS = parseInt(process.env.BOT_CHALLENGE_TIMEOUT_MS) || 8000;
// Ceiling for the pre-scan auto-scroll (see autoScrollToBottom below). Caps
// the worst case on very long/infinite-scroll pages so one page can't stall
// the whole crawl.
const SCROLL_TIMEOUT_MS = parseInt(process.env.SCROLL_TIMEOUT_MS) || 15000;
// After the pre-scan scroll settles, how long to just sit on the page before
// running axe — gives deferred scripts, animations, and anything the scroll
// triggered (lazy images, intersection-observer content) a moment to finish
// mounting instead of racing the audit against it.
const POST_SCROLL_SETTLE_MS = parseInt(process.env.POST_SCROLL_SETTLE_MS) || 7000;
// Elements known to be plugin-internal scratch DOM rather than real page
// content — removed outright right before axe runs (NOT via axe's
// context.exclude: that option has a bug/edge-case in axe-core 4.12 where
// excluding elements makes the `region` rule flag <html> itself as
// "content not contained by a landmark", which is worse than the problem
// being solved). `sr7-fonttest-wrap` is Slider Revolution's own
// font-load-detection scratch element (plugins/revslider/public/js/libs/
// tptools.js, `_tpt.fontTester`) — it briefly holds throwaway <span>s in
// different font-family fallbacks (serif/sans-serif/monospace/etc.) to
// measure whether a custom font has finished loading. The plugin's own
// author marks it aria-hidden="true", confirming it's not meant to be
// perceivable content — but a scan that catches it mid-measurement, before
// axe would otherwise skip an aria-hidden subtree, still sees it as bare
// unlandmarked spans. Kept as an allowlist so more known-noisy patterns
// from other plugins can be added here as they're identified.
const KNOWN_NOISE_SELECTORS = ["sr7-fonttest-wrap"];

// A second, more common variant of the same font-metrics-probing technique:
// caught live (via instrumented appendChild/insertBefore/insertAdjacentHTML)
// coming from HubSpot's "Web Interactives" embed
// (js.hubspot.com/web-interactives-embed.js, Ut.render()) — it calls
// insertAdjacentHTML directly on <body>, injecting ~6 bare <span>s (one per
// font-family fallback: none/serif/sans-serif/monospace/system-ui, plus a
// font-size:1px variant) as DIRECT CHILDREN OF <body>, with no wrapper and
// no aria-hidden at all, unlike Slider Revolution's version. Matched by
// shape rather than exact text, since the test string is specific to this
// one script but the pattern is generic to font-loading probes broadly —
// this predicate would also catch a differently-worded probe from some
// other vendor's script using the identical technique.
//
// Deliberately requires a bare generic font-family keyword, a 1px
// font-size, or the exact known probe text — NOT just "direct child of
// body + white-space:nowrap" alone. An earlier version also treated ANY
// plain no-font-family/no-distinguishing-style span as a probe (reasoning
// that a bare <span> directly under <body> is already an unusual shape for
// real content), but a synthetic test proved that too loose: a legitimate
// price/badge span some other widget appends straight to <body> — a real
// WCAG issue worth reporting — matches that same bare shape and would have
// been silently deleted before axe ever saw it. The exact-text check below
// is what makes it safe to also catch this script's specific no-font-family
// variant without that risk: no real page renders "mmMwWLliI0fiflO" as
// visible text, so matching on it can't accidentally delete real content
// the way the shape-only check could.
//
// Takes bodyEl explicitly (rather than closing over a bare `document`) so
// this same function works unmodified when reused against an iframe's
// window/document in the manual-scan bundle below, not just the top page.
function isFontProbeSpan(el, bodyEl) {
  if (!el || el.tagName !== "SPAN" || el.parentElement !== bodyEl) return false;
  const style = el.getAttribute("style") || "";
  if (!/white-space:\s*nowrap\s*;/i.test(style)) return false;
  if (/font-family:\s*(serif|sans-serif|monospace|system-ui)\s*;/i.test(style)) return true;
  if (/font-size:\s*1px\s*;/i.test(style)) return true;
  return (el.textContent || "").trim().startsWith("mmMwWLliI0fiflO");
}

// A third scratch-DOM pattern, from a different HubSpot script this time:
// caught live as a <div> appended directly to <body> by
// js.hs-analytics.net's tracking bundle, containing nothing but the literal
// word "word" repeated ~200 times (no inline style at all — it's not even
// hidden, just an ephemeral benchmark element HubSpot Analytics apparently
// uses to measure text-wrapping/line metrics, e.g. for reading-time or
// scroll-depth tracking). Matched purely on content shape: a <div> whose
// entire trimmed text is only the token "word" repeated is not something
// any real page would ever render, so this is safe with no structural
// requirement beyond being a direct child of <body> (mirroring the other
// two patterns) to keep the check cheap.
function isWordMeasureDiv(el, bodyEl) {
  if (!el || el.tagName !== "DIV" || el.parentElement !== bodyEl) return false;
  return /^(\s*word\s*)+$/i.test(el.textContent || "");
}

// The public URL this server is reachable at — needed so the manual-scan
// bundle (loaded from an arbitrary third-party site) knows where to fetch
// axe-core from and where to POST results back to. Behind a reverse proxy
// or CDN, req.protocol/req.get("host") can be wrong unless this is set
// explicitly (e.g. PUBLIC_BASE_URL=https://checker.example.com).
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "") || null;

// Trust X-Forwarded-* headers from a reverse proxy/load balancer so
// req.protocol reflects the real public scheme (https) instead of the
// scheme the app is actually listening on (usually plain http internally).
app.set("trust proxy", true);

// ---------- Browser lifecycle ----------
// Chrome is launched lazily on the first audit request and reused for as
// long as audits keep arriving. Once nothing is in flight, it's closed
// after a short idle window so the process doesn't sit there holding
// memory between scans — the launch cost (~1-2s) is paid again on the
// next request instead.
const BROWSER_IDLE_TIMEOUT_MS = parseInt(process.env.BROWSER_IDLE_TIMEOUT_MS) || 60 * 1000;

let browser = null;
let browserLaunchPromise = null;
let browserIdleTimer = null;
let activeAudits = 0;

async function launchBrowser() {
  const chromeExecutablePath = getChromeExecutablePath();
  return puppeteer.launch({
    headless: true,
    executablePath: chromeExecutablePath,
    ignoreHTTPSErrors: true,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--headless=new",
      "--window-position=-32000,-32000",
      "--window-size=1280,800",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--no-zygote",
      // Was pinned to 1 (all tabs sharing a single renderer process), which
      // silently serialized page loads no matter how many concurrent
      // auditPage() calls were in flight. Capped to AUDIT_CONCURRENCY
      // instead of left uncapped, so Chrome itself can't spawn more
      // renderer processes than our own concurrency pool allows — the pool
      // is the primary control, this is a backstop.
      `--renderer-process-limit=${AUDIT_CONCURRENCY}`,
      "--js-flags=--max-old-space-size=512",
      "--disk-cache-size=0",
      "--media-cache-size=0",
      "--force-color-profile=srgb",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-breakpad",
      "--disable-client-side-phishing-detection",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-domain-reliability",
      "--disable-extensions",
      "--disable-features=AudioServiceOutOfProcess,TranslateUI,Translate",
      "--disable-hang-monitor",
      "--disable-ipc-flooding-protection",
      "--disable-notifications",
      "--disable-popup-blocking",
      "--disable-print-preview",
      "--disable-renderer-backgrounding",
      "--disable-speech-api",
      "--disable-sync",
      "--disable-translate",
      "--hide-scrollbars",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-default-browser-check",
      "--no-first-run",
      "--no-pings",
      "--password-store=basic",
      "--use-mock-keychain",
      "--safebrowsing-disable-auto-update",
      "--log-level=3",
    ],
  });
}

// Returns the shared browser instance, launching it on first use.
// Concurrent callers during a cold launch all await the same in-flight
// promise instead of racing to launch multiple Chrome processes.
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

// Call around any block of work that needs the browser. Cancels any
// pending idle-shutdown while work is in flight, and schedules one once
// the last piece of work finishes.
function acquireBrowserSlot() {
  activeAudits++;
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
}

function releaseBrowserSlot() {
  activeAudits = Math.max(0, activeAudits - 1);
  if (activeAudits > 0 || !browser) return;

  browserIdleTimer = setTimeout(async () => {
    browserIdleTimer = null;
    if (activeAudits > 0 || !browser) return;
    const toClose = browser;
    browser = null;
    try {
      await toClose.close();
      logger.info("browser-closed-idle");
    } catch (err) {
      logger.warn("browser-close-failed", { error: err.message });
    }
  }, BROWSER_IDLE_TIMEOUT_MS);
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

// Wraps text in an OSC 8 escape sequence so terminals that support it (iTerm2,
// VS Code, Terminal.app, etc.) render it as a clickable hyperlink.
function terminalLink(text, url) {
  return `]8;;${url}\\${text}]8;;\\`;
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
    const { address } = await dns.lookup(parsed.hostname);
    if (
      net.isIP(address) &&
      (address.startsWith("127.") ||
        address.startsWith("10.") ||
        address.startsWith("192.168.") ||
        address.startsWith("169.254.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
        address === "::1")
    ) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

// ---------- URL normalisation ----------
// Returns the two-letter locale segment a path starts with (e.g. "/en/about" -> "en"), or null.
function getLocalePrefix(rawUrl) {
  try {
    const { pathname } = new URL(rawUrl);
    const match = pathname.match(/^\/([a-z]{2})(\/|$)/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// True when the link is under a *different* locale than the site's own (ownLocale),
// so we don't crawl e.g. /fr/... while scanning a site entered via /en/...
function isLocaleUrl(rawUrl, ownLocale) {
  const linkLocale = getLocalePrefix(rawUrl);
  return linkLocale !== null && linkLocale !== ownLocale;
}

function normalizePageUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    let str = u.toString();
    if (u.pathname.length > 1 && str.endsWith("/")) str = str.slice(0, -1);
    return str;
  } catch {
    return rawUrl;
  }
}

// ---------- Startup cleanup ----------
// Every report deletes itself right after being downloaded, so anything
// still sitting in reports/ at boot was never downloaded (or is left over
// from before that behavior existed) — there's nothing worth keeping.
// Clear it on every startup, not just once.
function clearReportsOnBoot() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  for (const file of fs.readdirSync(REPORTS_DIR)) {
    fs.unlinkSync(path.join(REPORTS_DIR, file));
  }
}

// ---------- Cleanup job ----------
function cleanupOldReports() {
  if (!fs.existsSync(REPORTS_DIR)) return;

  // A report deletes itself as soon as it's downloaded; this only catches
  // ones that never get downloaded at all.
  const maxAgeMs = 10 * 60 * 1000;
  const now = Date.now();

  for (const file of fs.readdirSync(REPORTS_DIR)) {
    const filePath = path.join(REPORTS_DIR, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > maxAgeMs) {
      fs.unlinkSync(filePath);
    }
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

// ---------- Bot / WAF challenge detection ----------
// Some sites (Cloudflare, Akamai, etc.) show an interstitial JS/CAPTCHA
// challenge to visitors that look automated instead of the real page.
// Overridable so a UA fingerprint that starts getting bot-blocked can be
// swapped out without a redeploy.
const REALISTIC_USER_AGENT =
  process.env.SCAN_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const CHALLENGE_TEXT_PATTERNS = [
  /Just a moment/i,
  /Attention Required! \| Cloudflare/i,
  /Checking your browser before accessing/i,
  /Enable JavaScript and cookies to continue/i,
  /Verify you are human/i,
  /cdn-cgi\/challenge-platform/i,
];

async function detectBotChallenge(page, response) {
  const headers = response.headers();
  const server = headers["server"] || "";
  const vendor = /cloudflare/i.test(server) ? "Cloudflare" : "the site's bot-protection service";

  if (headers["cf-mitigated"]) return { vendor, waitable: true };

  let text = "";
  try {
    const title = await page.title();
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || "");
    text = `${title} ${bodySnippet}`;
  } catch {
    // page may not have a usable DOM yet; fall through to status check below
  }

  if (CHALLENGE_TEXT_PATTERNS.some((p) => p.test(text))) return { vendor, waitable: true };
  // A bare 403 from a Cloudflare-fronted origin with none of the interactive
  // challenge markers above (e.g. a plain "403 Forbidden / nginx" error page)
  // is typically a static WAF/IP block rather than a solvable JS challenge —
  // waitForChallengeClear's "no challenge text present" check would pass on
  // it instantly (since it never had challenge text to begin with), so mark
  // it non-waitable rather than let that false positive through.
  if (response.status() === 403 && /cloudflare/i.test(server)) return { vendor, waitable: false };

  return null;
}

// Cloudflare's JS/managed challenge typically clears itself client-side
// within a few seconds once the browser's fingerprint passes inspection.
async function waitForChallengeClear(page, timeoutMs = BOT_CHALLENGE_TIMEOUT_MS) {
  try {
    await page.waitForFunction(
      (patterns) => {
        const text = document.title + " " + (document.body?.innerText?.slice(0, 500) || "");
        return !patterns.some((p) => new RegExp(p, "i").test(text));
      },
      { timeout: timeoutMs, polling: 500 },
      CHALLENGE_TEXT_PATTERNS.map((p) => p.source)
    );
    return true;
  } catch {
    return false;
  }
}

// Optimizer plugins (WP Rocket's "Delay JavaScript execution", Perfmatters,
// FlyingPress, etc. — all common on WordPress) hold back <script> tags until
// the visitor's first real interaction with the page (mousemove, wheel,
// click, touch, ...) instead of loading them on navigation. On some sites
// that includes accessibility widgets which patch up real issues at
// runtime — e.g. adding "(opens in a new tab)" labels to target=_blank
// links. Our own page.evaluate-driven scrolling doesn't count: it never
// fires a browser input event, trusted or not, so those scripts never load
// during an automated scan and their fixes never apply, producing false
// positives for issues the site has actually already fixed. Puppeteer's
// mouse APIs go through the CDP input pipeline, which does produce trusted
// events indistinguishable from a real user, so a touch here is enough to
// unstick any such delayed script before axe evaluates the page.
//
// Deliberately mouse-only, no keyboard: a real (CDP-trusted) Tab keypress
// actually moves browser focus, and on a site whose first tab stop is a
// floating widget toggle (chat bubble, accessibility panel, cookie banner)
// that opens on focus, one Tab press was enough to pop that widget open on
// every single page of a crawl — producing a wave of "content not in a
// landmark" / "dialog missing aria-modal" violations for a panel that isn't
// normally open at all. Mouse movement and a wheel tick satisfy the same
// delay-JS listeners without touching focus or clicking anything.
async function triggerDeferredScriptLoad(page) {
  await page.mouse.move(40, 40);
  await page.mouse.move(160, 220);
  await page.mouse.wheel({ deltaY: 1 });
}

// Some sites only apply certain fixes — e.g. an accessibility widget adding
// missing "(opens in a new tab)" labels — once a landmark like the footer
// actually receives focus, rather than baking them into the initial HTML.
// Focusing a real focusable element inside the footer fires a genuine
// focus/focusin event so that kind of lazy, interaction-triggered fix gets
// a chance to run before axe evaluates the DOM. No-op (and harmless) on
// sites with no such listener. Scoped to an actual link/button/input inside
// <footer> (never the footer element itself, and never anything outside
// it) so this can't accidentally focus a page-wide widget toggle the way a
// blind Tab press can.
async function focusFooterLandmark(page) {
  await page.evaluate(() => {
    const footer = document.querySelector("footer, [role='contentinfo']");
    if (!footer) return;
    const focusable = footer.querySelector(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable && typeof focusable.focus === "function") focusable.focus();
  });
}

// Defensive cleanup for the interaction steps above: if hovering/focusing
// happened to pop open a dialog/menu anyway (a hover-triggered dropdown, a
// widget that opens itself on any page activity), Escape is the standard
// way to dismiss it. A no-op if nothing is open, so this is safe to run
// unconditionally before every audit.
async function dismissAnyOpenOverlay(page) {
  await page.keyboard.press("Escape");
}

// Scrolls the page to the bottom in small smooth steps (rather than jumping
// straight there) so lazy-loaded images/sections and infinite-scroll content
// get a chance to mount before axe runs against the DOM — otherwise those
// elements just don't exist yet and their a11y issues go undetected. Scrolls
// back to the top afterwards so the audit starts from the page's normal
// resting scroll position. Best-effort: any failure here shouldn't fail the
// whole audit, so callers should swallow errors from this.
async function autoScrollToBottom(page, timeoutMs = SCROLL_TIMEOUT_MS) {
  await page.evaluate((maxDurationMs) => {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const stepPx = 200;
      const stepDelayMs = 100;
      let lastHeight = document.body.scrollHeight;
      let stableRounds = 0;

      const timer = setInterval(() => {
        const timedOut = Date.now() - startedAt > maxDurationMs;
        window.scrollBy(0, stepPx);

        const currentHeight = document.body.scrollHeight;
        const reachedBottom = window.innerHeight + window.scrollY >= currentHeight - 2;

        if (currentHeight === lastHeight) {
          stableRounds += 1;
        } else {
          stableRounds = 0;
          lastHeight = currentHeight;
        }

        // Stop once we've hit the bottom and the page height has settled
        // (no more lazy content growing it), or once the timeout guard trips.
        if ((reachedBottom && stableRounds >= 3) || timedOut) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, stepDelayMs);
    });
  }, timeoutMs);
}

// ---------- Page auditor ----------
// Opens a page, runs axe + custom rules, optionally collects same-origin links.
// Returns { pageResult, finalUrl, links } on success, or
// { failed: true, reason, ... } on failure.
async function auditPage(url, serializedChecks, collectLinks = false) {
  let page;
  let netCapture;
  const consoleLogs = [];

  try {
    const activeBrowser = await getBrowser();
    page = await activeBrowser.newPage();
    await page.setUserAgent(REALISTIC_USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });

    netCapture = await attachNetworkCapture(page);

    page.on("console", (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text(), location: msg.location() });
    });
    page.on("pageerror", (err) => {
      consoleLogs.push({ type: "pageerror", text: err.message, location: null });
    });

    let response;
    try {
      response = await page.goto(url, {
        waitUntil: ["domcontentloaded", "networkidle2"],
        timeout: PAGE_NAVIGATION_TIMEOUT_MS,
      });
    } catch (navError) {
      logger.warn("page-navigation-failed", { url, error: navError.message });
      return { failed: true, reason: "navigation-error", detail: navError.message, url };
    }

    let finalUrl = page.url();
    if (!response || finalUrl === "about:blank") {
      return { failed: true, reason: "no-response", url };
    }

    const challenge = await detectBotChallenge(page, response);
    if (challenge) {
      const cleared = challenge.waitable && (await waitForChallengeClear(page, BOT_CHALLENGE_TIMEOUT_MS));
      if (!cleared) {
        logger.warn("bot-challenge-blocked", { url, vendor: challenge.vendor, status: response.status() });
        return { failed: true, reason: "bot-challenge", vendor: challenge.vendor, status: response.status(), url };
      }
      // Challenge cleared client-side; re-read the now-real page state.
      finalUrl = page.url();
    } else if (!response.ok() && response.status() >= 400) {
      return { failed: true, reason: "http-error", status: response.status(), url };
    }

    try {
      await triggerDeferredScriptLoad(page);
    } catch (interactionError) {
      // Non-fatal: worst case a delay-JS plugin's scripts stay unloaded.
      logger.warn("page-interaction-trigger-failed", { url, error: interactionError.message });
    }

    try {
      await autoScrollToBottom(page);
    } catch (scrollError) {
      // Non-fatal: worst case is lazy content stays unloaded for this page.
      logger.warn("page-autoscroll-failed", { url, error: scrollError.message });
    }

    try {
      await focusFooterLandmark(page);
    } catch (focusError) {
      // Non-fatal: worst case a footer-focus-triggered fix stays unapplied.
      logger.warn("page-footer-focus-failed", { url, error: focusError.message });
    }

    try {
      await dismissAnyOpenOverlay(page);
    } catch (dismissError) {
      // Non-fatal: worst case a stray overlay stays open for this page.
      logger.warn("page-dismiss-overlay-failed", { url, error: dismissError.message });
    }

    // Let the page sit for a few seconds post-scroll before auditing — gives
    // anything the scroll/interaction triggered (lazy images, animations,
    // deferred scripts) time to actually finish mounting.
    await new Promise((resolve) => setTimeout(resolve, POST_SCROLL_SETTLE_MS));

    await page.evaluate(axeSource);

    await page.evaluate(
      (checks, rules) => {
        const reconstructedChecks = checks.map((check) => ({
          ...check,
          // eslint-disable-next-line no-new-func
          evaluate: new Function("return (" + check.evaluate + ").apply(this, arguments);"),
        }));
        axe.configure({ checks: reconstructedChecks, rules });
      },
      serializedChecks,
      customRules
    );

    await page.evaluate(
      (selectors, isFontProbeSpanSrc, isWordMeasureDivSrc) => {
        selectors.forEach((sel) => document.querySelectorAll(sel).forEach((el) => el.remove()));
        // eslint-disable-next-line no-new-func
        const isFontProbeSpan = new Function("return (" + isFontProbeSpanSrc + ")")();
        // eslint-disable-next-line no-new-func
        const isWordMeasureDiv = new Function("return (" + isWordMeasureDivSrc + ")")();
        document.querySelectorAll("body > span").forEach((el) => {
          if (isFontProbeSpan(el, document.body)) el.remove();
        });
        document.querySelectorAll("body > div").forEach((el) => {
          if (isWordMeasureDiv(el, document.body)) el.remove();
        });
      },
      KNOWN_NOISE_SELECTORS,
      isFontProbeSpan.toString(),
      isWordMeasureDiv.toString()
    );

    const results = await page.evaluate(async () => axe.run());
    const networkRecords = netCapture.getRecords();
    const networkSummary = netCapture.getSummary(networkRecords);

    let links = [];
    if (collectLinks) {
      // Use the actual post-redirect origin so http→https redirects don't drop links.
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
    // The page/target may already be gone (crashed tab, closed window) —
    // never let cleanup itself mask the real result or crash the request.
    if (netCapture) {
      try {
        await netCapture.detach();
      } catch (err) {
        logger.warn("network-capture-detach-failed", { url, error: err.message });
      }
    }
    if (page) {
      try {
        await page.close();
      } catch (err) {
        logger.warn("page-close-failed", { url, error: err.message });
      }
    }
  }
}

// Runs `fn` over `items` with at most `concurrency` in flight at once,
// preserving input order in the returned array. Used instead of
// Promise.all(items.map(fn)) specifically to keep memory bounded — firing
// every page open at once would let page count (up to 50, via ?maxPages)
// dictate how many Chrome renderer processes exist at once, which is what
// this function exists to prevent.
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

// ---------- Routes ----------
app.get("/", (req, res) => {
  res.type("html").send(renderHomePage());
});

// Accepts one or more URLs via repeated query params: ?url=url1&url=url2
// Multiple URLs → audit each directly, no subpage crawling, single combined report.
// Single URL  → ?crawl=true crawls subpages up to maxPages, ?crawl=false audits just that page.
//               (crawl defaults to true when omitted, for backwards compatibility.)
app.get("/audit", async (req, res) => {
  const rawUrl = req.query.url;
  const maxPages = Math.min(Math.max(parseInt(req.query.maxPages) || MAX_CRAWL_PAGES, 1), ABSOLUTE_MAX_PAGES);

  if (!rawUrl) {
    return res.status(400).json({ success: false, message: "Please provide a URL" });
  }

  const urls = Array.isArray(rawUrl) ? rawUrl : [rawUrl];

  logger.info("audit-request-received", { urlCount: urls.length, urls });

  const multiMode = urls.length > 1;
  const crawlParam = req.query.crawl;
  const shouldCrawl = multiMode
    ? false
    : crawlParam === undefined
    ? true
    : ["true", "1", "on"].includes(String(crawlParam).toLowerCase());

  for (const u of urls) {
    if (!(await isUrlSafe(u))) {
      return res.status(400).json({ success: false, message: `Invalid or unsafe URL: ${u}` });
    }
  }

  const serializedChecks = customChecks.map((check) => ({
    ...check,
    evaluate: check.evaluate.toString(),
  }));

  const pageResults = [];
  const failures = [];

  acquireBrowserSlot();
  try {
    if (multiMode) {
      // Audit each provided URL directly, concurrently — no subpage
      // crawling, and no dependency between them, so there's no reason to
      // do this one at a time.
      const results = await mapWithConcurrency(urls, AUDIT_CONCURRENCY, (url) => auditPage(url, serializedChecks));
      for (const result of results) {
        if (result?.failed) failures.push(result);
        else if (result) pageResults.push(result.pageResult);
      }
    } else if (shouldCrawl) {
      // Single URL mode: links are only ever collected from the homepage
      // (never from subpages), so the homepage has to be audited alone
      // first — but everything after that is a flat, independent list with
      // no crawl-order dependency, so it's audited concurrently instead of
      // one page at a time.
      const url = urls[0];
      const ownLocale = getLocalePrefix(url);

      const homepageResult = await auditPage(url, serializedChecks, true);
      if (!homepageResult || homepageResult.failed) {
        if (homepageResult?.failed) failures.push(homepageResult);
      } else {
        pageResults.push(homepageResult.pageResult);

        const visited = new Set([normalizePageUrl(url)]);
        const subpageUrls = [];
        for (const link of homepageResult.links) {
          if (isLocaleUrl(link, ownLocale)) continue;
          const norm = normalizePageUrl(link);
          if (visited.has(norm)) continue;
          visited.add(norm);
          subpageUrls.push(link);
          if (subpageUrls.length >= maxPages - 1) break;
        }

        const subpageResults = await mapWithConcurrency(subpageUrls, AUDIT_CONCURRENCY, (subUrl) =>
          auditPage(subUrl, serializedChecks, false)
        );
        for (const result of subpageResults) {
          if (!result || result.failed) {
            if (result?.failed) failures.push(result);
            continue;
          }
          pageResults.push(result.pageResult);
        }
      }
    } else {
      // Single URL, crawling disabled: audit just that page
      const result = await auditPage(urls[0], serializedChecks);
      if (result?.failed) failures.push(result);
      else if (result) pageResults.push(result.pageResult);
    }

    const failureDetails = failures.map(({ url, reason, status, vendor, detail }) => ({
      url,
      reason,
      status,
      vendor,
      detail,
    }));

    if (pageResults.length === 0) {
      const botBlocked = failures.find((f) => f.reason === "bot-challenge");
      const message = botBlocked
        ? `${botBlocked.vendor} blocked this scan with a bot-detection challenge` +
          (botBlocked.status ? ` (HTTP ${botBlocked.status})` : "") +
          `. This can happen even to real visitors' automated tools. Try running the scan again in a few minutes, ` +
          `or ask the site owner to allowlist this server for automated accessibility testing.`
        : "Failed to load the provided URL(s). The site may be blocking automated browsers or redirecting unexpectedly.";

      await flagIncident("audit-failed", {
        url: multiMode ? urls : urls[0],
        reason: botBlocked ? botBlocked.reason : failures[0]?.reason || "unknown",
        detail: botBlocked ? botBlocked.vendor : failures[0]?.detail,
        failures: failureDetails,
      });

      return res.status(400).json({ success: false, message, failures: failureDetails });
    }

    // A crawl that was allowed to go deeper (maxPages > what it found)
    // but came back thin is likely a link-discovery problem, not a small
    // site — flag it the same way as a hard failure so it gets checked.
    if (!multiMode && shouldCrawl && pageResults.length < LOW_PAGE_YIELD_THRESHOLD && maxPages > pageResults.length) {
      await flagIncident("low-page-yield", {
        url: urls[0],
        pagesScanned: pageResults.length,
        maxPages,
        failures: failureDetails,
      });
    }

    // Some URLs may have failed (e.g. bot-blocked) even though others
    // succeeded — still surface those so the frontend can offer the
    // manual-scan fallback for just the ones that need it.
    const reportInfo = saveReport(pageResults, multiMode ? urls : urls[0]);
    res.json({ success: true, ...reportInfo, failures: failureDetails });
  } catch (error) {
    logger.error("audit-request-crashed", { urls, error: error.message, stack: error.stack });
    await flagIncident("audit-failed", { url: multiMode ? urls : urls[0], reason: "crash", detail: error.message });
    res.status(500).json({ success: false, error: error.message });
  } finally {
    releaseBrowserSlot();
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
  const serializedChecks = customChecks.map((check) => ({
    ...check,
    evaluate: check.evaluate.toString(),
  }));

  res.set("Access-Control-Allow-Origin", "*");
  res.type("application/javascript").send(`(function () {
  var ORIGIN = ${JSON.stringify(origin)};
  var CHECKS = ${JSON.stringify(serializedChecks)};
  var RULES = ${JSON.stringify(customRules)};
  var MAX_PAGES = ${JSON.stringify(MAX_CRAWL_PAGES)};
  var KNOWN_NOISE_SELECTORS = ${JSON.stringify(KNOWN_NOISE_SELECTORS)};
  var isFontProbeSpan = ${isFontProbeSpan.toString()};
  var isWordMeasureDiv = ${isWordMeasureDiv.toString()};

  function toast(msg, isError) {
    var el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;background:" +
      (isError ? "#b91c1c" : "#111827") + ";color:#fff;padding:12px 16px;border-radius:8px;" +
      "font:14px/1.4 -apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:340px;";
    document.body.appendChild(el);
    return el;
  }

  var statusEl = toast("Accessibility Checker: scanning this page...");
  function status(msg) { statusEl.textContent = msg; }

  function reconstructedChecks() {
    return CHECKS.map(function (check) {
      return Object.assign({}, check, {
        evaluate: new Function("return (" + check.evaluate + ").apply(this, arguments);"),
      });
    });
  }

  // Same-origin links + GET form actions on a document, mirroring the
  // server's one-level-deep crawl so the manual fallback matches it.
  function sameOriginLinks(doc, origin) {
    var seen = {};
    var out = [];
    function add(raw) {
      if (!raw) return;
      try {
        var u = new URL(raw, origin);
        if (u.origin !== origin) return;
        u.hash = "";
        var key = u.toString().replace(/\\/$/, "");
        if (seen[key]) return;
        seen[key] = true;
        out.push(u.toString());
      } catch (e) {}
    }
    doc.querySelectorAll("a[href]").forEach(function (a) { add(a.getAttribute("href")); });
    doc.querySelectorAll("form[action]").forEach(function (f) {
      var method = (f.getAttribute("method") || "get").toLowerCase();
      if (method === "get") add(f.getAttribute("action"));
    });
    return out;
  }

  // Loads a same-origin URL into a hidden iframe so it inherits this
  // browser session's cookies (including any solved bot-challenge) without
  // opening visible tabs/windows.
  function loadIframe(url, timeoutMs) {
    return new Promise(function (resolve) {
      var iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;";
      var done = false;
      function finish(result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(result);
      }
      var timer = setTimeout(function () { iframe.remove(); finish(null); }, timeoutMs);
      iframe.onload = function () { finish(iframe); };
      iframe.onerror = function () { iframe.remove(); finish(null); };
      iframe.src = url;
      document.body.appendChild(iframe);
    });
  }

  // The report only ever shows a pass count, never per-node HTML/selectors
  // for passing checks — but axe includes full node detail for every pass
  // by default, which is the single biggest contributor to payload size on
  // a multi-page crawl. Strip it here (keeping array length so counts stay
  // correct) rather than raising the body-size limit indefinitely.
  function trimPassNodeDetail(results) {
    if (results && Array.isArray(results.passes)) {
      results.passes = results.passes.map(function (p) {
        return Object.assign({}, p, { nodes: (p.nodes || []).map(function () { return {}; }) });
      });
    }
    return results;
  }

  // Mirrors the server-side crawler's pre-scan scroll (index.js
  // autoScrollToBottom): steps smoothly to the bottom so lazy-loaded content
  // mounts before axe runs, then returns to the top. Best-effort — a stuck
  // scroll shouldn't block the scan, so it's capped by a timeout.
  function autoScrollToBottom(win, maxDurationMs) {
    return new Promise(function (resolve) {
      var doc = win.document;
      var startedAt = Date.now();
      var stepPx = 200;
      var stepDelayMs = 100;
      var lastHeight = doc.body ? doc.body.scrollHeight : 0;
      var stableRounds = 0;

      var timer = win.setInterval(function () {
        var timedOut = Date.now() - startedAt > maxDurationMs;
        win.scrollBy(0, stepPx);

        var currentHeight = doc.body ? doc.body.scrollHeight : 0;
        var reachedBottom = win.innerHeight + win.scrollY >= currentHeight - 2;

        if (currentHeight === lastHeight) {
          stableRounds += 1;
        } else {
          stableRounds = 0;
          lastHeight = currentHeight;
        }

        if ((reachedBottom && stableRounds >= 3) || timedOut) {
          win.clearInterval(timer);
          win.scrollTo(0, 0);
          resolve();
        }
      }, stepDelayMs);
    });
  }

  function wait(win, ms) {
    return new Promise(function (resolve) { win.setTimeout(resolve, ms); });
  }

  // Mirrors the server-side crawler's triggerDeferredScriptLoad (index.js):
  // best-effort nudge for delay-JS optimizer plugins (WP Rocket etc.) that
  // hold scripts back until a user interaction event fires. Synthetic
  // dispatchEvent calls are untrusted, so this won't unstick a listener
  // that checks event.isTrusted, but most delay-JS integrations don't.
  // Mouse-only (no keydown/click) — see the server-side comment for why: a
  // stray keydown/click can pop open a widget toggle that listens for any
  // page activity, flooding every scanned page with violations from a panel
  // that isn't normally open at all.
  function triggerDeferredScriptLoad(win) {
    try {
      ["mousemove", "wheel"].forEach(function (type) {
        win.dispatchEvent(new win.Event(type, { bubbles: true }));
      });
    } catch (e) {}
  }

  // Mirrors the server-side crawler's focusFooterLandmark (index.js): some
  // sites only apply certain fixes once the footer receives focus. Scoped to
  // an actual link/button/input inside <footer>, never the footer itself or
  // anything outside it.
  function focusFooterLandmark(win) {
    try {
      var footer = win.document.querySelector("footer, [role='contentinfo']");
      if (!footer) return;
      var focusable = footer.querySelector(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable && typeof focusable.focus === "function") focusable.focus();
    } catch (e) {}
  }

  // Mirrors the server-side crawler's dismissAnyOpenOverlay (index.js):
  // defensive Escape in case any of the above popped something open anyway.
  function dismissAnyOpenOverlay(win) {
    try {
      win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } catch (e) {}
  }

  function scanWindow(win, url, axeSourceCode) {
    triggerDeferredScriptLoad(win);
    return autoScrollToBottom(win, 15000).catch(function () {})
      .then(function () { focusFooterLandmark(win); })
      .then(function () { dismissAnyOpenOverlay(win); })
      // Let anything the interaction/scroll triggered (lazy images, deferred
      // scripts) finish mounting before axe runs.
      .then(function () { return wait(win, 7000); })
      .then(function () {
        KNOWN_NOISE_SELECTORS.forEach(function (sel) {
          win.document.querySelectorAll(sel).forEach(function (el) { el.remove(); });
        });
        win.document.querySelectorAll("body > span").forEach(function (el) {
          if (isFontProbeSpan(el, win.document.body)) el.remove();
        });
        win.document.querySelectorAll("body > div").forEach(function (el) {
          if (isWordMeasureDiv(el, win.document.body)) el.remove();
        });
        win.eval(axeSourceCode);
        win.axe.configure({ checks: reconstructedChecks(), rules: RULES });
        return win.axe.run().then(function (results) {
          return { url: url, finalUrl: win.location.href, accessibility: trimPassNodeDetail(results) };
        });
      });
  }

  function run(axeSourceCode) {
    var pages = [];
    scanWindow(window, location.href, axeSourceCode)
      .then(function (topResult) {
        pages.push(topResult);

        var origin = location.origin;
        var links = sameOriginLinks(document, origin).filter(function (u) {
          return u.replace(/\\/$/, "") !== location.href.replace(/\\/$/, "");
        }).slice(0, MAX_PAGES - 1);

        return links.reduce(function (chain, link, i) {
          return chain.then(function () {
            status("Scanning page " + (i + 2) + " of " + (links.length + 1) + "\\u2026");
            return loadIframe(link, 20000).then(function (iframe) {
              if (!iframe) return;
              var win = iframe.contentWindow;
              var winOrigin;
              try { winOrigin = win && win.location.origin; } catch (e) { winOrigin = null; }
              if (!win || winOrigin !== origin) { iframe.remove(); return; }
              // Remove the iframe only after scanning settles — removing it
              // while axe is still running mid-flight tears down its window
              // and leaves the scan hanging forever.
              return scanWindow(win, link, axeSourceCode)
                .then(function (result) { pages.push(result); })
                .catch(function () { /* skip pages we can't script into */ })
                .then(function () { iframe.remove(); });
            });
          });
        }, Promise.resolve());
      })
      .then(function () {
        status("Submitting results for " + pages.length + " page(s)\\u2026");
        return fetch(ORIGIN + "/audit/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestedUrl: location.href, pages: pages }),
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        statusEl.remove();
        if (data && data.success) {
          var link = toast("Scan complete \\u2014 " + pages.length + " page(s).");
          var viewLink = document.createElement("a");
          viewLink.href = ORIGIN + data.viewReport;
          viewLink.target = "_blank";
          viewLink.rel = "noopener";
          viewLink.textContent = "View report";
          viewLink.style.cssText = "display:block;margin-top:6px;color:#93c5fd;font-weight:600";
          link.appendChild(viewLink);
          var a = document.createElement("a");
          a.href = ORIGIN + data.report;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = "Download report";
          a.style.cssText = "display:block;margin-top:2px;color:#93c5fd;font-weight:600";
          link.appendChild(a);
        } else {
          toast("Scan failed: " + (data && data.message ? data.message : "unknown error"), true);
        }
      })
      .catch(function (err) {
        statusEl.remove();
        toast("Scan failed: " + err.message, true);
      });
  }

  fetch(ORIGIN + "/manual-scan/axe-core.js")
    .then(function (r) { return r.text(); })
    .then(function (code) {
      (0, eval)(code); // defines window.axe for the top-level page
      run(code);
    })
    .catch(function (err) {
      statusEl.remove();
      toast("Could not load axe-core from " + ORIGIN + ": " + err.message, true);
    });
})();`);
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
  if (browser) await browser.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((err) => {
  logger.error("server-start-failed", { error: err.message, stack: err.stack });
  process.exit(1);
});
