import { describe, expect, it } from "vitest";
import {
  localTranscriptDeliveryStateForPolicy,
  resolveMeetingTranscriptDeliveryDestination,
} from "./meeting-transcript-delivery-policy";

describe("resolveMeetingTranscriptDeliveryDestination", () => {
  const secureConnection = {
    type: "directTcp" as const,
    endpoint: "vm.example:6868",
    display: "vm.example:6868",
    encrypted: true,
  };
  const insecureConnection = { ...secureConnection, encrypted: false };

  it("keeps transcript text on the desktop when local-only is selected", () => {
    expect(
      resolveMeetingTranscriptDeliveryDestination({
        policy: "local_only",
        activeConnection: secureConnection,
        daemonAvailable: true,
      }),
    ).toBe("local");
  });

  it("requires the actual active connection to be encrypted by the secure policy", () => {
    expect(
      resolveMeetingTranscriptDeliveryDestination({
        policy: "require_secure_connection",
        activeConnection: secureConnection,
        daemonAvailable: true,
      }),
    ).toBe("daemon");
    expect(
      resolveMeetingTranscriptDeliveryDestination({
        policy: "require_secure_connection",
        activeConnection: insecureConnection,
        daemonAvailable: true,
      }),
    ).toBe("local");
  });

  it("allows the current connection only when the user explicitly selects it", () => {
    expect(
      resolveMeetingTranscriptDeliveryDestination({
        policy: "current_connection",
        activeConnection: insecureConnection,
        daemonAvailable: true,
      }),
    ).toBe("daemon");
  });

  it("retains text locally when no compatible daemon is available", () => {
    expect(
      resolveMeetingTranscriptDeliveryDestination({
        policy: "current_connection",
        activeConnection: secureConnection,
        daemonAvailable: false,
      }),
    ).toBe("local");
    expect(localTranscriptDeliveryStateForPolicy("require_secure_connection")).toBe(
      "waiting_for_secure_connection",
    );
  });
});
