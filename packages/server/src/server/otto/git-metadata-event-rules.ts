export const OTTO_GIT_METADATA_EVENT_RULES = [
  {
    id: "otto-worktree-metadata",
    scope: "both",
    match: "exact",
    path: "otto/worktree.json",
    route: "owner",
    refreshBase: true,
  },
  {
    id: "otto-diff-base",
    scope: "both",
    match: "exact",
    path: "otto/diff-base.json",
    route: "owner",
    refreshBase: true,
  },
] as const;
