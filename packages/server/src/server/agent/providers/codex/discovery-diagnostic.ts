import type {
  ProviderDiscoveryDiagnostic,
  ProviderDiscoveryOptions,
} from "@otto-code/protocol/provider-discovery";
import {
  isMetadataGenerationSession,
  type DiscoveryImportContext,
} from "../../import-session-metadata.js";
import { createPathEquivalenceMatcher } from "../../../../utils/path.js";

interface MetadataClient {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  dispose(): Promise<void>;
}
export interface CodexDiscoveryRuntime {
  resolvedExecutable: string | null;
  launchHome: string | null;
}
interface DiscoveryDependencies {
  open: () => Promise<{ client: MetadataClient; runtime: CodexDiscoveryRuntime }>;
  initializeParams: unknown;
  imports: DiscoveryImportContext;
  timeoutMs?: number;
}
type DiagnosticError = NonNullable<ProviderDiscoveryDiagnostic["target"]["error"]>;
class DiagnosticTimeout extends Error {}
class InvalidMetadata extends Error {}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function identifier(value: unknown): string | null {
  const candidate = text(value);
  return candidate && /^[a-zA-Z0-9_.-]{1,200}$/.test(candidate) ? candidate : null;
}
function failure(error: unknown, startup = false): DiagnosticError {
  if (error instanceof DiagnosticTimeout) return "timeout";
  if (error instanceof InvalidMetadata) return "invalid_response";
  const entry = record(error);
  const message = error instanceof Error ? error.message : "";
  if (
    entry?.code === "EACCES" ||
    entry?.code === "EPERM" ||
    /access is denied|permission denied/i.test(message)
  ) {
    return "permission_denied";
  }
  return startup ? "startup_failed" : "provider_error";
}
function missingThread(error: unknown): boolean {
  // Codex reports missing stored threads as an invalid-request RPC error, not HTTP 404.
  // Match only its explicit absence messages; generic invalid params/access errors aren't absence.
  return (
    error instanceof Error &&
    /^(?:thread not found\b|no rollout found for thread id\b)/i.test(error.message)
  );
}
function sourceKind(value: unknown): string | null {
  const allowed = ["cli", "vscode", "atlas", "chatgpt", "appServer", "exec", "unknown"];
  if (typeof value === "string" && allowed.includes(value)) return value;
  return record(value)?.subAgent !== undefined ? "subAgent" : null;
}

function targetMetadata(
  response: unknown,
  threadId: string,
): ProviderDiscoveryDiagnostic["target"] {
  const thread = record(record(response)?.thread);
  if (!thread || thread.id !== threadId) throw new InvalidMetadata();
  return {
    requestedId: threadId,
    readAttempted: true,
    status: "found",
    nativeId: threadId,
    title: text(thread.name),
    cwd: text(thread.cwd),
    source: sourceKind(thread.source),
    modelProvider: identifier(thread.modelProvider),
    project: identifier(thread.projectId ?? record(thread.project)?.id ?? thread.project),
    section: identifier(thread.sectionId ?? record(thread.section)?.id ?? thread.section),
  };
}

function summarizePage(
  raw: unknown,
  options: ProviderDiscoveryOptions,
  imports: DiscoveryImportContext,
): ProviderDiscoveryDiagnostic["listing"] {
  const response = record(raw);
  if (!response || !Array.isArray(response.data)) throw new InvalidMetadata();
  const cursorPresent = Object.hasOwn(response, "nextCursor");
  if (cursorPresent && response.nextCursor !== null && typeof response.nextCursor !== "string")
    throw new InvalidMetadata();
  const counts = countExclusions(response.data, options, imports);
  return {
    status: "ok",
    rawCount: response.data.length,
    cursorPresent,
    ...(cursorPresent ? { nextCursor: response.nextCursor as string | null } : {}),
    ...counts,
  };
}

function countExclusions(
  rows: unknown[],
  options: ProviderDiscoveryOptions,
  imports: DiscoveryImportContext,
) {
  const matchesCwd = options.cwd ? createPathEquivalenceMatcher(options.cwd) : null;
  const excluded = { invalidMetadata: 0, cwd: 0, metadataGeneration: 0, alreadyImported: 0 };
  let eligibleCount = 0;
  let targetPresent = false;
  for (const raw of rows) {
    const thread = record(raw);
    if (!thread || typeof thread.id !== "string") {
      excluded.invalidMetadata++;
      continue;
    }
    if (thread.id === options.threadId) targetPresent = true;
    // Same cwd check as normal Codex discovery, never workspace ownership.
    if (matchesCwd && (typeof thread.cwd !== "string" || !matchesCwd(thread.cwd))) excluded.cwd++;
    else if (isMetadataGenerationSession({ firstPromptPreview: text(thread.preview) }))
      excluded.metadataGeneration++;
    else if (imports.isImported(thread.id)) excluded.alreadyImported++;
    else eligibleCount++;
  }
  return { excluded, eligibleCount, targetPresent };
}

/** One helper process, a fixed read-only RPC allowlist, and a total request budget. */
export async function diagnoseCodexDiscovery(
  options: ProviderDiscoveryOptions,
  deps: DiscoveryDependencies,
): Promise<ProviderDiscoveryDiagnostic> {
  const result: ProviderDiscoveryDiagnostic = {
    runtime: {
      resolvedExecutable: null,
      version: null,
      reportedHome: null,
      launchHome: null,
      homeVerification: "unverified",
      configuredModelProvider: null,
      storageBackend: null,
    },
    target: {
      requestedId: options.threadId,
      readAttempted: false,
      status: "error",
      error: "startup_failed",
      errorStage: "startup",
    },
    listing: { status: "error", error: "startup_failed" },
    knownImportedSessionCount: deps.imports.knownImportedSessionCount,
    request: options,
  };
  const deadline = Date.now() + (deps.timeoutMs ?? 10_000);
  let client: MetadataClient | undefined;
  let readAttempted = false;
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new DiagnosticTimeout()),
            Math.max(0, deadline - Date.now()),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const request = (method: string, params: unknown) => {
    if (Date.now() >= deadline) throw new DiagnosticTimeout();
    if (method === "thread/read") readAttempted = true;
    return bounded(client!.request(method, params));
  };
  try {
    // A slow opener must still dispose its eventual process after the deadline.
    const opening = deps.open().then((opened) => {
      if (Date.now() >= deadline) {
        void opened.client.dispose().catch(() => {});
        throw new DiagnosticTimeout();
      }
      return opened;
    });
    const opened = await bounded(opening);
    client = opened.client;
    Object.assign(result.runtime, opened.runtime);
    if (opened.runtime.launchHome) result.runtime.homeVerification = "launch_environment_only";
    const init = record(await request("initialize", deps.initializeParams));
    client.notify("initialized", {});
    // Never expose userAgent verbatim: it can include machine/user information.
    result.runtime.version =
      text(init?.userAgent)?.match(/\b\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\b/)?.[0] ?? null;
    result.runtime.reportedHome = text(init?.codexHome);
    if (result.runtime.reportedHome) result.runtime.homeVerification = "runtime";
    try {
      const config = record(record(await request("config/read", { includeLayers: false }))?.config);
      result.runtime.configuredModelProvider = identifier(config?.model_provider);
    } catch {
      /* Runtime may not expose configuration; unknown is not a guessed backend. */
    }
    try {
      result.target = targetMetadata(
        await request("thread/read", {
          threadId: options.threadId,
          includeTurns: false,
        }),
        options.threadId,
      );
    } catch (error) {
      result.target = missingThread(error)
        ? { requestedId: options.threadId, readAttempted, status: "not_found" }
        : {
            requestedId: options.threadId,
            readAttempted,
            status: "error",
            error: failure(error),
            errorStage: "thread_read",
          };
    }
    async function page(source?: string): Promise<ProviderDiscoveryDiagnostic["listing"]> {
      try {
        const response = await request("thread/list", {
          limit: options.limit ?? 20,
          archived: false,
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(!source && options.cursor ? { cursor: options.cursor } : {}),
          ...(source ? { sourceKinds: [source] } : {}),
          // Preserve archived-hidden, model-provider, project and section defaults.
        });
        return summarizePage(response, options, deps.imports);
      } catch (error) {
        return { status: "error", error: failure(error) };
      }
    }
    result.listing = await page();
    if (options.compareSource) result.sourceComparison = await page(options.compareSource);
  } catch (error) {
    const safeError = failure(error, true);
    result.target.error = safeError;
    result.listing.error = safeError;
  } finally {
    // Only the helper is closed. Never affect an active agent or daemon.
    await client?.dispose().catch(() => {});
  }
  return result;
}
