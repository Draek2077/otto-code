// Fails on high/critical npm advisories that land in code Otto actually ships,
// and stays silent on the build-tooling noise that `npm audit` cannot tell apart.
//
// Why this exists: `npm audit` reports ~70 advisories against this tree, but the
// lockfile `dev` flag is a whole-tree property, not a ship/no-ship classifier:
// Expo declares its CLI and Metro toolchain as production dependencies of
// packages/app, so a raw `npm audit --omit=dev` gate would page on bundler
// internals forever and get ignored (the 2026-08-02 Dependabot alert triage
// finding in Otto Knowledge measured this: 3 of 183 alerts reached a user).
// Instead, this script rebuilds the dependency graph from
// package-lock.json and BFS-walks production edges from the workspace roots
// that ship, pruning the build-chain entry points listed below.
//
// Run by .github/workflows/audit-shipped.yml on a weekly schedule; runnable
// locally with `node scripts/audit-shipped.mjs`. Needs only package-lock.json
// and registry access (audit runs --package-lock-only), not node_modules.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Workspace roots whose production dependency closure executes on a user's or
// operator's machine. Website is deliberately absent: it is deployed build
// output, reviewed with its own deploy workflow, not shipped to users.
const SHIPPED_ROOTS = [
  "packages/server",
  "packages/desktop",
  "packages/cli",
  "packages/relay",
  "packages/app",
];

// Packages that sit on production edges but are build/dev tooling that never
// executes in a shipped artifact. Pruned at entry-point granularity (the whole
// subtree below each is skipped) so this list stays short and every entry
// carries its justification. Growing this list is a reviewed decision, not a
// reflex: if an entry cannot be justified as "never runs in a shipped build",
// the advisory is real and the dependency should be fixed instead.
const PRUNED_SUBTREES = new Map([
  // Expo/React Native build chain. Metro bundles the app from its entry point;
  // none of these are traced into the bundle.
  ["@expo/cli", "Expo CLI: dev server and build orchestration"],
  ["@expo/metro", "Metro bundler fork: build time only"],
  ["@expo/metro-config", "Metro configuration: build time only"],
  ["@react-native/metro-config", "Metro configuration: build time only"],
  ["eas-cli", "Expo Application Services CLI: build/submit tooling"],
  ["expo-module-scripts", "Expo native-module build harness"],
  [
    "react-native-worklets",
    "pulls @react-native/metro-config; worklet runtime is bundled from source",
  ],
  // react-native declares its dev/test/build toolchain as production
  // dependencies; none of it is traced into a release bundle.
  ["@react-native/codegen", "RN native codegen: build time only"],
  ["@react-native/community-cli-plugin", "RN CLI/Metro dev-server integration"],
  ["@react-native/gradle-plugin", "Android build plugin"],
  ["babel-jest", "RN's jest preset: test time only"],
  ["jest-environment-node", "RN's jest preset: test time only"],
  // In-app dev servers and debugging bridges, wired only in __DEV__.
  ["react-devtools-core", "React DevTools bridge: dev builds only"],
  ["@react-native/dev-middleware", "RN debugger middleware: dev server only"],
  // Deployment tooling that packages/app lists as a production dependency.
  ["wrangler", "Cloudflare deploy CLI for the web build"],
  // EJS declares its own build tool as a production dependency; ejs/lib never
  // requires it (verified in the 2026-08-02 dependency-vulnerabilities finding).
  ["jake", "ejs build tool, installed but never imported at runtime"],
  // Glob-pattern matchers. Their advisory class is DoS via a malicious
  // *pattern*, and every pattern fed to them in shipped code is a first-party
  // constant, never attacker input. Trade-off, accepted and on record: a future
  // non-pattern advisory in these libraries would be invisible to this gate.
  ["glob", "pattern-DoS class; patterns are first-party constants"],
  ["minimatch", "pattern-DoS class; patterns are first-party constants"],
  ["brace-expansion", "pattern-DoS class; patterns are first-party constants"],
  ["picomatch", "pattern-DoS class; patterns are first-party constants"],
  ["anymatch", "pattern-DoS class; patterns are first-party constants"],
]);

// Advisories against a specific installed copy that were triaged as unreachable
// from any shipped surface. Keyed by exact lockfile path so a version bump or a
// tree move invalidates the entry instead of silently extending it.
const ALLOWLISTED_PATHS = new Map([
  // react-native's dev-mode inspector/debugger socket; release bundles contain
  // no Node ws. The daemon's own ws copy resolves elsewhere and stays gated.
  ["node_modules/react-native/node_modules/ws", "RN dev-server websocket, dev builds only"],
]);

function loadLock() {
  return JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
}

// npm's walk-up resolution: from the dependent's own nested node_modules up
// through each ancestor to the root.
function resolveDep(packages, fromPath, name) {
  let base = fromPath;
  for (;;) {
    const candidate = base === "" ? `node_modules/${name}` : `${base}/node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (base === "") return null;
    const cut = base.lastIndexOf("/node_modules/");
    base = cut === -1 ? "" : base.slice(0, cut);
  }
}

function shippedClosure(lock) {
  const packages = lock.packages;
  const closure = new Set();
  const queue = [];

  for (const root of SHIPPED_ROOTS) {
    if (!packages[root]) throw new Error(`workspace root missing from lockfile: ${root}`);
    queue.push(root);
  }

  while (queue.length > 0) {
    const current = queue.pop();
    let entry = packages[current];
    let path = current;
    if (entry.link && entry.resolved) {
      path = entry.resolved;
      entry = packages[path];
    }
    if (!entry || closure.has(path)) continue;
    closure.add(path);

    const deps = { ...entry.dependencies, ...entry.optionalDependencies };
    for (const name of Object.keys(deps)) {
      if (PRUNED_SUBTREES.has(name)) continue;
      const resolved = resolveDep(packages, path, name);
      // Unresolvable deps are unmet optionals (platform-specific binaries).
      if (resolved && !closure.has(resolved)) queue.push(resolved);
    }
  }
  return closure;
}

function runAudit() {
  try {
    return JSON.parse(
      execFileSync("npm", ["audit", "--json", "--package-lock-only"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        shell: process.platform === "win32",
      }),
    );
  } catch (error) {
    // npm audit exits non-zero when advisories exist; the JSON is still on stdout.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

const lock = loadLock();
const closure = shippedClosure(lock);
const audit = runAudit();

const failures = [];
for (const [name, vuln] of Object.entries(audit.vulnerabilities ?? {})) {
  if (vuln.severity !== "high" && vuln.severity !== "critical") continue;
  // npm also reports parents that are only affected through another package.
  // The underlying package is listed separately with its advisory object, so
  // only it can establish that a vulnerable node reaches the shipped closure.
  // Without this distinction, a shipped parent such as expo is reported even
  // when every affected CLI/Metro dependency is pruned as build tooling.
  const directAdvisories = vuln.via.filter((via) => typeof via === "object");
  if (directAdvisories.length === 0) continue;
  const shippedNodes = (vuln.nodes ?? []).filter(
    (node) => closure.has(node) && !ALLOWLISTED_PATHS.has(node),
  );
  if (shippedNodes.length === 0) continue;
  const advisories = directAdvisories.map((via) => `${via.title} (${via.url})`);
  failures.push({ name, severity: vuln.severity, shippedNodes, advisories });
}

console.log(
  `audit-shipped: ${closure.size} packages in the shipped closure, ` +
    `${Object.keys(audit.vulnerabilities ?? {}).length} advisory packages reported by npm audit`,
);

if (failures.length === 0) {
  console.log("audit-shipped: no high/critical advisories reach a shipped surface.");
  process.exit(0);
}

console.error(`\naudit-shipped: ${failures.length} advisory package(s) reach a shipped surface:\n`);
for (const failure of failures) {
  console.error(`- ${failure.name} [${failure.severity}]`);
  for (const node of failure.shippedNodes) console.error(`    at ${node}`);
  for (const advisory of failure.advisories) console.error(`    ${advisory}`);
  if (failure.advisories.length === 0) {
    console.error("    (flagged via a vulnerable dependency; see `npm audit` for the chain)");
  }
}
console.error(
  "\nFix the dependency if the code can execute in a shipped build. If it provably cannot,\n" +
    "prune its entry point in scripts/audit-shipped.mjs with a justification, and record the\n" +
    "reachability analysis as an Otto Knowledge finding.",
);
process.exit(1);
