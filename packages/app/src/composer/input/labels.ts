import type { TFunction } from "i18next";
import type { SendBehavior } from "@/hooks/use-settings/storage";

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
  if (input.isAgentRunning) {
    return input.defaultSendBehavior === "steer"
      ? input.t("composer.input.steer")
      : input.t("composer.input.interrupt");
  }
  return input.t("composer.input.send");
}

export function resolvePreviewActionQueues(input: {
  defaultActionQueues: boolean;
  alternateModifierHeld: boolean;
  canUseAlternateAction: boolean;
}): boolean {
  if (!input.alternateModifierHeld || !input.canUseAlternateAction) {
    return input.defaultActionQueues;
  }
  return !input.defaultActionQueues;
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
  if (input.isAgentRunning) {
    return input.defaultSendBehavior === "steer" ? "steer" : "interrupt";
  }
  return input.submitIcon;
}
