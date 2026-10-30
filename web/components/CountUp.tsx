"use client";
import { useCountUp } from "./useCountUp";

export function CountUp({ value, decimals = 0, delayMs = 0 }: { value: number; decimals?: number; delayMs?: number }) {
  const v = useCountUp(value, 1200, delayMs);
  return <>{v.toFixed(decimals)}</>;
}
