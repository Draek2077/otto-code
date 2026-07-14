import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Globe, SquarePen, SquareTerminal } from "@/components/icons/material-icons";
import { withUnistyles } from "react-native-unistyles";
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@otto-code/protocol/terminal-profiles";
import { getProviderIcon } from "@/components/provider-icons";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import type { Theme } from "@/styles/theme";
import { pinnedTargetKey, type PinnedTabTarget } from "@/workspace-pins/target";
import { usePinnedTargetsStore } from "@/workspace-pins/store";

export interface ResolvedPin {
  key: string;
  target: PinnedTabTarget;
  label: string;
  icon: ReactElement;
  onPress: () => void;
}

interface UsePinnedLaunchersInput {
  serverId: string;
  onLaunch: (target: PinnedTabTarget) => void;
}

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedGlobe = withUnistyles(Globe);
const ThemedSquarePen = withUnistyles(SquarePen);

function ProviderPinIcon({
  iconKey,
  size,
  color = "",
}: {
  iconKey: string;
  size: number;
  color?: string;
}) {
  const Icon = getProviderIcon(iconKey);
  return <Icon size={size} color={color} />;
}

const ThemedProviderPinIcon = withUnistyles(ProviderPinIcon);

export function ProfileIcon({ iconKey }: { iconKey: string | undefined }): ReactElement {
  if (!iconKey) {
    return <ThemedSquareTerminal size={14} uniProps={mutedColorMapping} />;
  }
  return <ThemedProviderPinIcon iconKey={iconKey} size={14} uniProps={mutedColorMapping} />;
}

export function usePinnedLaunchers({ serverId, onLaunch }: UsePinnedLaunchersInput): ResolvedPin[] {
  const { t } = useTranslation();
  const pinned = usePinnedTargetsStore((state) => state.pinned);
  const { config } = useDaemonConfig(serverId);
  const profiles = useMemo(
    () => resolveTerminalProfiles(config?.terminalProfiles),
    [config?.terminalProfiles],
  );

  return useMemo(() => {
    const resolved: ResolvedPin[] = [];
    for (const target of pinned) {
      if (target.kind === "draft") {
        resolved.push({
          key: pinnedTargetKey(target),
          target,
          label: t("workspace.tabs.actions.newAgent"),
          icon: <ThemedSquarePen size={14} uniProps={mutedColorMapping} />,
          onPress: () => onLaunch(target),
        });
        continue;
      }
      if (target.kind === "terminal") {
        resolved.push({
          key: pinnedTargetKey(target),
          target,
          label: t("workspace.tabs.actions.newTerminal"),
          icon: <ThemedSquareTerminal size={14} uniProps={mutedColorMapping} />,
          onPress: () => onLaunch(target),
        });
        continue;
      }
      if (target.kind === "browser") {
        resolved.push({
          key: pinnedTargetKey(target),
          target,
          label: t("workspace.tabs.actions.newBrowser"),
          icon: <ThemedGlobe size={14} uniProps={mutedColorMapping} />,
          onPress: () => onLaunch(target),
        });
        continue;
      }
      if (target.kind !== "profile") {
        // Tool pins (preview/artifact/splits) don't resolve to launcher
        // buttons — tools render their own buttons.
        continue;
      }
      const profile = profiles.find((entry) => entry.id === target.profileId);
      if (!profile) {
        continue;
      }
      resolved.push({
        key: pinnedTargetKey(target),
        target,
        label: profile.name,
        icon: <ProfileIcon iconKey={getTerminalProfileIcon(profile)} />,
        onPress: () => onLaunch(target),
      });
    }
    // Gutter order is fixed (agent, terminal, browser, then profiles) regardless
    // of the order targets were pinned in — sort is stable so profile pins keep
    // their relative order among themselves.
    return resolved
      .map((pin, index) => ({ pin, index }))
      .sort((a, b) => {
        const rankDiff =
          LAUNCHER_KIND_RANK[a.pin.target.kind] - LAUNCHER_KIND_RANK[b.pin.target.kind];
        return rankDiff !== 0 ? rankDiff : a.index - b.index;
      })
      .map(({ pin }) => pin);
  }, [onLaunch, pinned, profiles, t]);
}

const LAUNCHER_KIND_RANK: Record<PinnedTabTarget["kind"], number> = {
  draft: 0,
  terminal: 1,
  browser: 2,
  profile: 3,
  preview: 4,
  artifact: 4,
  "split-right": 4,
  "split-down": 4,
};
