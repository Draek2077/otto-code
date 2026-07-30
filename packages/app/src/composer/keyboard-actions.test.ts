import { describe, expect, it, vi } from "vitest";
import {
  dispatchComposerKeyboardAction,
  type ComposerKeyboardTarget,
  type DispatchComposerKeyboardActionArgs,
} from "@/composer/keyboard-actions";

function buildArgs(
  overrides: Partial<DispatchComposerKeyboardActionArgs> = {},
): DispatchComposerKeyboardActionArgs {
  const target: ComposerKeyboardTarget = { runKeyboardAction: vi.fn(() => false) };
  return {
    action: { id: "agent.interrupt", scope: "global" },
    isPaneFocused: true,
    messageInputRef: { current: target },
    isAgentRunning: false,
    isCancellingAgent: false,
    isConnected: true,
    handleCancelAgent: vi.fn(),
    focusMessageInputForKeyboardAction: vi.fn(),
    ...overrides,
  };
}

describe("dispatchComposerKeyboardAction", () => {
  it("never asks the input to clear or replace the typed text", () => {
    // Regression guard: Escape used to wipe the composer, which also wiped the
    // persisted draft. Typed-but-unsent text has no undo, so nothing dispatched
    // from a keyboard action may destroy it.
    const runKeyboardAction = vi.fn<ComposerKeyboardTarget["runKeyboardAction"]>(() => false);
    const args = buildArgs({
      messageInputRef: { current: { runKeyboardAction } },
      isAgentRunning: true,
    });

    dispatchComposerKeyboardAction(args);

    for (const [action] of runKeyboardAction.mock.calls) {
      expect(action).toBe("dictation-cancel");
    }
  });

  it("cancels dictation on Escape when dictation is active", () => {
    const runKeyboardAction = vi.fn(() => true);
    const handleCancelAgent = vi.fn();
    const args = buildArgs({
      messageInputRef: { current: { runKeyboardAction } },
      isAgentRunning: true,
      handleCancelAgent,
    });

    expect(dispatchComposerKeyboardAction(args)).toBe(true);
    expect(runKeyboardAction).toHaveBeenCalledWith("dictation-cancel");
    expect(handleCancelAgent).not.toHaveBeenCalled();
  });

  it("cancels the running agent on Escape when dictation is idle", () => {
    const handleCancelAgent = vi.fn();
    const args = buildArgs({ isAgentRunning: true, handleCancelAgent });

    expect(dispatchComposerKeyboardAction(args)).toBe(true);
    expect(handleCancelAgent).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape unhandled when nothing is running", () => {
    const handleCancelAgent = vi.fn();
    const args = buildArgs({ isAgentRunning: false, handleCancelAgent });

    expect(dispatchComposerKeyboardAction(args)).toBe(false);
    expect(handleCancelAgent).not.toHaveBeenCalled();
  });

  it("does not cancel while a cancel is already in flight or disconnected", () => {
    const cancelInFlight = vi.fn();
    expect(
      dispatchComposerKeyboardAction(
        buildArgs({
          isAgentRunning: true,
          isCancellingAgent: true,
          handleCancelAgent: cancelInFlight,
        }),
      ),
    ).toBe(false);

    const cancelOffline = vi.fn();
    expect(
      dispatchComposerKeyboardAction(
        buildArgs({ isAgentRunning: true, isConnected: false, handleCancelAgent: cancelOffline }),
      ),
    ).toBe(false);

    expect(cancelInFlight).not.toHaveBeenCalled();
    expect(cancelOffline).not.toHaveBeenCalled();
  });

  it("ignores every action when the pane is not focused", () => {
    const handleCancelAgent = vi.fn();
    const focusMessageInputForKeyboardAction = vi.fn();
    const args = buildArgs({
      isPaneFocused: false,
      isAgentRunning: true,
      handleCancelAgent,
      focusMessageInputForKeyboardAction,
    });

    expect(dispatchComposerKeyboardAction(args)).toBe(false);
    expect(handleCancelAgent).not.toHaveBeenCalled();
    expect(focusMessageInputForKeyboardAction).not.toHaveBeenCalled();
  });

  it("focuses the input for message-input.focus", () => {
    const focusMessageInputForKeyboardAction = vi.fn();
    const args = buildArgs({
      action: { id: "message-input.focus", scope: "global" },
      focusMessageInputForKeyboardAction,
    });

    expect(dispatchComposerKeyboardAction(args)).toBe(true);
    expect(focusMessageInputForKeyboardAction).toHaveBeenCalledTimes(1);
  });

  it("passes send through and reports whether the input handled it", () => {
    const runKeyboardAction = vi.fn(() => false);
    const args = buildArgs({
      action: { id: "message-input.send", scope: "global" },
      messageInputRef: { current: { runKeyboardAction } },
    });

    expect(dispatchComposerKeyboardAction(args)).toBe(false);
    expect(runKeyboardAction).toHaveBeenCalledWith("send");
  });

  it("claims non-send passthrough actions regardless of the input result", () => {
    const runKeyboardAction = vi.fn(() => false);
    const args = buildArgs({
      action: { id: "message-input.dictation-toggle", scope: "global" },
      messageInputRef: { current: { runKeyboardAction } },
    });

    expect(dispatchComposerKeyboardAction(args)).toBe(true);
    expect(runKeyboardAction).toHaveBeenCalledWith("dictation-toggle");
  });
});
