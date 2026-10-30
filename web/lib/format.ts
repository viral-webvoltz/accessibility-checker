import type { Impact } from "./types";

export function scoreTone(score: number): "good" | "ok" | "bad" {
  if (score >= 90) return "good";
  if (score >= 50) return "ok";
  return "bad";
}

export function formatMs(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function pathOf(url: string) {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

export const IMPACT_LABEL: Record<Impact, string> = {
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
};

// axe tags -> readable WCAG labels, e.g. wcag143 -> "WCAG 1.4.3", wcag21aa -> "WCAG 2.1 AA".
export function wcagLabels(tags: string[]) {
  const criteria: string[] = [];
  let level: string | null = null;
  let bestPractice = false;
  for (const tag of tags) {
    const c = tag.match(/^wcag(\d)(\d)(\d{1,2})$/);
    if (c) criteria.push(`${c[1]}.${c[2]}.${c[3]}`);
    const l = tag.match(/^wcag(2\d?)(a{1,3})$/);
    if (l && !level) level = `WCAG ${l[1].length === 1 ? "2.0" : `2.${l[1][1]}`} ${l[2].toUpperCase()}`;
    if (tag === "best-practice") bestPractice = true;
  }
  return { criteria, level, bestPractice };
}

export const METRIC_INFO = {
  fcp: { name: "First Contentful Paint", short: "FCP", unit: "ms" },
  lcp: { name: "Largest Contentful Paint", short: "LCP", unit: "ms" },
  tbt: { name: "Total Blocking Time", short: "TBT", unit: "ms" },
  cls: { name: "Cumulative Layout Shift", short: "CLS", unit: "" },
} as const;
