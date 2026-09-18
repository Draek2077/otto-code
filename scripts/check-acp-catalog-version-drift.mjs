#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const CATALOG_PATH = new URL("../packages/app/src/data/acp-provider-catalog.ts", import.meta.url);
const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+].*)?$/;

// ACP registry agents that deliberately have no catalog entry. A registry agent
// that is neither in the catalog nor listed here fails the check, so a new
// agent gets a decision at release time instead of going unnoticed.
const REGISTRY_EXCLUSIONS = {
  "claude-acp": "built-in Otto provider",
  "codex-acp": "built-in Otto provider",
  "github-copilot-cli": "built-in Otto provider",
  opencode: "built-in Otto provider",
  "pi-acp": "built-in Otto provider",
  "antigravity-acp":
    "ships only as a downloaded archive whose launcher is not a PATH command, so a catalog entry could not start it",
};

// Registry ids that the catalog carries under an older id. Renaming a catalog
// id would orphan every installed provider config that references it.
const REGISTRY_ID_ALIASES = {
  "grok-build": "grok",
};

const HELP_TEXT = `Usage: npm run acp:version-drift [-- --json] [-- --fail-on-drift] [-- --no-network] [-- --update]

Checks package-runner ACP catalog entries for exact latest registry pins, the
version labels of installed-command entries against the ACP registry, and the
catalog's coverage of the ACP registry.

By default this is report-only. Add --fail-on-drift to exit non-zero when drift is found.
Add --update to rewrite package-runner pins and installed-command version labels.
Registry coverage gaps are never auto-fixed: add the entry or an exclusion with a reason.`;

function parseArgs(argv) {
  const options = {
    json: false,
    failOnDrift: false,
    noNetwork: false,
    update: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--fail-on-drift") {
      options.failOnDrift = true;
    } else if (arg === "--no-network") {
      options.noNetwork = true;
    } else if (arg === "--update") {
      options.update = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(HELP_TEXT);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${HELP_TEXT}`);
    }
  }

  if (options.update && options.noNetwork) {
    throw new Error("--update requires registry access; remove --no-network");
  }

  return options;
}

function getCatalogBodyRange(source) {
  const startToken = "const CATALOG_DATA = [";
  const startIndex = source.indexOf(startToken);
  if (startIndex === -1) {
    throw new Error("Could not find CATALOG_DATA in ACP provider catalog");
  }

  const arrayStartIndex = source.indexOf("[", startIndex);
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = arrayStartIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return { start: arrayStartIndex + 1, end: index };
      }
    }
  }

  throw new Error("Could not parse CATALOG_DATA array");
}

function extractEntryBlocks(source) {
  const range = getCatalogBodyRange(source);
  const blocks = [];
  let blockStart = null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = range.start; index < range.end; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) {
        blockStart = index;
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && blockStart !== null) {
        blocks.push({
          start: blockStart,
          end: index + 1,
          block: source.slice(blockStart, index + 1),
        });
        blockStart = null;
      }
    }
  }

  return blocks;
}

function getStringField(block, fieldName) {
  const match = new RegExp(`${fieldName}:\\s*"([^"]+)"`).exec(block);
  return match?.[1] ?? null;
}

function getCommandField(block) {
  const match = /command:\s*(\[[^\]]+\])/.exec(block);
  if (!match?.[1]) {
    return null;
  }
  return JSON.parse(match[1]);
}

function parseCatalogEntries(source) {
  return extractEntryBlocks(source).map((entryBlock) => ({
    id: getStringField(entryBlock.block, "id"),
    title: getStringField(entryBlock.block, "title"),
    version: getStringField(entryBlock.block, "version"),
    command: getCommandField(entryBlock.block),
    start: entryBlock.start,
    end: entryBlock.end,
  }));
}

function findNpmPackageSpec(command) {
  const argsStartIndex = command[0] === "npm" && command[1] === "exec" ? 2 : 1;
  for (let index = argsStartIndex; index < command.length; index += 1) {
    const arg = command[index];
    if (arg === "--") {
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return { registry: "npm", spec: arg, index };
  }
  return null;
}

function findUvxPackageSpec(command) {
  const fromIndex = command.indexOf("--from");
  if (fromIndex !== -1 && command[fromIndex + 1]) {
    return { registry: "pypi", spec: command[fromIndex + 1], index: fromIndex + 1, usesFrom: true };
  }

  for (let index = 1; index < command.length; index += 1) {
    const arg = command[index];
    if (arg.startsWith("-")) {
      continue;
    }
    return { registry: "pypi", spec: arg, index, usesFrom: false };
  }

  return null;
}

function findPackageRunnerSpec(command) {
  if (!Array.isArray(command) || command.length === 0) {
    return null;
  }

  if (command[0] === "npx" || command[0] === "npm") {
    return findNpmPackageSpec(command);
  }
  if (command[0] === "uvx") {
    return findUvxPackageSpec(command);
  }
  return null;
}

function parsePackageSpec(spec) {
  if (!spec) {
    return null;
  }

  const pythonRequirementMatch = /^([A-Za-z0-9_.-]+)(==.+|>=.+)$/.exec(spec);
  if (pythonRequirementMatch?.[1] && pythonRequirementMatch[2]) {
    return {
      packageName: pythonRequirementMatch[1],
      selector: pythonRequirementMatch[2],
    };
  }

  if (spec.startsWith("@")) {
    const versionSeparatorIndex = spec.indexOf("@", 1);
    if (versionSeparatorIndex === -1) {
      return { packageName: spec, selector: null };
    }
    return {
      packageName: spec.slice(0, versionSeparatorIndex),
      selector: spec.slice(versionSeparatorIndex + 1),
    };
  }

  const versionSeparatorIndex = spec.lastIndexOf("@");
  if (versionSeparatorIndex === -1) {
    return { packageName: spec, selector: null };
  }
  return {
    packageName: spec.slice(0, versionSeparatorIndex),
    selector: spec.slice(versionSeparatorIndex + 1),
  };
}

function getPinnedVersion(selector) {
  if (!selector) {
    return null;
  }
  if (EXACT_VERSION_PATTERN.test(selector)) {
    return selector;
  }
  if (selector.startsWith("==") && EXACT_VERSION_PATTERN.test(selector.slice(2))) {
    return selector.slice(2);
  }
  return null;
}

async function getLatestNpmVersion(packageName) {
  // Query the npm registry over HTTP instead of shelling out to `npm view`:
  // execFile("npm", ...) can't spawn npm on Windows (it resolves to npm.cmd and
  // execFile does no shell/PATHEXT lookup), so every lookup failed with ENOENT.
  // fetch is platform-independent and mirrors getLatestPypiVersion below.
  const encodedName = packageName.replace(/\//g, "%2F");
  const response = await fetch(`https://registry.npmjs.org/${encodedName}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`npm registry responded ${response.status}`);
  }
  const metadata = await response.json();
  const latestVersion = metadata?.["dist-tags"]?.latest;
  if (!latestVersion || typeof latestVersion !== "string") {
    throw new Error("npm registry response did not include dist-tags.latest");
  }
  return latestVersion;
}

async function getLatestPypiVersion(packageName) {
  const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`PyPI responded ${response.status}`);
  }
  const metadata = await response.json();
  if (!metadata?.info?.version || typeof metadata.info.version !== "string") {
    throw new Error("PyPI response did not include info.version");
  }
  return metadata.info.version;
}

async function getLatestVersion(registry, packageName) {
  if (registry === "npm") {
    return getLatestNpmVersion(packageName);
  }
  if (registry === "pypi") {
    return getLatestPypiVersion(packageName);
  }
  throw new Error(`Unsupported package registry: ${registry}`);
}

function buildStatus({ selector, catalogVersion, latestVersion, registryError }) {
  const pinnedVersion = getPinnedVersion(selector);
  const reasons = [];

  if (registryError) {
    reasons.push("registry version lookup failed");
  }
  if (!selector) {
    reasons.push("missing package version selector");
  } else if (!pinnedVersion) {
    reasons.push("command selector is not an exact version pin");
  }

  if (latestVersion) {
    if (pinnedVersion && pinnedVersion !== latestVersion) {
      reasons.push("command selector is not latest registry version");
    }
    if (catalogVersion !== latestVersion) {
      reasons.push("catalog version is not latest registry version");
    }
  }

  return reasons;
}

function buildUpdatedPackageSpec(spec, packageName, latestVersion) {
  if (spec.registry === "pypi" && spec.usesFrom) {
    return `${packageName}==${latestVersion}`;
  }
  return `${packageName}@${latestVersion}`;
}

function buildUpdatedCommand(command, spec, parsedSpec, latestVersion) {
  const updatedCommand = [...command];
  updatedCommand[spec.index] = buildUpdatedPackageSpec(spec, parsedSpec.packageName, latestVersion);
  return updatedCommand;
}

async function inspectEntry(entry, options) {
  const spec = findPackageRunnerSpec(entry.command);
  const parsedSpec = parsePackageSpec(spec?.spec);

  if (!spec || !parsedSpec) {
    return {
      id: entry.id,
      title: entry.title,
      command: entry.command,
      checked: false,
      status: "skipped",
      reasons: ["not a supported package-runner command"],
    };
  }

  let latestVersion = null;
  let registryError = null;
  if (!options.noNetwork) {
    try {
      latestVersion = await getLatestVersion(spec.registry, parsedSpec.packageName);
    } catch (error) {
      registryError = error instanceof Error ? error.message : String(error);
    }
  }

  const reasons = buildStatus({
    selector: parsedSpec.selector,
    catalogVersion: entry.version,
    latestVersion,
    registryError,
  });

  return {
    id: entry.id,
    title: entry.title,
    registry: spec.registry,
    packageName: parsedSpec.packageName,
    selector: parsedSpec.selector,
    catalogVersion: entry.version,
    latestVersion,
    currentCommand: entry.command,
    updatedCommand: latestVersion
      ? buildUpdatedCommand(entry.command, spec, parsedSpec, latestVersion)
      : null,
    checked: true,
    status: reasons.length === 0 ? "ok" : "drift",
    reasons,
    registryError,
    start: entry.start,
    end: entry.end,
  };
}

async function fetchAcpRegistryAgents() {
  const response = await fetch(ACP_REGISTRY_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`ACP registry responded ${response.status}`);
  }
  const registry = await response.json();
  const agents = Array.isArray(registry) ? registry : registry?.agents;
  if (!Array.isArray(agents)) {
    throw new Error("ACP registry response did not include an agents list");
  }
  return agents;
}

// Numeric, dot-wise comparison. Good enough for the semver and calendar
// versions the registry publishes; prerelease suffixes are ignored.
function compareVersions(left, right) {
  const leftParts = left.split(/[-+]/)[0].split(".").map(Number);
  const rightParts = right.split(/[-+]/)[0].split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * The registry pass. Package-runner entries are already pinned against npm or
 * PyPI above, which publish ahead of the registry, so the registry only
 * versions the installed-command entries (`goose acp`, `kimi acp`, ...). Their
 * version is a display label, and it moves only forward: a registry that lags
 * never downgrades it. Entries labelled "manual" are left alone on purpose.
 */
function inspectRegistry(entries, results, agents) {
  const catalogIds = new Set(entries.map((entry) => entry.id));
  const skippedIds = new Set(
    results.filter((result) => !result.checked).map((result) => result.id),
  );
  const labelDrift = [];
  const missing = [];

  for (const agent of agents) {
    const catalogId = REGISTRY_ID_ALIASES[agent.id] ?? agent.id;
    if (!catalogIds.has(catalogId)) {
      if (!REGISTRY_EXCLUSIONS[agent.id]) {
        missing.push({ id: agent.id, name: agent.name, version: agent.version });
      }
      continue;
    }
    const entry = entries.find((candidate) => candidate.id === catalogId);
    if (
      skippedIds.has(catalogId) &&
      EXACT_VERSION_PATTERN.test(entry.version ?? "") &&
      typeof agent.version === "string" &&
      EXACT_VERSION_PATTERN.test(agent.version) &&
      compareVersions(agent.version, entry.version) > 0
    ) {
      labelDrift.push({
        id: catalogId,
        catalogVersion: entry.version,
        registryVersion: agent.version,
        start: entry.start,
        end: entry.end,
      });
    }
  }

  const registryIds = new Set(agents.map((agent) => REGISTRY_ID_ALIASES[agent.id] ?? agent.id));
  const unregistered = entries.map((entry) => entry.id).filter((id) => id && !registryIds.has(id));

  return { labelDrift, missing, unregistered };
}

function serializeCommand(command) {
  return `[${command.map((arg) => JSON.stringify(arg)).join(", ")}]`;
}

function applyUpdates(source, results, registryReport) {
  let updatedSource = source;
  const pinUpdates = results
    .filter((result) => result.checked && result.latestVersion && result.updatedCommand)
    .map((result) => ({
      start: result.start,
      end: result.end,
      version: result.latestVersion,
      command: result.updatedCommand,
    }));
  const labelUpdates = (registryReport?.labelDrift ?? []).map((drift) => ({
    start: drift.start,
    end: drift.end,
    version: drift.registryVersion,
    command: null,
  }));
  // Rewrite from the end of the file backwards so earlier offsets stay valid.
  const updates = [...pinUpdates, ...labelUpdates].sort((left, right) => right.start - left.start);

  for (const update of updates) {
    const block = updatedSource.slice(update.start, update.end);
    let updatedBlock = block.replace(/version:\s*"[^"]+"/, `version: "${update.version}"`);
    if (update.command) {
      updatedBlock = updatedBlock.replace(
        /command:\s*\[[^\]]+\]/,
        `command: ${serializeCommand(update.command)}`,
      );
    }
    updatedSource = `${updatedSource.slice(0, update.start)}${updatedBlock}${updatedSource.slice(update.end)}`;
  }

  return updatedSource;
}

function printReport(results, registryReport, options) {
  const reportResults = results.map(({ start: _start, end: _end, ...result }) => result);
  if (options.json) {
    const registry = registryReport && {
      ...registryReport,
      labelDrift: registryReport.labelDrift.map(({ start: _start, end: _end, ...label }) => label),
    };
    console.log(JSON.stringify({ packageRunners: reportResults, registry }, null, 2));
    return;
  }

  const checked = reportResults.filter((result) => result.checked);
  const drift = checked.filter((result) => result.status === "drift");
  const skipped = reportResults.filter((result) => !result.checked);

  console.log("ACP catalog version drift");
  console.log("=========================");
  console.log(`checked: ${checked.length}`);
  console.log(`drift:   ${drift.length}`);
  console.log(`skipped: ${skipped.length}`);

  if (drift.length > 0) {
    console.log("\nDrift / stale pins:");
    for (const result of drift) {
      const latest = result.latestVersion ?? (options.noNetwork ? "not checked" : "unknown");
      const recommended = result.updatedCommand?.join(" ") ?? "unavailable";
      console.log(
        `- ${result.id}: ${result.registry}:${result.packageName}@${result.selector ?? "<none>"} ` +
          `(catalog ${result.catalogVersion ?? "n/a"}, latest ${latest}) -> ${recommended}`,
      );
      for (const reason of result.reasons) {
        console.log(`  - ${reason}`);
      }
    }
  }

  if (skipped.length > 0) {
    console.log("\nInstalled-command entries (versioned from the ACP registry):");
    for (const result of skipped) {
      console.log(`- ${result.id}: ${result.command?.join(" ") ?? "<no command>"}`);
    }
  }

  printRegistryReport(registryReport);
}

function printRegistryReport(registryReport) {
  if (!registryReport) {
    console.log("\nACP registry: not checked (--no-network)");
    return;
  }

  console.log("\nACP registry");
  console.log("============");
  console.log(`stale labels:    ${registryReport.labelDrift.length}`);
  console.log(`missing agents:  ${registryReport.missing.length}`);
  for (const label of registryReport.labelDrift) {
    console.log(
      `- ${label.id}: catalog ${label.catalogVersion}, registry ${label.registryVersion}`,
    );
  }
  if (registryReport.missing.length > 0) {
    console.log(
      "\nIn the ACP registry but not the catalog (add an entry, or an exclusion with a reason):",
    );
    for (const agent of registryReport.missing) {
      console.log(`- ${agent.id} (${agent.name} ${agent.version ?? ""})`);
    }
  }
  if (registryReport.unregistered.length > 0) {
    console.log(
      `\nCurated catalog entries not in the ACP registry (informational): ${registryReport.unregistered.join(", ")}`,
    );
  }
}

const options = parseArgs(process.argv.slice(2));
const source = await readFile(CATALOG_PATH, "utf8");
const entries = parseCatalogEntries(source);
const results = await Promise.all(entries.map((entry) => inspectEntry(entry, options)));
const registryReport = options.noNetwork
  ? null
  : inspectRegistry(entries, results, await fetchAcpRegistryAgents());
const hasDrift =
  results.some((result) => result.checked && result.status === "drift") ||
  (registryReport !== null &&
    (registryReport.labelDrift.length > 0 || registryReport.missing.length > 0));

if (options.update) {
  await writeFile(CATALOG_PATH, applyUpdates(source, results, registryReport));
}

printReport(results, registryReport, options);

if (options.failOnDrift && hasDrift) {
  process.exitCode = 1;
}
