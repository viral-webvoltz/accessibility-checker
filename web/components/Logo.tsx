export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="8" className="logo-bg" />
      <path d="M6.5 9.5 11 22.5 15.5 9.5" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="logo-ink" />
      <path d="M18.5 9.5v13h2a6.5 6.5 0 0 0 0-13z" fill="none" strokeWidth="2.6" strokeLinejoin="round" className="logo-ink" />
    </svg>
  );
}
