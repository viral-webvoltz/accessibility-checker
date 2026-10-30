"use client";
import { BrowserFrame } from "./BrowserFrame";
import { hostOf, pathOf } from "@/lib/format";

export type PageState = {
  url: string;
  state: "queued" | "running" | "done" | "failed";
  message?: string;
  challenge?: "waiting" | "cleared" | "blocked";
  vendor?: string;
  score?: number;
  reason?: string;
};

interface Props {
  pages: PageState[];
  total: number;
  completed: number;
  statusMessage: string;
  preview: { url: string; screenshot: string | null; title: string } | null;
  elapsedMs: number;
  onCancel: () => void;
}

const STEPS = ["Open browser", "Load pages", "Run checks", "Build report"];

export function ScanProgress({ pages, total, completed, statusMessage, preview, elapsedMs, onCancel }: Props) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const step = pages.length === 0 ? 0 : completed < total ? (pages.some((p) => p.message?.includes("accessibility")) ? 2 : 1) : 3;
  const challenge = pages.find((p) => p.challenge === "waiting");

  return (
    <section className="card progress" aria-labelledby="progress-title">
      <div className="progress-head">
        <div>
          <p className="eyebrow">Scan in progress · {Math.floor(elapsedMs / 1000)}s</p>
          <h2 id="progress-title">{preview ? hostOf(preview.url) : "Getting ready…"}</h2>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <ol className="stepper" aria-label="Scan steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? "is-done" : i === step ? "is-active" : ""} aria-current={i === step ? "step" : undefined}>
            <span className="stepper-dot" aria-hidden="true" />
            {s}
          </li>
        ))}
      </ol>

      <div
        className="bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Pages scanned"
      >
        <span style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <p className="progress-status" aria-live="polite">
        {statusMessage} {total > 0 && <span className="muted">· {completed} of {total} pages</span>}
      </p>

      {challenge && (
        <p className="notice notice-warn" role="status">
          {challenge.vendor} is running a &ldquo;checking your browser&rdquo; step on {hostOf(challenge.url)}. Waiting for it
          to pass by itself…
        </p>
      )}

      <div className="progress-grid">
        <BrowserFrame url={preview ? preview.url : "about:blank"} scanning>
          {preview?.screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.screenshot} alt={`Screenshot of ${preview.title || preview.url}`} />
          ) : (
            <div className="frame-placeholder">Loading the page…</div>
          )}
        </BrowserFrame>

        <ul className="page-queue" aria-label="Pages">
          {pages.map((p) => (
            <li key={p.url} className={`q-${p.state}`}>
              <span className="q-icon" aria-hidden="true">
                {p.state === "done" ? "✓" : p.state === "failed" ? "!" : p.state === "running" ? "" : "·"}
              </span>
              <span className="q-url" title={p.url}>
                {pathOf(p.url)}
              </span>
              <span className="q-meta">
                {p.state === "done" && p.score !== undefined
                  ? `${p.score}`
                  : p.state === "failed"
                    ? p.reason === "bot-challenge"
                      ? "blocked"
                      : "failed"
                    : p.state === "running"
                      ? p.message || "working"
                      : "queued"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
