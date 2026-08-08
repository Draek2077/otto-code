#!/usr/bin/env node
/**
 * Import this fork's legacy project charter ledger and reference bibliography
 * through daemon-owned Knowledge RPCs. Dry-run by default; pass --apply to write.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const root = process.cwd();
const apply = process.argv.includes("--apply");
const host = process.env.OTTO_LISTEN ?? "127.0.0.1:6788";
const clientEntry = path.join(root, "packages", "client", "dist", "daemon-client.js");
if (!existsSync(clientEntry)) throw new Error('Missing client build. Run "npm run build:client".');

const projects = readProjects();
const references = readReferences();
console.log(`Found ${projects.length} project charters and ${references.length} references.`);
if (!apply) {
  console.log("Dry run only. Pass --apply to import through the dev daemon.");
  process.exit(0);
}

const { DaemonClient } = await import(pathToFileURL(clientEntry).href);
const { WebSocket } = require("ws");
const { version } = require(path.join(root, "package.json"));
const client = new DaemonClient({
  url: `ws://${host.replace(/^(?:https?:\/\/|wss?:\/\/)/, "")}/ws`,
  clientId: `legacy-knowledge-migration-${process.pid}`,
  clientType: "cli",
  appVersion: version,
  webSocketFactory: (url, options) => new WebSocket(url, { headers: options?.headers }),
});

try {
  await client.connect();
  const opened = await client.openProject(root);
  if (opened.error || !opened.workspace?.id)
    throw new Error(opened.error ?? "The daemon did not return a workspace.");
  const workspaceId = opened.workspace.id;
  const before = await client.listProjectKnowledge(workspaceId);
  const existingIds = new Set(before.records.map((record) => record.id));
  let createdProjects = 0;
  let createdReferences = 0;
  for (const project of projects) {
    if (existingIds.has(project.id)) continue;
    const result = await client.createProjectKnowledge({ workspaceId, ...project });
    existingIds.add(result.record.id);
    createdProjects += 1;
  }
  for (const reference of references) {
    if (existingIds.has(reference.id)) continue;
    const result = await client.createProjectKnowledge({ workspaceId, ...reference });
    existingIds.add(result.record.id);
    createdReferences += 1;
  }
  const imported = await client.listProjectKnowledge(workspaceId);
  let updatedTruth = 0;
  let updatedMetadata = 0;
  let confirmed = 0;
  for (const source of [...projects, ...references]) {
    let stored = imported.records.find((record) => record.id === source.id);
    if (!stored) continue;
    if (stored.statementDigest !== digest(source.statement)) {
      const result = await client.applyProjectKnowledge({
        workspaceId,
        id: source.id,
        statement: source.statement,
        provenanceText:
          "Re-synchronized the retained legacy migration source before its final retirement.",
        expectedUpdatedAt: stored.updatedAt,
      });
      if (result.error || !result.record)
        throw new Error(result.error ?? `Failed to update ${source.id}.`);
      stored = result.record;
      updatedTruth += 1;
    }
    if (source.kind === "project" && stored.deliveryStatus !== source.deliveryStatus) {
      const result = await client.applyProjectKnowledgeProject({
        workspaceId,
        id: source.id,
        deliveryStatus: source.deliveryStatus,
        reason: "Re-synchronized delivery status from the retained legacy ledger.",
        expectedUpdatedAt: stored.updatedAt,
      });
      if (result.error || !result.record)
        throw new Error(result.error ?? `Failed to update ${source.id}.`);
      stored = result.record;
      updatedMetadata += 1;
    }
    if (
      source.kind === "reference" &&
      (stored.referenceDisposition !== source.referenceDisposition ||
        stored.sourceUrl !== source.sourceUrl)
    ) {
      const result = await client.applyProjectKnowledgeReference({
        workspaceId,
        id: source.id,
        disposition: source.referenceDisposition,
        sourceUrl: source.sourceUrl,
        reason: "Re-synchronized reference evaluation from the retained legacy bibliography.",
        expectedUpdatedAt: stored.updatedAt,
      });
      if (result.error || !result.record)
        throw new Error(result.error ?? `Failed to update ${source.id}.`);
      stored = result.record;
      updatedMetadata += 1;
    }
    if (stored.status !== "confirmed") {
      await client.setProjectKnowledgeStatus({
        workspaceId,
        id: source.id,
        status: "confirmed",
        reason:
          "Migrated from the repository's existing authoritative project or reference documentation at the user's request.",
      });
      confirmed += 1;
    }
  }
  const after = await client.listProjectKnowledge(workspaceId);
  const storedProjects = after.records.filter((record) => record.kind === "project").length;
  const storedReferences = after.records.filter((record) => record.kind === "reference").length;
  const recordsById = new Map(after.records.map((record) => [record.id, record]));
  const mismatches = [...projects, ...references].filter((source) => {
    const stored = recordsById.get(source.id);
    if (
      !stored ||
      stored.kind !== source.kind ||
      stored.status !== source.status ||
      stored.statementDigest !== digest(source.statement)
    )
      return true;
    if (source.kind === "project") return stored.deliveryStatus !== source.deliveryStatus;
    return (
      stored.referenceDisposition !== source.referenceDisposition ||
      stored.sourceUrl !== source.sourceUrl
    );
  });
  console.log(
    `Created ${createdProjects} projects and ${createdReferences} references; updated ${updatedTruth} bodies and ${updatedMetadata} metadata records; confirmed ${confirmed}. Store now has ${storedProjects} projects and ${storedReferences} references.`,
  );
  console.log(`Active catalog cost: ${after.briefTokens} estimated tokens.`);
  console.log(
    `Verified ${projects.length + references.length - mismatches.length} source records byte-for-byte at the statement and metadata boundary.`,
  );
  if (storedProjects < projects.length || storedReferences < references.length || mismatches.length)
    throw new Error(
      `Post-import verification failed: ${mismatches.length} mismatches (${mismatches.map((record) => record.id).join(", ")}).`,
    );
  let updatedRoots = 0;
  for (const page of after.rootPages ?? []) {
    const body = migrateRootBody(page.slug, page.body);
    if (body === page.body) continue;
    await client.applyProjectKnowledgeRoot({ workspaceId, slug: page.slug, body });
    updatedRoots += 1;
  }
  console.log(`Updated ${updatedRoots} project-map roots that still pointed at legacy ledgers.`);
} finally {
  await client.close().catch(() => undefined);
}

function readProjects() {
  const ledgerPath = path.join(root, "projects", "README.md");
  const ledger = readFileSync(ledgerPath, "utf8").replaceAll("\r\n", "\n");
  const records = [];
  for (const line of ledger.split("\n")) {
    const match = line.match(/^\| \[([^\]]+)\]\(([^)]+\.md)\)\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/);
    if (!match || match[1] === "Project") continue;
    const [, name, relativePath, legacyStatus, description] = match;
    const charterPath = path.join(root, "projects", relativePath.replaceAll("/", path.sep));
    if (!existsSync(charterPath)) continue;
    records.push({
      id: slug(name),
      kind: "project",
      title: humanize(name),
      statement: combinedProjectMarkdown(path.dirname(charterPath), charterPath),
      evidence: `Migrated from \`${path.relative(root, charterPath).replaceAll(path.sep, "/")}\` and the legacy \`projects/README.md\` ledger. Legacy status: ${legacyStatus.trim()}. Ledger summary: ${description.trim()}`,
      tags: ["project-charter", "legacy-projects-migration"],
      status: "confirmed",
      deliveryStatus: deliveryStatus(legacyStatus),
    });
  }
  const indexedPaths = new Set(records.map((record) => record.id));
  for (const entry of readdirSync(path.join(root, "projects"), { withFileTypes: true })) {
    if (!entry.isDirectory() || indexedPaths.has(slug(entry.name))) continue;
    const projectDirectory = path.join(root, "projects", entry.name);
    const preferredPath = path.join(projectDirectory, `${entry.name}.md`);
    const documents = allMarkdownFiles(projectDirectory);
    if (!documents.length) continue;
    const charterPath = existsSync(preferredPath) ? preferredPath : documents[0];
    records.push({
      id: slug(entry.name),
      kind: "project",
      title: humanize(entry.name),
      statement: combinedProjectMarkdown(projectDirectory, charterPath),
      evidence: `Migrated all Markdown under \`${path.relative(root, projectDirectory).replaceAll(path.sep, "/")}\`. This project had no row in the legacy \`projects/README.md\` ledger, so delivery defaults to charter.`,
      tags: ["project-charter", "legacy-projects-migration", "missing-legacy-ledger-row"],
      status: "confirmed",
      deliveryStatus: "charter",
    });
  }
  return records;
}

function migrateRootBody(rootSlug, body) {
  if (rootSlug === "roadmap" && body.includes("projects ledger"))
    return `# Roadmap

## Source of truth

Confirmed project pages under this Knowledge store are the authoritative project charters and
delivery ledger. Their review status says whether a charter is trusted; their separate delivery
status and structured progress describe execution. The Projects mode in Manage knowledge reports
counts and completion metrics without maintaining a second registry.

## Strategic direction

1. Preserve [[provider-neutral-capability-parity-defines-done]] as new frontier-harness capabilities land.
2. Keep agent work observable and reviewable: context, accounting, timelines, Visualizer, browser proof, and durable knowledge.
3. Build reusable agentic coding architectures on the stable IDE-grade platform.
4. Maintain compatibility with upstream where it remains practical, and record deliberate divergence.

## How work moves

\`\`\`mermaid
flowchart LR
  Idea[Candidate or user need] --> Charter[Confirmed project page]
  Charter --> Delivery[Status and measured progress]
  Delivery --> Evidence[Implementation and findings]
  Evidence --> Shipped[Complete]
  Shipped --> Docs[Fold durable product truth into docs]
  Docs --> History[Keep charter and timeline as project history]
\`\`\`

Use the active project pages and their delivery metadata for current initiatives, sequencing, and
deferred work. Use reference pages for the external sources that shaped them.`;
  if (rootSlug === "mindmap")
    return body.replace(
      "The authoritative feature descriptions live in the [documentation index](../../docs/README.md). Unbuilt work and status live only in the [project ledger](../../projects/README.md).",
      "The authoritative feature descriptions live in the [documentation index](../../docs/README.md). Project charters and delivery status live in confirmed project Knowledge pages.",
    );
  if (rootSlug === "background")
    return body
      .replace(
        "- Replacing the repository's canonical engineering documentation or open-work ledger with a second status system.",
        "- Creating a competing project ledger, reference bibliography, or knowledge store outside Otto Knowledge.",
      )
      .replace(
        "- [Open-work ledger](../../projects/README.md)",
        "- Confirmed project and reference pages in this Knowledge store",
      );
  return body;
}

function readReferences() {
  const sourcePath = path.join(root, "docs", "references.md");
  const markdown = readFileSync(sourcePath, "utf8").replaceAll("\r\n", "\n");
  const records = [];
  const seen = new Set();
  const add = ({ title, url, legacyStatus, statement, location }) => {
    const key = `${title.toLowerCase()}|${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push({
      id: uniqueSlug(`reference-${title}`, records),
      kind: "reference",
      title,
      statement: statement.trim() || `Project reference: [${title}](${url}).`,
      evidence: `Migrated from \`docs/references.md\` (${location}). Legacy status: ${legacyStatus || "not stated"}.`,
      tags: ["external-reference", "legacy-references-migration"],
      status: "confirmed",
      referenceDisposition: disposition(legacyStatus),
      sourceUrl: url,
    });
  };

  for (const [index, line] of markdown.split("\n").entries()) {
    if (!line.startsWith("|") || /^\|\s*:?-+/.test(line)) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 3 || /^source$/i.test(stripMarkdown(cells[0]))) continue;
    const source = linkedTitle(cells[0]);
    if (!source) continue;
    add({
      ...source,
      legacyStatus: stripMarkdown(cells[1]),
      statement: cells.slice(2).join(" | "),
      location: `table row ${index + 1}`,
    });
  }

  const headings = [...markdown.matchAll(/^(#{3,5})\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)(.*)$/gm)];
  for (const [index, match] of headings.entries()) {
    const start = (match.index ?? 0) + match[0].length;
    const level = match[1].length;
    const rest = markdown.slice(start);
    const nextHeading = rest.search(new RegExp(`^#{1,${level}}\\s+`, "m"));
    const body = (nextHeading < 0 ? rest : rest.slice(0, nextHeading)).trim();
    const legacyStatus = [...match[4].matchAll(/\*\*([^*]+)\*\*/g)].at(-1)?.[1] ?? "";
    add({
      title: match[2].trim(),
      url: match[3],
      legacyStatus,
      statement: body,
      location: `heading ${index + 1}`,
    });
  }
  return records;
}

function combinedProjectMarkdown(projectDirectory, primaryPath) {
  const documents = allMarkdownFiles(projectDirectory);
  return [primaryPath, ...documents.filter((file) => file !== primaryPath)]
    .map((file, index) => {
      const content = readFileSync(file, "utf8").trim();
      if (index === 0) return content;
      const relative = path.relative(projectDirectory, file).replaceAll(path.sep, "/");
      return `---\n\n## Companion document: ${relative}\n\n${content}`;
    })
    .join("\n\n");
}
function allMarkdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...allMarkdownFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
  return files.sort();
}

function linkedTitle(value) {
  const match = value.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
  return match ? { title: stripMarkdown(match[1]), url: match[2] } : null;
}
function stripMarkdown(value) {
  return value.replaceAll("**", "").replaceAll("`", "").trim();
}
function deliveryStatus(value) {
  const status = value.trim().toLowerCase();
  if (status === "in build") return "in_build";
  if (status === "partial") return "partial";
  if (status === "reference") return "reference";
  return "charter";
}
function disposition(value) {
  const status = value.toLowerCase();
  if (status.includes("reject")) return "rejected";
  if (status.includes("dependency") || status.includes("vendored")) return "dependency";
  if (status.includes("unevaluated")) return "unevaluated";
  if (status.includes("adopt") || status.includes("implemented") || status.includes("adapted"))
    return "adopted";
  return "read";
}
function uniqueSlug(value, records) {
  const base = slug(value);
  const ids = new Set(records.map((record) => record.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
function slug(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
}
function humanize(value) {
  return value
    .split("-")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
