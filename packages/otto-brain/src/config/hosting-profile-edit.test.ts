import { expect, it } from "vitest";
import { ProfilesStoreSchema } from "./schema.js";
import { defaultProfile } from "./profiles.js";
import { applyHostingProfilePatch } from "./hosting-profile-edit.js";
import type { Model } from "../types.js";

const model = { id: "fixture/model", family: "fixture" } as Model;
const template = {
  id: "",
  family: "fixture",
  name: "Fixture",
  template: "{{ messages }}",
  systemPromptAddendum: null,
  templateKwargs: {},
};

it("creates a custom template and preserves selection while editing its text", () => {
  const store = ProfilesStoreSchema.parse({ future: { retained: true } });
  const profile = defaultProfile(model);
  applyHostingProfilePatch(store, model, profile, { hostingProfile: template });
  const id = profile.hostingProfileId!;
  expect(id).toMatch(/^hosting_/u);
  expect(profile.hostingProfileMode).toBe("custom");
  profile.hostingProfileMode = "inherit";
  profile.hostingProfileId = null;
  applyHostingProfilePatch(store, model, profile, {
    hostingProfile: { ...store.hostingProfiles[id], template: "changed" },
  });
  expect(profile.hostingProfileMode).toBe("inherit");
  expect(profile.hostingProfileId).toBeNull();
  expect(store.hostingProfiles[id]!.template).toBe("changed");
  expect(store.future).toEqual({ retained: true });
});

it("clears references in other model and family selections when deleting a template", () => {
  const store = ProfilesStoreSchema.parse({});
  const profile = defaultProfile(model);
  applyHostingProfilePatch(store, model, profile, { hostingProfile: template });
  const id = profile.hostingProfileId!;
  store.profiles.other = { ...profile };
  store.familyHostingProfileIds.fixture = id;
  applyHostingProfilePatch(store, model, profile, { deleteHostingProfileId: id });
  expect(profile).toMatchObject({ hostingProfileId: null, hostingProfileMode: "off" });
  expect(store.profiles.other).toMatchObject({ hostingProfileId: null, hostingProfileMode: "off" });
  expect(store.familyHostingProfileIds.fixture).toBeNull();
});

it("refuses built-in mutations, prototype selections and cross-family selection", () => {
  const store = ProfilesStoreSchema.parse({
    hostingProfiles: { foreign: { ...template, id: "foreign", family: "other" } },
  });
  const profile = defaultProfile(model);
  for (const patch of [
    { hostingProfile: { ...template, id: "qwen-sharp-v21.3" } },
    { deleteHostingProfileId: "qwen-sharp-v21.3" },
    { hostingProfileId: "__proto__" },
    { hostingProfileId: "foreign" },
    { familyHostingProfileId: "foreign" },
  ])
    expect(() => applyHostingProfilePatch(store, model, profile, patch)).toThrow();
});
