import type {
  BitbucketRepository,
  BitbucketWorkspace,
} from "@getpaseo/plugin/otto/bitbucket-connections";
type Result<T> = { ok: true; value: T } | { ok: false; error: { message: string } };
interface Ports {
  workspaces(): Promise<Result<{ workspaces: BitbucketWorkspace[]; truncated: boolean }>>;
  list(input: {
    workspace: string;
    query: string;
  }): Promise<Result<{ repositories: BitbucketRepository[]; truncated: boolean }>>;
  create(input: {
    workspace: string;
    name: string;
    description: string;
    private: boolean;
    expectedRevision: string;
  }): Promise<Result<BitbucketRepository>>;
  clone(repository: BitbucketRepository, protocol: "https" | "ssh"): void;
}
export function openBitbucketRepositoryForm(revision: string, ports: Ports) {
  let state = {
    revision,
    observedRevision: revision,
    workspace: "",
    workspaces: [] as BitbucketWorkspace[],
    workspacesTruncated: false,
    query: "",
    name: "",
    description: "",
    private: true,
    protocol: "ssh" as "ssh" | "https",
    repositories: [] as BitbucketRepository[],
    searched: false,
    truncated: false,
    busy: false,
    blocked: false,
    error: "",
    message: "",
    active: true,
    creating: false,
  };
  let writing = false;
  let closed = false,
    authority = 0;
  const listeners = new Set<() => void>();
  function publish(patch: Partial<typeof state>) {
    if (closed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    edit(
      patch: Partial<
        Pick<
          typeof state,
          "workspace" | "query" | "name" | "description" | "private" | "protocol" | "creating"
        >
      >,
    ) {
      if (state.busy) return;
      const changed =
        (patch.workspace !== undefined && patch.workspace !== state.workspace) ||
        (patch.query !== undefined && patch.query !== state.query);
      publish({
        ...patch,
        ...(changed ? { repositories: [], searched: false, truncated: false } : {}),
        error: "",
        message: "",
      });
    },
    updateRevision(observedRevision: string) {
      if (observedRevision === state.observedRevision) return;
      authority++;
      publish({
        observedRevision,
        repositories: [],
        workspaces: [],
        workspacesTruncated: false,
        searched: false,
        truncated: false,
      });
    },
    async discover() {
      if (state.busy || !state.active || closed || state.revision !== state.observedRevision)
        return;
      const ticket = authority;
      publish({ busy: true, error: "" });
      try {
        const result = await ports.workspaces();
        if (ticket !== authority || closed) return;
        if (!result.ok) publish({ error: result.error.message });
        else
          publish({
            workspaces: result.value.workspaces,
            workspacesTruncated: result.value.truncated,
            message: result.value.workspaces.length
              ? ""
              : "No accessible workspaces were returned. Enter a workspace ID directly if its repository scope is available.",
          });
      } catch {
        if (ticket === authority)
          publish({ error: "The host could not load Bitbucket workspaces." });
      } finally {
        publish({ busy: false });
      }
    },
    async search() {
      if (state.busy || !state.active || closed || state.revision !== state.observedRevision)
        return;
      if (!state.workspace.trim()) {
        publish({ error: "Enter a Bitbucket workspace ID." });
        return;
      }
      const ticket = authority;
      publish({ busy: true, error: "", message: "" });
      try {
        const result = await ports.list({ workspace: state.workspace.trim(), query: state.query });
        if (ticket !== authority || closed) {
          publish({ busy: false });
          return;
        }
        if (!result.ok) {
          publish({
            busy: false,
            error: result.error?.message ?? "Bitbucket repository search failed.",
          });
          return;
        }
        publish({
          busy: false,
          searched: true,
          repositories: result.value.repositories,
          truncated: result.value.truncated,
        });
      } catch {
        publish({
          busy: false,
          ...(ticket === authority
            ? { error: "The host could not search Bitbucket repositories." }
            : {}),
        });
      }
    },
    async create(confirm: () => Promise<boolean>) {
      if (
        state.busy ||
        state.blocked ||
        !state.active ||
        closed ||
        state.revision !== state.observedRevision
      )
        return;
      if (!state.workspace.trim() || !state.name.trim()) {
        publish({ error: "Enter the workspace ID and new repository name." });
        return;
      }
      const ticket = authority;
      const input = {
        expectedRevision: state.revision,
        workspace: state.workspace.trim(),
        name: state.name,
        description: state.description,
        private: state.private,
      };
      // Confirmation also owns the mutation lane; duplicate clicks cannot open
      // two dialogs that later create two remote repositories.
      publish({ busy: true, error: "", message: "" });
      try {
        if (!(await confirm()) || ticket !== authority || closed) {
          publish({ busy: false });
          return;
        }
        writing = true;
        const result = await ports.create(input);
        if (ticket !== authority || closed) {
          publish({
            busy: false,
            blocked: true,
            error:
              "The repository creation outcome changed while this page was hidden. Check Bitbucket before continuing.",
          });
          return;
        }
        if (!result.ok) {
          publish({
            busy: false,
            blocked: true,
            error:
              result.error?.message ??
              "The repository creation outcome is unknown. Check Bitbucket before continuing.",
          });
          return;
        }
        publish({
          busy: false,
          searched: true,
          creating: false,
          repositories: [result.value],
          message: `Created ${result.value.fullName}. Choose Clone to add it to Otto.`,
        });
      } catch {
        publish({
          busy: false,
          blocked: true,
          error: "The repository creation outcome is unknown. Check Bitbucket before continuing.",
        });
      } finally {
        writing = false;
      }
    },
    async acknowledge(nextRevision: string, confirm: () => Promise<boolean>) {
      if (state.busy || closed || !state.active) return;
      const ticket = authority;
      publish({ busy: true });
      try {
        if (
          !(await confirm()) ||
          ticket !== authority ||
          closed ||
          nextRevision !== state.observedRevision
        )
          return;
        publish({
          revision: nextRevision,
          blocked: false,
          error: "",
          repositories: [],
          searched: false,
          truncated: false,
          message:
            "Selected account acknowledged. Refresh the repository list before creating another repository.",
        });
      } finally {
        publish({ busy: false });
      }
    },
    clone(repository: BitbucketRepository) {
      if (
        !closed &&
        state.active &&
        !state.busy &&
        !state.blocked &&
        state.revision === state.observedRevision &&
        state.repositories.includes(repository)
      )
        ports.clone(repository, state.protocol);
    },
    setActive(active: boolean) {
      if (state.active === active) return;
      authority++;
      publish({ active, ...(writing ? { blocked: true } : {}) });
    },
    close() {
      authority++;
      closed = true;
      listeners.clear();
    },
  };
}
export type BitbucketRepositoryForm = ReturnType<typeof openBitbucketRepositoryForm>;
