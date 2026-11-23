import { useEffect, useRef, type RefObject } from "react";
import type { FlatList } from "react-native";
import { getStreamItemMessageId } from "@/agent-stream/presentation";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { StreamItem } from "@/types/stream";

/** Virtualized native rows are measured on demand. User scroll cancels our bounded retry. */
export function useNativeMessageJump(input: {
  agentId: string;
  listRef: RefObject<FlatList<StreamItem> | null>;
  history: readonly StreamItem[];
  head: readonly StreamItem[];
  detach(): void;
}) {
  const active = useRetainedPanelActive();
  const pending = useRef<{ messageId: string; attempts: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useStableEvent(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = null;
  });
  useEffect(() => cancel, [active, cancel, input.agentId]);

  const jump = useStableEvent((messageId: string) => {
    if (!active || !input.listRef.current) return;
    input.detach();
    const index = input.history.findIndex((item) => getStreamItemMessageId(item) === messageId);
    if (index >= 0) {
      input.listRef.current.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
    } else if (input.head.some((item) => getStreamItemMessageId(item) === messageId)) {
      input.listRef.current.scrollToOffset({ offset: 0, animated: false });
    }
  });
  const scrollToMessage = useStableEvent((messageId: string) => {
    cancel();
    pending.current = { messageId, attempts: 0 };
    jump(messageId);
  });
  const onScrollToIndexFailed = useStableEvent(
    ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
      const request = pending.current;
      if (!active || !request || request.attempts >= 3) {
        cancel();
        return;
      }
      request.attempts += 1;
      input.listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (pending.current === request) jump(request.messageId);
      }, 100);
    },
  );

  return { cancel, scrollToMessage, onScrollToIndexFailed };
}
