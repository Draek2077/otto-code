import {
  saveSpeech,
  type SpeechSnapshot,
  type SpeechSettings,
  type SpeechCredentialIntent,
} from "@getpaseo/plugin/otto/speech";

interface SpeechFormPort {
  read(): Promise<SpeechSnapshot>;
  save(input: typeof saveSpeech.input._output): Promise<SpeechSnapshot>;
  retry(revision: string): Promise<SpeechSnapshot>;
  confirmReload(): Promise<boolean>;
}
const keepCredentials = () => ({
  stt: { kind: "keep" } as SpeechCredentialIntent,
  tts: { kind: "keep" } as SpeechCredentialIntent,
});

/** One form per host opening; one debounced writer and an explicit credential action.
 * A hidden in-flight write has an unknown outcome and requires explicit reload.
 */
export function openSpeechForm(initial: SpeechSnapshot, port: SpeechFormPort) {
  let state = {
    origin: initial,
    draft: structuredClone(initial.settings),
    credentials: keepCredentials(),
    busy: false,
    reading: false,
    blocked: false,
    error: "",
    notice: "",
    generation: 0,
    dirty: false, // Renderers need a snapshot field; React Compiler cannot observe stable model helpers.
  };
  let active = true;
  let closed = false;
  let authority = 0;
  let writing = false;
  let refreshPending = false;
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<typeof state>) => {
    if (closed) return;
    state = { ...state, ...patch };
    state = {
      ...state,
      dirty:
        JSON.stringify(state.draft) !== JSON.stringify(state.origin.settings) ||
        state.credentials.stt.kind !== "keep" ||
        state.credentials.tts.kind !== "keep",
    };
    for (const listener of listeners) listener();
  };
  const dirty = () => state.dirty;
  type Operation = "autosave" | "save" | "reload" | "refresh" | "retry";
  const isLive = (ticket: number) => ticket === authority && active && !closed;
  const saveInput = (includeCredentials: boolean) => ({
    hostId: initial.hostId,
    expectedRevision: state.origin.revision,
    settings: state.draft,
    credentials: includeCredentials ? state.credentials : keepCredentials(),
  });
  const preferencesDirty = () =>
    JSON.stringify(state.draft) !== JSON.stringify(state.origin.settings);
  function schedule() {
    clearTimeout(timer);
    if (
      !closed &&
      active &&
      !state.busy &&
      !state.blocked &&
      preferencesDirty() &&
      saveSpeech.input.safeParse(saveInput(false)).success
    )
      timer = setTimeout(() => {
        void perform("autosave");
      }, 300);
  }
  function accept(
    kind: Operation,
    result: SpeechSnapshot,
    submittedVersion: number,
    submittedCredentials: typeof state.credentials,
  ) {
    if (kind === "refresh" || kind === "retry") {
      if (result.revision !== state.origin.revision)
        publish({
          blocked: true,
          error: "Host settings changed. Your edits are retained; reload before saving.",
        });
      else publish({ origin: result });
    } else if (kind === "save" || kind === "autosave") {
      publish({
        origin: result,
        draft: version === submittedVersion ? structuredClone(result.settings) : state.draft,
        credentials:
          kind === "save" && state.credentials === submittedCredentials
            ? keepCredentials()
            : state.credentials,
        blocked: false,
      });
    } else
      publish({
        origin: result,
        draft: structuredClone(result.settings),
        credentials: keepCredentials(),
        blocked: false,
        generation: state.generation + 1,
      });
  }
  function finish() {
    writing = false;
    if (!closed) publish({ busy: false, reading: false });
    schedule();
    if (refreshPending && active && !closed && !state.blocked) {
      refreshPending = false;
      void perform("refresh");
    }
  }
  function admitted(kind: Operation) {
    return !closed && active && !state.busy && (!state.blocked || kind === "reload");
  }
  async function confirmReload(kind: Operation) {
    return kind !== "reload" || !dirty() || (await port.confirmReload());
  }
  async function perform(kind: Operation) {
    if (!admitted(kind)) return;
    const saving = kind === "save" || kind === "autosave";
    if (kind === "autosave" && !preferencesDirty()) return;
    const input = saving ? saveSpeech.input.safeParse(saveInput(kind === "save")) : null;
    if (input && !input.success) {
      publish({ error: "Check the model, voice, language, speed and API key fields." });
      return;
    }
    clearTimeout(timer);
    const ticket = authority;
    const submittedVersion = version;
    const submittedCredentials = state.credentials;
    publish({ busy: true, reading: !saving, error: "", notice: "" });
    try {
      if (kind === "reload" && !(await confirmReload(kind))) return;
      if (!isLive(ticket)) return;
      writing = saving || kind === "retry";
      let result: SpeechSnapshot;
      if (saving && input?.success) result = await port.save(input.data);
      else if (kind === "retry") result = await port.retry(state.origin.revision);
      else result = await port.read();
      if (isLive(ticket)) accept(kind, result, submittedVersion, submittedCredentials);
    } catch {
      if (isLive(ticket))
        publish({
          blocked: writing || state.blocked,
          error:
            "The host could not complete this request. Your edits are retained. Reload saved settings before trying again.",
        });
    } finally {
      finish();
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
    dirty,
    edit(update: (draft: SpeechSettings) => SpeechSettings) {
      if (!closed && active && !state.reading) {
        version++;
        publish({
          draft: update(structuredClone(state.draft)),
          error: state.blocked ? state.error : "",
          notice: "",
        });
        schedule();
      }
    },
    credential(endpoint: "stt" | "tts", intent: SpeechCredentialIntent) {
      if (!closed && active && !state.busy)
        publish({ credentials: { ...state.credentials, [endpoint]: intent } });
    },
    save: () => perform("save"),
    reload: () => perform("reload"),
    refresh: () => {
      if (state.busy) {
        refreshPending = true;
        return Promise.resolve();
      }
      return perform("refresh");
    },
    retry: () => perform("retry"),
    setActive(value: boolean) {
      if (active === value) return;
      if (!value) {
        clearTimeout(timer);
        if (!state.busy && !state.blocked && preferencesDirty()) void perform("autosave");
      }
      authority++;
      active = value;
      if (value) schedule();
      if (writing)
        publish({
          blocked: true,
          error:
            "A request was in progress when this page closed. Reload to check the saved host settings.",
        });
    },
    close() {
      clearTimeout(timer);
      if (active && !state.busy && !state.blocked && preferencesDirty()) void perform("autosave");
      authority++;
      closed = true;
      active = false;
      state = { ...state, credentials: keepCredentials() };
      listeners.clear();
    },
  };
}
export type SpeechForm = ReturnType<typeof openSpeechForm>;
