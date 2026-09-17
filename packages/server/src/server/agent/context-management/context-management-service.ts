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
 * A personality's lessons as they are actually injected - the same text the
 * Memory tab shows, because both come from `composeMemoryBrief`.
 */
export interface PersonalityMemoryBrief {
  text: string;
  estTokens: number;
}

const EMPTY_MEMORY_BRIEF: PersonalityMemoryBrief = { text: "", estTokens: 0 };
const EMPTY_PROJECT_KNOWLEDGE_BRIEF: PersonalityMemoryBrief = { text: "", estTokens: 0 };

export interface WorkspaceContextLocation {
  cwd: string;
  projectRoot: string;
}

export interface WorkspaceContextRuntime {
  provider: string;
  /** The active model's real context window, when the provider reports one. */
  windowTokens?: number;
  /**
   * Prompt text Otto composes and injects itself - personality, team, daemon
   * append. Exactly known, unlike anything a CLI loads internally.
   */
  injectedPromptText?: string;
  /**
   * Serialized MCP tool definitions, when the provider's tool schemas are
   * in-process (openai-compat). Opaque for CLI-backed providers.
   */
  mcpToolsText?: string;
  /**
   * The provider preset Otto composes itself - the standing instructions it puts
   * in front of the model before any user or personality text. Present only
   * where Otto builds the request (openai-compat); a CLI composes its own preset
   * in its own process and never hands it back.
   */
  systemPromptText?: string;
  /**
   * Otto composes this provider's whole request in-process. Mirrors the
   * adapter's `ownsContextPayload` capability, and it is what selects the
   * payload-owning convention and unlocks the `exact` category rows - a
   * provider-id test cannot, because the OpenAI-compatible family mints a fresh
   * id per configured endpoint.
   */
  ownsContextPayload?: boolean;
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
   * personality memory - the report is then simply personality-agnostic, which
   * is the pre-memory behavior.
   */
  resolvePersonalityMemoryBrief?: (params: {
    personalityId: string;
    projectRoot: string;
  }) => Promise<PersonalityMemoryBrief>;
  /** The active-page catalog injected into every chat in this project. */
  resolveProjectKnowledgeBrief?: (params: {
    projectRoot: string;
  }) => Promise<PersonalityMemoryBrief>;
  thresholds?: ContextThresholds;
  homeDir?: string;
  /** Shared report cache; omitted means one private to this instance. */
  store?: ContextReportStore;
}

export interface GetContextReportInput {
  workspaceId: string;
  /** An explicit refresh re-scans even while the cached report is still fresh. */
  forceRefresh?: boolean;
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
   * ones worth reading are runtime text Otto already holds - assembling the rest
   * would re-read every context file on disk to build text nobody asked for.
   */
  category?: ContextCategory;
}

interface CacheEntry {
  report: WireContextReport;
  expiresAt: number;
}

/**
 * Finished reports plus the builds still running, keyed identically. A build
 * scans the whole context graph, so concurrent identical requests (a reconnect
 * burst, several panes) share one build rather than each paying for it.
 */
export interface ContextReportStore {
  cache: Map<string, CacheEntry>;
  inFlight: Map<string, Promise<WireContextReport>>;
}

export function createContextReportStore(): ContextReportStore {
  return { cache: new Map(), inFlight: new Map() };
}

const storesByScope = new WeakMap<object, ContextReportStore>();

/**
 * One store per daemon-scoped object (sessions pass their shared registry), so a
 * reconnecting client reuses the reports the previous session built, and an
 * invalidation from any session clears them for all.
 */
export function contextReportStoreFor(scope: object): ContextReportStore {
  let store = storesByScope.get(scope);
  if (!store) {
    store = createContextReportStore();
    storesByScope.set(scope, store);
  }
  return store;
}

export class ContextManagementService {
  private readonly store: ContextReportStore;

  constructor(private readonly deps: ContextManagementServiceDeps) {
    this.store = deps.store ?? createContextReportStore();
  }

  /** Drops cached reports so the next read re-scans. */
  invalidate(workspaceId?: string): void {
    const { cache, inFlight } = this.store;
    if (!workspaceId) {
      cache.clear();
      // Builds already running keep serving their callers, but no longer land
      // in the cache or get joined: they may predate whatever invalidated them.
      inFlight.clear();
      return;
    }
    for (const map of [cache, inFlight]) {
      for (const key of map.keys()) {
        if (key.startsWith(`${workspaceId}\0`)) map.delete(key);
      }
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
    const { cache, inFlight } = this.store;
    if (!input.forceRefresh) {
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.report;
      const pending = inFlight.get(cacheKey);
      if (pending) return pending;
    }

    // A forced refresh never joins a running build (it may have started before
    // whatever the user is refreshing for); it replaces it for later joiners.
    const build = this.buildReport({
      workspaceId: input.workspaceId,
      provider,
      windowTokens,
      location,
      runtime,
      ...(input.personalityId ? { personalityId: input.personalityId } : {}),
    })
      .then((report) => {
        if (inFlight.get(cacheKey) === build) {
          cache.set(cacheKey, { report, expiresAt: Date.now() + CACHE_TTL_MS });
        }
        return report;
      })
      .finally(() => {
        if (inFlight.get(cacheKey) === build) inFlight.delete(cacheKey);
      });
    inFlight.set(cacheKey, build);
    return build;
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
    const conventionLookup = { ownsContextPayload: runtime?.ownsContextPayload };
    const visibilityByCategory = resolveCategoryVisibility({ runtime });

    // A personality's memory brief is prompt text Otto composes and injects, so
    // it belongs in `otto_injected` rather than a category of its own -
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
    const projectKnowledgeTokens = (await this.resolveProjectKnowledgeBrief(location.projectRoot))
      .estTokens;
    if (projectKnowledgeTokens > 0) {
      runtimeTokensByCategory.otto_injected =
        (runtimeTokensByCategory.otto_injected ?? 0) + projectKnowledgeTokens;
    }
    const projectKnowledgeFields = projectKnowledgeTokens > 0 ? { projectKnowledgeTokens } : {};

    if (!isContextScanSupported(provider, conventionLookup)) {
      // Not a failure: some providers genuinely ingest no project files, and
      // saying so is useful signal. We still report what Otto injects.
      const empty = evaluateContext({
        provider,
        windowTokens,
        scan: {
          nodes: [],
          edges: [],
          findings: [],
          absentPaths: [],
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
        ...projectKnowledgeFields,
      };
    }

    let scan;
    try {
      scan = await scanContextGraph(
        provider,
        {
          cwd: location.cwd,
          projectRoot: location.projectRoot,
          homeDir,
          env: process.env,
        },
        conventionLookup,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.deps.logger.warn({ err, workspaceId, provider }, "Context graph scan failed");
      scan = {
        nodes: [],
        edges: [],
        findings: [],
        absentPaths: [],
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
      ...projectKnowledgeFields,
    };
  }

  /**
   * The assembled prompt, for reading only.
   *
   * Deliberately built on top of `getReport` rather than beside it: the preview
   * must show exactly the files the graph counted, or the two surfaces would
   * disagree about the same request. Returns null on the same terms the report
   * does - no workspace, or no provider to resolve conventions from.
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
    const projectKnowledgeBrief = location
      ? await this.resolveProjectKnowledgeBrief(location.projectRoot)
      : EMPTY_PROJECT_KNOWLEDGE_BRIEF;
    const injected = [runtime?.injectedPromptText, memoryBrief.text, projectKnowledgeBrief.text]
      .filter(Boolean)
      .join("\n\n");
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

  private async resolveProjectKnowledgeBrief(projectRoot: string): Promise<PersonalityMemoryBrief> {
    if (!this.deps.resolveProjectKnowledgeBrief) return EMPTY_PROJECT_KNOWLEDGE_BRIEF;
    try {
      return await this.deps.resolveProjectKnowledgeBrief({ projectRoot });
    } catch (error) {
      this.deps.logger.warn(
        { err: error, projectRoot },
        "Failed to resolve project knowledge weight; reporting without it",
      );
      return EMPTY_PROJECT_KNOWLEDGE_BRIEF;
    }
  }
}

/**
 * What Otto can honestly claim to see, per category, for one provider.
 *
 * Otto owns the whole payload for the OpenAI-compatible family, which makes it
 * the only family whose preset and tool schemas are measurable - and the ground
 * truth every convention-based estimate is validated against. Every CLI-backed
 * provider assembles its own preset and hands its MCP servers to a subprocess,
 * so those two categories are unmeasurable there. Saying so on the row is the
 * point: a user comparing providers should be able to see *where* the numbers
 * stop being complete, rather than inferring it from a missing line.
 *
 * This keys off the adapter's `ownsContextPayload` capability, never a provider
 * id. It used to test `provider === "openai-compat"`, which matched nothing
 * that runs: there is no provider registered under that id. `otto-brain` is an
 * OpenAI-compatible client, and each user-configured endpoint mints an id of
 * its own, so both rows read `not_visible` on every host - including the one
 * provider Otto measures exactly.
 */
function resolveCategoryVisibility(params: {
  runtime: WorkspaceContextRuntime | null;
}): Partial<Record<ContextCategory, ContextCategoryVisibility>> {
  const { runtime } = params;
  const ownsPayload = runtime?.ownsContextPayload === true;

  return {
    // Otto composes personality, team and daemon-append text itself, on every
    // provider - this row is exact everywhere.
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
