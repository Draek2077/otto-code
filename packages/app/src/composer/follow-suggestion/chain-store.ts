import { create } from "zustand";

/**
 * Per-chat state for the "Follow prompt suggestions" chain: how many
 * suggestions this chat has followed back-to-back, and whether the user pressed
 * Stop on the band.
 *
 * Client-local and deliberately not in session-store: nothing here survives a
 * reload, crosses the wire, or outlives the feature. Deleting the feature is
 * deleting this directory.
 */

export interface FollowSuggestionChain {
  /** Consecutive followed suggestions since the user last sent a message. */
  sentCount: number;
  /** Stopped for this chat only. Cleared by the user's next own message. */
  isStopped: boolean;
}

const IDLE_CHAIN: FollowSuggestionChain = { sentCount: 0, isStopped: false };

interface FollowSuggestionChainState {
  chains: Record<string, FollowSuggestionChain>;
  /** Called after a followed suggestion is handed to the send path. */
  recordFollowedSuggestion: (serverId: string, agentId: string, sentCount: number) => void;
  /** The user sent their own message, or the feature went away: re-arm. */
  resetChain: (serverId: string, agentId: string) => void;
  /** The user pressed Stop. The setting stays on for every other chat. */
  stopChain: (serverId: string, agentId: string) => void;
}

export function followSuggestionChainKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

export const useFollowSuggestionChainStore = create<FollowSuggestionChainState>((set) => ({
  chains: {},
  recordFollowedSuggestion: (serverId, agentId, sentCount) =>
    set((state) => ({
      chains: {
        ...state.chains,
        [followSuggestionChainKey(serverId, agentId)]: { sentCount, isStopped: false },
      },
    })),
  resetChain: (serverId, agentId) =>
    set((state) => {
      const key = followSuggestionChainKey(serverId, agentId);
      if (!state.chains[key]) return state;
      const { [key]: _removed, ...rest } = state.chains;
      return { chains: rest };
    }),
  stopChain: (serverId, agentId) =>
    set((state) => {
      const key = followSuggestionChainKey(serverId, agentId);
      const current = state.chains[key] ?? IDLE_CHAIN;
      return { chains: { ...state.chains, [key]: { ...current, isStopped: true } } };
    }),
}));

export function selectFollowSuggestionChain(
  state: FollowSuggestionChainState,
  serverId: string,
  agentId: string,
): FollowSuggestionChain {
  return state.chains[followSuggestionChainKey(serverId, agentId)] ?? IDLE_CHAIN;
}
