// Request guard for the Lambda deployment: origin check, optional
// Cloudflare Turnstile bot check, and DynamoDB-backed rate limits
// (per IP per hour, per IP per day, and a global daily cap that acts as
// a hard cost ceiling). Everything here runs before Chromium launches, so
// a rejected request costs a few milliseconds of Lambda time.
//
// Env:
//   ALLOWED_ORIGIN          frontend origin, e.g. https://app.vercel.app ("*" disables the check)
//   RATE_TABLE              DynamoDB table name (unset → rate limiting off, e.g. local dev)
//   SCANS_PER_IP_PER_HOUR   default 5
//   SCANS_PER_IP_PER_DAY    default 20
//   SCANS_PER_DAY_GLOBAL    default 100
//   TURNSTILE_SECRET        Cloudflare Turnstile secret (unset → bot check off)
const { DynamoDBClient, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const logger = require("./logger");

const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || "*").replace(/\/+$/, "");
const RATE_TABLE = process.env.RATE_TABLE || "";
const PER_IP_HOUR = parseInt(process.env.SCANS_PER_IP_PER_HOUR) || 5;
const PER_IP_DAY = parseInt(process.env.SCANS_PER_IP_PER_DAY) || 20;
const GLOBAL_DAY = parseInt(process.env.SCANS_PER_DAY_GLOBAL) || 100;
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || "";

const ddb = RATE_TABLE ? new DynamoDBClient({}) : null;

class Rejection extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function checkOrigin(origin) {
  if (ALLOWED_ORIGIN === "*") return;
  if ((origin || "").replace(/\/+$/, "") !== ALLOWED_ORIGIN) {
    throw new Rejection(403, "forbidden-origin", "This scanner only accepts requests from its own website.");
  }
}

async function checkTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) return;
  if (!token) throw new Rejection(403, "bot-check-missing", "Please complete the human check and start the scan again.");
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip || "" }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    if (data.success) return;
    logger.warn("turnstile-failed", { codes: data["error-codes"] });
  } catch (err) {
    logger.warn("turnstile-error", { error: err.message });
  }
  throw new Rejection(403, "bot-check-failed", "The human check expired or failed. Go back and start the scan again.");
}

// Atomically adds 1 to a counter unless it has reached `limit`.
// Returns false when the limit is hit.
async function consume(key, limit, ttlSeconds) {
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: RATE_TABLE,
        Key: { pk: { S: key } },
        UpdateExpression: "ADD #c :one SET expiresAt = if_not_exists(expiresAt, :exp)",
        ConditionExpression: "attribute_not_exists(#c) OR #c < :limit",
        ExpressionAttributeNames: { "#c": "count" },
        ExpressionAttributeValues: {
          ":one": { N: "1" },
          ":limit": { N: String(limit) },
          ":exp": { N: String(Math.floor(Date.now() / 1000) + ttlSeconds) },
        },
      })
    );
    return true;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return false;
    // Fail closed: if we can't count, don't run an unbounded scan.
    logger.error("rate-limit-store-error", { error: err.message });
    throw new Rejection(503, "rate-limit-unavailable", "The scanner is busy right now. Please try again in a minute.");
  }
}

async function checkRateLimits(ip) {
  if (!ddb) return;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  const who = ip || "unknown";

  if (!(await consume(`ip#${who}#h#${hour}`, PER_IP_HOUR, 2 * 3600))) {
    throw new Rejection(429, "rate-limited", `You've reached the limit of ${PER_IP_HOUR} scans per hour. Please try again later.`);
  }
  if (!(await consume(`ip#${who}#d#${day}`, PER_IP_DAY, 2 * 86400))) {
    throw new Rejection(429, "rate-limited", `You've reached the limit of ${PER_IP_DAY} scans per day. Please come back tomorrow.`);
  }
  if (!(await consume(`global#d#${day}`, GLOBAL_DAY, 2 * 86400))) {
    logger.warn("global-daily-cap-reached", { cap: GLOBAL_DAY });
    throw new Rejection(429, "daily-cap", "The scanner has reached its daily limit. Please try again tomorrow.");
  }
}

// Throws a Rejection (with .status/.code) if the request must not run.
async function guardScanRequest({ origin, ip, turnstileToken }) {
  checkOrigin(origin);
  await checkTurnstile(turnstileToken, ip);
  await checkRateLimits(ip);
}

module.exports = { guardScanRequest, Rejection };
