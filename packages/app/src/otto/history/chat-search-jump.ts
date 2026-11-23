import { useEffect, useRef, useState, type RefObject } from "react";
import { create } from "zustand";
import type { StreamViewportHandle } from "@/agent-stream/strategy";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { planTimelinePromptJump } from "@/timeline/timeline-sync-plan";
import type { StreamItem } from "@/types/stream";

interface Target {
  serverId: string;
  agentId: string;
  epoch: string;
  seq: number;
  expiresAt: number;
}
export const useChatSearchJumpStore = create<{
  target: Target | null;
  setTarget(target: Target | null): void;
}>((set) => ({ target: null, setTarget: (target) => set({ target }) }));

export function useChatSearchJump({
  serverId,
  agentId,
  active,
  readOnly,
  ready,
  items,
  head,
  viewportRef,
  reveal,
  onError,
}: {
  serverId: string;
  agentId: string;
  active: boolean;
  readOnly: boolean;
  ready: boolean;
  items: readonly StreamItem[];
  head?: readonly StreamItem[];
  viewportRef: RefObject<StreamViewportHandle | null>;
  reveal(itemId: string): boolean;
  onError(): void;
}) {
  const target = useChatSearchJumpStore((state) =>
    state.target?.serverId === serverId && state.target.agentId === agentId ? state.target : null,
  );
  const requested = useRef<Target | null>(null);
  const [settled, setSettled] = useState<Target | null>(null);
  useEffect(() => {
    if (!active || readOnly || !ready || !target) return;
    const clear = () => {
      if (useChatSearchJumpStore.getState().target === target) {
        useChatSearchJumpStore.getState().setTarget(null);
      }
    };
    if (Date.now() > target.expiresAt) {
      clear();
      return;
    }
    const matches = (row: StreamItem) =>
      row.timelineCursor?.epoch === target.epoch && row.timelineCursor.seq === target.seq;
    const item = items.find(matches) ?? head?.find(matches);
    if (item && viewportRef.current?.scrollToMessage) {
      if (reveal(item.id)) return;
      viewportRef.current.scrollToMessage(item.id);
      clear();
      requested.current = null;
      return;
    }
    if (settled === target) {
      clear();
      onError();
      return;
    }
    if (requested.current === target) return;
    requested.current = target;
    void getHostRuntimeStore()
      .fetchAgentTimeline(serverId, agentId, planTimelinePromptJump(target))
      .catch(() => undefined)
      .finally(() => {
        if (useChatSearchJumpStore.getState().target === target) setSettled(target);
      });
  }, [
    active,
    readOnly,
    ready,
    target,
    serverId,
    agentId,
    items,
    head,
    viewportRef,
    reveal,
    onError,
    settled,
  ]);
}
