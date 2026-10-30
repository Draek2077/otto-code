import {
  CONNECTOR_CATALOG,
  ConnectorSetupSchema,
  ConnectorActionSchema,
  type ConnectorAction,
  type ConnectorSetupInput,
  type ConnectorsSnapshot,
  type readConnectors,
  type writeConnectors,
  type authorizeConnector,
} from "@getpaseo/plugin/otto/connectors";
type Rpc<
  T extends {
    input: { parse: (...args: never[]) => unknown };
    output: { parse: (...args: never[]) => unknown };
  },
> = (input: ReturnType<T["input"]["parse"]>) => Promise<ReturnType<T["output"]["parse"]>>;
export interface ConnectorDraft {
  id?: string;
  label: string;
  catalogId: string | null;
  replace: boolean;
  credential: string;
  roots: string;
  type: "http" | "sse" | "stdio";
  url: string;
  command: string;
  args: string;
  environment: string;
  headers: string;
  oauth: boolean;
  scope: string;
  clientId: string;
  clientSecret: string;
}
const empty = (): ConnectorDraft => ({
  label: "",
  catalogId: null,
  replace: true,
  credential: "",
  roots: "",
  type: "http",
  url: "",
  command: "",
  args: "[]",
  environment: "{}",
  headers: "{}",
  oauth: false,
  scope: "",
  clientId: "",
  clientSecret: "",
});
function setup(draft: ConnectorDraft): ConnectorSetupInput {
  if (draft.catalogId)
    return ConnectorSetupSchema.parse({
      kind: "catalog",
      catalogId: draft.catalogId,
      roots: draft.roots
        .split(/\r?\n/)
        .map((root) => root.trim())
        .filter(Boolean),
      ...(draft.credential ? { credential: draft.credential } : {}),
      ...(draft.clientId
        ? {
            client: {
              clientId: draft.clientId,
              ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
            },
          }
        : {}),
    });
  const server =
    draft.type === "stdio"
      ? {
          type: draft.type,
          command: draft.command,
          args: JSON.parse(draft.args),
          env: JSON.parse(draft.environment),
        }
      : { type: draft.type, url: draft.url, headers: JSON.parse(draft.headers) };
  return ConnectorSetupSchema.parse({
    kind: "custom",
    server,
    oauth: draft.oauth,
    scope: draft.scope,
    ...(draft.clientId
      ? {
          client: {
            clientId: draft.clientId,
            ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
          },
        }
      : {}),
  });
}
interface Ports {
  read: Rpc<typeof readConnectors>;
  write: Rpc<typeof writeConnectors>;
  authorize: Rpc<typeof authorizeConnector>;
  open(url: string): Promise<unknown>;
  confirmDiscard(): Promise<boolean>;
}
/** Local form/demand only. Credentials live in this ephemeral draft until its
 * own submission is accepted or the user explicitly discards/closes it. */
export function openConnectorForm(hostId: string, opened: ConnectorsSnapshot, ports: Ports) {
  let state = {
    snapshot: opened,
    selectedId: opened.detail?.id ?? "",
    draft: null as ConnectorDraft | null,
    catalogOpen: false,
    search: "",
    busy: false,
    blocked: false,
    error: "",
    notice: "",
    authorizationUrl: "",
    callback: "" as "" | "hosted" | "host-loopback",
    active: false,
  };
  let closed = false;
  let authority = 0;
  let poll: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  function publish(patch: Partial<typeof state>) {
    if (closed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  function stopPoll() {
    if (poll) clearTimeout(poll);
    poll = null;
  }
  function schedule() {
    stopPoll();
    if (
      closed ||
      !state.active ||
      state.busy ||
      state.draft ||
      state.blocked ||
      !state.snapshot.connectors.some((row) => row.authorization.state === "pending")
    )
      return;
    poll = setTimeout(() => {
      void read(false);
    }, 2000);
  }
  async function read(explicit: boolean, focusId = state.selectedId) {
    if (closed || !state.active || state.busy) return;
    const ticket = authority;
    if (explicit) publish({ busy: true, error: "" });
    try {
      const result = await ports.read({ hostId, ...(focusId ? { focusId } : {}) });
      if (closed) return;
      if (ticket !== authority) {
        publish({ busy: false });
        return;
      }
      if (!result.ok) {
        publish({ busy: false, blocked: explicit || state.blocked, error: result.error.message });
        return;
      }
      if (state.draft) {
        publish({ busy: false });
        if (result.value.revision !== state.snapshot.revision)
          publish({
            notice:
              "Connectors changed. Your draft is retained; reload saved settings before continuing.",
            blocked: true,
          });
      } else
        publish({
          snapshot: result.value,
          selectedId: focusId,
          busy: false,
          blocked: false,
          error: "",
        });
    } catch {
      if (!closed && ticket === authority)
        publish({
          busy: false,
          error: "The host could not read Connectors. Your draft remains here.",
        });
    } finally {
      schedule();
    }
  }
  async function mutate(action: ConnectorAction) {
    if (closed || state.busy || state.blocked || !state.active) return;
    const parsed = ConnectorActionSchema.safeParse(action);
    if (!parsed.success) {
      publish({ error: "Check the connection name and configuration fields." });
      return;
    }
    const ticket = authority;
    publish({ busy: true, error: "", notice: "" });
    stopPoll();
    try {
      const result = await ports.write({
        hostId,
        expectedRevision: state.snapshot.revision,
        action: parsed.data,
      });
      if (closed) return;
      if (ticket !== authority) {
        publish({
          busy: false,
          blocked: true,
          error: "The connection may have changed while hidden. Reload before continuing.",
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
      publish({
        snapshot: result.value,
        selectedId: result.value.detail?.id ?? "",
        draft: null,
        busy: false,
        error: "",
        notice: "Connection saved.",
      });
    } catch {
      if (!closed)
        publish({
          busy: false,
          blocked: true,
          error:
            "The save outcome is unknown. Reload before repeating a change. Your draft remains here.",
        });
    } finally {
      schedule();
    }
  }
  async function connect() {
    if (closed || !state.active || state.busy || state.blocked || !state.selectedId) return;
    const ticket = authority;
    publish({ busy: true, error: "" });
    stopPoll();
    try {
      const result = await ports.authorize({
        hostId,
        expectedRevision: state.snapshot.revision,
        id: state.selectedId,
      });
      if (closed) return;
      if (ticket !== authority) {
        publish({
          busy: false,
          blocked: true,
          error: "Sign-in may have started while hidden. Reload before reconnecting.",
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
      publish({
        busy: false,
        authorizationUrl: result.value.authorizationUrl ?? "",
        callback: result.value.callback ?? "host-loopback",
      });
      // A remote client's localhost is not the daemon. Show the copy/open
      // actions for host-loopback consent instead of launching it on a phone.
      if (result.value.authorizationUrl && result.value.callback === "hosted")
        await ports.open(result.value.authorizationUrl);
      await read(true);
    } catch {
      if (!closed && ticket === authority)
        publish({
          busy: false,
          error: "Open the sign-in link again, or reload the connection before reconnecting.",
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
    setActive(active: boolean) {
      if (state.active === active || closed) return;
      authority++;
      publish({ active, ...(state.busy ? { blocked: true } : {}) });
      if (active) schedule();
      else {
        stopPoll();
        publish({ authorizationUrl: "" });
      }
    },
    setSearch(search: string) {
      publish({ search });
    },
    showCatalog() {
      if (!state.busy) publish({ catalogOpen: true, search: "" });
    },
    hideCatalog() {
      publish({ catalogOpen: false });
    },
    add(catalogId: string | null) {
      if (state.busy || state.blocked) return;
      const entry = CONNECTOR_CATALOG.find((row) => row.id === catalogId);
      publish({
        catalogOpen: false,
        draft: { ...empty(), catalogId, label: entry?.label ?? "" },
        error: "",
      });
    },
    editConnection() {
      const current = state.snapshot.detail;
      if (!current || state.busy || state.blocked) return;
      publish({
        draft: {
          ...empty(),
          id: current.id,
          label: current.label,
          catalogId: current.catalogId,
          replace: false,
        },
        error: "",
      });
    },
    edit(patch: Partial<ConnectorDraft>) {
      if (!state.draft || state.busy) return;
      publish({ draft: { ...state.draft, ...patch }, error: "" });
    },
    async discard() {
      const ticket = authority;
      if (
        state.busy ||
        !(await ports.confirmDiscard()) ||
        closed ||
        ticket !== authority ||
        !state.active
      )
        return;
      publish({ draft: null, error: "" });
      await read(true);
    },
    async select(id: string) {
      if (state.busy || state.blocked) return;
      const ticket = authority;
      if (state.draft && !(await ports.confirmDiscard())) return;
      if (closed || ticket !== authority || !state.active) return;
      publish({ draft: null, selectedId: id, authorizationUrl: "" });
      await read(true, id);
    },
    async save() {
      if (!state.draft) return;
      try {
        const draft = state.draft;
        const value = draft.replace || !draft.id ? setup(draft) : undefined;
        await mutate(
          draft.id
            ? {
                kind: "configure",
                id: draft.id,
                label: draft.label,
                ...(value ? { setup: value } : {}),
              }
            : { kind: "add", label: draft.label, setup: value! },
        );
      } catch {
        publish({
          error:
            "Check the configuration. Arguments must be a JSON list; headers and environment must be JSON objects. No changes were submitted.",
        });
      }
    },
    mutate,
    connect,
    async reopenConsent() {
      if (state.authorizationUrl && state.active) await ports.open(state.authorizationUrl);
    },
    async reload() {
      if (state.busy) return;
      const ticket = authority;
      if (state.draft && !(await ports.confirmDiscard())) return;
      if (closed || ticket !== authority || !state.active) return;
      authority++;
      publish({ draft: null, blocked: false, notice: "" });
      await read(true);
    },
    refresh: () => read(true),
    close() {
      authority++;
      stopPoll();
      state = { ...state, draft: null, authorizationUrl: "", active: false };
      closed = true;
      listeners.clear();
    },
  };
}
export type ConnectorForm = ReturnType<typeof openConnectorForm>;
