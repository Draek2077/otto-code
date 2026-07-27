/**
 * Assembles a `ContextReport` for a workspace: resolve roots → scan the graph →
 * fold in the weight Otto composes itself → evaluate against a context window.
 *
 * Deliberately thin. Everything interesting lives in the scanner (what exists)
 * and the evaluator (what it costs); this file only knows how to find the roots
 * and how long to cache the answer.
 */

import os from "node:os";
import path from "node:path";
import type { Logger } from "pino";
import type { ContextReport as WireContextReport } from "@otto-code/protocol/messages";
import { scanContextGraph } from "./context-graph-scanner.js";
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  evaluateContext,
  type ContextThresholds,
} from "./evaluator.js";
import { isContextScanSupported } from "./provider-conventions.js";
import { buildPromptPreview, type ContextPromptPreview } from "./prompt-preview.js";
import { estimateTokens } from "../context-composition.js";
import type { ContextCategory, ContextCategoryVisibility } from "./types.js";

/** Scans are cheap, but focus switches should feel instant. */
const CACHE_TTL_MS = 15_000;

/**
 * A personality's lessons as they are actually injected — the same text the
 * Memory tab shows, because both come from `composeMemoryBrief`.
 */
export interface PersonalityMemoryBrief {
  text: string;
  estTokens: number;
}

const EMPTY_MEMORY_BRIEF: PersonalityMemoryBrief = { text: "", estTokens: 0 };

export interface WorkspaceContextLocation {
  cwd: string;
  projectRoot: string;
}

export interface WorkspaceContextRuntime {
  provider: string;
  /** The active model's real context window, when the provider reports one. */
  windowTokens?: number;
  /**
   * Prompt text Otto composes and injects itself — personality, team, daemon
   * append. Exactly known, unlike anything a CLI loads internally.
   */
  injectedPromptText?: string;
  /**
   * Serialized MCP tool definitions, when the provider's tool schemas are
   * in-process (openai-compat). Opaque for CLI-backed providers.
   */
  mcpToolsText?: string;
  /**
   * The provider preset Otto composes itself — the standing instructions it puts
   * in front of the model before any user or personality text. Present only
   * where Otto builds the request (openai-compat); a CLI composes its own preset
   * in its own process and never hands it back.
   */
  systemPromptText?: string;
}

export interface ContextManagementServiceDeps {
  logger: Logger;
  /** Resolves a workspace id to its cwd and project root. */
  resolveLocation(workspaceId: string): Promise<WorkspaceContextLocation | null>;
  /** Provider + model + Otto-composed weight for the workspace's active agent. */
  resolveRuntime(workspaceId: string): Promise<WorkspaceContextRuntime | null>;
  /**
   * The injected memory brief for one personality in one project, so the report
   * can answer "what would this cost if <personality> ran here" and the preview
   * can show the text that cost buys. Absent on hosts that don't wire
   * personality memory — the report is then simply personality-agnostic, which
   * is the pre-memory behavior.
   */
  resolvePersonalityMemoryBrief?: (params: {
    personalityId: string;
    projectRoot: string;
  }) => Promise<PersonalityMemoryBrief>;
  thresholds?: ContextThresholds;
  homeDir?: string;
}

export interface GetContextReportInput {
  workspaceId: string;
  /** What-if override; omitted means the workspace's active provider. */
  provider?: string;
  /** What-if override; omitted means the active model's window. */
  windowTokens?: number;
  /**
   * Evaluate as if this personality were running here: its injected memory
   * brief joins the fixed weight. Context stopped being personality-agnostic the
   * moment personalities started accruing lessons.
   */
  personalityId?: string;
}

export interface GetPromptPreviewInput extends GetContextReportInput {
  /**
   * Assemble only this section. The tab shows one section at a time, and the
   * ones worth reading are runtime text Otto already holds — assembling the rest
   * would re-read every context file on disk to build text nobody asked for.
   */
  category?: ContextCategory;
}

interface CacheEntry {
  report: WireContextReport;
  expiresAt: number;
}

export class ContextManagementService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly deps: ContextManagementServiceDeps) {}

  /** Drops cached reports so the next read re-scans. */
  invalidate(workspaceId?: string): void {
    if (!workspaceId) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${workspaceId}\0`)) this.cache.delete(key);
    }
  }

  async getReport(input: GetContextReportInput): Promise<WireContextReport | null> {
    const location = await this.deps.resolveLocation(input.workspaceId);
    if (!location) return null;

    const runtime = await this.deps.resolveRuntime(input.workspaceId);
    const provider = input.provider ?? runtime?.provider ?? null;
    if (!provider) return null;

    // Never default to the largest window: reporting against 1M would tell
    // every user they are fine (charter §4.2).
    const windowTokens =
      input.windowTokens ?? runtime?.windowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;

    // The personality is part of the key: two personalities in one workspace
    // carry different memory, and so are genuinely different reports.
    const cacheKey = `${input.workspaceId}\0${provider}\0${windowTokens}\0${input.personalityId ?? ""}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.report;

    const report = await this.buildReport({
      workspaceId: input.workspaceId,
      provider,
      windowTokens,
      location,
      runtime,
      ...(input.personalityId ? { personalityId: input.personalityId } : {}),
    });
    this.cache.set(cacheKey, { report, expiresAt: Date.now() + CACHE_TTL_MS });
    return report;
  }

  private async buildReport(params: {
    workspaceId: string;
    provider: string;
    windowTokens: number;
    location: WorkspaceContextLocation;
    runtime: WorkspaceContextRuntime | null;
    personalityId?: string;
  }): Promise<WireContextReport> {
    const { workspaceId, provider, windowTokens, location, runtime, personalityId } = params;
    const homeDir = this.deps.homeDir ?? os.homedir();
    const scannedAt = new Date().toISOString();

    // Weight Otto composes itself is exact, and is worth showing even when the
    // provider's own file conventions are unknown to us.
    const runtimeTokensByCategory: Partial<Record<ContextCategory, number>> = {};
    if (runtime?.injectedPromptText) {
      runtimeTokensByCategory.otto_injected = estimateTokens(runtime.injectedPromptText.length);
    }
    if (runtime?.mcpToolsText) {
      runtimeTokensByCategory.mcp_tools = estimateTokens(runtime.mcpToolsText.length);
    }
    if (runtime?.systemPromptText) {
      runtimeTokensByCategory.system_prompt = estimateTokens(runtime.systemPromptText.length);
    }
    const visibilityByCategory = resolveCategoryVisibility({ provider, runtime });

    // A personality's memory brief is prompt text Otto composes and injects, so
    // it belongs in `otto_injected` rather than a category of its own —
    // ContextCategory is a z.enum travelling daemon->client, and a new member
    // would make a new daemon's report unparseable by an older client.
    const personalityMemoryTokens = (
      await this.resolveMemoryBrief(personalityId, location.projectRoot)
    ).estTokens;
    if (personalityMemoryTokens > 0) {
      runtimeTokensByCategory.otto_injected =
        (runtimeTokensByCategory.otto_injected ?? 0) + personalityMemoryTokens;
    }
    const personalityFields = {
      ...(personalityId ? { personalityId } : {}),
      ...(personalityId ? { personalityMemoryTokens } : {}),
    };

    if (!isContextScanSupported(provider)) {
      // Not a failure: some providers genuinely ingest no project files, and
      // saying so is useful signal. We still report what Otto injects.
      const empty = evaluateContext({
        provider,
        windowTokens,
        scan: {
          nodes: [],
          edges: [],
          findings: [],
          confidence: "unverified",
          supportsImports: false,
          supported: false,
        },
        scannedAt,
        thresholds: this.deps.thresholds,
        runtimeTokensByCategory,
        visibilityByCategory,
      });
      return {
        ...empty,
        workspaceId,
        supported: false,
        supportsImports: false,
        ...personalityFields,
      };
    }

    let scan;
    try {
      scan = await scanContextGraph(provider, {
        cwd: location.cwd,
        projectRoot: location.projectRoot,
        homeDir,
        env: process.env,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.deps.logger.warn({ err, workspaceId, provider }, "Context graph scan failed");
      scan = {
        nodes: [],
        edges: [],
        findings: [],
        confidence: "unverified" as const,
        supportsImports: false,
        supported: false,
      };
    }

    const evaluated = evaluateContext({
      provider,
      windowTokens,
      scan,
      scannedAt,
      thresholds: this.deps.thresholds,
      runtimeTokensByCategory,
      visibilityByCategory,
    });

    return {
      ...evaluated,
      workspaceId,
      supported: scan.supported,
      supportsImports: scan.supportsImports,
      ...personalityFields,
    };
  }

  /**
   * The assembled prompt, for reading only.
   *
   * Deliberately built on top of `getReport` rather than beside it: the preview
   * must show exactly the files the graph counted, or the two surfaces would
   * disagree about the same request. Returns null on the same terms the report
   * does — no workspace, or no provider to resolve conventions from.
   */
  async getPromptPreview(input: GetPromptPreviewInput): Promise<ContextPromptPreview | null> {
    const report = await this.getReport(input);
    if (!report) return null;

    const runtime = await this.deps.resolveRuntime(input.workspaceId);
    const runtimeTextByCategory: Partial<Record<ContextCategory, string>> = {};
    // Everything Otto itself puts in front of the model, in injection order: the
    // system-prompt override and daemon append (which is where the team and the
    // personality's role text land), then the personality's memory brief. The
    // report counts the brief in this same category, so leaving it out here
    // would make the pane and the row above it disagree about one number.
    const location = await this.deps.resolveLocation(input.workspaceId);
    const memoryBrief = location
      ? await this.resolveMemoryBrief(input.personalityId, location.projectRoot)
      : EMPTY_MEMORY_BRIEF;
    const injected = [runtime?.injectedPromptText, memoryBrief.text].filter(Boolean).join("\n\n");
    if (injected) runtimeTextByCategory.otto_injected = injected;
    if (runtime?.systemPromptText) runtimeTextByCategory.system_prompt = runtime.systemPromptText;
    if (runtime?.mcpToolsText) runtimeTextByCategory.mcp_tools = runtime.mcpToolsText;

    return buildPromptPreview({
      report,
      runtimeTextByCategory,
      ...(input.category ? { categories: [input.category] } : {}),
    });
  }

  /**
   * The personality's injected memory brief, or nothing. Never throws and never
   * blocks the report: a memory read failing must cost the numbers their memory
   * line, not cost the user the whole report.
   */
  private async resolveMemoryBrief(
    personalityId: string | undefined,
    projectRoot: string,
  ): Promise<PersonalityMemoryBrief> {
    if (!personalityId || !this.deps.resolvePersonalityMemoryBrief) return EMPTY_MEMORY_BRIEF;
    try {
      return await this.deps.resolvePersonalityMemoryBrief({ personalityId, projectRoot });
    } catch (error) {
      this.deps.logger.warn(
        { err: error, personalityId },
        "Failed to resolve personality memory weight; reporting without it",
      );
      return EMPTY_MEMORY_BRIEF;
    }
  }
}

/**
 * What Otto can honestly claim to see, per category, for one provider.
 *
 * Otto owns the whole payload for `openai-compat`, which makes it the only
 * provider whose preset and tool schemas are measurable — and the ground truth
 * every convention-based estimate is validated against. Every CLI-backed
 * provider assembles its own preset and hands its MCP servers to a subprocess,
 * so those two categories are unmeasurable there. Saying so on the row is the
 * point: a user comparing providers should be able to see *where* the numbers
 * stop being complete, rather than inferring it from a missing line.
 */
function resolveCategoryVisibility(params: {
  provider: string;
  runtime: WorkspaceContextRuntime | null;
}): Partial<Record<ContextCategory, ContextCategoryVisibility>> {
  const { provider, runtime } = params;
  const ownsPayload = provider === "openai-compat";

  return {
    // Otto composes personality, team and daemon-append text itself, on every
    // provider — this row is exact everywhere.
    otto_injected: "exact",
    system_prompt: ownsPayload && runtime?.systemPromptText ? "exact" : "not_visible",
    mcp_tools: ownsPayload && runtime?.mcpToolsText ? "exact" : "not_visible",
  };
}

/** Best-effort project root: the git repo root, else the workspace cwd. */
export async function resolveProjectRootForCwd(
  cwd: string,
  resolveRepoRoot?: (cwd: string) => Promise<string>,
): Promise<string> {
  if (!resolveRepoRoot) return path.resolve(cwd);
  try {
    return await resolveRepoRoot(cwd);
  } catch {
    // Non-git workspaces are ordinary, not an error.
    return path.resolve(cwd);
  }
}
