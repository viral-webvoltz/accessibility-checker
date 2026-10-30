// Builds dist/a11y-scan.js: a self-contained script (axe-core, custom rules and
// report renderer inlined) that runs the audit in the page and downloads the
// HTML report locally. Static file — host it anywhere (e.g. an R2 bucket).
const fs = require("fs");
const path = require("path");
const axeSource = require("axe-core").source;
const { buildManualScanBundle } = require("./manualScanBundle");

const maxPages = parseInt(process.env.MAX_CRAWL_PAGES) || 20;
const out = buildManualScanBundle({ origin: "", maxPages, axeSource, standalone: true });

const distDir = path.join(__dirname, "dist");
fs.mkdirSync(distDir, { recursive: true });
const file = path.join(distDir, "a11y-scan.js");
fs.writeFileSync(file, out);
console.log(`Wrote ${file} (${(out.length / 1024).toFixed(0)} KB)`);

// The web frontend serves this same script for its "scan from your own
// browser" fallback.
const webPublic = path.join(__dirname, "web", "public");
if (fs.existsSync(webPublic)) {
  fs.writeFileSync(path.join(webPublic, "a11y-scan.js"), out);
  console.log(`Copied to ${path.join(webPublic, "a11y-scan.js")}`);
}
