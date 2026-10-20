const { customChecks, customRules, CUSTOM_RULE_IDS } = require("./customAxeRules");
const fs = require("fs");
const path = require("path");
const { KNOWN_NOISE_SELECTORS, isFontProbeSpan, isWordMeasureDiv } = require("./noiseFilters");

// Builds the browser-side manual-scan script. Two delivery modes:
//  - server mode (default): axe-core is fetched from `origin` and results are
//    POSTed back to it, which renders the report.
//  - standalone mode (`standalone` set): axe-core and the report renderer are
//    inlined and the finished HTML report is downloaded in-browser, so the
//    script needs no server at all and can be hosted as a static file.
function buildManualScanBundle({ origin, maxPages, axeSource, standalone }) {
  const serializedChecks = customChecks.map((check) => ({
    ...check,
    evaluate: check.evaluate.toString(),
  }));
  const MAX_CRAWL_PAGES = maxPages;
  const reportTemplateSource = standalone
    ? fs.readFileSync(path.join(__dirname, "reportTemplate.js"), "utf8")
    : "";
  return `(function () {
  var ORIGIN = ${JSON.stringify(origin)};
  var CHECKS = ${JSON.stringify(serializedChecks)};
  var RULES = ${JSON.stringify(customRules)};
  var MAX_PAGES = ${JSON.stringify(MAX_CRAWL_PAGES)};
  var KNOWN_NOISE_SELECTORS = ${JSON.stringify(KNOWN_NOISE_SELECTORS)};
  var isFontProbeSpan = ${isFontProbeSpan.toString()};
  var isWordMeasureDiv = ${isWordMeasureDiv.toString()};
${standalone ? `  var AXE_SOURCE = ${JSON.stringify(axeSource)};
  var CUSTOM_RULE_IDS = ${JSON.stringify(CUSTOM_RULE_IDS)};
  var buildHtmlReport = (function () {
    var module = { exports: {} };
    ${reportTemplateSource}
    return module.exports.buildHtmlReport;
  })();` : ""}

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
      .then(function () { return deliver(pages); })
      .catch(function (err) {
        statusEl.remove();
        toast("Scan failed: " + err.message, true);
      });
  }

${standalone ? `  // No server: render the report here and hand it to the user as a file.
  function deliver(pages) {
    status("Building report for " + pages.length + " page(s)\\u2026");
    var pageResults = pages.map(function (p) {
      return {
        url: p.url,
        finalUrl: p.finalUrl || p.url,
        accessibility: p.accessibility,
        network: { summary: null, requests: [] },
        console: [],
      };
    });
    var html = buildHtmlReport(
      { requestedUrl: location.href, timestamp: Date.now(), pages: pageResults },
      CUSTOM_RULE_IDS
    );
    var host = location.hostname.replace(/^www\\./, "");
    var stamp = new Date().toISOString().slice(0, 10);
    var blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    var a = document.createElement("a");
    a.href = blobUrl;
    a.download = host + "-accessibility-report-" + stamp + ".html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    statusEl.remove();
    var done = toast("Scan complete \\u2014 " + pages.length + " page(s). Report downloaded.");
    var open = document.createElement("a");
    open.href = blobUrl;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "Open report";
    open.style.cssText = "display:block;margin-top:6px;color:#93c5fd;font-weight:600";
    done.appendChild(open);
  }` : `  // Server mode: post results back and link to the rendered report.
  function deliver(pages) {
    status("Submitting results for " + pages.length + " page(s)\\u2026");
    return fetch(ORIGIN + "/audit/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedUrl: location.href, pages: pages }),
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
      });
  }`}

${standalone ? `  try {
    (0, eval)(AXE_SOURCE); // defines window.axe for the top-level page
    run(AXE_SOURCE);
  } catch (err) {
    statusEl.remove();
    toast("Could not start scan (page CSP may block eval): " + err.message, true);
  }` : `  fetch(ORIGIN + "/manual-scan/axe-core.js")
    .then(function (r) { return r.text(); })
    .then(function (code) {
      (0, eval)(code); // defines window.axe for the top-level page
      run(code);
    })
    .catch(function (err) {
      statusEl.remove();
      toast("Could not load axe-core from " + ORIGIN + ": " + err.message, true);
    });`}
})();`;
}

module.exports = { buildManualScanBundle };
