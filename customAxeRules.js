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
 *   - Jurisdiction-specific (Ontario AODA) requirements applied globally to
 *     every scanned site regardless of where the client operates.
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
 * AODA (Ontario's accessibility law) is a real target for this tool, not
 * generic noise — so the AODA-specific block below was restored, not
 * because a criterion is untested by generic scanners, but because AODA
 * (IASR) legally requires WCAG 2.0 Level A and AA. Nothing at Level AAA is
 * required, which is why the AAA-level rules (enhanced contrast, 44x44
 * target size, abbr titles) above stay removed regardless of jurisdiction.
 * Within the AODA block, each rule falls into one of three buckets:
 *   - RESTORED AS-IS: deterministic, low false-positive-risk checks of a
 *     real Level A/AA requirement.
 *   - RESTORED BUT FIXED: the requirement is real, but the original logic
 *     had a bug (e.g. `custom-multiple-ways-check` treated any link on the
 *     page as satisfying "multiple ways to find content," so it could
 *     never fail).
 *   - MANUAL REVIEW: for criteria where even a fixed heuristic can't
 *     reliably say pass/fail (e.g. guessing seizure-flash risk from CSS
 *     animation-duration, or guessing "images of text" from alt-text
 *     length), the check now returns `undefined` from evaluate() instead
 *     of true/false. axe-core treats that as `cantTell`, which lands the
 *     finding in the "incomplete" / Required Manual Audits bucket instead
 *     of a false auto-pass or a false auto-fail — the same bucket the
 *     reference tools use for criteria they don't attempt to automate.
 *     A few criteria (WCAG 3.2.1/3.2.2, 2.5.2/2.5.4, 3.2.3) are
 *     structurally impossible to verify from static markup at all — those
 *     always return `undefined` so they always surface as a manual-review
 *     item, rather than a check that's dead code on any modern JS site.
 *
 * Each check's evaluate function runs INSIDE the browser (via page.evaluate),
 * so it must be self-contained — no closures over Node variables.
 */

const customChecks = [

  // ============================================================
  // ARIA
  // ============================================================
  {
    id: "custom-aria-expanded-button-check",
    evaluate: function (node) {
      var controls = node.getAttribute("aria-controls") || node.getAttribute("aria-haspopup");
      if (!controls) return true;
      return node.getAttribute("aria-expanded") !== null;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Button with aria-controls/aria-haspopup has aria-expanded",
        fail: "Button controls or has a popup but is missing aria-expanded — screen readers cannot convey the open/closed state",
      },
    },
  },
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
  {
    id: "custom-dialog-modal-check",
    evaluate: function (node) {
      var role = node.getAttribute("role");
      if (role !== "dialog" && role !== "alertdialog") return true;
      return node.getAttribute("aria-modal") === "true";
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Dialog element has aria-modal='true'",
        fail: "Dialog element is missing aria-modal='true' — screen readers may not confine virtual cursor to the dialog",
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
    id: "custom-generic-link-text-check",
    evaluate: function (node) {
      var generic = [
        "click here","read more","learn more","here","more","link",
        "this","details","info","information","page","go","open",
      ];
      return generic.indexOf(node.textContent.trim().toLowerCase()) === -1;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Link text is descriptive",
        fail: "Link text is generic (e.g. 'click here') and doesn't describe the destination — a problem for screen reader users navigating by links list",
      },
    },
  },
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

  // ============================================================
  // AODA / WCAG 2.0 A/AA — restored as-is (deterministic, real)
  // ============================================================
  {
    id: "custom-audio-description-check",
    evaluate: function (node) {
      var descTracks = node.querySelectorAll("track[kind='descriptions']");
      if (descTracks.length > 0) return true;
      return node.hasAttribute("aria-describedby");
    },
    metadata: {
      impact: "serious",
      messages: {
        pass: "Video has an audio description track or text alternative",
        fail: "Video has no audio description track (<track kind='descriptions'>) — blind users cannot access visual-only information in the video (WCAG 1.2.3, required under AODA IASR s.14)",
      },
    },
  },
  {
    id: "custom-audio-control-check",
    evaluate: function (node) {
      var hasControls = node.hasAttribute("controls");
      var isMuted = node.hasAttribute("muted") || node.muted === true;
      var isAutoplay = node.hasAttribute("autoplay");
      if (!isAutoplay) return true;
      return hasControls || isMuted;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Autoplaying audio is muted or provides playback controls",
        fail: "Audio autoplays without controls and is not muted — screen reader users need a mechanism to pause or stop audio that interferes with speech output (WCAG 1.4.2, required under AODA)",
      },
    },
  },
  {
    id: "custom-timing-adjustable-check",
    evaluate: function (node) {
      var text = node.textContent.toLowerCase();
      var hasTimeoutText = /session\s*(will\s*)?(expire|timeout|end|log\s*out)/i.test(text) ||
        /you\s*will\s*be\s*(logged|signed)\s*out/i.test(text);
      if (!hasTimeoutText) return true;
      var hasExtendLink = !!node.querySelector("button, a[href], input[type='button'], input[type='submit']");
      return hasExtendLink;
    },
    metadata: {
      impact: "serious",
      messages: {
        pass: "Session timeout warning includes a mechanism to extend the session",
        fail: "Session timeout warning detected but no button or link to extend the session — users need at least 20 seconds to respond, or the ability to turn off the timeout (WCAG 2.2.1, required under AODA)",
      },
    },
  },

  // ============================================================
  // AODA / WCAG 2.0 A/AA — restored, with the original bug fixed
  // ============================================================
  {
    id: "custom-multiple-ways-check",
    evaluate: function () {
      var hasSearch = !!(
        document.querySelector("input[type='search']") ||
        document.querySelector("form[role='search']") ||
        document.querySelector("[aria-label*='search' i]") ||
        document.querySelector("[placeholder*='search' i]")
      );
      var hasSiteMap = !!(
        document.querySelector("a[href*='sitemap' i]") ||
        document.querySelector("a[href*='site-map' i]")
      );
      var hasBreadcrumbs = !!(
        document.querySelector("[aria-label*='breadcrumb' i]") ||
        document.querySelector("[class*='breadcrumb' i]")
      );
      var navLinkCount = document.querySelectorAll("nav a[href], [role='navigation'] a[href]").length;
      var hasSiteNav = navLinkCount >= 2;
      var waysFound = [hasSearch, hasSiteMap, hasBreadcrumbs, hasSiteNav].filter(Boolean).length;
      // WCAG 2.4.5 requires MORE THAN ONE way to locate content — a single
      // nav menu alone doesn't satisfy it. (Previously this always passed:
      // it treated any non-hidden link on the page as a "site map.")
      return waysFound >= 2;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Page offers at least two ways to find content (search, sitemap, breadcrumbs, or site navigation)",
        fail: "Page appears to offer only one way to find content — AODA/WCAG 2.4.5 requires at least two, such as a search field plus a site navigation menu or sitemap",
      },
    },
  },
  {
    id: "custom-pdf-accessibility-check",
    evaluate: function (node) {
      var href = (node.getAttribute("href") || "").toLowerCase();
      if (!href.endsWith(".pdf")) return true;
      var text = node.textContent.toLowerCase();
      var title = (node.getAttribute("title") || "").toLowerCase();
      var ariaLabel = (node.getAttribute("aria-label") || "").toLowerCase();
      var combined = text + " " + title + " " + ariaLabel;
      var hasTextIndicator = combined.includes("pdf") || combined.includes("opens") || combined.includes("download");
      // A visible/labelled PDF icon is just as valid a format indicator as
      // text — the original version only checked text and would flag a
      // properly icon-labelled document link as a false positive.
      var hasIconIndicator = !!node.querySelector(
        "[class*='pdf' i], [class*='fa-file' i], svg[aria-label*='pdf' i], img[alt*='pdf' i]"
      );
      var hasAltLink = !!(
        node.nextElementSibling &&
        (node.nextElementSibling.textContent.toLowerCase().includes("html") ||
         node.nextElementSibling.textContent.toLowerCase().includes("accessible"))
      );
      return hasTextIndicator || hasIconIndicator || hasAltLink;
    },
    metadata: {
      impact: "serious",
      messages: {
        pass: "PDF link warns users about the file format or provides an accessible alternative",
        fail: "Link points to a PDF without indicating the format via text or icon — PDFs must be tagged and accessible, or an HTML alternative must be provided (AODA IASR s.14)",
      },
    },
  },
  {
    id: "custom-accessible-documents-check",
    evaluate: function (node) {
      var href = (node.getAttribute("href") || "").toLowerCase();
      var officeExts = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"];
      var isOffice = officeExts.some(function (ext) { return href.endsWith(ext); });
      if (!isOffice) return true;
      var text = node.textContent.toLowerCase();
      var title = (node.getAttribute("title") || "").toLowerCase();
      var ariaLabel = (node.getAttribute("aria-label") || "").toLowerCase();
      var combined = text + " " + title + " " + ariaLabel;
      var hasTextIndicator = combined.includes("word") || combined.includes("excel") || combined.includes("powerpoint") ||
        combined.includes(".doc") || combined.includes(".xls") || combined.includes(".ppt") ||
        combined.includes("download") || combined.includes("opens");
      var hasIconIndicator = !!node.querySelector(
        "[class*='word' i], [class*='excel' i], [class*='powerpoint' i], [class*='fa-file' i], img[alt]"
      );
      return hasTextIndicator || hasIconIndicator;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Office document link indicates the file format to users",
        fail: "Link to a Word/Excel/PowerPoint file does not indicate the file format via text or icon — AODA requires publicly available documents to be provided in accessible formats or accompanied by accessible alternatives (AODA IASR s.14)",
      },
    },
  },

  // ============================================================
  // AODA IASR — organization-level requirements (Ontario, 50+ employees)
  // ============================================================
  {
    id: "custom-accessibility-statement-check",
    evaluate: function () {
      var links = document.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        var t = links[i].textContent.toLowerCase();
        var h = (links[i].getAttribute("href") || "").toLowerCase();
        if (
          t.includes("accessibility") || t.includes("accessibilité") ||
          h.includes("accessibility") || h.includes("accessib")
        ) return true;
      }
      return false;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Page contains a link to an accessibility statement or policy",
        fail: "No accessibility statement link found. Organizations covered by AODA (Ontario, 50+ employees) — or similar Canadian accessibility laws — are required to publish an accessibility policy and multi-year plan, linked from the site.",
      },
    },
  },
  {
    id: "custom-feedback-mechanism-check",
    evaluate: function () {
      var links = document.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        var t = links[i].textContent.toLowerCase();
        var h = (links[i].getAttribute("href") || "").toLowerCase();
        if (
          t.includes("contact") || t.includes("feedback") || t.includes("support") ||
          t.includes("help") || t.includes("report") || t.includes("complaint") ||
          h.includes("contact") || h.includes("feedback") || h.startsWith("mailto:")
        ) return true;
      }
      return !!(document.querySelector("form[action*='contact'], form[id*='contact'], form[class*='contact']"));
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Page provides an accessible feedback or contact mechanism",
        fail: "No contact, feedback, or support link found. Organizations covered by AODA (Ontario, 50+ employees) must maintain an accessible process for receiving and responding to feedback from people with disabilities (AODA IASR s.11).",
      },
    },
  },

  // ============================================================
  // WCAG 1.4.4 Resize Text — downgraded from a definite AA violation to
  // a best-practice advisory. The actual criterion is about 200% zoom/
  // reflow, not px vs. relative units; fixed px sizes don't automatically
  // fail it in modern browsers, so this shouldn't be reported as a
  // confirmed compliance gap the way it was before.
  // ============================================================
  {
    id: "custom-resize-text-check",
    evaluate: function (node) {
      var style = window.getComputedStyle(node);
      var fontSize = style.fontSize || "";
      if (!fontSize.endsWith("px")) return true;
      var px = parseFloat(fontSize);
      return px >= 12;
    },
    metadata: {
      impact: "minor",
      messages: {
        pass: "Text size is not set too small in fixed pixels",
        fail: "Text is set below 12px in fixed pixels — as a best practice, consider relative units (em, rem, %) so text scales more predictably when users adjust browser zoom or font settings",
      },
    },
  },

  // ============================================================
  // Manual review — real Level A/AA criteria where even a fixed heuristic
  // can't reliably assert pass or fail. These return `undefined` when the
  // page shows a signal worth a human look, which axe-core surfaces as
  // "needs manual review" rather than a false pass or a false fail.
  // ============================================================
  {
    id: "custom-meaningful-sequence-check",
    evaluate: function (node) {
      var style = window.getComputedStyle(node);
      var order = parseInt(style.order || "0", 10);
      if (order === 0) return true;
      return undefined;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Element does not use CSS order to reposition itself",
        incomplete: "Element uses CSS 'order' to reposition itself — manually confirm the visual reading order still matches a logical DOM/tab order (WCAG 1.3.2)",
        fail: "Element uses CSS 'order' to reposition itself — manually confirm the visual reading order still matches a logical DOM/tab order (WCAG 1.3.2)",
      },
    },
  },
  {
    id: "custom-sensory-characteristics-check",
    evaluate: function (node) {
      var text = node.textContent.toLowerCase();
      var patterns = [
        /\b(click|press|tap)\s+the\s+(round|square|circular|red|green|blue|yellow|left|right|above|below)\s+(button|link|icon)\b/,
        /\bbutton\s+(on\s+the\s+)?(left|right|top|bottom|above|below)\b/,
        /\bthe\s+(red|green|blue|yellow|orange|purple)\s+(button|link|icon|field)\b/,
      ];
      if (!patterns.some(function (p) { return p.test(text); })) return true;
      return undefined;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Instructions do not appear to rely solely on sensory characteristics",
        incomplete: "This text may identify a control only by shape, color, or position (e.g. 'the red button') — manually confirm there's also a text label a screen reader user can rely on (WCAG 1.3.3)",
        fail: "This text may identify a control only by shape, color, or position — manually confirm there's also a text label a screen reader user can rely on (WCAG 1.3.3)",
      },
    },
  },
  {
    id: "custom-images-of-text-check",
    evaluate: function (node) {
      var alt = (node.getAttribute("alt") || "").trim();
      var role = node.getAttribute("role");
      if (role === "none" || role === "presentation" || alt === "") return true;
      var looksLikeBodyCopy = alt.length >= 30 && /^[A-Z]/.test(alt);
      if (!looksLikeBodyCopy) return true;
      return undefined;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Image does not appear to replace text content",
        incomplete: "This image's alt text reads like a full sentence of body copy — manually confirm the image isn't a screenshot of text that should be real, resizable HTML text instead (WCAG 1.4.5)",
        fail: "This image's alt text reads like a full sentence of body copy — manually confirm the image isn't a screenshot of text that should be real, resizable HTML text instead (WCAG 1.4.5)",
      },
    },
  },
  {
    id: "custom-three-flashes-check",
    evaluate: function (node) {
      var style = window.getComputedStyle(node);
      var duration = style.animationDuration || "0s";
      var count = style.animationIterationCount || "1";
      var durationSec = parseFloat(duration);
      var rapidRepeat = durationSec > 0 && durationSec < 0.34 && (count === "infinite" || parseInt(count, 10) > 3);
      if (!rapidRepeat) return true;
      return undefined;
    },
    metadata: {
      impact: "critical",
      messages: {
        pass: "Element animation does not appear to flash at a seizure-triggering rate",
        incomplete: "Element has a very fast repeating animation (< 0.34s cycle) — manually verify it does not flash more than 3 times per second, which can trigger photosensitive seizures (WCAG 2.3.1)",
        fail: "Element has a very fast repeating animation (< 0.34s cycle) — manually verify it does not flash more than 3 times per second, which can trigger photosensitive seizures (WCAG 2.3.1)",
      },
    },
  },
  {
    id: "custom-error-prevention-check",
    evaluate: function (node) {
      var html = node.innerHTML.toLowerCase();
      var isHighStakes = /\b(payment|credit.card|debit|billing|checkout|purchase|order|delete|remove|cancel\s*account|legal|agreement|consent|submit\s*application)\b/i.test(html);
      if (!isHighStakes) return true;
      var hasConfirm = !!(
        node.querySelector("[aria-label*='confirm' i], [value*='confirm' i]") ||
        /\b(confirm|review\s*your|check\s*your|are\s*you\s*sure|cancel\s*anytime|undo)\b/i.test(html)
      );
      if (hasConfirm) return true;
      return undefined;
    },
    metadata: {
      impact: "serious",
      messages: {
        pass: "High-stakes form has a confirmation or review mechanism",
        incomplete: "This form appears to involve a financial, legal, or irreversible action — manually confirm users can review, correct, and confirm before final submission (WCAG 3.3.4)",
        fail: "This form appears to involve a financial, legal, or irreversible action — manually confirm users can review, correct, and confirm before final submission (WCAG 3.3.4)",
      },
    },
  },
  {
    id: "custom-headings-labels-check",
    evaluate: function (node) {
      var text = node.textContent.trim();
      if (!text) return true; // Empty headings are caught by axe's own empty-heading rule
      var isNumericOrPunctuationOnly = /^[\d\W]+$/.test(text);
      if (!isNumericOrPunctuationOnly) return true;
      return undefined;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Heading has a meaningful, descriptive text label",
        incomplete: "This heading is made up of only numbers or punctuation — manually confirm it still describes the topic or purpose of its section (WCAG 2.4.6)",
        fail: "This heading is made up of only numbers or punctuation — manually confirm it still describes the topic or purpose of its section (WCAG 2.4.6)",
      },
    },
  },

  // ============================================================
  // Always-manual — Level A/AA criteria that cannot be verified from
  // static markup at all (they depend on JS event-handler behavior or on
  // comparing multiple pages of a site). These always return `undefined`
  // so they always surface once per scan as a Required Manual Audit,
  // rather than a check that can never actually detect anything on a
  // modern JS-driven site.
  // ============================================================
  {
    id: "custom-on-focus-input-review",
    evaluate: function () {
      return undefined;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Not applicable — evaluated manually",
        incomplete: "Manually verify that giving focus to an element, or changing a form value, never triggers an unexpected navigation or submission (WCAG 3.2.1 On Focus / 3.2.2 On Input)",
        fail: "Manually verify that giving focus to an element, or changing a form value, never triggers an unexpected navigation or submission (WCAG 3.2.1 On Focus / 3.2.2 On Input)",
      },
    },
  },
  {
    id: "custom-pointer-motion-review",
    evaluate: function () {
      return undefined;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Not applicable — evaluated manually",
        incomplete: "Manually verify single-pointer actions can be cancelled (e.g. by moving the pointer away before release) and that any motion-activated feature has a standard UI alternative (WCAG 2.5.2 Pointer Cancellation / 2.5.4 Motion Actuation)",
        fail: "Manually verify single-pointer actions can be cancelled and that any motion-activated feature has a standard UI alternative (WCAG 2.5.2 / 2.5.4)",
      },
    },
  },
  {
    id: "custom-consistent-navigation-review",
    evaluate: function () {
      return undefined;
    },
    metadata: {
      impact: "moderate",
      messages: {
        pass: "Not applicable — evaluated manually",
        incomplete: "This is a single-page scan — manually confirm navigation, header, and footer components appear in the same relative order on every page of the site (WCAG 3.2.3 Consistent Navigation)",
        fail: "Manually confirm navigation, header, and footer components appear in the same relative order on every page of the site (WCAG 3.2.3 Consistent Navigation)",
      },
    },
  },
];

// =============================================================
// RULES — ties each check ID to a CSS selector + metadata
// =============================================================
const customRules = [
  { id: "custom-aria-expanded-button-check", selector: "button[aria-controls], button[aria-haspopup]", tags: ["custom","best-practice"], metadata: { description: "Ensures buttons that control popups have aria-expanded", help: "Buttons with aria-controls or aria-haspopup must also have aria-expanded to communicate open/closed state" }, any: ["custom-aria-expanded-button-check"], all: [], none: [] },
  { id: "custom-aria-live-region-check", selector: "[aria-live]", tags: ["custom","best-practice"], metadata: { description: "Ensures aria-live attributes use valid values", help: "Valid values are: off, polite, assertive" }, any: ["custom-aria-live-region-check"], all: [], none: [] },
  { id: "custom-dialog-modal-check", selector: "[role='dialog'], [role='alertdialog']", tags: ["custom","best-practice"], metadata: { description: "Ensures ARIA dialogs have aria-modal='true'", help: "aria-modal confines the screen reader virtual cursor to the dialog content" }, any: ["custom-dialog-modal-check"], all: [], none: [] },

  { id: "custom-placeholder-as-label-check", selector: "input[type='text'], input[type='email'], input[type='search'], input[type='tel'], textarea", tags: ["custom","best-practice"], metadata: { description: "Ensures form fields are not labeled solely by placeholder text", help: "Form fields must have a real label, not just placeholder text" }, any: ["custom-placeholder-as-label-check"], all: [], none: [] },
  { id: "custom-error-identification-check", selector: "[aria-invalid='true']", tags: ["custom","wcag2a","wcag331"], metadata: { description: "Fields marked as invalid must have a linked text error message via aria-errormessage or aria-describedby (WCAG 3.3.1)", help: "Add aria-errormessage='error-id' pointing to an element with a descriptive error text, or use aria-describedby" }, any: ["custom-error-identification-check"], all: [], none: [] },
  { id: "custom-error-suggestion-check", selector: "[aria-invalid='true']", tags: ["custom","wcag2aa","wcag333"], metadata: { description: "Error messages must suggest how to correct the mistake when the expected format is known (WCAG 3.3.3)", help: "Include actionable language in error messages such as 'Please enter a valid email address (e.g. name@example.com)'" }, any: ["custom-error-suggestion-check"], all: [], none: [] },

  { id: "custom-generic-link-text-check", selector: "a[href]", tags: ["custom","best-practice"], metadata: { description: "Flags generic non-descriptive link text", help: "Link text should describe the destination without relying on context" }, any: ["custom-generic-link-text-check"], all: [], none: [] },
  { id: "custom-new-tab-warning-check", selector: "a[target='_blank']", tags: ["custom","best-practice","wcag2a"], metadata: { description: "Ensures links opening in a new tab warn the user", help: "Links with target=_blank should indicate they open in a new tab" }, any: ["custom-new-tab-warning-check"], all: [], none: [] },
  { id: "custom-redundant-title-check", selector: "a[title], button[title]", tags: ["custom","best-practice"], metadata: { description: "Flags title attributes that duplicate visible text", help: "Title attribute should add information, not repeat the visible text" }, any: ["custom-redundant-title-check"], all: [], none: [] },

  { id: "custom-accesskeys-unique-check", selector: "[accesskey]", tags: ["custom","best-practice"], metadata: { description: "Ensures accesskey values are unique across the document", help: "Duplicate accesskeys produce unpredictable behavior" }, any: ["custom-accesskeys-unique-check"], all: [], none: [] },
  { id: "custom-pointer-gestures-check", selector: "[draggable='true']", tags: ["custom","wcag21a","wcag251"], metadata: { description: "Ensures draggable elements have keyboard alternatives", help: "All drag operations need a single-pointer or keyboard alternative for users who cannot drag" }, any: ["custom-pointer-gestures-check"], all: [], none: [] },
  { id: "custom-dragging-alternative-check", selector: "[draggable='true'], [ondragstart]", tags: ["custom","wcag22aa","wcag257"], metadata: { description: "Ensures drag-and-drop has a single-pointer alternative", help: "Provide a click-based or keyboard alternative for all drag functionality (WCAG 2.5.7)" }, any: ["custom-dragging-alternative-check"], all: [], none: [] },

  { id: "custom-captcha-alternative-check", selector: "img[alt*='captcha'], img[alt*='CAPTCHA'], img[id*='captcha'], img[class*='captcha'], [class*='captcha']", tags: ["custom","wcag2a","wcag111"], metadata: { description: "CAPTCHAs must provide an audio or alternative verification method for blind users (WCAG 1.1.1)", help: "Implement an audio CAPTCHA option alongside visual CAPTCHAs; consider using accessible alternatives like reCAPTCHA v3 or honeypot fields" }, any: ["custom-captcha-alternative-check"], all: [], none: [] },

  // AODA / WCAG 2.0 A/AA — restored as-is
  { id: "custom-audio-description-check", selector: "video", tags: ["custom","wcag2a","wcag123","aoda"], metadata: { description: "Videos must have an audio description track or text alternative (WCAG 1.2.3)", help: "Add <track kind='descriptions'> or an aria-describedby text alternative to the video element" }, any: ["custom-audio-description-check"], all: [], none: [] },
  { id: "custom-audio-control-check", selector: "audio[autoplay]", tags: ["custom","wcag2a","wcag142","aoda"], metadata: { description: "Autoplaying audio must be muted or have visible playback controls (WCAG 1.4.2)", help: "Add the controls attribute or muted attribute to autoplaying audio elements" }, any: ["custom-audio-control-check"], all: [], none: [] },
  { id: "custom-timing-adjustable-check", selector: "[class*='timeout'], [id*='timeout'], [class*='session'], [id*='session'], [class*='expire'], [id*='expire']", tags: ["custom","wcag2aa","wcag221","aoda"], metadata: { description: "Session timeouts must be adjustable or warn users before they expire (WCAG 2.2.1)", help: "Provide a button or link to extend the session when displaying timeout warnings; allow at least 20 seconds to respond" }, any: ["custom-timing-adjustable-check"], all: [], none: [] },

  // AODA / WCAG 2.0 A/AA — restored, original bug fixed
  { id: "custom-multiple-ways-check", selector: "html", tags: ["custom","wcag2aa","wcag245","aoda"], metadata: { description: "Multiple ways to find content must be available — such as a search form plus a site map or navigation (WCAG 2.4.5)", help: "Provide at least two of: a search field, a sitemap link, breadcrumbs, or a site navigation menu with multiple links" }, any: ["custom-multiple-ways-check"], all: [], none: [] },
  { id: "custom-pdf-accessibility-check", selector: "a[href$='.pdf'], a[href$='.PDF']", tags: ["custom","aoda","best-practice"], metadata: { description: "Links to PDF files must indicate the format via text or icon, and provide an accessible alternative when needed (AODA IASR s.14)", help: "Include '(PDF)' in the link text/title, or a recognizable PDF icon; provide a linked HTML alternative for complex documents" }, any: ["custom-pdf-accessibility-check"], all: [], none: [] },
  { id: "custom-accessible-documents-check", selector: "a[href$='.doc'], a[href$='.docx'], a[href$='.xls'], a[href$='.xlsx'], a[href$='.ppt'], a[href$='.pptx']", tags: ["custom","aoda","best-practice"], metadata: { description: "Links to Office documents must indicate the file format via text or icon (AODA IASR s.14)", help: "Include the file type in the link text (e.g. 'Annual Report (Word)') or an icon, and ensure the document itself meets AODA accessibility requirements" }, any: ["custom-accessible-documents-check"], all: [], none: [] },

  // AODA IASR — organization-level requirements (Ontario, 50+ employees)
  { id: "custom-accessibility-statement-check", selector: "html", tags: ["custom","aoda"], metadata: { description: "Organizations covered by AODA must link to an accessibility statement or policy", help: "Add a link with text containing 'Accessibility' in the header, footer, or navigation — point it to your accessibility policy and multi-year plan" }, any: ["custom-accessibility-statement-check"], all: [], none: [] },
  { id: "custom-feedback-mechanism-check", selector: "html", tags: ["custom","aoda"], metadata: { description: "Organizations covered by AODA must provide an accessible feedback or contact mechanism", help: "Include a 'Contact Us' or 'Feedback' link in the header or footer; ensure the contact form is fully keyboard-accessible and works with screen readers" }, any: ["custom-feedback-mechanism-check"], all: [], none: [] },

  // WCAG 1.4.4 — advisory, not a confirmed AA violation
  { id: "custom-resize-text-check", selector: "p, li, td, span, div", tags: ["custom","best-practice"], metadata: { description: "Text should not be sized so small in fixed pixels that it resists resizing (advisory for WCAG 1.4.4)", help: "Use relative units (em, rem, %) for font sizes as a best practice" }, any: ["custom-resize-text-check"], all: [], none: [] },

  // Manual review — real criteria, heuristic can't assert pass/fail
  { id: "custom-meaningful-sequence-check", selector: "[style*='order']", tags: ["custom","wcag2a","wcag132","aoda"], metadata: { description: "CSS order should not create a reading sequence that differs from the DOM order (WCAG 1.3.2)", help: "Confirm the visual reading order matches the DOM order so screen reader users encounter content logically" }, any: ["custom-meaningful-sequence-check"], all: [], none: [] },
  { id: "custom-sensory-characteristics-check", selector: "p, li, dd, td, figcaption, div", tags: ["custom","wcag2a","wcag133","aoda"], metadata: { description: "Instructions should not rely solely on shape, color, size, or spatial location (WCAG 1.3.3)", help: "Supplement any color, shape, or position references with text labels" }, any: ["custom-sensory-characteristics-check"], all: [], none: [] },
  { id: "custom-images-of-text-check", selector: "img", tags: ["custom","wcag2aa","wcag145","aoda"], metadata: { description: "Images should not be used to present text that could be live HTML text (WCAG 1.4.5)", help: "Replace suspected images of text with real HTML text styled with CSS; exceptions include logos" }, any: ["custom-images-of-text-check"], all: [], none: [] },
  { id: "custom-three-flashes-check", selector: "[style*='animation'], [class*='flash'], [class*='blink'], [class*='strobe'], [class*='pulse']", tags: ["custom","wcag2a","wcag231","aoda"], metadata: { description: "Content should not flash more than 3 times per second (WCAG 2.3.1)", help: "Verify animation timing does not create a seizure risk; use animation-duration > 0.34s or iteration-count ≤ 3" }, any: ["custom-three-flashes-check"], all: [], none: [] },
  { id: "custom-error-prevention-check", selector: "form", tags: ["custom","wcag2aa","wcag334","aoda"], metadata: { description: "Forms involving financial, legal, or irreversible actions should allow review before final submission (WCAG 3.3.4)", help: "Add a review/confirmation step, or a clear cancellation mechanism for payment and legal forms" }, any: ["custom-error-prevention-check"], all: [], none: [] },
  { id: "custom-headings-labels-check", selector: "h1, h2, h3, h4, h5, h6", tags: ["custom","wcag2aa","wcag246","aoda"], metadata: { description: "Headings should describe the topic or purpose of their section (WCAG 2.4.6)", help: "Avoid numeric-only or punctuation-only headings" }, any: ["custom-headings-labels-check"], all: [], none: [] },

  // Always-manual — structurally unverifiable from static markup
  { id: "custom-on-focus-input-review", selector: "html", tags: ["custom","wcag2a","wcag321","wcag322","aoda"], metadata: { description: "Receiving focus or changing an input must not cause an unexpected context change (WCAG 3.2.1 / 3.2.2)", help: "Manually verify focus and input-change handlers never auto-navigate or auto-submit" }, any: ["custom-on-focus-input-review"], all: [], none: [] },
  { id: "custom-pointer-motion-review", selector: "html", tags: ["custom","wcag21aa","wcag252","wcag254","aoda"], metadata: { description: "Pointer actions must be cancellable and motion-activated features need a UI alternative (WCAG 2.5.2 / 2.5.4)", help: "Manually verify pointer-down actions can be cancelled and motion gestures have a conventional UI alternative" }, any: ["custom-pointer-motion-review"], all: [], none: [] },
  { id: "custom-consistent-navigation-review", selector: "html", tags: ["custom","wcag2aa","wcag323","aoda"], metadata: { description: "Navigation components must appear in a consistent relative order across pages (WCAG 3.2.3)", help: "Manually compare navigation, header, and footer placement across the site's pages" }, any: ["custom-consistent-navigation-review"], all: [], none: [] },
];

const CUSTOM_RULE_IDS = customRules.map(function (r) { return r.id; });

module.exports = {
  customChecks,
  customRules,
  CUSTOM_RULE_IDS,
};
