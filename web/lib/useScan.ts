"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Failure, ScanEvent, ScanRequest, ScannedPage } from "./types";
import { streamScan } from "./scan";
import type { PageState } from "@/components/ScanProgress";

export type Phase = "idle" | "scanning" | "done" | "error";

// All live-scan state: feeds stream events into progress, results and errors.
export function useScan() {
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
  // Set once the stream sends "done" or "error", so a clean finish can be
  // told apart from a stream that was cut off (e.g. a Lambda timeout).
  const finishedRef = useRef(false);

  useEffect(() => {
    if (phase !== "scanning") return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
        finishedRef.current = true;
        setDuration(e.durationMs);
        setFailures(e.failures);
        setPhase("done");
        break;
      case "error": {
        finishedRef.current = true;
        const blocked = (e.failures || []).filter((f) => f.reason === "bot-challenge").map((f) => f.url);
        setError({ message: e.message, blocked });
        setPhase("error");
        break;
      }
    }
  }, []);

  const start = useCallback(
    async (req: ScanRequest) => {
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
    },
    [handleEvent]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setDuration(Date.now() - startedAt);
    setPhase((p) => (p === "scanning" ? "idle" : p));
  }, [startedAt]);

  const blockedUrls = [
    ...(error?.blocked || []),
    ...(phase === "done" ? failures.filter((f) => f.reason === "bot-challenge").map((f) => f.url) : []),
  ];

  return { phase, queue, total, completed, status, preview, pages, failures, report, error, elapsed, duration, blockedUrls, start, cancel };
}

// Scan settings <-> URL query (?url=a&url=b&crawl=1&max=10).
export function requestToQuery(req: ScanRequest) {
  const q = new URLSearchParams();
  req.urls.forEach((u) => q.append("url", u));
  if (req.crawl) {
    q.set("crawl", "1");
    q.set("max", String(req.maxPages));
  }
  return q.toString();
}

export function queryToRequest(params: URLSearchParams): ScanRequest | null {
  const urls = params.getAll("url").filter(Boolean).slice(0, 10);
  if (!urls.length) return null;
  return {
    urls,
    crawl: urls.length === 1 && params.get("crawl") === "1",
    maxPages: Math.min(Math.max(parseInt(params.get("max") || "10") || 10, 1), 30),
  };
}
