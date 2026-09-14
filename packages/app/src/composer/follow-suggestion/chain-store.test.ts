import { beforeEach, describe, expect, it } from "vitest";
import { decideFollowPromptSuggestion } from "./decide";
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
    expect(chain()).toEqual({ sentCount: 0 });
  });

  it("keeps chains separate per chat", () => {
    useFollowSuggestionChainStore.getState().recordFollowedSuggestion(SERVER, AGENT, 2);
    expect(chain().sentCount).toBe(2);
    expect(chain(SERVER, "agent-2").sentCount).toBe(0);
    expect(chain("host-2", AGENT).sentCount).toBe(0);
  });

  it("clears the count when the user sends their own message", () => {
    useFollowSuggestionChainStore.getState().recordFollowedSuggestion(SERVER, AGENT, 3);
    useFollowSuggestionChainStore.getState().resetChain(SERVER, AGENT);
    expect(chain()).toEqual({ sentCount: 0 });
  });

  it("bounds an unattended chat that keeps suggesting its own next prompt", () => {
    const store = useFollowSuggestionChainStore.getState();
    const sent: string[] = [];
    for (let turn = 0; turn < 25; turn += 1) {
      const decision = decideFollowPromptSuggestion({
        isFollowEnabled: true,
        arePromptSuggestionsEnabled: true,
        suggestion: `keep going ${turn}`,
        draftText: "",
        attachmentCount: 0,
        queuedCount: 0,
        isAgentRunning: false,
        canSubmit: true,
        sentCount: chain().sentCount,
        maxConsecutive: 5,
      });
      if (decision.action !== "send") break;
      store.recordFollowedSuggestion(SERVER, AGENT, decision.sentCount);
      sent.push(decision.prompt);
    }
    expect(sent).toHaveLength(5);
    expect(chain().sentCount).toBe(5);
  });
});
