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
  let state: TargetFormState = {
    enabled: input.snapshot.target !== null,
    adapter: input.snapshot.target?.adapter ?? "github",
    boardId: input.snapshot.target?.boardId ?? "",
    boardOwner: input.snapshot.target?.boardOwner ?? "",
    busy: false,
    dirty: false,
    error: "",
    errorCode: null,
  };
  function patch(next: Partial<TargetFormState>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }
  function edit(next: Partial<TargetFormState>) {
    if (!state.busy) patch({ ...next, dirty: true, error: "", errorCode: null });
  }
  return {
    getSnapshot: () => state,
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
    async save(): Promise<ProjectConfiguration | null> {
      if (state.busy || !state.dirty) return null;
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
          expectedRevision: input.snapshot.settingsRevision,
          target,
        });
        if (!result.ok) {
          patch({ busy: false, error: result.error.message, errorCode: result.error.code });
          return null;
        }
        const saved = result.value;
        if (
          saved.binding.hostId !== input.snapshot.binding.hostId ||
          saved.binding.projectId !== input.snapshot.binding.projectId
        ) {
          patch({ busy: false, error: "The host returned settings for a different project." });
          return null;
        }
        patch({ busy: false, dirty: false });
        return saved;
      } catch {
        patch({
          busy: false,
          error: "Project Settings could not be saved. Your changes are still here.",
        });
        return null;
      }
    },
  };
}
