export type PinnedTabTarget =
  // Tab launchers. "draft" is legacy — no longer offered in the catalog (the
  // inline + button covers new-agent tabs) but kept so persisted pins parse.
  | { kind: "draft" }
  | { kind: "terminal" }
  | { kind: "browser" }
  | { kind: "profile"; profileId: string }
  // Tab-bar tools. Pinning one exempts its button from collapsing into the
  // more-actions menu when the tab bar runs out of room.
  | { kind: "preview" }
  | { kind: "artifact" }
  | { kind: "split-right" }
  | { kind: "split-down" };

export function pinnedTargetKey(target: PinnedTabTarget): string {
  if (target.kind === "profile") {
    return `profile:${target.profileId}`;
  }
  return target.kind;
}

export function isTargetPinned(
  pinned: readonly PinnedTabTarget[],
  target: PinnedTabTarget,
): boolean {
  const key = pinnedTargetKey(target);
  return pinned.some((entry) => pinnedTargetKey(entry) === key);
}

export function togglePinnedTarget(
  pinned: readonly PinnedTabTarget[],
  target: PinnedTabTarget,
): PinnedTabTarget[] {
  const key = pinnedTargetKey(target);
  const next = pinned.filter((entry) => pinnedTargetKey(entry) !== key);
  if (next.length === pinned.length) {
    next.push(target);
  }
  return next;
}
