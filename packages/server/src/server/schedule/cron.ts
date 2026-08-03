import { parseCronExpression } from "@otto-code/protocol/schedule/cron-expression";
import type { ScheduleCadence } from "@otto-code/protocol/schedule/types";

interface CronDateParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

function startOfNextMinute(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes() + 1,
      0,
      0,
    ),
  );
}

function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new Error(`Invalid cron time zone: ${timeZone}`);
  }
}

function createCronDatePartsReader(timeZone: string | undefined): (date: Date) => CronDateParts {
  if (timeZone === undefined) {
    return (date: Date) => ({
      minute: date.getUTCMinutes(),
      hour: date.getUTCHours(),
      dayOfMonth: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      dayOfWeek: date.getUTCDay(),
    });
  }

  assertValidTimeZone(timeZone);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (date: Date) => {
    const values: Record<string, string> = {};
    for (const part of formatter.formatToParts(date)) {
      if (part.type !== "literal") {
        values[part.type] = part.value;
      }
    }

    const year = Number.parseInt(values.year, 10);
    const month = Number.parseInt(values.month, 10);
    const dayOfMonth = Number.parseInt(values.day, 10);

    return {
      minute: Number.parseInt(values.minute, 10),
      hour: Number.parseInt(values.hour, 10),
      dayOfMonth,
      month,
      dayOfWeek: new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay(),
    };
  };
}

export function validateScheduleCadence(cadence: ScheduleCadence): void {
  if (cadence.type === "cron") {
    parseCronExpression(cadence.expression);
    if (cadence.timezone !== undefined) {
      assertValidTimeZone(cadence.timezone);
    }
    // Satisfiability probe: reject expressions that can never fire (April 31,
    // February 30) at creation instead of at every later evaluation. Probed
    // without the timezone: date existence is timezone-independent, and the
    // UTC reader keeps the failure path from making half a million Intl calls.
    const probe = { type: "cron" as const, expression: cadence.expression };
    if (computeNextRunAtOrNull(probe, new Date()) === null) {
      throw new Error(
        `Cron expression has no matching run time within the next year: ${cadence.expression}`,
      );
    }
  }
}

export function computeNextRunAt(cadence: ScheduleCadence, after: Date): Date {
  const next = computeNextRunAtOrNull(cadence, after);
  if (next === null) {
    const expression = cadence.type === "cron" ? cadence.expression : `${cadence.everyMs}ms`;
    throw new Error(`Unable to compute next run time for cron expression: ${expression}`);
  }
  return next;
}

// Non-throwing sibling of computeNextRunAt: null means the cadence has no match
// within the next year (e.g. "0 0 31 4 *"). Persisted-data paths (tick, boot
// recovery) use this to deactivate a schedule instead of throwing mid-update.
export function computeNextRunAtOrNull(cadence: ScheduleCadence, after: Date): Date | null {
  if (cadence.type === "every") {
    // COMPAT(scheduleEveryMs): execute legacy persisted rolling intervals until the
    // compatibility floor reaches v0.2.0. Added in v0.2.0; remove after 2027-01-17.
    return new Date(after.getTime() + cadence.everyMs);
  }

  const cron = parseCronExpression(cadence.expression);
  const readDateParts = createCronDatePartsReader(cadence.timezone);
  const limit = 366 * 24 * 60;
  let cursor = startOfNextMinute(after);

  for (let index = 0; index < limit; index += 1) {
    const { minute, hour, dayOfMonth, month, dayOfWeek } = readDateParts(cursor);

    if (
      cron.minute.matches(minute) &&
      cron.hour.matches(hour) &&
      cron.dayOfMonth.matches(dayOfMonth) &&
      cron.month.matches(month) &&
      cron.dayOfWeek.matches(dayOfWeek)
    ) {
      return cursor;
    }

    cursor = new Date(cursor.getTime() + 60_000);
  }

  return null;
}
