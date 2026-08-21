import { resolveTerminalProfileLaunch } from "@otto-code/protocol/terminal-profiles";
import type { TerminalProfile } from "@otto-code/protocol/messages";
import type { TerminalProfileInput } from "@/screens/workspace/terminals/use-workspace-terminals";
import type { PinnedTabTarget } from "@/workspace-pins/target";

export interface TabTargetHandlers {
  createDraft: () => void;
  createTerminal: () => void;
  createBrowser: () => void;
  createTerminalWithProfile: (profile: TerminalProfileInput) => void;
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
  // Nothing to type from a pin, so the prompt is empty and any sentinel arg
  // drops out.
  handlers.createTerminalWithProfile(resolveTerminalProfileLaunch(profile, ""));
}
