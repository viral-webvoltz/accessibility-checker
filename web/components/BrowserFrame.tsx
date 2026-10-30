import type { ReactNode } from "react";

export function BrowserFrame({ url, children, scanning }: { url: string; children: ReactNode; scanning?: boolean }) {
  return (
    <div className={`frame${scanning ? " is-scanning" : ""}`}>
      <div className="frame-bar" aria-hidden="true">
        <span className="frame-dot" />
        <span className="frame-dot" />
        <span className="frame-dot" />
        <span className="frame-url">{url}</span>
      </div>
      <div className="frame-body">
        {children}
        {scanning && <span className="frame-sweep" aria-hidden="true" />}
      </div>
    </div>
  );
}
