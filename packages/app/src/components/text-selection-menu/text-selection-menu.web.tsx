import * as Clipboard from "expo-clipboard";
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import type { CSSProperties } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  contextMenuAnchorFromEvent,
} from "@/components/ui/context-menu";
import { Shortcut } from "@/components/ui/shortcut";
import {
  resolveTextSelectionMenuActions,
  type TextSelectionMenuActionId,
} from "./text-selection-menu-model";

type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface TextSelectionSnapshot {
  editableTarget: EditableElement | null;
  selectionText: string;
  selectAllScope: Element | null;
}

interface TextSelectionMenuState {
  anchor: { x: number; y: number };
  beforeStandardActions: ReactNode;
  snapshot: TextSelectionSnapshot;
}

export interface OpenTextSelectionMenuOptions {
  /** Actions rendered above the standard Cut/Copy/Paste/Select all group. */
  beforeStandardActions?: ReactNode;
  /** Limits Select all to this element instead of the complete Otto document. */
  selectAllScope?: Element | null;
}

interface TextSelectionMenuContextValue {
  /**
   * Opens the shared text menu from an owning context menu. This is the hybrid
   * seam: add local actions above the standard group without duplicating its
   * clipboard behavior, enablement, separators, or shortcuts.
   */
  open: (event: unknown, options?: OpenTextSelectionMenuOptions) => boolean;
}

const TextSelectionMenuContext = createContext<TextSelectionMenuContextValue | null>(null);
const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };

function getEventTarget(event: unknown): EventTarget | null {
  if (typeof event !== "object" || event === null) return null;
  const nativeEvent = Reflect.get(event, "nativeEvent");
  const source = typeof nativeEvent === "object" && nativeEvent !== null ? nativeEvent : event;
  const target = Reflect.get(source, "target");
  return target instanceof EventTarget ? target : null;
}

function getTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

function supportsTextSelection(input: HTMLInputElement): boolean {
  return ![
    "button",
    "checkbox",
    "color",
    "date",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
    "time",
  ].includes(input.type);
}

function findEditableTarget(target: EventTarget | null): EditableElement | null {
  const element = getTargetElement(target);
  if (!element) return null;
  const candidate = element.closest("input, textarea, [contenteditable='true']");
  if (candidate instanceof HTMLTextAreaElement) return candidate;
  if (candidate instanceof HTMLInputElement && supportsTextSelection(candidate)) return candidate;
  return candidate instanceof HTMLElement && candidate.isContentEditable ? candidate : null;
}

function getTextControlSelection(target: HTMLInputElement | HTMLTextAreaElement): string {
  const start = target.selectionStart;
  const end = target.selectionEnd;
  return start === null || end === null ? "" : target.value.slice(start, end);
}

function captureTextSelection(
  target: EventTarget | null,
  selectAllScope?: Element | null,
): TextSelectionSnapshot {
  const editableTarget = findEditableTarget(target);
  const selectionText =
    editableTarget instanceof HTMLInputElement || editableTarget instanceof HTMLTextAreaElement
      ? getTextControlSelection(editableTarget)
      : (window.getSelection()?.toString() ?? "");
  const inferredScope = getTargetElement(target)?.closest("[data-otto-text-selection-scope]");
  return {
    editableTarget,
    selectionText,
    selectAllScope: selectAllScope ?? inferredScope ?? document.body,
  };
}

function isHybridTarget(target: EventTarget | null): boolean {
  return getTargetElement(target)?.closest("[data-otto-text-selection-hybrid]") !== null;
}

function isConnected(element: Element | null): element is Element {
  return element !== null && element.isConnected;
}

function replaceEditableSelection(target: EditableElement | null, text: string): void {
  if (!isConnected(target)) return;
  target.focus();

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.setRangeText(text, start, end, "end");
    target.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }),
    );
    return;
  }

  if (document.execCommand("insertText", false, text)) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const inserted = document.createTextNode(text);
  range.insertNode(inserted);
  range.setStartAfter(inserted);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  target.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }),
  );
}

function selectAll(snapshot: TextSelectionSnapshot): void {
  const { editableTarget, selectAllScope } = snapshot;
  if (editableTarget instanceof HTMLInputElement || editableTarget instanceof HTMLTextAreaElement) {
    editableTarget.focus();
    editableTarget.select();
    return;
  }
  if (!isConnected(selectAllScope)) return;
  const range = document.createRange();
  range.selectNodeContents(selectAllScope);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function TextSelectionMenuItems({ snapshot }: { snapshot: TextSelectionSnapshot }) {
  const actions = resolveTextSelectionMenuActions({
    editable: snapshot.editableTarget !== null,
    hasSelection: snapshot.selectionText.length > 0,
    canSelectAll: isConnected(snapshot.selectAllScope),
  });
  const runCopy = useCallback(() => {
    if (!snapshot.selectionText) return;
    void Clipboard.setStringAsync(snapshot.selectionText);
  }, [snapshot.selectionText]);
  const runCut = useCallback(() => {
    if (!snapshot.selectionText || !snapshot.editableTarget) return;
    void Clipboard.setStringAsync(snapshot.selectionText).then(() => {
      replaceEditableSelection(snapshot.editableTarget, "");
      return undefined;
    });
  }, [snapshot.editableTarget, snapshot.selectionText]);
  const runPaste = useCallback(() => {
    if (!snapshot.editableTarget) return;
    void Clipboard.getStringAsync()
      .then((text) => {
        if (text) replaceEditableSelection(snapshot.editableTarget, text);
        return undefined;
      })
      .catch(() => undefined);
  }, [snapshot.editableTarget]);
  const runSelectAll = useCallback(() => selectAll(snapshot), [snapshot]);
  const handlers: Record<TextSelectionMenuActionId, () => void> = {
    cut: runCut,
    copy: runCopy,
    paste: runPaste,
    selectAll: runSelectAll,
  };
  const labels: Record<TextSelectionMenuActionId, string> = {
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    selectAll: "Select all",
  };
  const shortcuts: Record<TextSelectionMenuActionId, ReactElement | null> = {
    cut: <Shortcut keys={["mod", "x"]} />,
    copy: <Shortcut keys={["mod", "c"]} />,
    paste: <Shortcut keys={["mod", "v"]} />,
    selectAll: <Shortcut keys={["mod", "a"]} />,
  };

  return actions.map((action, index) => (
    <Fragment key={action.id}>
      {/* The edit commands form one group and Select all begins the next, as it
          does in the native menu this replaces. */}
      {action.id === "selectAll" && index > 0 ? <ContextMenuSeparator /> : null}
      <ContextMenuItem
        disabled={!action.enabled}
        onSelect={handlers[action.id]}
        trailing={shortcuts[action.id]}
      >
        {labels[action.id]}
      </ContextMenuItem>
    </Fragment>
  ));
}

export function TextSelectionMenuProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<TextSelectionMenuState | null>(null);
  const close = useCallback(() => setState(null), []);
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) close();
    },
    [close],
  );
  const open = useCallback(
    (event: unknown, options: OpenTextSelectionMenuOptions = {}): boolean => {
      const anchor = contextMenuAnchorFromEvent(event);
      if (!anchor) return false;
      setState({
        anchor,
        beforeStandardActions: options.beforeStandardActions ?? null,
        snapshot: captureTextSelection(getEventTarget(event), options.selectAllScope),
      });
      return true;
    },
    [],
  );
  const contextValue = useMemo(() => ({ open }), [open]);

  useEffect(() => {
    const handleSelectionContextMenuCapture = (event: globalThis.MouseEvent) => {
      const target = getEventTarget(event);
      if (isHybridTarget(target)) return;
      const snapshot = captureTextSelection(target);
      // Selection and editable controls take priority over local context menus.
      // A row may still own an unselected right click through the bubble
      // fallback below, but it must never make selected normal UI text lose
      // Copy just because it happened to be inside that row.
      if (snapshot.selectionText.length > 0 || snapshot.editableTarget !== null) {
        open(event);
      }
    };
    const handleContextMenu = (event: globalThis.MouseEvent) => {
      // Specific context menus claim their event. The app-wide fallback owns
      // otherwise-unclaimed text and empty UI, which is how normal UI text
      // stops falling through to Chromium's menu without clobbering a row menu.
      if (!event.defaultPrevented) open(event);
    };
    window.addEventListener("contextmenu", handleSelectionContextMenuCapture, true);
    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("contextmenu", handleSelectionContextMenuCapture, true);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [open]);

  const hasCustomActions = state?.beforeStandardActions !== null;
  return (
    <TextSelectionMenuContext.Provider value={contextValue}>
      {children}
      <ContextMenu
        anchor={state?.anchor ?? null}
        open={state !== null}
        onOpenChange={handleOpenChange}
      >
        <ContextMenuContent side="bottom" align="start" testID="text-selection-context-menu">
          {state?.beforeStandardActions}
          {hasCustomActions ? <ContextMenuSeparator /> : null}
          {state ? <TextSelectionMenuItems snapshot={state.snapshot} /> : null}
        </ContextMenuContent>
      </ContextMenu>
    </TextSelectionMenuContext.Provider>
  );
}

/**
 * Marks a subtree whose right-click handler opens a hybrid menu through
 * useTextSelectionContextMenu(). The root capture listener leaves it alone so
 * the caller can prepend local actions before the standard selection group.
 */
export function TextSelectionMenuHybridScope({ children }: PropsWithChildren) {
  return (
    <div data-otto-text-selection-hybrid="true" style={DISPLAY_CONTENTS}>
      {children}
    </div>
  );
}

export function useTextSelectionContextMenu(): TextSelectionMenuContextValue {
  const context = useContext(TextSelectionMenuContext);
  if (!context) {
    throw new Error("useTextSelectionContextMenu must be used within TextSelectionMenuProvider");
  }
  return context;
}
