/**
 * Resolves the install directories of a provider's *enabled plugins*, so their
 * skills and subagents can be weighed alongside the user's own.
 *
 * This exists because the roster the scanner used to measure was a small
 * fraction of the real one. Skills and subagents contributed by plugins are
 * advertised by name and description on every request exactly like hand-written
 * ones - a host with five plugins enabled can carry dozens of roster entries the
 * scan reported as zero, which understates a category users are explicitly told
 * they can control by disabling things.
 *
 * Unlike `resolveSkillRoots`, this cannot be a pure function of the paths: which
 * plugins are enabled lives in the provider's settings on disk, so resolution is
 * async and best-effort. A malformed or absent settings file means "no plugins",
 * never a failed scan.
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Settings files in precedence order, lowest first. A later file's
 * `enabledPlugins` entry overrides an earlier one for the same key, which is how
 * a local override disables a globally enabled plugin.
 */
const SETTINGS_FILE_NAMES = ["settings.json", "settings.local.json"];

interface PluginKey {
  plugin: string;
  marketplace: string;
}

/**
 * Install roots for every enabled plugin, e.g.
 * `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>`.
 *
 * Returns an empty array - never throws - when settings are absent, unreadable
 * or malformed. A plugin listed in settings but not present on disk is simply
 * skipped: settings record intent, the filesystem records reality.
 */
export async function resolveEnabledPluginRoots(configDir: string): Promise<string[]> {
  const enabled = await readEnabledPlugins(configDir);
  const roots: string[] = [];
  for (const key of enabled) {
    const pluginDir = path.join(configDir, "plugins", "cache", key.marketplace, key.plugin);
    // The version directory is an implementation detail of the plugin cache and
    // is sometimes the literal string "unknown", so it is discovered rather than
    // assumed. Every version present contributes: a stale copy left behind is a
    // cache artifact, and guessing which one loads would be a fabrication.
    for (const versionDir of await listDirectories(pluginDir)) {
      roots.push(versionDir);
    }
  }
  return roots;
}

/**
 * `enabledPlugins` keys are `"<plugin>@<marketplace>"`. Entries set to false are
 * dropped here, so downstream code never has to know the format.
 */
function parsePluginKey(raw: string): PluginKey | null {
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return null;
  return { plugin: raw.slice(0, at), marketplace: raw.slice(at + 1) };
}

async function readEnabledPlugins(configDir: string): Promise<PluginKey[]> {
  const merged = new Map<string, boolean>();
  for (const fileName of SETTINGS_FILE_NAMES) {
    const settings = await readJsonObject(path.join(configDir, fileName));
    const entries = settings?.["enabledPlugins"];
    if (!isRecord(entries)) continue;
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value === "boolean") merged.set(key, value);
    }
  }

  const keys: PluginKey[] = [];
  for (const [raw, isEnabled] of merged) {
    if (!isEnabled) continue;
    const parsed = parsePluginKey(raw);
    if (parsed) keys.push(parsed);
  }
  return keys;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // Hand-edited settings files are routinely mid-edit and invalid. That is a
    // reason to report no plugins, not to fail the workspace's whole report.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listDirectories(parent: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name));
}
