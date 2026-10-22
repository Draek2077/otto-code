import { useCallback, useState } from "react";
import type { SettingsState } from "@getpaseo/plugin/client";
import {
  providerSettings,
  type ConnectionSettings,
  type EndpointSettings,
} from "../shared/settings.js";

export type ReadySettings = Extract<
  SettingsState<typeof providerSettings.schema>,
  { status: "ready" }
>;
type ConnectionField = "baseUrl" | "model" | "apiKeyEnv";

function newEndpointId(label: string, values: ConnectionSettings): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "endpoint";
  const stem = /^[a-z]/.test(base) ? base : `endpoint-${base}`;
  const ids = new Set(["primary", ...(values.endpoints ?? []).map((profile) => profile.id)]);
  let id = stem;
  for (let suffix = 2; ids.has(id); suffix += 1) id = `${stem}-${suffix}`;
  return id;
}

export function useConnectionDraft(settings: ReadySettings) {
  const [draft, setDraft] = useState<{ values: ConnectionSettings; revision: string } | null>(null);
  const [profileId, setProfileId] = useState("primary");
  const [newLabel, setNewLabel] = useState("");
  const [generation, setGeneration] = useState(0);
  const change = useCallback(
    (update: (values: ConnectionSettings) => ConnectionSettings) => {
      setDraft((previous) => ({
        revision: previous?.revision ?? settings.revision,
        values: update(previous?.values ?? settings.values),
      }));
    },
    [settings],
  );
  const editProfile = useCallback(
    (updates: Partial<EndpointSettings>) =>
      change((values) => ({
        ...values,
        endpoints: (values.endpoints ?? []).map((profile) =>
          profile.id === profileId ? Object.assign({}, profile, updates) : profile,
        ),
      })),
    [change, profileId],
  );
  const edit = useCallback(
    (field: ConnectionField, value: string) => {
      if (profileId === "primary") change((values) => ({ ...values, [field]: value }));
      else editProfile({ [field]: value });
    },
    [profileId, change, editProfile],
  );
  const editUrl = useCallback((value: string) => edit("baseUrl", value), [edit]);
  const editModel = useCallback((value: string) => edit("model", value), [edit]);
  const editKey = useCallback((value: string) => edit("apiKeyEnv", value), [edit]);
  const editLabel = useCallback((label: string) => editProfile({ label }), [editProfile]);
  const editEnabled = useCallback((enabled: boolean) => editProfile({ enabled }), [editProfile]);
  const discard = useCallback(() => {
    setDraft(null);
    setGeneration((value) => value + 1);
    void settings.reload();
  }, [settings]);
  const save = useCallback(async () => {
    if (draft && (await settings.save(draft.values, draft.revision))) discard();
  }, [draft, settings, discard]);
  const add = useCallback(() => {
    const label = newLabel.trim();
    if (!label) return;
    const values = draft?.values ?? settings.values;
    const id = newEndpointId(label, values);
    change((previous) => ({
      ...previous,
      endpoints: [
        ...(previous.endpoints ?? []),
        { id, label, baseUrl: "", model: "", apiKeyEnv: "OPENAI_API_KEY" },
      ],
    }));
    setProfileId(id);
    setNewLabel("");
    setGeneration((value) => value + 1);
  }, [newLabel, draft, settings, change]);
  return {
    draft,
    profileId,
    setProfileId,
    newLabel,
    setNewLabel,
    generation,
    values: draft?.values ?? settings.values,
    editUrl,
    editModel,
    editKey,
    editLabel,
    editEnabled,
    discard,
    save,
    add,
  };
}
