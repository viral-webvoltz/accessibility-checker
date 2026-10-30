import type { ScanEvent, ScanRequest } from "./types";

export const SCANNER_URL = (process.env.NEXT_PUBLIC_SCANNER_URL || "http://localhost:4000").replace(/\/+$/, "");

// Starts a scan and calls onEvent for each newline-delimited JSON event as it
// arrives. Resolves when the stream ends.
export async function streamScan(req: ScanRequest, onEvent: (e: ScanEvent) => void, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${SCANNER_URL}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new Error("Couldn't reach the scanner. Check your connection and try again.");
  }
  if (!res.ok || !res.body) throw new Error(`The scanner responded with HTTP ${res.status}.`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const flush = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(JSON.parse(trimmed) as ScanEvent);
    } catch {
      // ignore a malformed line rather than killing the whole scan
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      flush(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  flush(buffer);
}
