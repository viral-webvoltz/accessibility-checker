"use client";

interface Props {
  on: boolean;
  onChange: (on: boolean) => void;
  title: string;
  hint: string;
}

// Big ON/OFF switch with a sliding knob and a hand-drawn arrow pointing at it.
export function PillSwitch({ on, onChange, title, hint }: Props) {
  return (
    <div className="pill-wrap">
      <p className="pill-title" id="pill-title">
        {title}
      </p>
      <div className="pill-row">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="pill-title"
          className={`pill${on ? " is-on" : ""}`}
          onClick={() => onChange(!on)}
        >
          <span className="pill-knob" aria-hidden="true">
            {on ? "ON" : "OFF"}
          </span>
        </button>
        <svg className="pill-arrow" viewBox="0 0 90 60" aria-hidden="true">
          <path d="M84 4c-4 22-22 40-60 44" fill="none" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M32 38 20 48l14 6" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="pill-hint" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}
