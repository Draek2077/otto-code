import { providerSettings, apiBaseUrl, type ConnectionSettings } from "../shared/settings.js";

export interface ConnectionProfile {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  enabled: boolean;
}
export function connectionProfiles(values: ConnectionSettings): ConnectionProfile[] {
  return [
    ...(values.baseUrl
      ? [
          {
            id: "primary",
            label: new URL(values.baseUrl).host,
            baseUrl: values.baseUrl,
            model: values.model,
            apiKeyEnv: values.apiKeyEnv,
            enabled: true,
          },
        ]
      : []),
    ...(values.endpoints ?? []).map((profile) =>
      Object.assign({}, profile, { enabled: profile.enabled !== false }),
    ),
  ];
}
export function withoutConnection(values: ConnectionSettings, id: string): ConnectionSettings {
  return id === "primary"
    ? { ...values, baseUrl: "", model: "" }
    : { ...values, endpoints: values.endpoints?.filter((profile) => profile.id !== id) };
}

/** One instance per opened add/edit form. Remote updates never replace its draft. */
export function openConnectionForm(snapshot: {
  revision: string;
  values: ConnectionSettings;
  profile?: ConnectionProfile;
  newId: string;
}) {
  const profile = snapshot.profile;
  let state = {
    baseUrl: profile?.baseUrl ?? "",
    key: "",
    label: profile?.label ?? "",
    model: profile?.model ?? "",
    apiKeyEnv: profile?.apiKeyEnv ?? "OPENAI_API_KEY",
    enabled: profile?.enabled ?? true,
    maxToolRounds: String(snapshot.values.maxToolRounds),
    timeoutSeconds: String(snapshot.values.timeoutMs / 1000),
    removeKey: false,
    busy: false,
    error: "" as string,
    settingsRevision: snapshot.revision,
    keyRevision: undefined as string | undefined,
  };
  let baseValues = snapshot.values;
  const listeners = new Set<() => void>();
  const edited = new Set<string>();
  const publish = (update: Partial<typeof state>) => {
    state = { ...state, ...update };
    for (const listener of listeners) listener();
  };
  const id = profile?.id ?? snapshot.newId;
  return {
    id,
    existing: Boolean(profile),
    originalUrl: profile?.baseUrl ?? "",
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    edit: <Key extends keyof typeof state>(key: Key, value: (typeof state)[Key]) => {
      edited.add(key);
      publish({ [key]: value });
    },
    committed: (revision: string, values: ConnectionSettings) => {
      baseValues = values;
      publish({ settingsRevision: revision });
    },
    rebase(revision: string, values: ConnectionSettings) {
      const current = connectionProfiles(values).find((entry) => entry.id === id);
      const incoming = {
        baseUrl: current?.baseUrl ?? state.baseUrl,
        label: current?.label ?? state.label,
        model: current?.model ?? state.model,
        apiKeyEnv: current?.apiKeyEnv ?? state.apiKeyEnv,
        enabled: current?.enabled ?? state.enabled,
        maxToolRounds: String(values.maxToolRounds),
        timeoutSeconds: String(values.timeoutMs / 1000),
      };
      const untouched = Object.fromEntries(
        Object.entries(incoming).filter(([key]) => !edited.has(key)),
      );
      baseValues = values;
      publish({ ...untouched, settingsRevision: revision });
    },
    values() {
      const baseUrl = apiBaseUrl.parse(state.baseUrl.trim());
      const label = state.label.trim() || new URL(baseUrl).host;
      const updates = { baseUrl, model: state.model.trim(), apiKeyEnv: state.apiKeyEnv.trim() };
      const entry = { ...updates, id, label, enabled: state.enabled };
      const existing = (baseValues.endpoints ?? []).some((saved) => saved.id === id);
      const endpoints = existing
        ? baseValues.endpoints?.map((saved) => (saved.id === id ? entry : saved))
        : [...(baseValues.endpoints ?? []), entry];
      const next = {
        ...baseValues,
        maxToolRounds: Number(state.maxToolRounds),
        timeoutMs: Number(state.timeoutSeconds) * 1000,
        ...(id === "primary"
          ? updates
          : {
              endpoints,
            }),
      };
      return providerSettings.schema.parse(next);
    },
  };
}
export type ConnectionForm = ReturnType<typeof openConnectionForm>;
