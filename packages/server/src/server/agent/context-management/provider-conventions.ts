/**
 * Per-provider resolution of *where* context lives (charter §2.4).
 *
 * A registry from day one, with Claude as its single populated entry — per the
 * fork's provider-agnostic-first rule, the shape must not have to change when
 * Codex and OpenCode arrive.
 *
 * Everything here describes *candidates*. The scanner decides what is real by
 * testing existence, which is the only reliable filter: no provider publishes
 * the list of files it loaded.
 */

import path from "node:path";
import type {
  ContextCategory,
  ContextConfidence,
  ContextCostClass,
  ContextScope,
} from "./types.js";

export interface ContextResolutionInput {
  /** The agent's working directory. */
  cwd: string;
  /** Repo root (or the workspace root when not a git checkout). */
  projectRoot: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
}

export interface ContextLoadPoint {
  path: string;
  scope: ContextScope;
  category: ContextCategory;
  costClass: ContextCostClass;
}

export interface ProviderConvention {
  provider: string;
  confidence: ContextConfidence;
  /** Whether `@path` inlining exists at all — gates the "Always load" action. */
  supportsImports: boolean;
  /** Recursion limit for imports; also guards against pathological graphs. */
  importDepthCap: number;
  /** Explicit file candidates, in load order. Existence-filtered by the scanner. */
  resolveLoadPoints(input: ContextResolutionInput): ContextLoadPoint[];
  /** Directories whose per-skill `SKILL.md` children contribute roster weight. */
  resolveSkillRoots(input: ContextResolutionInput): string[];
  /**
   * Root under which subdirectory context files load *conditionally* — only
   * once the agent touches that subtree. Null when the provider has no such
   * behavior.
   */
  resolveSubdirectoryScanRoot(input: ContextResolutionInput): string | null;
  /** Filename the provider looks for in subdirectories. */
  subdirectoryFileName: string | null;
}

/**
 * Claude Code encodes a project's memory directory by flattening the absolute
 * path: `C:\Users\x\Projects\otto` → `C--Users-x-Projects-otto`.
 */
export function encodeClaudeProjectDir(projectPath: string): string {
  return projectPath.replace(/[:\\/]/g, "-");
}

const CLAUDE_CONVENTION: ProviderConvention = {
  provider: "claude",
  confidence: "convention",
  supportsImports: true,
  // Claude Code caps recursive @imports; the exact depth is pending empirical
  // confirmation (charter §11.2). 5 is the documented figure and a safe guard
  // regardless — exceeding it produces a `depth_capped` finding, not silence.
  importDepthCap: 5,

  resolveLoadPoints({ cwd, projectRoot, homeDir }): ContextLoadPoint[] {
    const points: ContextLoadPoint[] = [
      {
        path: path.join(homeDir, ".claude", "CLAUDE.md"),
        scope: "global",
        category: "context_files",
        costClass: "fixed",
      },
      {
        path: path.join(projectRoot, "CLAUDE.md"),
        scope: "project",
        category: "context_files",
        costClass: "fixed",
      },
      {
        path: path.join(projectRoot, "CLAUDE.local.md"),
        scope: "local",
        category: "context_files",
        costClass: "fixed",
      },
      {
        path: path.join(
          homeDir,
          ".claude",
          "projects",
          encodeClaudeProjectDir(projectRoot),
          "memory",
          "MEMORY.md",
        ),
        scope: "global",
        category: "memory_index",
        costClass: "fixed",
      },
    ];

    // Every CLAUDE.md between cwd and the project root is on the startup path,
    // so those are fixed too. Files *below* cwd are conditional and are
    // discovered separately (resolveSubdirectoryScanRoot).
    for (const dir of ancestorsBetween(cwd, projectRoot)) {
      points.push({
        path: path.join(dir, "CLAUDE.md"),
        scope: "subdirectory",
        category: "context_files",
        costClass: "fixed",
      });
    }

    return points;
  },

  resolveSkillRoots({ projectRoot, homeDir }): string[] {
    return [path.join(homeDir, ".claude", "skills"), path.join(projectRoot, ".claude", "skills")];
  },

  resolveSubdirectoryScanRoot({ projectRoot }): string | null {
    return projectRoot;
  },

  subdirectoryFileName: "CLAUDE.md",
};

/**
 * Directories from `from` up to — but not including — `to`. Returns nothing
 * when `from` is not inside `to`, or when they are the same directory.
 */
export function ancestorsBetween(from: string, to: string): string[] {
  const normalizedTo = path.resolve(to);
  let current = path.resolve(from);
  const result: string[] = [];
  while (current !== normalizedTo) {
    const parent = path.dirname(current);
    // Escaped past the root without meeting `to` — not a descendant.
    if (parent === current) return [];
    result.push(current);
    current = parent;
  }
  return result;
}

/**
 * Codex merges `AGENTS.md` from its home config dir down to the working
 * directory. No `@import` mechanism is known, so the "Always load" action stays
 * disabled here rather than writing syntax the agent would render as text.
 *
 * Confidence is `unverified` until the fixture repo (charter §11.2) confirms
 * the real behavior — the UI says so rather than presenting it as fact.
 */
const CODEX_CONVENTION: ProviderConvention = {
  provider: "codex",
  confidence: "unverified",
  supportsImports: false,
  importDepthCap: 1,

  resolveLoadPoints({ cwd, projectRoot, homeDir, env }): ContextLoadPoint[] {
    const codexHome = env.CODEX_HOME ?? path.join(homeDir, ".codex");
    const points: ContextLoadPoint[] = [
      {
        path: path.join(codexHome, "AGENTS.md"),
        scope: "global",
        category: "context_files",
        costClass: "fixed",
      },
      {
        path: path.join(projectRoot, "AGENTS.md"),
        scope: "project",
        category: "context_files",
        costClass: "fixed",
      },
    ];
    for (const dir of ancestorsBetween(cwd, projectRoot)) {
      points.push({
        path: path.join(dir, "AGENTS.md"),
        scope: "subdirectory",
        category: "context_files",
        costClass: "fixed",
      });
    }
    return points;
  },

  resolveSkillRoots({ projectRoot, homeDir, env }): string[] {
    const codexHome = env.CODEX_HOME ?? path.join(homeDir, ".codex");
    return [path.join(codexHome, "skills"), path.join(projectRoot, ".codex", "skills")];
  },

  resolveSubdirectoryScanRoot({ projectRoot }): string | null {
    return projectRoot;
  },

  subdirectoryFileName: "AGENTS.md",
};

/**
 * OpenCode reads `AGENTS.md` plus an `instructions` array in its config that
 * accepts globs. Those globs are exactly the case a user cannot reason about
 * unaided, which makes this the provider the graph view helps most — but
 * resolving them needs the config parser, so v1 covers the AGENTS.md spine and
 * reports `unverified`.
 */
const OPENCODE_CONVENTION: ProviderConvention = {
  provider: "opencode",
  confidence: "unverified",
  supportsImports: false,
  importDepthCap: 1,

  resolveLoadPoints({ cwd, projectRoot, homeDir }): ContextLoadPoint[] {
    const points: ContextLoadPoint[] = [
      {
        path: path.join(homeDir, ".config", "opencode", "AGENTS.md"),
        scope: "global",
        category: "context_files",
        costClass: "fixed",
      },
      {
        path: path.join(projectRoot, "AGENTS.md"),
        scope: "project",
        category: "context_files",
        costClass: "fixed",
      },
    ];
    for (const dir of ancestorsBetween(cwd, projectRoot)) {
      points.push({
        path: path.join(dir, "AGENTS.md"),
        scope: "subdirectory",
        category: "context_files",
        costClass: "fixed",
      });
    }
    return points;
  },

  resolveSkillRoots(): string[] {
    return [];
  },

  resolveSubdirectoryScanRoot({ projectRoot }): string | null {
    return projectRoot;
  },

  subdirectoryFileName: "AGENTS.md",
};

const CONVENTIONS = new Map<string, ProviderConvention>([
  [CLAUDE_CONVENTION.provider, CLAUDE_CONVENTION],
  [CODEX_CONVENTION.provider, CODEX_CONVENTION],
  [OPENCODE_CONVENTION.provider, OPENCODE_CONVENTION],
]);

export function getProviderConvention(provider: string): ProviderConvention | null {
  return CONVENTIONS.get(provider) ?? null;
}

export function isContextScanSupported(provider: string): boolean {
  return CONVENTIONS.has(provider);
}
