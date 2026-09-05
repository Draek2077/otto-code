import type { TFunction } from "i18next";
import type { SendBehavior } from "@/hooks/use-settings/storage";

export type ImmediateSendAction = "send" | "steer" | "interrupt";

/**
 * Any action that delivers immediately, including a queued-message "Send all",
 * follows the same active-turn contract as the composer primary button. Queue
 * is not an immediate delivery behavior, so it resolves to Interrupt here.
 */
export function resolveImmediateSendAction(input: {
  defaultSendBehavior: SendBehavior;
  isAgentRunning: boolean;
}): ImmediateSendAction {
  if (!input.isAgentRunning) return "send";
  return input.defaultSendBehavior === "steer" ? "steer" : "interrupt";
}

export function resolveSubmitAccessibilityLabel(input: {
  submitButtonAccessibilityLabel: string | undefined;
  canPressLoadingButton: boolean;
  defaultActionQueues: boolean;
  defaultSendBehavior: SendBehavior;
  isAgentRunning: boolean;
  t: TFunction;
}): string {
  if (input.submitButtonAccessibilityLabel) return input.submitButtonAccessibilityLabel;
  if (input.canPressLoadingButton) return input.t("composer.input.interruptAgent");
  if (input.defaultActionQueues) return input.t("composer.input.queueMessage");
  // Queueing, including compaction's forced queue, wins above. Otherwise name
  // the active-turn action explicitly: Steer is the default and must not read
  // like an ordinary send or an interrupt.
  if (input.isAgentRunning && input.defaultSendBehavior === "steer") {
    return input.t("composer.input.sendAndSteer");
  }
  if (input.isAgentRunning) return input.t("composer.input.sendAndInterrupt");
  return input.t("composer.input.sendMessage");
}

export function resolveVoiceAccessibilityLabel(input: {
  isRealtimeVoiceForCurrentAgent: boolean;
  isMuted: boolean;
  isDictating: boolean;
  t: TFunction;
}): string {
  if (input.isRealtimeVoiceForCurrentAgent) {
    return input.isMuted
      ? input.t("composer.voice.unmuteVoiceMode")
      : input.t("composer.voice.muteVoiceMode");
  }
  if (input.isDictating) return input.t("composer.voice.stopDictation");
  return input.t("composer.voice.startDictation");
}

export function resolveVoiceTooltipText(input: {
  isRealtimeVoiceForCurrentAgent: boolean;
  isMuted: boolean;
  t: TFunction;
}): string {
  if (input.isRealtimeVoiceForCurrentAgent) {
    return input.isMuted
      ? input.t("composer.voice.unmuteVoice")
      : input.t("composer.voice.muteVoice");
  }
  return input.t("composer.voice.dictation");
}

export function resolveSendTooltipLabel(input: {
  submitButtonAccessibilityLabel: string | undefined;
  defaultActionQueues: boolean;
  defaultSendBehavior: SendBehavior;
  isAgentRunning: boolean;
  t: TFunction;
}): string {
  if (input.submitButtonAccessibilityLabel) return input.submitButtonAccessibilityLabel;
  if (input.defaultActionQueues) return input.t("composer.input.queue");
  const action = resolveImmediateSendAction(input);
  return input.t(`composer.input.${action}`);
}

export function resolvePreviewActionQueues(input: {
  defaultActionQueues: boolean;
  alternateModifierHeld: boolean;
  canUseAlternateAction: boolean;
}): boolean {
  if (!resolveUsesAlternateSendAction(input)) {
    return input.defaultActionQueues;
  }
  return !input.defaultActionQueues;
}

/**
 * One decision owns both the modifier-preview chrome and a pointer press on
 * that chrome. A Queue icon must queue when clicked, not merely promise it.
 */
export function resolveUsesAlternateSendAction(input: {
  alternateModifierHeld: boolean;
  canUseAlternateAction: boolean;
}): boolean {
  return input.alternateModifierHeld && input.canUseAlternateAction;
}

/**
 * The primary button mirrors the action Enter will take while a turn is live:
 * queue uses the return/Enter glyph, Steer uses the branch glyph, and both
 * Send and Interrupt use the up arrow. The distinct `interrupt` result lets
 * the renderer apply its destructive tint without inventing a second arrow.
 */
export function resolveSendButtonIcon(input: {
  canPressLoadingButton: boolean;
  defaultActionQueues: boolean;
  alternateModifierHeld: boolean;
  canUseAlternateAction: boolean;
  isAgentRunning: boolean;
  defaultSendBehavior: SendBehavior;
  submitIcon: "arrow" | "return";
}): "arrow" | "return" | "steer" | "interrupt" {
  if (input.canPressLoadingButton) return "arrow";
  const actionQueues = resolvePreviewActionQueues(input);
  if (actionQueues) return "return";
  const action = resolveImmediateSendAction(input);
  return action === "send" ? input.submitIcon : action;
}
