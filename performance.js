// Lab performance metrics, collected in the same browser session as the
// accessibility audit (no separate Lighthouse run), and scored with the same
// log-normal curves Lighthouse uses for its desktop preset.
//
// Speed Index isn't measured (it needs a filmstrip), so its 10% weight is
// spread over the other metrics. Treat the result as an estimate: pages are
// loaded unthrottled and several tabs may share the CPU during a crawl.

// Injected with page.evaluateOnNewDocument so observers are live before the
// page's own scripts run.
const PERF_OBSERVER_SCRIPT = `(() => {
  const s = (window.__a11yPerf = { lcp: null, shifts: [], longTasks: [] });
  const watch = (type, cb) => {
    try { new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true }); } catch (e) {}
  };
  watch("largest-contentful-paint", (e) => { s.lcp = e.renderTime || e.startTime; });
  watch("layout-shift", (e) => { if (!e.hadRecentInput) s.shifts.push([e.startTime, e.value]); });
  watch("longtask", (e) => { s.longTasks.push([e.startTime, e.duration]); });
})();`;

// Reads the raw numbers back out of the page. Call right after load, before
// any scrolling/interaction, so CLS and LCP reflect a normal first view.
async function readPerformanceMetrics(page) {
  return page.evaluate(() => {
    const s = window.__a11yPerf || { lcp: null, shifts: [], longTasks: [] };
    const nav = performance.getEntriesByType("navigation")[0];
    const fcpEntry = performance.getEntriesByName("first-contentful-paint")[0];
    const fcp = fcpEntry ? fcpEntry.startTime : null;

    // CLS = largest "session window" of shifts (<1s apart, window <5s).
    let cls = 0;
    let windowValue = 0;
    let windowStart = 0;
    let last = -Infinity;
    for (const [t, v] of s.shifts) {
      if (t - last > 1000 || t - windowStart > 5000) {
        windowStart = t;
        windowValue = 0;
      }
      windowValue += v;
      last = t;
      cls = Math.max(cls, windowValue);
    }

    // TBT = blocking portion (>50ms) of long tasks after first paint.
    const tbt = s.longTasks
      .filter(([start]) => fcp === null || start >= fcp)
      .reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0);

    return {
      ttfb: nav ? nav.responseStart : null,
      fcp,
      lcp: s.lcp,
      cls,
      tbt,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      load: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : null,
    };
  });
}

// Lighthouse desktop scoring curves (p10 = score 0.9, median = score 0.5).
const CURVES = {
  fcp: { p10: 934, median: 1600, weight: 10 },
  lcp: { p10: 1200, median: 2400, weight: 25 },
  tbt: { p10: 150, median: 350, weight: 30 },
  cls: { p10: 0.1, median: 0.25, weight: 25 },
};

// Abramowitz & Stegun 7.1.26, same approximation Lighthouse uses.
function erf(x) {
  const sign = Math.sign(x);
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
  return sign * (1 - y * Math.exp(-x * x));
}

function logNormalScore({ p10, median }, value) {
  if (value <= 0) return 1;
  const INVERSE_ERFC_ONE_FIFTH = 0.9061938024368232;
  const xLogRatio = Math.log(value / median);
  const p10LogRatio = -Math.log(p10 / median);
  const standardizedX = (xLogRatio * INVERSE_ERFC_ONE_FIFTH) / p10LogRatio;
  const score = (1 - erf(standardizedX)) / 2;
  return Math.min(1, Math.max(0, score));
}

// Returns { score, metrics: {name: {value, score}} } or null if nothing usable was read.
function scorePerformance(raw, network) {
  if (!raw) return null;
  const metrics = {};
  let weighted = 0;
  let totalWeight = 0;
  for (const [name, curve] of Object.entries(CURVES)) {
    const value = raw[name];
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    const s = logNormalScore(curve, value);
    metrics[name] = { value, score: Math.round(s * 100) };
    weighted += s * curve.weight;
    totalWeight += curve.weight;
  }
  if (totalWeight === 0) return null;
  return {
    score: Math.round((weighted / totalWeight) * 100),
    metrics,
    ttfb: raw.ttfb,
    domContentLoaded: raw.domContentLoaded,
    load: raw.load,
    requests: network ? network.totalRequests : null,
    transferBytes: network ? network.totalTransferredBytes : null,
    failedRequests: network ? network.failedRequests : null,
  };
}

module.exports = { PERF_OBSERVER_SCRIPT, readPerformanceMetrics, scorePerformance };
