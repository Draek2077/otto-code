/**
 * COMPAT(profileStorePaths): added in v0.8.13, remove after 2027-02-22.
 *
 * Move the two personality-named stores under `$OTTO_HOME` onto profile names,
 * so the on-disk layout matches the converged vocabulary:
 *
 *   personality-memory/            -> profile-memory/
 *   stats/personality-usage.json   -> stats/profile-usage.json
 *
 * Both hold real user data - accrued lessons and spawn counts - so this is a
 * rename, never a recreate. A rename on one filesystem is atomic, which is why
 * this is a startup pass rather than the read-side normalization the stored
 * agent records use: there is no partially-renamed directory to tolerate.
 *
 * The old path is left alone whenever the new one already exists. That is the
 * downgrade case (a newer daemon migrated, an older one recreated the old path,
 * a newer one starts again) and the new path is the one carrying current data.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";

interface RenamePlan {
  from: string;
  to: string;
  label: string;
}

export async function migrateProfileStorePaths(options: {
  ottoHome: string;
  logger?: Logger;
}): Promise<void> {
  const plans: RenamePlan[] = [
    {
      from: path.join(options.ottoHome, "personality-memory"),
      to: path.join(options.ottoHome, "profile-memory"),
      label: "profile memory",
    },
    {
      from: path.join(options.ottoHome, "stats", "personality-usage.json"),
      to: path.join(options.ottoHome, "stats", "profile-usage.json"),
      label: "profile usage stats",
    },
  ];

  for (const plan of plans) {
    await renameIfOnlyLegacyExists(plan, options.logger);
  }
}

async function renameIfOnlyLegacyExists(plan: RenamePlan, logger?: Logger): Promise<void> {
  if (!(await exists(plan.from))) {
    return;
  }
  if (await exists(plan.to)) {
    logger?.debug(
      { from: plan.from, to: plan.to },
      "Both profile store paths exist; keeping the current one",
    );
    return;
  }
  try {
    await fs.rename(plan.from, plan.to);
    logger?.info({ from: plan.from, to: plan.to }, `Migrated ${plan.label} to its profile path`);
  } catch (error) {
    // A failure here must not stop the daemon starting. The store simply reads
    // an empty new path this run, and the old data is still on disk untouched
    // for the next attempt.
    logger?.warn({ err: error, from: plan.from, to: plan.to }, `Could not migrate ${plan.label}`);
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}
