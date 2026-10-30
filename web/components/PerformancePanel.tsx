"use client";
import type { Performance } from "@/lib/types";
import { METRIC_INFO, formatBytes, formatMs, scoreTone } from "@/lib/format";
import { ScoreGauge } from "./ScoreGauge";
import { CountUp } from "./CountUp";

export function PerformancePanel({ perf }: { perf: Performance | null }) {
  if (!perf) {
    return <p className="muted">Performance metrics weren&apos;t available for this page.</p>;
  }
  const keys = ["fcp", "lcp", "tbt", "cls"] as const;

  return (
    <div className="perf">
      <div className="perf-gauges">
        {keys.map((k, i) => {
          const m = perf.metrics[k];
          if (!m) return null;
          return (
            <div key={k} className={`metric tone-${scoreTone(m.score)}`}>
              <ScoreGauge score={m.score} label={METRIC_INFO[k].short} size="sm" delayMs={150 + i * 120} />
              <div className="metric-text">
                <span className="metric-value">
                  {k === "cls" ? <CountUp value={m.value} decimals={3} delayMs={150 + i * 120} /> : formatMs(m.value)}
                </span>
                <span className="metric-name">{METRIC_INFO[k].name}</span>
              </div>
            </div>
          );
        })}
      </div>

      <dl className="stats">
        <div>
          <dt>Server response (TTFB)</dt>
          <dd>{formatMs(perf.ttfb)}</dd>
        </div>
        <div>
          <dt>Fully loaded</dt>
          <dd>{formatMs(perf.load)}</dd>
        </div>
        <div>
          <dt>Requests</dt>
          <dd>{perf.requests ?? "—"}</dd>
        </div>
        <div>
          <dt>Page weight</dt>
          <dd>{formatBytes(perf.transferBytes)}</dd>
        </div>
      </dl>
      <p className="muted small">
        Lab estimate on desktop, measured during the scan using Lighthouse&apos;s scoring curves. Real-user numbers can
        differ.
      </p>
    </div>
  );
}
