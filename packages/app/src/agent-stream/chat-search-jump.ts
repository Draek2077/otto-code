import { useEffect, useRef, useState, type RefObject } from "react";
import { create } from "zustand";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { planTimelinePromptJump } from "@/timeline/timeline-sync-plan";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "./strategy";

interface Target {
  serverId: string;
  agentId: string;
  epoch: string;
  seq: number;
}
export const useChatSearchJumpStore = create<{
  target: Target | null;
  setTarget(target: Target | null): void;
}>((set) => ({ target: null, setTarget: (target) => set({ target }) }));

/** Explicit search navigation owns one timeline-window load and one scroll, on every platform. */
export function useChatSearchJump({
  serverId,
  agentId,
  active,
  ready = true,
  items,
  head,
  viewportRef,
  reveal,
  onError,
}: {
  serverId: string;
  agentId: string;
  active: boolean;
  ready?: boolean;
  items: StreamItem[];
  head?: StreamItem[];
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
    if (!active || !ready || !target) return;
    const clear = () => {
      if (useChatSearchJumpStore.getState().target === target)
        useChatSearchJumpStore.getState().setTarget(null);
    };
    const item = [...items, ...(head ?? [])].find(
      (row) => row.timelineCursor?.epoch === target.epoch && row.timelineCursor.seq === target.seq,
    );
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
      .finally(() => setSettled(target));
  }, [
    active,
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
