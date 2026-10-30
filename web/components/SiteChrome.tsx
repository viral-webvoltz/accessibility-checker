import { BRAND } from "@/lib/brand";
import { LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap site-header-inner">
        <a href="/" className="brand" aria-label={`${BRAND.product} by ${BRAND.name}, home`}>
          <LogoMark />
          <span className="brand-text">
            <span className="brand-product">{BRAND.product}</span>
            <span className="brand-by">by {BRAND.name}</span>
          </span>
        </a>
        <nav className="site-nav" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#about">About me</a>
          <a href={BRAND.links.portfolio} target="_blank" rel="noopener noreferrer">
            Portfolio ↗
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap site-footer-inner">
        <p>
          Designed &amp; developed by{" "}
          <a href={BRAND.links.portfolio} target="_blank" rel="noopener noreferrer">
            {BRAND.name}
          </a>{" "}
          · © {new Date().getFullYear()}
        </p>
        <p className="muted">
          Powered by axe-core. Automated checks catch many issues, not all — pair them with manual testing.
        </p>
      </div>
    </footer>
  );
}
