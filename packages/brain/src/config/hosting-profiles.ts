/** Brain-owned named chat-template compositions for llama-server. */
import path from "node:path";

import type { BrainPaths } from "./paths.js";
import { writePrivateFileAtomicSync } from "./private-files.js";
import type { HostingProfile, Profile, ProfilesStore } from "./schema.js";

const SAFE_FILE = /[^a-zA-Z0-9_-]/gu;

export function effectiveHostingProfile(
  store: ProfilesStore,
  profile: Profile,
  family: string | null | undefined,
): HostingProfile | null {
  const selected =
    profile.hostingProfileId ?? (family ? store.familyHostingProfileIds[family] : null);
  return selected ? (store.hostingProfiles[selected] ?? null) : null;
}

/**
 * Materialize a selected template under Brain storage immediately before launch.
 * System addenda belong inside the Jinja template so they compose with the
 * agent's existing system message rather than replacing it through a CLI flag.
 */
export function resolveHostingProfileForLaunch(
  paths: BrainPaths,
  store: ProfilesStore,
  profile: Profile,
  family: string | null | undefined,
): Profile {
  const selected = effectiveHostingProfile(store, profile, family);
  if (!selected?.template) return { ...profile, chatTemplateFile: null, chatTemplateKwargs: {} };
  const file = path.join(paths.templatesDir, `${selected.id.replace(SAFE_FILE, "_")}.jinja`);
  writePrivateFileAtomicSync(file, selected.template);
  return {
    ...profile,
    chatTemplateFile: file,
    chatTemplateKwargs: selected.templateKwargs,
  };
}
