import React, { memo, useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings } from "@/hooks/use-settings";
import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import {
  collectAssistantTurnContentForStreamRenderStrategy,
  type StreamStrategy,
} from "./strategy";
import { resolveAssistantTurnBoundaryMessageId } from "./turn-boundary";
import { useAssistantBubbleWidth } from "./assistant-turn-width";
import { AssistantTurnFooter, LiveElapsed, type AssistantForkTarget } from "@/components/message";
import type { TurnFooterHost } from "./layout";
import { BlobLoader, ThemedBlobLoader } from "@/components/blob-loader";
import { useRetainedPanelActive } from "@/components/retained-panel";

/** Two glow colors for an agent's personality thinking spinner. */
export interface PersonalitySpinnerColors {
  glowA: string;
  glowB: string;
}

export type TurnContentStrategy = StreamStrategy;
export type AssistantTurnForkHandler = (input: {
  target: AssistantForkTarget;
  boundaryMessageId?: string;
}) => Promise<void> | void;

export const TurnFooter = memo(function TurnFooter({
  isRunning,
  inFlightTurnStartedAt,
  inFlightEstimatedTokens,
  host,
  strategy,
  onForkAssistantTurn,
  spinner,
  serverId,
  agentId,
}: {
  isRunning: boolean;
  inFlightTurnStartedAt: Date | null;
  inFlightEstimatedTokens?: number | null;
  host: TurnFooterHost | null;
  strategy: TurnContentStrategy;
  onForkAssistantTurn?: AssistantTurnForkHandler;
  spinner?: PersonalitySpinnerColors;
  serverId?: string;
  agentId?: string;
}) {
  if (isRunning) {
    return (
      <TurnFooterRow>
        <RunningTurnFooter
          inFlightTurnStartedAt={inFlightTurnStartedAt}
          estimatedTokens={inFlightEstimatedTokens ?? null}
          spinner={spinner}
        />
      </TurnFooterRow>
    );
  }
  if (!host) {
    return null;
  }
  return (
    <CompletedTurnFooterRow
      strategy={strategy}
      items={host.items}
      timing={host.timing}
      startIndex={host.startIndex}
      onForkAssistantTurn={onForkAssistantTurn}
      serverId={serverId}
      agentId={agentId}
    />
  );
});

// Completed-turn details honor the hide-until-hover appearance setting. The
// running-turn footer never hides (see TurnFooter above). `revealed` lets a
// wider hover scope (the turn's content in the stream) reveal the row; the
// row additionally tracks hover on its own full-width strip so the bottom
// auxiliary footer — which has no adjacent stream item — stays reachable.
// Hidden state uses opacity so the strip keeps its geometry and stays
// hoverable (docs/hover.md), with pointerEvents off so invisible buttons
// can't be clicked.
export const CompletedTurnFooterRow = memo(function CompletedTurnFooterRow({
  strategy,
  items,
  timing,
  startIndex,
  onForkAssistantTurn,
  revealed = false,
  serverId,
  agentId,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
  onForkAssistantTurn?: AssistantTurnForkHandler;
  revealed?: boolean;
  serverId?: string;
  agentId?: string;
}) {
  const hideDetails = useAppSettings().settings.hideChatMessageDetails;
  const isCompact = useIsCompactFormFactor();
  const [selfHovered, setSelfHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setSelfHovered(true), []);
  const handlePointerLeave = useCallback(() => setSelfHovered(false), []);
  const visible = !hideDetails || isNative || isCompact || revealed || selfHovered;

  return (
    <TurnFooterRow>
      <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
        <View
          style={visible ? stylesheet.footerReveal : stylesheet.footerRevealHidden}
          pointerEvents={visible ? "auto" : "none"}
        >
          <CompletedTurnFooter
            strategy={strategy}
            items={items}
            timing={timing}
            startIndex={startIndex}
            onForkAssistantTurn={onForkAssistantTurn}
            serverId={serverId}
            agentId={agentId}
          />
        </View>
      </View>
    </TurnFooterRow>
  );
});

// The spinner is memo-isolated: BlobLoader recreates reanimated styles and an
// SVG gradient tree on every render, so it must not re-render when the token
// estimate ticks or the agent snapshot rebuilds the spinner object — only
// when the personality's glow colors actually change (hence value equality).
const TurnSpinner = memo(
  function TurnSpinner({ spinner }: { spinner?: PersonalitySpinnerColors }) {
    return (
      <View style={stylesheet.workingLoader}>
        {spinner ? (
          <BlobLoader size={18} glowA={spinner.glowA} glowB={spinner.glowB} />
        ) : (
          <ThemedBlobLoader size={18} />
        )}
      </View>
    );
  },
  (prev, next) =>
    prev.spinner?.glowA === next.spinner?.glowA && prev.spinner?.glowB === next.spinner?.glowB,
);

const WorkingIndicator = memo(function WorkingIndicator({
  inFlightTurnStartedAt = null,
  estimatedTokens = null,
  spinner,
}: {
  inFlightTurnStartedAt?: Date | null;
  estimatedTokens?: number | null;
  spinner?: PersonalitySpinnerColors;
}) {
  const active = useRetainedPanelActive();
  return (
    <View style={stylesheet.turnFooterContent}>
      <TurnSpinner spinner={spinner} />
      {inFlightTurnStartedAt ? (
        <LiveElapsed
          startedAt={inFlightTurnStartedAt}
          active={active}
          style={stylesheet.workingElapsed}
          testID="turn-working-elapsed"
        />
      ) : null}
      {inFlightTurnStartedAt && estimatedTokens !== null && estimatedTokens > 0 ? (
        <Text style={stylesheet.workingTokens} testID="turn-working-tokens">
          {`• ~${formatTokenCount(estimatedTokens)} tokens`}
        </Text>
      ) : null}
    </View>
  );
});

function RunningTurnFooter({
  inFlightTurnStartedAt,
  estimatedTokens,
  spinner,
}: {
  inFlightTurnStartedAt: Date | null;
  estimatedTokens: number | null;
  spinner?: PersonalitySpinnerColors;
}) {
  return (
    <View style={stylesheet.turnFooterSlot} testID="turn-working-indicator">
      <WorkingIndicator
        inFlightTurnStartedAt={inFlightTurnStartedAt}
        estimatedTokens={estimatedTokens}
        spinner={spinner}
      />
    </View>
  );
}

function CompletedTurnFooter({
  strategy,
  items,
  timing,
  startIndex,
  onForkAssistantTurn,
  serverId,
  agentId,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
  onForkAssistantTurn?: AssistantTurnForkHandler;
  serverId?: string;
  agentId?: string;
}) {
  const getContent = useCallback(
    () =>
      collectAssistantTurnContentForStreamRenderStrategy({
        strategy,
        items,
        startIndex,
      }),
    [strategy, items, startIndex],
  );
  const boundaryMessageId = resolveAssistantTurnBoundaryMessageId({
    items,
    startIndex,
  });
  // The playback button pins to this turn's message width. The bubble reports
  // its width under the same key we resolve here (blockGroupId ?? id); see
  // assistant-turn-width.ts.
  const startItem = items[startIndex];
  const widthGroupId =
    startItem?.kind === "assistant_message" ? (startItem.blockGroupId ?? startItem.id) : undefined;
  const messageWidth = useAssistantBubbleWidth(widthGroupId);
  return (
    <View style={stylesheet.turnFooterSlot}>
      <AssistantTurnFooter
        getContent={getContent}
        completedAt={timing?.completedAt}
        durationMs={timing?.durationMs}
        usage={timing?.usage}
        forkBoundaryMessageId={boundaryMessageId}
        onFork={onForkAssistantTurn}
        serverId={serverId}
        agentId={agentId}
        messageWidth={messageWidth}
      />
    </View>
  );
}

function TurnFooterRow({ children }: { children: ReactNode }) {
  return <ChatWidthBounds style={turnFooterRowStyle}>{children}</ChatWidthBounds>;
}

const stylesheet = StyleSheet.create((theme) => ({
  streamItemWrapper: {
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  turnFooterRow: {
    marginTop: 0,
  },
  footerReveal: {
    opacity: 1,
  },
  footerRevealHidden: {
    opacity: 0,
  },
  turnFooterSlot: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    minHeight: 24,
    paddingBottom: theme.spacing[2],
  },
  turnFooterContent: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: theme.spacing[3],
  },
  workingElapsed: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  workingTokens: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  workingLoader: {
    marginLeft: -2,
  },
}));

const turnFooterRowStyle = [stylesheet.streamItemWrapper, stylesheet.turnFooterRow];
