import {
  SaveAtlassianAccountSchema,
  type AtlassianAccountSnapshot,
  saveAtlassianAccount,
} from "@getpaseo/plugin/otto/atlassian-settings";

type SaveResult = Awaited<ReturnType<Save>>;
type Save = (
  input: ReturnType<typeof saveAtlassianAccount.input.parse>,
) => Promise<ReturnType<typeof saveAtlassianAccount.output.parse>>;
interface Draft {
  email: string;
  siteUrl: string;
  scoped: boolean;
  cloudId: string;
  intent: "keep" | "replace" | "remove";
  replacement: string;
}
function draft(snapshot: AtlassianAccountSnapshot): Draft {
  return {
    email: snapshot.config?.email ?? "",
    siteUrl: snapshot.config?.siteUrl ?? "",
    scoped: snapshot.config?.route.kind === "scoped",
    cloudId: snapshot.config?.route.kind === "scoped" ? snapshot.config.route.cloudId : "",
    intent: "keep",
    replacement: "",
  };
}
export function openAtlassianForm(hostId: string, opened: AtlassianAccountSnapshot, write: Save) {
  let state = {
    origin: opened,
    draft: draft(opened),
    generation: 0,
    dirty: false,
    busy: false,
    blocked: false,
    saved: false,
    error: "",
  };
  let closed = false;
  let edits = 0;
  let credentialEdits = 0;
  const listeners = new Set<() => void>();
  function publish(patch: Partial<typeof state>) {
    if (closed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  function input() {
    const d = state.draft;
    return SaveAtlassianAccountSchema.safeParse({
      expectedRevision: state.origin.revision,
      config: {
        email: d.email,
        siteUrl: d.siteUrl,
        route: d.scoped ? { kind: "scoped", cloudId: d.cloudId } : { kind: "site" },
      },
      credential:
        d.intent === "replace" ? { kind: "replace", value: d.replacement } : { kind: d.intent },
    });
  }
  function apply(result: SaveResult, sequence: number, credentialSequence: number) {
    if (!result.ok) {
      publish({
        busy: false,
        error: result.error.message,
        blocked: result.error.kind !== "validation",
      });
      return;
    }
    // Controls remain editable during an accepted save; preserve newer edits,
    // including a newer write-only replacement, under the acknowledged revision.
    const retained =
      credentialSequence === credentialEdits
        ? { ...state.draft, intent: "keep" as const, replacement: "" }
        : state.draft;
    publish({
      origin: result.value,
      draft: edits === sequence ? draft(result.value) : retained,
      generation: state.generation + 1,
      dirty: edits !== sequence,
      busy: false,
      saved: true,
    });
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
      if (closed || state.blocked) return;
      edits++;
      if (patch.intent !== undefined || patch.replacement !== undefined) credentialEdits++;
      publish({ draft: { ...state.draft, ...patch }, dirty: true, saved: false, error: "" });
    },
    async save() {
      if (closed || state.busy || state.blocked || !state.dirty) return;
      const parsed = input();
      if (
        !parsed.success ||
        (state.draft.intent === "replace" && !state.draft.replacement.trim())
      ) {
        publish({
          error:
            "Enter an account email and complete the selected credential and scoped-token fields.",
        });
        return;
      }
      const sequence = edits;
      const credentialSequence = credentialEdits;
      publish({ busy: true, error: "" });
      try {
        apply(await write({ hostId, ...parsed.data }), sequence, credentialSequence);
      } catch {
        publish({
          busy: false,
          blocked: true,
          error: "The save response was lost. Reload before saving again.",
        });
      }
    },
    async reload(read: () => Promise<SaveResult>) {
      if (closed || state.busy) return;
      const sequence = edits;
      publish({ busy: true, error: "" });
      try {
        const result = await read();
        if (!result.ok) {
          publish({ busy: false, error: result.error.message });
          return;
        }
        if (sequence !== edits) {
          publish({
            busy: false,
            error: "You edited the form during reload. Your draft was kept.",
          });
          return;
        }
        publish({
          origin: result.value,
          draft: draft(result.value),
          dirty: false,
          blocked: false,
          busy: false,
          saved: false,
          generation: state.generation + 1,
        });
      } catch {
        publish({
          busy: false,
          error: "The saved account could not be loaded. Your draft was kept.",
        });
      }
    },
    close() {
      closed = true;
      state = { ...state, draft: { ...state.draft, replacement: "" } };
      listeners.clear();
    },
  };
}
export type AtlassianForm = ReturnType<typeof openAtlassianForm>;
