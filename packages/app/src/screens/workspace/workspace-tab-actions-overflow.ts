export interface WorkspaceTabActionDescriptor {
  key: string;
  width: number;
}

/**
 * Decides which trailing tab-bar tools stay inline given the width left over
 * once every tab renders at full (unshrunk) width. Tools collapse into the
 * more-actions menu from left to right — the rightmost tools survive longest —
 * so the returned set is always a suffix of `actions`.
 */
export function computeVisibleTabActionKeys(input: {
  actions: readonly WorkspaceTabActionDescriptor[];
  availableWidth: number;
}): Set<string> {
  const visible = new Set<string>();
  let used = 0;
  for (let index = input.actions.length - 1; index >= 0; index -= 1) {
    const action = input.actions[index]!;
    used += action.width;
    if (used > input.availableWidth) {
      break;
    }
    visible.add(action.key);
  }
  return visible;
}
