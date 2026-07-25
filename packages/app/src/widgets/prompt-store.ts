import { create } from "zustand";
import {
  WIDGET_PROMPT_MAX_CHARS,
  WIDGET_PROMPT_MIN_INTERVAL_MS,
  WIDGET_PROMPT_SESSION_LIMIT,
} from "@otto-code/protocol/widgets/bridge";

/**
 * The `sendPrompt` channel: a widget types into the chat as if the user had.
 *
 * That is a privilege, not a convenience, so it is deliberately narrow. The
 * composer for a chat registers itself here while it is mounted, and a widget
 * can only reach a chat whose composer is registered — which is what makes the
 * active-chat gate real rather than advisory. A widget sitting in a background
 * tab, an archived chat, or a transcript nobody has open finds no sender and
 * silently does nothing.
 *
 * On top of that: a length cap, a minimum interval, and a per-widget session
 * ceiling. Together they mean a widget cannot paste an essay, cannot
 * machine-gun the composer, and cannot self-drive a loop.
 */

export type WidgetPromptSender = (text: string) => void;

export interface WidgetPromptTarget {
  serverId: string;
  agentId: string;
}

export type WidgetPromptResult = "sent" | "no-target" | "too-long" | "rate-limited" | "exhausted";

interface WidgetPromptState {
  senders: Record<string, WidgetPromptSender>;
  /** Per-widget send bookkeeping, keyed by widget id (the tool call id). */
  budgets: Record<string, { count: number; lastSentAt: number }>;
  registerSender: (target: WidgetPromptTarget, sender: WidgetPromptSender) => () => void;
  sendPrompt: (input: {
    target: WidgetPromptTarget;
    widgetId: string;
    text: string;
    now?: number;
  }) => WidgetPromptResult;
}

export function widgetPromptTargetKey(target: WidgetPromptTarget): string {
  return `${target.serverId}::${target.agentId}`;
}

export const useWidgetPromptStore = create<WidgetPromptState>((set, get) => ({
  senders: {},
  budgets: {},

  registerSender: (target, sender) => {
    const key = widgetPromptTargetKey(target);
    set((state) => ({ senders: { ...state.senders, [key]: sender } }));
    return () => {
      set((state) => {
        // Only drop our own registration: a remount can install the next
        // composer's sender before this cleanup runs.
        if (state.senders[key] !== sender) {
          return state;
        }
        const { [key]: _removed, ...senders } = state.senders;
        return { senders };
      });
    };
  },

  sendPrompt: ({ target, widgetId, text, now = Date.now() }) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return "no-target";
    }
    if (trimmed.length > WIDGET_PROMPT_MAX_CHARS) {
      return "too-long";
    }

    const sender = get().senders[widgetPromptTargetKey(target)];
    if (!sender) {
      return "no-target";
    }

    const budget = get().budgets[widgetId] ?? { count: 0, lastSentAt: 0 };
    if (budget.count >= WIDGET_PROMPT_SESSION_LIMIT) {
      return "exhausted";
    }
    // Only gate on the interval once something has actually been sent — a
    // widget's first click must never be throttled against a zero timestamp.
    if (budget.count > 0 && now - budget.lastSentAt < WIDGET_PROMPT_MIN_INTERVAL_MS) {
      return "rate-limited";
    }

    set((state) => ({
      budgets: {
        ...state.budgets,
        [widgetId]: { count: budget.count + 1, lastSentAt: now },
      },
    }));
    sender(trimmed);
    return "sent";
  },
}));
