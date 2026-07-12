import type { Locator, Page } from "@playwright/test";

/**
 * Human-cadence input helpers for demo recordings. E2E specs optimize for
 * speed; demo captures optimize for watchability — visible pointer travel,
 * keystroke rhythm, and beats between actions. Jitter is seeded so repeated
 * takes of a scenario have near-identical pacing.
 */

let jitterState = 0x9e3779b9;

/** Deterministic pseudo-random in [0, 1) so takes stay reproducible. */
function nextJitter(): number {
  jitterState ^= jitterState << 13;
  jitterState ^= jitterState >>> 17;
  jitterState ^= jitterState << 5;
  jitterState >>>= 0;
  return jitterState / 0xffffffff;
}

export function resetPacingSeed(): void {
  jitterState = 0x9e3779b9;
}

export async function pause(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

/** A short "reading" beat before the next action, for video rhythm. */
export async function beat(page: Page): Promise<void> {
  await pause(page, 650 + Math.round(nextJitter() * 350));
}

/** Hover first, settle, then click — so the viewer can follow the pointer. */
export async function humanClick(page: Page, target: Locator): Promise<void> {
  await target.hover();
  await pause(page, 180 + Math.round(nextJitter() * 140));
  await target.click();
}

/** Types with a natural keystroke rhythm instead of instant fill(). */
export async function humanType(page: Page, target: Locator, text: string): Promise<void> {
  await humanClick(page, target);
  for (const char of text) {
    await target.pressSequentially(char, { delay: 0 });
    const base = char === " " ? 90 : 45;
    await pause(page, base + Math.round(nextJitter() * 50));
  }
}
