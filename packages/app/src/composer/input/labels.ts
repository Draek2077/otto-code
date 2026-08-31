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
  // Otto's send-behavior setting is interrupt-or-queue; the queue case is
  // already answered above by `defaultActionQueues`, so a run in flight here
  // always means interrupt. (Upstream also offers a `steer` default.)
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
  t: TFunction;
}): string {
  if (input.submitButtonAccessibilityLabel) return input.submitButtonAccessibilityLabel;
  return input.defaultActionQueues
    ? input.t("composer.input.queue")
    : input.t("composer.input.send");
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
 * queue uses the return/Enter glyph; interrupt keeps the send arrow.
 */
export function resolveSendButtonIcon(input: {
  canPressLoadingButton: boolean;
  defaultActionQueues: boolean;
  alternateModifierHeld: boolean;
  canUseAlternateAction: boolean;
  isAgentRunning: boolean;
  submitIcon: "arrow" | "return";
}): "arrow" | "return" {
  if (input.canPressLoadingButton) return "arrow";
  const actionQueues = resolvePreviewActionQueues(input);
  if (actionQueues) return "return";
  if (input.isAgentRunning) return "arrow";
  return input.submitIcon;
}
