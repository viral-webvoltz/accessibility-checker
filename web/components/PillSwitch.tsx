"use client";

interface Props {
  on: boolean;
  onChange: (on: boolean) => void;
  title: string;
  hint: string;
}

// Compact ON/OFF switch with a sliding knob, label on the left.
export function PillSwitch({ on, onChange, title, hint }: Props) {
  return (
    <div className="pill-wrap">
      <div className="pill-text">
        <p className="pill-title" id="pill-title">
          {title}
        </p>
        <p className="pill-hint" aria-live="polite">
          {hint}
        </p>
      </div>
      <div className="pill-row">
        <span className="pill-state" aria-hidden="true">
          {on ? "After fixes" : "Current"}
        </span>
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
      </div>
    </div>
  );
}
