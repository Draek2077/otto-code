/**
 * A self-contained React component: a countdown to the next high tide.
 * Exercises JSX, hooks, generics and prop typing.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";

interface TideClockProps {
  /** When the next high water arrives. */
  highWaterAt: Date;
  /** Shown while the clock is still settling. */
  placeholder?: string;
  onSlackWater?: () => void;
}

function formatGap(milliseconds: number): string {
  if (milliseconds <= 0) {
    return "slack water";
  }
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function TideClock({
  highWaterAt,
  placeholder = "…",
  onSlackWater,
}: TideClockProps): ReactElement {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const remaining = useMemo(
    () => (now ? highWaterAt.getTime() - now.getTime() : null),
    [highWaterAt, now],
  );

  useEffect(() => {
    if (remaining !== null && remaining <= 0) {
      onSlackWater?.();
    }
  }, [remaining, onSlackWater]);

  return (
    <figure className="tide-clock" data-state={remaining && remaining > 0 ? "waiting" : "slack"}>
      <figcaption>Next high water</figcaption>
      <output aria-live="polite">{remaining === null ? placeholder : formatGap(remaining)}</output>
      {remaining !== null && remaining < 3_600_000 && (
        <p className="tide-clock__warning">Under an hour — secure the tender.</p>
      )}
    </figure>
  );
}
