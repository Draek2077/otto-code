/**
 * Which Cmd/Ctrl chords the browser pane steals from the page it is showing and
 * forwards to Otto's own shortcut layer instead.
 *
 * Every key in this set is one the guest page can never see, so the bar for
 * adding one is that Otto genuinely owns it as browser chrome (tab management,
 * open) rather than it being something a web page reasonably binds. Otto runs
 * inside this pane too, both for preview verification and for users who run it
 * in a browser, so a key taken here is taken from Otto as well.
 */
export const FORWARDED_OTTO_SHORTCUT_KEYS = new Set([
  "b",
  "e",
  "w",
  "t",
  "k",
  "o",
  "/",
  "\\",
  ",",
  ".",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  // NOTE: "enter" was here and is deliberately absent. Cmd/Ctrl+Enter is the
  // composer's send/queue chord, and the shortcut layer explicitly declines to
  // bind it (see keyboard-shortcuts.test.ts, "does not bind Ctrl+Enter as a
  // rebindable message queue shortcut"). Forwarding it therefore took the key
  // away from every page, Otto included, and handed it to a listener with a
  // rule to ignore it, so Cmd/Ctrl+Enter did nothing at all inside the pane.
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
]);

/** Only the fields the predicate reads, so callers and tests need no Electron. */
export interface ForwardableShortcutInput {
  type: string;
  meta: boolean;
  control: boolean;
  key: string;
}

export function isForwardableOttoShortcutInput(input: ForwardableShortcutInput): boolean {
  if (input.type !== "keyDown") {
    return false;
  }
  if (!input.meta && !input.control) {
    return false;
  }
  return FORWARDED_OTTO_SHORTCUT_KEYS.has(input.key.toLowerCase());
}
