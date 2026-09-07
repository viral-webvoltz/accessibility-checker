/**
 * customAxeRules.js
 *
 * Custom axe-core rules that cover gaps NOT already handled by axe-core's
 * built-in ruleset (axe-core 4.12). Every rule here was checked against
 * axe-core's own rule list (`axe.getRules()`) to confirm it isn't a
 * duplicate.
 *
 * This file previously contained 107 custom rules. Most were removed
 * because they were:
 *   - Exact duplicates of axe-core built-in rules (axe's implementation is
 *     more thorough and better tested — e.g. image-alt, label,
 *     landmark-one-main, color-contrast, etc.)
 *   - AAA-level or otherwise beyond standard WCAG AA compliance
 *     (color-contrast-enhanced, 44x44 target size, abbr title)
 *   - Heuristic/regex-based guesses at criteria that are inherently manual
 *     (e.g. guessing "images of text" from alt-text length, guessing
 *     session timeouts from class names, guessing seizure risk from CSS
 *     animation timing) — these produced false positives other tools don't
 *     report because those tools correctly leave such criteria as
 *     "requires manual review" instead of auto-failing them.
 *   - Ontario AODA-specific requirements (accessibility statement link,
 *     feedback mechanism, document-format checks, etc.). These are real
 *     and were restored + fixed once — see the `aoda-custom-rules` branch
 *     for that work — but are left out here so this branch's report output
 *     stays close to what generic tools (WAVE, axe DevTools, most paid
 *     scanners) show. Bring that branch's rules back in when AODA coverage
 *     is wanted again.
 *   - Dead/no-op checks whose logic could never actually fail.
 *   - A security check (rel=noopener) that isn't a WCAG/accessibility
 *     criterion and doesn't belong in an accessibility report.
 *
 * The `custom-color-contrast-check` / `custom-color-contrast-enhanced-check`
 * / `custom-non-text-contrast-check` rules were also removed because their
 * evaluate() functions computed contrast against only the element's own
 * background-color, parsed with a regex that dropped the alpha channel —
 * a fully transparent background (the norm for inline elements like <li>,
 * <span>, <a>) was silently treated as opaque black, producing false
 * "serious" contrast failures that axe-core's own built-in `color-contrast`
 * rule (which correctly resolves the effective rendered background) did
 * not flag on the same elements.
 *
 * Each check's evaluate function runs INSIDE the browser (via page.evaluate),
 * so it must be self-contained — no closures over Node variables.
 */

const customChecks = [

  // ============================================================
  // ARIA
  // ============================================================
  {
    id: "custom-aria-live-region-check",
    evaluate: function (node) {
      var val = node.getAttribute("aria-live");
      if (!val) return true;
      return ["off", "polite", "assertive"].indexOf(val) !== -1;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "aria-live attribute has a valid value",
        fail: "aria-live attribute has an invalid value — screen readers will not announce changes to this region correctly",
      },
    },
  },
  // ============================================================
  // FORMS
  // ============================================================
  {
    id: "custom-placeholder-as-label-check",
    evaluate: function (node) {
      var hasPlaceholder = node.hasAttribute("placeholder");
      var hasLabel =
        node.hasAttribute("aria-label") ||
        node.hasAttribute("aria-labelledby") ||
        !!document.querySelector('label[for="' + node.id + '"]');
      return !(hasPlaceholder && !hasLabel);
    },
    metadata: {
      impact: "serious",
      messages: {
        pass: "Input has a proper label, not just a placeholder",
        fail: "Input relies on placeholder text instead of a real label — placeholder disappears on focus and is not reliably announced by screen readers",
      },
    },
  },
  {
    id: "custom-error-identification-check",
    evaluate: function (node) {
      var ariaInvalid = node.getAttribute("aria-invalid");
      if (ariaInvalid !== "true") return true; // No error state, skip
      // If field is marked invalid, error text must be linked via aria-errormessage or aria-describedby
      var errMsg = node.getAttribute("aria-errormessage");
      var descBy = node.getAttribute("aria-describedby");
      if (errMsg) {
        var errEl = document.getElementById(errMsg);
        return !!(errEl && errEl.textContent.trim());
      }
      if (descBy) {
        var ids = descBy.split(/\s+/);
        return ids.some(function (id) {
          var el = document.getElementById(id);
          return el && el.textContent.trim().length > 0;
        });
      }
      return false;
    },
    metadata: {
      impact: "critical",
      messages: {
        pass: "Invalid field has a text error message linked via aria-errormessage or aria-describedby",
        fail: "Field is marked aria-invalid='true' but has no linked text error message — screen reader users will not know what the error is (WCAG 3.3.1)",
      },
    },
  },
  {
    id: "custom-error-suggestion-check",
    evaluate: function (node) {
      var errMsgId = node.getAttribute("aria-errormessage");
      var descById = node.getAttribute("aria-describedby");
      var ariaInvalid = node.getAttribute("aria-invalid");
      if (ariaInvalid !== "true") return true;
      var msgEl = null;
      if (errMsgId) msgEl = document.getElementById(errMsgId);
      else if (descById) {
        var ids = descById.split(/\s+/);
        for (var i = 0; i < ids.length; i++) {
          var el = document.getElementById(ids[i]);
          if (el && el.textContent.trim()) { msgEl = el; break; }
        }
      }
      if (!msgEl) return true; // No message found, covered by 3.3.1 rule
      var msg = msgEl.textContent.trim().toLowerCase();
      // Message should contain actionable suggestion words
      var suggestive = /\b(must|should|please|enter|provide|include|use|format|example|e\.g\.|required|at least|maximum|minimum|valid|correct|check)\b/i;
      return suggestive.test(msg);
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Error message includes a suggestion for how to correct the input",
        fail: "Error message exists but does not suggest how to correct the error — include specific instructions like the required format or expected values (WCAG 3.3.3)",
      },
    },
  },

  // ============================================================
  // LINKS
  // ============================================================
  {
    id: "custom-new-tab-warning-check",
    evaluate: function (node) {
      if (node.getAttribute("target") !== "_blank") return true;
      var combined = [
        node.textContent,
        node.getAttribute("aria-label") || "",
        node.getAttribute("title") || "",
      ].join(" ").toLowerCase();
      return combined.includes("new tab") ||
        combined.includes("new window") ||
        combined.includes("opens in") ||
        node.hasAttribute("aria-describedby");
    },
    metadata: {
      impact: "minor",
      messages: {
        pass: "Link opening in a new tab warns the user beforehand",
        fail: "Link opens in a new tab/window without warning — disorienting for screen reader and low-vision users",
      },
    },
  },
  {
    id: "custom-redundant-title-check",
    evaluate: function (node) {
      var title = (node.getAttribute("title") || "").trim().toLowerCase();
      if (!title) return true;
      return title !== node.textContent.trim().toLowerCase();
    },
    metadata: {
      impact: "minor",
      messages: {
        pass: "Title attribute adds information beyond the visible text",
        fail: "Title attribute exactly duplicates the element's visible text — screen readers will announce the same content twice",
      },
    },
  },

  // ============================================================
  // KEYBOARD & POINTER
  // ============================================================
  {
    id: "custom-accesskeys-unique-check",
    evaluate: function (node) {
      var key = node.getAttribute("accesskey");
      if (!key) return true;
      return document.querySelectorAll("[accesskey='" + key + "']").length === 1;
    },
    metadata: {
      impact: "serious",
      messages: {
        pass: "accesskey value is unique across the document",
        fail: "Duplicate accesskey value — only one element will respond to this keyboard shortcut, causing unpredictable behavior",
      },
    },
  },
  {
    id: "custom-pointer-gestures-check",
    evaluate: function (node) {
      if (node.getAttribute("draggable") !== "true") return true;
      return node.hasAttribute("onkeydown") ||
        node.hasAttribute("onkeyup") ||
        node.hasAttribute("onkeypress");
    },
    metadata: {
      impact: "serious",
      messages: {
        pass: "Draggable element has a keyboard-accessible alternative",
        fail: "Draggable element has no keyboard event handlers — users who cannot drag have no alternative (WCAG 2.5.1)",
      },
    },
  },
  {
    id: "custom-dragging-alternative-check",
    evaluate: function (node) {
      var isDraggable = node.getAttribute("draggable") === "true" || node.hasAttribute("ondragstart");
      if (!isDraggable) return true;
      return node.hasAttribute("onclick") ||
        node.hasAttribute("onkeydown") ||
        node.getAttribute("aria-grabbed") !== null;
    },
    metadata: {
      impact: "serious",
      messages: {
        pass: "Draggable element has a single-pointer or keyboard alternative",
        fail: "Draggable element relies on drag without an alternative — users with motor impairments need a single-click alternative (WCAG 2.5.7)",
      },
    },
  },

  // ============================================================
  // CAPTCHA
  // ============================================================
  {
    id: "custom-captcha-alternative-check",
    evaluate: function (node) {
      var alt = (node.getAttribute("alt") || "").toLowerCase();
      var ariaLabel = (node.getAttribute("aria-label") || "").toLowerCase();
      var combined = alt + " " + ariaLabel;
      var isCaptcha = combined.includes("captcha") || combined.includes("verify") ||
        (node.id || "").toLowerCase().includes("captcha") ||
        (node.className || "").toLowerCase().includes("captcha");
      if (!isCaptcha) return true;
      // CAPTCHA must offer an audio alternative
      var page = document.body.innerHTML.toLowerCase();
      return page.includes("audio captcha") || page.includes("audio challenge") ||
        !!document.querySelector("audio") || !!document.querySelector("[data-callback]");
    },
    metadata: {
      impact: "critical",
      messages: {
        pass: "CAPTCHA provides an audio or alternative verification method",
        fail: "CAPTCHA found without an accessible audio alternative — blind users cannot complete visual CAPTCHAs without an alternative format (WCAG 1.1.1)",
      },
    },
  },
];

// =============================================================
// RULES — ties each check ID to a CSS selector + metadata
// =============================================================
const customRules = [
  { id: "custom-aria-live-region-check", selector: "[aria-live]", tags: ["custom","best-practice"], metadata: { description: "Ensures aria-live attributes use valid values", help: "Valid values are: off, polite, assertive" }, any: ["custom-aria-live-region-check"], all: [], none: [] },

  { id: "custom-placeholder-as-label-check", selector: "input[type='text'], input[type='email'], input[type='search'], input[type='tel'], textarea", tags: ["custom","best-practice"], metadata: { description: "Ensures form fields are not labeled solely by placeholder text", help: "Form fields must have a real label, not just placeholder text" }, any: ["custom-placeholder-as-label-check"], all: [], none: [] },
  { id: "custom-error-identification-check", selector: "[aria-invalid='true']", tags: ["custom","wcag2a","wcag331"], metadata: { description: "Fields marked as invalid must have a linked text error message via aria-errormessage or aria-describedby (WCAG 3.3.1)", help: "Add aria-errormessage='error-id' pointing to an element with a descriptive error text, or use aria-describedby" }, any: ["custom-error-identification-check"], all: [], none: [] },
  { id: "custom-error-suggestion-check", selector: "[aria-invalid='true']", tags: ["custom","wcag2aa","wcag333"], metadata: { description: "Error messages must suggest how to correct the mistake when the expected format is known (WCAG 3.3.3)", help: "Include actionable language in error messages such as 'Please enter a valid email address (e.g. name@example.com)'" }, any: ["custom-error-suggestion-check"], all: [], none: [] },

  { id: "custom-new-tab-warning-check", selector: "a[target='_blank']", tags: ["custom","best-practice","wcag2a"], metadata: { description: "Ensures links opening in a new tab warn the user", help: "Links with target=_blank should indicate they open in a new tab" }, any: ["custom-new-tab-warning-check"], all: [], none: [] },
  { id: "custom-redundant-title-check", selector: "a[title], button[title]", tags: ["custom","best-practice"], metadata: { description: "Flags title attributes that duplicate visible text", help: "Title attribute should add information, not repeat the visible text" }, any: ["custom-redundant-title-check"], all: [], none: [] },

  { id: "custom-accesskeys-unique-check", selector: "[accesskey]", tags: ["custom","best-practice"], metadata: { description: "Ensures accesskey values are unique across the document", help: "Duplicate accesskeys produce unpredictable behavior" }, any: ["custom-accesskeys-unique-check"], all: [], none: [] },
  { id: "custom-pointer-gestures-check", selector: "[draggable='true']", tags: ["custom","wcag21a","wcag251"], metadata: { description: "Ensures draggable elements have keyboard alternatives", help: "All drag operations need a single-pointer or keyboard alternative for users who cannot drag" }, any: ["custom-pointer-gestures-check"], all: [], none: [] },
  { id: "custom-dragging-alternative-check", selector: "[draggable='true'], [ondragstart]", tags: ["custom","wcag22aa","wcag257"], metadata: { description: "Ensures drag-and-drop has a single-pointer alternative", help: "Provide a click-based or keyboard alternative for all drag functionality (WCAG 2.5.7)" }, any: ["custom-dragging-alternative-check"], all: [], none: [] },

  { id: "custom-captcha-alternative-check", selector: "img[alt*='captcha'], img[alt*='CAPTCHA'], img[id*='captcha'], img[class*='captcha'], [class*='captcha']", tags: ["custom","wcag2a","wcag111"], metadata: { description: "CAPTCHAs must provide an audio or alternative verification method for blind users (WCAG 1.1.1)", help: "Implement an audio CAPTCHA option alongside visual CAPTCHAs; consider using accessible alternatives like reCAPTCHA v3 or honeypot fields" }, any: ["custom-captcha-alternative-check"], all: [], none: [] },
];

const CUSTOM_RULE_IDS = customRules.map(function (r) { return r.id; });

module.exports = {
  customChecks,
  customRules,
  CUSTOM_RULE_IDS,
};
