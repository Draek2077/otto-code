import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Lightbulb } from "@/components/icons/material-icons";
import { useAppSettings } from "@/hooks/use-settings";
import { FlyoutBand } from "@/composer/flyout-band";
import { COMPOSER_TRACK_LAYERS, ComposerTrackTransition } from "@/composer/track-transition";
import { resolveFollowChainPhase } from "@/composer/follow-suggestion/decide";
import {
  selectFollowSuggestionChain,
  useFollowSuggestionChainStore,
} from "@/composer/follow-suggestion/chain-store";
import {
  setChatFollowPromptSuggestions,
  useChatFollowPromptSuggestions,
  useFollowPromptSuggestionsLimit,
} from "@/composer/follow-suggestion/setting";

interface FollowSuggestionTrackProps {
  serverId: string;
  agentId: string;
}

/**
 * The visible half of Autonomous mode.
 *
 * A prompt the app sent on the user's behalf lands in the transcript looking
 * exactly like one they typed, so the feature would otherwise be invisible from
 * the inside. This band says plainly that Otto is following the agent's own
 * suggestions, counts them (against the bound, when there is one), and carries
 * the control that turns Autonomous mode off for this chat.
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
  const isFollowEnabled = useChatFollowPromptSuggestions(serverId, agentId) === "on";
  const maxConsecutive = useFollowPromptSuggestionsLimit();
  const chain = useFollowSuggestionChainStore((state) =>
    selectFollowSuggestionChain(state, serverId, agentId),
  );
  const handleTurnOff = useCallback(() => {
    void setChatFollowPromptSuggestions({ serverId, agentId, enabled: false }).catch(
      () => undefined,
    );
  }, [serverId, agentId]);

  const phase = resolveFollowChainPhase({
    isFollowEnabled: isFollowEnabled && settings.promptSuggestionsEnabled,
    sentCount: chain.sentCount,
    maxConsecutive,
  });

  let message: string | null = null;
  if (phase === "following") {
    message =
      maxConsecutive === null
        ? t("composer.followSuggestion.activeUnlimited", { sent: chain.sentCount })
        : t("composer.followSuggestion.active", { sent: chain.sentCount, max: maxConsecutive });
  } else if (phase === "limit-reached" && maxConsecutive !== null) {
    message = t("composer.followSuggestion.limit", { max: maxConsecutive });
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
          onDismiss={handleTurnOff}
          dismissLabel={t("composer.followSuggestion.turnOff")}
          testID="composer-follow-suggestion-track"
          messageTestID="composer-follow-suggestion-message"
          dismissTestID="composer-follow-suggestion-stop"
        />
      ) : null}
    </ComposerTrackTransition>
  );
}
