import { useEffect } from "react";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { useWidgetPromptStore } from "./prompt-store";

interface WidgetComposerDraft {
  serverId: string;
  agentId: string;
  writable: boolean;
  textSource: { getSnapshot(): string };
  replaceText(text: string): void;
}

/** Guest actions stage text in the focused chat's draft. Normal Send owns dispatch. */
export function useWidgetComposerDraft(input: WidgetComposerDraft) {
  const { serverId, agentId, writable, textSource, replaceText } = input;
  const { isActiveComposer } = useComposerKeyboardScope();
  useEffect(() => {
    if (!writable || !isActiveComposer || !serverId || !agentId) return;
    return useWidgetPromptStore.getState().registerSender({ serverId, agentId }, (suggested) => {
      const current = textSource.getSnapshot();
      replaceText(current ? current + "\n\n" + suggested : suggested);
    });
  }, [serverId, agentId, writable, isActiveComposer, textSource, replaceText]);
}
