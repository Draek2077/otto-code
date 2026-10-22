import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { LegacyProviders, legacySettingsDefinition } from "./legacy-config.js";
import { endpointProfiles } from "./endpoints.js";

test("preserved provider identities and keys remain host-owned, endpoint-bound and independent of Brain", async () => {
  const root = await mkdtemp(
    path.join(fileURLToPath(new URL("../../../.tmp/", import.meta.url)), "otto-legacy-config-"),
  );
  const original = JSON.stringify({
    agents: {
      providers: {
        "openai-compatible": {
          extends: "openai-compatible",
          label: "My cloud",
          env: { OPENAI_BASE_URL: "https://example.test/v1/", OPENAI_API_KEY: "synthetic-old-key" },
        },
        studio: {
          extends: "openai-compatible",
          label: "Studio",
          env: {
            OPENAI_BASE_URL: "http://localhost:1234/v1",
            OPENAI_API_KEY: "synthetic-studio-key",
          },
        },
        "otto-brain": {
          extends: "openai-compatible",
          env: { OPENAI_BASE_URL: "http://localhost:9999/v1" },
        },
        "brain-alias": { extends: "otto-brain" },
        restrictive: {
          extends: "openai-compatible",
          actionBreaker: { enabled: true, threshold: 2 },
        },
      },
    },
  });
  await writeFile(path.join(root, "otto-config.json"), original);
  await writeFile(path.join(root, "config.json.otto-0.9.bak"), original);
  const providers = new LegacyProviders(root);
  expect(providers.ids()).toEqual(["openai-compatible", "restrictive", "studio"]);
  const primary = providers.profile("openai-compatible");
  expect(primary).toMatchObject({
    id: "openai-compatible",
    label: "My cloud",
    settings: { baseUrl: "https://example.test/v1/" },
  });
  const defaults = legacySettingsDefinition(primary?.settings).schema.parse({});
  expect(defaults.baseUrl).toBe("https://example.test/v1/");
  expect(JSON.stringify(defaults)).not.toContain("synthetic-old-key");
  expect(legacySettingsDefinition(primary?.settings).schema.parse({ baseUrl: "" }).baseUrl).toBe(
    "",
  );
  expect(providers.key("openai-compatible", endpointProfiles(defaults)[0]!)).toBe(
    "synthetic-old-key",
  );
  expect(
    providers.key("studio", {
      id: "primary",
      label: "Studio",
      settings: providers.profile("studio")!.settings,
    }),
  ).toBe("synthetic-studio-key");
  expect(
    providers.key("openai-compatible", {
      id: "primary",
      label: "Other",
      settings: { ...defaults, baseUrl: "https://other.test/v1" },
    }),
  ).toBeUndefined();
  expect(providers.profile("restrictive")?.diagnostic).toContain("actionBreaker");
  expect(providers.originalEndpoint("studio")).toBe("http://localhost:1234/v1/chat/completions");
  expect(await readFile(path.join(root, "otto-config.json"), "utf8")).toBe(original);
  expect(await readFile(path.join(root, "config.json.otto-0.9.bak"), "utf8")).toBe(original);
  await writeFile(path.join(root, "otto-config.json"), "not-json");
  expect(() => providers.ids()).toThrow("left intact");
  expect(await readFile(path.join(root, "otto-config.json"), "utf8")).toBe("not-json");
});
