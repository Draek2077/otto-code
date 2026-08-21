import { beforeEach, describe, expect, it } from "vitest";
import { decideFollowPromptSuggestion, FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE } from "./decide";
import { selectFollowSuggestionChain, useFollowSuggestionChainStore } from "./chain-store";

const SERVER = "host-1";
const AGENT = "agent-1";

function chain(serverId = SERVER, agentId = AGENT) {
  return selectFollowSuggestionChain(useFollowSuggestionChainStore.getState(), serverId, agentId);
}

describe("follow suggestion chain store", () => {
  beforeEach(() => {
    useFollowSuggestionChainStore.setState({ chains: {} });
  });

  it("starts idle for a chat it has never seen", () => {
    expect(chain()).toEqual({ sentCount: 0, isStopped: false });
  });

  it("keeps chains separate per chat", () => {
    useFollowSuggestionChainStore.getState().recordFollowedSuggestion(SERVER, AGENT, 2);
    expect(chain().sentCount).toBe(2);
    expect(chain(SERVER, "agent-2").sentCount).toBe(0);
    expect(chain("host-2", AGENT).sentCount).toBe(0);
  });

  it("stops one chat without touching another", () => {
    useFollowSuggestionChainStore.getState().stopChain(SERVER, AGENT);
    expect(chain().isStopped).toBe(true);
    expect(chain(SERVER, "agent-2").isStopped).toBe(false);
  });

  it("clears the stop and the count when the user sends their own message", () => {
    useFollowSuggestionChainStore.getState().recordFollowedSuggestion(SERVER, AGENT, 3);
    useFollowSuggestionChainStore.getState().stopChain(SERVER, AGENT);
    useFollowSuggestionChainStore.getState().resetChain(SERVER, AGENT);
    expect(chain()).toEqual({ sentCount: 0, isStopped: false });
  });

  it("bounds an unattended chat that keeps suggesting its own next prompt", () => {
    const store = useFollowSuggestionChainStore.getState();
    const sent: string[] = [];
    for (let turn = 0; turn < 25; turn += 1) {
      const current = chain();
      const decision = decideFollowPromptSuggestion({
        isFollowEnabled: true,
        arePromptSuggestionsEnabled: true,
        suggestion: `keep going ${turn}`,
        draftText: "",
        attachmentCount: 0,
        queuedCount: 0,
        isAgentRunning: false,
        canSubmit: true,
        isStopped: current.isStopped,
        sentCount: current.sentCount,
      });
      if (decision.action !== "send") break;
      store.recordFollowedSuggestion(SERVER, AGENT, decision.sentCount);
      sent.push(decision.prompt);
    }
    expect(sent).toHaveLength(FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE);
    expect(chain().sentCount).toBe(FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE);
  });
});
