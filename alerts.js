/**
 * alerts.js — flags incidents worth a human's attention: a full audit
 * failure, or a crawl that came back with a suspiciously low page count.
 *
 * Every incident is written to a local JSONL file FIRST and
 * unconditionally, before any outbound notification is attempted — that
 * way an incident is never lost even if Slack/ClickUp are down,
 * misconfigured, or the notify call itself throws. Slack and ClickUp are
 * best-effort on top of that; either or both can be left unconfigured and
 * are just skipped.
 *
 * Env vars:
 *   SLACK_WEBHOOK_URL  - Slack incoming webhook URL
 *   CLICKUP_API_TOKEN  - ClickUp API token
 *   CLICKUP_LIST_ID    - ClickUp list ID new failure tasks are created in
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const logger = require("./logger");

const LOG_DIR = path.join(__dirname, "logs");
const FLAGGED_LOG_PATH = path.join(LOG_DIR, "flagged-sites.jsonl");

function appendFlagRecord(record) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(FLAGGED_LOG_PATH, JSON.stringify(record) + "\n");
  } catch (err) {
    // The one failure mode we can't route around — surface it as loudly as
    // the logger allows.
    logger.error("flag-log-write-failed", { error: err.message, record });
  }
}

function postJson(urlString, body, headers = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (err) {
      return reject(err);
    }
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
        timeout: 8000,
      },
      (res) => {
        res.on("data", () => {}); // drain so the socket can close
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function withRetry(fn, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return { ok: true };
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  return { ok: false, error: lastErr.message };
}

function formatMessage(record) {
  const urlList = Array.isArray(record.url) ? record.url.join(", ") : record.url;
  if (record.type === "audit-failed") {
    return (
      `Accessibility audit FAILED for ${urlList}\nReason: ${record.reason || "unknown"}` +
      (record.detail ? `\nDetail: ${record.detail}` : "")
    );
  }
  return (
    `Accessibility audit for ${urlList} only scanned ${record.pagesScanned} page(s) ` +
    `(up to ${record.maxPages} were allowed) — possible crawl issue, check locally.`
  );
}

async function notifySlack(record) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return { channel: "slack", status: "skipped" };
  const result = await withRetry(() => postJson(webhookUrl, { text: formatMessage(record) }));
  return { channel: "slack", status: result.ok ? "sent" : "failed", error: result.error };
}

async function notifyClickUp(record) {
  const token = process.env.CLICKUP_API_TOKEN;
  const listId = process.env.CLICKUP_LIST_ID;
  if (!token || !listId) return { channel: "clickup", status: "skipped" };
  const result = await withRetry(() =>
    postJson(
      `https://api.clickup.com/api/v2/list/${listId}/task`,
      {
        name: record.type === "audit-failed" ? "Accessibility audit failed" : "Low-yield accessibility crawl",
        description: formatMessage(record),
      },
      { Authorization: token }
    )
  );
  return { channel: "clickup", status: result.ok ? "sent" : "failed", error: result.error };
}

// Call for anything worth a human looking at. Always resolves — never
// throws — so a broken webhook/token can't take down the request that
// triggered it.
async function flagIncident(type, details) {
  const record = { type, time: logger.nowIST(), ...details };

  // Durable local record first, unconditionally.
  appendFlagRecord(record);

  const results = await Promise.all([notifySlack(record), notifyClickUp(record)]);
  const attempted = results.filter((r) => r.status !== "skipped");
  const allFailed = attempted.length > 0 && attempted.every((r) => r.status === "failed");

  if (attempted.length === 0) {
    logger.warn("incident-not-notified", { reason: "no channels configured", type, record });
  } else if (allFailed) {
    logger.error("incident-notify-failed", { type, results, record });
  } else {
    logger.info("incident-notified", { type, results });
  }

  // Second line so the local log shows both the incident and whether
  // anyone was actually told about it — this is what answers "was the
  // Slack/ClickUp message even sent" without cross-referencing CloudWatch.
  appendFlagRecord({ type: `${type}-notify-result`, time: logger.nowIST(), results });

  return results;
}

module.exports = { flagIncident, FLAGGED_LOG_PATH };
