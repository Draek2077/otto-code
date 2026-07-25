/**
 * A self-contained React component in plain JavaScript: a star that twinkles.
 * Exercises JSX, hooks, default props and inline styles.
 */
import { useEffect, useState } from "react";

const PHASES = ["✦", "✧", "✶", "✷"];

export function Twinkle({ label = "Vega", magnitude = 0.03, periodMs = 900 }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setPhase((current) => (current + 1) % PHASES.length);
    }, periodMs);
    return () => clearInterval(timer);
  }, [periodMs]);

  // Brighter stars have *lower* magnitudes, which is astronomy's little joke.
  const brightness = Math.max(0.25, 1 - magnitude / 6);

  return (
    <span
      className="twinkle"
      title={`${label} — magnitude ${magnitude}`}
      style={{ opacity: brightness, fontSize: `${1 + brightness}rem` }}
    >
      {PHASES[phase]}
      <span className="twinkle__label"> {label}</span>
    </span>
  );
}

export default function Sky() {
  return (
    <div className="sky">
      <Twinkle label="Sirius" magnitude={-1.46} periodMs={700} />
      <Twinkle label="Vega" magnitude={0.03} />
      <Twinkle label="Betelgeuse" magnitude={0.5} periodMs={1400} />
    </div>
  );
}
