import { useCallback, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useToast } from "@/contexts/toast-context";
import { usePaneContext } from "@/panels/pane-context";
import { useDraftStore } from "@/stores/draft-store";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import type { EditorController, EditorSelection } from "./editor-contract";
import type { RefactorDialogScope } from "./refactor-dialog";
import { buildRefactorPrompt } from "./refactor-prompt";

export interface UseAiRefactorInput {
  serverId: string;
  path: string;
  controllerRef: RefObject<EditorController | null>;
}

export interface UseAiRefactorResult {
  dialogVisible: boolean;
  dialogScope: RefactorDialogScope | null;
  openRefactor: () => Promise<void>;
  closeRefactor: () => void;
  confirmRefactor: (instruction: string) => void;
}

/**
 * AI Refactor entry from the editor. Reads the current selection for scope,
 * then — on confirm — composes a scope-guarded prompt and opens a *pre-filled
 * draft* so the change goes through the proven composer/agent-creation path
 * (the user reviews provider/model and sends). Deliberately does not spawn an
 * agent directly: that keeps the central agent flow untouched.
 */
export function useAiRefactor(input: UseAiRefactorInput): UseAiRefactorResult {
  const { serverId, path, controllerRef } = input;
  const { t } = useTranslation();
  const toast = useToast();
  const { openTab } = usePaneContext();
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogScope, setDialogScope] = useState<RefactorDialogScope | null>(null);

  const openRefactor = useCallback(async () => {
    const controller = controllerRef.current;
    let selection: EditorSelection;
    try {
      selection = controller
        ? await controller.getSelection()
        : { text: "", lineStart: 1, lineEnd: 1, isEmpty: true };
    } catch (error) {
      toast.error(getErrorMessage(error));
      return;
    }
    setDialogScope({ path, selection });
    setDialogVisible(true);
  }, [controllerRef, path, toast]);

  const closeRefactor = useCallback(() => {
    setDialogVisible(false);
  }, []);

  const confirmRefactor = useCallback(
    (instruction: string) => {
      const scope = dialogScope;
      if (!scope) {
        return;
      }
      const selection = scope.selection;
      const hasRange = !selection.isEmpty;
      const prompt = buildRefactorPrompt({
        scope: {
          path: scope.path,
          lineStart: hasRange ? selection.lineStart : null,
          lineEnd: hasRange ? selection.lineEnd : null,
          selectedCode: hasRange ? selection.text : null,
        },
        instruction,
      });
      const draftId = generateDraftId();
      // Seed the draft under the exact key the draft composer hydrates from
      // (see workspace-tab.tsx). draftId wins over agentId in the key.
      useDraftStore.getState().saveDraftInput({
        draftKey: buildDraftStoreKey({ serverId, agentId: draftId, draftId }),
        draft: { text: prompt, attachments: [] },
      });
      setDialogVisible(false);
      openTab({ kind: "draft", draftId });
      toast.show(t("refactor.draftOpened"));
    },
    [dialogScope, openTab, serverId, t, toast],
  );

  return { dialogVisible, dialogScope, openRefactor, closeRefactor, confirmRefactor };
}
