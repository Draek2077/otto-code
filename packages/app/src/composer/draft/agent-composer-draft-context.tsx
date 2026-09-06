import { createContext, useContext, type ReactNode } from "react";
import { RewindComposerRestoreProvider } from "@/components/rewind/composer-restore";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useAgentInputDraft, type AgentInputDraft } from "./input-draft";

const AgentComposerDraftContext = createContext<AgentInputDraft | null>(null);

// Keep draft updates below the chat layout while sharing the live composer
// binding with message actions in the sibling transcript.
export function AgentComposerDraftProvider({
  serverId,
  agentId,
  children,
}: {
  serverId: string;
  agentId: string;
  children: ReactNode;
}) {
  const draft = useAgentInputDraft({ draftKey: buildDraftStoreKey({ serverId, agentId }) });
  return (
    <AgentComposerDraftContext.Provider value={draft}>
      <RewindComposerRestoreProvider text={draft.text} setText={draft.setText}>
        {children}
      </RewindComposerRestoreProvider>
    </AgentComposerDraftContext.Provider>
  );
}

export function useAgentComposerDraft(): AgentInputDraft {
  const draft = useContext(AgentComposerDraftContext);
  if (!draft) throw new Error("Agent composer requires its chat draft provider");
  return draft;
}
