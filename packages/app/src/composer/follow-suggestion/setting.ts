import { useCallback, useEffect } from "react";
import { useReplicaQuery } from "@/data/query";
import {
  loadAppSettingsFromStorage,
  persistAppSettings,
  type AppSettings,
} from "@/hooks/use-settings";
import {
  APP_SETTINGS_QUERY_KEY,
  buildAgentFollowPromptSuggestionsKey,
} from "@/hooks/use-settings/storage";
import {
  DEFAULT_FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE,
  resolveFollowPromptSuggestionsLimit,
} from "@/composer/follow-suggestion/decide";

/**
 * A chat's Autonomous mode. "loading" while the settings query has not
 * resolved, "unseeded" for a chat that has never been given its starting value.
 * The feature must never send a prompt on either: only "on" follows.
 */
export type ChatFollowPromptSuggestionsState = "loading" | "unseeded" | "on" | "off";

function selectFollowLimit(settings: AppSettings): number | null {
  return resolveFollowPromptSuggestionsLimit(settings.followPromptSuggestionsLimit);
}

/**
 * Reads through the settings query cache with a `select`, so the composer's
 * follow driver and the band only re-run when this chat's value flips, never on
 * an unrelated settings write. Mirrors use-auto-clear-completed-background-tasks.ts.
 */
export function useChatFollowPromptSuggestions(
  serverId: string,
  agentId: string,
): ChatFollowPromptSuggestionsState {
  const key = buildAgentFollowPromptSuggestionsKey(serverId, agentId);
  const select = useCallback(
    (settings: AppSettings): ChatFollowPromptSuggestionsState => {
      const value = settings.agentFollowPromptSuggestions[key];
      if (value === undefined) return "unseeded";
      return value ? "on" : "off";
    },
    [key],
  );
  const { data } = useReplicaQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    pushEvent: "local:app-settings-write",
    select,
  });
  return data ?? "loading";
}

/** The Settings bound, `null` for unlimited. The default while loading. */
export function useFollowPromptSuggestionsLimit(): number | null {
  const { data } = useReplicaQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    pushEvent: "local:app-settings-write",
    select: selectFollowLimit,
  });
  return data === undefined ? DEFAULT_FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE : data;
}

export async function setChatFollowPromptSuggestions(input: {
  serverId: string;
  agentId: string;
  enabled: boolean;
}): Promise<void> {
  const key = buildAgentFollowPromptSuggestionsKey(input.serverId, input.agentId);
  await persistAppSettings((current) => ({
    agentFollowPromptSuggestions: { ...current.agentFollowPromptSuggestions, [key]: input.enabled },
  }));
}

/**
 * Deletes a chat's Autonomous mode. Called when the chat is archived, so the
 * record does not grow forever and an unarchived chat starts from the default.
 */
export async function forgetChatFollowPromptSuggestions(input: {
  serverId: string;
  agentId: string;
}): Promise<void> {
  const key = buildAgentFollowPromptSuggestionsKey(input.serverId, input.agentId);
  await persistAppSettings((current) => {
    if (!(key in current.agentFollowPromptSuggestions)) return {};
    const { [key]: _removed, ...rest } = current.agentFollowPromptSuggestions;
    return { agentFollowPromptSuggestions: rest };
  });
}

/**
 * Gives a chat its starting Autonomous mode from the Settings default, once.
 * The check runs against the settings current at write time, so two composers
 * mounting the same chat cannot seed it twice with different defaults.
 */
export function useSeedChatFollowPromptSuggestions(input: {
  serverId: string;
  agentId: string;
  state: ChatFollowPromptSuggestionsState;
  enabled: boolean;
}): void {
  const { serverId, agentId, state, enabled } = input;
  useEffect(() => {
    if (!enabled || state !== "unseeded") return;
    const key = buildAgentFollowPromptSuggestionsKey(serverId, agentId);
    void persistAppSettings((current) => {
      if (key in current.agentFollowPromptSuggestions) return {};
      return {
        agentFollowPromptSuggestions: {
          ...current.agentFollowPromptSuggestions,
          [key]: current.followPromptSuggestions,
        },
      };
    }).catch(() => undefined);
  }, [agentId, enabled, serverId, state]);
}
