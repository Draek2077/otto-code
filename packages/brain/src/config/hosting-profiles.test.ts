import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  effectiveHostingProfile,
  removeHostingProfileMaterialization,
  resolveHostingProfileForLaunch,
} from "./hosting-profiles.js";
import type { BrainPaths } from "./paths.js";
import { defaultProfile, forModel } from "./profiles.js";
import { ProfilesStoreSchema } from "./schema.js";
import type { Model } from "../types.js";

const profile = {
  id: "qwen-coding",
  name: "Qwen coding",
  family: "qwen",
  description: "",
  template: "{{ messages }}",
  systemPromptAddendum: null,
  templateKwargs: {},
};

const roots: string[] = [];

function tempPaths(): BrainPaths {
  const root = mkdtempSync(path.join(tmpdir(), "brain-hosting-"));
  roots.push(root);
  return { templatesDir: path.join(root, "templates") } as BrainPaths;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("effectiveHostingProfile", () => {
  it("keeps system default, off, and a custom override distinct", () => {
    const store = ProfilesStoreSchema.parse({
      hostingProfiles: { [profile.id]: profile },
      familyHostingProfileIds: { qwen: profile.id },
    });
    const base = defaultProfile(null);

    expect(
      effectiveHostingProfile(store, { ...base, hostingProfileMode: "inherit" }, "qwen"),
    ).toMatchObject({ id: profile.id });
    expect(
      effectiveHostingProfile(
        store,
        { ...base, hostingProfileMode: "off", hostingProfileId: profile.id },
        "qwen",
      ),
    ).toBeNull();
    expect(
      effectiveHostingProfile(
        store,
        { ...base, hostingProfileMode: "custom", hostingProfileId: profile.id },
        "qwen",
      ),
    ).toMatchObject({ id: profile.id });
  });

  // A model whose GGUF names no family is filed under "generic" by the writer.
  // A reader that looked up `null` instead never found the default it had just
  // stored, so "System default" could be set and would never take effect.
  it("resolves the generic family default for a model with no family", () => {
    const generic = { ...profile, id: "generic-default", family: "generic" };
    const store = ProfilesStoreSchema.parse({
      hostingProfiles: { [generic.id]: generic },
      familyHostingProfileIds: { generic: generic.id },
    });

    expect(
      effectiveHostingProfile(
        store,
        { ...defaultProfile(null), hostingProfileMode: "inherit" },
        null,
      ),
    ).toMatchObject({ id: generic.id });
  });
});

describe("resolveHostingProfileForLaunch", () => {
  it("materializes the template and carries the addendum for the router", () => {
    const withPrompt = { ...profile, systemPromptAddendum: "  Be concise.  " };
    const store = ProfilesStoreSchema.parse({
      hostingProfiles: { [withPrompt.id]: withPrompt },
      familyHostingProfileIds: { qwen: withPrompt.id },
    });
    const paths = tempPaths();

    const resolved = resolveHostingProfileForLaunch(
      paths,
      store,
      { ...defaultProfile(null), hostingProfileMode: "inherit" },
      "qwen",
    );

    expect(resolved.chatTemplateFile).toBe(path.join(paths.templatesDir, "qwen-coding.jinja"));
    expect(readFileSync(resolved.chatTemplateFile!, "utf8")).toBe(withPrompt.template);
    expect(resolved.chatSystemAddendum).toBe("Be concise.");
  });

  it("clears both derived fields when no profile applies", () => {
    const store = ProfilesStoreSchema.parse({});

    const resolved = resolveHostingProfileForLaunch(
      tempPaths(),
      store,
      { ...defaultProfile(null), chatTemplateFile: "/stale.jinja", chatSystemAddendum: "stale" },
      "qwen",
    );

    expect(resolved.chatTemplateFile).toBeNull();
    expect(resolved.chatSystemAddendum).toBeNull();
  });

  it("removes a deleted profile's materialized template without requiring it to exist", () => {
    const paths = tempPaths();
    const store = ProfilesStoreSchema.parse({
      hostingProfiles: { [profile.id]: profile },
      familyHostingProfileIds: { qwen: profile.id },
    });
    const resolved = resolveHostingProfileForLaunch(
      paths,
      store,
      { ...defaultProfile(null), hostingProfileMode: "inherit" },
      "qwen",
    );

    removeHostingProfileMaterialization(paths, profile.id);
    removeHostingProfileMaterialization(paths, profile.id);

    expect(existsSync(resolved.chatTemplateFile!)).toBe(false);
  });
});

describe("forModel hosting-profile migration", () => {
  const model = { id: "m1", displayName: "m1", modelPath: "/m1.gguf" } as Model;

  it("reads a legacy stored id as an explicit custom choice", () => {
    // Written by a Brain that had `hostingProfileId` and no mode, so the mode
    // parses as the schema default rather than being absent.
    const store = ProfilesStoreSchema.parse({
      profiles: { m1: { contextSize: 4096, hostingProfileId: profile.id } },
      hostingProfiles: { [profile.id]: profile },
    });

    expect(forModel(store, model).hostingProfileMode).toBe("custom");
    expect(forModel(store, model).hostingProfileId).toBe(profile.id);
  });

  it("leaves a profile that never chose one inheriting its family default", () => {
    const store = ProfilesStoreSchema.parse({ profiles: { m1: { contextSize: 4096 } } });

    expect(forModel(store, model).hostingProfileMode).toBe("inherit");
  });

  it("keeps an explicit off", () => {
    const store = ProfilesStoreSchema.parse({
      profiles: { m1: { contextSize: 4096, hostingProfileMode: "off" } },
    });

    expect(forModel(store, model).hostingProfileMode).toBe("off");
  });
});
