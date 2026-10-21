// Paseo's stores parse with their own schemas and rewrite files without fields
// they do not know. An Otto 0.9 home carries Otto-only fields in those same files
// (per-project Kanban, Knowledge, artifact and workflow locations; agent
// personality and team data), so the first rewrite would drop them.
//
// Before Otto 0.10 first touches a home created by an earlier release, every store
// Paseo reads or rewrites is copied, unchanged, into otto-0.9-backup/. Otto
// features read their 0.9 data back from there. The snapshot is taken once.

import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { ensurePrivateDirectory, writePrivateFileAtomicSync } from "../private-files.js";

export const OTTO_HOME_SNAPSHOT_DIRNAME = "otto-0.9-backup";
const SNAPSHOT_COMPLETE_FILENAME = ".complete";
const INITIALIZED_MARKER_FILENAME = ".otto-0.10-initialized";

// Files and directories Paseo's stores own, plus the daemon identity files.
const PASEO_STORE_ENTRIES = [
  "config.json",
  "projects",
  "agents",
  "schedules",
  "agent-requests",
  "push-tokens.json",
  "server-id",
  "daemon-keypair.json",
  "forge-connections.json",
  "integration-authorizations.json",
];

// COMPAT(otto09HomeSnapshot): added in v0.10.0, remove after 2027-04-21 once 0.9 homes have migrated.
export function ensureOttoHomeSnapshot(home: string): void {
  const marker = path.join(home, INITIALIZED_MARKER_FILENAME);
  if (existsSync(marker)) return;

  // A home with no config.json is new: there is no earlier data to keep.
  if (existsSync(path.join(home, "config.json"))) {
    const snapshotDir = path.join(home, OTTO_HOME_SNAPSHOT_DIRNAME);
    if (!existsSync(path.join(snapshotDir, SNAPSHOT_COMPLETE_FILENAME))) {
      ensurePrivateDirectory(snapshotDir);
      const copied: string[] = [];
      for (const entry of PASEO_STORE_ENTRIES) {
        const source = path.join(home, entry);
        if (!existsSync(source)) continue;
        cpSync(source, path.join(snapshotDir, entry), { recursive: true, force: false });
        copied.push(entry);
      }
      writePrivateFileAtomicSync(
        path.join(snapshotDir, SNAPSHOT_COMPLETE_FILENAME),
        `${JSON.stringify({ takenAt: new Date().toISOString(), entries: copied }, null, 2)}\n`,
      );
    }
  }
  ensurePrivateDirectory(home);
  writePrivateFileAtomicSync(marker, `${new Date().toISOString()}\n`);
}
