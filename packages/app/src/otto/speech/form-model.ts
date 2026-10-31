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

/** One form per host opening; no canonical config copy, transport, or autosave.
 * A hidden in-flight write has an unknown outcome and requires explicit reload.
 */
export function openSpeechForm(initial: SpeechSnapshot, port: SpeechFormPort) {
  let state = {
    origin: initial,
    draft: structuredClone(initial.settings),
    credentials: keepCredentials(),
    busy: false,
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
  type Operation = "save" | "reload" | "refresh" | "retry";
  const isLive = (ticket: number) => ticket === authority && active && !closed;
  const saveInput = () => ({
    hostId: initial.hostId,
    expectedRevision: state.origin.revision,
    settings: state.draft,
    credentials: state.credentials,
  });
  function accept(kind: Operation, result: SpeechSnapshot) {
    if (kind === "refresh" || kind === "retry") {
      if (result.revision !== state.origin.revision)
        publish({
          blocked: true,
          error: "Host settings changed. Your edits are retained; reload before saving.",
        });
      else publish({ origin: result });
    } else
      publish({
        origin: result,
        draft: structuredClone(result.settings),
        credentials: keepCredentials(),
        blocked: false,
        generation: state.generation + 1,
        notice: kind === "save" ? "Speech settings saved." : "Saved speech settings loaded.",
      });
  }
  function execute(kind: Operation) {
    if (kind === "save") return port.save(saveSpeech.input.parse(saveInput()));
    if (kind === "retry") return port.retry(state.origin.revision);
    return port.read();
  }
  async function perform(kind: Operation) {
    if (closed || !active || state.busy || (state.blocked && kind !== "reload")) return;
    if (kind === "save" && !saveSpeech.input.safeParse(saveInput()).success) {
      publish({ error: "Check the model, voice, language, speed and API key fields." });
      return;
    }
    const ticket = authority;
    publish({ busy: true, error: "", notice: "" });
    try {
      if (kind === "reload" && dirty() && !(await port.confirmReload())) return;
      if (!isLive(ticket)) return;
      writing = kind === "save" || kind === "retry";
      const result = await execute(kind);
      if (isLive(ticket)) accept(kind, result);
    } catch {
      if (isLive(ticket))
        publish({
          blocked: writing || state.blocked,
          error:
            "The host could not complete this request. Your edits are retained. Reload saved settings before trying another save.",
        });
    } finally {
      writing = false;
      if (!closed) publish({ busy: false });
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
      if (!closed && active && !state.busy)
        publish({ draft: update(structuredClone(state.draft)), error: "", notice: "" });
    },
    credential(endpoint: "stt" | "tts", intent: SpeechCredentialIntent) {
      if (!closed && active && !state.busy)
        publish({ credentials: { ...state.credentials, [endpoint]: intent } });
    },
    save: () => perform("save"),
    reload: () => perform("reload"),
    refresh: () => perform("refresh"),
    retry: () => perform("retry"),
    setActive(value: boolean) {
      if (active === value) return;
      authority++;
      active = value;
      if (writing)
        publish({
          blocked: true,
          error:
            "A request was in progress when this page closed. Reload to check the saved host settings.",
        });
    },
    close() {
      authority++;
      closed = true;
      active = false;
      state = { ...state, credentials: keepCredentials() };
      listeners.clear();
    },
  };
}
export type SpeechForm = ReturnType<typeof openSpeechForm>;
