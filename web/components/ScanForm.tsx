"use client";
import { useCallback, useState, type FormEvent } from "react";
import { Turnstile, TURNSTILE_SITE_KEY } from "./Turnstile";
import type { ScanRequest } from "@/lib/types";

const MAX_URLS = 5;

export function ScanForm({ onSubmit, disabled }: { onSubmit: (req: ScanRequest) => void; disabled: boolean }) {
  const [urls, setUrls] = useState<string[]>([""]);
  const [crawl, setCrawl] = useState(false);
  const [maxPages, setMaxPages] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const handleToken = useCallback((t: string | null) => setToken(t), []);

  const update = (i: number, value: string) => setUrls((prev) => prev.map((u, j) => (j === i ? value : u)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = urls
      .map((u) => u.trim())
      .filter(Boolean)
      .map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`));
    const bad = cleaned.find((u) => {
      try {
        return !new URL(u).hostname.includes(".");
      } catch {
        return true;
      }
    });
    if (cleaned.length === 0) return setError("Enter a website address to scan.");
    if (bad) return setError(`"${bad}" doesn't look like a website address.`);
    if (TURNSTILE_SITE_KEY && !token) return setError("Please complete the human check first.");
    setError(null);
    onSubmit({ urls: cleaned, crawl: cleaned.length === 1 && crawl, maxPages, turnstileToken: token || undefined });
  };

  return (
    <form className="scan-form" onSubmit={submit} noValidate aria-describedby={error ? "form-error" : undefined}>
      <fieldset disabled={disabled}>
        <legend className="visually-hidden">Websites to scan</legend>
        <div className="url-list">
          {urls.map((u, i) => (
            <div className="url-row" key={i}>
              <label htmlFor={`url-${i}`} className="visually-hidden">
                Website {i + 1}
              </label>
              <span className="url-prefix" aria-hidden="true">
                https://
              </span>
              <input
                id={`url-${i}`}
                type="text"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                placeholder="yourwebsite.com"
                value={u.replace(/^https?:\/\//i, "")}
                onChange={(e) => update(i, e.target.value)}
                aria-invalid={Boolean(error)}
              />
              {urls.length > 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove website ${i + 1}`}
                  onClick={() => setUrls((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="form-row">
          {urls.length < MAX_URLS && (
            <button type="button" className="link-btn" onClick={() => setUrls((p) => [...p, ""])}>
              + Add another page
            </button>
          )}
          {urls.length === 1 && (
            <label className="check">
              <input type="checkbox" checked={crawl} onChange={(e) => setCrawl(e.target.checked)} />
              <span>
                Also scan linked pages
                {crawl && (
                  <>
                    {" "}
                    (up to{" "}
                    <select aria-label="Maximum pages" value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))}>
                      {[3, 5, 10].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>{" "}
                    pages)
                  </>
                )}
              </span>
            </label>
          )}
        </div>

        <Turnstile onToken={handleToken} />

        <button type="submit" className="btn btn-primary btn-lg">
          {disabled ? "Scanning…" : "Run free scan"}
        </button>
      </fieldset>
      {error && (
        <p id="form-error" className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
