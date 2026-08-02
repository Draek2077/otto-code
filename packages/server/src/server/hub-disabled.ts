/**
 * Hub is switched OFF in this fork, and this module is the switch.
 *
 * `docs/upstream-merges.md` records Hub as a permanent exclusion. It arrived
 * anyway with the Paseo v0.2.5 merge, already threaded through `bootstrap.ts`,
 * `session.ts` and `cli.ts`. Tearing that wiring back out would lose a fight
 * with every future upstream merge, because those are precisely the files
 * upstream keeps editing.
 *
 * So nothing is torn out. `server/hub/**` stays on disk, byte-identical to
 * upstream, and the construction blocks and call sites in bootstrap/session
 * stay byte-identical too. The only edit at each site is the *import
 * specifier*: those files now import these inert stand-ins instead of the real
 * controllers. Upstream can rewrite its hub wiring however it likes and git
 * will still auto-merge it, because our side of those lines never changed.
 *
 * The consequence that matters: `./hub/*.js` is no longer reachable from the
 * daemon's module graph, so V8 never parses or evaluates it. Off here means not
 * loaded, not merely unused.
 *
 * Type fidelity is free. Every `export type` below is erased at compile time,
 * so re-exporting the real modules' types costs nothing at runtime while
 * locking these stubs to upstream's interfaces. If upstream adds a method to
 * `HubRelationshipManagement`, this file stops typechecking. That alarm is the
 * point: a disabled subsystem should fail loudly when its contract moves, not
 * drift quietly out of shape.
 *
 * To re-enable, point the specifiers in `bootstrap.ts`, `session.ts` and
 * `cli.ts` back at the real modules and un-skip the suites tagged
 * `DISABLED(hub)`. One grep for `DISABLED(hub)` finds every piece.
 */
import type {
  DaemonExecutions as RealDaemonExecutions,
  HubExecutionAgentCreateInput,
  HubExecutionAgents,
  HubExecutionControlInput,
  OwnedAgentEvent,
  OwnedAgentSnapshot,
} from "./hub/daemon-executions.js";
import type { HubExecutionController as RealHubExecutionController } from "./hub/execution-controller.js";
import type { HubRelationshipController as RealHubRelationshipController } from "./hub/relationship-controller.js";
import type {
  HubRelationshipManagement,
  HubRelationshipStatus,
} from "./hub/relationship-controller.js";
import type {
  HubEnrollment,
  HubEnrollmentResult,
  HubRelationshipRemote,
  HubRevocation,
  HubSocketConnection,
  HubSocketCredentials,
  HubSocketEvents,
} from "./hub/relationship-remote.js";

// Re-exported so the redirected import sites keep their existing type imports
// working unchanged. `export type` is erased, so this pulls in no runtime code.
export type {
  HubConnectionState,
  HubRelationshipClock,
  HubRelationshipManagement,
  HubRelationshipRetryPolicy,
  HubRelationshipStatus,
} from "./hub/relationship-controller.js";
export type { HubRelationshipRemote } from "./hub/relationship-remote.js";
export type { HubExecutionAgents } from "./hub/daemon-executions.js";

/** Single message every disabled entry point reports, so the reason is greppable. */
export const HUB_DISABLED_MESSAGE =
  "Otto Hub is disabled in this build. See docs/upstream-merges.md.";

function hubDisabled(): Error {
  return new Error(HUB_DISABLED_MESSAGE);
}

/**
 * A relationship that is permanently "not connected". `status()` answers
 * truthfully rather than throwing, because the daemon polls it on ordinary
 * paths; only the state-changing calls refuse.
 */
const DISABLED_STATUS: HubRelationshipStatus = {
  state: "not_connected",
  daemonId: null,
  hubOrigin: null,
  scopes: [],
  connectedAt: null,
  lastError: null,
};

export class HubRelationshipController implements HubRelationshipManagement {
  // Options are accepted and dropped, but the signature is *derived* from the
  // real class rather than loosened to `unknown`. The construction blocks in
  // bootstrap.ts pass inline callbacks whose parameters are contextually typed
  // from here; `unknown` silently turned every one of them into an implicit
  // any. `ConstructorParameters` is a type-level read, so it stays erased.
  //
  // Not a useless constructor: deleting it deletes that contextual typing.
  // oxlint-disable-next-line no-useless-constructor
  constructor(_options: ConstructorParameters<typeof RealHubRelationshipController>[0]) {}

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  status(): HubRelationshipStatus {
    return { ...DISABLED_STATUS };
  }

  async connect(_input: { hubUrl: string; token: string }): Promise<HubRelationshipStatus> {
    throw hubDisabled();
  }

  async disconnect(_input: {
    force: boolean;
  }): Promise<{ status: HubRelationshipStatus; warning?: string }> {
    // Disconnecting something that was never connected is a no-op, not a fault.
    return { status: { ...DISABLED_STATUS } };
  }
}

export class DirectHubRelationshipRemote implements HubRelationshipRemote {
  async enroll(_input: HubEnrollment): Promise<HubEnrollmentResult> {
    throw hubDisabled();
  }

  async revoke(_input: HubRevocation): Promise<void> {
    throw hubDisabled();
  }

  openSocket(_input: HubSocketCredentials, _events: HubSocketEvents): HubSocketConnection {
    throw hubDisabled();
  }
}

export class DaemonExecutions implements HubExecutionAgents {
  // Carries the caller's contextual typing; see HubRelationshipController above.
  // oxlint-disable-next-line no-useless-constructor
  constructor(_options: ConstructorParameters<typeof RealDaemonExecutions>[0]) {}

  async create(_input: HubExecutionAgentCreateInput): Promise<OwnedAgentSnapshot> {
    throw hubDisabled();
  }

  async control(_input: HubExecutionControlInput): Promise<void> {
    throw hubDisabled();
  }

  subscribe(_listener: (event: OwnedAgentEvent) => void): () => void {
    return () => undefined;
  }

  async invalidateAuthority(): Promise<void> {}
}

/**
 * Only ever constructed when a session is handed `hubExecutionAgents`, which
 * arrives with an attached hub socket. No socket can attach, so in practice
 * this class is never instantiated; it exists to satisfy the import.
 */
export class HubExecutionController {
  // Carries the caller's contextual typing; see HubRelationshipController above.
  // oxlint-disable-next-line no-useless-constructor
  constructor(_options: ConstructorParameters<typeof RealHubExecutionController>[0]) {}

  async cleanup(): Promise<void> {}

  async controlExecution(
    _message: Parameters<RealHubExecutionController["controlExecution"]>[0],
  ): Promise<void> {
    throw hubDisabled();
  }

  async createAgent(
    _message: Parameters<RealHubExecutionController["createAgent"]>[0],
  ): Promise<void> {
    throw hubDisabled();
  }
}
