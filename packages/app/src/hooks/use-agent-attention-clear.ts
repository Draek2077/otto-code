import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import {
  didActivateAgentTab,
  isAttentionRaisedWhileActivelyViewed,
  shouldClearAgentAttention,
  type AgentAttentionClearTrigger,
} from "@/utils/agent-attention";
import { getIsAppActivelyVisible } from "@/utils/app-visibility";
import { isWeb } from "@/constants/platform";

type AttentionReason = "finished" | "error" | "permission" | null | undefined;

interface UseAgentAttentionClearParams {
  agentId: string | null | undefined;
  client: DaemonClient | null;
  isConnected: boolean;
  requiresAttention: boolean | null | undefined;
  attentionReason: AttentionReason;
  isScreenFocused: boolean;
  isWorkspaceFocused: boolean;
}

interface AgentAttentionClearController {
  clearOnInputFocus: () => void;
  clearOnPromptSend: () => void;
  clearOnAgentBlur: () => void;
}

export function useAgentAttentionClear({
  agentId,
  client,
  isConnected,
  requiresAttention,
  attentionReason,
  isScreenFocused,
  isWorkspaceFocused,
}: UseAgentAttentionClearParams): AgentAttentionClearController {
  const [isAppVisible, setIsAppVisible] = useState<boolean>(() => getIsAppActivelyVisible());
  const deferredFocusEntryClearRef = useRef(false);
  const prevRequiresAttentionRef = useRef(Boolean(requiresAttention));
  const prevActivelyViewedRef = useRef(isScreenFocused && getIsAppActivelyVisible());
  // Start from the mounted tab's real focus state. Treating every mount as
  // `false -> true` cleared a completed chat merely because its workspace was
  // opened, before the reader ever chose that tab.
  const prevScreenFocusedRef = useRef(isScreenFocused);
  const prevWorkspaceFocusedRef = useRef(isWorkspaceFocused);

  const clearAttention = useCallback(
    (trigger: AgentAttentionClearTrigger) => {
      const resolvedAgentId = agentId?.trim();
      if (!client || !resolvedAgentId) {
        return;
      }
      if (
        !shouldClearAgentAttention({
          agentId: resolvedAgentId,
          isConnected,
          requiresAttention,
          attentionReason,
          trigger,
          hasDeferredFocusEntryClear: deferredFocusEntryClearRef.current,
        })
      ) {
        return;
      }
      deferredFocusEntryClearRef.current = false;
      client.clearAgentAttention(resolvedAgentId).catch(() => {});
    },
    [agentId, attentionReason, client, isConnected, requiresAttention],
  );

  useEffect(() => {
    const updateVisibility = () => {
      setIsAppVisible(getIsAppActivelyVisible());
    };

    const appStateSubscription = AppState.addEventListener("change", updateVisibility);

    if (isWeb && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", updateVisibility);
      window.addEventListener("focus", updateVisibility);
      window.addEventListener("blur", updateVisibility);

      return () => {
        appStateSubscription.remove();
        document.removeEventListener("visibilitychange", updateVisibility);
        window.removeEventListener("focus", updateVisibility);
        window.removeEventListener("blur", updateVisibility);
      };
    }

    return () => {
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!requiresAttention) {
      deferredFocusEntryClearRef.current = false;
    }
  }, [requiresAttention]);

  useEffect(() => {
    const isActivelyViewed = isScreenFocused && isAppVisible;
    if (
      isAttentionRaisedWhileActivelyViewed({
        wasRequiringAttention: prevRequiresAttentionRef.current,
        requiresAttention,
        wasActivelyViewed: prevActivelyViewedRef.current,
        isActivelyViewed,
      })
    ) {
      // Keep the deferred flag for the case where the clear below is refused
      // (a pending permission must keep its badge); clearAttention resets it
      // once the clear actually lands.
      deferredFocusEntryClearRef.current = true;
      clearAttention("active-view");
    }
    prevRequiresAttentionRef.current = Boolean(requiresAttention);
    prevActivelyViewedRef.current = isActivelyViewed;
  }, [clearAttention, isAppVisible, isScreenFocused, requiresAttention]);

  useEffect(() => {
    const enteredScreenFocus =
      didActivateAgentTab({
        wasWorkspaceFocused: prevWorkspaceFocusedRef.current,
        isWorkspaceFocused,
        wasFocused: prevScreenFocusedRef.current,
        isFocused: isScreenFocused,
      }) && isAppVisible;

    if (enteredScreenFocus) {
      clearAttention("focus-entry");
    }

    prevScreenFocusedRef.current = isScreenFocused;
    prevWorkspaceFocusedRef.current = isWorkspaceFocused;
  }, [clearAttention, isAppVisible, isScreenFocused, isWorkspaceFocused]);

  return {
    clearOnInputFocus: useCallback(() => {
      clearAttention("input-focus");
    }, [clearAttention]),
    clearOnPromptSend: useCallback(() => {
      clearAttention("prompt-send");
    }, [clearAttention]),
    clearOnAgentBlur: useCallback(() => {
      clearAttention("agent-blur");
    }, [clearAttention]),
  };
}
