import { Suspense } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { ScanView } from "@/components/ScanView";

export const metadata = { title: "Scan results" };

export default function ScanPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="scan-main">
        <Suspense fallback={null}>
          <ScanView />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
