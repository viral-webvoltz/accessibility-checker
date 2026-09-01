/**
 * reportTemplate.js — multi-page accessibility report generator
 */

// Webvoltz favicon, inlined so downloaded standalone reports still show it
// (sourced from webvoltz.com's own favicon).
const FAVICON_DATA_URI = "data:image/webp;base64,UklGRgYCAABXRUJQVlA4WAoAAAAQAAAAHwAAHwAAQUxQSIYAAAABcFNtW+t8C4gAA+kCblFYN6ykm/hNcDBwmf6f9OQfs0XEBACAqTuay5eZxtbiteuilB9KGvyLxZ7Lj/m4BuD2RfHiYHvW4MFUsajGuhMdCVSUKWvl8vedtTJp0SQ6Etqkk1rTswaPFv6ocfUA1hf+FV93eHZjlF9IGjxe2ypQ/mam0BoAAFZQOCBaAQAAMAkAnQEqIAAgAD5VIIxFI6IhG/QAOAVEtgBdl+EKBOAKgA6IDrAPQg6Uf9of1yxADrArMeYdxlWmgOXRlMLl1Y38z2sCIG9ZJzf9KolhubyyAAD+//DCtuHk/+OYX5ovoff7vjgn3D4Sv7xo4pTH1V9v6N0bW08L+lh/Iz5d/x7oP42VNQ8lhkP+oTjKnsf+L2/7iy8yKiABdp818CcRAOdOiAuqr811O36pHYxwqpSv7flyctiojVHN7zDAKTnoL62fCrFRK9K9z5DLfq/R4D8ZNPhv9WLOfaL+nrZO6lQuJfBH/UdAOuAa7+KKEeZ2vELz3zTj/+ISTgyXhqnBSe3FU9vnUW+xbNodyyNa3b24pK+mY/pX7PBtMlP/DVKCXUA/2jZW4yl60NOwwP0hNBpWN61Qqv77yngLhmWM9VHxvY31bWMPmjIfDbA7H/OudS+/Bre1AthAAA==";

// ─── WCAG criterion metadata ──────────────────────────────────────────────────
const WCAG_CRITERIA_MAP = {
  wcag111: { id: "1.1.1", title: "Non-text Content", level: "A", ver: "2.0" },
  wcag121: {
    id: "1.2.1",
    title: "Audio-only & Video-only",
    level: "A",
    ver: "2.0",
  },
  wcag122: {
    id: "1.2.2",
    title: "Captions (Prerecorded)",
    level: "A",
    ver: "2.0",
  },
  wcag123: { id: "1.2.3", title: "Audio Description", level: "A", ver: "2.0" },
  wcag124: { id: "1.2.4", title: "Captions (Live)", level: "AA", ver: "2.0" },
  wcag125: {
    id: "1.2.5",
    title: "Audio Description (Prerecorded)",
    level: "AA",
    ver: "2.0",
  },
  wcag131: {
    id: "1.3.1",
    title: "Info and Relationships",
    level: "A",
    ver: "2.0",
  },
  wcag132: {
    id: "1.3.2",
    title: "Meaningful Sequence",
    level: "A",
    ver: "2.0",
  },
  wcag133: {
    id: "1.3.3",
    title: "Sensory Characteristics",
    level: "A",
    ver: "2.0",
  },
  wcag134: { id: "1.3.4", title: "Orientation", level: "AA", ver: "2.1" },
  wcag135: {
    id: "1.3.5",
    title: "Identify Input Purpose",
    level: "AA",
    ver: "2.1",
  },
  wcag141: { id: "1.4.1", title: "Use of Color", level: "A", ver: "2.0" },
  wcag142: { id: "1.4.2", title: "Audio Control", level: "A", ver: "2.0" },
  wcag143: {
    id: "1.4.3",
    title: "Contrast (Minimum)",
    level: "AA",
    ver: "2.0",
  },
  wcag144: { id: "1.4.4", title: "Resize Text", level: "AA", ver: "2.0" },
  wcag145: { id: "1.4.5", title: "Images of Text", level: "AA", ver: "2.0" },
  wcag146: {
    id: "1.4.6",
    title: "Contrast (Enhanced)",
    level: "AAA",
    ver: "2.0",
  },
  wcag1410: { id: "1.4.10", title: "Reflow", level: "AA", ver: "2.1" },
  wcag1411: {
    id: "1.4.11",
    title: "Non-text Contrast",
    level: "AA",
    ver: "2.1",
  },
  wcag1412: { id: "1.4.12", title: "Text Spacing", level: "AA", ver: "2.1" },
  wcag1413: {
    id: "1.4.13",
    title: "Content on Hover or Focus",
    level: "AA",
    ver: "2.1",
  },
  wcag211: { id: "2.1.1", title: "Keyboard", level: "A", ver: "2.0" },
  wcag212: { id: "2.1.2", title: "No Keyboard Trap", level: "A", ver: "2.0" },
  wcag213: {
    id: "2.1.3",
    title: "Keyboard (No Exception)",
    level: "AAA",
    ver: "2.0",
  },
  wcag221: { id: "2.2.1", title: "Timing Adjustable", level: "A", ver: "2.0" },
  wcag222: { id: "2.2.2", title: "Pause, Stop, Hide", level: "A", ver: "2.0" },
  wcag224: { id: "2.2.4", title: "Interruptions", level: "AAA", ver: "2.0" },
  wcag231: {
    id: "2.3.1",
    title: "Three Flashes or Below Threshold",
    level: "A",
    ver: "2.0",
  },
  wcag233: {
    id: "2.3.3",
    title: "Animation from Interactions",
    level: "AAA",
    ver: "2.1",
  },
  wcag241: { id: "2.4.1", title: "Bypass Blocks", level: "A", ver: "2.0" },
  wcag242: { id: "2.4.2", title: "Page Titled", level: "A", ver: "2.0" },
  wcag243: { id: "2.4.3", title: "Focus Order", level: "A", ver: "2.0" },
  wcag244: {
    id: "2.4.4",
    title: "Link Purpose (In Context)",
    level: "A",
    ver: "2.0",
  },
  wcag245: { id: "2.4.5", title: "Multiple Ways", level: "AA", ver: "2.0" },
  wcag246: {
    id: "2.4.6",
    title: "Headings and Labels",
    level: "AA",
    ver: "2.0",
  },
  wcag247: { id: "2.4.7", title: "Focus Visible", level: "AA", ver: "2.0" },
  wcag249: {
    id: "2.4.9",
    title: "Link Purpose (Link Only)",
    level: "AAA",
    ver: "2.0",
  },
  wcag2411: {
    id: "2.4.11",
    title: "Focus Not Obscured",
    level: "AA",
    ver: "2.2",
  },
  wcag2412: {
    id: "2.4.12",
    title: "Focus Not Obscured (Enhanced)",
    level: "AAA",
    ver: "2.2",
  },
  wcag251: { id: "2.5.1", title: "Pointer Gestures", level: "A", ver: "2.1" },
  wcag252: {
    id: "2.5.2",
    title: "Pointer Cancellation",
    level: "A",
    ver: "2.1",
  },
  wcag253: { id: "2.5.3", title: "Label in Name", level: "A", ver: "2.1" },
  wcag254: { id: "2.5.4", title: "Motion Actuation", level: "A", ver: "2.1" },
  wcag255: { id: "2.5.5", title: "Target Size", level: "AAA", ver: "2.2" },
  wcag257: {
    id: "2.5.7",
    title: "Dragging Movements",
    level: "AA",
    ver: "2.2",
  },
  wcag258: {
    id: "2.5.8",
    title: "Target Size (Minimum)",
    level: "AA",
    ver: "2.2",
  },
  wcag311: { id: "3.1.1", title: "Language of Page", level: "A", ver: "2.0" },
  wcag312: { id: "3.1.2", title: "Language of Parts", level: "AA", ver: "2.0" },
  wcag321: { id: "3.2.1", title: "On Focus", level: "A", ver: "2.0" },
  wcag322: { id: "3.2.2", title: "On Input", level: "A", ver: "2.0" },
  wcag323: {
    id: "3.2.3",
    title: "Consistent Navigation",
    level: "AA",
    ver: "2.0",
  },
  wcag324: {
    id: "3.2.4",
    title: "Consistent Identification",
    level: "AA",
    ver: "2.0",
  },
  wcag325: {
    id: "3.2.5",
    title: "Change on Request",
    level: "AAA",
    ver: "2.0",
  },
  wcag326: { id: "3.2.6", title: "Consistent Help", level: "A", ver: "2.2" },
  wcag331: {
    id: "3.3.1",
    title: "Error Identification",
    level: "A",
    ver: "2.0",
  },
  wcag332: {
    id: "3.3.2",
    title: "Labels or Instructions",
    level: "A",
    ver: "2.0",
  },
  wcag333: { id: "3.3.3", title: "Error Suggestion", level: "AA", ver: "2.0" },
  wcag334: { id: "3.3.4", title: "Error Prevention", level: "AA", ver: "2.0" },
  wcag337: { id: "3.3.7", title: "Redundant Entry", level: "A", ver: "2.2" },
  wcag338: {
    id: "3.3.8",
    title: "Accessible Authentication",
    level: "AA",
    ver: "2.2",
  },
  wcag411: { id: "4.1.1", title: "Parsing", level: "A", ver: "2.0" },
  wcag412: { id: "4.1.2", title: "Name, Role, Value", level: "A", ver: "2.0" },
  wcag413: { id: "4.1.3", title: "Status Messages", level: "AA", ver: "2.1" },
};

const TAG_TO_DISABILITIES = {
  wcag111: ["Blind", "Low Vision"],
  wcag121: ["Deaf", "Hard of Hearing"],
  wcag122: ["Deaf", "Hard of Hearing"],
  wcag123: ["Deaf", "Hard of Hearing"],
  wcag124: ["Deaf", "Hard of Hearing"],
  wcag125: ["Deaf", "Hard of Hearing"],
  wcag131: ["Blind", "Low Vision", "Cognitive"],
  wcag132: ["Blind", "Cognitive"],
  wcag133: ["Blind", "Cognitive"],
  wcag134: ["Motor"],
  wcag135: ["Cognitive", "Motor"],
  wcag141: ["Color Blind", "Low Vision"],
  wcag142: ["Blind", "Low Vision"],
  wcag143: ["Low Vision", "Color Blind"],
  wcag144: ["Low Vision"],
  wcag145: ["Blind", "Low Vision"],
  wcag146: ["Low Vision"],
  wcag1410: ["Low Vision"],
  wcag1411: ["Low Vision", "Color Blind"],
  wcag1412: ["Low Vision", "Cognitive"],
  wcag1413: ["Low Vision", "Motor"],
  wcag211: ["Motor", "Blind"],
  wcag212: ["Motor", "Blind"],
  wcag213: ["Motor"],
  wcag221: ["Cognitive", "Motor"],
  wcag222: ["Cognitive", "Seizure"],
  wcag224: ["Cognitive"],
  wcag231: ["Seizure"],
  wcag233: ["Vestibular"],
  wcag241: ["Blind", "Motor"],
  wcag242: ["Blind", "Cognitive"],
  wcag243: ["Blind", "Motor"],
  wcag244: ["Blind", "Cognitive"],
  wcag245: ["Blind", "Motor", "Cognitive"],
  wcag246: ["Blind", "Cognitive"],
  wcag247: ["Motor", "Blind"],
  wcag249: ["Blind", "Cognitive"],
  wcag2411: ["Motor", "Low Vision"],
  wcag2412: ["Motor", "Low Vision"],
  wcag251: ["Motor"],
  wcag252: ["Motor"],
  wcag253: ["Motor"],
  wcag254: ["Motor"],
  wcag255: ["Motor"],
  wcag257: ["Motor"],
  wcag258: ["Motor"],
  wcag311: ["Blind", "Cognitive"],
  wcag312: ["Blind", "Cognitive"],
  wcag321: ["Cognitive", "Blind"],
  wcag322: ["Cognitive"],
  wcag323: ["Cognitive"],
  wcag324: ["Blind", "Cognitive"],
  wcag325: ["Cognitive"],
  wcag326: ["Cognitive"],
  wcag331: ["Blind", "Cognitive"],
  wcag332: ["Blind", "Cognitive"],
  wcag333: ["Cognitive"],
  wcag334: ["Cognitive"],
  wcag337: ["Cognitive", "Motor"],
  wcag338: ["Cognitive"],
  wcag411: ["Blind", "Low Vision"],
  wcag412: ["Blind", "Low Vision"],
  wcag413: ["Blind", "Low Vision"],
};

// ─── SVG chevron for expand / collapse ───────────────────────────────────────
const CHEVRON = `<svg class="expand-arrow" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function impactRank(impact) {
  return { critical: 4, serious: 3, moderate: 2, minor: 1 }[impact] || 0;
}

function impactColor(impact) {
  return (
    {
      critical: "#DC2626",
      serious: "#EA580C",
      moderate: "#CA8A04",
      minor: "#64748B",
    }[impact] || "#64748B"
  );
}

function impactBg(impact) {
  return (
    {
      critical: "#FEF2F2",
      serious: "#FFF7ED",
      moderate: "#FEFCE8",
      minor: "#F8FAFC",
    }[impact] || "#F8FAFC"
  );
}

function impactLabel(impact) {
  return (
    {
      critical: "Critical",
      serious: "Serious",
      moderate: "Moderate",
      minor: "Minor",
    }[impact] || "Minor"
  );
}

function getCriteria(tags) {
  const seen = new Set();
  const result = [];
  for (const tag of tags || []) {
    const c = WCAG_CRITERIA_MAP[tag];
    if (c && !seen.has(c.id)) {
      seen.add(c.id);
      result.push(c);
    }
  }
  return result;
}

function getDisabilities(tags) {
  const seen = new Set();
  for (const tag of tags || []) {
    for (const d of TAG_TO_DISABILITIES[tag] || []) seen.add(d);
  }
  if (seen.size === 0) ["Blind", "Low Vision"].forEach((d) => seen.add(d));
  return Array.from(seen);
}

function calculateScore(violations, passes, incomplete) {
  const total = violations.length + passes.length + incomplete.length;
  if (total === 0) return 100;
  const passRate = passes.length / total;
  const penalty = violations.reduce((sum, v) => {
    return (
      sum +
      ({ critical: 1.5, serious: 1.2, moderate: 0.8, minor: 0.4 }[v.impact] ||
        1)
    );
  }, 0);
  return Math.max(0, Math.min(100, Math.round(passRate * 100 - penalty)));
}

function scoreColor(score) {
  if (score >= 90) return "#16A34A";
  if (score >= 75) return "#CA8A04";
  if (score >= 50) return "#EA580C";
  return "#DC2626";
}

function renderGauge(score) {
  const R = 54;
  const cx = 70,
    cy = 70;
  const circ = 2 * Math.PI * R;
  const arcLen = circ * 0.75;
  const gap = circ - arcLen;
  const progress = (score / 100) * arcLen;
  const col = scoreColor(score);

  return `<svg viewBox="0 0 140 120" width="160" height="140" aria-label="Audit score: ${score} out of 100">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#E5E7EB" stroke-width="10"
      stroke-dasharray="${arcLen.toFixed(2)} ${gap.toFixed(2)}" stroke-linecap="round"
      transform="rotate(135 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${col}" stroke-width="10"
      stroke-dasharray="${progress.toFixed(2)} ${(circ - progress).toFixed(2)}" stroke-linecap="round"
      transform="rotate(135 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy + 8}" text-anchor="middle"
      font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
      font-size="28" font-weight="700" fill="${col}">${score}</text>
  </svg>`;
}

function renderDisabilityTags(tags) {
  const disabilities = getDisabilities(tags);
  if (!disabilities.length) return "";
  const visible = disabilities.slice(0, 2);
  const rest = disabilities.length - 2;
  const pills = visible
    .map((d) => `<span class="dtag">${escapeHtml(d)}</span>`)
    .join("");
  const more =
    rest > 0 ? `<span class="dtag dtag-more">+${rest} more</span>` : "";
  return pills + more;
}

function renderCriteriaCell(tags) {
  const criteria = getCriteria(tags);
  const isBestPractice =
    !criteria.length && (tags || []).includes("best-practice");
  const isAoda = (tags || []).includes("aoda");

  if (isBestPractice && isAoda) {
    return `<span class="wcag-tag wcag-bp">Best Practice</span><span class="wcag-tag wcag-aoda">AODA</span>`;
  }
  if (isBestPractice)
    return `<span class="wcag-tag wcag-bp">Best Practice</span>`;
  if (!criteria.length && isAoda)
    return `<span class="wcag-tag wcag-aoda">AODA IASR</span>`;
  if (!criteria.length) return `<span class="wcag-tag wcag-bp">—</span>`;

  const first = criteria[0];
  const rest = criteria.length - 1;
  const versionBadge = `<span class="wcag-ver">${first.ver}</span>`;
  const levelBadge = `<span class="wcag-lvl wcag-lvl-${first.level.toLowerCase()}">${first.level}</span>`;
  const extra = rest > 0 ? `<span class="wcag-more">+${rest}</span>` : "";
  return `<span class="wcag-tag">${levelBadge} ${versionBadge} ${escapeHtml(first.id)} ${escapeHtml(first.title)}</span>${extra}`;
}

function renderElements(nodes) {
  if (!nodes || !nodes.length) return "";
  return nodes
    .map((node, i) => {
      const target = Array.isArray(node.target)
        ? node.target.join(", ")
        : node.target || "";
      const html = node.html || "";
      const fix = node.failureSummary || "";
      return `<div class="elem-row">
      <span class="elem-num">${i + 1}</span>
      <div class="elem-detail">
        ${target ? `<div class="elem-line"><span class="elem-lbl">Selector</span><code>${escapeHtml(target)}</code></div>` : ""}
        ${html ? `<div class="elem-line"><span class="elem-lbl">Element</span><code>${escapeHtml(html)}</code></div>` : ""}
        ${fix ? `<div class="elem-line elem-fix"><span class="elem-lbl">Fix</span>${escapeHtml(fix)}</div>` : ""}
      </div>
    </div>`;
    })
    .join("");
}

// pageIdx scopes all IDs so multiple pages don't collide
function renderIssueRow(item, index, isCustom, rowType, pageIdx) {
  const impact = item.impact || "minor";
  const color = impactColor(impact);
  const bg = impactBg(impact);
  const nodeCount = (item.nodes || []).length;
  const id = `row-${rowType}-${pageIdx}-${index}`;

  const criteriaHtml = renderCriteriaCell(item.tags);
  const disabilityHtml = renderDisabilityTags(item.tags);
  const elemHtml = renderElements(item.nodes);

  const impactIcon =
    rowType === "incomplete"
      ? `<span class="issue-icon icon-manual" title="Needs manual review">?</span>`
      : `<span class="issue-icon" style="background:${color}" title="${impactLabel(impact)}">!</span>`;

  return `
  <div class="issue-row" id="${id}" data-impact="${impact}" data-origin="${isCustom ? "custom" : "builtin"}">
    <div class="issue-summary" onclick="toggleRow('${id}')">
      <span class="col-num">${index}</span>
      <div class="col-issue">
        ${impactIcon}
        <div class="issue-text">
          <div class="issue-title">${escapeHtml(item.help || item.id)}</div>
          <div class="issue-desc">${escapeHtml(item.description || "")}</div>
          <div class="issue-rule"><code>${escapeHtml(item.id)}</code>
            ${isCustom ? '<span class="tag-custom-pill">custom</span>' : ""}
            <span class="impact-pill" style="background:${bg};color:${color};border:1px solid ${color}">${impactLabel(impact)}</span>
          </div>
        </div>
      </div>
      <div class="col-elements">
        ${nodeCount > 0 ? `<span class="elem-badge">${nodeCount} ${nodeCount === 1 ? "element" : "elements"}</span>` : `<span class="elem-badge-na">—</span>`}
      </div>
      <div class="col-disabilities">${disabilityHtml}</div>
      <div class="col-wcag">${criteriaHtml}</div>
      <div class="col-expand">${CHEVRON}</div>
    </div>
    ${elemHtml ? `<div class="issue-detail" id="${id}-detail" hidden>${elemHtml}</div>` : ""}
  </div>`;
}

function renderPassRow(pass, index) {
  const criteriaHtml = renderCriteriaCell(pass.tags);
  const nodeCount = (pass.nodes || []).length;
  return `
  <div class="pass-row">
    <span class="col-num">${index}</span>
    <div class="col-issue">
      <span class="pass-icon">✓</span>
      <div class="issue-text">
        <div class="issue-title">${escapeHtml(pass.help || pass.id)}</div>
        <div class="issue-rule"><code>${escapeHtml(pass.id)}</code></div>
      </div>
    </div>
    <div class="col-elements"><span class="elem-badge-pass">${nodeCount} ${nodeCount === 1 ? "element" : "elements"}</span></div>
    <div class="col-disabilities">${renderDisabilityTags(pass.tags)}</div>
    <div class="col-wcag">${criteriaHtml}</div>
    <div class="col-expand"></div>
  </div>`;
}

function renderNaRow(item, index) {
  const criteriaHtml = renderCriteriaCell(item.tags);
  return `
  <div class="pass-row">
    <span class="col-num">${index}</span>
    <div class="col-issue">
      <span class="na-icon">—</span>
      <div class="issue-text">
        <div class="issue-title">${escapeHtml(item.help || item.id)}</div>
        <div class="issue-rule"><code>${escapeHtml(item.id)}</code></div>
      </div>
    </div>
    <div class="col-elements"><span class="elem-badge-na">N/A</span></div>
    <div class="col-disabilities">${renderDisabilityTags(item.tags)}</div>
    <div class="col-wcag">${criteriaHtml}</div>
    <div class="col-expand"></div>
  </div>`;
}

function renderNetworkRow(req) {
  const sc =
    req.status >= 500
      ? "s5"
      : req.status >= 400
        ? "s4"
        : req.status >= 300
          ? "s3"
          : req.status >= 200
            ? "s2"
            : "s0";
  return `<tr>
    <td class="net-status ${sc}">${req.status || (req.failed ? "ERR" : "—")}</td>
    <td>${escapeHtml(req.method)}</td>
    <td class="net-url" title="${escapeHtml(req.url)}">${escapeHtml(req.url)}</td>
    <td>${escapeHtml(req.resourceType)}</td>
    <td class="num">${req.totalDurationMs != null ? req.totalDurationMs + " ms" : "—"}</td>
    <td class="num">${req.encodedDataLength ? Math.round(req.encodedDataLength / 1024) + " KB" : "—"}</td>
  </tr>`;
}

function renderConsoleRow(e) {
  const cls =
    e.type === "error" || e.type === "pageerror"
      ? "cerr"
      : e.type === "warning"
        ? "cwarn"
        : "";
  return `<tr class="${cls}"><td>${escapeHtml(e.type)}</td><td>${escapeHtml(e.text)}</td></tr>`;
}

// ─── Renders a full section for one crawled page ──────────────────────────────
function renderPageSection(pageData, pageIdx, customIdSet) {
  const violations = (
    (pageData.accessibility && pageData.accessibility.violations) ||
    []
  )
    .slice()
    .sort((a, b) => impactRank(b.impact) - impactRank(a.impact));
  const passes =
    (pageData.accessibility && pageData.accessibility.passes) || [];
  const incomplete =
    (pageData.accessibility && pageData.accessibility.incomplete) || [];
  const inapplicable =
    (pageData.accessibility && pageData.accessibility.inapplicable) || [];

  const networkRequests = (pageData.network && pageData.network.requests) || [];
  const networkSummary = (pageData.network && pageData.network.summary) || {};
  const consoleLogs = pageData.console || [];

  const score = calculateScore(violations, passes, incomplete);
  const col = scoreColor(score);
  const gauge = renderGauge(score);

  const criticalN = violations.filter((v) => v.impact === "critical").length;
  const seriousN = violations.filter((v) => v.impact === "serious").length;
  const moderateN = violations.filter((v) => v.impact === "moderate").length;
  const minorN = violations.filter((v) => v.impact === "minor").length;

  const violationsHtml = violations
    .map((v, i) =>
      renderIssueRow(v, i + 1, customIdSet.has(v.id), "v", pageIdx),
    )
    .join("");
  const passesHtml = passes.map((p, i) => renderPassRow(p, i + 1)).join("");
  const incompleteHtml = incomplete
    .map((m, i) => renderIssueRow(m, i + 1, false, "m", pageIdx))
    .join("");
  const inapplicableHtml = inapplicable
    .map((n, i) => renderNaRow(n, i + 1))
    .join("");

  const networkHtml = networkRequests
    .slice()
    .sort((a, b) => (b.totalDurationMs || 0) - (a.totalDurationMs || 0))
    .map(renderNetworkRow)
    .join("");
  const consoleHtml = consoleLogs.map(renderConsoleRow).join("");
  const consoleErrors = consoleLogs.filter(
    (l) => l.type === "error" || l.type === "pageerror",
  ).length;

  const pi = pageIdx; // shorthand for template literals

  return `
  <details class="page-accordion" id="page-${pi}">
    <summary class="page-acc-summary">
      <span class="page-badge">${pi + 1}</span>
      <a class="page-url-link" href="${escapeHtml(pageData.finalUrl || pageData.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(pageData.finalUrl || pageData.url)}</a>
      ${violations.length > 0 ? `<span class="page-viol-count" style="color:#DC2626">${violations.length} violation${violations.length !== 1 ? "s" : ""}</span>` : `<span class="page-viol-count" style="color:#16A34A">&#10003; No violations</span>`}
      <span class="page-acc-arrow">${CHEVRON}</span>
    </summary>
    <div class="page-acc-body">

    <!-- Summary panels -->
    <div class="panels">
      <div class="panel">
        <div class="panel-title">Audit Score</div>
        <div class="score-inner">
          <div>${gauge}</div>
          <div class="score-text">
            <p style="color:${col};font-weight:700;font-size:1rem">${score < 90 ? "At risk" : "Good"}</p>
            <p>Websites with a score lower than 90 are at risk of accessibility lawsuits.</p>
            <div class="score-breakdown">
              <div class="sb-row"><span class="sb-dot" style="background:#DC2626"></span><span>${criticalN} critical</span></div>
              <div class="sb-row"><span class="sb-dot" style="background:#EA580C"></span><span>${seriousN} serious</span></div>
              <div class="sb-row"><span class="sb-dot" style="background:#CA8A04"></span><span>${moderateN} moderate</span></div>
              <div class="sb-row"><span class="sb-dot" style="background:#94A3B8"></span><span>${minorN} minor</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-hdr">
          <div class="panel-title">Audit Summary</div>
          <a class="wcag-link" href="https://www.w3.org/TR/WCAG22/" target="_blank" rel="noopener">ⓘ What is WCAG?</a>
        </div>
        <div class="criteria-list">
          <div class="criteria-row">
            <div class="criteria-icon ic-crit">!</div>
            <span class="criteria-label">Violations Found</span>
            <span class="criteria-count cc-crit">${violations.length}</span>
          </div>
          <div class="criteria-row">
            <div class="criteria-icon ic-pass">✓</div>
            <span class="criteria-label">Passed Audits</span>
            <span class="criteria-count cc-pass">${passes.length}</span>
          </div>
          <div class="criteria-row">
            <div class="criteria-icon ic-manual">?</div>
            <span class="criteria-label">Required Manual Audits</span>
            <span class="criteria-count cc-manual">${incomplete.length}</span>
          </div>
          <div class="criteria-row">
            <div class="criteria-icon ic-na">—</div>
            <span class="criteria-label">Not Applicable</span>
            <span class="criteria-count cc-na">${inapplicable.length}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button class="tab-btn active" data-tab="violations" data-pi="${pi}">
        <span class="tc tc-crit">!</span> Violations <span class="tc tc-crit">${violations.length}</span>
      </button>
      <button class="tab-btn" data-tab="passes" data-pi="${pi}">
        <span class="tc tc-pass">✓</span> Passed Audits <span class="tc tc-pass">${passes.length}</span>
      </button>
      <button class="tab-btn" data-tab="incomplete" data-pi="${pi}">
        <span class="tc tc-manual">?</span> Required Manual Audits <span class="tc tc-manual">${incomplete.length}</span>
      </button>
      <button class="tab-btn" data-tab="inapplicable" data-pi="${pi}">
        <span class="tc tc-na">—</span> Not Applicable <span class="tc tc-na">${inapplicable.length}</span>
      </button>
    </div>

    <!-- Violations tab -->
    <div class="tab-pane active" data-pi="${pi}" id="pane-violations-${pi}">
      <div class="filter-bar">
        <span style="font-size:.78rem;color:var(--muted);margin-right:.25rem">Filter:</span>
        <button class="filter-btn active" data-impact="all" data-pi="${pi}">All (${violations.length})</button>
        ${criticalN ? `<button class="filter-btn" data-impact="critical" data-pi="${pi}">Critical (${criticalN})</button>` : ""}
        ${seriousN ? `<button class="filter-btn" data-impact="serious"  data-pi="${pi}">Serious (${seriousN})</button>` : ""}
        ${moderateN ? `<button class="filter-btn" data-impact="moderate" data-pi="${pi}">Moderate (${moderateN})</button>` : ""}
        ${minorN ? `<button class="filter-btn" data-impact="minor"    data-pi="${pi}">Minor (${minorN})</button>` : ""}
      </div>
      ${
        violations.length
          ? `
      <div class="tbl-hdr">
        <span>#</span><span>Issue</span><span>Failing Elements</span><span>Disabilities Affected</span><span>WCAG Success Criteria</span><span></span>
      </div>
      <div id="violations-list-${pi}">${violationsHtml}</div>
      `
          : '<div class="empty">No violations found — great job!</div>'
      }
    </div>

    <!-- Passes tab -->
    <div class="tab-pane" data-pi="${pi}" id="pane-passes-${pi}">
      ${
        passes.length
          ? `
      <div class="tbl-hdr" style="margin-top:.75rem">
        <span>#</span><span>Rule</span><span>Elements Checked</span><span>Disabilities Covered</span><span>WCAG Success Criteria</span><span></span>
      </div>
      ${passesHtml}
      `
          : '<div class="empty">No passed audits recorded.</div>'
      }
    </div>

    <!-- Manual audits tab -->
    <div class="tab-pane" data-pi="${pi}" id="pane-incomplete-${pi}">
      ${
        incomplete.length
          ? `
      <div style="padding:.75rem 0;font-size:.82rem;color:var(--muted)">
        These checks could not be fully automated. A human reviewer should verify each item.
      </div>
      <div class="tbl-hdr">
        <span>#</span><span>Item</span><span>Elements</span><span>Disabilities Affected</span><span>WCAG Success Criteria</span><span></span>
      </div>
      ${incompleteHtml}
      `
          : '<div class="empty">No manual audits required.</div>'
      }
    </div>

    <!-- Not applicable tab -->
    <div class="tab-pane" data-pi="${pi}" id="pane-inapplicable-${pi}">
      ${
        inapplicable.length
          ? `
      <div class="tbl-hdr" style="margin-top:.75rem">
        <span>#</span><span>Rule</span><span></span><span>Disabilities</span><span>WCAG Criterion</span><span></span>
      </div>
      ${inapplicableHtml}
      `
          : '<div class="empty">No inapplicable rules.</div>'
      }
    </div>

    <!-- Network accordion -->
    <details class="accordion">
      <summary>
        🌐 Network &mdash; ${networkRequests.length} requests
        &nbsp;<span style="font-size:.78rem;color:var(--muted);font-weight:400">${networkSummary.totalTransferredKB || 0} KB transferred &bull; ${networkSummary.failedRequests || 0} failed</span>
        <span class="acc-arrow">${CHEVRON}</span>
      </summary>
      <div class="accordion-body">
        <div class="net-grid">
          <div class="net-box"><div class="nb-num">${networkRequests.length}</div><div class="nb-lbl">Requests</div></div>
          <div class="net-box"><div class="nb-num" style="color:${(networkSummary.failedRequests || 0) > 0 ? "#DC2626" : "inherit"}">${networkSummary.failedRequests || 0}</div><div class="nb-lbl">Failed</div></div>
          <div class="net-box"><div class="nb-num">${networkSummary.totalTransferredKB || 0} KB</div><div class="nb-lbl">Transferred</div></div>
          <div class="net-box"><div class="nb-num">${networkSummary.slowestRequest ? networkSummary.slowestRequest.totalDurationMs + " ms" : "—"}</div><div class="nb-lbl">Slowest</div></div>
        </div>
        ${
          networkRequests.length
            ? `
        <table>
          <thead><tr><th>Status</th><th>Method</th><th>URL</th><th>Type</th><th>Time</th><th>Size</th></tr></thead>
          <tbody>${networkHtml}</tbody>
        </table>`
            : '<p style="color:var(--muted);font-size:.85rem">No network requests captured.</p>'
        }
      </div>
    </details>

    <!-- Console accordion -->
    <details class="accordion">
      <summary>
        🖥 Console &mdash; ${consoleLogs.length} entries
        ${consoleErrors > 0 ? `&nbsp;<span style="color:#DC2626;font-size:.78rem;font-weight:600">${consoleErrors} error${consoleErrors > 1 ? "s" : ""}</span>` : ""}
        <span class="acc-arrow">${CHEVRON}</span>
      </summary>
      <div class="accordion-body">
        ${
          consoleLogs.length
            ? `
        <table>
          <thead><tr><th>Type</th><th>Message</th></tr></thead>
          <tbody>${consoleHtml}</tbody>
        </table>`
            : '<p style="color:var(--muted);font-size:.85rem">No console output captured.</p>'
        }
      </div>
    </details>

    </div><!-- /page-acc-body -->
  </details>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────
function buildHtmlReport(report, customRuleIds) {
  const customIdSet = new Set(customRuleIds || []);
  const pages = report.pages || [];

  const auditDate = new Date(report.timestamp || Date.now()).toLocaleString();
  let domain = report.requestedUrl || "";
  try {
    domain = new URL(report.requestedUrl).hostname;
  } catch {}

  // Aggregate totals
  const totalViolations = pages.reduce(
    (s, p) =>
      s + ((p.accessibility && p.accessibility.violations) || []).length,
    0,
  );
  const totalPasses = pages.reduce(
    (s, p) => s + ((p.accessibility && p.accessibility.passes) || []).length,
    0,
  );
  const totalCritical = pages.reduce(
    (s, p) =>
      s +
      ((p.accessibility && p.accessibility.violations) || []).filter(
        (v) => v.impact === "critical",
      ).length,
    0,
  );
  const totalSerious = pages.reduce(
    (s, p) =>
      s +
      ((p.accessibility && p.accessibility.violations) || []).filter(
        (v) => v.impact === "serious",
      ).length,
    0,
  );
  const totalModerate = pages.reduce(
    (s, p) =>
      s +
      ((p.accessibility && p.accessibility.violations) || []).filter(
        (v) => v.impact === "moderate",
      ).length,
    0,
  );
  const totalMinor = pages.reduce(
    (s, p) =>
      s +
      ((p.accessibility && p.accessibility.violations) || []).filter(
        (v) => v.impact === "minor",
      ).length,
    0,
  );

  // AODA Ontario compliance status
  const aodaStatus =
    totalCritical > 0 || totalSerious > 0
      ? { label: "Non-compliant", color: "#DC2626", desc: "Critical and/or serious violations must be remediated to satisfy Ontario&rsquo;s IASR requirements." }
      : totalModerate > 0 || totalMinor > 0
        ? { label: "Partially compliant", color: "#CA8A04", desc: "Minor or moderate issues were found; full remediation is recommended." }
        : { label: "Compliant", color: "#16A34A", desc: "No violations detected &mdash; the site meets WCAG 2.0 Level AA." };

  const violBreakdownParts = [
    totalCritical > 0  ? `<span style="color:#DC2626;font-weight:700">${totalCritical} critical</span>`  : "",
    totalSerious  > 0  ? `<span style="color:#EA580C;font-weight:700">${totalSerious} serious</span>`    : "",
    totalModerate > 0  ? `<span style="color:#CA8A04;font-weight:700">${totalModerate} moderate</span>`  : "",
    totalMinor    > 0  ? `<span style="color:#64748B;font-weight:700">${totalMinor} minor</span>`        : "",
  ].filter(Boolean);

  const summaryHtml = `<div class="summary-text">
  <div class="summary-heading">Accessibility Report Summary</div>
  <p class="summary-intro">A plain-language overview of this scan &mdash; what was tested, what was found, and what it means for AODA / Ontario IASR compliance.</p>
  <ul class="summary-list">
    <li><strong>Site audited:</strong> ${escapeHtml(domain)} &mdash; <strong>${pages.length}</strong> page${pages.length !== 1 ? "s" : ""} crawled on ${escapeHtml(auditDate)}</li>
    <li><strong>Accessibility violations found:</strong> <span style="color:${totalViolations > 0 ? "#DC2626" : "#16A34A"};font-weight:700">${totalViolations}</span>${violBreakdownParts.length ? " &mdash; " + violBreakdownParts.join(", ") : " &mdash; none detected"}</li>
    <li><strong>Checks passed:</strong> <span style="color:#16A34A;font-weight:700">${totalPasses}</span> rules confirmed compliant across all crawled pages</li>
    <li><strong>Standards evaluated:</strong> WCAG 2.0, 2.1 &amp; 2.2 (Levels A, AA &amp; AAA) plus AODA IASR &mdash; <em>WCAG 2.0 Level AA is the minimum mandated under Ontario&rsquo;s Integrated Accessibility Standards Regulation</em></li>
    <li><strong>AODA IASR status:</strong> <span style="color:${aodaStatus.color};font-weight:700">${aodaStatus.label}</span> &mdash; ${aodaStatus.desc}</li>
    <li class="summary-legal">Under the <strong>Accessibility for Ontarians with Disabilities Act (AODA), 2005</strong> and the <strong>Integrated Accessibility Standards Regulation (IASR)</strong>, Ontario public-sector bodies and private-sector organizations with 50&plus; employees must conform to WCAG 2.0 Level AA. Non-compliance may result in AODA enforcement action, fines, and legal exposure to accessibility complaints.</li>
  </ul>
</div>`;

  // Pages nav — violations found per page, broken down by severity
  const pagesNavHtml = pages
    .map((p, i) => {
      const pageViolations =
        (p.accessibility && p.accessibility.violations) || [];
      const vCount = pageViolations.length;
      const c = pageViolations.filter((v) => v.impact === "critical").length;
      const s = pageViolations.filter((v) => v.impact === "serious").length;
      const m = pageViolations.filter((v) => v.impact === "moderate").length;
      const mi = pageViolations.filter((v) => v.impact === "minor").length;
      const chips = [
        c ? `<span class="pnav-chip pnav-chip-critical">${c} critical</span>` : "",
        s ? `<span class="pnav-chip pnav-chip-serious">${s} serious</span>` : "",
        m ? `<span class="pnav-chip pnav-chip-moderate">${m} moderate</span>` : "",
        mi ? `<span class="pnav-chip pnav-chip-minor">${mi} minor</span>` : "",
      ]
        .filter(Boolean)
        .join("");
      return `<a class="pnav-item" href="#page-${i}" onclick="document.getElementById('page-${i}').open=true">
      <span class="pnav-num">${i + 1}</span>
      <span class="pnav-url">${escapeHtml(p.finalUrl || p.url)}</span>
      <span class="pnav-chips">${chips || '<span class="pnav-chip pnav-chip-clean">&#10003; No violations</span>'}</span>
      <span class="pnav-badge" style="color:${vCount > 0 ? "#DC2626" : "#16A34A"}">${vCount > 0 ? vCount + " total" : "clean"}</span>
    </a>`;
    })
    .join("");

  const pageSectionsHtml = pages
    .map((p, i) => renderPageSection(p, i, customIdSet))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Accessibility Audit — ${escapeHtml(domain)}</title>
<link rel="icon" type="image/webp" href="${FAVICON_DATA_URI}"/>
<style>
:root{
  --bg:#F5F5F5;--surface:#FFFFFF;--border:#E2E4E8;--text:#0D0D0D;--muted:#6B7280;
  --green:#16A34A;--red:#DC2626;--orange:#EA580C;--amber:#CA8A04;--blue:#2563EB;
  --brand:#F5B000;--brand-dark:#111111;--brand-hover:#E0A000;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  --mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--sans);background:var(--bg);color:var(--text);line-height:1.5;-webkit-font-smoothing:antialiased;overflow-y: scroll}

/* ── Site header ── */
.site-hdr{background:var(--brand-dark);border-bottom:3px solid var(--brand)}
.site-hdr-inner{max-width:1440px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:.85rem 1.5rem}
.logo-box{display:flex;align-items:center}
.logo-box img,.logo-box svg,.site-hdr-inner>div:first-child>svg,.site-hdr-inner>div:first-child>img{max-height:36px;height:auto;width:auto;display:block}
.site-info-right{text-align:right}
.site-domain{font-size:1.05rem;font-weight:700;color:#FFFFFF}
.site-meta{font-size:.75rem;color:#9CA3AF;margin-top:.15rem}

/* ── Layout ── */
.container{max-width:1440px;margin:0 auto;padding:1.75rem 1.5rem}

/* ── Top stats + pages nav (stacked full-width rows) ── */
.top-grid{display:flex;flex-direction:column;gap:1.25rem;margin-bottom:1.25rem}

/* ── Overall summary bar ── */
.overall-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:.85rem 1rem;background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--brand);border-radius:10px;padding:1.1rem 1.25rem;align-content:start}
.ostat .num{font-size:1.4rem;font-weight:700;line-height:1.1}
.ostat .lbl{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:.2rem}
.ostat-divider{display:none}

/* ── Pages nav ── */
.pnav{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem 1.25rem}
.pnav-title{font-size:1.05rem;font-weight:700;letter-spacing:-.01em;color:var(--brand-dark);margin-bottom:.3rem}
.pnav-sub{font-size:.78rem;color:var(--muted);margin-bottom:.85rem}
.pnav-list{display:flex;flex-direction:column;gap:.3rem}
.pnav-item{display:flex;align-items:center;gap:.75rem;padding:.5rem .6rem;border-radius:6px;text-decoration:none;color:var(--text);font-size:.82rem;transition:background .12s;flex-wrap:wrap}
.pnav-item:hover{background:#FFF8E6}
.pnav-num{display:inline-flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;background:var(--brand-dark);color:var(--brand);border-radius:50%;font-size:.68rem;font-weight:700;flex-shrink:0}
.pnav-url{flex:1;min-width:10rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.pnav-chips{display:flex;align-items:center;gap:.3rem;flex-wrap:wrap}
.pnav-chip{font-size:.68rem;font-weight:600;border-radius:999px;padding:.15rem .5rem;border:1px solid;white-space:nowrap}
.pnav-chip-critical{color:#DC2626;background:#FEF2F2;border-color:#FECACA}
.pnav-chip-serious{color:#EA580C;background:#FFF7ED;border-color:#FED7AA}
.pnav-chip-moderate{color:#CA8A04;background:#FEFCE8;border-color:#FDE68A}
.pnav-chip-minor{color:#64748B;background:#F8FAFC;border-color:#CBD5E1}
.pnav-chip-clean{color:#16A34A;background:#F0FDF4;border-color:#BBF7D0}
.pnav-badge{font-size:.75rem;font-weight:700;white-space:nowrap;margin-left:auto}

/* ── Textual summary ── */
.summary-text{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--brand);border-radius:10px;padding:1rem 1.5rem;margin-bottom:1.25rem}
.summary-heading{font-size:1.05rem;font-weight:700;letter-spacing:-.01em;color:var(--brand-dark);margin-bottom:.35rem}
.summary-intro{font-size:.82rem;color:var(--muted);line-height:1.5;margin-bottom:.75rem;padding-bottom:.65rem;border-bottom:1px solid var(--border)}
.summary-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.35rem}
.summary-list li{position:relative;padding-left:1.1rem;font-size:.85rem;line-height:1.55;color:var(--text)}
.summary-list li::before{content:'•';position:absolute;left:0;color:var(--brand);font-weight:700;font-size:1rem;line-height:1.35}
.summary-list li strong{color:var(--brand-dark)}
.summary-list li.summary-legal{margin-top:.3rem;padding-top:.5rem;border-top:1px dashed var(--border);font-size:.8rem;color:var(--muted);padding-left:1.1rem}
.summary-list li.summary-legal::before{color:#9CA3AF}

/* ── Section heading (detailed findings) ── */
.section-heading-block{margin:1.75rem 0 1rem;padding-top:.25rem}
.section-heading{font-size:1.15rem;font-weight:700;letter-spacing:-.01em;color:var(--brand-dark)}
.section-sub{font-size:.83rem;color:var(--muted);margin-top:.3rem;line-height:1.5;max-width:60rem}

/* ── Page accordion ── */
.page-accordion{background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:.75rem;overflow:hidden}
.page-acc-summary{display:flex;align-items:center;gap:.85rem;padding:1rem 1.25rem;cursor:pointer;list-style:none;user-select:none;flex-wrap:wrap;transition:background .15s}
.page-acc-summary:hover{background:#FFFBF0}
.page-acc-summary::-webkit-details-marker{display:none}
.page-accordion[open]>.page-acc-summary{background:#FFFBF0;border-bottom:2px solid var(--brand)}
.page-acc-arrow{margin-left:auto;line-height:0;flex-shrink:0}
.page-acc-arrow .expand-arrow{transition:transform .25s ease}
.page-accordion[open] .page-acc-arrow .expand-arrow{transform:rotate(180deg);color:var(--brand)}
.page-acc-body{padding:1.25rem;border-top:none;animation:accOpen .25s ease}
@keyframes accOpen{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
.page-badge{display:inline-flex;align-items:center;justify-content:center;width:1.85rem;height:1.85rem;background:var(--brand-dark);color:var(--brand);border-radius:50%;font-size:.78rem;font-weight:700;flex-shrink:0}
.page-url-link{font-size:.9rem;font-weight:600;color:var(--text);text-decoration:none;word-break:break-all}
.page-url-link:hover{color:var(--brand-dark);text-decoration:underline}
.page-viol-count{font-size:.8rem;font-weight:600;white-space:nowrap}

/* ── Summary panels ── */
.panels{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.5rem}
@media(max-width:700px){.panels{grid-template-columns:1fr}}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.5rem}
.panel-title{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:1rem}
.score-inner{display:flex;align-items:center;gap:1.5rem}
.score-text{flex:1;min-width:0}
.score-text p{font-size:.8rem;color:var(--muted);line-height:1.4;margin-top:.5rem}
.score-breakdown{display:flex;flex-direction:column;gap:.3rem;margin-top:.75rem;font-size:.8rem}
.sb-row{display:flex;align-items:center;gap:.5rem}
.sb-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.panel-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem}
.panel-hdr .panel-title{margin-bottom:0}
.wcag-link{font-size:.75rem;color:var(--blue);text-decoration:none}
.criteria-list{display:flex;flex-direction:column;gap:.5rem}
.criteria-row{display:flex;align-items:center;gap:.75rem;padding:.5rem .75rem;border-radius:8px;background:var(--bg);border:1px solid var(--border)}
.criteria-icon{width:1.5rem;height:1.5rem;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;flex-shrink:0}
.ic-crit{background:#FEF2F2;color:#DC2626;border:1.5px solid #FECACA}
.ic-pass{background:#F0FDF4;color:#16A34A;border:1.5px solid #BBF7D0}
.ic-manual{background:#EFF6FF;color:#2563EB;border:1.5px solid #BFDBFE}
.ic-na{background:#F9FAFB;color:#6B7280;border:1.5px solid #E5E7EB}
.criteria-label{flex:1;font-size:.85rem;font-weight:500}
.criteria-count{font-size:.95rem;font-weight:700;min-width:2.5rem;text-align:right}
.criteria-count.cc-crit{color:#DC2626}
.criteria-count.cc-pass{color:#16A34A}
.criteria-count.cc-manual{color:#2563EB}
.criteria-count.cc-na{color:#6B7280}

/* ── Tabs ── */
.tabs{display:flex;gap:.25rem;border-bottom:2px solid var(--border);margin-bottom:0;flex-wrap:wrap}
.tab-btn{font:inherit;font-size:.83rem;padding:.65rem 1.1rem;background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;cursor:pointer;color:var(--muted);font-weight:500;display:flex;align-items:center;gap:.4rem;white-space:nowrap}
.tab-btn:hover{color:var(--text)}
.tab-btn.active{color:var(--brand-dark);border-bottom-color:var(--brand);font-weight:700}
.tab-btn .tc{display:inline-flex;align-items:center;justify-content:center;min-width:1.5rem;height:1.4rem;border-radius:999px;font-size:.72rem;font-weight:700;padding:0 .35rem}
.tc-crit{background:#FEF2F2;color:#DC2626}
.tc-pass{background:#F0FDF4;color:#16A34A}
.tc-manual{background:#EFF6FF;color:#2563EB}
.tc-na{background:#F9FAFB;color:#9CA3AF;border:1px solid #E5E7EB}

/* ── Filter row ── */
.filter-bar{display:flex;align-items:center;gap:.5rem;padding:.75rem 0;flex-wrap:wrap}
.filter-btn{font:inherit;font-size:.76rem;padding:.25rem .7rem;border:1px solid var(--border);border-radius:999px;background:var(--surface);cursor:pointer;color:var(--text);transition:background .12s,color .12s,border-color .12s}
/* inactive per-impact color */
.filter-btn[data-impact="critical"] {color:#DC2626;border-color:#FECACA}
.filter-btn[data-impact="serious"]  {color:#EA580C;border-color:#FED7AA}
.filter-btn[data-impact="moderate"] {color:#CA8A04;border-color:#FDE68A}
.filter-btn[data-impact="minor"]    {color:#64748B;border-color:#CBD5E1}
/* active state — overrides inactive */
.filter-btn.active[data-impact="all"]      {background:var(--brand-dark);color:var(--brand);border-color:var(--brand-dark)}
.filter-btn.active[data-impact="critical"] {background:#DC2626;color:#fff;border-color:#DC2626}
.filter-btn.active[data-impact="serious"]  {background:#EA580C;color:#fff;border-color:#EA580C}
.filter-btn.active[data-impact="moderate"] {background:#CA8A04;color:#fff;border-color:#CA8A04}
.filter-btn.active[data-impact="minor"]    {background:#64748B;color:#fff;border-color:#64748B}

/* ── Table header ── */
.tbl-hdr{display:grid;grid-template-columns:2.5rem 1fr 11rem 15rem 17rem 2.5rem;gap:0;background:var(--bg);border:1px solid var(--border);border-bottom:none;padding:.5rem .75rem;border-radius:8px 8px 0 0;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
@media(max-width:900px){.tbl-hdr{display:none}}

/* ── Issue rows ── */
.issue-row{background:var(--surface);border:1px solid var(--border);border-top:none;transition:box-shadow .15s}
.issue-row:last-child{border-radius:0 0 8px 8px}
.issue-row:hover{box-shadow:0 1px 6px rgba(0,0,0,.07)}
.issue-summary{display:grid;grid-template-columns:2.5rem 1fr 11rem 15rem 17rem 2.5rem;gap:0;padding:.85rem .75rem;cursor:pointer;align-items:start}
@media(max-width:900px){
  .issue-summary{grid-template-columns:2.5rem 1fr;grid-template-rows:auto auto auto}
  .col-elements,.col-disabilities,.col-wcag,.col-expand{grid-column:2;padding:.2rem 0}
}
.col-num{font-size:.8rem;color:var(--muted);padding-top:.1rem;font-weight:600}
.col-issue{display:flex;gap:.65rem;align-items:flex-start}
.col-elements,.col-disabilities,.col-wcag{padding-top:.05rem}
.col-expand{display:flex;align-items:flex-start;justify-content:center;padding-top:.25rem}
.issue-icon{width:1.3rem;height:1.3rem;border-radius:50%;color:#fff;font-size:.7rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:.1rem}
.icon-manual{background:#2563EB}
.issue-text{min-width:0}
.issue-title{font-size:.88rem;font-weight:500;line-height:1.35}
.issue-desc{font-size:.78rem;color:var(--muted);margin-top:.2rem;line-height:1.4}
.issue-rule{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-top:.35rem}
.issue-rule code{font-family:var(--mono);font-size:.72rem;background:#F3F4F6;padding:.1rem .3rem;border-radius:4px;color:var(--muted)}
.tag-custom-pill{font-size:.66rem;background:#EEF2FF;color:#4338CA;border:1px solid #C7D2FE;border-radius:999px;padding:.1rem .4rem;text-transform:uppercase;letter-spacing:.03em}
.impact-pill{font-size:.68rem;border-radius:999px;padding:.1rem .45rem;font-weight:600}
.elem-badge{display:inline-block;font-size:.78rem;font-weight:600;background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;border-radius:6px;padding:.2rem .6rem}
.elem-badge-pass{display:inline-block;font-size:.78rem;font-weight:600;background:#D1FAE5;color:#065F46;border:1px solid #A7F3D0;border-radius:6px;padding:.2rem .6rem}
.elem-badge-na{font-size:.78rem;color:var(--muted)}
.dtag{display:inline-block;font-size:.72rem;background:#F3F4F6;color:#374151;border:1px solid #E5E7EB;border-radius:999px;padding:.15rem .55rem;margin:.1rem .1rem .1rem 0}
.dtag-more{color:var(--muted)}
.wcag-tag{display:inline-flex;align-items:center;gap:.3rem;flex-wrap:wrap;font-size:.75rem;color:var(--text)}
.wcag-lvl{font-size:.65rem;font-weight:700;border-radius:4px;padding:.1rem .3rem}
.wcag-lvl-a{background:#DBEAFE;color:#1D4ED8}
.wcag-lvl-aa{background:#E0E7FF;color:#4338CA}
.wcag-lvl-aaa{background:#EDE9FE;color:#6D28D9}
.wcag-ver{font-size:.65rem;color:var(--muted);background:#F3F4F6;border-radius:3px;padding:.05rem .25rem}
.wcag-more{font-size:.7rem;color:var(--blue);cursor:pointer;margin-left:.2rem}
.wcag-bp{font-size:.75rem;color:#92400E;background:#FEF3C7;border:1px solid #FDE68A;border-radius:6px;padding:.15rem .5rem}
.wcag-aoda{font-size:.75rem;color:#065F46;background:#D1FAE5;border:1px solid #6EE7B7;border-radius:6px;padding:.15rem .5rem;margin-left:.25rem;font-weight:600}

/* ── Expand/collapse chevron ── */
.expand-arrow{color:#9CA3AF;transition:transform .2s ease;flex-shrink:0;display:block}
.issue-row.open .expand-arrow{transform:rotate(180deg);color:var(--brand)}

/* ── Expanded element detail ── */
.issue-detail{padding:.5rem .75rem 1rem;border-top:1px dashed var(--border);background:#FAFAFA}
.elem-row{display:flex;gap:.6rem;padding:.55rem 0;border-top:1px dashed #F3F4F6}
.elem-row:first-child{border-top:none}
.elem-num{width:1.4rem;height:1.4rem;border-radius:50%;background:#F3F4F6;color:var(--muted);font-size:.68rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:.1rem}
.elem-detail{flex:1;min-width:0}
.elem-line{font-size:.78rem;margin-bottom:.3rem;word-break:break-word}
.elem-line code{font-family:var(--mono);background:#F3F4F6;padding:.1rem .3rem;border-radius:4px;font-size:.75rem;display:inline;word-break:break-all}
.elem-lbl{display:inline-block;font-size:.65rem;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;min-width:4.5rem;margin-right:.35rem}
.elem-fix{color:#92400E}
.elem-fix .elem-lbl{color:#92400E}

/* ── Pass rows ── */
.pass-row{display:grid;grid-template-columns:2.5rem 1fr 11rem 15rem 17rem 2.5rem;gap:0;padding:.75rem .75rem;background:var(--surface);border:1px solid var(--border);border-top:none;align-items:start}
.pass-row:last-child{border-radius:0 0 8px 8px}
.pass-icon{color:var(--green);font-size:1rem;font-weight:700;margin-top:.05rem;flex-shrink:0}
.na-icon{color:var(--muted);font-size:.9rem;margin-top:.1rem}

/* ── Empty state ── */
.empty{padding:2rem;text-align:center;color:var(--muted);font-size:.85rem;background:var(--surface);border:1px solid var(--border);border-radius:0 0 8px 8px}

/* ── Tab panes ── */
.tab-pane{display:none}
.tab-pane.active{display:block}

/* ── Network & Console accordion ── */
.accordion{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:1rem}
.accordion summary{display:flex;align-items:center;gap:.5rem;padding:.9rem 1.25rem;cursor:pointer;font-weight:600;font-size:.88rem;list-style:none;user-select:none}
.accordion summary::-webkit-details-marker{display:none}
.accordion summary .acc-arrow{margin-left:auto;line-height:0}
.accordion summary .acc-arrow .expand-arrow{transition:transform .2s ease}
.accordion[open] summary .acc-arrow .expand-arrow{transform:rotate(180deg);color:var(--brand)}
.accordion-body{padding:1rem 1.25rem;border-top:1px solid var(--border)}

/* ── Net summary grid ── */
.net-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.75rem;margin-bottom:1rem}
.net-box{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.75rem}
.net-box .nb-num{font-size:1.2rem;font-weight:700}
.net-box .nb-lbl{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-top:.1rem}

/* ── Tables ── */
table{width:100%;border-collapse:collapse;font-size:.8rem}
th,td{text-align:left;padding:.45rem .7rem;border-bottom:1px solid var(--border)}
th{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);background:var(--bg)}
tr:last-child td{border-bottom:none}
td.num{text-align:right;font-family:var(--mono)}
.net-url{max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:.72rem}
.net-status{font-weight:700;font-family:var(--mono)}
.s2{color:var(--green)} .s3{color:#64748B} .s4,.s5{color:var(--orange)} .s0{color:var(--muted)}
.cerr td:first-child{color:var(--red);font-weight:600}
.cwarn td:first-child{color:var(--amber);font-weight:600}

@media(max-width:640px){
  .container{padding:1rem}
  .site-hdr-inner{padding:.75rem 1rem}
  .tbl-hdr,.col-disabilities,.col-wcag,.col-expand{display:none}
  .issue-summary,.pass-row{grid-template-columns:2.5rem 1fr}
  .page-acc-body{padding:.85rem}
}
</style>
</head>
<body>

<!-- SITE HEADER -->
<div class="site-hdr">
  <div class="site-hdr-inner">
    <div><?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="165" height="26" viewBox="0 0 165 26" fill="none">
  <path d="M30.72 7.34256L24.32 25H19.3969L15.4256 14.0379L11.3231 25H6.4L0.0328205 7.34256H4.85744L9.02564 19.2892L13.3579 7.34256H17.6903L21.8913 19.2892L26.1908 7.34256H30.72ZM49.9159 16.2369C49.9159 16.3026 49.8831 16.7621 49.8174 17.6154H36.4595C36.7002 18.7094 37.2691 19.5737 38.1662 20.2082C39.0632 20.8427 40.1791 21.16 41.5138 21.16C42.4328 21.16 43.2424 21.0287 43.9426 20.7662C44.6646 20.4817 45.332 20.0441 45.9446 19.4533L48.6687 22.4072C47.0058 24.3108 44.5771 25.2626 41.3826 25.2626C39.3915 25.2626 37.6301 24.8797 36.0985 24.1138C34.5668 23.3262 33.3853 22.2431 32.5538 20.8646C31.7224 19.4862 31.3067 17.9217 31.3067 16.1713C31.3067 14.4427 31.7115 12.8892 32.521 11.5108C33.3525 10.1104 34.4793 9.02735 35.9015 8.26154C37.3456 7.47385 38.9538 7.08 40.7262 7.08C42.4547 7.08 44.0191 7.45197 45.4195 8.1959C46.8198 8.93983 47.9138 10.012 48.7015 11.4123C49.5111 12.7908 49.9159 14.399 49.9159 16.2369ZM40.759 10.9528C39.5993 10.9528 38.6256 11.281 37.8379 11.9374C37.0503 12.5938 36.5689 13.4909 36.3938 14.6287H45.0913C44.9162 13.5128 44.4349 12.6267 43.6472 11.9703C42.8595 11.292 41.8968 10.9528 40.759 10.9528ZM63.7615 7.08C65.4026 7.08 66.8904 7.46291 68.2251 8.22872C69.5817 8.97265 70.6429 10.0338 71.4087 11.4123C72.1745 12.7689 72.5574 14.3552 72.5574 16.1713C72.5574 17.9874 72.1745 19.5846 71.4087 20.9631C70.6429 22.3197 69.5817 23.3809 68.2251 24.1467C66.8904 24.8906 65.4026 25.2626 63.7615 25.2626C61.3328 25.2626 59.4839 24.4968 58.2149 22.9651V25H53.3246V0.64718H58.4446V9.21333C59.7356 7.79111 61.5079 7.08 63.7615 7.08ZM62.8754 21.0615C64.1882 21.0615 65.2603 20.6239 66.0918 19.7487C66.9451 18.8516 67.3718 17.6591 67.3718 16.1713C67.3718 14.6834 66.9451 13.5019 66.0918 12.6267C65.2603 11.7296 64.1882 11.281 62.8754 11.281C61.5626 11.281 60.4795 11.7296 59.6262 12.6267C58.7947 13.5019 58.379 14.6834 58.379 16.1713C58.379 17.6591 58.7947 18.8516 59.6262 19.7487C60.4795 20.6239 61.5626 21.0615 62.8754 21.0615ZM93.0303 7.34256L85.58 25H80.2959L72.8785 7.34256H78.1626L83.0528 19.3549L88.1072 7.34256H93.0303ZM103.041 25.2626C101.181 25.2626 99.5071 24.8797 98.0192 24.1138C96.5532 23.3262 95.4045 22.2431 94.5731 20.8646C93.7416 19.4862 93.3259 17.9217 93.3259 16.1713C93.3259 14.4209 93.7416 12.8564 94.5731 11.4779C95.4045 10.0995 96.5532 9.02735 98.0192 8.26154C99.5071 7.47385 101.181 7.08 103.041 7.08C104.901 7.08 106.563 7.47385 108.029 8.26154C109.495 9.02735 110.644 10.0995 111.476 11.4779C112.307 12.8564 112.723 14.4209 112.723 16.1713C112.723 17.9217 112.307 19.4862 111.476 20.8646C110.644 22.2431 109.495 23.3262 108.029 24.1138C106.563 24.8797 104.901 25.2626 103.041 25.2626ZM103.041 21.0615C104.354 21.0615 105.426 20.6239 106.257 19.7487C107.111 18.8516 107.537 17.6591 107.537 16.1713C107.537 14.6834 107.111 13.5019 106.257 12.6267C105.426 11.7296 104.354 11.281 103.041 11.281C101.728 11.281 100.645 11.7296 99.7915 12.6267C98.9382 13.5019 98.5115 14.6834 98.5115 16.1713C98.5115 17.6591 98.9382 18.8516 99.7915 19.7487C100.645 20.6239 101.728 21.0615 103.041 21.0615ZM116.145 0.64718H121.265V25H116.145V0.64718ZM138.688 24.1467C138.184 24.5186 137.561 24.8031 136.817 25C136.095 25.175 135.329 25.2626 134.519 25.2626C132.419 25.2626 130.789 24.7265 129.629 23.6544C128.491 22.5822 127.923 21.0068 127.923 18.9282V11.6749H125.198V7.73641H127.923V3.43692H133.043V7.73641H137.441V11.6749H133.043V18.8626C133.043 19.6065 133.229 20.1863 133.601 20.6021C133.994 20.9959 134.541 21.1928 135.242 21.1928C136.051 21.1928 136.74 20.974 137.309 20.5364L138.688 24.1467ZM156.101 21.0615V25H140.347V21.9149L149.34 11.281H140.577V7.34256H155.806V10.4277L146.813 21.0615H156.101Z" fill="#FFFFFF"></path>
  <path d="M161.511 25.2626C160.614 25.2626 159.859 24.9562 159.246 24.3436C158.634 23.7309 158.327 22.9651 158.327 22.0462C158.327 21.1053 158.634 20.3504 159.246 19.7815C159.859 19.1908 160.614 18.8954 161.511 18.8954C162.408 18.8954 163.163 19.1908 163.776 19.7815C164.388 20.3504 164.695 21.1053 164.695 22.0462C164.695 22.9651 164.388 23.7309 163.776 24.3436C163.163 24.9562 162.408 25.2626 161.511 25.2626Z" fill="#FFC107"></path>
</svg></div>
    <div class="site-info-right">
      <div class="site-domain">${escapeHtml(domain)}</div>
      <div class="site-meta">Scanned ${escapeHtml(auditDate)} &bull; ${pages.length} page${pages.length !== 1 ? "s" : ""} crawled</div>
    </div>
  </div>
</div>

<div class="container">

  <!-- TEXTUAL SUMMARY -->
  ${summaryHtml}

  <!-- STATS + PAGES NAV (2-column row) -->
  <div class="top-grid">
    <div class="overall-bar">
      <div class="ostat">
        <div class="num">${pages.length}</div>
        <div class="lbl">Pages scanned</div>
      </div>
      <div class="ostat-divider"></div>
      <div class="ostat">
        <div class="num" style="${totalViolations > 0 ? "color:#DC2626" : "color:#16A34A"}">${totalViolations}</div>
        <div class="lbl">Total violations</div>
      </div>
      <div class="ostat-divider"></div>
      <div class="ostat">
        <div class="num" style="${totalCritical > 0 ? "color:#DC2626" : ""}">${totalCritical}</div>
        <div class="lbl">Critical</div>
      </div>
      <div class="ostat-divider"></div>
      <div class="ostat">
        <div class="num" style="${totalSerious > 0 ? "color:#EA580C" : ""}">${totalSerious}</div>
        <div class="lbl">Serious</div>
      </div>
      <div class="ostat-divider"></div>
      <div class="ostat">
        <div class="num" style="color:#16A34A">${totalPasses}</div>
        <div class="lbl">Total passes</div>
      </div>
    </div>
    <div class="pnav">
      <div class="pnav-title">Violations by page</div>
      <p class="pnav-sub">${pages.length} page${pages.length !== 1 ? "s" : ""} scanned &mdash; click a page to jump to its full breakdown below.</p>
      <div class="pnav-list">${pagesNavHtml}</div>
    </div>
  </div>

  <!-- PAGE SECTIONS -->
  <div class="section-heading-block">
    <h2 class="section-heading">Detailed Findings by Page</h2>
    <p class="section-sub">Expand any page below for its full accessibility audit &mdash; a score, every violation with a suggested fix, what passed, and what still needs a human check.</p>
  </div>
  ${pageSectionsHtml}

</div><!-- /container -->

<script>
(function () {
  // Tab switching — scoped per page via data-pi
  document.querySelectorAll(".tab-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var tab = btn.dataset.tab;
      var pi  = btn.dataset.pi;
      document.querySelectorAll('.tab-btn[data-pi="' + pi + '"]').forEach(function(b) { b.classList.remove("active"); });
      document.querySelectorAll('.tab-pane[data-pi="' + pi + '"]').forEach(function(p) { p.classList.remove("active"); });
      btn.classList.add("active");
      var pane = document.getElementById("pane-" + tab + "-" + pi);
      if (pane) pane.classList.add("active");
    });
  });

  // Impact filter — scoped per page
  document.querySelectorAll(".filter-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var impact = btn.dataset.impact;
      var pi     = btn.dataset.pi;
      document.querySelectorAll('.filter-btn[data-pi="' + pi + '"]').forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      document.querySelectorAll("#violations-list-" + pi + " .issue-row").forEach(function(row) {
        row.style.display = (impact === "all" || row.dataset.impact === impact) ? "" : "none";
      });
    });
  });
})();

function toggleRow(id) {
  var row    = document.getElementById(id);
  var detail = document.getElementById(id + "-detail");
  if (!detail) return;
  var isOpen = !detail.hidden;
  detail.hidden = isOpen;
  row.classList.toggle("open", !isOpen);
}
</script>
</body>
</html>`;
}

module.exports = { buildHtmlReport };
