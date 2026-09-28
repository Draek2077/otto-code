// Two kinds of failure reach a hosted tab. A page that would not load is the
// page's business: Chromium draws its own error page, and the viewer reloads
// like in any browser. Anything else is ours to report.

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const ERROR_PAGE = "chrome-error://";

/** A navigation that failed or ran long. The page shows what happened. */
export function isPageLoadFailure(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  return cause.name === "TimeoutError" || cause.message.includes("net::ERR_");
}

/** Playwright appends a coloured call log to its messages. Keep what happened. */
export function browserErrorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(ANSI, "").split("\nCall log:")[0]!.trim();
}

/** Chromium's error page has an address of its own, which says nothing. */
export function isErrorPageUrl(url: string): boolean {
  return url.startsWith(ERROR_PAGE);
}
