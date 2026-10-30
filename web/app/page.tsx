"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ScanRequest } from "@/lib/types";
import { requestToQuery } from "@/lib/useScan";
import { ScanForm } from "@/components/ScanForm";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export default function Home() {
  const router = useRouter();
  const [going, setGoing] = useState(false);

  const start = (req: ScanRequest) => {
    setGoing(true);
    router.push(`/scan?${requestToQuery(req)}`);
  };

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
            <ScanForm onSubmit={start} disabled={going} />
          </div>
        </section>

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
              <h3>See it fixed</h3>
              <p>Flip the switch to see your score with every issue fixed, next to your performance score.</p>
            </li>
          </ol>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
