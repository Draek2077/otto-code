import type { ArtifactRef } from "@getpaseo/plugin/otto/artifacts";
import type { WorkflowRef } from "@getpaseo/plugin/otto/workflows";
import type { ScheduleSources } from "./sources";
import type { ScheduleTargetModel } from "./target-model";

type Source = { kind: "workflow"; ref: WorkflowRef } | { kind: "artifact"; ref: ArtifactRef };
export interface ScheduleSourceChoice {
  key: string;
  label: string;
  source: Source;
}
/** A form's bounded selection resource. Canonical libraries and documents remain host-owned. */
export class ScheduleTargetLibrary {
  private listeners = new Set<() => void>();
  private active = false;
  private authority = 0;
  private state: {
    choices: ScheduleSourceChoice[];
    busy: boolean;
    error: string;
    next: number | null;
    offset: number;
    diagnostics: string[];
  } = { choices: [], busy: false, error: "", next: null, offset: 0, diagnostics: [] };
  constructor(
    readonly sources: ScheduleSources,
    readonly scope: { hostId: string; projectId: string },
    readonly kind: "workflow" | "artifact",
    readonly target: ScheduleTargetModel,
    readonly artifactWorkspaceId: string | null = null,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    const authority = ++this.authority;
    void this.load(0);
    return () => {
      if (authority === this.authority) {
        this.active = false;
        ++this.authority;
      }
    };
  }
  async load(offset: number) {
    if (!this.active || this.state.busy) return;
    const authority = this.authority;
    this.publish({ busy: true, error: "" });
    try {
      const page = await this.page(offset);
      if (this.active && authority === this.authority) this.publish({ ...page, offset });
    } catch {
      if (this.active && authority === this.authority)
        this.publish({
          error:
            "The selected host could not read this library. Reconnect or refresh before choosing a saved target.",
        });
    } finally {
      this.publish({ busy: false });
    }
  }
  private async page(offset: number) {
    if (this.kind === "workflow") {
      const page = await this.sources.workflows({
        scope: this.scope,
        kind: "definition",
        offset,
        includeLegacy: true,
      });
      return {
        choices: page.items
          .filter((row) => row.ref.kind === "ai" || row.ref.kind === "graph")
          .map((row) => ({
            key: JSON.stringify(row.ref),
            label: `${row.title} · ${row.ref.kind} · ${row.ref.location}`,
            source: { kind: "workflow" as const, ref: row.ref },
          })),
        next: page.nextOffset,
        diagnostics: page.diagnostics,
      };
    }
    const scope: ArtifactRef["scope"] = {
      hostId: this.scope.hostId,
      target: this.artifactWorkspaceId
        ? { kind: "workspace", id: this.artifactWorkspaceId }
        : { kind: "project", id: this.scope.projectId },
    };
    const page = await this.sources.artifacts({ scope, offset });
    return {
      choices: page.items.map((row) => ({
        key: JSON.stringify([scope, row.location, row.id]),
        label: `${row.name} · ${row.location}`,
        source: { kind: "artifact" as const, ref: { scope, id: row.id, location: row.location } },
      })),
      next: offset + page.items.length < page.total ? offset + page.items.length : null,
      diagnostics: page.diagnostics,
    };
  }
  async select(key: string) {
    if (!this.active || this.state.busy) return;
    const choice = this.state.choices.find((row) => row.key === key);
    if (!choice) return;
    const authority = this.authority;
    this.publish({ busy: true, error: "" });
    try {
      if (choice.source.kind === "artifact") this.target.artifact(choice.source.ref, choice.label);
      else {
        const entry = await this.sources.workflow(choice.source.ref);
        if (!this.active || authority !== this.authority) return;
        if (JSON.stringify(entry.ref) !== JSON.stringify(choice.source.ref))
          throw new Error("Mismatched source");
        this.target.workflow(entry, choice.label);
      }
    } catch {
      if (this.active && authority === this.authority)
        this.publish({
          error:
            "This saved target could not be read at its selected origin. Refresh the library and choose deliberately.",
        });
    } finally {
      this.publish({ busy: false });
    }
  }
}
