import {
  useMemo,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Platform, type StyleProp, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { isNative } from "@/constants/platform";
import { MarkdownTextSpan } from "@/components/markdown-text";
import { MarkdownLinkText } from "@/components/markdown/link-text";
import { AssistantLinkPressProvider, type AssistantLinkPress } from "./link-press-context";
import { LinkHoverTooltip } from "@/components/markdown/link-hover-tooltip";
import { useStableEvent } from "@/hooks/use-stable-event";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { useChatContextMenuTarget } from "@/chat/context-menu";
import { markdownCopyDataSet } from "@/assistant-selection-copy/markup";
import { AssistantLinkContextMenuTarget } from "./link-context-menu";
import { useAssistantFileLinkResolverContext } from "./provider";
import type { AssistantFileLinkSource } from "./resolver";
import { useFileLink, type FileLinkHoverState } from "./use-file-link";

interface AssistantMarkdownLinkProps {
  source: AssistantFileLinkSource;
  style: StyleProp<TextStyle>;
  monoSurface?: boolean;
  children: ReactNode;
}

const MARKDOWN_CODE_LINK_DATASET = {
  ...CODE_SURFACE_DATASET,
  ...markdownCopyDataSet.code,
} as const;

export function AssistantMarkdownLink({
  source,
  style,
  monoSurface,
  children,
}: AssistantMarkdownLinkProps) {
  const { target, hoverState, resolve, onHoverIn, onPress, onAuxPress, open } = useFileLink(source);
  const { configRef } = useAssistantFileLinkResolverContext();
  const chatContextMenu = useChatContextMenuTarget();
  const workspaceRoot = configRef.current.workspaceRoot;
  const handleAnchorClickCapture = useStableEvent((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!isModifiedOpenEvent(event)) {
      return;
    }
    event.stopPropagation();
    onAuxPress();
  });
  const linkPress = useMemo<AssistantLinkPress>(
    () => ({ onPress, accessibilityRole: "link" }),
    [onPress],
  );
  const unwrapForMarkdownCopy = source.sourceType === "inline-code" || source.markup === "linkify";

  if (isNative) {
    // Must be a MarkdownTextSpan, not a plain <Text>: on iOS the link renders
    // inside the paragraph's native UITextView, and a plain <Text> nested there
    // is not hoisted into a UITextViewChild, so its text is silently dropped
    // (the link disappears). The span composes correctly and stays selectable.
    //
    // Tap-to-open: react-native-uitextview only wires onPress onto the *string*
    // children it turns into RNUITextViewChild nodes - the element children that
    // markdown emits for link text pass through untouched, so an onPress placed
    // here never reaches a tappable native node. We thread it down through
    // AssistantLinkPressProvider so each leaf text span re-attaches it to its
    // own string children, where the native tap recognizer can find it. iOS
    // only: Android forwards onPress through nested <Text> already, and web uses
    // the <a> path below.
    const span = (
      <MarkdownTextSpan
        accessibilityRole="link"
        monoSurface={monoSurface}
        onPress={onPress}
        style={style}
      >
        {children}
      </MarkdownTextSpan>
    );
    return Platform.OS === "ios" ? (
      <AssistantLinkPressProvider value={linkPress}>{span}</AssistantLinkPressProvider>
    ) : (
      span
    );
  }

  const anchor = (
    <a
      {...(unwrapForMarkdownCopy ? { "data-otto-markdown-unwrap": "true" } : {})}
      href={source.href}
      title={source.title}
      onClickCapture={handleAnchorClickCapture}
      onAuxClickCapture={preventAnchorNavigation}
      style={LINK_ANCHOR_STYLE}
    >
      <MarkdownLinkText
        dataSet={monoSurface ? MARKDOWN_CODE_LINK_DATASET : undefined}
        style={style}
        onPress={onPress}
        onHoverIn={onHoverIn}
      >
        {children}
      </MarkdownLinkText>
    </a>
  );

  return (
    <AssistantLinkContextMenuTarget
      chatContextMenu={chatContextMenu}
      configRef={configRef}
      source={source}
      target={target}
      resolve={resolve}
      open={open}
      workspaceRoot={workspaceRoot}
    >
      <AssistantLinkHoverTooltip hoverState={hoverState} workspaceRoot={workspaceRoot}>
        {anchor}
      </AssistantLinkHoverTooltip>
    </AssistantLinkContextMenuTarget>
  );
}

interface AssistantMarkdownCodeLinkProps {
  source: AssistantFileLinkSource;
  inheritedStyles: TextStyle;
  codeInlineStyle: TextStyle;
  linkStyle: TextStyle;
  children: ReactNode;
}

export function AssistantMarkdownCodeLink({
  source,
  inheritedStyles,
  codeInlineStyle,
  linkStyle,
  children,
}: AssistantMarkdownCodeLinkProps) {
  const style = useMemo(
    () => [inheritedStyles, codeInlineStyle, linkStyle],
    [inheritedStyles, codeInlineStyle, linkStyle],
  );
  return (
    <AssistantMarkdownLink source={source} style={style} monoSurface>
      {children}
    </AssistantMarkdownLink>
  );
}

function formatInlinePathTargetForTooltip(
  target: { path: string; lineStart?: number; lineEnd?: number },
  workspaceRoot: string | undefined,
): string {
  let result = relativizePathToWorkspace(target.path, workspaceRoot);
  if (target.lineStart) {
    result += `:${target.lineStart}`;
    if (target.lineEnd && target.lineEnd !== target.lineStart) {
      result += `-${target.lineEnd}`;
    }
  }
  return result;
}

function relativizePathToWorkspace(filePath: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) {
    return filePath;
  }
  const root = workspaceRoot.replace(/\/+$/, "");
  if (!root) {
    return filePath;
  }
  if (filePath === root) {
    return ".";
  }
  const prefix = `${root}/`;
  if (filePath.startsWith(prefix)) {
    return filePath.slice(prefix.length);
  }
  return filePath;
}

interface AssistantInlineCodePathLinkProps {
  content: string;
  inheritedStyles: TextStyle;
  codeInlineStyle: TextStyle;
  linkStyle: TextStyle;
}

export function AssistantInlineCodePathLink({
  content,
  inheritedStyles,
  codeInlineStyle,
  linkStyle,
}: AssistantInlineCodePathLinkProps) {
  const source = useMemo<AssistantFileLinkSource>(
    () => ({
      href: content,
      text: content,
      sourceType: "inline-code",
    }),
    [content],
  );

  return (
    <AssistantMarkdownCodeLink
      source={source}
      inheritedStyles={inheritedStyles}
      codeInlineStyle={codeInlineStyle}
      linkStyle={linkStyle}
    >
      {content}
    </AssistantMarkdownCodeLink>
  );
}

const FILE_LINK_TOOLTIP_MOD_KEYS = ["mod"];

function AssistantLinkHoverTooltip({
  hoverState,
  workspaceRoot,
  children,
}: {
  hoverState: FileLinkHoverState;
  workspaceRoot: string | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <LinkHoverTooltip {...getHoverTooltipProps(hoverState, workspaceRoot, t)}>
      {children}
    </LinkHoverTooltip>
  );
}

function getHoverTooltipProps(
  hoverState: FileLinkHoverState,
  workspaceRoot: string | undefined,
  t: TFunction,
): Omit<ComponentProps<typeof LinkHoverTooltip>, "children"> {
  switch (hoverState.kind) {
    case "file":
      return {
        label: formatInlinePathTargetForTooltip(hoverState.target, workspaceRoot),
        hint: t("common.linkTooltip.modClickOpenInPlace"),
        hintKeys: FILE_LINK_TOOLTIP_MOD_KEYS,
      };
    case "external":
      return { label: hoverState.url, hint: t("common.linkTooltip.clickToOpen") };
    case "resolving":
      return { label: hoverState.token, hint: t("common.linkTooltip.findingFile") };
    case "unresolved":
      return {
        label: hoverState.token,
        hint: t("common.linkTooltip.fileNotFound"),
        hintTone: "error",
      };
    case "unopenable":
      return {
        label: hoverState.href,
        hint: t("common.linkTooltip.cannotOpen"),
        hintTone: "error",
      };
  }
}

const LINK_ANCHOR_STYLE: CSSProperties = {
  display: "contents",
  color: "inherit",
  textDecoration: "none",
};

function preventAnchorNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
}

function isModifiedOpenEvent(event: MouseEvent<HTMLElement>): boolean {
  return event.metaKey || event.ctrlKey;
}
