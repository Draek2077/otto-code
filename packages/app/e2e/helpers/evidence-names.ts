/**
 * Attachment-naming contract shared by the capture helpers (`evidence.ts`, which
 * runs in a test worker) and the QA reporter (`reporters/qa-reporter.ts`, which
 * runs in the main process). It lives in its own module so the reporter can read
 * the contract without importing `@playwright/test` — the runner module must not
 * be pulled into reporter context.
 *
 * Attachment names are `<prefix>::<label>`.
 */

export const MONEY_SHOT_PREFIX = "money-shot";
export const STEP_SHOT_PREFIX = "qa-step";
export const EVIDENCE_SEPARATOR = "::";
