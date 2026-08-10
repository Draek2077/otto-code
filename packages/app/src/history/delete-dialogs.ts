import { i18n } from "@/i18n/i18next";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

/**
 * Copy for the two destructive history gestures: deleting one archived chat, and
 * clearing the archive in bulk.
 *
 * Both say the same two things, and both have to. Deleting a chat in Otto removes
 * **Otto's record** - the row, the title, and the metadata. The Otto side cannot
 * be undone.
 *
 * Still pure - it just reads its sentences from `sessions.dialogs.*` rather than
 * holding them. These are confirmations, which docs/i18n.md puts squarely inside
 * the translation scope, and a destructive dialog is the last place to make the
 * user read a second language. Resolvers are pure helpers, so they call
 * `i18n.t(...)` directly (docs/i18n.md, Batch 4Y); tests assert the English
 * because `en` is the default language.
 */

export interface DeleteAgentDialogInput {
  /** The chat's title, or null/empty when it never got one. */
  title: string | null | undefined;
}

/**
 * Per-row delete, reached by long-pressing a chat that is **already archived**.
 * Archive stays the first step; this is the second one. A chat that has not been
 * archived never gets here, which is why the copy can talk about the record
 * rather than about stopping anything.
 */
export function resolveDeleteAgentDialog(input: DeleteAgentDialogInput): ConfirmDialogInput {
  const title = input.title?.trim();
  const subject = title ? `"${title}"` : i18n.t("sessions.dialogs.deleteAgent.subjectFallback");
  return {
    title: i18n.t("sessions.dialogs.deleteAgent.title"),
    message: [
      i18n.t("sessions.dialogs.deleteAgent.recordLine", { subject }),
      i18n.t("sessions.dialogs.deleteAgent.undoLine"),
    ].join("\n\n"),
    confirmLabel: i18n.t("sessions.dialogs.deleteAgent.confirm"),
    cancelLabel: i18n.t("common.actions.cancel"),
    destructive: true,
  };
}

/**
 * Bulk clear, after the server-side dry run has reported a real count. Same rule
 * as the single delete - clearing many at once is not a back door to deleting
 * The bulk copy uses the same Otto-only wording as the single-delete dialog.
 */
export function resolveClearArchivedDialog(input: {
  matched: number;
  scope: "allHosts" | "oneHost";
}): ConfirmDialogInput {
  const count = input.matched;
  const one = count === 1;

  return {
    title: one
      ? i18n.t("sessions.dialogs.clearArchived.titleOne")
      : i18n.t("sessions.dialogs.clearArchived.titleMany", { count }),
    message: [
      i18n.t(
        `sessions.dialogs.clearArchived.${
          input.scope === "allHosts" ? "recordLineAllHosts" : "recordLineOneHost"
        }${one ? "One" : "Many"}`,
        { count },
      ),
      i18n.t("sessions.dialogs.clearArchived.undoLine"),
    ].join("\n\n"),
    confirmLabel: i18n.t("sessions.dialogs.clearArchived.confirm"),
    cancelLabel: i18n.t("common.actions.cancel"),
    destructive: true,
  };
}

/** Nothing matched the sweep. An acknowledge-only dialog, not a confirm. */
export function resolveClearArchivedEmptyDialog(): Omit<ConfirmDialogInput, "kind"> {
  return {
    title: i18n.t("sessions.dialogs.nothingToClear.title"),
    message: i18n.t("sessions.dialogs.nothingToClear.message"),
    confirmLabel: i18n.t("common.actions.ok"),
  };
}

/**
 * No host could be swept - disconnected, or none advertising `historyDelete`.
 * Distinct from "nothing matched", because "there are no archived chats" would be
 * a claim we are in no position to make.
 */
export function resolveClearArchivedNoHostDialog(): Omit<ConfirmDialogInput, "kind"> {
  return {
    title: i18n.t("sessions.dialogs.noHost.title"),
    message: i18n.t("sessions.dialogs.noHost.message"),
    confirmLabel: i18n.t("common.actions.ok"),
  };
}

/**
 * Outcome report. Shown only when the sweep did not fully succeed - a clean run
 * needs no dialog, the rows just disappear.
 */
export function resolveClearArchivedFailureDialog(input: {
  deleted: number;
  failed: number;
}): Omit<ConfirmDialogInput, "kind"> {
  return {
    title: i18n.t("sessions.dialogs.partialFailure.title"),
    message: i18n.t("sessions.dialogs.partialFailure.message", {
      deleted: input.deleted,
      failed: input.failed,
    }),
    confirmLabel: i18n.t("common.actions.ok"),
  };
}

/**
 * The daemon predates hard delete. Per the feature contract there is no fallback
 * path - say so plainly instead of quietly doing nothing (the old behaviour here
 * was to re-archive an already-archived chat, which is a no-op that reads as a
 * bug).
 */
export function resolveHistoryDeleteUnsupportedDialog(): Omit<ConfirmDialogInput, "kind"> {
  return {
    title: i18n.t("sessions.dialogs.unsupported.title"),
    message: i18n.t("sessions.dialogs.unsupported.message"),
    confirmLabel: i18n.t("common.actions.ok"),
  };
}
