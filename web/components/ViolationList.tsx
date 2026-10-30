"use client";
import { useState } from "react";
import type { Impact, Violation } from "@/lib/types";
import { IMPACT_LABEL, wcagLabels } from "@/lib/format";

const IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];

export function ViolationList({ violations, fixed = false }: { violations: Violation[]; fixed?: boolean }) {
  const [filter, setFilter] = useState<Impact | "all">("all");
  const shown = filter === "all" ? violations : violations.filter((v) => v.impact === filter);

  if (violations.length === 0) {
    return <p className="empty-good">No automated issues found on this page. 🎉 Manual testing is still recommended.</p>;
  }

  return (
    <div>
      <div className="chips" role="group" aria-label="Filter by severity">
        <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          All <span>{violations.length}</span>
        </button>
        {IMPACTS.map((imp) => {
          const n = violations.filter((v) => v.impact === imp).length;
          if (!n) return null;
          return (
            <button key={imp} type="button" className={`chip chip-${imp}`} aria-pressed={filter === imp} onClick={() => setFilter(imp)}>
              {IMPACT_LABEL[imp]} <span>{n}</span>
            </button>
          );
        })}
      </div>

      <ul className="issues">
        {shown.map((v, i) => (
          <IssueItem key={v.id} v={v} fixed={fixed} index={i} />
        ))}
      </ul>
    </div>
  );
}

function IssueItem({ v, fixed, index }: { v: Violation; fixed: boolean; index: number }) {
  const { criteria, level, bestPractice } = wcagLabels(v.tags);
  const hasShot = v.nodes.some((n) => n.screenshot);
  return (
    <li className={`issue impact-${v.impact}${fixed ? " is-fixed" : ""}`} style={{ transitionDelay: `${Math.min(index, 12) * 45}ms` }}>
      <details>
        <summary>
          <span className={`badge badge-${fixed ? "fixed" : v.impact}`}>{fixed ? "✓ Fixed" : IMPACT_LABEL[v.impact]}</span>
          <span className="issue-title">{v.help}</span>
          <span className="issue-count">
            {v.nodeCount} element{v.nodeCount === 1 ? "" : "s"}
          </span>
        </summary>
        <div className="issue-body">
          <p>{v.description}</p>
          <div className="tags">
            {criteria.map((c) => (
              <span key={c} className="tag">
                WCAG {c}
              </span>
            ))}
            {level && <span className="tag">{level}</span>}
            {bestPractice && <span className="tag">Best practice</span>}
            {v.custom && <span className="tag tag-accent">Custom rule</span>}
            <a className="tag tag-link" href={v.helpUrl} target="_blank" rel="noopener noreferrer">
              How to fix ↗
            </a>
          </div>

          {!hasShot && (
            <p className="muted small no-shot">
              No screenshot: this problem isn&apos;t something you can see on the page (for example, it&apos;s in the page&apos;s
              code or hidden from view).
            </p>
          )}
          <ol className="nodes">
            {v.nodes.map((n, i) => (
              <li key={i} className="node">
                {n.screenshot && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="node-shot" src={n.screenshot} alt={`Highlighted element ${i + 1} for: ${v.help}`} />
                )}
                <div className="node-info">
                  <code className="node-html">{n.html}</code>
                  {n.failureSummary && <p className="node-fix">{n.failureSummary}</p>}
                </div>
              </li>
            ))}
          </ol>
          {v.nodeCount > v.nodes.length && (
            <p className="muted small">
              +{v.nodeCount - v.nodes.length} more elements in the full report.
            </p>
          )}
        </div>
      </details>
    </li>
  );
}
