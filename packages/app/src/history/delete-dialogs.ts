import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

/**
 * Copy for the two destructive history gestures: deleting one archived chat, and
 * clearing the archive in bulk.
 *
 * Both say the same two things, and both have to. Deleting a chat in Otto removes
 * **Otto's record** — the row, the title, the metadata. It does **not** remove the
 * agent provider's own transcript, which stays on disk exactly where the provider
 * wrote it. Leaving that data is the point (Otto never created it, and another
 * tool still reads it), but leaving it silently would be worse than deleting it:
 * data the user cannot find is not recoverable data. So the dialog says where the
 * conversation still lives, and it says the Otto side cannot be undone.
 *
 * Pure on purpose — copy this exact is worth asserting on.
 */

// Display names for the providers Otto ships with, so the dialog can name the
// place the transcript survives rather than gesturing at "the provider". An
// unknown id falls back to neutral wording; a stale entry here costs a generic
// sentence, never a wrong claim.
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  copilot: "GitHub Copilot",
  opencode: "OpenCode",
  pi: "Pi",
};

const GENERIC_PROVIDER_NAME = "The agent provider";

export function resolveProviderDisplayName(provider: string | null | undefined): string {
  const id = provider?.trim().toLowerCase();
  if (!id) {
    return GENERIC_PROVIDER_NAME;
  }
  return PROVIDER_DISPLAY_NAMES[id] ?? GENERIC_PROVIDER_NAME;
}

export interface DeleteAgentDialogInput {
  /** The chat's title, or null/empty when it never got one. */
  title: string | null | undefined;
  /** Provider id off the row (`claude`, `codex`, ...). */
  provider: string | null | undefined;
}

/**
 * Per-row delete, reached by long-pressing a chat that is **already archived**.
 * Archive stays the first step; this is the second one. A chat that has not been
 * archived never gets here, which is why the copy can talk about the record
 * rather than about stopping anything.
 */
export function resolveDeleteAgentDialog(input: DeleteAgentDialogInput): ConfirmDialogInput {
  const title = input.title?.trim();
  const subject = title ? `"${title}"` : "this chat";
  const providerName = resolveProviderDisplayName(input.provider);

  return {
    title: "Delete this chat?",
    message: [
      `Otto's record of ${subject} is deleted permanently — the row, its title, and its metadata.`,
      `${providerName}'s own transcript on the host is left in place, so the conversation itself stays on disk and can still be read or resumed outside Otto.`,
      "Otto's side of this can't be undone.",
    ].join("\n\n"),
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    destructive: true,
  };
}

/**
 * Bulk clear, after the server-side dry run has reported a real count. Same rule
 * as the single delete — clearing many at once is not a back door to deleting
 * provider data in aggregate — so the copy repeats the disclosure rather than
 * assuming the user read it on a previous dialog.
 */
export function resolveClearArchivedDialog(input: { matched: number }): ConfirmDialogInput {
  const count = input.matched;
  const noun = count === 1 ? "archived chat" : "archived chats";

  return {
    title: count === 1 ? "Clear 1 archived chat?" : `Clear ${count} archived chats?`,
    message: [
      `Permanently deletes Otto's records for ${count} ${noun}. Chats you haven't archived are untouched.`,
      "The agent providers' own transcripts on the host are left in place — this clears Otto's history, not the conversations on disk.",
      "Otto's side of this can't be undone.",
    ].join("\n\n"),
    confirmLabel: "Clear",
    cancelLabel: "Cancel",
    destructive: true,
  };
}

/** Nothing matched the sweep. An acknowledge-only dialog, not a confirm. */
export function resolveClearArchivedEmptyDialog(): Omit<ConfirmDialogInput, "kind"> {
  return {
    title: "Nothing to clear",
    message: "There are no archived chats on the selected hosts.",
    confirmLabel: "OK",
  };
}

/**
 * No host could be swept — disconnected, or none advertising `historyDelete`.
 * Distinct from "nothing matched", because "there are no archived chats" would be
 * a claim we are in no position to make.
 */
export function resolveClearArchivedNoHostDialog(): Omit<ConfirmDialogInput, "kind"> {
  return {
    title: "No host available",
    message: "Connect to a host that supports deleting chats, then try clearing the archive again.",
    confirmLabel: "OK",
  };
}

/**
 * Outcome report. Shown only when the sweep did not fully succeed — a clean run
 * needs no dialog, the rows just disappear.
 */
export function resolveClearArchivedFailureDialog(input: {
  deleted: number;
  failed: number;
}): Omit<ConfirmDialogInput, "kind"> {
  return {
    title: "Some chats could not be cleared",
    message: `Deleted ${input.deleted}. ${input.failed} could not be deleted and are still in your history. Try again, or check the host's logs.`,
    confirmLabel: "OK",
  };
}

/**
 * The daemon predates hard delete. Per the feature contract there is no fallback
 * path — say so plainly instead of quietly doing nothing (the old behaviour here
 * was to re-archive an already-archived chat, which is a no-op that reads as a
 * bug).
 */
export function resolveHistoryDeleteUnsupportedDialog(): Omit<ConfirmDialogInput, "kind"> {
  return {
    title: "Delete not available",
    message: "Update the host to delete chats from your history.",
    confirmLabel: "OK",
  };
}
