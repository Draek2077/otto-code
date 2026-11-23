import { expect, it } from "vitest";
import { providerSettings } from "../shared/settings.js";
import {
  connectionProfiles,
  openConnectionForm,
  withoutConnection,
} from "./connection-form-model.js";

it("adds several URL/key drafts without disclosing keys in settings and preserves other connections", () => {
  const values = providerSettings.schema.parse({
    baseUrl: "https://old.invalid/v1",
    model: "kept",
  });
  const form = openConnectionForm({ revision: "r1", values, newId: "connection-one" });
  form.edit("baseUrl", "https://new.invalid/v1");
  form.edit("key", "synthetic-secret");
  const saved = form.values();
  expect(saved.baseUrl).toBe(values.baseUrl);
  expect(saved.model).toBe("kept");
  expect(saved.endpoints).toEqual([
    {
      id: "connection-one",
      label: "new.invalid",
      baseUrl: "https://new.invalid/v1",
      model: "",
      apiKeyEnv: "OPENAI_API_KEY",
      enabled: true,
    },
  ]);
  expect(JSON.stringify(saved)).not.toContain("synthetic-secret");
  const another = openConnectionForm({ revision: "r2", values: saved, newId: "connection-two" });
  another.edit("baseUrl", "https://new.invalid/v1");
  expect(another.values().endpoints?.map((entry) => entry.id)).toEqual([
    "connection-one",
    "connection-two",
  ]);
});

it("retains a conflict draft and rebases only after an explicit successful settings commit", () => {
  const values = providerSettings.schema.parse({ baseUrl: "https://old.invalid/v1" });
  const profile = connectionProfiles(values)[0]!;
  const form = openConnectionForm({ revision: "initial", values, profile, newId: "unused" });
  form.edit("baseUrl", "https://changed.invalid/v1");
  form.edit("key", "keep-this-draft");
  form.edit("error", "Settings changed elsewhere");
  expect(form.getState().settingsRevision).toBe("initial");
  expect(form.getState().key).toBe("keep-this-draft");
  const next = form.values();
  form.committed("saved", next);
  expect(form.getState().settingsRevision).toBe("saved");
  expect(form.getState().key).toBe("keep-this-draft");
});

it("removes only the selected connection and never reassigns its identity to another", () => {
  const values = providerSettings.schema.parse({
    baseUrl: "https://old.invalid/v1",
    endpoints: [{ id: "other", label: "Other", baseUrl: "https://other.invalid/v1" }],
  });
  expect(withoutConnection(values, "primary").endpoints).toEqual(values.endpoints);
  expect(withoutConnection(values, "other")).toEqual({ ...values, endpoints: [] });
});

it("keeps edited URL and secret while adopting untouched peer changes on explicit review", () => {
  const values = providerSettings.schema.parse({ baseUrl: "https://old.invalid/v1", model: "old" });
  const form = openConnectionForm({
    revision: "old",
    values,
    profile: connectionProfiles(values)[0],
    newId: "unused",
  });
  form.edit("baseUrl", "https://draft.invalid/v1");
  form.edit("key", "synthetic-draft");
  form.rebase("new", { ...values, model: "peer-model", timeoutMs: 45000 });
  expect(form.values()).toMatchObject({
    baseUrl: "https://draft.invalid/v1",
    model: "peer-model",
    timeoutMs: 45000,
  });
  expect(form.getState().key).toBe("synthetic-draft");
  expect(form.getState().settingsRevision).toBe("new");
});

it("keeps saved connection order while editing an existing entry", () => {
  const values = providerSettings.schema.parse({
    endpoints: [
      { id: "first", label: "First", baseUrl: "https://first.invalid/v1" },
      { id: "second", label: "Second", baseUrl: "https://second.invalid/v1" },
    ],
  });
  const form = openConnectionForm({
    revision: "r1",
    values,
    profile: connectionProfiles(values)[0],
    newId: "unused",
  });
  form.edit("label", "Renamed");
  expect(form.values().endpoints?.map((entry) => entry.id)).toEqual(["first", "second"]);
});
