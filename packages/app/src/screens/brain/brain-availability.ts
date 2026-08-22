import type { BrainHostStatus } from "@otto-code/protocol/messages";

export interface BrainAvailabilityMessage {
  title: string;
  description: string;
}

export type BrainOverviewPhase = "running" | "starting" | "stopped" | "failed";

function errorDescription(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "The brain did not answer on this host.";
}

/**
 * Resolve the user-facing state for tabs that need the brain to answer.
 * Capability absence is meaningful only after the brain is known to be up.
 */
export function resolveBrainAvailability({
  isConnected,
  status,
  statusError,
}: {
  isConnected: boolean;
  status: BrainHostStatus | null;
  statusError?: unknown;
}): BrainAvailabilityMessage | null {
  if (!isConnected) {
    return {
      title: "This host is not connected",
      description:
        "Otto cannot reach this host's daemon, so the brain is unavailable. Start the daemon on that machine and try again.",
    };
  }

  if (statusError) {
    return {
      title: "The brain is unavailable",
      description: errorDescription(statusError),
    };
  }

  if (!status || status.running) return null;

  if (status.lastError) {
    return {
      title: "The brain is unavailable",
      description: status.lastError,
    };
  }

  if (status.state === "stopped") {
    return {
      title: "The brain is stopped",
      description: "Start the brain on this host to use this tab.",
    };
  }

  if (status.state === "failed") {
    return {
      title: "The brain failed to start",
      description: "The brain did not start on this host. Check the Brain Overview for details.",
    };
  }

  if (status.state === "starting") return null;

  return {
    title: "The brain is unavailable",
    description: "The brain is not running on this host.",
  };
}

export function resolveBrainOverviewError({
  isConnected,
  error,
  phase,
  lastError,
}: {
  isConnected: boolean;
  error: unknown;
  phase: BrainOverviewPhase;
  lastError: string | null | undefined;
}): BrainAvailabilityMessage | null {
  if (!isConnected) {
    return {
      title: "This host is not connected",
      description: "Otto cannot reach this host's daemon, so the brain status is unavailable.",
    };
  }
  if (error) {
    return {
      title: "The brain stopped",
      description: error instanceof Error ? error.message : String(error),
    };
  }
  if (phase === "failed") {
    return {
      title: "The brain stopped",
      description: lastError ?? "The brain did not answer on this host.",
    };
  }
  return null;
}
