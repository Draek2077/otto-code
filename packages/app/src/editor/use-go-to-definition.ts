import { useCallback, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { DefinitionCandidate } from "./definition-picker-dialog";
import { planDefinitionJump, type DefinitionJumpTarget } from "./definition-jump";
import type { EditorCursorPosition } from "./editor-contract";
import { getErrorMessage } from "@otto-code/protocol/error-utils";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import type { EditorController } from "./editor-contract";

/**
 * Handed to `onOpenTarget` already canonicalized: workspace-relative when the
 * definition lives inside the workspace, absolute when it does not.
 */
export type GoToDefinitionTarget = DefinitionJumpTarget;

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
  /**
   * Whether the host can answer `code.definition`. When it can, the position-based
   * lookup is tried first and the ctags index is reached for only when the host has
   * no language server for this file.
   * COMPAT(lsp): added in v0.6.8, drop the gate when daemon floor >= v0.6.8.
   */
  lspEnabled: boolean;
  /** Latest caret position, already tracked for the status bar. */
  cursor: EditorCursorPosition | null;
}

export interface UseGoToDefinitionResult {
  /** A lookup is in flight; the toolbar button shows a spinner. */
  running: boolean;
  /** The name that produced `candidates`, for the picker's title. */
  pickerName: string;
  /** Non-empty only while the multi-hit picker is open. */
  candidates: DefinitionCandidate[];
  goToDefinition: () => Promise<void>;
  closePicker: () => void;
  selectCandidate: (candidate: DefinitionCandidate) => void;
}

/**
 * Go to definition, with two sources and a deliberate order.
 *
 * **A language server first, by position.** When the host can answer
 * `code.definition`, the buffer is mirrored and the caret's position is resolved in
 * context — which `foo` this `foo` means. Its three-valued answer is respected:
 * `indexing` says "ask again in a moment", and only `unavailable` (no server for
 * this language on the host) falls through.
 *
 * **The ctags index second, by name.** Not a compatibility shim — it is the designed
 * answer for the languages no server covers, and it is honest about what it is.
 *
 * Either way, the result set means the same thing:
 *
 * - **one hit** jumps straight there — inside the buffer when it is this file,
 *   otherwise by opening the target file at that line;
 * - **several hits** open a picker. From ctags that is name collision; from a
 *   language server it is real overloads or implementations. Guessing would be
 *   dishonest, so the choice is the user's;
 * - **no hits** is an ordinary outcome, not a failure — a plain toast, never an
 *   error tone.
 */
export function useGoToDefinition(input: UseGoToDefinitionInput): UseGoToDefinitionResult {
  const { serverId, workspaceRoot, path, controllerRef, onJumpInFile, onOpenTarget } = input;
  // Read through a ref so a caret move does not rebuild `goToDefinition` on every
  // keystroke, and so the action always sees the newest position.
  const cursorRef = useRef(input.cursor);
  cursorRef.current = input.cursor;
  const lspEnabledRef = useRef(input.lspEnabled);
  lspEnabledRef.current = input.lspEnabled;
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [running, setRunning] = useState(false);
  const [candidates, setCandidates] = useState<DefinitionCandidate[]>([]);
  const [pickerName, setPickerName] = useState("");
  // A second invocation while the first is still in flight would race two jumps
  // against each other; the index build behind a cold lookup is slow enough for
  // that to be a real double-press, not a theoretical one.
  const inFlightRef = useRef(false);

  const jumpTo = useCallback(
    (target: GoToDefinitionTarget) => {
      // The two sources answer in two path shapes, and the open tab's own path is
      // a third — see planDefinitionJump, which canonicalizes all of them so a
      // definition in this very buffer is never opened as a second tab.
      const plan = planDefinitionJump({ target, openPath: path, workspaceRoot });
      if (plan.kind === "in-file") {
        onJumpInFile(plan.line);
        return;
      }
      onOpenTarget(plan.target);
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

      const cursor = cursorRef.current;
      if (lspEnabledRef.current && cursor) {
        // Mirror the buffer before asking, so the answer accounts for unsaved edits
        // rather than whatever is on disk.
        await client.syncCodeDocument(workspaceRoot, path, await controller.getDoc());
        const result = await client.findCodeDefinition({
          cwd: workspaceRoot,
          path,
          line: cursor.line,
          column: cursor.column,
        });

        if (result.status === "indexing") {
          toast.show(t("goToDefinition.indexing"));
          return;
        }
        if (result.status === "ok") {
          if (result.locations.length === 0) {
            toast.show(t("goToDefinition.notFound", { name: word }));
            return;
          }
          if (result.locations.length === 1) {
            jumpTo(result.locations[0]);
            return;
          }
          setPickerName(word);
          setCandidates(
            result.locations.map((location) => ({
              path: location.path,
              line: location.line,
              column: location.column,
              source: location.serverId,
            })),
          );
          return;
        }
        // `unavailable`: no server for this language on the host. Fall through to the
        // name-based index, which is what it is now for.
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
      // Label the name-index rows too, so the picker never leaves the user guessing
      // which source produced a list.
      const indexSource = t("goToDefinition.indexSource");
      setCandidates(
        locations.map((location) => ({
          path: location.path,
          line: location.line,
          column: location.column,
          kind: location.kind,
          source: indexSource,
        })),
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      inFlightRef.current = false;
      setRunning(false);
    }
  }, [client, controllerRef, jumpTo, path, t, toast, workspaceRoot]);

  const closePicker = useCallback(() => {
    setCandidates([]);
    setPickerName("");
  }, []);

  const selectCandidate = useCallback(
    (candidate: DefinitionCandidate) => {
      closePicker();
      jumpTo({ path: candidate.path, line: candidate.line });
    },
    [closePicker, jumpTo],
  );

  return { running, pickerName, candidates, goToDefinition, closePicker, selectCandidate };
}
