import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export function getStatusDotColor(input: {
  theme: Theme;
  bucket: SidebarStateBucket;
  showDoneAsInactive?: boolean;
}): string | null {
  const { theme, bucket, showDoneAsInactive = false } = input;

  // Sidebar dots are status signals, so they use the same semantic tint tokens as every other
  // status surface. Keeping this mapping in one place prevents project badges, workspace rows,
  // and the running ring from drifting into a separate dot-only palette.
  if (bucket === "needs_input") {
    return theme.colors.statusWarning;
  }
  if (bucket === "failed") {
    return theme.colors.statusDanger;
  }
  if (bucket === "running") {
    return theme.colors.statusInfo;
  }
  if (bucket === "attention") {
    return theme.colors.statusSuccess;
  }
  if (bucket === "done") {
    return showDoneAsInactive ? theme.colors.border : null;
  }
  return null;
}
