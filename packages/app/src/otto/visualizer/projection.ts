import type { AgentUsage, ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, AgentToolCallData } from "@/types/stream";
import type { VisualizerEvent, VisualizerSession } from "@getpaseo/visualizer/contracts";
import { canonicalVisualizerPath, VisualizerCollisions } from "./file-collisions";
import { visualizerDiscovery } from "./discoveries";
import { visualizerDataPreview } from "./tool-data";

export const ALL_VISUALIZER_CHATS = "otto:all-active-chats";
export const MAX_VISUALIZER_AGENTS = 64;
export const MAX_VISUALIZER_ROWS = 256;
function fingerprint(value: string) {
  let left = 2166136261,
    right = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 16777619);
    right = Math.imul(right, 33) ^ code;
  }
  return `${value.length}:${left >>> 0}:${right >>> 0}`;
}
const MAX_TEXT = 12_000;
const clip = (text: string, max = MAX_TEXT) =>
  text.length > max ? `${text.slice(0, max)}…` : text;
export function visualizerRuntime(provider: string) {
  if (provider === "claude") return "claude";
  if (provider.startsWith("codex")) return "codex";
  if (provider === "copilot" || provider === "opencode" || provider === "pi") return provider;
  return "openai-compat";
}
export interface VisualizerAgentInput {
  id: string;
  parentId: string | null;
  title: string | null;
  provider: string;
  model: string | null;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  phase: "working" | "idle" | "waiting" | "closed" | "error";
  usage?: AgentUsage;
}
export interface VisualizerProjectionInput {
  agents: readonly VisualizerAgentInput[];
  timelines: ReadonlyMap<string, readonly StreamItem[]>;
}
export interface VisualizerProjection {
  sessions: VisualizerSession[];
  events: VisualizerEvent[];
  files: ReadonlySet<string>;
  truncated: boolean;
}
function rootOf(agent: VisualizerAgentInput, agents: ReadonlyMap<string, VisualizerAgentInput>) {
  const visited = new Set([agent.id]);
  let current = agent;
  while (current.parentId && agents.has(current.parentId)) {
    const parent = agents.get(current.parentId);
    if (!parent || visited.has(parent.id)) return agent.id;
    visited.add(parent.id);
    current = parent;
  }
  return current.id;
}
function toolText(detail: ToolCallDetail) {
  if (detail.type === "read" || detail.type === "write" || detail.type === "edit")
    return fileToolText(detail);
  switch (detail.type) {
    case "shell":
      return {
        args: clip(detail.command, 1000),
        result: clip(detail.output ?? ""),
        inputData: { command: clip(detail.command, 4000) },
      };
    default:
      return otherToolText(detail);
  }
}
function fileToolText(detail: Extract<ToolCallDetail, { type: "read" | "write" | "edit" }>) {
  switch (detail.type) {
    case "read":
      return {
        args: detail.filePath,
        result: clip(detail.content ?? ""),
        inputData: { file_path: detail.filePath },
      };
    case "write":
      return {
        args: detail.filePath,
        result: clip(detail.content ?? ""),
        inputData: { file_path: detail.filePath, content: clip(detail.content ?? "", 4000) },
      };
    case "edit":
      return {
        args: detail.filePath,
        result: clip(detail.unifiedDiff ?? detail.newString ?? ""),
        inputData: {
          file_path: detail.filePath,
          old_string: clip(detail.oldString ?? "", 4000),
          new_string: clip(detail.newString ?? "", 4000),
        },
      };
  }
}
function otherToolText(detail: ToolCallDetail) {
  switch (detail.type) {
    case "search":
      return {
        args: clip(detail.query, 1000),
        result: clip(detail.content ?? detail.filePaths?.join("\n") ?? ""),
        inputData: { query: clip(detail.query, 4000) },
      };
    case "fetch":
      return {
        args: clip(detail.url, 1000),
        result: clip(detail.result ?? ""),
        inputData: { url: clip(detail.url, 4000) },
      };
    case "sub_agent":
      return {
        args: clip(detail.description ?? ""),
        result: clip(detail.log),
        inputData: { description: clip(detail.description ?? "", 4000) },
      };
    case "plain_text":
      return { args: clip(detail.label ?? ""), result: clip(detail.text ?? ""), inputData: {} };
    case "plan":
      return { args: "Plan", result: clip(detail.text), inputData: {} };
    case "worktree_setup":
      return { args: clip(detail.branchName), result: clip(detail.log), inputData: {} };
    case "unknown":
      return {
        args: clip(visualizerDataPreview(detail.input), 1000),
        result: visualizerDataPreview(detail.output),
        inputData: { input: clip(visualizerDataPreview(detail.input), 4000) },
      };
    default:
      return { args: "", result: "", inputData: {} };
  }
}
function toolPath(detail: ToolCallDetail) {
  if (detail.type === "read" || detail.type === "edit" || detail.type === "write")
    return detail.filePath;
  return null;
}
function toolResult(data: AgentToolCallData, result: string) {
  if (data.status === "canceled") return { result: "Canceled", isError: false };
  if (data.status !== "failed") return { result, isError: false };
  const message = typeof data.error === "string" ? data.error : "Tool failed";
  return {
    result: result || message,
    isError: true,
    errorMessage: clip(message, 2000),
    discovery: { type: "error", label: clip(data.name, 80), content: clip(message, 2000) },
  };
}
/** A bounded display projection of canonical rows. No fetching or ownership of
 * chats, provider streams or usage estimates lives in this class. */
export class VisualizerProjector {
  private readonly seen = new Map<string, string>();
  // Canonical reducers replace changed rows. Weak keys avoid retaining evicted
  // transcripts, and unchanged history is not re-serialized on every token.
  private readonly projectedRows = new WeakMap<StreamItem, Set<string>>();
  private readonly metadata = new Map<string, string>();
  private readonly phases = new Map<string, VisualizerAgentInput["phase"]>();
  private readonly collisions = new VisualizerCollisions();
  private readonly touched = new Set<string>();
  private readonly files = new Set<string>();
  private origin: number | null = null;
  private readonly hydrated = new Set<string>();
  update(input: VisualizerProjectionInput): VisualizerProjection {
    const selected = input.agents.slice(0, MAX_VISUALIZER_AGENTS);
    const agents = new Map(selected.map((agent) => [agent.id, agent]));
    const roots = new Map(selected.map((agent) => [agent.id, rootOf(agent, agents)]));
    const ordered = [...selected].sort(
      (left, right) =>
        Number(roots.get(left.id) !== left.id) - Number(roots.get(right.id) !== right.id),
    );
    this.origin ??= Math.min(Date.now(), ...selected.map((agent) => agent.createdAt));
    const events: VisualizerEvent[] = [];
    let collisionCount = 0;
    const rowLimit = Math.min(
      MAX_VISUALIZER_ROWS,
      Math.max(1, Math.floor(3500 / Math.max(1, input.timelines.size) / 2)),
    );
    const hydrating = new Set(
      selected
        .filter((agent) => input.timelines.has(agent.id) && !this.hydrated.has(agent.id))
        .map((agent) => agent.id),
    );
    const emit = (
      agent: VisualizerAgentInput,
      type: VisualizerEvent["type"],
      payload: Record<string, unknown>,
      at = agent.updatedAt,
    ) => {
      // One busy shared file must not turn pairwise overlap notices into an
      // unbounded hydration frame. Tool/result rows retain their own budget.
      if (type === "file_collision" && ++collisionCount > 128) return;
      events.push({
        sessionId: roots.get(agent.id) ?? agent.id,
        type,
        payload,
        time: Math.max(0, (at - (this.origin ?? at)) / 1000),
        ...(hydrating.has(agent.id) ? { hydrate: true } : {}),
      });
    };
    for (const agent of ordered) {
      const key = `agent:${agent.id}`;
      const label = clip(agent.title?.trim() || "Chat", 120);
      const summary = JSON.stringify([
        label,
        agent.phase,
        agent.model,
        agent.usage,
        agent.parentId,
      ]);
      if (
        !this.metadata.has(key) ||
        (this.phases.get(agent.id) === "closed" && agent.phase !== "closed")
      ) {
        emit(
          agent,
          "agent_spawn",
          {
            name: agent.id,
            parent: agent.parentId && agents.has(agent.parentId) ? agent.parentId : undefined,
            isMain: roots.get(agent.id) === agent.id,
            model: agent.model ?? undefined,
            runtime: visualizerRuntime(agent.provider),
            task: label,
            contextKnown: false,
          },
          agent.createdAt,
        );
      }
      if (this.metadata.get(key) !== summary) {
        emit(agent, "agent_rename", { agent: agent.id, label });
        if (agent.model) emit(agent, "model_detected", { agent: agent.id, model: agent.model });
        if (agent.usage) emit(agent, "context_update", this.usage(agent));
      }
      for (const item of (input.timelines.get(agent.id) ?? []).slice(-rowLimit)) {
        this.row(agent, item, emit);
      }
      if (
        this.metadata.get(key) !== summary ||
        events.some((event) => event.payload.agent === agent.id)
      )
        this.phase(agent, emit);
      this.metadata.set(key, summary);
      this.phases.set(agent.id, agent.phase);
      if (input.timelines.has(agent.id)) this.hydrated.add(agent.id);
    }
    this.prune(agents);
    // Bounded display dedup state, independent of canonical transcript retention.
    const activeRoots = new Set(
      selected.filter((agent) => agent.phase !== "closed").map((agent) => roots.get(agent.id)),
    );
    const sessions = selected
      .filter((agent) => roots.get(agent.id) === agent.id)
      .map((agent) => ({
        id: agent.id,
        label: clip(agent.title?.trim() || "Chat", 24),
        status: activeRoots.has(agent.id) ? ("active" as const) : ("completed" as const),
        startTime: agent.createdAt,
        lastActivityTime: agent.updatedAt,
      }));
    return {
      sessions,
      events,
      files: this.files,
      truncated: projectionTruncated(input, rowLimit, collisionCount),
    };
  }
  private prune(agents: ReadonlyMap<string, VisualizerAgentInput>) {
    for (const id of this.phases.keys())
      if (!agents.has(id)) {
        this.phases.delete(id);
        this.hydrated.delete(id);
      }
    for (const key of this.metadata.keys())
      if (!agents.has(key.slice(6))) this.metadata.delete(key);
    while (this.seen.size > MAX_VISUALIZER_AGENTS * MAX_VISUALIZER_ROWS) {
      const oldest = this.seen.keys().next().value;
      if (oldest) this.seen.delete(oldest);
    }
  }
  private usage(agent: VisualizerAgentInput) {
    const usage = agent.usage;
    return {
      agent: agent.id,
      tokens: usage?.contextWindowUsedTokens,
      tokensMax: usage?.contextWindowMaxTokens,
      costUsd: usage?.totalCostUsd,
      contextKnown:
        typeof usage?.contextWindowUsedTokens === "number" &&
        typeof usage?.contextWindowMaxTokens === "number" &&
        usage.contextWindowMaxTokens > 0,
    };
  }
  private phase(
    agent: VisualizerAgentInput,
    emit: (
      agent: VisualizerAgentInput,
      type: VisualizerEvent["type"],
      payload: Record<string, unknown>,
      at?: number,
    ) => void,
  ) {
    if (agent.phase === "closed") emit(agent, "agent_complete", { name: agent.id });
    else if (agent.phase === "waiting") emit(agent, "permission_requested", { agent: agent.id });
    else
      emit(agent, "agent_idle", {
        name: agent.id,
        resting: agent.phase === "idle",
        working: agent.phase === "working",
        error: agent.phase === "error",
      });
  }
  private row(
    agent: VisualizerAgentInput,
    item: StreamItem,
    emit: (
      agent: VisualizerAgentInput,
      type: VisualizerEvent["type"],
      payload: Record<string, unknown>,
      at?: number,
    ) => void,
  ) {
    const projected = this.projectedRows.get(item);
    if (projected?.has(agent.id)) return;
    const identities = projected ?? new Set<string>();
    identities.add(agent.id);
    this.projectedRows.set(item, identities);
    const key = JSON.stringify([agent.id, item.id]);
    const payloads = this.rowPayload(agent, item);
    const signature = fingerprint(JSON.stringify(payloads));
    const previous = this.seen.get(key);
    if (previous === signature) return;
    this.seen.set(key, signature);
    for (const value of payloads) {
      if (previous && value.type === "tool_call_start") continue;
      emit(agent, value.type, value.payload, item.timestamp.getTime());
    }
    if (item.kind === "tool_call" && item.payload.source === "agent") this.touch(agent, item, emit);
  }
  private rowPayload(
    agent: VisualizerAgentInput,
    item: StreamItem,
  ): Array<{ type: VisualizerEvent["type"]; payload: Record<string, unknown> }> {
    if (
      item.kind === "assistant_message" ||
      item.kind === "user_message" ||
      item.kind === "thought"
    ) {
      const role = { assistant_message: "assistant", user_message: "user", thought: "thinking" }[
        item.kind
      ];
      return [
        {
          type: "message",
          payload: { agent: agent.id, role, content: clip(item.text), messageId: item.id },
        },
      ];
    }
    if (item.kind !== "tool_call" || item.payload.source !== "agent") return [];
    const data = item.payload.data;
    const content = toolText(data.detail);
    const path = toolPath(data.detail);
    if (path)
      content.inputData = Object.assign({}, content.inputData, {
        file_path: clip(canonicalVisualizerPath(path, agent.cwd) ?? path, 4096),
      });
    const base = { agent: agent.id, tool: clip(data.name, 200), callId: clip(data.callId, 512) };
    const payloads: Array<{ type: VisualizerEvent["type"]; payload: Record<string, unknown> }> = [
      {
        type: "tool_call_start",
        payload: {
          ...base,
          args: clip(content.args, 1000),
          inputData: content.inputData,
          ...(path ? { fileAccess: data.detail.type === "read" ? "read" : "write" } : {}),
        },
      },
    ];
    if (data.status !== "running")
      payloads.push({
        type: "tool_call_end",
        payload: {
          ...base,
          ...toolResult(data, content.result),
          ...(data.status === "completed"
            ? { discovery: visualizerDiscovery(data.detail, false) }
            : {}),
        },
      });
    return payloads;
  }
  private touch(
    agent: VisualizerAgentInput,
    item: StreamItem & { kind: "tool_call" },
    emit: (
      agent: VisualizerAgentInput,
      type: VisualizerEvent["type"],
      payload: Record<string, unknown>,
      at?: number,
    ) => void,
  ) {
    if (item.payload.source !== "agent") return;
    const data = item.payload.data;
    const path = toolPath(data.detail);
    const identity = path && canonicalVisualizerPath(path, agent.cwd);
    const id = JSON.stringify([agent.id, data.callId]);
    if (!path || !identity || this.touched.has(id)) return;
    this.touched.add(id);
    this.files.add(identity);
    if (this.touched.size > 4096) {
      const first = this.touched.values().next().value;
      if (first) this.touched.delete(first);
    }
    if (this.files.size > 1024) {
      const first = this.files.values().next().value;
      if (first) this.files.delete(first);
    }
    const mode = data.detail.type === "read" ? "read" : "write";
    for (const previous of this.collisions.add({
      id,
      agent: agent.id,
      sessionId: agent.id,
      path: identity,
      mode,
      at: item.timestamp.getTime(),
    })) {
      emit(
        agent,
        "file_collision",
        {
          id: [previous.id, id].sort().join("|"),
          path: identity,
          fileIdentity: identity,
          leftAgent: previous.agent,
          rightAgent: agent.id,
          leftMode: previous.mode,
          rightMode: mode,
        },
        item.timestamp.getTime(),
      );
    }
  }
}
function projectionTruncated(
  input: VisualizerProjectionInput,
  rowLimit: number,
  collisions: number,
) {
  return (
    collisions > 128 ||
    input.agents.length > MAX_VISUALIZER_AGENTS ||
    [...input.timelines.values()].some((items) => items.length > rowLimit)
  );
}
