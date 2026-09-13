import { describe, expect, it } from "vitest";
import { reduceTurnLiveness, resolveTurnPresentation, TURN_LIVENESS_IDLE } from "./turn-liveness";

describe("turn activity", () => {
  const startedAt = new Date("2026-07-31T10:00:00.000Z");

  it("ignores a terminal event for another turn", () => {
    const open = reduceTurnLiveness(TURN_LIVENESS_IDLE, {
      type: "stream_open",
      turn: { turnId: "turn-2", startedAt },
    });

    expect(reduceTurnLiveness(open, { type: "stream_close", turnId: "turn-1" })).toBe(open);
  });

  it("replaces activity from an authoritative snapshot", () => {
    const open = reduceTurnLiveness(TURN_LIVENESS_IDLE, {
      type: "stream_open",
      turn: { turnId: "turn-1", startedAt },
    });

    expect(reduceTurnLiveness(open, { type: "snapshot", activeTurn: null })).toEqual(
      TURN_LIVENESS_IDLE,
    );
  });

  it("opens an autonomous turn from an authoritative snapshot", () => {
    expect(
      reduceTurnLiveness(TURN_LIVENESS_IDLE, {
        type: "snapshot",
        activeTurn: { turnId: "autonomous-turn-1", startedAt },
      }),
    ).toEqual({
      phase: "open",
      turnId: "autonomous-turn-1",
      startedAt,
      cancellationRequestId: null,
    });
  });

  it("does not let an old cancel completion clear the current request", () => {
    const first = reduceTurnLiveness(TURN_LIVENESS_IDLE, {
      type: "cancellation_started",
      requestId: 1,
    });
    const second = reduceTurnLiveness(first, { type: "cancellation_started", requestId: 2 });

    expect(reduceTurnLiveness(second, { type: "cancellation_settled", requestId: 1 })).toBe(second);
  });

  it("keeps cancellation pending across submission-to-turn handoff", () => {
    const canceling = reduceTurnLiveness(TURN_LIVENESS_IDLE, {
      type: "cancellation_started",
      requestId: 1,
    });

    expect(
      reduceTurnLiveness(canceling, {
        type: "stream_open",
        turn: { turnId: "turn-1", startedAt },
      }),
    ).toEqual({
      phase: "open",
      turnId: "turn-1",
      startedAt,
      cancellationRequestId: 1,
    });
  });

  it("keeps submission-only activity untimed", () => {
    expect(resolveTurnPresentation(TURN_LIVENESS_IDLE, true)).toEqual({
      isActive: true,
      isCancelling: false,
      startedAt: null,
      turnId: null,
    });
  });

  it("keeps an authoritative idle turn inactive without an active submission", () => {
    expect(resolveTurnPresentation(TURN_LIVENESS_IDLE, false)).toEqual({
      isActive: false,
      isCancelling: false,
      startedAt: null,
      turnId: null,
    });
  });

  it("preserves the observed identity and cancellation across an anonymous running snapshot", () => {
    const open = reduceTurnLiveness(TURN_LIVENESS_IDLE, {
      type: "stream_open",
      turn: { turnId: "turn-A", startedAt },
    });
    const cancelling = reduceTurnLiveness(open, { type: "cancellation_started", requestId: 3 });
    const legacy = reduceTurnLiveness(cancelling, {
      type: "snapshot",
      activeTurn: { turnId: null, startedAt: new Date(startedAt.getTime() + 1000) },
    });
    expect(legacy).toEqual({
      phase: "open",
      turnId: "turn-A",
      startedAt,
      cancellationRequestId: 3,
    });
    expect(resolveTurnPresentation(legacy, false)).toEqual({
      isActive: true,
      isCancelling: true,
      startedAt,
      turnId: "turn-A",
    });
    expect(reduceTurnLiveness(legacy, { type: "snapshot", activeTurn: null })).toEqual(
      TURN_LIVENESS_IDLE,
    );
    const nextStart = new Date(startedAt.getTime() + 2000);
    expect(
      reduceTurnLiveness(legacy, {
        type: "snapshot",
        activeTurn: { turnId: "turn-B", startedAt: nextStart },
      }),
    ).toEqual({
      phase: "open",
      turnId: "turn-B",
      startedAt: nextStart,
      cancellationRequestId: null,
    });
  });

  it("does not suppress an anonymous stream start using the legacy snapshot rule", () => {
    const open = reduceTurnLiveness(TURN_LIVENESS_IDLE, {
      type: "stream_open",
      turn: { turnId: "turn-A", startedAt },
    });
    expect(
      reduceTurnLiveness(open, {
        type: "stream_open",
        turn: { turnId: null, startedAt },
      }),
    ).toEqual({ phase: "open", turnId: null, startedAt, cancellationRequestId: null });
  });
});
