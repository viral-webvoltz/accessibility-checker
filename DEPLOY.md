# Deploying

| Piece | Where | What it is |
|---|---|---|
| Scanner (repo root) | AWS Lambda (container image) behind a Function URL with response streaming | Headless Chromium + axe-core. `POST /api/scan` streams progress as newline-delimited JSON. |
| Frontend (`web/`) | Vercel | Next.js app. Calls the Function URL straight from the browser. |

```
Browser ──POST /api/scan──▶ Lambda Function URL ──▶ guard (origin · bot check · rate limits) ──▶ Chromium scan
   ▲                                                                                              │
   └────────────────────────────── NDJSON progress stream ◀───────────────────────────────────────┘
```

## What you need

**For AWS**
- An AWS account, and an IAM user or SSO role that can create CloudFormation stacks, Lambda, ECR, DynamoDB, IAM roles, CloudWatch Logs and Budgets (AdministratorAccess is simplest for a personal account).
- AWS CLI v2: `brew install awscli`, then `aws configure` (or `aws configure sso`).
- AWS SAM CLI: `brew install aws-sam-cli`.
- Docker Desktop, running. On an Apple Silicon Mac the arm64 image builds natively.

**For the frontend**
- A Vercel account connected to your GitHub repo.
- Optional but recommended: a free Cloudflare account to create a **Turnstile** widget. You'll get a site key (goes to Vercel) and a secret key (goes to AWS).

## Deploy order

The scanner only accepts requests from your exact frontend URL, so get that URL first.

### 1. Create the Vercel project (gets you the URL)

In Vercel: **Add New → Project →** pick the repo → set **Root Directory = `web`** → Deploy.
You now have a production URL such as `https://a11y-checker.vercel.app`. Scans won't work yet; that's expected.

### 2. (Optional) Create a Turnstile widget

Cloudflare dashboard → **Turnstile → Add widget** → hostname = your Vercel domain (add `localhost` too if you want it locally) → mode **Managed**. Copy the **site key** and the **secret key**.

### 3. Deploy the scanner

```bash
# repo root, Docker running, AWS credentials configured
sam build
sam deploy --guided
```

`--guided` asks for each parameter and saves your answers in `samconfig.toml`:

| Prompt | Enter |
|---|---|
| Stack name / Region | defaults are `a11y-checker` / `ap-south-1` (Mumbai); change if you like |
| `AllowedOrigin` | your Vercel URL, e.g. `https://a11y-checker.vercel.app` (no trailing slash) |
| `AlertEmail` | where budget alerts go (confirm the AWS email you'll get) |
| `MonthlyBudgetUsd` | `5` |
| `ReservedConcurrency` | `2` (see troubleshooting if it fails) |
| `ScansPerIpPerHour` / `PerDay` / `ScansPerDayGlobal` | `5` / `20` / `100` |
| `TurnstileSecret` | the secret from step 2, or leave empty |
| "ScannerFunction Function Url has no authentication. Is this okay?" | `y`. Protection is the guard below, not IAM. |
| Create managed ECR repositories | `y` |

When it finishes, copy the **`ScannerUrl`** output, e.g. `https://abc123.lambda-url.ap-south-1.on.aws/`.

```bash
curl https://abc123.lambda-url.ap-south-1.on.aws/health   # {"success":true,"status":"ok"}
```

Later deploys are just `sam build && sam deploy`.

### 4. Point the frontend at it

Vercel → Project → **Settings → Environment Variables** (Production):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SCANNER_URL` | the `ScannerUrl` output (trailing slash is fine) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key, or leave unset |

Then **Deployments → Redeploy**. `NEXT_PUBLIC_*` values are baked in at build time, so a redeploy is required.

## How cost and abuse are kept in check

Everything below runs **before Chromium starts**, so a rejected request costs a few milliseconds.

| Layer | What it does |
|---|---|
| Origin check | Requests must come from `AllowedOrigin`. Stops other websites from using your scanner. |
| Turnstile (optional) | A one-time human check on the form, verified server-side. Stops scripts that call the URL directly. This is the only layer that does. |
| Per-IP limits | 5 scans/hour and 20/day per IP (DynamoDB counters that expire on their own). |
| Global daily cap | 100 scans/day for everyone combined. **This is the hard cost ceiling.** |
| Reserved concurrency | At most 2 scans at the same time; extra requests get HTTP 429 for free. |
| Small jobs | ≤10 pages, ≤5 URLs, 2 tabs, 2 GB memory, 3-minute timeout. |
| Budget alert | Email at 80% (forecast) and 100% (actual) of your monthly budget. Alerts only; it doesn't stop anything. |
| Log retention | CloudWatch logs kept 7 days. |

### Expected bill

Lambda arm64 costs about $0.0000133 per GB-second. The always-free tier covers 400,000 GB-seconds and 1M requests a month.

| Scan | Rough cost |
|---|---|
| 1 page (~15 s × 2 GB) | ~$0.0004 |
| 5-page crawl (~45 s × 2 GB) | ~$0.0012 |

- **Typical use** (a few hundred scans a month) stays inside the free tier: about **$0–0.20/month**, mostly ECR image storage (~$0.10/GB-month).
- **Absolute worst case**: someone hits the 100/day cap every day and every scan runs the full 3 minutes. That's ~1.1M GB-s/month, so **about $9/month**. Lower `ScansPerDayGlobal` to lower that ceiling linearly (50/day ≈ $4).
- DynamoDB, the Function URL, and data transfer at this volume: effectively $0.

## Troubleshooting

- **`decreases account's UnreservedConcurrentExecution below its minimum value of [10]`**: new accounts often have a total limit of 10 and can't reserve any. Redeploy with `ReservedConcurrency=none` (`sam deploy --parameter-overrides ReservedConcurrency=none`). The daily cap still bounds cost. You can ask AWS Support (Service Quotas → Lambda → Concurrent executions) to raise the account limit to 1000 for free, then set it back to 2.
- **Scans fail with "only accepts requests from its own website"**: `AllowedOrigin` doesn't exactly match the browser's origin. Vercel *preview* URLs are different domains; only the production domain is allowed. Add a custom domain and use that as `AllowedOrigin` if you prefer.
- **CORS error in the browser console**: same cause as above. CORS is configured on the Function URL from `AllowedOrigin`.
- **"The human check expired"**: Turnstile tokens are single-use and last 5 minutes. Start a new scan from the form.
- **Chromium fails to launch**: `Dockerfile.lambda` pins `@sparticuz/chromium@152.0.0` to match Puppeteer 25 (Chrome 150). Keep them in step when upgrading Puppeteer.

## Sites behind Cloudflare / bot protection

The scanner waits up to 20 s for Cloudflare's automatic "checking your browser" step to pass. Sites that require an interactive check, or block AWS IP ranges, will still be blocked. Lambda IPs are flagged more often than home connections. For those, the results page offers a one-line snippet that runs the same audit in the visitor's own browser and downloads the report locally (`web/public/a11y-scan.js`, rebuilt with `npm run build:standalone`).

## Local development

```bash
npm install && npm run dev                                   # scanner on :4000 (no rate limits locally)
cd web && cp .env.example .env.local && npm install && npm run dev   # app on :3000
```
