/**
 * A tiny tide predictor. Self-contained: no imports, no I/O.
 * Exercises generics, unions, enums, decorated types and template literals.
 */

type Port = "eddystone" | "fastnet" | "rubjerg";

const enum Phase {
  Rising = "rising",
  Falling = "falling",
}

interface Reading<T extends string = Port> {
  readonly port: T;
  readonly heightMetres: number;
  readonly takenAt: Date;
  phase?: Phase;
}

type Summary<T> = {
  [K in keyof T as `summary_${string & K}`]: string;
};

const HARMONIC_PERIOD_HOURS = 12.4206;

function predict(base: number, amplitude: number, hoursFromHigh: number): number {
  const angle = (2 * Math.PI * hoursFromHigh) / HARMONIC_PERIOD_HOURS;
  return Number((base + amplitude * Math.cos(angle)).toFixed(2));
}

function classify(previous: number, next: number): Phase {
  return next >= previous ? Phase.Rising : Phase.Falling;
}

export function forecast(port: Port, hours = 6): Reading<Port>[] {
  const readings: Reading<Port>[] = [];
  let previous = predict(3.4, 2.7, 0);

  for (let hour = 1; hour <= hours; hour += 1) {
    const heightMetres = predict(3.4, 2.7, hour);
    readings.push({
      port,
      heightMetres,
      takenAt: new Date(Date.UTC(2026, 6, 25, hour)),
      phase: classify(previous, heightMetres),
    });
    previous = heightMetres;
  }

  return readings;
}

// A satisfying one-liner: the highest water in the window.
export const peak = (readings: Reading[]): Reading | undefined =>
  readings.reduce<Reading | undefined>(
    (best, reading) => (!best || reading.heightMetres > best.heightMetres ? reading : best),
    undefined,
  );
