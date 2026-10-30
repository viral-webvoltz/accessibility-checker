"use client";
import { useEffect, useState } from "react";

// Shown when bot protection blocks the automated browser. The user runs the
// same audit from their own (already trusted) browser tab instead; the script
// builds the report in their browser and downloads it.
export function ManualScan({ urls }: { urls: string[] }) {
  const [snippet, setSnippet] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSnippet(`fetch("${window.location.origin}/a11y-scan.js").then(r => r.text()).then(eval);`);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <section className="card manual" aria-labelledby="manual-title">
      <h3 id="manual-title">Scan it from your own browser instead</h3>
      <p>
        {urls.length ? urls.join(", ") : "This site"} only lets real visitors through. Your browser already passes that
        check, so the same audit can run there:
      </p>
      <ol>
        <li>Open the site in a new tab and complete any check it shows.</li>
        <li>
          Open DevTools (<kbd>F12</kbd> or <kbd>⌘ ⌥ I</kbd>) and go to the <strong>Console</strong> tab.
        </li>
        <li>Paste the line below and press Enter. The report downloads when it finishes.</li>
      </ol>
      <div className="snippet">
        <code>{snippet}</code>
        <button type="button" className="btn btn-ghost" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </section>
  );
}
