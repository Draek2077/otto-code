import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { clampWidgetHeight, type WidgetGuestMessage } from "@otto-code/protocol/widgets/bridge";
import { buildWidgetDocument } from "@otto-code/protocol/widgets/document";
import type { WidgetThemeInput } from "@otto-code/protocol/widgets/theme";
import type { WidgetPayload } from "@otto-code/protocol/widgets/types";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useAssistantFileLinkActions } from "@/assistant-file-links/use-file-link";
import type { Theme } from "@/styles/theme";
import { WidgetFrame } from "./widget-frame";
import { buildWidgetTheme } from "./widget-theme";
import { useWidgetPromptStore } from "./prompt-store";
import { useWidgetChatTarget } from "./widget-chat-context";

/**
 * A widget, rendered inline in the transcript at its tool call's position.
 *
 * Deliberately chrome-less. A widget is the model's own illustration of what it
 * is saying, not a card the user files somewhere - a border and a header with a
 * snake_case title would frame a thought as a document. Chrome appears only
 * when there is something to say: while the fragment is still arriving, and
 * when it failed.
 */

const LOADING_MESSAGE_INTERVAL_MS = 1_600;
const INITIAL_HEIGHT_PX = 120;
/** Ceiling on a phone before the widget is collapsed behind a "show more". */
const COMPACT_MAX_HEIGHT_PX = 420;

interface WidgetDocumentFrameProps {
  payload: WidgetPayload;
  height: number;
  onGuestMessage: (message: WidgetGuestMessage) => void;
  /** Injected by withUnistyles - the live theme, as concrete values. */
  widgetTheme?: WidgetThemeInput;
}

function WidgetDocumentFrame({
  payload,
  height,
  onGuestMessage,
  widgetTheme,
}: WidgetDocumentFrameProps) {
  const html = useMemo(
    () => (widgetTheme ? buildWidgetDocument({ payload, theme: widgetTheme }) : null),
    [payload, widgetTheme],
  );
  if (!html) {
    return null;
  }
  return (
    <WidgetFrame
      html={html}
      widgetId={payload.id}
      height={height}
      onGuestMessage={onGuestMessage}
    />
  );
}

// The one leaf that needs concrete theme values rather than a style object:
// the guest document has its own `:root` and cannot read the host's cascade.
// Wrapping here means a theme switch re-skins mounted widgets without
// re-rendering the transcript around them.
const ThemedWidgetFrame = withUnistyles(WidgetDocumentFrame, (theme: Theme) => ({
  widgetTheme: buildWidgetTheme(theme),
}));

export interface WidgetCardProps {
  payload: WidgetPayload;
}

export const WidgetCard = memo(function WidgetCard({ payload }: WidgetCardProps) {
  const { serverId, agentId } = useWidgetChatTarget();
  const [height, setHeight] = useState(INITIAL_HEIGHT_PX);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const isCompact = useIsCompactFormFactor();
  const toast = useToast();
  const fileLinkActions = useAssistantFileLinkActions();
  const sendPrompt = useWidgetPromptStore((state) => state.sendPrompt);

  // Read through a ref so the guest-message handler stays stable: it is handed
  // to a WebView/iframe that would otherwise re-attach on every render.
  const handlersRef = useRef({ toast, fileLinkActions, sendPrompt, serverId, agentId });
  handlersRef.current = { toast, fileLinkActions, sendPrompt, serverId, agentId };

  const handleGuestMessage = useCallback((message: WidgetGuestMessage) => {
    const {
      toast: t,
      fileLinkActions: links,
      sendPrompt: send,
      serverId: sid,
      agentId: aid,
    } = handlersRef.current;
    switch (message.type) {
      case "height":
        setHeight(clampWidgetHeight(message.px));
        return;
      case "open_link":
        // The same path a markdown link takes, so a widget link gets the
        // confirmation and file-vs-web routing every other chat link gets.
        links.open({ href: message.url }, "main");
        return;
      case "prompt": {
        if (!sid || !aid) {
          return;
        }
        const result = send({
          target: { serverId: sid, agentId: aid },
          widgetId: message.widgetId,
          text: message.text,
        });
        if (result === "rate-limited" || result === "exhausted") {
          t.error("This widget has sent too many messages.");
        } else if (result === "too-long") {
          t.error("That message from the widget was too long to send.");
        }
        return;
      }
      case "error":
        // Never a blank box: a fragment whose script threw says so.
        setRenderError(message.message);
        return;
    }
  }, []);

  const isPending = payload.code.length === 0;
  const loadingMessage = useLoadingMessage(payload.loadingMessages, isPending);

  const isClamped = isCompact && !isExpanded && height > COMPACT_MAX_HEIGHT_PX;
  const renderedHeight = isClamped ? COMPACT_MAX_HEIGHT_PX : height;

  const handleExpand = useCallback(() => setIsExpanded(true), []);

  if (isPending) {
    return (
      <View style={styles.pending} testID="widget-pending">
        <Text style={styles.pendingText}>{loadingMessage}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="widget-card">
      <View style={isClamped ? styles.clamp : undefined}>
        <ThemedWidgetFrame
          payload={payload}
          height={renderedHeight}
          onGuestMessage={handleGuestMessage}
        />
      </View>
      {isClamped ? (
        <Pressable onPress={handleExpand} style={styles.expandButton} testID="widget-expand">
          <Text style={styles.expandText}>Show full widget</Text>
        </Pressable>
      ) : null}
      {payload.truncated ? (
        <Text style={styles.noticeText}>This widget was too large and was cut short.</Text>
      ) : null}
      {renderError ? (
        <Text style={styles.errorText} testID="widget-error">
          {renderError}
        </Text>
      ) : null}
    </View>
  );
});

/** Cycle the model's loading messages while the fragment is still arriving. */
function useLoadingMessage(messages: readonly string[], isPending: boolean): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!isPending || messages.length <= 1) {
      return;
    }
    const timer = setInterval(() => {
      setIndex((previous) => (previous + 1) % messages.length);
    }, LOADING_MESSAGE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isPending, messages.length]);

  return messages[index % Math.max(1, messages.length)] ?? "Drawing…";
}

const styles = StyleSheet.create((theme) => ({
  container: {
    marginVertical: theme.spacing[3],
    width: "100%",
  },
  clamp: {
    overflow: "hidden",
    maxHeight: COMPACT_MAX_HEIGHT_PX,
  },
  expandButton: {
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    marginTop: theme.spacing[2],
    borderRadius: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  expandText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  pending: {
    marginVertical: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  pendingText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontStyle: "italic",
  },
  noticeText: {
    marginTop: theme.spacing[2],
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    marginTop: theme.spacing[2],
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
}));
