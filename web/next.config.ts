import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

function originOf(url: string | undefined) {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

const scannerOrigin = originOf(process.env.NEXT_PUBLIC_SCANNER_URL);
const turnstile = "https://challenges.cloudflare.com";

// The scan stream goes to the Lambda Function URL; Turnstile is the only
// third-party script. 'unsafe-inline' covers Next's inline bootstrap and the
// theme script (no nonces on a static app). Dev mode needs eval + websockets,
// so the policy is only sent in production.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${turnstile}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${scannerOrigin} ${turnstile}`.trim(),
  `frame-src ${turnstile}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  ...(isProd ? [{ key: "Content-Security-Policy", value: csp }] : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The manual-scan script is loaded from other sites' DevTools consoles.
        source: "/a11y-scan.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
    ];
  },
};

export default nextConfig;
