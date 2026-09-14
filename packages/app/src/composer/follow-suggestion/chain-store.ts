import { create } from "zustand";

/**
 * Per-chat state for the "Follow prompt suggestions" chain: how many
 * suggestions this chat has followed back-to-back.
 *
 * Client-local and deliberately not in session-store: nothing here survives a
 * reload, crosses the wire, or outlives the feature. Whether a chat follows at
 * all is its Autonomous mode toggle (setting.ts), not state held here.
 */

export interface FollowSuggestionChain {
  /** Consecutive followed suggestions since the user last sent a message. */
  sentCount: number;
}

const IDLE_CHAIN: FollowSuggestionChain = { sentCount: 0 };

interface FollowSuggestionChainState {
  chains: Record<string, FollowSuggestionChain>;
  /** Called after a followed suggestion is handed to the send path. */
  recordFollowedSuggestion: (serverId: string, agentId: string, sentCount: number) => void;
  /** The user sent their own message, or Autonomous mode went off: re-arm. */
  resetChain: (serverId: string, agentId: string) => void;
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
        [followSuggestionChainKey(serverId, agentId)]: { sentCount },
      },
    })),
  resetChain: (serverId, agentId) =>
    set((state) => {
      const key = followSuggestionChainKey(serverId, agentId);
      if (!state.chains[key]) return state;
      const { [key]: _removed, ...rest } = state.chains;
      return { chains: rest };
    }),
}));

export function selectFollowSuggestionChain(
  state: FollowSuggestionChainState,
  serverId: string,
  agentId: string,
): FollowSuggestionChain {
  return state.chains[followSuggestionChainKey(serverId, agentId)] ?? IDLE_CHAIN;
}
