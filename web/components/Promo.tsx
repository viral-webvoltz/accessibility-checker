import { BRAND } from "@/lib/brand";
import { LogoMark } from "./Logo";

export function Promo() {
  return (
    <section className="promo" id="about" aria-labelledby="promo-title">
      <div className="promo-main">
        <p className="eyebrow">Built by</p>
        <h2 id="promo-title" className="promo-name">
          <LogoMark size={40} /> {BRAND.name}
        </h2>
        <p className="promo-role">{BRAND.role}</p>
        <p className="promo-pitch">{BRAND.pitch}</p>
        <p className="promo-open">
          <span className="pulse" aria-hidden="true" /> {BRAND.openTo} · {BRAND.location}
        </p>
        <div className="promo-links">
          <a className="btn btn-primary" href={`mailto:${BRAND.email}?subject=Hi%20Viral`}>
            Hire me
          </a>
          <a className="btn btn-ghost" href={BRAND.links.portfolio} target="_blank" rel="noopener noreferrer">
            Portfolio
          </a>
          <a className="btn btn-ghost" href={BRAND.links.resume} target="_blank" rel="noopener noreferrer">
            Resume
          </a>
          <a className="btn btn-ghost" href={BRAND.links.linkedin} target="_blank" rel="noopener noreferrer">
            LinkedIn
          </a>
          <a className="btn btn-ghost" href={BRAND.links.github} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </div>
      </div>
      <ul className="promo-stats">
        {BRAND.highlights.map((h) => (
          <li key={h.label}>
            <span className="promo-stat-value">{h.value}</span>
            <span className="promo-stat-label">{h.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
