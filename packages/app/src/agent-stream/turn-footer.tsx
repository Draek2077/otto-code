import React, { memo, useCallback, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ChatWidthBounds } from "@/components/chat-width-bounds";
import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import {
  collectAssistantTurnContentForStreamRenderStrategy,
  type StreamStrategy,
} from "./strategy";
import { resolveAssistantTurnBoundaryMessageId } from "./turn-boundary";
import {
  AssistantTurnFooter,
  LiveElapsed,
  STREAM_METADATA_FONT_SIZE,
  type AssistantForkTarget,
} from "@/components/message";
import type { TurnFooterHost } from "./layout";
import { ThemedBlobLoader } from "@/components/blob-loader";

export type TurnContentStrategy = StreamStrategy;
export type AssistantTurnForkHandler = (input: {
  target: AssistantForkTarget;
  boundaryMessageId?: string;
}) => Promise<void> | void;

export const TurnFooter = memo(function TurnFooter({
  isRunning,
  inFlightTurnStartedAt,
  host,
  strategy,
  onForkAssistantTurn,
}: {
  isRunning: boolean;
  inFlightTurnStartedAt: Date | null;
  host: TurnFooterHost | null;
  strategy: TurnContentStrategy;
  onForkAssistantTurn?: AssistantTurnForkHandler;
}) {
  if (isRunning) {
    return (
      <TurnFooterRow>
        <RunningTurnFooter inFlightTurnStartedAt={inFlightTurnStartedAt} />
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
    />
  );
});

export const CompletedTurnFooterRow = memo(function CompletedTurnFooterRow({
  strategy,
  items,
  timing,
  startIndex,
  onForkAssistantTurn,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
  onForkAssistantTurn?: AssistantTurnForkHandler;
}) {
  return (
    <TurnFooterRow>
      <CompletedTurnFooter
        strategy={strategy}
        items={items}
        timing={timing}
        startIndex={startIndex}
        onForkAssistantTurn={onForkAssistantTurn}
      />
    </TurnFooterRow>
  );
});

const WorkingIndicator = memo(function WorkingIndicator({
  inFlightTurnStartedAt = null,
}: {
  inFlightTurnStartedAt?: Date | null;
}) {
  return (
    <View style={stylesheet.turnFooterContent}>
      <View style={stylesheet.workingLoader}>
        <ThemedBlobLoader size={18} />
      </View>
      {inFlightTurnStartedAt ? (
        <LiveElapsed
          startedAt={inFlightTurnStartedAt}
          style={stylesheet.workingElapsed}
          testID="turn-working-elapsed"
        />
      ) : null}
    </View>
  );
});

function RunningTurnFooter({ inFlightTurnStartedAt }: { inFlightTurnStartedAt: Date | null }) {
  return (
    <View style={stylesheet.turnFooterSlot} testID="turn-working-indicator">
      <WorkingIndicator inFlightTurnStartedAt={inFlightTurnStartedAt} />
    </View>
  );
}

function CompletedTurnFooter({
  strategy,
  items,
  timing,
  startIndex,
  onForkAssistantTurn,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
  onForkAssistantTurn?: AssistantTurnForkHandler;
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
  return (
    <View style={stylesheet.turnFooterSlot}>
      <AssistantTurnFooter
        getContent={getContent}
        completedAt={timing?.completedAt}
        durationMs={timing?.durationMs}
        forkBoundaryMessageId={boundaryMessageId}
        onFork={onForkAssistantTurn}
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
  turnFooterSlot: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    minHeight: 24,
    paddingBottom: theme.spacing[6],
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
    fontSize: STREAM_METADATA_FONT_SIZE,
    fontVariant: ["tabular-nums"],
  },
  workingLoader: {
    marginLeft: -2,
  },
}));

const turnFooterRowStyle = [stylesheet.streamItemWrapper, stylesheet.turnFooterRow];
