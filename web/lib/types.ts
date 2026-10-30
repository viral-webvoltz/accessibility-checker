export type Impact = "critical" | "serious" | "moderate" | "minor";

export interface ViolationNode {
  target: unknown[];
  html: string;
  failureSummary?: string;
  screenshot: string | null;
}

export interface Violation {
  id: string;
  impact: Impact;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  custom: boolean;
  nodeCount: number;
  nodes: ViolationNode[];
}

export interface MetricScore {
  value: number;
  score: number;
}

export interface Performance {
  score: number;
  metrics: Partial<Record<"fcp" | "lcp" | "tbt" | "cls", MetricScore>>;
  ttfb: number | null;
  domContentLoaded: number | null;
  load: number | null;
  requests: number | null;
  transferBytes: number | null;
  failedRequests: number | null;
}

export interface ScannedPage {
  url: string;
  finalUrl: string;
  title: string;
  screenshot: string | null;
  score: number;
  counts: {
    violations: number;
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    affectedElements: number;
    passes: number;
    incomplete: number;
    inapplicable: number;
  };
  violations: Violation[];
  passes: { id: string; help: string }[];
  performance: Performance | null;
}

export interface Failure {
  url: string;
  reason: string;
  status?: number;
  vendor?: string;
  detail?: string;
}

export type ScanEvent =
  | { type: "status"; stage: string; message: string }
  | { type: "plan"; urls: string[]; total: number }
  | { type: "page-start"; url: string; total: number }
  | { type: "page-progress"; url: string; stage: string; message: string }
  | { type: "challenge"; url: string; vendor: string; state: "waiting" | "cleared" | "blocked" }
  | { type: "page-preview"; url: string; finalUrl: string; title: string; screenshot: string | null }
  | { type: "page-complete"; page: ScannedPage; completed: number; total: number }
  | ({ type: "page-failed"; completed: number; total: number } & Failure)
  | { type: "report"; filename: string; html: string }
  | {
      type: "done";
      durationMs: number;
      pagesScanned: number;
      failures: Failure[];
      accessibilityScore: number | null;
      performanceScore: number | null;
    }
  | { type: "error"; message: string; failures?: Failure[]; botBlocked?: boolean };

export interface ScanRequest {
  urls: string[];
  crawl: boolean;
  maxPages: number;
}
