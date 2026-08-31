import type { TerminalProfile } from "@otto-code/protocol/messages";
import type { PinnedTabTarget } from "@/workspace-pins/target";

export interface TabTargetHandlers {
  createDraft: () => void;
  createTerminal: () => void;
  createBrowser: () => void;
  createTerminalWithProfile: (profile: TerminalProfile) => void;
}

export function runPinnedTabTarget(
  target: PinnedTabTarget,
  profiles: readonly TerminalProfile[],
  handlers: TabTargetHandlers,
): void {
  if (target.kind === "draft") {
    handlers.createDraft();
    return;
  }
  if (target.kind === "terminal") {
    handlers.createTerminal();
    return;
  }
  if (target.kind === "browser") {
    handlers.createBrowser();
    return;
  }
  if (target.kind !== "profile") {
    // Tool pins (preview/artifact/splits) aren't tab launchers.
    return;
  }
  const profile = profiles.find((entry) => entry.id === target.profileId);
  if (!profile) {
    return;
  }
  // The stored profile travels, not a resolved launch: the create path resolves
  // the launch itself, and it needs the profile's id to record which profile
  // the terminal came from.
  handlers.createTerminalWithProfile(profile);
}
