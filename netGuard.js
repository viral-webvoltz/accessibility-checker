// Keeps the scanner's browser on the public internet. The submitted URL is
// checked up front, but a page can still redirect, link (crawl), or load
// sub-resources and iframes pointing at private addresses — e.g. Lambda's
// runtime API on 127.0.0.1:9001. guardPageRequests() blocks those inside
// the browser, for every request the page makes.
const dns = require("dns").promises;
const net = require("net");
const logger = require("./logger");

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local / cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 3], // multicast + reserved
]) {
  blocked.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
]) {
  blocked.addSubnet(addr, prefix, "ipv6");
}

function isPrivateAddress(address) {
  const type = net.isIP(address);
  if (type === 4) return blocked.check(address, "ipv4");
  if (type === 6) {
    // IPv4-mapped (::ffff:127.0.0.1) → check the IPv4 part.
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return false;
}

// Hostname resolutions are cached briefly so a page with 200 requests to the
// same CDN only costs one lookup.
const DNS_CACHE_MS = 60_000;
const dnsCache = new Map();

async function isHostSafe(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  if (net.isIP(host)) return !isPrivateAddress(host);

  const cached = dnsCache.get(host);
  if (cached && cached.expires > Date.now()) return cached.safe;
  let safe;
  try {
    const addresses = await dns.lookup(host, { all: true });
    safe = addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    safe = false;
  }
  dnsCache.set(host, { safe, expires: Date.now() + DNS_CACHE_MS });
  return safe;
}

async function isUrlSafe(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  return isHostSafe(parsed.hostname);
}

// Schemes a page may load besides http(s); everything else (file:, chrome:,
// ftp:, …) is refused.
const INLINE_SCHEMES = new Set(["data:", "blob:", "about:"]);

async function guardPageRequests(page) {
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (request.isInterceptResolutionHandled()) return;
    let allow = false;
    try {
      const url = new URL(request.url());
      if (INLINE_SCHEMES.has(url.protocol)) allow = true;
      else if (url.protocol === "http:" || url.protocol === "https:") allow = await isHostSafe(url.hostname);
    } catch {
      allow = false;
    }
    if (request.isInterceptResolutionHandled()) return;
    if (allow) {
      request.continue().catch(() => {});
    } else {
      logger.warn("blocked-private-request", { url: request.url().slice(0, 200), type: request.resourceType() });
      request.abort("blockedbyclient").catch(() => {});
    }
  });
}

module.exports = { isPrivateAddress, isHostSafe, isUrlSafe, guardPageRequests };
