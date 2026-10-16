import type { AgentSnapshotPayload } from "@otto-code/protocol/messages";
import type { WaitForFinishResult } from "@otto-code/client/internal/daemon-client";
import type { CommandError, OutputSchema } from "./types.js";

export interface AgentCreatedRecord {
  type: "agent.created";
  agentId: string;
  workspaceId: string | null;
  provider: string;
  cwd: string;
  title: string | null;
}

/** Terminal for this CLI wait, not evidence that the user's task is complete. */
export interface AgentWaitRecord {
  type: "agent.wait";
  agentId: string;
  status: WaitForFinishResult["status"];
  lastMessage: string | null;
  error: string | null;
  permissions: Array<{ id: string; kind: string }>;
}

export interface AgentStreamErrorRecord {
  type: "error";
  agentId: string | null;
  error: CommandError;
}

export type AgentStreamRecord = AgentCreatedRecord | AgentWaitRecord | AgentStreamErrorRecord;

/** Await the write callback so a piped receipt leaves Node before foreground waiting starts. */
export function writeJsonRecord(record: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(record)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function toCreatedRecord(agent: AgentSnapshotPayload): AgentCreatedRecord {
  return {
    type: "agent.created",
    agentId: agent.id,
    workspaceId: agent.workspaceId ?? null,
    provider: agent.provider,
    cwd: agent.cwd,
    title: agent.title,
  };
}

export function streamWaitSchema<T>(
  schema: OutputSchema<T>,
  agentId: string,
  state: WaitForFinishResult,
): OutputSchema<T> {
  const record: AgentWaitRecord = {
    type: "agent.wait",
    agentId,
    status: state.status,
    lastMessage: state.lastMessage,
    error: state.error,
    permissions: (state.final?.pendingPermissions ?? []).map(({ id, kind }) => ({ id, kind })),
  };
  return { ...schema, serialize: () => record };
}

export function validateStreamOptions(options: {
  streamJson?: boolean;
  json?: boolean;
  quiet?: boolean;
  format?: unknown;
}): void {
  if (
    options.streamJson &&
    (options.json || options.quiet || (options.format !== undefined && options.format !== "table"))
  ) {
    throw {
      code: "INVALID_OPTIONS",
      message: "Use --stream-json without --json, --quiet, or another output format",
    } satisfies CommandError;
  }
}
