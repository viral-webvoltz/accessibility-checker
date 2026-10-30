"use client";
import { useMemo, useRef, useState } from "react";
import type { Failure, Impact, ScannedPage } from "@/lib/types";
import { IMPACT_LABEL, hostOf, pathOf, scoreTone } from "@/lib/format";
import { ScoreGauge } from "./ScoreGauge";
import { CountUp } from "./CountUp";
import { BrowserFrame } from "./BrowserFrame";
import { ViolationList } from "./ViolationList";
import { PerformancePanel } from "./PerformancePanel";
import { PillSwitch } from "./PillSwitch";

interface Props {
  pages: ScannedPage[];
  failures: Failure[];
  report: { filename: string; html: string } | null;
  durationMs: number;
  onReset: () => void;
}

const IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];

function avg(nums: number[]) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

// Score once every automated violation is fixed: those rules become passes,
// so only "needs review" items keep it below 100. Same formula as the report.
export function fixedScore(p: ScannedPage) {
  const { passes, violations, incomplete } = p.counts;
  const total = passes + violations + incomplete;
  return total === 0 ? 100 : Math.round(((passes + violations) / total) * 100);
}

export function Results({ pages, failures, report, durationMs, onReset }: Props) {
  const [fixed, setFixed] = useState(false);
  const [selected, setSelected] = useState(0);
  const detailRef = useRef<HTMLDivElement>(null);
  const multi = pages.length > 1;
  const page = pages[Math.min(selected, pages.length - 1)];

  const totals = useMemo(() => {
    const t = { critical: 0, serious: 0, moderate: 0, minor: 0, passes: 0, elements: 0, violations: 0 };
    for (const p of pages) {
      for (const k of IMPACTS) t[k] += p.counts[k];
      t.passes += p.counts.passes;
      t.elements += p.counts.affectedElements;
      t.violations += p.counts.violations;
    }
    return t;
  }, [pages]);

  // Issues grouped by rule across every page.
  const siteIssues = useMemo(() => {
    const map = new Map<string, { id: string; help: string; impact: Impact; pages: number; elements: number }>();
    for (const p of pages) {
      for (const v of p.violations) {
        const row = map.get(v.id) || { id: v.id, help: v.help, impact: v.impact, pages: 0, elements: 0 };
        row.pages += 1;
        row.elements += v.nodeCount;
        map.set(v.id, row);
      }
    }
    const rank = { critical: 4, serious: 3, moderate: 2, minor: 1 };
    return [...map.values()].sort((a, b) => rank[b.impact] - rank[a.impact] || b.pages - a.pages);
  }, [pages]);

  const currentA11y = avg(pages.map((p) => p.score)) ?? 0;
  const fixedA11y = avg(pages.map(fixedScore)) ?? 100;
  const a11yShown = fixed ? fixedA11y : currentA11y;
  const perfScore = avg(pages.map((p) => p.performance?.score).filter((s): s is number => typeof s === "number"));

  const download = () => {
    if (!report) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([report.html], { type: "text/html" }));
    a.download = report.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const openReport = () => {
    if (!report) return;
    window.open(URL.createObjectURL(new Blob([report.html], { type: "text/html" })), "_blank", "noopener");
  };

  const selectPage = (i: number) => {
    setSelected(i);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <section className={`results${fixed ? " is-fixed" : ""}`} aria-labelledby="results-title">
      <div className="results-head">
        <div>
          <p className="eyebrow">
            Scan complete · {pages.length} page{multi ? "s" : ""} · {Math.round(durationMs / 1000)}s
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

      {/* ---------- Score hero with the "what if it was fixed" switch ---------- */}
      <div className="card score-hero">
        <PillSwitch
          on={fixed}
          onChange={setFixed}
          title="See your score with every accessibility issue fixed 🚀"
          hint={
            fixed
              ? `Accessibility score goes from ${currentA11y} to ${fixedA11y} once the ${siteIssues.length} issue type${siteIssues.length === 1 ? "" : "s"} below are fixed.`
              : "Turn it on to see the score after fixes."
          }
        />

        <div className="score-row">
          <div className="score-main">
            <ScoreGauge
              score={a11yShown}
              label={fixed ? "Accessibility after fixes" : "Accessibility"}
              size="lg"
              note={fixed && fixedA11y > currentA11y ? `+${fixedA11y - currentA11y} points` : undefined}
            />
          </div>
          {perfScore !== null && (
            <div className="score-main">
              <ScoreGauge score={perfScore} label="Performance" size="lg" delayMs={150} />
            </div>
          )}
          <dl className="sev-grid">
            {IMPACTS.map((k, i) => (
              <div key={k} className={`sev sev-${k}`}>
                <dt>{IMPACT_LABEL[k]}</dt>
                <dd>
                  <CountUp value={fixed ? 0 : totals[k]} delayMs={i * 90} />
                </dd>
              </div>
            ))}
            <div className="sev sev-pass">
              <dt>Checks passed</dt>
              <dd>
                <CountUp value={fixed ? totals.passes + totals.violations : totals.passes} delayMs={360} />
              </dd>
            </div>
            <div className="sev">
              <dt>Elements affected</dt>
              <dd>
                <CountUp value={fixed ? 0 : totals.elements} delayMs={450} />
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {failures.length > 0 && (
        <p className="notice notice-warn">
          {failures.length} page{failures.length === 1 ? "" : "s"} couldn&apos;t be scanned:{" "}
          {failures.map((f) => `${pathOf(f.url)} (${f.reason === "bot-challenge" ? "blocked by bot protection" : f.reason})`).join(", ")}
        </p>
      )}

      {/* ---------- Multi-page: all pages + issues across the site ---------- */}
      {multi && (
        <div className="site-grid">
          <div className="card">
            <h3 className="section-title">All pages</h3>
            <div className="table-scroll">
              <table className="pages-table">
                <thead>
                  <tr>
                    <th scope="col">Page</th>
                    <th scope="col">Accessibility</th>
                    <th scope="col">Performance</th>
                    <th scope="col">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p, i) => {
                    const a = fixed ? fixedScore(p) : p.score;
                    return (
                      <tr key={p.url} className={i === selected ? "is-selected" : ""}>
                        <th scope="row">
                          <button type="button" className="row-link" onClick={() => selectPage(i)} aria-current={i === selected ? "true" : undefined}>
                            {pathOf(p.finalUrl || p.url)}
                          </button>
                        </th>
                        <td>
                          <span className={`score-pill tone-${scoreTone(a)}`}>{a}</span>
                        </td>
                        <td>
                          {p.performance ? (
                            <span className={`score-pill tone-${scoreTone(p.performance.score)}`}>{p.performance.score}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <span className="sev-dots">
                            {IMPACTS.map((k) =>
                              p.counts[k] ? (
                                <span key={k} className={`sev-dot sev-${k}`} title={`${p.counts[k]} ${k}`}>
                                  {fixed ? 0 : p.counts[k]}
                                </span>
                              ) : null
                            )}
                            {p.counts.violations === 0 && <span className="muted">none</span>}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3 className="section-title">Issues across the site</h3>
            {siteIssues.length === 0 ? (
              <p className="empty-good">No automated issues on any page.</p>
            ) : (
              <ul className="site-issues">
                {siteIssues.map((row) => (
                  <li key={row.id} className={fixed ? "is-fixed" : ""}>
                    <span className={`badge badge-${fixed ? "fixed" : row.impact}`}>{fixed ? "Fixed" : IMPACT_LABEL[row.impact]}</span>
                    <span className="site-issue-title">{row.help}</span>
                    <span className="muted small">
                      {row.pages}/{pages.length} pages · {row.elements} elements
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ---------- Full detail for one page: screenshot, performance, issues ---------- */}
      <div className="card page-detail" ref={detailRef}>
        {multi && (
          <label className="page-picker">
            <span>Page</span>
            <select value={selected} onChange={(e) => setSelected(Number(e.target.value))}>
              {pages.map((p, i) => (
                <option key={p.url} value={i}>
                  {pathOf(p.finalUrl || p.url)}
                </option>
              ))}
            </select>
          </label>
        )}

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
            <div className="mini-gauges">
              <ScoreGauge score={fixed ? fixedScore(page) : page.score} label="Accessibility" size="sm" />
              {page.performance && <ScoreGauge score={page.performance.score} label="Performance" size="sm" delayMs={120} />}
            </div>
            <p className="muted small">
              {page.counts.violations} issue types · {page.counts.affectedElements} elements · {page.counts.passes} checks passed ·{" "}
              {page.counts.incomplete} need review
            </p>
          </div>
        </div>

        <h4 className="section-title">Performance</h4>
        <PerformancePanel perf={page.performance} />

        <h4 className="section-title spaced">
          Accessibility issues <span className="muted">({page.counts.violations})</span>
        </h4>
        <ViolationList violations={page.violations} fixed={fixed} />

        {page.passes.length > 0 && (
          <details className="passes">
            <summary>
              <span className="badge badge-fixed">Passed</span> {page.passes.length} checks passed on this page
            </summary>
            <ul>
              {page.passes.map((p) => (
                <li key={p.id}>✓ {p.help}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
