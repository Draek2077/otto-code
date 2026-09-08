import * as Clipboard from "expo-clipboard";
import React, {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { getDesktopHost } from "@/desktop/host";
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
  spellcheckContext: SpellcheckContextSnapshot | null;
}

interface SpellcheckContextSnapshot {
  token: string;
  x: number;
  y: number;
  suggestions: string[];
  canAddToDictionary: boolean;
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
const SPELLCHECK_CONTEXT_TTL_MS = 30_000;

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

function readSpellcheckContext(input: unknown): SpellcheckContextSnapshot | null {
  if (typeof input !== "object" || input === null) return null;
  const token = Reflect.get(input, "token");
  const x = Reflect.get(input, "x");
  const y = Reflect.get(input, "y");
  const suggestions = Reflect.get(input, "suggestions");
  const canAddToDictionary = Reflect.get(input, "canAddToDictionary");
  if (
    typeof token !== "string" ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Array.isArray(suggestions) ||
    !suggestions.every((suggestion) => typeof suggestion === "string") ||
    typeof canAddToDictionary !== "boolean"
  ) {
    return null;
  }
  return { token, x, y, suggestions, canAddToDictionary };
}

function isSpellcheckContextAtAnchor(
  context: SpellcheckContextSnapshot,
  anchor: { x: number; y: number },
): boolean {
  // Electron and React Native Web report the same content-space coordinates,
  // but tolerate sub-pixel rounding at a non-100% desktop zoom.
  return Math.abs(context.x - anchor.x) <= 2 && Math.abs(context.y - anchor.y) <= 2;
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

function SpellcheckSuggestionMenuItem({
  suggestion,
  onReplace,
}: {
  suggestion: string;
  onReplace: (suggestion: string) => void;
}) {
  const handleSelect = useCallback(() => onReplace(suggestion), [onReplace, suggestion]);
  return <ContextMenuItem onSelect={handleSelect}>{suggestion}</ContextMenuItem>;
}

function SpellcheckMenuItems({ context }: { context: SpellcheckContextSnapshot }) {
  const runReplace = useCallback(
    (suggestion: string) => {
      void getDesktopHost()?.menu?.applySpellcheckAction?.({
        token: context.token,
        kind: "replace",
        suggestion,
      });
    },
    [context.token],
  );
  const runAddToDictionary = useCallback(() => {
    void getDesktopHost()?.menu?.applySpellcheckAction?.({
      token: context.token,
      kind: "add-to-dictionary",
    });
  }, [context.token]);

  return (
    <>
      {context.suggestions.length > 0 ? (
        context.suggestions.map((suggestion) => (
          <SpellcheckSuggestionMenuItem
            key={suggestion}
            suggestion={suggestion}
            onReplace={runReplace}
          />
        ))
      ) : (
        <ContextMenuItem disabled>No suggestions</ContextMenuItem>
      )}
      {context.canAddToDictionary ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={runAddToDictionary}>Add to Dictionary</ContextMenuItem>
        </>
      ) : null}
      <ContextMenuSeparator />
    </>
  );
}

export function TextSelectionMenuProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<TextSelectionMenuState | null>(null);
  const pendingSpellcheckContext = useRef<{
    context: SpellcheckContextSnapshot;
    receivedAt: number;
  } | null>(null);
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
      const snapshot = captureTextSelection(getEventTarget(event), options.selectAllScope);
      const pending = pendingSpellcheckContext.current;
      const spellcheckContext =
        snapshot.editableTarget !== null &&
        pending !== null &&
        Date.now() - pending.receivedAt <= SPELLCHECK_CONTEXT_TTL_MS &&
        isSpellcheckContextAtAnchor(pending.context, anchor)
          ? pending.context
          : null;
      setState({
        anchor,
        beforeStandardActions: options.beforeStandardActions ?? null,
        snapshot,
        spellcheckContext,
      });
      return true;
    },
    [],
  );
  const contextValue = useMemo(() => ({ open }), [open]);

  useEffect(() => {
    const handleSelectionContextMenuCapture = (event: globalThis.MouseEvent) => {
      const target = getEventTarget(event);
      if (
        isHybridTarget(target) ||
        getTargetElement(target)?.closest("[data-otto-editor-context-menu]")
      )
        return;
      const snapshot = captureTextSelection(target);
      // Selection and editable controls take priority over local context menus,
      // except editors that supply their own selection and editing actions.
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

  useEffect(() => {
    const onSpellcheckContext = (input: unknown) => {
      const context = readSpellcheckContext(input);
      if (!context) return;
      pendingSpellcheckContext.current = { context, receivedAt: Date.now() };
      setState((current) => {
        if (
          !current?.snapshot.editableTarget ||
          !isSpellcheckContextAtAnchor(context, current.anchor)
        ) {
          return current;
        }
        return { ...current, spellcheckContext: context };
      });
    };
    const subscribe = getDesktopHost()?.events?.on;
    if (!subscribe) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void Promise.resolve(subscribe("spellcheck-context", onSpellcheckContext))
      .then((nextUnsubscribe) => {
        if (disposed) {
          nextUnsubscribe();
          return undefined;
        }
        unsubscribe = nextUnsubscribe;
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

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
          {state?.spellcheckContext ? (
            <SpellcheckMenuItems context={state.spellcheckContext} />
          ) : null}
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
