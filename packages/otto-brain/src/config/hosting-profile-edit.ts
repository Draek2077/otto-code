/** Host-authoritative template library edits, separated from numeric profile fields. */
import { randomUUID } from "node:crypto";
import { hostingFamily } from "./hosting-profiles.js";
import {
  HostingProfileSchema,
  type HostingProfile,
  type Profile,
  type ProfilesStore,
} from "./schema.js";
import type { Model } from "../types.js";

const BUILTIN_IDS = new Set(["qwen-sharp-v21.3"]);
const SAFE_ID = /^[a-zA-Z0-9_-]{1,80}$/u;

export function hostingProfilesFor(store: ProfilesStore, model: Model): HostingProfile[] {
  const family = hostingFamily(model.family);
  return Object.values(store.hostingProfiles).filter((candidate) => candidate.family === family);
}

function selectedProfile(store: ProfilesStore, model: Model, id: unknown): string | null {
  if (id === null || id === "") return null;
  if (typeof id !== "string" || !Object.hasOwn(store.hostingProfiles, id))
    throw new Error("Selected hosting profile does not exist");
  if (store.hostingProfiles[id]!.family !== hostingFamily(model.family))
    throw new Error("Hosting profile family must match the model");
  return id;
}

function upsertProfile(store: ProfilesStore, model: Model, profile: Profile, value: unknown): void {
  const candidate = HostingProfileSchema.safeParse(value);
  if (!candidate.success) throw new Error("Hosting profile is invalid");
  const item = candidate.data;
  if (!item.name.trim() || item.name.length > 80)
    throw new Error("Hosting profile name must contain 1 to 80 characters");
  if (!item.template?.trim() || item.template.length > 128 * 1024)
    throw new Error("Hosting profile requires a Jinja template of at most 128 KiB");
  if ((item.systemPromptAddendum?.length ?? 0) > 128 * 1024)
    throw new Error("Hosting profile system prompt exceeds 128 KiB");
  if (item.family !== hostingFamily(model.family))
    throw new Error("Hosting profile family must match the model");
  const isNew = item.id.length === 0;
  const id = isNew ? `hosting_${randomUUID()}` : item.id;
  if (!isNew && (BUILTIN_IDS.has(id) || !SAFE_ID.test(id)))
    throw new Error("Hosting profile cannot be edited");
  if (!isNew && !Object.hasOwn(store.hostingProfiles, id))
    throw new Error("Create a new hosting profile without an id");
  if (isNew && Object.keys(store.hostingProfiles).length >= 100)
    throw new Error("Hosting profile limit reached");
  store.hostingProfiles[id] = { ...item, id, name: item.name.trim() };
  if (isNew) {
    profile.hostingProfileId = id;
    profile.hostingProfileMode = "custom";
  }
}

function removeProfile(store: ProfilesStore, profile: Profile, id: unknown): void {
  if (typeof id !== "string" || !SAFE_ID.test(id) || BUILTIN_IDS.has(id))
    throw new Error("Hosting profile cannot be deleted");
  delete store.hostingProfiles[id];
  for (const saved of [profile, ...Object.values(store.profiles)]) {
    if (saved.hostingProfileId !== id) continue;
    saved.hostingProfileId = null;
    saved.hostingProfileMode = "off";
  }
  for (const [family, selected] of Object.entries(store.familyHostingProfileIds)) {
    if (selected === id) store.familyHostingProfileIds[family] = null;
  }
  // Generated templates are harmless immutable launch inputs. The next launch
  // rematerializes the selected record; no filesystem deletion precedes commit.
}

export function applyHostingProfilePatch(
  store: ProfilesStore,
  model: Model,
  profile: Profile,
  patch: Record<string, unknown>,
): void {
  if ("hostingProfileId" in patch) {
    profile.hostingProfileId = selectedProfile(store, model, patch.hostingProfileId);
    profile.hostingProfileMode = profile.hostingProfileId ? "custom" : "off";
  }
  if ("hostingProfileMode" in patch) {
    const mode = patch.hostingProfileMode;
    if (mode !== "inherit" && mode !== "off" && mode !== "custom")
      throw new Error("Invalid hosting profile mode");
    if (mode === "custom" && !profile.hostingProfileId)
      throw new Error("Select a hosting profile before using custom mode");
    profile.hostingProfileMode = mode;
  }
  if ("familyHostingProfileId" in patch)
    store.familyHostingProfileIds[hostingFamily(model.family)] = selectedProfile(
      store,
      model,
      patch.familyHostingProfileId,
    );
  if ("hostingProfile" in patch) upsertProfile(store, model, profile, patch.hostingProfile);
  if ("deleteHostingProfileId" in patch)
    removeProfile(store, profile, patch.deleteHostingProfileId);
  if (profile.hostingProfileMode !== "custom") profile.hostingProfileId = null;
}
