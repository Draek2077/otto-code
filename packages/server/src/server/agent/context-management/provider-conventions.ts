/**
 * Per-provider resolution of *where* context lives (charter §2.4).
 *
 * A registry from day one, with Claude as its single populated entry - per the
 * fork's provider-agnostic-first rule, the shape must not have to change when
 * Codex and OpenCode arrive.
 *
 * Everything here describes *candidates*. The scanner decides what is real by
 * testing existence, which is the only reliable filter: no provider publishes
 * the list of files it loaded.
 */

import path from "node:path";
import { resolveEnabledPluginRoots } from "./plugin-roots.js";
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
  /**
   * Alternate spellings of the *same* load point, tried in order when `path`
   * does not exist. This is one slot with several possible filenames, not
   * several slots: the first candidate that exists wins and the rest are never
   * read. That distinction is what keeps a repo carrying both `AGENTS.md` and
   * `CLAUDE.md` from paying for its instructions twice.
   */
  fallbackPaths?: string[];
  scope: ContextScope;
  category: ContextCategory;
  costClass: ContextCostClass;
}

export interface ProviderConvention {
  provider: string;
  confidence: ContextConfidence;
  /** Whether `@path` inlining exists at all - gates the "Always load" action. */
  supportsImports: boolean;
  /** Recursion limit for imports; also guards against pathological graphs. */
  importDepthCap: number;
  /** Explicit file candidates, in load order. Existence-filtered by the scanner. */
  resolveLoadPoints(input: ContextResolutionInput): ContextLoadPoint[];
  /** Directories whose per-skill `SKILL.md` children contribute roster weight. */
  resolveSkillRoots(input: ContextResolutionInput): string[];
  /**
   * Directories whose `*.md` children define subagents. Their frontmatter -
   * name, description, tool grant - is advertised on every request exactly like
   * a skill's, so it is roster weight by the same argument.
   */
  resolveAgentRoots(input: ContextResolutionInput): string[];
  /**
   * Install roots of enabled plugins, each of which may contribute `skills/` and
   * `agents/` of its own. Async and optional because it reads the provider's
   * settings from disk; a provider with no plugin mechanism omits it.
   */
  resolvePluginRoots?(input: ContextResolutionInput): Promise<string[]>;
  /**
   * Root under which subdirectory context files load *conditionally* - only
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
  // regardless - exceeding it produces a `depth_capped` finding, not silence.
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

  resolveAgentRoots({ projectRoot, homeDir }): string[] {
    return [path.join(homeDir, ".claude", "agents"), path.join(projectRoot, ".claude", "agents")];
  },

  resolvePluginRoots({ homeDir }): Promise<string[]> {
    return resolveEnabledPluginRoots(path.join(homeDir, ".claude"));
  },

  resolveSubdirectoryScanRoot({ projectRoot }): string | null {
    return projectRoot;
  },

  subdirectoryFileName: "CLAUDE.md",
};

/**
 * Directories from `from` up to - but not including - `to`. Returns nothing
 * when `from` is not inside `to`, or when they are the same directory.
 */
export function ancestorsBetween(from: string, to: string): string[] {
  const normalizedTo = path.resolve(to);
  let current = path.resolve(from);
  const result: string[] = [];
  while (current !== normalizedTo) {
    const parent = path.dirname(current);
    // Escaped past the root without meeting `to` - not a descendant.
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
 * the real behavior - the UI says so rather than presenting it as fact.
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

  // No subagent convention is documented for Codex. An empty list reports
  // "nothing found" honestly; inventing a path would produce a category that is
  // silently zero for a different reason than the true one.
  resolveAgentRoots(): string[] {
    return [];
  },

  resolveSubdirectoryScanRoot({ projectRoot }): string | null {
    return projectRoot;
  },

  subdirectoryFileName: "AGENTS.md",
};

/**
 * OpenCode reads `AGENTS.md` plus an `instructions` array in its config that
 * accepts globs. Those globs are exactly the case a user cannot reason about
 * unaided, which makes this the provider the graph view helps most - but
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

  resolveAgentRoots(): string[] {
    return [];
  },

  resolveSubdirectoryScanRoot({ projectRoot }): string | null {
    return projectRoot;
  },

  subdirectoryFileName: "AGENTS.md",
};

/**
 * Provider id under which every payload-owning provider reports. The
 * OpenAI-compatible family has no single id at runtime - `otto-brain` is one
 * member and every user-configured endpoint mints its own - so the family, not
 * the id, is what selects this convention.
 */
export const OPENAI_COMPAT_CONTEXT_FAMILY = "openai-compat";

/**
 * `$OTTO_HOME`, resolved from the scan input rather than through
 * `resolveOttoHome()`. That helper creates the directory as a side effect,
 * which a resolver asked only *where a file would live* has no business doing -
 * and which would have every test scan touch the real `~/.otto`.
 */
function resolveOttoHomeDir({ env, homeDir }: ContextResolutionInput): string {
  const raw = env.OTTO_HOME;
  if (!raw) return path.join(homeDir, ".otto");
  if (raw === "~") return homeDir;
  if (raw.startsWith("~/")) return path.resolve(homeDir, raw.slice(2));
  return path.resolve(raw);
}

/**
 * The one entry in this registry that is not a guess.
 *
 * Every convention above describes what a subprocess does behind Otto's back,
 * which is why they carry `convention` or `unverified`. This one describes what
 * `loadInstructionFiles` does in this process, from this same function - the
 * scan and the prompt are two readings of one resolver, so the report is
 * `exact` by construction rather than by promise. Changing the load order here
 * changes what the model receives; there is no second list to keep in step.
 *
 * `AGENTS.md` is the name, with `CLAUDE.md` as a per-directory fallback: a repo
 * that only ever wrote `CLAUDE.md` still gets its instructions, and a repo
 * carrying both (this one, where `CLAUDE.md` is a single `@AGENTS.md` line)
 * loads `AGENTS.md` once.
 *
 * No subdirectory scan root. Files below cwd are genuinely not loaded yet, and
 * a `conditional` row for weight that never arrives is the kind of number
 * `docs/context-management.md` exists to forbid. It becomes a root the same
 * change that teaches the tool loop to inject them.
 */
const OPENAI_COMPAT_CONVENTION: ProviderConvention = {
  provider: OPENAI_COMPAT_CONTEXT_FAMILY,
  confidence: "exact",
  supportsImports: true,
  // Matches Claude's cap so a repo's `@import` graph behaves the same whichever
  // of the two loads it. Exceeding it produces a `depth_capped` finding.
  importDepthCap: 5,

  resolveLoadPoints(input): ContextLoadPoint[] {
    const { cwd, projectRoot } = input;
    const points: ContextLoadPoint[] = [
      {
        path: path.join(resolveOttoHomeDir(input), "AGENTS.md"),
        scope: "global",
        category: "context_files",
        costClass: "fixed",
      },
      {
        path: path.join(projectRoot, "AGENTS.md"),
        fallbackPaths: [path.join(projectRoot, "CLAUDE.md")],
        scope: "project",
        category: "context_files",
        costClass: "fixed",
      },
    ];

    // Outermost first, so the most specific instructions land last and read as
    // the most authoritative. `ancestorsBetween` walks cwd upward, which is the
    // opposite of what a prompt wants.
    for (const dir of ancestorsBetween(cwd, projectRoot).toReversed()) {
      points.push({
        path: path.join(dir, "AGENTS.md"),
        fallbackPaths: [path.join(dir, "CLAUDE.md")],
        scope: "subdirectory",
        category: "context_files",
        costClass: "fixed",
      });
    }

    return points;
  },

  // No on-disk skill or subagent roster: this provider's tool advertisement is
  // the Otto catalog, which `mcp_tools` already measures exactly.
  resolveSkillRoots(): string[] {
    return [];
  },

  resolveAgentRoots(): string[] {
    return [];
  },

  resolveSubdirectoryScanRoot(): string | null {
    return null;
  },

  subdirectoryFileName: null,
};

const CONVENTIONS = new Map<string, ProviderConvention>([
  [CLAUDE_CONVENTION.provider, CLAUDE_CONVENTION],
  [CODEX_CONVENTION.provider, CODEX_CONVENTION],
  [OPENCODE_CONVENTION.provider, OPENCODE_CONVENTION],
  [OPENAI_COMPAT_CONVENTION.provider, OPENAI_COMPAT_CONVENTION],
]);

export interface ProviderConventionLookup {
  /**
   * The provider drives its own request, so it resolves through the
   * payload-owning convention whatever its id happens to be. Comes from the
   * adapter's `ownsContextPayload` capability, never from a name.
   */
  ownsContextPayload?: boolean;
}

export function getProviderConvention(
  provider: string,
  lookup?: ProviderConventionLookup,
): ProviderConvention | null {
  if (lookup?.ownsContextPayload) return OPENAI_COMPAT_CONVENTION;
  return CONVENTIONS.get(provider) ?? null;
}

export function isContextScanSupported(
  provider: string,
  lookup?: ProviderConventionLookup,
): boolean {
  return getProviderConvention(provider, lookup) !== null;
}
