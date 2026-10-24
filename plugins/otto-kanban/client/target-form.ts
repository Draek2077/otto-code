import type { KanbanError, ProjectConfiguration, ProjectTarget, Result } from "../shared/model.js";

export interface TargetFormState {
  enabled: boolean;
  adapter: "github" | "jira";
  boardId: string;
  boardOwner: string;
  busy: boolean;
  dirty: boolean;
  error: string;
  errorCode: KanbanError["code"] | null;
  reloadRequired: boolean;
  saved: boolean;
  generation: number;
}

interface TargetSaveInput {
  binding: ProjectConfiguration["binding"];
  expectedRevision: string;
  target: ProjectTarget | null;
}

// One model belongs to one opened project/revision. Live host/project updates
// never reconstruct an open form or replace the reader's in-progress text.
export function openTargetForm(input: {
  snapshot: ProjectConfiguration;
  save(value: TargetSaveInput): Promise<Result<ProjectConfiguration>>;
}) {
  const listeners = new Set<() => void>();
  let revision = input.snapshot.settingsRevision;
  let state: TargetFormState = {
    enabled: input.snapshot.target !== null,
    adapter: input.snapshot.target?.adapter ?? "github",
    boardId: input.snapshot.target?.boardId ?? "",
    boardOwner: input.snapshot.target?.boardOwner ?? "",
    busy: false,
    dirty: false,
    error: "",
    errorCode: null,
    reloadRequired: false,
    saved: false,
    generation: 0,
  };
  function patch(next: Partial<TargetFormState>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }
  function edit(next: Partial<TargetFormState>) {
    if (!state.busy)
      patch({
        ...next,
        dirty: true,
        saved: false,
        ...(state.reloadRequired ? {} : { error: "", errorCode: null }),
      });
  }
  return {
    getSnapshot: () => state,
    getRevision: () => revision,
    binding: input.snapshot.binding,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setEnabled: (enabled: boolean) => edit({ enabled }),
    setAdapter: (adapter: "github" | "jira") => edit({ adapter, boardId: "", boardOwner: "" }),
    setBoardId(boardId: string) {
      edit({ boardId, ...(boardId.startsWith("https://") ? { boardOwner: "" } : {}) });
    },
    setBoardOwner: (boardOwner: string) => edit({ boardOwner }),
    async reload(
      read: (binding: ProjectConfiguration["binding"]) => Promise<Result<ProjectConfiguration>>,
    ): Promise<boolean> {
      if (state.busy) return false;
      patch({ busy: true });
      try {
        const result = await read(input.snapshot.binding);
        if (!result.ok) {
          patch({ busy: false, error: result.error.message });
          return false;
        }
        const fresh = result.value;
        if (
          fresh.binding.hostId !== input.snapshot.binding.hostId ||
          fresh.binding.projectId !== input.snapshot.binding.projectId
        )
          throw new Error("Wrong project response");
        revision = fresh.settingsRevision;
        patch({
          enabled: fresh.target !== null,
          adapter: fresh.target?.adapter ?? "github",
          boardId: fresh.target?.boardId ?? "",
          boardOwner: fresh.target?.boardOwner ?? "",
          busy: false,
          dirty: false,
          error: "",
          errorCode: null,
          reloadRequired: false,
          saved: false,
          generation: state.generation + 1,
        });
        return true;
      } catch {
        patch({
          busy: false,
          error: "Project Settings could not be reloaded. Your changes are still here.",
        });
        return false;
      }
    },
    async save(): Promise<ProjectConfiguration | null> {
      if (state.busy || !state.dirty || state.reloadRequired) return null;
      const target = state.enabled
        ? {
            adapter: state.adapter,
            boardId: state.boardId.trim() || null,
            ...(state.adapter === "github" && state.boardOwner.trim()
              ? { boardOwner: state.boardOwner.trim() }
              : {}),
          }
        : null;
      patch({ busy: true, error: "", errorCode: null });
      try {
        const result = await input.save({
          binding: input.snapshot.binding,
          expectedRevision: revision,
          target,
        });
        if (!result.ok) {
          patch({
            busy: false,
            error: result.error.message,
            errorCode: result.error.code,
            reloadRequired: !["invalid_target", "invalid_settings"].includes(result.error.code),
          });
          return null;
        }
        const saved = result.value;
        if (
          saved.binding.hostId !== input.snapshot.binding.hostId ||
          saved.binding.projectId !== input.snapshot.binding.projectId
        ) {
          patch({
            busy: false,
            error: "The host returned settings for a different project.",
            reloadRequired: true,
          });
          return null;
        }
        revision = saved.settingsRevision;
        patch({ busy: false, dirty: false, saved: true });
        return saved;
      } catch {
        patch({
          busy: false,
          error: "Project Settings could not be saved. Your changes are still here.",
          reloadRequired: true,
        });
        return null;
      }
    },
  };
}

export type TargetFormModel = ReturnType<typeof openTargetForm>;
