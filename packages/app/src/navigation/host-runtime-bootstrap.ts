import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { DaemonStartResult } from "@/runtime/daemon-start-service";
import type { AppStartScreen } from "@/hooks/use-settings/storage";
import type { Href } from "expo-router";
import {
  buildHostRootRoute,
  buildHostWorkspaceRoute,
  buildOpenProjectRoute,
  buildSetupRoute,
  buildStatsRoute,
} from "@/utils/host-routes";

export interface HostRuntimeBootstrapStore {
  boot: () => void;
}

export interface HostRuntimeBootstrapDaemonStartService {
  start: () => Promise<DaemonStartResult>;
}

type HostRuntimeBootstrapStartGate = boolean | (() => boolean | Promise<boolean>);

export interface StartHostRuntimeBootstrapInput {
  store: HostRuntimeBootstrapStore;
  daemonStartService: HostRuntimeBootstrapDaemonStartService;
  shouldStartDaemon: HostRuntimeBootstrapStartGate;
  onGateError?: (message: string) => void;
}

export function startHostRuntimeBootstrap(input: StartHostRuntimeBootstrapInput): void {
  input.store.boot();
  startDaemonIfGateAllows({
    daemonStartService: input.daemonStartService,
    shouldStartDaemon: input.shouldStartDaemon,
    onGateError: input.onGateError,
  });
}

export function startDaemonIfGateAllows(input: {
  daemonStartService: HostRuntimeBootstrapDaemonStartService;
  shouldStartDaemon: HostRuntimeBootstrapStartGate;
  onGateError?: (message: string) => void;
}): void {
  const gate = input.shouldStartDaemon;
  if (typeof gate === "boolean") {
    if (gate) {
      void input.daemonStartService.start();
    }
    return;
  }

  void Promise.resolve()
    .then(() => gate())
    .then((shouldStartDaemon) => {
      if (shouldStartDaemon) {
        void input.daemonStartService.start();
      }
      return null;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      input.onGateError?.(`Failed to evaluate desktop daemon settings: ${message}`);
    });
}

const WELCOME_ROUTE: Href = "/welcome";
const SETUP_ROUTE: Href = buildSetupRoute();

export type StartupBlocker =
  | { kind: "none" }
  | { kind: "managed-daemon-starting" }
  | { kind: "managed-daemon-error"; message: string };

export interface ResolveStartupBlockerInput {
  isDesktopRuntime: boolean;
  anyOnlineHostServerId: string | null;
  daemonStartIsRunning: boolean;
  daemonStartError: string | null;
}

export function resolveStartupBlocker(input: ResolveStartupBlockerInput): StartupBlocker {
  if (!input.isDesktopRuntime) {
    return { kind: "none" };
  }

  if (input.anyOnlineHostServerId) {
    return { kind: "none" };
  }

  if (input.daemonStartError) {
    return { kind: "managed-daemon-error", message: input.daemonStartError };
  }

  if (input.daemonStartIsRunning) {
    return { kind: "managed-daemon-starting" };
  }

  return { kind: "none" };
}

export function resolveStartupNavigationReady(input: { startupBlocker: StartupBlocker }): boolean {
  return input.startupBlocker.kind !== "managed-daemon-starting";
}

export function shouldRunStartupGiveUpTimer(input: {
  startupBlocker: StartupBlocker;
  anyOnlineHostServerId: string | null;
  hasGivenUpWaitingForHost: boolean;
}): boolean {
  if (input.anyOnlineHostServerId) {
    return false;
  }
  if (input.hasGivenUpWaitingForHost) {
    return false;
  }
  return input.startupBlocker.kind === "none";
}

export type StartupRegistryStatus = "loading" | "ready";

export interface IndexStartupRouteTarget {
  kind: "index";
  pathname: string;
}

export interface HostStartupRouteTarget {
  kind: "host";
  serverId: string | null;
}

export type StartupRouteTarget = IndexStartupRouteTarget | HostStartupRouteTarget;

interface ResolveStartupRouteBaseInput {
  startupBlocker: StartupBlocker;
  hostRegistryStatus: StartupRegistryStatus;
  hosts: readonly { serverId: string }[];
}

export interface ResolveIndexStartupRouteInput extends ResolveStartupRouteBaseInput {
  route: IndexStartupRouteTarget;
  anyOnlineHostServerId: string | null;
  workspaceSelection: ActiveWorkspaceSelection | null;
  workspaceSelectionStatus: WorkspaceSelectionStatus;
  isWorkspaceSelectionLoaded: boolean;
  hasGivenUpWaitingForHost: boolean;
  // First-run setup wizard gate. `hasCompletedSetupWizard` is the device-local
  // flag (backfilled `true` for existing devices, so only genuinely fresh
  // installs are `false`); `isSetupWizardStateLoaded` guards against the
  // unhydrated `false` default flashing the wizard in front of a returning user.
  hasCompletedSetupWizard: boolean;
  isSetupWizardStateLoaded: boolean;
}

export interface ResolveHostStartupRouteInput extends ResolveStartupRouteBaseInput {
  route: HostStartupRouteTarget;
}

export type ResolveStartupRouteInput = ResolveIndexStartupRouteInput | ResolveHostStartupRouteInput;

export type StartupRouteDecision =
  | { kind: "render" }
  | { kind: "splash" }
  | { kind: "redirect"; href: Href };

export type WorkspaceSelectionStatus = "unknown" | "exists" | "missing";

function shouldRestoreWorkspaceSelection(input: {
  workspaceSelection: ActiveWorkspaceSelection | null;
  workspaceSelectionStatus: WorkspaceSelectionStatus;
}): input is {
  workspaceSelection: ActiveWorkspaceSelection;
  workspaceSelectionStatus: Exclude<WorkspaceSelectionStatus, "missing">;
} {
  return input.workspaceSelection !== null && input.workspaceSelectionStatus !== "missing";
}

export function resolveWorkspaceSelectionStatus(input: {
  hasHydratedWorkspaces: boolean;
  workspaceExists: boolean;
}): WorkspaceSelectionStatus {
  if (input.workspaceExists) {
    return "exists";
  }
  return input.hasHydratedWorkspaces ? "missing" : "unknown";
}

export function resolveHostIndexRoute(input: {
  serverId: string;
  workspaceSelection: ActiveWorkspaceSelection | null;
  workspaceSelectionStatus: WorkspaceSelectionStatus;
  // Device-local "how the app starts" preference. Defaults to "workspaces"
  // (today's restore-last-workspace behavior) when omitted, so callers that
  // haven't hydrated the setting yet behave exactly like before this existed.
  appStartScreen?: AppStartScreen;
}): Href {
  if (input.appStartScreen === "dashboard") {
    return buildStatsRoute();
  }
  if (input.appStartScreen === "home") {
    return buildOpenProjectRoute();
  }
  if (
    input.workspaceSelection?.serverId === input.serverId &&
    shouldRestoreWorkspaceSelection(input)
  ) {
    return buildHostWorkspaceRoute(input.serverId, input.workspaceSelection.workspaceId);
  }
  return buildOpenProjectRoute();
}

function isIndexPathname(pathname: string) {
  return pathname === "/" || pathname === "";
}

function hostExists(hosts: readonly { serverId: string }[], serverId: string | null): boolean {
  if (!serverId) {
    return false;
  }
  return hosts.some((host) => host.serverId === serverId);
}

function resolveReadyIndexStartupRoute(input: ResolveIndexStartupRouteInput): StartupRouteDecision {
  if (!isIndexPathname(input.route.pathname)) {
    return { kind: "render" };
  }

  if (!input.isWorkspaceSelectionLoaded) {
    return { kind: "splash" };
  }

  // First-run setup wizard: a fresh device (flag `false`) with an ONLINE host
  // to configure runs the wizard before any host/workspace routing (Mode →
  // Providers → … → Done). Existing devices are backfilled to completed
  // (migrateSetupWizardFlag), so they never see it. Wait for the flag to load so
  // the unhydrated `false` default can't flash the wizard in front of a
  // returning user. A device with no online host falls through to the welcome/pair
  // flow below — there is nothing to configure yet (the providers step requires
  // a live connection to fetch provider details).
  if (!input.isSetupWizardStateLoaded) {
    return { kind: "splash" };
  }
  if (!input.hasCompletedSetupWizard && input.anyOnlineHostServerId !== null) {
    return { kind: "redirect", href: SETUP_ROUTE };
  }

  if (
    shouldRestoreWorkspaceSelection(input) &&
    hostExists(input.hosts, input.workspaceSelection.serverId)
  ) {
    // Native cold launch must enter the host boundary first. The host index
    // owns workspace restore after its local dynamic params exist.
    return {
      kind: "redirect",
      href: buildHostRootRoute(input.workspaceSelection.serverId),
    };
  }

  if (input.anyOnlineHostServerId) {
    return { kind: "redirect", href: buildHostRootRoute(input.anyOnlineHostServerId) };
  }

  const savedHostServerId = input.hosts[0]?.serverId ?? null;
  if (savedHostServerId) {
    return { kind: "redirect", href: buildHostRootRoute(savedHostServerId) };
  }

  if (input.hasGivenUpWaitingForHost) {
    return { kind: "redirect", href: WELCOME_ROUTE };
  }

  return { kind: "splash" };
}

function resolveReadyHostStartupRoute(input: ResolveHostStartupRouteInput): StartupRouteDecision {
  if (hostExists(input.hosts, input.route.serverId)) {
    return { kind: "render" };
  }

  const fallbackServerId = input.hosts[0]?.serverId ?? null;
  if (fallbackServerId) {
    return { kind: "redirect", href: buildOpenProjectRoute() };
  }

  return { kind: "redirect", href: WELCOME_ROUTE };
}

function isHostStartupRouteInput(
  input: ResolveStartupRouteInput,
): input is ResolveHostStartupRouteInput {
  return input.route.kind === "host";
}

export function resolveStartupRoute(input: ResolveStartupRouteInput): StartupRouteDecision {
  if (isHostStartupRouteInput(input)) {
    if (input.startupBlocker.kind !== "none" || input.hostRegistryStatus === "loading") {
      return { kind: "render" };
    }
    return resolveReadyHostStartupRoute(input);
  }

  if (input.startupBlocker.kind !== "none") {
    return { kind: "splash" };
  }

  if (input.hostRegistryStatus === "loading") {
    return { kind: "splash" };
  }

  return resolveReadyIndexStartupRoute(input);
}
