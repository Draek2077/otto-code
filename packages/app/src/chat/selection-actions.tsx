import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { MenuSubTrigger } from "@/components/ui/menu";
import type { TextSelectionActionsResolver } from "@/components/text-selection-menu/text-selection-menu";
import { getChatPromptSender, type ChatPromptTarget } from "@/composer/chat-prompt-sender";
import {
  CHAT_SELECTION_ACTIONS,
  buildChatSelectionPrompt,
  normalizeChatSelection,
  type ChatSelectionAction,
} from "./selection-prompt";

const CHAT_SELECTION_PAGE_ID = "chatSelectionActions";

/**
 * This content renders in the root text-selection menu, a sibling of the
 * transcript, so it takes everything it needs as props (docs/menus.md).
 */
function ChatSelectionActionItem({
  action,
  selection,
  serverId,
  agentId,
}: ChatPromptTarget & { action: ChatSelectionAction; selection: string }): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    const prompt = buildChatSelectionPrompt({
      instruction: t(`message.selectionActions.${action}.prompt`),
      selection,
    });
    if (!prompt) return;
    // Resolved at click time: the composer re-registers as the turn state
    // changes, and only the current sender knows what Enter would do now.
    getChatPromptSender({ serverId, agentId })?.(prompt);
  }, [action, agentId, selection, serverId, t]);

  return (
    <ContextMenuItem
      description={t(`message.selectionActions.${action}.description`)}
      onSelect={handleSelect}
      testID={`chat-selection-${action}`}
    >
      {t(`message.selectionActions.${action}.label`)}
    </ContextMenuItem>
  );
}

/**
 * Adds the Chat submenu (Explain, Contest, Research, Complete) above the
 * standard selection actions for text selected in this chat's transcript.
 */
export function useChatSelectionActionsResolver({
  serverId,
  agentId,
}: ChatPromptTarget): TextSelectionActionsResolver {
  const { t } = useTranslation();
  return useCallback(
    ({ selectionText }) => {
      const selection = normalizeChatSelection(selectionText);
      if (!selection || !getChatPromptSender({ serverId, agentId })) return null;
      const title = t("message.selectionActions.menu");
      return {
        beforeStandardActions: (
          <MenuSubTrigger id={CHAT_SELECTION_PAGE_ID} testID="chat-selection-actions">
            {title}
          </MenuSubTrigger>
        ),
        pages: [
          {
            id: CHAT_SELECTION_PAGE_ID,
            title,
            content: CHAT_SELECTION_ACTIONS.map((action) => (
              <ChatSelectionActionItem
                key={action}
                action={action}
                selection={selection}
                serverId={serverId}
                agentId={agentId}
              />
            )),
          },
        ],
      };
    },
    [agentId, serverId, t],
  );
}
