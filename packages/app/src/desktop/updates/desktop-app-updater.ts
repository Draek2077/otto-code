import type {
  DesktopAppUpdateCheckResult,
  DesktopAppUpdateCheckIntent,
  DesktopAppUpdateInstallResult,
  DesktopReleaseChannel,
} from "@/desktop/updates/desktop-updates";
import { i18n } from "@/i18n/i18next";

export type DesktopAppUpdateStatus =
  | "idle"
  | "checking"
  | "pending"
  | "up-to-date"
  | "available"
  | "installing"
  | "installed"
  | "error";

export const PENDING_RECHECK_MS = 10_000;

export interface DesktopAppUpdaterSnapshot {
  status: DesktopAppUpdateStatus;
  availableUpdate: DesktopAppUpdateCheckResult | null;
  errorMessage: string | null;
  installMessage: string | null;
  lastCheckedAt: number | null;
  isChecking: boolean;
  isInstalling: boolean;
}

export interface DesktopAppUpdaterPort {
  checkDesktopAppUpdate(input: {
    releaseChannel: DesktopReleaseChannel;
    intent: DesktopAppUpdateCheckIntent;
  }): Promise<DesktopAppUpdateCheckResult>;
  installDesktopAppUpdate(input: {
    releaseChannel: DesktopReleaseChannel;
  }): Promise<DesktopAppUpdateInstallResult>;
}

export interface DesktopAppUpdaterErrorReport {
  error: unknown;
  message: string;
  logLabel: string;
}

export interface DesktopAppUpdaterDeps {
  port: DesktopAppUpdaterPort;
  now(): number;
  reportInstallError?(report: DesktopAppUpdaterErrorReport): void;
}

export interface DesktopAppUpdater {
  getSnapshot(): DesktopAppUpdaterSnapshot;
  subscribe(listener: () => void): () => void;
  checkForUpdates(options?: {
    releaseChannel: DesktopReleaseChannel;
    intent?: DesktopAppUpdateCheckIntent;
    silent?: boolean;
  }): Promise<DesktopAppUpdateCheckResult | null>;
  installUpdate(options: {
    releaseChannel: DesktopReleaseChannel;
  }): Promise<DesktopAppUpdateInstallResult | null>;
}

interface InternalState {
  status: DesktopAppUpdateStatus;
  availableUpdate: DesktopAppUpdateCheckResult | null;
  errorMessage: string | null;
  installMessage: string | null;
  lastCheckedAt: number | null;
  isInstalling: boolean;
  requestVersion: number;
}

const INITIAL_STATE: InternalState = {
  status: "idle",
  availableUpdate: null,
  errorMessage: null,
  installMessage: null,
  lastCheckedAt: null,
  isInstalling: false,
  requestVersion: 0,
};

function buildSnapshot(state: InternalState): DesktopAppUpdaterSnapshot {
  return {
    status: state.status,
    availableUpdate: state.availableUpdate,
    errorMessage: state.errorMessage,
    installMessage: state.installMessage,
    lastCheckedAt: state.lastCheckedAt,
    isChecking: state.status === "checking",
    isInstalling: state.status === "installing" || state.isInstalling,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

/**
 * The "an update is on offer" line, for both the downloading (`pending`) and
 * ready-to-install (`available`) states. They differ only in the key prefix.
 */
function formatOfferedStatus(input: {
  key: "pending" | "available";
  availableUpdate: DesktopAppUpdateCheckResult | null;
  lastCheckedAt: number | null;
  formatVersion: (version: string | null | undefined) => string;
  formatLastCheckedAt: (timestamp: number) => string;
}): string {
  const { key, availableUpdate, lastCheckedAt, formatVersion, formatLastCheckedAt } = input;
  const checked = lastCheckedAt != null;
  const suffix = checked ? "AndLastChecked" : "";
  const time = checked ? formatLastCheckedAt(lastCheckedAt) : undefined;

  if (availableUpdate?.latestVersion) {
    return i18n.t(`desktop.updates.status.${key}WithVersion${suffix}`, {
      version: formatVersion(availableUpdate.latestVersion),
      time,
    });
  }

  if (checked) {
    return i18n.t(`desktop.updates.status.${key}WithLastChecked`, { time });
  }
  return i18n.t(`desktop.updates.status.${key}`);
}

export function formatStatusText(input: {
  status: DesktopAppUpdateStatus;
  availableUpdate: DesktopAppUpdateCheckResult | null;
  installMessage: string | null;
  lastCheckedAt: number | null;
  formatVersion: (version: string | null | undefined) => string;
  formatLastCheckedAt: (timestamp: number) => string;
}): string {
  const {
    status,
    availableUpdate,
    installMessage,
    lastCheckedAt,
    formatVersion,
    formatLastCheckedAt,
  } = input;

  if (status === "checking") {
    return i18n.t("desktop.updates.status.checking");
  }

  if (status === "installing") {
    return i18n.t("desktop.updates.status.installing");
  }

  if (status === "up-to-date") {
    if (lastCheckedAt != null) {
      return i18n.t("desktop.updates.status.upToDateWithLastChecked", {
        time: formatLastCheckedAt(lastCheckedAt),
      });
    }
    return i18n.t("desktop.updates.status.upToDate");
  }

  // An install that ended without installing leaves its reason here. It
  // outranks the plain "available"/"downloading" line, which would otherwise
  // read as though the user had never pressed the button.
  if (installMessage && (status === "pending" || status === "available")) {
    return installMessage;
  }

  if (status === "pending" || status === "available") {
    return formatOfferedStatus({
      key: status === "pending" ? "pending" : "available",
      availableUpdate,
      lastCheckedAt,
      formatVersion,
      formatLastCheckedAt,
    });
  }

  if (status === "installed") {
    return installMessage ?? i18n.t("desktop.updates.status.installed");
  }

  if (status === "error") {
    return i18n.t("desktop.updates.status.failed");
  }

  return i18n.t("desktop.updates.status.idle");
}

function resolveCheckedState(result: DesktopAppUpdateCheckResult): {
  status: DesktopAppUpdateStatus;
  availableUpdate: DesktopAppUpdateCheckResult | null;
} {
  if (result.readyToInstall) {
    return { status: "available", availableUpdate: result };
  }
  if (result.hasUpdate) {
    return { status: "pending", availableUpdate: result };
  }
  return { status: "up-to-date", availableUpdate: null };
}

export function createDesktopAppUpdater(deps: DesktopAppUpdaterDeps): DesktopAppUpdater {
  let state: InternalState = { ...INITIAL_STATE };
  let cachedSnapshot: DesktopAppUpdaterSnapshot = buildSnapshot(state);
  const listeners = new Set<() => void>();

  function commit(next: InternalState): void {
    state = next;
    cachedSnapshot = buildSnapshot(state);
    for (const listener of listeners) {
      listener();
    }
  }

  async function checkForUpdates(options?: {
    releaseChannel: DesktopReleaseChannel;
    intent?: DesktopAppUpdateCheckIntent;
    silent?: boolean;
  }): Promise<DesktopAppUpdateCheckResult | null> {
    if (!options) {
      return null;
    }
    const { releaseChannel, intent = "manual", silent = false } = options;
    if (silent && state.status === "checking") {
      return null;
    }

    const requestVersion = state.requestVersion + 1;

    commit({
      ...state,
      requestVersion,
      status: silent ? state.status : "checking",
      errorMessage: silent ? state.errorMessage : null,
    });

    try {
      const result = await deps.port.checkDesktopAppUpdate({ releaseChannel, intent });
      if (requestVersion !== state.requestVersion) {
        return result;
      }

      const nextLastCheckedAt = intent === "manual" ? deps.now() : state.lastCheckedAt;
      if (result.errorMessage) {
        if (silent && !result.hasUpdate) {
          console.warn("[DesktopUpdater] Silent update check failed", result.errorMessage);
          return result;
        }

        commit({
          ...state,
          status: "error",
          availableUpdate: null,
          errorMessage: result.errorMessage,
          installMessage: null,
          lastCheckedAt: nextLastCheckedAt,
        });
        return result;
      }

      // A silent background poll is not authoritative about absence: it runs on
      // the automatic intent, which the staged rollout can defer, and it fires
      // every PENDING_RECHECK_MS while an update downloads. Letting it clear an
      // update the user has already been shown is what made the pending state
      // reset itself to "up to date" mid-download. Only a check the user asked
      // for may take an update away.
      if (silent && !result.hasUpdate && state.availableUpdate) {
        return result;
      }

      const checked = resolveCheckedState(result);

      commit({
        ...state,
        status: checked.status,
        availableUpdate: checked.availableUpdate,
        errorMessage: null,
        installMessage: null,
        lastCheckedAt: nextLastCheckedAt,
      });

      return result;
    } catch (error) {
      if (requestVersion !== state.requestVersion) {
        return null;
      }

      const message = getErrorMessage(error);
      if (silent) {
        console.warn("[DesktopUpdater] Silent update check failed", message);
      } else {
        commit({
          ...state,
          status: "error",
          errorMessage: message,
          lastCheckedAt: intent === "manual" ? deps.now() : state.lastCheckedAt,
        });
      }
      return null;
    }
  }

  async function installUpdate(options: {
    releaseChannel: DesktopReleaseChannel;
  }): Promise<DesktopAppUpdateInstallResult | null> {
    const statusBeforeInstall = state.status;
    const updateBeforeInstall = state.availableUpdate;

    commit({
      ...state,
      status: "installing",
      errorMessage: null,
      isInstalling: true,
    });

    try {
      const result = await deps.port.installDesktopAppUpdate({
        releaseChannel: options.releaseChannel,
      });
      const nextLastCheckedAt = deps.now();

      if (result.outcome === "failed") {
        // Reporting a failed download as "up to date" is how a long download
        // that died looked identical to never having checked. Keep the update
        // on offer so the action is still there to retry.
        commit({
          ...state,
          status: "error",
          availableUpdate: updateBeforeInstall,
          errorMessage: result.message,
          installMessage: null,
          lastCheckedAt: nextLastCheckedAt,
          isInstalling: false,
        });
        return result;
      }

      if (!result.installed) {
        // Nothing installed, nothing wrong (superseded, still validating, or
        // handed to a manual download). Say so, and keep the offer.
        commit({
          ...state,
          status: statusBeforeInstall === "installing" ? "pending" : statusBeforeInstall,
          availableUpdate: updateBeforeInstall,
          installMessage: result.message,
          lastCheckedAt: nextLastCheckedAt,
          isInstalling: false,
        });
        return result;
      }

      commit({
        ...state,
        status: "installed",
        availableUpdate: null,
        installMessage: result.message,
        lastCheckedAt: nextLastCheckedAt,
        isInstalling: false,
      });
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      deps.reportInstallError?.({
        error,
        message: i18n.t("desktop.updates.installError"),
        logLabel: "[DesktopUpdater] Failed to install app update",
      });
      commit({
        ...state,
        status: "error",
        errorMessage: message,
        isInstalling: false,
      });
      return null;
    }
  }

  return {
    getSnapshot: () => cachedSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    checkForUpdates,
    installUpdate,
  };
}
