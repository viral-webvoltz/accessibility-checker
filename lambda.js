// AWS Lambda entry point. Deploy as a container image (Dockerfile.lambda)
// behind a Function URL with InvokeMode=RESPONSE_STREAM, so scan progress
// streams to the browser as newline-delimited JSON while the scan runs.
//
// CORS is configured on the Function URL itself (see deploy/README), which
// also answers OPTIONS preflights without invoking this function.
//
// Routes:
//   POST /api/scan   { urls: string[], crawl?: boolean, maxPages?: number }
//   GET  /health
const { streamScan } = require("./scanStream");
const { closeBrowser } = require("./scanner");
const logger = require("./logger");

/* global awslambda */
exports.handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const method = event.requestContext?.http?.method || "GET";
  const path = event.rawPath || "/";

  const open = (statusCode, contentType) =>
    awslambda.HttpResponseStream.from(responseStream, {
      statusCode,
      headers: { "Content-Type": contentType, "Cache-Control": "no-cache, no-transform" },
    });

  const sendJson = (statusCode, payload) => {
    const stream = open(statusCode, "application/json");
    stream.write(JSON.stringify(payload));
    stream.end();
  };

  if (method === "GET" && (path === "/" || path === "/health")) {
    return sendJson(200, { success: true, status: "ok" });
  }
  if (method !== "POST" || path !== "/api/scan") {
    return sendJson(404, { success: false, message: "Not found" });
  }

  let body;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "{}";
    body = JSON.parse(raw);
  } catch {
    return sendJson(400, { success: false, message: "Request body must be JSON" });
  }

  const stream = open(200, "application/x-ndjson; charset=utf-8");
  const write = (evt) => stream.write(JSON.stringify(evt) + "\n");

  try {
    write({ type: "status", stage: "queued", message: "Scan accepted" });
    await streamScan(body, write);
  } catch (err) {
    logger.error("lambda-scan-crashed", { error: err.message, stack: err.stack });
    write({ type: "error", message: "The scanner hit an unexpected error. Please try again." });
  } finally {
    // Timers don't run while Lambda is frozen, so never leave Chrome running
    // between invocations.
    await closeBrowser();
    stream.end();
  }
});
