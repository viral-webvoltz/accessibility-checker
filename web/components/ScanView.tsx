"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { queryToRequest, useScan } from "@/lib/useScan";
import { ScanProgress } from "./ScanProgress";
import { Results } from "./Results";
import { ManualScan } from "./ManualScan";

// The /scan page: starts the scan described in the URL and shows progress,
// then results. Reloading the page runs the scan again.
export function ScanView() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const req = useMemo(() => queryToRequest(new URLSearchParams(query)), [query]);
  const scan = useScan();
  const { start } = scan;
  const focusRef = useRef<HTMLDivElement>(null);

  // Start (or restart) whenever the query changes. useScan aborts the
  // in-flight scan on unmount, so React's dev double-mount just restarts it.
  useEffect(() => {
    if (!req) return;
    let turnstileToken: string | undefined;
    try {
      turnstileToken = sessionStorage.getItem("turnstileToken") || undefined;
    } catch {}
    start({ ...req, turnstileToken });
  }, [req, start]);

  // Tokens are single-use: once a scan has finished, drop it so a reload
  // sends the user back through the form instead of failing silently.
  useEffect(() => {
    if (scan.phase === "done" || scan.phase === "error") {
      try {
        sessionStorage.removeItem("turnstileToken");
      } catch {}
    }
  }, [scan.phase]);

  useEffect(() => {
    if (scan.phase === "done" || scan.phase === "error") {
      window.scrollTo({ top: 0 });
      focusRef.current?.focus();
    }
  }, [scan.phase]);

  const goHome = () => router.push("/");

  if (!req) {
    return (
      <div className="wrap">
        <div className="card notice-error" role="alert">
          <h2>No website to scan</h2>
          <p>
            Go back to the <Link href="/">home page</Link> and enter a website address.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap" ref={focusRef} tabIndex={-1} style={{ outline: "none" }}>
      {scan.phase === "scanning" && (
        <ScanProgress
          pages={scan.queue}
          total={scan.total}
          completed={scan.completed}
          statusMessage={scan.status}
          preview={scan.preview}
          elapsedMs={scan.elapsed}
          onCancel={() => {
            scan.cancel();
            goHome();
          }}
        />
      )}

      {scan.phase === "error" && scan.error && (
        <div className="card notice-error" role="alert">
          <h2>We couldn&apos;t finish that scan</h2>
          <p>{scan.error.message}</p>
          <div className="error-actions">
            <button type="button" className="btn btn-primary" onClick={goHome}>
              Start a new scan
            </button>
          </div>
        </div>
      )}

      {scan.phase === "done" && scan.pages.length > 0 && (
        <Results pages={scan.pages} failures={scan.failures} report={scan.report} durationMs={scan.duration} onReset={goHome} />
      )}

      {scan.blockedUrls.length > 0 && scan.phase !== "scanning" && <ManualScan urls={scan.blockedUrls} />}
    </div>
  );
}
