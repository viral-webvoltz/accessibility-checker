"use client";
import { scoreTone } from "@/lib/format";
import { useCountUp } from "./useCountUp";

interface Props {
  score: number;
  label: string;
  size?: "lg" | "md" | "sm";
  delayMs?: number;
}

// Circular score ring that fills and counts up from 0 when it mounts.
// Remount it (change its `key`) to replay the animation.
export function ScoreGauge({ score, label, size = "md", delayMs = 0 }: Props) {
  const animated = useCountUp(score, 1500, delayMs);
  const tone = scoreTone(score);
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - animated / 100);

  return (
    <figure className={`gauge gauge-${size} tone-${tone}`}>
      <svg viewBox="0 0 120 120" role="img" aria-label={`${label}: ${score} out of 100`}>
        <circle className="gauge-track" cx="60" cy="60" r={r} />
        <circle
          className="gauge-fill"
          cx="60"
          cy="60"
          r={r}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="60" className="gauge-num" dominantBaseline="central" textAnchor="middle" aria-hidden="true">
          {Math.round(animated)}
        </text>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
