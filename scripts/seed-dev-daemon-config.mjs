// Pin the dev daemon's listen address and a wildcard CORS allowlist into a dev
// home's config.json.
//
// Why this exists: the desktop daemon-manager decides whether a daemon is
// already running by reading `daemon.listen` out of config.json — it does NOT
// honor the OTTO_LISTEN env var. Without this file being seeded, a dev app
// reads the default 6868, finds the *installed* app's daemon sitting there, and
// wires the dev client straight into production state.
//
// The wildcard CORS entry is what lets Electron and Metro on their shifting
// localhost ports reach the dev daemon. It is safe only because the dev daemon
// binds to loopback. That is also why this must ONLY ever be pointed at a
// script-managed dev home: run against a real `~/.otto` it would rewrite a
// production config with the dev port and an open CORS allowlist.
//
// Usage: node scripts/seed-dev-daemon-config.mjs <configPath> <listen>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [configPath, listen] = process.argv.slice(2);

if (!configPath || !listen) {
  console.error("usage: seed-dev-daemon-config.mjs <configPath> <listen>");
  process.exit(1);
}

let config = {};
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  // No config yet, or an unreadable one — start from scratch rather than
  // refusing to boot the dev daemon.
}

config.version = config.version ?? 1;
config.daemon = config.daemon ?? {};
config.daemon.listen = listen;
config.daemon.cors = config.daemon.cors ?? {};
config.daemon.cors.allowedOrigins = ["*"];

mkdirSync(path.dirname(configPath), { recursive: true });
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
