/**
 * The state the Brain button on the bottom-left rail is showing.
 *
 * Scoped to the active workspace's host, matching the Brain page itself: the
 * rail is one button, and merging several hosts' brains into one light would
 * mean it could never say anything specific enough to act on.
 *
 * The rail is mounted globally, though, including on screens with no active
 * workspace at all (Settings, the Brain page itself, Home). `serverId` falls
 * back to the last workspace the user was actually in so the icon keeps
 * reading the same host's brain instead of going blank ("off") the moment you
 * navigate off a workspace route - which previously made the rail look like
 * the brain had gone offline just from opening the page meant to show it.
 *
 * Shares `brainStatusQueryKey` with the Brain page on purpose. React Query then
 * serves both from one cache entry and polls at whichever observer's interval is
 * shortest, so opening the page speeds the rail up rather than starting a second
 * poll against the same daemon.
 */
import { deriveBrainState, type BrainState } from "@/components/brain/brain-state";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { brainStatusQueryKey } from "@/screens/brain/use-brain-data";
import {
  useActiveWorkspaceSelection,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";

/**
 * How often the rail refreshes on its own. Slower than the Brain page's own poll
 * because this one runs for the whole session, on every screen: the rail is
 * ambient status, not a live readout, and a beat of lag on it costs nothing.
 */
const RAIL_POLL_MS = 5000;

export function useBrainRailState(): BrainState {
  const activeSelection = useActiveWorkspaceSelection();
  const lastSelection = useLastWorkspaceSelection();
  const selection = activeSelection ?? lastSelection;
  const serverId = selection?.serverId ?? "";
  const isConnected = useHostRuntimeIsConnected(serverId);
  const consoleSupported = useHostFeature(serverId, "brainConsole");
  const client = useHostRuntimeClient(serverId);

  const statusQuery = useFetchQuery({
    queryKey: brainStatusQueryKey(serverId, false),
    enabled: Boolean(serverId) && isConnected && consoleSupported && Boolean(client),
    dataShape: "value",
    staleTimeMs: RAIL_POLL_MS,
    refetchInterval: RAIL_POLL_MS,
    queryFn: async () => {
      if (!client) {
        throw new Error("This host is not connected.");
      }
      // Never `resources: true` from the rail: that costs an `nvidia-smi` spawn
      // per poll, and the phase split the icon animates from does not need it.
      return client.brainHostStatus({ resources: false });
    },
  });

  // A host that is not connected, or too old to serve the console, has no brain
  // state to report - which reads as off, not as an error. The user is not
  // missing anything; there is nothing there.
  return deriveBrainState(statusQuery.data ?? null);
}
