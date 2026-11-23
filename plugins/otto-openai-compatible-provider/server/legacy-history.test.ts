import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { importLegacyConversation, restoredLegacyConfig } from "./legacy-history.js";
import { providerSettings } from "../shared/settings.js";

test("ordinary endpoint legacy Off still restores omission rather than Brain's explicit toggle", () => {
  expect(
    restoredLegacyConfig({
      config: {
        cwd: "/fixture",
        env: {},
        mcpServers: {},
        settings: { reasoning_effort: "off", auto_compact: "80" },
        persist: true,
      },
      persistence: {
        version: 1,
        data: {
          format: "otto-openai-compatible-v1",
          legacyOrigin: { provider: "openai-compatible", sessionId: "old" },
        },
      },
    }),
  ).toMatchObject({ thinkingOption: "default", settings: { auto_compact: "80" } });
});

test("unverified endpoints and unsupported legacy history fail without overwriting source data", async () => {
  const scratch = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const home = await mkdtemp(path.join(scratch, "otto-history-guard-"));
  const original = JSON.stringify({
    agents: {
      providers: {
        "openai-compatible": {
          extends: "openai-compatible",
          env: { OPENAI_BASE_URL: "https://original.test/v1" },
        },
      },
    },
  });
  await writeFile(path.join(home, "config.json.otto-0.9.bak"), original);
  const handle = {
    provider: "openai-compatible",
    sessionId: "old-native",
    metadata: {
      model: "fixture",
      messages: [{ role: "user", content: "Private original context" }],
    },
  };
  const persistence = { version: 1, data: { format: "otto-openai-0.9-handle-v1", handle } };
  const before = structuredClone(persistence);
  const input = {
    persistence,
    provider: "openai-compatible",
    home,
    config: { cwd: home, env: {}, mcpServers: {}, settings: {}, persist: true },
    signal: new AbortController().signal,
  };
  await expect(
    importLegacyConversation({
      ...input,
      settings: providerSettings.schema.parse({ baseUrl: "https://changed.test/v1" }),
    }),
  ).rejects.toThrow("different endpoint");
  await expect(
    importLegacyConversation({
      ...input,
      settings: providerSettings.schema.parse({ baseUrl: "https://original.test/v1" }),
      persistence: { version: 2, data: persistence.data },
    }),
  ).rejects.toThrow("version requires review");
  await expect(
    importLegacyConversation({
      ...input,
      settings: providerSettings.schema.parse({ baseUrl: "https://original.test/v1" }),
      persistence: {
        version: 1,
        data: {
          ...persistence.data,
          handle: {
            ...handle,
            metadata: {
              ...handle.metadata,
              messages: [{ role: "unknown", content: "Do not discard" }],
            },
          },
        },
      },
    }),
  ).rejects.toThrow("format requires review");
  expect(persistence).toEqual(before);
  expect(await readFile(path.join(home, "config.json.otto-0.9.bak"), "utf8")).toBe(original);
  expect(await readdir(home)).toEqual(["config.json.otto-0.9.bak"]);
});
