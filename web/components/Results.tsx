"use client";
import { useMemo, useState } from "react";
import type { Failure, ScannedPage } from "@/lib/types";
import { hostOf, pathOf } from "@/lib/format";
import { ScoreGauge } from "./ScoreGauge";
import { CountUp } from "./CountUp";
import { BrowserFrame } from "./BrowserFrame";
import { ViolationList } from "./ViolationList";
import { PerformancePanel } from "./PerformancePanel";
import { PillSwitch } from "./PillSwitch";

type View = "accessibility" | "performance";

interface Props {
  pages: ScannedPage[];
  failures: Failure[];
  report: { filename: string; html: string } | null;
  durationMs: number;
  onReset: () => void;
}

function avg(nums: number[]) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
}

export function Results({ pages, failures, report, durationMs, onReset }: Props) {
  const [view, setView] = useState<View>("accessibility");
  const [selected, setSelected] = useState(0);
  // Bumped on every toggle so the gauges remount and animate up again.
  const [replay, setReplay] = useState(0);
  const page = pages[Math.min(selected, pages.length - 1)];

  const totals = useMemo(() => {
    const t = { critical: 0, serious: 0, moderate: 0, minor: 0, passes: 0, elements: 0 };
    for (const p of pages) {
      t.critical += p.counts.critical;
      t.serious += p.counts.serious;
      t.moderate += p.counts.moderate;
      t.minor += p.counts.minor;
      t.passes += p.counts.passes;
      t.elements += p.counts.affectedElements;
    }
    return t;
  }, [pages]);

  const a11yScore = pages.length > 1 ? avg(pages.map((p) => p.score)) : page.score;
  const perfScores = pages.map((p) => p.performance?.score).filter((s): s is number => typeof s === "number");
  const perfScore = pages.length > 1 ? avg(perfScores) : page.performance?.score ?? 0;

  const switchView = (v: View) => {
    setView(v);
    setReplay((n) => n + 1);
  };

  const download = () => {
    if (!report) return;
    const blob = new Blob([report.html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = report.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const openReport = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
  };

  return (
    <section className="results" aria-labelledby="results-title">
      <div className="results-head">
        <div>
          <p className="eyebrow">
            Scan complete · {pages.length} page{pages.length === 1 ? "" : "s"} · {Math.round(durationMs / 1000)}s
          </p>
          <h2 id="results-title">{hostOf(pages[0].finalUrl || pages[0].url)}</h2>
        </div>
        <div className="results-actions">
          {report && (
            <>
              <button type="button" className="btn btn-ghost" onClick={openReport}>
                Open full report
              </button>
              <button type="button" className="btn btn-primary" onClick={download}>
                Download report
              </button>
            </>
          )}
          <button type="button" className="btn btn-ghost" onClick={onReset}>
            New scan
          </button>
        </div>
      </div>

      <PillSwitch
        on={view === "performance"}
        onChange={(on) => switchView(on ? "performance" : "accessibility")}
        title="See how your site performs ⚡"
        hint={view === "performance" ? "Showing performance scores" : "Showing accessibility scores"}
      />

      <div className="card overview" key={`${view}-${replay}`}>
        <ScoreGauge
          score={view === "accessibility" ? a11yScore : perfScore}
          label={view === "accessibility" ? "Accessibility score" : "Performance score"}
          size="lg"
        />
        {view === "accessibility" ? (
          <dl className="sev-grid">
            {(["critical", "serious", "moderate", "minor"] as const).map((k, i) => (
              <div key={k} className={`sev sev-${k}`}>
                <dt>{k[0].toUpperCase() + k.slice(1)}</dt>
                <dd>
                  <CountUp value={totals[k]} delayMs={i * 100} />
                </dd>
              </div>
            ))}
            <div className="sev sev-pass">
              <dt>Checks passed</dt>
              <dd>
                <CountUp value={totals.passes} delayMs={400} />
              </dd>
            </div>
            <div className="sev">
              <dt>Elements affected</dt>
              <dd>
                <CountUp value={totals.elements} delayMs={500} />
              </dd>
            </div>
          </dl>
        ) : (
          <div className="overview-copy">
            <p>
              How fast the {pages.length > 1 ? "pages load" : "page loads"} on desktop: first paint, the main content,
              how long the page is frozen by scripts, and how much it jumps around.
            </p>
            <p className="muted small">90+ is good · 50–89 needs work · under 50 is poor</p>
          </div>
        )}
      </div>

      {failures.length > 0 && (
        <p className="notice notice-warn">
          {failures.length} page{failures.length === 1 ? "" : "s"} couldn&apos;t be scanned:{" "}
          {failures.map((f) => `${pathOf(f.url)} (${f.reason === "bot-challenge" ? "blocked by bot protection" : f.reason})`).join(", ")}
        </p>
      )}

      <div className={pages.length > 1 ? "results-layout" : ""}>
        {pages.length > 1 && (
          <nav className="page-nav" aria-label="Scanned pages">
            {pages.map((p, i) => (
              <button key={p.url} type="button" aria-current={i === selected ? "page" : undefined} onClick={() => setSelected(i)}>
                <span className="page-nav-path">{pathOf(p.finalUrl || p.url)}</span>
                <span className={`page-nav-score tone-${(view === "accessibility" ? p.score : p.performance?.score ?? 0) >= 90 ? "good" : (view === "accessibility" ? p.score : p.performance?.score ?? 0) >= 50 ? "ok" : "bad"}`}>
                  {view === "accessibility" ? p.score : p.performance?.score ?? "—"}
                </span>
              </button>
            ))}
          </nav>
        )}

        <div className="card page-detail">
          <div className="page-detail-head">
            <BrowserFrame url={page.finalUrl || page.url}>
              {page.screenshot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={page.screenshot} alt={`Screenshot of ${page.title || page.url}`} />
              ) : (
                <div className="frame-placeholder">No screenshot</div>
              )}
            </BrowserFrame>
            <div>
              <h3>{page.title || pathOf(page.url)}</h3>
              <p className="muted small break">{page.finalUrl || page.url}</p>
              <div className="mini-gauges" key={`${view}-${replay}-${selected}`}>
                <ScoreGauge score={page.score} label="Accessibility" size="sm" />
                {page.performance && <ScoreGauge score={page.performance.score} label="Performance" size="sm" delayMs={120} />}
              </div>
              <p className="muted small">
                {page.counts.violations} issue types · {page.counts.affectedElements} elements affected · {page.counts.passes} checks passed
              </p>
            </div>
          </div>

          <div key={`${view}-${replay}-${selected}-body`}>
            {view === "accessibility" ? (
              <>
                <h4 className="section-title">
                  Issues found <span className="muted">({page.counts.violations})</span>
                </h4>
                <ViolationList violations={page.violations} />
              </>
            ) : (
              <>
                <h4 className="section-title">Core metrics</h4>
                <PerformancePanel perf={page.performance} />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
