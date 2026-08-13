import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { seedBuiltinHostingProfiles } from "./builtin-hosting-profiles.js";
import type { BrainPaths } from "./paths.js";
import { ProfilesStoreSchema } from "./schema.js";
import { loadProfilesStore } from "./store.js";

const roots: string[] = [];
const qwenSharpId = "qwen-sharp-v21.3";

function testPaths(): BrainPaths {
  const root = mkdtempSync(path.join(tmpdir(), "otto-brain-hosting-profiles-"));
  roots.push(root);
  return {
    home: root,
    root,
    configFile: path.join(root, "config.json"),
    profilesFile: path.join(root, "profiles.json"),
    catalogFile: path.join(root, "catalog.json"),
    renameMapFile: path.join(root, "rename-map.json"),
    modelsDir: path.join(root, "models"),
    runtimesDir: path.join(root, "runtimes"),
    pidFile: path.join(root, "otto-brain.pid"),
    activityFile: path.join(root, "otto-brain.activity"),
    logFile: path.join(root, "otto-brain.log"),
    logsDir: path.join(root, "logs"),
    resultsDir: path.join(root, "results"),
    templatesDir: path.join(root, "templates"),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("built-in hosting profiles", () => {
  it("ships a usable Qwen Sharp Jinja template", () => {
    const store = ProfilesStoreSchema.parse({});

    expect(seedBuiltinHostingProfiles(store)).toBe(true);

    const template = store.hostingProfiles[qwenSharpId]?.template;
    expect(template).toBeTruthy();
    expect(template).not.toBe(Buffer.from("undefined", "base64").toString("utf8"));
    expect(template).toContain("{%");
    expect(template).toMatch(/\{%-?\s*for\s+message\s+in\s+_msgs\s*%\}/);
  });

  it("upgrades product-owned profiles while preserving user-created records", () => {
    const canonical = ProfilesStoreSchema.parse({});
    seedBuiltinHostingProfiles(canonical);
    const qwenSharp = canonical.hostingProfiles[qwenSharpId]!;
    const userProfile = {
      id: "my-qwen-template",
      name: "My Qwen template",
      family: "qwen",
      description: "",
      template: "{{ messages }}",
      systemPromptAddendum: null,
      templateKwargs: {},
    };
    const store = ProfilesStoreSchema.parse({
      hostingProfiles: {
        [qwenSharpId]: { ...qwenSharp, name: "Old Qwen Sharp", template: "corrupt" },
        [userProfile.id]: userProfile,
      },
    });

    expect(seedBuiltinHostingProfiles(store)).toBe(true);
    expect(store.hostingProfiles[qwenSharpId]).toEqual(qwenSharp);
    expect(store.hostingProfiles[userProfile.id]).toEqual(userProfile);
  });

  it("does not create profiles.json on a fresh read, but upgrades an existing store", () => {
    const paths = testPaths();
    const fresh = loadProfilesStore(paths);

    expect(fresh.hostingProfiles[qwenSharpId]).toBeDefined();
    expect(existsSync(paths.profilesFile)).toBe(false);

    writeFileSync(
      paths.profilesFile,
      JSON.stringify({
        version: 1,
        hostingProfiles: {
          [qwenSharpId]: {
            id: qwenSharpId,
            name: "Broken Qwen Sharp",
            family: "qwen",
            description: "",
            template: "corrupt",
            systemPromptAddendum: null,
            templateKwargs: {},
          },
        },
      }),
    );

    const upgraded = loadProfilesStore(paths);
    expect(upgraded.hostingProfiles[qwenSharpId]?.template).not.toBe("corrupt");
    expect(existsSync(paths.profilesFile)).toBe(true);
  });
});
