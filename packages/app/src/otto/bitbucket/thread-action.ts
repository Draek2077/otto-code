interface Ports {
  revision(): Promise<string>;
  confirm(resolved: boolean): Promise<boolean>;
  write(expectedRevision: string, resolved: boolean): Promise<void>;
  refresh(): Promise<void>;
}
/** Only validated host messages may cross into the rendered error surface. */
export class BitbucketThreadActionError extends Error {}
/** Local intent only. The owning checkout and admitted account stay daemon-owned. */
export function openBitbucketThreadAction(ports: Ports) {
  let state = { active: true, busy: false, blocked: false, error: "" };
  let authority = 0,
    closed = false,
    writing = false;
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
    async perform(resolved: boolean) {
      if (!state.active || state.busy || state.blocked || closed) return;
      const ticket = authority;
      publish({ busy: true, error: "" });
      try {
        const revision = await ports.revision();
        if (ticket !== authority || closed || !(await ports.confirm(resolved))) return;
        if (ticket !== authority || closed) return;
        writing = true;
        await ports.write(revision, resolved);
        if (ticket !== authority || closed) return;
        await ports.refresh();
      } catch (error) {
        if (ticket === authority)
          publish({
            blocked: writing,
            error:
              error instanceof BitbucketThreadActionError
                ? error.message
                : "The host could not update this discussion. Refresh before continuing.",
          });
      } finally {
        writing = false;
        publish({ busy: false });
      }
    },
    async reload() {
      if (state.busy || !state.active || closed) return;
      const ticket = authority;
      publish({ busy: true });
      try {
        await ports.refresh();
        if (ticket === authority) publish({ blocked: false, error: "" });
      } catch {
        if (ticket === authority) publish({ error: "The host could not refresh this discussion." });
      } finally {
        publish({ busy: false });
      }
    },
    setActive(active: boolean) {
      if (active === state.active) return;
      authority++;
      publish({
        active,
        ...(writing
          ? {
              blocked: true,
              error: "The discussion may have changed while hidden. Refresh before continuing.",
            }
          : {}),
      });
    },
    close() {
      closed = true;
      authority++;
      listeners.clear();
    },
  };
}
