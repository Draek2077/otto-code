import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Lightbulb } from "@/components/icons/material-icons";
import { useAppSettings } from "@/hooks/use-settings";
import { FlyoutBand } from "@/composer/flyout-band";
import { COMPOSER_TRACK_LAYERS, ComposerTrackTransition } from "@/composer/track-transition";
import {
  FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE,
  resolveFollowChainPhase,
} from "@/composer/follow-suggestion/decide";
import {
  selectFollowSuggestionChain,
  useFollowSuggestionChainStore,
} from "@/composer/follow-suggestion/chain-store";
import { useFollowPromptSuggestionsSetting } from "@/composer/follow-suggestion/setting";

interface FollowSuggestionTrackProps {
  serverId: string;
  agentId: string;
}

/**
 * The visible half of "Follow prompt suggestions".
 *
 * A prompt the app sent on the user's behalf lands in the transcript looking
 * exactly like one they typed, so the feature would otherwise be invisible from
 * the inside. This band says plainly that Otto is following the agent's own
 * suggestions, counts them against the bound, and carries the Stop that ends
 * the chain for this chat without touching the setting.
 *
 * It renders nothing until a suggestion has actually been followed, so an
 * enabled-but-idle chat looks like any other.
 */
export function FollowSuggestionTrack({
  serverId,
  agentId,
}: FollowSuggestionTrackProps): ReactElement {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const isFollowEnabled = useFollowPromptSuggestionsSetting();
  const chain = useFollowSuggestionChainStore((state) =>
    selectFollowSuggestionChain(state, serverId, agentId),
  );
  const stopChain = useFollowSuggestionChainStore((state) => state.stopChain);
  const handleStop = useCallback(
    () => stopChain(serverId, agentId),
    [stopChain, serverId, agentId],
  );

  const phase = resolveFollowChainPhase({
    isFollowEnabled: isFollowEnabled && settings.promptSuggestionsEnabled,
    isStopped: chain.isStopped,
    sentCount: chain.sentCount,
  });

  let message: string | null = null;
  if (phase === "following") {
    message = t("composer.followSuggestion.active", {
      sent: chain.sentCount,
      max: FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE,
    });
  } else if (phase === "limit-reached") {
    message = t("composer.followSuggestion.limit", {
      max: FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE,
    });
  }

  // The transition wrapper stays mounted either way - an empty one is how the
  // band leaves, and unmounting it would take the exit animation with it.
  return (
    <ComposerTrackTransition layer={COMPOSER_TRACK_LAYERS.followSuggestion}>
      {message ? (
        <FlyoutBand
          tone="purple"
          message={message}
          icon={Lightbulb}
          layer={COMPOSER_TRACK_LAYERS.followSuggestion}
          onDismiss={handleStop}
          dismissLabel={t("composer.followSuggestion.stop")}
          testID="composer-follow-suggestion-track"
          messageTestID="composer-follow-suggestion-message"
          dismissTestID="composer-follow-suggestion-stop"
        />
      ) : null}
    </ComposerTrackTransition>
  );
}
