"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Failure, ScanEvent, ScanRequest, ScannedPage } from "@/lib/types";
import { streamScan } from "@/lib/scan";
import { ScanForm } from "@/components/ScanForm";
import { ScanProgress, type PageState } from "@/components/ScanProgress";
import { Results } from "@/components/Results";
import { ManualScan } from "@/components/ManualScan";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

type Phase = "idle" | "scanning" | "done" | "error";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [queue, setQueue] = useState<PageState[]>([]);
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [status, setStatus] = useState("Starting…");
  const [preview, setPreview] = useState<{ url: string; screenshot: string | null; title: string } | null>(null);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [report, setReport] = useState<{ filename: string; html: string } | null>(null);
  const [error, setError] = useState<{ message: string; blocked: string[] } | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // Set once the stream sends "done" or "error", so we can tell a clean
  // finish from a stream that was cut off (e.g. a Lambda timeout).
  const finishedRef = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== "scanning") return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  useEffect(() => {
    if (phase === "done" || phase === "error") resultsRef.current?.focus();
  }, [phase]);

  const patch = (url: string, change: Partial<PageState>) =>
    setQueue((q) => q.map((p) => (p.url === url ? { ...p, ...change } : p)));

  const handleEvent = useCallback((e: ScanEvent) => {
    switch (e.type) {
      case "status":
        setStatus(e.message);
        break;
      case "plan":
        setTotal(e.total);
        setQueue((q) => {
          const known = new Map(q.map((p) => [p.url, p]));
          return e.urls.map((url) => known.get(url) || { url, state: "queued" });
        });
        break;
      case "page-start":
        patch(e.url, { state: "running", message: "starting" });
        break;
      case "page-progress":
        patch(e.url, { message: e.message.toLowerCase() });
        setStatus(e.message);
        break;
      case "challenge":
        patch(e.url, { challenge: e.state, vendor: e.vendor });
        break;
      case "page-preview":
        setPreview({ url: e.finalUrl, screenshot: e.screenshot, title: e.title });
        break;
      case "page-complete":
        setPages((p) => [...p, e.page]);
        setCompleted(e.completed);
        patch(e.page.url, { state: "done", score: e.page.score });
        break;
      case "page-failed":
        setCompleted(e.completed);
        setFailures((f) => [...f, e]);
        patch(e.url, { state: "failed", reason: e.reason });
        break;
      case "report":
        setReport({ filename: e.filename, html: e.html });
        setStatus("Building your report");
        break;
      case "done":
        setDuration(e.durationMs);
        setFailures(e.failures);
        finishedRef.current = true;
        setPhase("done");
        break;
      case "error": {
        const blocked = (e.failures || []).filter((f) => f.reason === "bot-challenge").map((f) => f.url);
        finishedRef.current = true;
        setError({ message: e.message, blocked });
        setPhase("error");
        break;
      }
    }
  }, []);

  const start = async (req: ScanRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    finishedRef.current = false;
    setPhase("scanning");
    setQueue(req.urls.map((url) => ({ url, state: "queued" })));
    setTotal(req.urls.length);
    setCompleted(0);
    setStatus("Connecting to the scanner");
    setPreview(null);
    setPages([]);
    setFailures([]);
    setReport(null);
    setError(null);
    setStartedAt(Date.now());
    setElapsed(0);

    try {
      await streamScan(req, handleEvent, controller.signal);
      if (!finishedRef.current && !controller.signal.aborted) {
        setError({ message: "The scan stopped before it finished. Try fewer pages, or try again.", blocked: [] });
        setPhase("error");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError({ message: (err as Error).message, blocked: [] });
      setPhase("error");
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setPhase(pages.length ? "done" : "idle");
    setDuration(Date.now() - startedAt);
  };

  const reset = () => {
    setPhase("idle");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const blockedUrls = [
    ...(error?.blocked || []),
    ...(phase === "done" ? failures.filter((f) => f.reason === "bot-challenge").map((f) => f.url) : []),
  ];

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="hero">
          <div className="wrap">
            <p className="eyebrow">Free WCAG 2.2 audit · screenshots · performance</p>
            <h1>
              Find accessibility issues <span className="accent">before your users do.</span>
            </h1>
            <p className="lede">
              Enter a website and get a full accessibility audit in about a minute: every issue explained, the exact
              element highlighted on screen, and a performance score.
            </p>
            <ScanForm onSubmit={start} disabled={phase === "scanning"} />
          </div>
        </section>

        <div className="wrap" ref={resultsRef} tabIndex={-1} style={{ outline: "none" }}>
          {phase === "scanning" && (
            <ScanProgress
              pages={queue}
              total={total}
              completed={completed}
              statusMessage={status}
              preview={preview}
              elapsedMs={elapsed}
              onCancel={cancel}
            />
          )}

          {phase === "error" && error && (
            <div className="card notice-error" role="alert">
              <h2>We couldn&apos;t finish that scan</h2>
              <p>{error.message}</p>
            </div>
          )}

          {phase === "done" && pages.length > 0 && (
            <Results pages={pages} failures={failures} report={report} durationMs={duration} onReset={reset} />
          )}

          {blockedUrls.length > 0 && phase !== "scanning" && <ManualScan urls={blockedUrls} />}
        </div>

        <section className="wrap how" id="how" aria-labelledby="how-title">
          <h2 id="how-title">How it works</h2>
          <ol className="how-grid">
            <li>
              <span className="how-num">01</span>
              <h3>Real browser</h3>
              <p>Your page loads in a real Chromium browser, scrolls to the bottom, and waits for lazy content.</p>
            </li>
            <li>
              <span className="how-num">02</span>
              <h3>90+ checks</h3>
              <p>axe-core plus custom rules test it against WCAG 2.0, 2.1 and 2.2 at levels A and AA.</p>
            </li>
            <li>
              <span className="how-num">03</span>
              <h3>See the problem</h3>
              <p>Each issue comes with a screenshot of the element, the code, and how to fix it.</p>
            </li>
            <li>
              <span className="how-num">04</span>
              <h3>Speed, too</h3>
              <p>Flip to Performance for paint times, blocking time and layout shift, scored like Lighthouse.</p>
            </li>
          </ol>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
