import {
  writeBitbucketConnections,
  type BitbucketConnections,
  type BitbucketConnectionAction,
} from "@getpaseo/plugin/otto/bitbucket-connections";
type Write = (
  input: ReturnType<typeof writeBitbucketConnections.input.parse>,
) => Promise<ReturnType<typeof writeBitbucketConnections.output.parse>>;
interface Draft {
  id?: string;
  label: string;
  email: string;
  replacement: string;
  replace: boolean;
  select: boolean;
}
const emptyDraft = (): Draft => ({
  label: "",
  email: "",
  replacement: "",
  replace: true,
  select: true,
});
export function openBitbucketConnectionForm(
  hostId: string,
  opened: BitbucketConnections,
  write: Write,
  read: () => Promise<BitbucketConnections>,
) {
  let state = {
    origin: opened,
    selection: opened.projectId ? (opened.projectOverrideId ?? "") : (opened.hostDefaultId ?? ""),
    draft: emptyDraft(),
    editing: opened.connections.length === 0,
    removeId: "",
    busy: false,
    blocked: false,
    error: "",
    message: "",
    generation: 0,
    active: true,
  };
  let closed = false;
  let authority = 0;
  const listeners = new Set<() => void>();
  function publish(patch: Partial<typeof state>) {
    if (closed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  async function mutate(action: BitbucketConnectionAction) {
    if (closed || state.busy || state.blocked || !state.active) return;
    const parsed = writeBitbucketConnections.input.safeParse({
      hostId,
      ...(state.origin.projectId ? { projectId: state.origin.projectId } : {}),
      expectedRevision: state.origin.revision,
      action,
    });
    if (!parsed.success) {
      publish({ error: "Enter a connection name, valid Atlassian email, and API token." });
      return;
    }
    const ticket = authority;
    publish({ busy: true, error: "", message: "" });
    try {
      const result = await write(parsed.data);
      if (closed) return;
      if (ticket !== authority) {
        publish({
          busy: false,
          blocked: true,
          error:
            "The connection may have changed while this page was hidden. Reload before continuing.",
        });
        return;
      }
      if (!result.ok) {
        publish({
          busy: false,
          blocked: result.error.kind !== "validation",
          error: result.error.message,
        });
        return;
      }
      const value = result.value;
      publish({
        origin: value,
        busy: false,
        editing: false,
        draft: emptyDraft(),
        removeId: "",
        selection: value.projectId ? (value.projectOverrideId ?? "") : (value.hostDefaultId ?? ""),
        generation: state.generation + 1,
        message: "Git connection settings saved.",
      });
    } catch {
      publish({
        busy: false,
        blocked: true,
        error: "The connection save outcome is unknown. Reload before continuing.",
      });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    edit(patch: Partial<Draft>) {
      if (!state.busy && state.active)
        publish({ draft: { ...state.draft, ...patch }, error: "", message: "" });
    },
    choose(value: string) {
      if (!state.busy && state.active) publish({ selection: value, message: "" });
    },
    begin(id?: string) {
      if (state.busy || state.blocked) return;
      const connection = state.origin.connections.find((entry) => entry.id === id);
      publish({
        editing: true,
        draft: connection
          ? {
              id: connection.id,
              label: connection.label,
              email: connection.email ?? "",
              replacement: "",
              replace: connection.email === null,
              select: false,
            }
          : emptyDraft(),
        removeId: "",
        generation: state.generation + 1,
        error: "",
        message: "",
      });
    },
    cancel() {
      if (!state.busy) publish({ editing: false, draft: emptyDraft(), removeId: "" });
    },
    confirmRemove(id: string) {
      if (!state.busy && !state.blocked) publish({ removeId: id });
    },
    saveSelection: () => mutate({ kind: "select", connectionId: state.selection || null }),
    remove: () => mutate({ kind: "remove", id: state.removeId }),
    save: () =>
      mutate({
        kind: "save",
        id: state.draft.id,
        label: state.draft.label,
        email: state.draft.email,
        credential: state.draft.replace
          ? { kind: "replace", value: state.draft.replacement }
          : { kind: "keep" },
        select: state.draft.select,
      }),
    async reload(confirm: () => Promise<boolean>) {
      if (state.busy || closed) return;
      const ticket = authority;
      if (!(await confirm()) || ticket !== authority || closed) return;
      publish({ busy: true });
      try {
        const value = await read();
        if (ticket !== authority || closed) {
          publish({ busy: false });
          return;
        }
        publish({
          origin: value,
          selection: value.projectId
            ? (value.projectOverrideId ?? "")
            : (value.hostDefaultId ?? ""),
          busy: false,
          blocked: false,
          editing: value.connections.length === 0,
          draft: emptyDraft(),
          removeId: "",
          error: "",
          message: "",
          generation: state.generation + 1,
        });
      } catch {
        publish({ busy: false, error: "The host could not reload Git connections." });
      }
    },
    setActive(active: boolean) {
      if (active === state.active) return;
      authority++;
      publish({
        active,
        draft: { ...state.draft, replacement: "" },
        generation: state.generation + 1,
        ...(state.busy ? { blocked: true } : {}),
      });
    },
    close() {
      authority++;
      state.draft.replacement = "";
      closed = true;
      listeners.clear();
    },
  };
}
export type BitbucketConnectionForm = ReturnType<typeof openBitbucketConnectionForm>;
