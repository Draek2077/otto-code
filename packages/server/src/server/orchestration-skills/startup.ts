import type { Logger } from "pino";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import { createOrchestrationSkills, type OrchestrationSkills } from "./index.js";
import type { SkillTargets } from "./internal/operations.js";

export class SkillMaintenanceStoppedError extends Error {
  constructor() {
    super("Skill maintenance stopped with the daemon");
  }
}

interface StartupOrchestrationSkills extends OrchestrationSkills {
  dispose(): Promise<void>;
}

// COMPAT(desktopSkillSelectionMigration): added in v0.9.0; remove after 2027-03-05.
// Electron owns the legacy file. An attached desktop can arrive after this
// daemon starts, so only automatic maintenance waits for its durable selection.
export function createStartupOrchestrationSkills(
  configStore: DaemonConfigStore,
  options: {
    desktopManaged: boolean;
    logger: Pick<Logger, "info">;
    resolveTargets?: () => SkillTargets;
  },
): StartupOrchestrationSkills {
  const skills = createOrchestrationSkills(configStore, options.resolveTargets);
  const needsSelection =
    options.desktopManaged && configStore.get().skills?.selection === undefined;
  let release = () => {};
  let unsubscribe = () => {};
  let disposed = false;
  let maintenance: ReturnType<OrchestrationSkills["autoUpdate"]> | null = null;
  const selectionReady = needsSelection
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();

  if (needsSelection) {
    options.logger.info("Waiting for desktop skill selection before automatic maintenance");
    // onChange runs after persistence and every live config owner has committed.
    // This also honors an explicit settings/config write while import is pending.
    unsubscribe = configStore.onChange((config) => {
      if (config.skills?.selection === undefined) return;
      unsubscribe();
      release();
    });
  }

  return {
    ...skills,
    autoUpdate() {
      if (maintenance) return maintenance;
      // Never park this wait in the skills controller's serialized queue: import
      // must be able to enter that queue to persist the selection that releases it.
      maintenance = selectionReady
        .then(() => {
          if (disposed) throw new SkillMaintenanceStoppedError();
          return skills.autoUpdate();
        })
        .finally(() => {
          maintenance = null;
        });
      return maintenance;
    },
    async dispose() {
      disposed = true;
      unsubscribe();
      release();
      await maintenance?.catch(() => undefined);
    },
  };
}
