"use client";
import { useEffect, useRef, useState } from "react";

// Animates a number towards `target` (ease-out): from 0 on first mount, then
// from the current value whenever target changes. Jumps straight to the value
// for people who prefer reduced motion.
export function useCountUp(target: number, durationMs = 1400, delayMs = 0) {
  const [value, setValue] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now + delayMs;
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      current.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, delayMs]);

  return value;
}
