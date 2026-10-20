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

module.exports = { KNOWN_NOISE_SELECTORS, isFontProbeSpan, isWordMeasureDiv };
