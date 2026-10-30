export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="8" className="logo-bg" />
      <circle cx="16" cy="8.6" r="2.4" className="logo-dot" />
      <path
        d="M8.5 12.6 16 14l7.5-1.4M16 14v5.6M16 19.6l-3.6 6M16 19.6l3.6 6"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="logo-ink"
      />
    </svg>
  );
}
