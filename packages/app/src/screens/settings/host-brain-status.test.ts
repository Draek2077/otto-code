import { describe, expect, it } from "vitest";
import type { BrainHostStatus, MutableBrainConfig } from "@otto-code/protocol/messages";
import {
  buildBrainStatusDetails,
  formatConfiguredBrainEndpoint,
  formatDetectedBrainEndpoint,
  resolveBrainConnectionPhase,
} from "./host-brain-status";

const localBrain = {
  enabled: true,
  mode: "local",
  listen: { host: "127.0.0.1", port: 1234 },
  tls: { mode: "off" },
} as MutableBrainConfig;

const remoteBrain = {
  ...localBrain,
  mode: "remote",
  remote: { host: "brain.example.test", port: 443, secure: true },
} as MutableBrainConfig;

describe("Host Brain connection status", () => {
  it("shows the endpoint implied by local and remote settings", () => {
    expect(formatConfiguredBrainEndpoint(localBrain)).toBe("http://127.0.0.1:1234");
    expect(formatConfiguredBrainEndpoint(remoteBrain)).toBe("https://brain.example.test:443");
  });

  it("formats the endpoint reported by the detected Brain", () => {
    expect(
      formatDetectedBrainEndpoint({
        host: "0.0.0.0",
        displayHost: "brain.tail.test",
        port: 8443,
        secure: true,
      } as BrainHostStatus),
    ).toBe("https://brain.tail.test:8443");
  });

  it("keeps configured and detected server identity together", () => {
    expect(
      buildBrainStatusDetails(remoteBrain, {
        running: true,
        state: "running",
        displayHost: "brain.tail.test",
        port: 8443,
        secure: true,
        version: "0.8.15",
        model: "Qwen",
      } as BrainHostStatus),
    ).toEqual([
      { title: "Configured endpoint", value: "https://brain.example.test:443" },
      { title: "Detected endpoint", value: "https://brain.tail.test:8443" },
      { title: "Version", value: "0.8.15" },
      { title: "State", value: "running" },
      { title: "Model", value: "Qwen" },
    ]);
  });

  it("distinguishes connected, stopped, disabled, and unreachable states", () => {
    const connected = { running: true, state: "running" } as BrainHostStatus;
    expect(
      resolveBrainConnectionPhase({
        brain: localBrain,
        status: connected,
        hostConnected: true,
        loading: false,
        failed: false,
      }),
    ).toBe("connected");
    expect(
      resolveBrainConnectionPhase({
        brain: localBrain,
        status: null,
        hostConnected: true,
        loading: false,
        failed: false,
      }),
    ).toBe("stopped");
    expect(
      resolveBrainConnectionPhase({
        brain: { ...localBrain, enabled: false },
        status: null,
        hostConnected: true,
        loading: false,
        failed: false,
      }),
    ).toBe("disabled");
    expect(
      resolveBrainConnectionPhase({
        brain: remoteBrain,
        status: null,
        hostConnected: true,
        loading: false,
        failed: false,
      }),
    ).toBe("unreachable");
  });
});
