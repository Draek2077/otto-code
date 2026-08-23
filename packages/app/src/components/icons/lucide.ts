import * as Lucide from "lucide-react-native";
import { withIconSizeToken } from "@/components/icons/icon-size";

/**
 * The git glyphs, wrapped so they speak the app's size tokens.
 *
 * Everything else in the app draws from Material Symbols (`material-icons.ts`). The git
 * family stays on lucide because Material has no distinct glyph for a pull request, let
 * alone for its open / closed / draft states: they all collapse onto `call_merge`, which
 * would draw an open PR and a closed PR identically in the same sidebar row. Lucide draws
 * all four states apart, and ships a real GitHub mark instead of a generic `< >`.
 *
 * Import these from here, never from `lucide-react-native` directly. Lucide types its own
 * `size` as `string | number`, so a token handed to a raw lucide icon type-checks and then
 * renders at lucide's default 24 - a silent, compile-clean way to get one icon in a row at
 * the wrong size. Routing them through the same wrapper the Material icons use makes that
 * impossible and gives them the compact ladder for free.
 *
 * Do not add non-git glyphs here. If Material grows real pull-request glyphs, this file
 * goes away and `lucide-react-native` leaves `package.json` with it.
 */
export const GitBranch = withIconSizeToken(Lucide.GitBranch, "GitBranch");
export const GitCommitHorizontal = withIconSizeToken(
  Lucide.GitCommitHorizontal,
  "GitCommitHorizontal",
);
export const GitMerge = withIconSizeToken(Lucide.GitMerge, "GitMerge");
export const GitPullRequest = withIconSizeToken(Lucide.GitPullRequest, "GitPullRequest");
export const GitPullRequestClosed = withIconSizeToken(
  Lucide.GitPullRequestClosed,
  "GitPullRequestClosed",
);
export const GitPullRequestDraft = withIconSizeToken(
  Lucide.GitPullRequestDraft,
  "GitPullRequestDraft",
);
export const Github = withIconSizeToken(Lucide.Github, "Github");

export type { LucideIcon } from "lucide-react-native";
