import { i18n } from "@/i18n/i18next";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

/**
 * Copy for the one destructive bulk gesture in Changes: deleting every review
 * comment on the current branch.
 *
 * The confirmation exists because the comments being deleted are the ones the
 * reader has lost track of. A draft key pins a diff mode and a whitespace
 * setting, so the visible Changes view is never the whole picture, and a
 * confirmation that only said "this diff" would understate what it takes. So the
 * copy names all three facts: how many comments, how many files they sit on, and
 * that the sweep covers the branch rather than the current view.
 *
 * Pure - it reads its sentences from `review.deleteAll.*` rather than holding
 * them. Confirmations are inside the translation scope (docs/i18n.md), and a
 * destructive dialog is the last place to make the user read a second language.
 * Tests assert the English because `en` is the default language.
 */

export interface DeleteAllReviewCommentsDialogInput {
  commentCount: number;
  fileCount: number;
  /** The branch the comments were written on; null/empty on a detached HEAD. */
  branch: string | null | undefined;
}

export function resolveDeleteAllReviewCommentsDialog(
  input: DeleteAllReviewCommentsDialogInput,
): ConfirmDialogInput {
  const branch = input.branch?.trim();
  // Plural form is selected here rather than left to i18next, matching how the
  // rest of the app counts things (see `toolCallGroup.*` call sites).
  const comments = i18n.t(
    `review.deleteAll.commentCount.${input.commentCount === 1 ? "one" : "other"}`,
    { count: input.commentCount },
  );
  const files = i18n.t(`review.deleteAll.fileCount.${input.fileCount === 1 ? "one" : "other"}`, {
    count: input.fileCount,
  });

  return {
    title:
      input.commentCount === 1
        ? i18n.t("review.deleteAll.titleOne")
        : i18n.t("review.deleteAll.titleMany", { count: input.commentCount }),
    message: [
      branch
        ? i18n.t("review.deleteAll.scopeLineBranch", { comments, files, branch })
        : i18n.t("review.deleteAll.scopeLineDetached", { comments, files }),
      i18n.t("review.deleteAll.undoLine"),
    ].join("\n\n"),
    confirmLabel: i18n.t("review.deleteAll.confirm"),
    cancelLabel: i18n.t("common.actions.cancel"),
    destructive: true,
  };
}
