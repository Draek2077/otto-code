import { describe, expect, it } from "vitest";
import {
  resolveSendButtonIcon,
  resolveSendTooltipLabel,
  resolveSubmitAccessibilityLabel,
  resolveUsesAlternateSendAction,
  resolveVoiceAccessibilityLabel,
  resolveVoiceTooltipText,
} from "./labels";

const translations: Record<string, string> = {
  "composer.input.interruptAgent": "Interrupt agent",
  "composer.input.queueMessage": "Queue message",
  "composer.input.sendAndInterrupt": "Send and interrupt",
  "composer.input.sendAndSteer": "Send and steer",
  "composer.input.sendMessage": "Send message",
  "composer.input.queue": "Queue",
  "composer.input.steer": "Steer",
  "composer.input.interrupt": "Interrupt",
  "composer.input.send": "Send",
  "composer.voice.unmuteVoiceMode": "Unmute Voice mode",
  "composer.voice.muteVoiceMode": "Mute Voice mode",
  "composer.voice.stopDictation": "Stop dictation",
  "composer.voice.startDictation": "Start dictation",
  "composer.voice.unmuteVoice": "Unmute voice",
  "composer.voice.muteVoice": "Mute voice",
  "composer.voice.dictation": "Dictation",
};

const t = ((key: string) => translations[key] ?? key) as never;

describe("composer input labels", () => {
  it("resolves submit accessibility labels from translations", () => {
    expect(
      resolveSubmitAccessibilityLabel({
        submitButtonAccessibilityLabel: undefined,
        canPressLoadingButton: true,
        defaultActionQueues: false,
        defaultSendBehavior: "interrupt",
        isAgentRunning: true,
        t,
      }),
    ).toBe("Interrupt agent");
    expect(
      resolveSubmitAccessibilityLabel({
        submitButtonAccessibilityLabel: undefined,
        canPressLoadingButton: false,
        defaultActionQueues: true,
        defaultSendBehavior: "queue",
        isAgentRunning: true,
        t,
      }),
    ).toBe("Queue message");
    expect(
      resolveSubmitAccessibilityLabel({
        submitButtonAccessibilityLabel: undefined,
        canPressLoadingButton: false,
        defaultActionQueues: false,
        defaultSendBehavior: "interrupt",
        isAgentRunning: true,
        t,
      }),
    ).toBe("Send and interrupt");
    expect(
      resolveSubmitAccessibilityLabel({
        submitButtonAccessibilityLabel: undefined,
        canPressLoadingButton: false,
        defaultActionQueues: false,
        defaultSendBehavior: "steer",
        isAgentRunning: true,
        t,
      }),
    ).toBe("Send and steer");
    expect(
      resolveSubmitAccessibilityLabel({
        submitButtonAccessibilityLabel: undefined,
        canPressLoadingButton: false,
        defaultActionQueues: false,
        defaultSendBehavior: "interrupt",
        isAgentRunning: false,
        t,
      }),
    ).toBe("Send message");
  });

  it("keeps explicit submit labels untouched", () => {
    expect(
      resolveSubmitAccessibilityLabel({
        submitButtonAccessibilityLabel: "Run now",
        canPressLoadingButton: false,
        defaultActionQueues: false,
        defaultSendBehavior: "interrupt",
        isAgentRunning: false,
        t,
      }),
    ).toBe("Run now");
  });

  it("resolves voice labels from translations", () => {
    expect(
      resolveVoiceAccessibilityLabel({
        isRealtimeVoiceForCurrentAgent: true,
        isMuted: true,
        isDictating: false,
        t,
      }),
    ).toBe("Unmute Voice mode");
    expect(
      resolveVoiceAccessibilityLabel({
        isRealtimeVoiceForCurrentAgent: true,
        isMuted: false,
        isDictating: false,
        t,
      }),
    ).toBe("Mute Voice mode");
    expect(
      resolveVoiceAccessibilityLabel({
        isRealtimeVoiceForCurrentAgent: false,
        isMuted: false,
        isDictating: true,
        t,
      }),
    ).toBe("Stop dictation");
    expect(
      resolveVoiceAccessibilityLabel({
        isRealtimeVoiceForCurrentAgent: false,
        isMuted: false,
        isDictating: false,
        t,
      }),
    ).toBe("Start dictation");
  });

  it("resolves tooltip labels from translations", () => {
    expect(
      resolveVoiceTooltipText({
        isRealtimeVoiceForCurrentAgent: false,
        isMuted: false,
        t,
      }),
    ).toBe("Dictation");
    expect(
      resolveSendTooltipLabel({
        submitButtonAccessibilityLabel: undefined,
        defaultActionQueues: true,
        defaultSendBehavior: "steer",
        isAgentRunning: true,
        t,
      }),
    ).toBe("Queue");
    expect(
      resolveSendTooltipLabel({
        submitButtonAccessibilityLabel: undefined,
        defaultActionQueues: false,
        defaultSendBehavior: "interrupt",
        isAgentRunning: false,
        t,
      }),
    ).toBe("Send");
    expect(
      resolveSendTooltipLabel({
        submitButtonAccessibilityLabel: undefined,
        defaultActionQueues: false,
        defaultSendBehavior: "steer",
        isAgentRunning: true,
        t,
      }),
    ).toBe("Steer");
    expect(
      resolveSendTooltipLabel({
        submitButtonAccessibilityLabel: undefined,
        defaultActionQueues: false,
        defaultSendBehavior: "interrupt",
        isAgentRunning: true,
        t,
      }),
    ).toBe("Interrupt");
  });

  it("distinguishes Queue, Steer, and Interrupt while an agent is running", () => {
    expect(
      resolveSendButtonIcon({
        canPressLoadingButton: false,
        defaultActionQueues: true,
        alternateModifierHeld: false,
        canUseAlternateAction: true,
        isAgentRunning: true,
        defaultSendBehavior: "queue",
        submitIcon: "arrow",
      }),
    ).toBe("return");
    expect(
      resolveSendButtonIcon({
        canPressLoadingButton: false,
        defaultActionQueues: false,
        alternateModifierHeld: false,
        canUseAlternateAction: true,
        isAgentRunning: true,
        defaultSendBehavior: "interrupt",
        submitIcon: "return",
      }),
    ).toBe("interrupt");
    expect(
      resolveSendButtonIcon({
        canPressLoadingButton: false,
        defaultActionQueues: false,
        alternateModifierHeld: false,
        canUseAlternateAction: true,
        isAgentRunning: true,
        defaultSendBehavior: "steer",
        submitIcon: "arrow",
      }),
    ).toBe("steer");
  });

  it("previews the alternate Enter action while Ctrl or Cmd is held", () => {
    expect(
      resolveSendButtonIcon({
        canPressLoadingButton: false,
        defaultActionQueues: false,
        alternateModifierHeld: true,
        canUseAlternateAction: true,
        isAgentRunning: true,
        defaultSendBehavior: "steer",
        submitIcon: "arrow",
      }),
    ).toBe("return");
    expect(
      resolveSendButtonIcon({
        canPressLoadingButton: false,
        defaultActionQueues: true,
        alternateModifierHeld: true,
        canUseAlternateAction: true,
        isAgentRunning: true,
        defaultSendBehavior: "queue",
        submitIcon: "arrow",
      }),
    ).toBe("interrupt");
  });

  it("uses the same modifier condition for the button press and its preview", () => {
    expect(
      resolveUsesAlternateSendAction({
        alternateModifierHeld: true,
        canUseAlternateAction: true,
      }),
    ).toBe(true);
    expect(
      resolveUsesAlternateSendAction({
        alternateModifierHeld: true,
        canUseAlternateAction: false,
      }),
    ).toBe(false);
  });
});
