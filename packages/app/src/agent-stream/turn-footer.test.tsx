/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <span data-testid={testID}>{children}</span>
  ),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (theme: Record<string, unknown>) => unknown)({
            spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
            fontSize: { sm: 14 },
            colors: {
              foregroundMuted: "#aaa",
              palette: { amber: { 500: "#f0b429", 700: "#b7791f" } },
            },
          })
        : factory,
  },
  useUnistyles: () => ({ rt: { breakpoint: "md" } }),
  withUnistyles: <T,>(component: T) => component,
}));

vi.mock("@/components/message", () => ({
  MessageFooter: () => null,
  AssistantTurnFooter: () => null,
  LiveElapsed: () => <span data-testid="running-turn-timestamp" />,
  STREAM_METADATA_FONT_SIZE: 11,
}));

vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({ settings: { hideChatMessageDetails: false } }),
}));

vi.mock("@/components/synced-loader", () => ({
  SyncedLoader: () => <span data-testid="running-turn-loader" />,
}));

vi.mock("@/components/retained-panel", () => ({
  useRetainedPanelActive: () => true,
}));

vi.mock("@/components/blob-loader", () => ({
  BlobLoader: () => <span data-testid="running-turn-loader" />,
  ThemedBlobLoader: () => <span data-testid="running-turn-loader" />,
}));

vi.mock("@/components/chat-width-bounds", () => ({
  ChatWidthBounds: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

import { TurnFooter } from "./turn-footer";

const unusedRunningTurnStrategy = null as unknown as React.ComponentProps<
  typeof TurnFooter
>["strategy"];

describe("TurnFooter", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("does not show a fork action while the turn is running", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <TurnFooter
          isRunning
          inFlightTurnStartedAt={new Date("2026-08-01T10:00:00.000Z")}
          host={null}
          strategy={unusedRunningTurnStrategy}
          supportsTimelineCursor
        />,
      );
    });

    const footer = container.querySelector('[data-testid="turn-working-indicator"]');
    const controls = Array.from(footer?.querySelectorAll("[data-testid]") ?? []).map((node) =>
      node.getAttribute("data-testid"),
    );

    expect(controls).toEqual(["running-turn-loader", "running-turn-timestamp"]);
    expect(footer?.querySelector('[data-testid="running-turn-fork"]')).toBeNull();
  });

  it("keeps the token separator independent from the token label", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <TurnFooter
          isRunning
          inFlightTurnStartedAt={new Date("2026-08-01T10:00:00.000Z")}
          inFlightEstimatedTokens={303_000}
          host={null}
          strategy={unusedRunningTurnStrategy}
          supportsTimelineCursor
        />,
      );
    });

    const footer = container.querySelector('[data-testid="turn-working-indicator"]');

    expect(footer?.querySelector('[data-testid="turn-working-separator"]')?.textContent).toBe("•");
    expect(footer?.querySelector('[data-testid="turn-working-tokens"]')?.textContent).toBe(
      "303.0k tokens",
    );
  });
});
