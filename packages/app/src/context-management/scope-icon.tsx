import type { ReactElement, ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ContextScope } from "@otto-code/protocol/messages";
import { FolderGit2, FolderTree, Globe, Home, Shield } from "@/components/icons/material-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";

/**
 * Scope, as one icon. Shared by the load tree and the fix list so a file and a
 * finding about that file are never labelled two different ways
 * (docs/glossary.md: one label, no synonyms).
 *
 * Scope is not decoration. Editing a `global` file changes every project on the
 * machine, and a user who does not know that will be surprised later — which is
 * why it is the one scope that keeps the warning tint.
 */

export const SCOPE_ICON_SIZE = 13;

// Themed icons: `color` is required on every icon and `useUnistyles()` is banned
// (docs/unistyles.md), so each tint is a uniProps mapping.
const ThemedGlobe = withUnistyles(Globe);
const ThemedHome = withUnistyles(Home);
const ThemedShield = withUnistyles(Shield);
const ThemedFolderTree = withUnistyles(FolderTree);
const ThemedFolderGit2 = withUnistyles(FolderGit2);

const warningIconColor = (theme: Theme) => ({ color: theme.colors.statusWarning });
const mutedIconColor = (theme: Theme) => ({ color: theme.colors.mutedForeground });

interface ScopeIconProps {
  scope: ContextScope;
  /**
   * The tree suppresses project scope: it is the default there, and a badge on
   * nearly every row is noise. The fix list always shows one — a finding's whole
   * question is "how far does this reach", so the common case still needs saying.
   */
  showProject?: boolean;
  size?: number;
}

export function ScopeIcon({
  scope,
  showProject = false,
  size = SCOPE_ICON_SIZE,
}: ScopeIconProps): ReactElement | null {
  const { t } = useTranslation();

  // Runtime rows are not files, so they have no scope to state.
  if (scope === "runtime") return null;
  if (scope === "project" && !showProject) return null;

  const label = t(SCOPE_LABEL_KEYS[scope]);
  if (scope === "global") {
    return (
      <ScopeBadge label={label}>
        <ThemedGlobe size={size} uniProps={warningIconColor} />
      </ScopeBadge>
    );
  }
  if (scope === "enterprise") {
    return (
      <ScopeBadge label={label}>
        <ThemedShield size={size} uniProps={mutedIconColor} />
      </ScopeBadge>
    );
  }
  if (scope === "subdirectory") {
    return (
      <ScopeBadge label={label}>
        <ThemedFolderTree size={size} uniProps={mutedIconColor} />
      </ScopeBadge>
    );
  }
  if (scope === "project") {
    return (
      <ScopeBadge label={label}>
        <ThemedFolderGit2 size={size} uniProps={mutedIconColor} />
      </ScopeBadge>
    );
  }
  return (
    <ScopeBadge label={label}>
      <ThemedHome size={size} uniProps={mutedIconColor} />
    </ScopeBadge>
  );
}

const SCOPE_LABEL_KEYS: Record<Exclude<ContextScope, "runtime">, string> = {
  enterprise: "contextManagement.scope.enterprise",
  global: "contextManagement.scope.global",
  local: "contextManagement.scope.local",
  subdirectory: "contextManagement.scope.subdirectory",
  project: "contextManagement.scope.project",
};

/**
 * Icons carry no text, so the meaning lives in the tooltip and the a11y label.
 *
 * `asChild` around a plain View is load-bearing: the trigger clones hover and
 * focus handlers onto the View instead of wrapping it in a Pressable, so a
 * click on the icon still reaches the row's own Pressable and selects the file.
 * A nested Pressable would swallow it. Same idiom as LockedAgentModeBadge.
 * Hover-only — on touch there is nothing to hover, and the label covers a11y.
 */
export function ScopeBadge({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <View
          collapsable={false}
          accessibilityRole="image"
          accessibilityLabel={label}
          style={styles.badgeIcon}
        >
          {children}
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={6}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  badgeIcon: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.xs + 2, md: theme.fontSize.xs },
  },
}));
