/**
 * The state the Brain button on the bottom-left rail is showing.
 *
 * Scoped to the active workspace's host, matching the Brain page itself: the
 * rail is one button, and merging several hosts' brains into one light would
 * mean it could never say anything specific enough to act on.
 *
 * The rail is mounted globally, though, including on screens with no active
 * workspace at all (Settings, the Brain page itself, Home). `serverId` falls
 * back, in order, to the last workspace the user was actually in, the local
 * desktop daemon, then whichever host is connected - the same chain
 * `BrainScreen` uses - so the icon keeps reading the real host's brain
 * instead of going blank ("off") just because no workspace happens to be
 * active this session.
 *
 * Shares `brainStatusQueryKey` with the Brain page on purpose. The daemon's
 * pushed snapshot then updates both mounts from one cache entry; old daemons
 * retain the compatibility polling fallback.
 */
import { useMemo } from "react";
import {
  deriveBrainActivity,
  deriveBrainState,
  resolveBrainRailPresentation,
  type BrainRailActivity,
  type BrainState,
} from "@/components/brain/brain-state";
import { brainStatusQueryKey, PUSHED_BRAIN_STATUS_STALE_MS } from "@/data/brain-status";
import { useFetchQuery } from "@/data/query";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import {
  useActiveWorkspaceSelection,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { buildBrainRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";

/**
 * How often the rail refreshes on its own. Slower than the Brain page's own poll
 * because this one runs for the whole session, on every screen: the rail is
 * ambient status, not a live readout, and a beat of lag on it costs nothing.
 */
const RAIL_POLL_MS = 5000;

export function useBrainRail() {
  const activeSelection = useActiveWorkspaceSelection();
  const lastSelection = useLastWorkspaceSelection();
  const localServerId = useLocalDaemonServerId();
  const hosts = useHosts();

  // Matches BrainScreen's own fallback (brain-screen.tsx): a workspace
  // selection is the freshest signal but only exists once a workspace has
  // actually been opened. The rail is mounted before that ever happens - on
  // Settings, on Home, on the Brain page itself - so without a further
  // fallback it read "off" for a host that was simply never the active
  // workspace this session, not one that is actually down. Falling through to
  // the local desktop daemon and then to whichever host is connected keeps
  // the button honest in both cases.
  const serverId = useMemo(() => {
    const preferred = activeSelection?.serverId ?? lastSelection?.serverId ?? localServerId;
    if (preferred && hosts.some((host) => host.serverId === preferred)) {
      return preferred;
    }
    return hosts[0]?.serverId ?? "";
  }, [activeSelection, lastSelection, localServerId, hosts]);

  const { config } = useDaemonConfig(serverId || null);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const consoleSupported = useHostFeature(serverId, "brainConsole");
  const statusPushSupported = useHostFeature(serverId, "brainStatusPush");
  const client = useHostRuntimeClient(serverId);

  const statusQuery = useFetchQuery({
    queryKey: brainStatusQueryKey(serverId, false),
    enabled: Boolean(serverId) && isConnected && consoleSupported && Boolean(client),
    dataShape: "value",
    // A pushed cache entry is authoritative, so the rail stops polling entirely
    // and rides the daemon's broadcast. Against an older daemon (or an older
    // brain, which the daemon reports the same way) it keeps the poll.
    staleTimeMs: statusPushSupported ? PUSHED_BRAIN_STATUS_STALE_MS : RAIL_POLL_MS,
    refetchInterval: statusPushSupported ? false : RAIL_POLL_MS,
    queryFn: async () => {
      if (!client) {
        throw new Error("This host is not connected.");
      }
      // Never `resources: true` from the rail: that costs an `nvidia-smi` spawn
      // per poll, and the phase split the icon animates from does not need it.
      return client.brainHostStatus({ resources: false });
    },
  });

  const status = statusQuery.data ?? null;
  const presentation = resolveBrainRailPresentation(
    deriveBrainState(status),
    config?.brain.enabled,
  );
  // A disabled Brain presents as disabled no matter what a stale status still
  // says: the presentation's state and label own the picture, so the per-slot
  // activity collapses to that single state instead of animating live slots.
  const activity: BrainRailActivity = presentation.disabled
    ? { kind: "single", state: presentation.state }
    : deriveBrainActivity(status);

  return { ...presentation, activity, serverId };
}

export function useBrainRailState(): BrainState {
  return useBrainRail().state;
}

/**
 * Where a Brain button goes when pressed. A disabled brain sends you to the
 * host's Brain settings - the page that can turn it back on - rather than to
 * the Brain console, which would only be able to say it is off.
 */
export function resolveBrainRailRoute(rail: { disabled: boolean; serverId: string }) {
  return rail.disabled && rail.serverId
    ? buildSettingsHostSectionRoute(rail.serverId, "brain")
    : buildBrainRoute();
}
