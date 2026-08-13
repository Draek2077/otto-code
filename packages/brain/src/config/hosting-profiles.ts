/** Brain-owned named chat-template compositions for llama-server. */
import { rmSync } from "node:fs";
import path from "node:path";

import type { BrainPaths } from "./paths.js";
import { writePrivateFileAtomicSync } from "./private-files.js";
import type { HostingProfile, Profile, ProfilesStore } from "./schema.js";

const SAFE_FILE = /[^a-zA-Z0-9_-]/gu;

function materializedTemplatePath(paths: BrainPaths, id: string): string {
  return path.join(paths.templatesDir, `${id.replace(SAFE_FILE, "_")}.jinja`);
}

/**
 * The bucket a model's hosting profiles live in. Families are catalog-authoritative
 * when available, otherwise discovery derives them from GGUF metadata; models
 * with neither use one real bucket rather than each being unaddressable. This
 * must be the single definition: a writer that stored under "generic" while a
 * reader looked up `null` was why a family default could be set on an unfamilied
 * model and never take effect.
 */
export const GENERIC_HOSTING_FAMILY = "generic";

export function hostingFamily(family: string | null | undefined): string {
  return family || GENERIC_HOSTING_FAMILY;
}

export function familyHostingProfileId(
  store: ProfilesStore,
  family: string | null | undefined,
): string | null {
  return store.familyHostingProfileIds[hostingFamily(family)] ?? null;
}

export function effectiveHostingProfile(
  store: ProfilesStore,
  profile: Profile,
  family: string | null | undefined,
): HostingProfile | null {
  const selected =
    profile.hostingProfileMode === "inherit"
      ? familyHostingProfileId(store, family)
      : profile.hostingProfileMode === "custom"
        ? profile.hostingProfileId
        : null;
  return selected ? (store.hostingProfiles[selected] ?? null) : null;
}

/**
 * Materialize a selected profile immediately before launch: the template as a
 * file llama-server reads, the system addendum as a string the router injects
 * into each completion request.
 *
 * The addendum is deliberately *not* spliced into the Jinja template, which was
 * the first design. Doing that means rewriting the `messages` list from inside
 * the template, and there is no portable way to do it: minja's support for list
 * mutation differs from Jinja2's, every model family's template consumes the
 * system turn differently, and a message's `content` is an array of parts for
 * multimodal requests rather than a string to concatenate onto. Injecting into
 * the parsed request body is the same composition (it appends to the agent's
 * existing system message instead of replacing it) done where the shape is
 * known and testable.
 */
export function resolveHostingProfileForLaunch(
  paths: BrainPaths,
  store: ProfilesStore,
  profile: Profile,
  family: string | null | undefined,
): Profile {
  const selected = effectiveHostingProfile(store, profile, family);
  const chatSystemAddendum = selected?.systemPromptAddendum?.trim() || null;
  if (!selected?.template) {
    return { ...profile, chatTemplateFile: null, chatTemplateKwargs: {}, chatSystemAddendum };
  }
  const file = materializedTemplatePath(paths, selected.id);
  writePrivateFileAtomicSync(file, selected.template);
  return {
    ...profile,
    chatTemplateFile: file,
    chatTemplateKwargs: selected.templateKwargs,
    chatSystemAddendum,
  };
}

/** Remove a deleted profile's generated template. Missing or locked files are non-fatal. */
export function removeHostingProfileMaterialization(paths: BrainPaths, id: string): void {
  try {
    rmSync(materializedTemplatePath(paths, id), { force: true });
  } catch {
    // Profile deletion must not fail because a previous launch left a file locked.
  }
}
