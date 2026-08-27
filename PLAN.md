# Automation Plan: Lead → Report → Email

## Pipeline

```
Instantly lead → n8n webhook → audit-lambda (audit + render + upload) → S3 → CloudFront (live domain)
↓
n8n appends {email, reportUrl} to Sheet
↓
n8n generates + sends email → updates row
```

**One Lambda, no EC2.** `audit-lambda` crawls/audits pages with Puppeteer, builds the report JSON, calls the existing `buildHtmlReport()` in-process to render HTML, and uploads the finished HTML straight to S3 — then returns the live report URL to n8n. n8n's only backend call is that one Function URL invocation; everything else (Sheets, email) stays in n8n as before.

## Why this shape

- `reportTemplate.js`'s `buildHtmlReport()` has **zero Node-specific dependencies** (no `require`, `fs`, `Buffer`, `process`) — it's a pure `(report JSON) → HTML string` function. Calling it inline inside `audit-lambda` costs nothing (no extra runtime, no meaningful size/cold-start impact), so a separate `render-lambda` was never earning its keep — it would have just been a function call plus one S3 upload, neither of which needs its own deployable service.
- Serving the report as a plain static HTML object (rather than a client-rendered SPA fetching JSON) means CloudFront can serve it directly by S3 key — **no routing/SPA-fallback config needed**. That ruled out the client-render alternative, which would've needed a small CloudFront routing rule for pretty URLs in exchange for decoupling template deploys from the scanner container. Given report styling changes rarely, that trade wasn't worth the added infra.
- One Lambda also means n8n makes a single HTTP call to get a finished report URL back, instead of chaining two Function URLs.
- Trade-off accepted: a report-template/branding tweak now requires rebuilding and pushing the full container image (with Chromium) to ECR, rather than a fast static-file deploy. Acceptable since the template changes infrequently relative to the scanning logic.
- The original design (one Lambda invocation, sequential page loop, 8-minute timeout) was hitting a **9% timeout failure rate** in production per the AWS cost model review. Fix: audit pages in **bounded-concurrency batches** (4-6 tabs at a time on one shared browser) instead of a sequential loop. This shortens wall-clock duration `D`, which both eliminates the timeout failures *and* lowers billed cost (Lambda bills `memory × duration`, so shorter `D` at the same 2GB `M` costs less). This is strictly better than fanning work out across separate Lambda invocations (e.g. Step Functions Map), which cuts wall-clock but not total billed GB-seconds (each invocation repays Chromium's launch cost) and adds infra that isn't needed here.
- The 2GB memory cap is unverified in production (per the cost doc) — confirm via CloudWatch max-memory-used once concurrent tabs are live, since running more tabs at once raises memory pressure.
- Switch to arm64 (Graviton) — `@sparticuz/chromium` supports it, ~20% cheaper per GB-second than the x86 pricing the cost model used. Free to build in now, matters once volume grows past the free tier (~995 jobs/month at current duration mix).
- CloudFront + S3 + Route53 (the "live domain" hosting) aren't in the cost model — low cost at current volume but a real line item to track as volume grows, unlike Lambda compute which has ~10x headroom before it costs anything.

## Logging & failure alerting

**Implemented locally already** (`logger.js`, `alerts.js`, wired into `index.js`) — carries over to `audit-lambda` unchanged, since both modules are plain Node with no Express/disk dependency beyond the local fallback log.

- `logger.js` — structured JSON-line logging to stdout/stderr instead of free-text `console.log`. Deliberately just console output: it's grep-able locally today, and on Lambda, console output *is* CloudWatch Logs, so no separate logging setup is needed for the migration.
- `alerts.js` — flags two kinds of incident to Slack and/or ClickUp (both optional, configured via `SLACK_WEBHOOK_URL` / `CLICKUP_API_TOKEN` + `CLICKUP_LIST_ID`; unset channels are just skipped):
  1. **`audit-failed`** — the whole audit request failed (bot-blocked, navigation error, or an unhandled crash in the `/audit` route)
  2. **`low-page-yield`** — a crawl that was allowed to go deeper (`maxPages` higher than what it found) came back with fewer than `LOW_PAGE_YIELD_THRESHOLD` (default 5) pages — likely a link-discovery problem rather than a genuinely small site, worth checking locally rather than trusting the 20-page cap was actually being used
- **Notification-loss handling**: every incident is written to a local JSONL file (`logs/flagged-sites.jsonl`) *first and unconditionally*, before Slack/ClickUp are attempted — so an incident is never silently lost even if both channels are down, misconfigured, or the HTTP call itself throws. Each channel gets one retry with backoff; the outcome (`sent` / `failed` / `skipped` per channel) is appended as a second JSONL line and also logged, so "was this even reported" is answerable without cross-referencing CloudWatch.
- On Lambda, `logs/flagged-sites.jsonl` lives on ephemeral `/tmp` — fine as a within-invocation fallback, but doesn't persist across invocations the way it does locally. Once volume is high enough that losing that fallback matters, swap the local-file write for an S3 append (small file per incident, or an SQS dead-letter-style queue) — not needed at current planning volume (100 jobs/month).

## Configuration (env vars)

Every operationally-tunable value now has a code default and an env override — see `.env.example` for the full list with defaults documented. Local secrets/tuning go in `.env` (gitignored); on Lambda these become the function's environment variables directly (Phase 2 below).

| Var | Default | What it tunes |
|---|---|---|
| `SLACK_WEBHOOK_URL` | unset (skipped) | Incoming webhook for `alerts.js` |
| `CLICKUP_API_TOKEN` / `CLICKUP_LIST_ID` | unset (skipped) | ClickUp task creation for `alerts.js` |
| `MAX_CRAWL_PAGES` | 20 | Default crawl depth when `?maxPages` isn't specified |
| `ABSOLUTE_MAX_PAGES` | 50 | Hard ceiling no request can exceed — the real cost/timeout guardrail |
| `AUDIT_CONCURRENCY` | 4 | Concurrent Chrome tabs during a crawl — memory dial, tune with Lambda memory |
| `PAGE_NAVIGATION_TIMEOUT_MS` | 10000 | Per-page nav timeout before it's counted as a failure |
| `BOT_CHALLENGE_TIMEOUT_MS` | 8000 | Wait time for a Cloudflare/WAF interstitial to clear |
| `LOW_PAGE_YIELD_THRESHOLD` | 5 | Below this (with room to crawl deeper), flags a `low-page-yield` incident |
| `BROWSER_IDLE_TIMEOUT_MS` | 60000 | How long an idle browser stays warm (Express-only; irrelevant once this logic is dropped for Lambda per Phase 2) |
| `SCAN_USER_AGENT` | a realistic Chrome UA string | Swap out if a site starts fingerprint-blocking it |
| `PUBLIC_BASE_URL`, `PORT`, `NODE_ENV`, `AUTO_OPEN_BROWSER`, `CHROME_BIN`/`CHROMIUM_BIN` | — | Pre-existing, unchanged |

## Status checklist

**Done, in the current codebase (Express app, not yet deployed to Lambda):**
- [x] Structured logging (`logger.js`) and Slack/ClickUp failure alerting with a durable local fallback log (`alerts.js`) — see "Logging & failure alerting" above
- [x] `audit-failed` and `low-page-yield` incident flags wired into `/audit`
- [x] Page-navigation timeout cut 60s → 10s (`PAGE_NAVIGATION_TIMEOUT_MS`)
- [x] Concurrent batching for both the multi-URL path and the single-URL crawl path (`mapWithConcurrency`, `AUDIT_CONCURRENCY`), with the conflicting `--renderer-process-limit=1` Chrome flag fixed
- [x] IST timestamps on all log/alert output
- [x] All operationally-tunable values moved to env vars with documented defaults (`.env.example`)

**Not started — everything AWS/infra-side.** No AWS account work, SAM template, or n8n workflow exists yet; that's Phase 0-4 below plus the DevOps asks.

**Not yet done, still local-only:**
- [ ] `trimPassNodeDetail()`-style trimming applied to the main `/audit` path — currently only exists on the manual-scan bundle (`index.js:836`)
- [ ] `page.setRequestInterception(true)` to block images/fonts/media during crawls

## Step-by-step setup

Infra is being stood up with **AWS SAM + CloudFormation** — everything below is expressed as template resources deployed via `sam build && sam deploy`, not manual console clicks. One `template.yaml` (SAM transform) covers all of it: `AWS::Serverless::Function` for `audit-lambda`, plain `AWS::CloudFront::Distribution` / `AWS::S3::Bucket` / `AWS::CertificateManager::Certificate` / `AWS::Route53::RecordSet` resources alongside it. See "What to ask DevOps for" below before starting — several of these steps need something only DevOps can grant.

### Phase 0 — AWS account & SAM project prep
- [ ] Confirm which AWS account/region this deploys into (`us-east-1`, matching the cost model's pricing basis) — ask DevOps
- [ ] Get a deploy identity (IAM user/role, or CI/CD OIDC role) scoped to CloudFormation, Lambda, ECR, S3, CloudFront, Route53, ACM, IAM (SAM needs IAM permissions to create the Lambda execution role the template defines), CloudWatch
- [ ] `sam init` the project (or hand-write `template.yaml`) with an `AWS::Serverless::Function` resource, `PackageType: Image`, pointing at a `Dockerfile` in this repo
- [ ] `samconfig.toml` per environment (at minimum: staging + production) if DevOps wants environment separation

### Phase 1 — S3 + CloudFront (the "live domain"), as template resources
- [ ] `AWS::S3::Bucket` for reports — private, no public website hosting
- [ ] `AWS::CloudFront::OriginAccessControl` + `AWS::CloudFront::Distribution` with the bucket as origin
- [ ] `AWS::CertificateManager::Certificate` in `us-east-1` for the reports subdomain (DNS-validated — needs the domain's hosted zone in Route53 for CloudFormation to auto-create the validation record; confirm with DevOps)
- [ ] `AWS::Route53::RecordSet` (or a manual DNS record, if DNS isn't on Route53) pointing the subdomain at the CloudFront distribution
- [ ] `sam deploy`, then verify: upload a test HTML file to the bucket, confirm it loads at `https://reports.yourdomain.com/...`

### Phase 2 — `audit-lambda`
- [ ] Swap `puppeteer` + `puppeteer-extra` → `puppeteer-core` + `@sparticuz/chromium` in `package.json`
- [ ] Replace `getChromeExecutablePath()` with `chromium.executablePath()` / `chromium.args` in the launch config (`index.js:47-100`)
- [x] ~~Change the crawl loop from sequential to bounded-concurrency batches~~ — **done locally**, see Status checklist above
- [ ] **Before raising `AUDIT_CONCURRENCY` above its default of 4**: load-test and check CloudWatch max-memory-used on the 2GB Lambda — each concurrent slot is a full Chrome renderer process, so this is a memory dial, not just a speed one. `AUDIT_CONCURRENCY` and Lambda memory should be tuned together, not independently.
- [ ] Apply `trimPassNodeDetail()`-style trimming to the main `/audit` path, not just the manual-scan bundle (currently only at `index.js:836`)
- [ ] Keep `buildHtmlReport()` from `reportTemplate.js` as-is — call it in-process right after the JSON report is assembled (no porting needed, it's already dependency-free)
- [ ] Replace `saveReport()`'s local `fs.writeFileSync` with an S3 `PutObjectCommand` upload of the rendered HTML; drop `REPORTS_DIR`, `cleanupOldReports()`, and `/reports/:id/download` entirely — there's no local disk to manage on Lambda
- [ ] Return the final `https://reports.yourdomain.com/...` URL in the Lambda response
- [ ] Add `page.setRequestInterception(true)` to block images/fonts/media (keep CSS — axe needs layout)
- [ ] Write a Lambda-specific Dockerfile (`FROM public.ecr.aws/lambda/nodejs:22`, arm64 base) — replace the current Dockerfile's system-Chrome apt install
- [ ] Define the function in `template.yaml`: arm64, 2GB memory to start, 300-420s timeout, `ReservedConcurrentExecutions: 5-10`
- [ ] IAM policy in the template: `s3:PutObject` on the reports bucket, plus CloudWatch Logs
- [ ] Set `SLACK_WEBHOOK_URL` / `CLICKUP_API_TOKEN` / `CLICKUP_LIST_ID` (and the other tuning vars from the Configuration table above) as `Environment.Variables` in the template — ask DevOps whether these should be plain env vars or pulled from Secrets Manager/SSM Parameter Store per their standard practice
- [ ] Attach a Function URL in the template (IAM-auth or shared-secret header, not public)
- [ ] `sam deploy`, then load-test with a real 20-page site, watch CloudWatch max memory used — bump memory if it runs close to the ceiling
- [ ] Confirm the batching fix keeps duration under timeout across a range of page counts

### Phase 3 — n8n workflow
- [ ] Webhook trigger node for the Instantly lead event
- [ ] HTTP Request node → `audit-lambda` Function URL, pass the lead's URL, wait for the report-URL response
- [ ] Google Sheets node → append row `{email, reportUrl, timestamp}`
- [ ] Email-generation logic → send the outreach email
- [ ] Google Sheets node → update the same row (match on report URL or email) with send status + timestamp
- [ ] Test the whole workflow manually with a sample payload before touching the live Instantly webhook

### Phase 4 — Go live
- [ ] Point Instantly's webhook at the n8n webhook URL
- [ ] Send one real test lead through end-to-end, verify the Sheet row and the email
- [ ] Watch CloudWatch for a few days at real volume, sanity-check against the cost model's planning case ($0/month expected up to ~995 jobs/month at this duration mix)

## What to ask DevOps for

- **AWS account & deploy identity** — which account/OU this lives in, and either an IAM deploy role/user scoped for `sam deploy` (CloudFormation, Lambda, ECR, S3, CloudFront, Route53, ACM, IAM, CloudWatch) or, preferably, a CI/CD pipeline with OIDC federation so no long-lived AWS keys sit on a laptop
- **Region confirmation** — `us-east-1` is assumed (matches the cost model); flag if DevOps standardizes elsewhere. Note: the CloudFront ACM cert must be in `us-east-1` regardless of where everything else runs
- **DNS for the reports subdomain** — is the domain's zone on Route53 (lets CloudFormation auto-validate the ACM cert and create the record)? If DNS lives elsewhere (Cloudflare, GoDaddy, etc.), ask DevOps to create the validation + CNAME/ALIAS records manually since the template can't reach it
- **ECR repository** — ask DevOps to create it (or confirm the deploy identity can create one via the template), plus whether image pushes happen from a CI/CD pipeline or locally
- **Secrets policy** — should `SLACK_WEBHOOK_URL` / `CLICKUP_API_TOKEN` be plain Lambda env vars (simplest) or Secrets Manager/SSM Parameter Store (if that's their standard for anything touching Slack/ClickUp credentials)?
- **Environment separation** — do they want staging + production as separate stacks/accounts, or one account with a `samconfig.toml` per environment?
- **CloudWatch Logs retention** — default is "never expire" (costs accrue forever); ask what retention period matches their policy (e.g. 30/90 days)
- **Cost/budget alerts** — ask for an AWS Budget or cost anomaly alarm tied to this workload, referencing the cost model's ~995 jobs/month free-tier edge as the threshold worth watching
- **Infra-level monitoring** — the app already alerts to Slack/ClickUp per failed *audit*; ask if DevOps wants separate CloudWatch Alarms for Lambda-level signals (errors, throttles, duration near timeout) wired into their existing on-call/ops tooling
- **Security review** — this Lambda fetches arbitrary third-party URLs by design (lead-submitted sites). SSRF protections already exist in code (`isUrlSafe()` blocks private/internal IP ranges), but worth flagging to DevOps/security given the function's job is literally to make outbound requests to arbitrary domains
