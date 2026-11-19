import { randomUUID } from "node:crypto";

export type SuggestedTaskMode = "new_chat" | "subagent" | "worktree" | "in_session";

export interface TaskParent {
  agentId: string;
  workspaceId: string;
}

export interface TaskSuggestion extends TaskParent {
  id: string;
  title: string;
  summary: string;
}

interface TaskEntry {
  card: TaskSuggestion;
  prompt: string;
  state: "pending" | "starting" | "started" | "dismissed" | "uncertain";
  expires: number;
}

const TTL = 24 * 60 * 60 * 1000;
const LIMIT = 256;
const PER_CHAT_LIMIT = 8;

/** Daemon-owned receipts keep the launch prompt out of client snapshots. */
export class SuggestedTasks {
  private readonly tasks = new Map<string, TaskEntry>();

  suggest(parent: TaskParent, input: { title: string; summary: string; prompt: string }) {
    this.prune();
    if (this.list(parent).length >= PER_CHAT_LIMIT || this.tasks.size >= LIMIT) {
      throw new Error("Dismiss a pending suggestion before adding another.");
    }
    const card: TaskSuggestion = {
      ...parent,
      id: randomUUID(),
      title: input.title,
      summary: input.summary,
    };
    this.tasks.set(card.id, {
      card,
      prompt: input.prompt,
      state: "pending",
      expires: Date.now() + TTL,
    });
    return card;
  }

  list(parent: TaskParent): TaskSuggestion[] {
    this.prune();
    return [...this.tasks.values()]
      .filter(
        (entry) =>
          this.belongsTo(entry, parent) &&
          (entry.state === "pending" || entry.state === "starting"),
      )
      .map(({ card }) => Object.assign({}, card));
  }

  dismiss(parent: TaskParent, id: string): boolean {
    const entry = this.get(parent, id);
    if (entry.state === "dismissed" || entry.state === "started") return false;
    if (entry.state === "starting") throw new Error("The suggested task is starting.");
    entry.state = "dismissed";
    entry.prompt = "";
    return true;
  }

  async start<T>(
    parent: TaskParent,
    id: string,
    launch: (card: TaskSuggestion, prompt: string) => Promise<T>,
  ): Promise<T> {
    const entry = this.get(parent, id);
    if (entry.state !== "pending") throw new Error("This suggestion has already been acted on.");
    entry.state = "starting";
    try {
      const result = await launch(entry.card, entry.prompt);
      entry.state = "started";
      entry.prompt = "";
      return result;
    } catch (error) {
      entry.state = "uncertain";
      entry.prompt = "";
      throw new Error(
        "The launch did not report an outcome. Check the workspace before trying again.",
        { cause: error },
      );
    }
  }

  private belongsTo(entry: TaskEntry, parent: TaskParent) {
    return entry.card.agentId === parent.agentId && entry.card.workspaceId === parent.workspaceId;
  }

  private get(parent: TaskParent, id: string) {
    this.prune();
    const entry = this.tasks.get(id);
    if (!entry || !this.belongsTo(entry, parent))
      throw new Error("This suggestion is unavailable.");
    return entry;
  }

  private prune() {
    const now = Date.now();
    for (const [id, entry] of this.tasks) {
      if (entry.state !== "starting" && entry.expires <= now) this.tasks.delete(id);
    }
  }
}

const services = new WeakMap<object, SuggestedTasks>();
export function suggestionsFor(host: object): SuggestedTasks {
  const existing = services.get(host);
  if (existing) return existing;
  const created = new SuggestedTasks();
  services.set(host, created);
  return created;
}
