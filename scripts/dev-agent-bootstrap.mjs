// Bootstraps the agent lane's OTTO_HOME so an agent does not have to click
// through provider setup on every run. Idempotent — safe to re-run.
//
// Usage: node scripts/dev-agent-bootstrap.mjs [--from <otherHome>] [--force]
//
// Copies the *durable, machine-local* half of a source home's config.json —
// provider endpoints and API keys, model tier overrides, personalities, teams,
// feature flags — into the agent home. Deliberately does NOT copy `daemon.*`:
// the lane's listen address and CORS allowlist are its own, and inheriting the
// source's `daemon.listen` is exactly how a lane ends up answering on someone
// else's port (see scripts/seed-dev-daemon-config.mjs).
//
// The other half of a bootstrap is device-local app settings (the first-run
// wizard and tour flags), which live in the *client's* AsyncStorage — for Expo
// web that is localStorage on the Metro origin, not anywhere under OTTO_HOME.
// This script cannot reach it, so it prints the one-liner to run in the browser.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devStateDir = path.join(repoRoot, "packages", "desktop", ".dev");

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}

const targetHome = process.env.OTTO_DEV_HOME ?? path.join(devStateDir, "agent-home");
const sourceHome = flag("--from") ?? path.join(devStateDir, "otto-home");
const force = args.includes("--force");

// Keys under `agents` worth inheriting. Anything not listed is left alone, so a
// new setting never silently leaks between lanes.
const AGENT_KEYS = [
  "savedProviderEndpoints",
  "providers",
  "modelTierOverrides",
  "agentPersonalities",
  "agentTeams",
  "metadataGeneration",
];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const source = readJson(path.join(sourceHome, "config.json"));
if (!source) {
  console.error(`No readable config.json in ${sourceHome} — nothing to bootstrap from.`);
  process.exit(1);
}

const targetConfigPath = path.join(targetHome, "config.json");
const target = readJson(targetConfigPath) ?? { version: 1 };

target.agents = target.agents ?? {};
const copied = [];
const skipped = [];
for (const key of AGENT_KEYS) {
  if (source.agents?.[key] === undefined) continue;
  if (target.agents[key] !== undefined && !force) {
    skipped.push(key);
    continue;
  }
  target.agents[key] = source.agents[key];
  copied.push(key);
}

if (source.features !== undefined && (target.features === undefined || force)) {
  target.features = source.features;
  copied.push("features");
} else if (source.features !== undefined) {
  skipped.push("features");
}

mkdirSync(targetHome, { recursive: true });
writeFileSync(targetConfigPath, `${JSON.stringify(target, null, 2)}\n`);

console.log(`bootstrapped ${targetConfigPath}`);
console.log(`  from    ${sourceHome}`);
console.log(`  copied  ${copied.length ? copied.join(", ") : "(nothing)"}`);
if (skipped.length) {
  console.log(`  kept    ${skipped.join(", ")}  (already set; pass --force to overwrite)`);
}
console.log(
  `  daemon.listen left untouched: ${target.daemon?.listen ?? "(unset — set on launch)"}`,
);

const metroPort = process.env.OTTO_AGENT_METRO_PORT ?? "8095";
console.log(
  [
    "",
    "Client-side half — run this once in the browser pane on the lane's origin",
    `(http://localhost:${metroPort}), then reload. It skips the first-run wizard`,
    "and the spotlight tour, which live in localStorage, not OTTO_HOME:",
    "",
    "  (() => {",
    '    const k = "@otto:app-settings";',
    '    const s = JSON.parse(localStorage.getItem(k) || "{}");',
    '    Object.assign(s, { hasCompletedSetupWizard: true, hasCompletedTutorial: true, interfaceMode: "developer" });',
    "    localStorage.setItem(k, JSON.stringify(s));",
    "    return s.hasCompletedSetupWizard;",
    "  })()",
    "",
  ].join("\n"),
);

if (!existsSync(path.join(targetHome, "server-id"))) {
  console.log("Note: no server-id yet — start the lane once so the daemon mints its identity.");
}
