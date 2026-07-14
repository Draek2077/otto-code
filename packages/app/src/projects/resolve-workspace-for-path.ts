/**
 * Resolves an absolute host file path to the known workspace that owns it — the
 * foundation of gated-multi-root: to decide whether a file belongs to the
 * current project or another one, we first find which workspace root contains
 * it. Pure and platform-tolerant (Windows drive-letter + WSL/posix forms).
 */

export interface WorkspaceForPathCandidate {
  workspaceId: string;
  projectId: string;
  /** Absolute workspace root (WorkspaceDescriptor.workspaceDirectory). */
  cwd: string;
}

export interface ResolvedWorkspaceForPath extends WorkspaceForPathCandidate {
  /** The target path relative to the resolved workspace root (POSIX, no leading slash). */
  relativePath: string;
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value);
}

function normalize(value: string): string {
  const forward = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const cased = isWindowsPath(forward) ? forward.toLowerCase() : forward;
  return cased === "" ? "/" : cased;
}

/**
 * The most specific workspace whose root equals or contains `absolutePath`.
 * "Most specific" (longest root) wins so a worktree nested under a repo checkout
 * resolves to the worktree, not the parent. Returns null when no known
 * workspace contains the path.
 */
export function resolveWorkspaceForPath(
  absolutePath: string,
  candidates: readonly WorkspaceForPathCandidate[],
): ResolvedWorkspaceForPath | null {
  const target = normalize(absolutePath);
  let best: { candidate: WorkspaceForPathCandidate; rootLength: number } | null = null;

  for (const candidate of candidates) {
    const root = normalize(candidate.cwd);
    const contained = target === root || target.startsWith(`${root}/`);
    if (!contained) {
      continue;
    }
    if (!best || root.length > best.rootLength) {
      best = { candidate, rootLength: root.length };
    }
  }

  if (!best) {
    return null;
  }

  const root = normalize(best.candidate.cwd);
  const relativePath = target === root ? "" : target.slice(root.length + 1);
  return { ...best.candidate, relativePath };
}
