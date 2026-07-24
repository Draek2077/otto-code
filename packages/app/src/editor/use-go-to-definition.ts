import { useCallback, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { CodeSymbolLocation } from "@otto-code/client/internal/daemon-client";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import type { EditorController } from "./editor-contract";

export interface GoToDefinitionTarget {
  path: string;
  line: number;
}

export interface UseGoToDefinitionInput {
  serverId: string;
  workspaceRoot: string;
  /** The file the editor is showing; may be workspace-relative or absolute. */
  path: string;
  controllerRef: RefObject<EditorController | null>;
  /** The definition is in the open buffer — move the caret, don't open a tab. */
  onJumpInFile: (line: number) => void;
  /** The definition is in another file — open it at that line. */
  onOpenTarget: (target: GoToDefinitionTarget) => void;
}

export interface UseGoToDefinitionResult {
  /** A lookup is in flight; the toolbar button shows a spinner. */
  running: boolean;
  /** The name that produced `candidates`, for the picker's title. */
  pickerName: string;
  /** Non-empty only while the multi-hit picker is open. */
  candidates: CodeSymbolLocation[];
  goToDefinition: () => Promise<void>;
  closePicker: () => void;
  selectCandidate: (candidate: CodeSymbolLocation) => void;
}

/**
 * Go to definition, name-based. The daemon owns the symbol index (`code.symbols`
 * behind `features.codeIndex`); this hook contributes the word under the caret
 * and decides what a result set means:
 *
 * - **one hit** jumps straight there — inside the buffer when it is this file,
 *   otherwise by opening the target file at that line;
 * - **several hits** open a picker, because the index is name-based with no type
 *   resolution. Guessing would be dishonest, so the choice is the user's;
 * - **no hits** is an ordinary outcome, not a failure — a plain toast, never an
 *   error tone. Half the codebase is symbols the ctags-style walker never sees.
 */
export function useGoToDefinition(input: UseGoToDefinitionInput): UseGoToDefinitionResult {
  const { serverId, workspaceRoot, path, controllerRef, onJumpInFile, onOpenTarget } = input;
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [running, setRunning] = useState(false);
  const [candidates, setCandidates] = useState<CodeSymbolLocation[]>([]);
  const [pickerName, setPickerName] = useState("");
  // A second invocation while the first is still in flight would race two jumps
  // against each other; the index build behind a cold lookup is slow enough for
  // that to be a real double-press, not a theoretical one.
  const inFlightRef = useRef(false);

  const jumpTo = useCallback(
    (target: GoToDefinitionTarget) => {
      // The daemon reports workspace-relative paths, while the open file's own
      // path may be absolute (an out-of-project tab). Compare against both forms
      // so a definition in this very buffer is never opened as a second tab.
      const relativePath = resolveWorkspaceFilePaths({ path, workspaceRoot })?.relativePath ?? null;
      if (target.path === path || target.path === relativePath) {
        onJumpInFile(target.line);
        return;
      }
      onOpenTarget(target);
    },
    [onJumpInFile, onOpenTarget, path, workspaceRoot],
  );

  const goToDefinition = useCallback(async () => {
    if (inFlightRef.current || !client) {
      return;
    }
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    inFlightRef.current = true;
    setRunning(true);
    try {
      const word = await controller.getWordAtCursor();
      if (!word) {
        toast.show(t("goToDefinition.noSymbol"));
        return;
      }
      const locations = await client.findCodeSymbols(workspaceRoot, word);
      if (locations.length === 0) {
        toast.show(t("goToDefinition.notFound", { name: word }));
        return;
      }
      if (locations.length === 1) {
        jumpTo(locations[0]);
        return;
      }
      setPickerName(word);
      setCandidates(locations);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      inFlightRef.current = false;
      setRunning(false);
    }
  }, [client, controllerRef, jumpTo, t, toast, workspaceRoot]);

  const closePicker = useCallback(() => {
    setCandidates([]);
    setPickerName("");
  }, []);

  const selectCandidate = useCallback(
    (candidate: CodeSymbolLocation) => {
      closePicker();
      jumpTo({ path: candidate.path, line: candidate.line });
    },
    [closePicker, jumpTo],
  );

  return { running, pickerName, candidates, goToDefinition, closePicker, selectCandidate };
}
