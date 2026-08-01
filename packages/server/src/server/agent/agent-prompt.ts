import type { Logger } from "pino";

import type { AgentPromptInput, AgentRunOptions } from "./agent-sdk-types.js";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import { ensureAgentLoaded } from "./agent-loading.js";

export type AgentRunController = Pick<
  AgentManager,
  | "getAgent"
  | "tryRunOutOfBand"
  | "hasInFlightRun"
  | "replaceAgentRun"
  | "streamAgent"
  | "enqueueSteerMessage"
>;

/**
 * How a prompt reaches a BUSY agent. Against an idle agent both modes are the
 * same thing: run it now.
 *
 * - `interrupt` — cancel the in-flight turn and run this instead, in the same
 *   provider session. Today's behavior, and still the default so no existing
 *   caller changes.
 * - `queue` — let the turn finish, then run this as the next turn.
 *
 * Lives in the turn lifecycle, above every provider adapter, so it behaves
 * identically for every provider.
 */
export type AgentPromptDelivery = "interrupt" | "queue";

export interface StartAgentRunOptions {
  replaceRunning?: boolean;
  runOptions?: AgentRunOptions;
  delivery?: AgentPromptDelivery;
  /** Marks system-injected prompts so the queue never merges them into a user turn. */
  source?: "user" | "system";
}

export interface StartAgentRunResult {
  outOfBand: boolean;
  /** True when the prompt was parked for the next turn instead of dispatched. */
  queued: boolean;
  /** The queue entry's id, so the caller can find its own message again. */
  queuedMessageId?: string;
}

/**
 * `queue` only defers against a BUSY agent. `enqueueSteerMessage` does the busy
 * check and the push in one synchronous block and reports back whether it took
 * the prompt, so an idle agent falls straight through to running it now.
 * Returns null when the caller should dispatch normally.
 */
function tryQueuePrompt(
  agentManager: AgentRunController,
  agentId: string,
  prompt: AgentPromptInput,
  logger: Logger,
  options: StartAgentRunOptions | undefined,
): StartAgentRunResult | null {
  if (options?.delivery !== "queue") {
    return null;
  }
  const enqueued = agentManager.enqueueSteerMessage(agentId, prompt, {
    ...(options.runOptions ? { runOptions: options.runOptions } : {}),
    ...(options.source ? { source: options.source } : {}),
  });
  if (!enqueued.queued) {
    return null;
  }
  logger.trace({ agentId, entryId: enqueued.entry?.id }, "agent.session.start_stream.queued");
  return {
    outOfBand: false,
    queued: true,
    ...(enqueued.entry ? { queuedMessageId: enqueued.entry.id } : {}),
  };
}

export function startAgentRun(
  agentManager: AgentRunController,
  agentId: string,
  prompt: AgentPromptInput,
  logger: Logger,
  options?: StartAgentRunOptions,
): StartAgentRunResult {
  const snapshot = agentManager.getAgent(agentId);
  logger.trace(
    {
      agentId,
      provider: snapshot?.provider,
      providerSessionId: snapshot?.persistence?.sessionId ?? undefined,
      turnId: snapshot?.activeForegroundTurnId ?? undefined,
      promptType: typeof prompt === "string" ? "string" : "structured",
      hasRunOptions: Boolean(options?.runOptions),
      replaceRunning: Boolean(options?.replaceRunning),
    },
    "agent.session.start_stream.request",
  );
  // Out-of-band commands (e.g. /goal pause) must run WITHOUT canceling an
  // in-flight turn — replaceAgentRun would interrupt the running turn. The
  // intercept lives at this layer so it covers every prompt entrypoint.
  if (agentManager.tryRunOutOfBand(agentId, prompt)) {
    return { outOfBand: true, queued: false };
  }
  const runOptions = options?.runOptions;
  const queuedResult = tryQueuePrompt(agentManager, agentId, prompt, logger, options);
  if (queuedResult) {
    return queuedResult;
  }
  const shouldReplace = Boolean(options?.replaceRunning && agentManager.hasInFlightRun(agentId));
  const iterator = shouldReplace
    ? agentManager.replaceAgentRun(agentId, prompt, runOptions)
    : agentManager.streamAgent(agentId, prompt, runOptions);
  logger.trace(
    {
      agentId,
      provider: snapshot?.provider,
      providerSessionId: snapshot?.persistence?.sessionId ?? undefined,
      shouldReplace,
    },
    "agent.session.start_stream.iterator_returned",
  );
  void (async () => {
    try {
      for await (const _ of iterator) {
        // Events are broadcast via AgentManager subscribers.
      }
      logger.trace(
        {
          agentId,
          provider: snapshot?.provider,
          providerSessionId: snapshot?.persistence?.sessionId ?? undefined,
        },
        "agent.session.iterator.drained",
      );
    } catch (error) {
      logger.trace(
        {
          agentId,
          provider: snapshot?.provider,
          providerSessionId: snapshot?.persistence?.sessionId ?? undefined,
          err: error,
        },
        "agent.session.iterator.error",
      );
      logger.error({ err: error, agentId }, "Agent stream failed");
    }
  })();
  return { outOfBand: false, queued: false };
}

/**
 * Clear the archived flag from a stored agent record.
 * Shared across Session (app/WS), MCP, and CLI so every surface that acts on
 * an archived agent unarchives it the same way.
 */
export interface AgentUnarchiveController {
  unarchiveSnapshot(
    agentId: string,
    updates?: { workspaceId?: string; labels?: Record<string, string | null> },
  ): Promise<boolean>;
  notifyAgentState(agentId: string): void;
}

export async function unarchiveAgentState(
  _agentStorage: AgentStorage,
  agentManager: AgentUnarchiveController,
  agentId: string,
  updates?: { workspaceId?: string; labels?: Record<string, string | null> },
): Promise<boolean> {
  const unarchived = await agentManager.unarchiveSnapshot(agentId, updates);
  if (!unarchived) return false;
  agentManager.notifyAgentState(agentId);
  return true;
}

/**
 * Wrap a body in <otto-system>…</otto-system> so the receiving agent
 * recognizes the prompt as system-injected context — not a user turn.
 * Used by chat mentions, schedule fires, and notify-on-finish.
 */
export function formatSystemNotificationPrompt(reason: string): string {
  return `<otto-system>\n${reason}\n</otto-system>`;
}

const SYSTEM_ENVELOPE_PATTERN = /^<otto-system>\n[\s\S]*\n<\/otto-system>$/;

export function isSystemInjectedEnvelope(text: string): boolean {
  return SYSTEM_ENVELOPE_PATTERN.test(text);
}

export interface SendPromptToAgentParams {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  agentId: string;
  /** Prompt to dispatch to the provider (may include image blocks or wrapped text). */
  prompt: AgentPromptInput;
  messageId?: string;
  runOptions?: AgentRunOptions;
  /** Optional mode to set on the agent before the run starts. */
  sessionMode?: string;
  /**
   * Default true. When false, archived agents are skipped instead of being
   * unarchived. Use false for system-injected prompts (chat mentions,
   * schedule fires, notify-on-finish).
   */
  unarchive?: boolean;
  /**
   * How to reach a busy agent. Defaults to `interrupt` — today's behavior for
   * every caller. See AgentPromptDelivery.
   */
  delivery?: AgentPromptDelivery;
  /**
   * Marks the prompt as Otto-injected (chat mention, schedule fire,
   * notify-on-finish) rather than typed by a person. Only affects queue
   * merging; system-injected entries are always delivered as their own turn.
   */
  source?: "user" | "system";
  logger: Logger;
}

export interface StartCreatedAgentInitialPromptParams {
  agentManager: AgentManager;
  agentId: string;
  snapshot?: ManagedAgent;
  prompt: AgentPromptInput | null;
  runOptions?: AgentRunOptions;
  logger: Logger;
}

const AGENT_RUN_START_TIMEOUT_MS = 15_000;

export async function waitForAgentRunStartWithTimeout(
  agentManager: AgentManager,
  agentId: string,
): Promise<void> {
  const startAbort = new AbortController();
  const startTimeout = setTimeout(() => startAbort.abort("timeout"), AGENT_RUN_START_TIMEOUT_MS);

  try {
    await agentManager.waitForAgentRunStart(agentId, { signal: startAbort.signal });
  } finally {
    clearTimeout(startTimeout);
  }
}

/**
 * Full send-prompt orchestration: (optional unarchive) → load → (optional
 * mode change) → start run.
 *
 * Every surface that sends a prompt to an agent (Session/WS, MCP, CLI-through-MCP,
 * chat mentions, notify-on-finish) MUST go through this so behavior can never
 * drift between them.
 *
 * When `unarchive` is false and the agent is archived, the call is a silent
 * no-op (returns `{ outOfBand: false }`) — the agent is not run.
 */
export async function sendPromptToAgent(
  params: SendPromptToAgentParams,
): Promise<StartAgentRunResult> {
  const unarchive = params.unarchive ?? true;

  const record = await params.agentStorage.get(params.agentId);
  if (record?.archivedAt) {
    if (!unarchive) {
      return { outOfBand: false, queued: false };
    }
    await unarchiveAgentState(params.agentStorage, params.agentManager, params.agentId);
  }

  await ensureAgentLoaded(params.agentId, {
    agentManager: params.agentManager,
    agentStorage: params.agentStorage,
    logger: params.logger,
  });

  if (params.sessionMode) {
    await params.agentManager.setAgentMode(params.agentId, params.sessionMode);
  }

  const runOptions = params.messageId
    ? { ...params.runOptions, messageId: params.messageId }
    : params.runOptions;

  return startAgentRun(params.agentManager, params.agentId, params.prompt, params.logger, {
    replaceRunning: true,
    runOptions,
    ...(params.delivery ? { delivery: params.delivery } : {}),
    ...(params.source ? { source: params.source } : {}),
  });
}

export async function startCreatedAgentInitialPrompt(
  params: StartCreatedAgentInitialPromptParams,
): Promise<ManagedAgent> {
  const currentSnapshot = params.agentManager.getAgent(params.agentId) ?? params.snapshot ?? null;
  if (!currentSnapshot) {
    throw new Error(`Agent ${params.agentId} not found`);
  }

  if (params.prompt === null) {
    return currentSnapshot;
  }

  const dispatchResult = startAgentRun(
    params.agentManager,
    params.agentId,
    params.prompt,
    params.logger,
    {
      runOptions: params.runOptions,
    },
  );

  if (!dispatchResult.outOfBand) {
    await waitForAgentRunStartWithTimeout(params.agentManager, params.agentId);
  }

  const refreshedSnapshot = params.agentManager.getAgent(params.agentId) ?? params.snapshot ?? null;
  if (!refreshedSnapshot) {
    throw new Error(`Agent ${params.agentId} not found`);
  }
  return refreshedSnapshot;
}

export interface SetupFinishNotificationParams {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  childAgentId: string;
  callerAgentId: string;
  /** Skip the notification when the child is no longer owned by the caller. */
  requireParentOwnership?: boolean;
  logger: Logger;
}

interface FinishNotificationBodyInput {
  childAgentId: string;
  title: string;
  reason: "finished" | "errored" | "needs permission";
  lastAssistantMessage: string | null;
}

function formatFinishNotificationBody(params: FinishNotificationBodyInput): string {
  const statusLine = `Agent ${params.childAgentId} (${params.title}) ${params.reason}.`;
  const lastAssistantMessage = params.lastAssistantMessage?.trim();
  if (!lastAssistantMessage) {
    return statusLine;
  }
  return `${statusLine}\n\n<agent-response>\n${lastAssistantMessage}\n</agent-response>`;
}

export function setupFinishNotification(params: SetupFinishNotificationParams): void {
  const {
    agentManager,
    agentStorage,
    childAgentId,
    callerAgentId,
    requireParentOwnership = false,
    logger,
  } = params;
  let hasSeenRunning = false;
  let fired = false;
  let unsubscribe: (() => void) | null = null;

  async function notify(reason: "finished" | "errored" | "needs permission"): Promise<void> {
    if (fired) {
      return;
    }
    fired = true;
    unsubscribe?.();

    const callerRecord = await agentStorage.get(callerAgentId);
    if (callerRecord?.archivedAt) {
      return;
    }

    const record = await agentStorage.get(childAgentId);
    if (requireParentOwnership && record?.labels?.["otto.parentAgentId"] !== callerAgentId) {
      return;
    }
    const title = record?.title ?? childAgentId;
    const lastAssistantMessage = await agentManager.getLastAssistantMessage(childAgentId);
    const body = formatFinishNotificationBody({
      childAgentId,
      title,
      reason,
      lastAssistantMessage,
    });

    await sendPromptToAgent({
      agentManager,
      agentStorage,
      agentId: callerAgentId,
      prompt: formatSystemNotificationPrompt(body),
      unarchive: false,
      // "Your child finished" is a report, not a correction. Interrupting the
      // parent destroyed the turn it was running while the child worked, and a
      // fan-out of N children interrupted it N times in a row — it could never
      // finish a turn. Queued, each report still lands as its own turn (system
      // entries never merge), in completion order. See docs/chat-lifecycle.md.
      delivery: "queue",
      source: "system",
      logger,
    });
  }

  unsubscribe = agentManager.subscribe(
    (event) => {
      if (fired) {
        return;
      }

      if (event.type === "agent_state") {
        if (event.agent.lifecycle === "running") {
          hasSeenRunning = true;
          return;
        }
        if (event.agent.lifecycle === "error") {
          void notify("errored");
          return;
        }
        if (event.agent.lifecycle === "idle" && hasSeenRunning) {
          void notify("finished");
          return;
        }
        if (event.agent.lifecycle === "closed") {
          fired = true;
          unsubscribe?.();
          return;
        }
        return;
      }

      if (event.type === "agent_stream" && event.event.type === "permission_requested") {
        void notify("needs permission");
      }
    },
    { agentId: childAgentId, replayState: false },
  );

  // Check if the child is already running (catches the case where
  // the lifecycle flipped before our subscribe call was processed).
  // Do NOT treat an immediate "idle" as "finished" — the agent may
  // not have started yet (streamAgent sets a pending run before
  // transitioning to "running").
  const childSnapshot = agentManager.getAgent(childAgentId);
  if (!childSnapshot || childSnapshot.lifecycle === "closed") {
    unsubscribe();
    return;
  }
  if (childSnapshot.lifecycle === "running") {
    hasSeenRunning = true;
  } else if (childSnapshot.lifecycle === "error") {
    void notify("errored");
  }
}
