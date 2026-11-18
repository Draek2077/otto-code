import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { workspaceActivityBlue } from "@/otto/chat/identity/palette"; // OTTO(chat-identity): released semantic blue without modifying Paseo's theme.

export function getStatusDotColor(input: {
  theme: Theme;
  bucket: SidebarStateBucket;
  showDoneAsInactive?: boolean;
}): string | null {
  const { theme, bucket, showDoneAsInactive = false } = input;

  // OTTO(chat-identity): match 0.9.35's shared semantic status family. The blue activity
  // ring is independent of this dot, so an error or question stays visible while work continues.
  if (bucket === "needs_input") {
    return theme.colors.statusWarning; // OTTO(chat-identity): shared semantic status tints, as in 0.9.35.
  }
  if (bucket === "failed") {
    return theme.colors.statusDanger;
  }
  if (bucket === "running") {
    return workspaceActivityBlue(theme.colorScheme === "dark");
  }
  if (bucket === "attention") {
    return theme.colors.statusSuccess;
  }
  if (bucket === "done") {
    return showDoneAsInactive ? theme.colors.border : null;
  }
  return null;
}
