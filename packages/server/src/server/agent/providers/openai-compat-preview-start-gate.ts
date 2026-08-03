import * as fs from "node:fs";

import {
  findLaunchConfiguration,
  LaunchConfigSchema,
  readLaunchConfig,
  resolveLaunchConfigPath,
  type LaunchConfiguration,
} from "../../preview/launch-config.js";

/**
 * Session-scoped guard behind preview_start's "interact" classification
 * (openai-compat-otto-tool-permissions.ts).
 *
 * "Dev servers run pre-authored launch.json commands" justifies auto-approving
 * preview_start in acceptEdits only while the config actually is pre-authored.
 * In acceptEdits the edit that authors it is auto-approved too, so without
 * this gate a session (or a prompt injection in anything the model reads)
 * could write `{"runtimeExecutable": "sh", "runtimeArgs": ["-c", ...]}` into
 * `.claude/launch.json` and preview_start it — shell execution with no prompt
 * anywhere, since DevServerManager spawns the entry with shell:true and no
 * allowlist.
 *
 * The blunt alternative — classifying preview_start as "execute" — prompts on
 * every server start in acceptEdits. Starting a preview is one of the most
 * common agent actions, and prompting every time pushes users toward
 * bypassPermissions, a net loss. The trade taken instead: auto-approval holds
 * while the entry's command (executable + args + env) matches what was on disk
 * when the session was constructed; an entry added or changed during the
 * session prompts once, showing the resolved command, and `approve()`
 * re-baselines it so the approved command stops prompting.
 *
 * Accepted residual: the snapshot is per session object, so a daemon restart
 * between the write and the preview_start re-baselines a changed config — a
 * restart is a user action, not something this tool chain can trigger.
 */
export interface PreviewStartCheck {
  /** The entry's command differs from (or is absent in) the session-start snapshot. */
  changed: boolean;
  /** Resolved command line to show in the permission prompt; null when the config or entry is missing. */
  command: string | null;
  /** Record the checked command as user-approved so it stops prompting. */
  approve: () => void;
}

export class PreviewStartGate {
  private readonly cwd: string;
  /** Entry name → command fingerprint as of session construction. */
  private readonly baseline: Map<string, string>;

  constructor(cwd: string) {
    this.cwd = cwd;
    // Snapshot synchronously: the whole point is capturing the config before
    // the session can execute a single tool call, and a sync read in the
    // constructor makes that ordering structural rather than a race against
    // the first turn. The file is a few hundred bytes; sessions are
    // constructed on user action, not in a hot path.
    this.baseline = snapshotCommands(cwd);
  }

  async check(serverName: string): Promise<PreviewStartCheck> {
    const config = await readLaunchConfig(this.cwd).catch(() => null);
    const entry = config ? findLaunchConfiguration(config, serverName) : undefined;
    if (!entry) {
      // Nothing resolvable: preview_start will reuse a running server or fail
      // before spawning anything, so there is no command to gate.
      return { changed: false, command: null, approve: noop };
    }
    const print = fingerprint(entry);
    return {
      changed: this.baseline.get(serverName) !== print,
      command: [entry.runtimeExecutable, ...entry.runtimeArgs].join(" "),
      approve: () => {
        this.baseline.set(serverName, print);
      },
    };
  }
}

function noop(): void {}

/**
 * A missing config snapshots as empty, and so does a malformed one: a file the
 * session could not vouch for at start must not vouch for any entry later.
 */
function snapshotCommands(cwd: string): Map<string, string> {
  const baseline = new Map<string, string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolveLaunchConfigPath(cwd), "utf8"));
  } catch {
    return baseline;
  }
  const result = LaunchConfigSchema.safeParse(parsed);
  if (!result.success) {
    return baseline;
  }
  for (const entry of result.data.configurations) {
    // First entry wins on a duplicate name, matching findLaunchConfiguration —
    // the duplicate that would actually run is the one that gets vouched for.
    if (!baseline.has(entry.name)) {
      baseline.set(entry.name, fingerprint(entry));
    }
  }
  return baseline;
}

/** Everything that decides what the spawn runs: executable, args, env (key order ignored). */
function fingerprint(entry: LaunchConfiguration): string {
  const env = entry.env
    ? Object.fromEntries(Object.entries(entry.env).sort(([a], [b]) => a.localeCompare(b)))
    : null;
  return JSON.stringify([entry.runtimeExecutable, entry.runtimeArgs, env]);
}
