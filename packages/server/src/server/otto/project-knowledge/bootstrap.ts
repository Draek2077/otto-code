import path from "node:path";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { KnowledgeService, knowledgeRoots, type KnowledgeRoot } from "./knowledge-service.js";
import { hasCode } from "./store-resolver.js";

interface SourceSnapshot {
  projectName: string;
  rootEntries: string[];
  files: { path: string; body: string }[];
  gaps: { path: string; reason: string }[];
}

/** Only local source facts. Reading does not initialize or rewrite the Knowledge store. */
async function readSources(root: string): Promise<SourceSnapshot> {
  const physicalRoot = await realpath(root);
  const entries = await readdir(root, { withFileTypes: true });
  const files: SourceSnapshot["files"] = [];
  const gaps: SourceSnapshot["gaps"] = [];
  for (const relative of ["README.md", "package.json", "docs/README.md"]) {
    const file = path.join(root, relative);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) {
        gaps.push({ path: relative, reason: "not inspected: symbolic link or non-regular file" });
        continue;
      }
      if (info.size > 262144) {
        gaps.push({ path: relative, reason: "not inspected: exceeds the 256 KiB source limit" });
        continue;
      }
      const relativePhysical = path.relative(physicalRoot, await realpath(file));
      if (
        relativePhysical === ".." ||
        relativePhysical.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePhysical)
      ) {
        gaps.push({
          path: relative,
          reason: "not inspected: resolves outside the canonical project root",
        });
        continue;
      }
      files.push({ path: relative, body: await readFile(file, "utf8") });
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
      gaps.push({ path: relative, reason: "absent at inspection" });
    }
  }
  return {
    projectName: path.basename(root),
    rootEntries: entries
      .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
      .sort(),
    files,
    gaps,
  };
}

function manifestFacts({
  sources,
  selected,
}: {
  sources: SourceSnapshot;
  selected?: readonly string[];
}): string[] {
  const manifest = sources.files.find((file) => file.path === "package.json");
  if (!manifest)
    return ["Package behavior is unknown: `package.json` was not inspected. See Source gaps."];
  try {
    const data: unknown = JSON.parse(manifest.body);
    if (!data || typeof data !== "object" || Array.isArray(data))
      return ["`package.json` is not a JSON object; package behavior remains unknown."];
    const rows: string[] = [];
    for (const field of [
      "name",
      "description",
      "packageManager",
      "engines",
      "workspaces",
      "scripts",
      "dependencies",
      "devDependencies",
    ]) {
      if (selected && !selected.includes(field)) continue;
      if (field in data) rows.push(`- \`${field}\`: ${JSON.stringify(Reflect.get(data, field))}`);
    }
    return rows.length
      ? rows
      : ["No selected package fields are declared in the inspected manifest."];
  } catch {
    // A malformed manifest is source evidence to repair, never a reason to invent a stack.
    return ["`package.json` could not be parsed; inspect it before documenting package behavior."];
  }
}

function renderRoot({
  slug,
  sources,
  charters,
}: {
  slug: KnowledgeRoot;
  sources: SourceSnapshot;
  charters: { id: string; title: string }[];
}): string {
  const sourceLinks = sources.files.map(
    (file) => `- \`${file.path}\` (relative to the project root)`,
  );
  const header = `# ${slug[0].toUpperCase()}${slug.slice(1)}\n\nSource-backed draft for ${sources.projectName}. Review and expand this page from the linked source.\n\n`;
  const footer = `\n\n## Sources\n\n${sourceLinks.join("\n") || "No candidate source files were inspected."}\n\n## Source gaps\n\n${sources.gaps.map((gap) => `- \`${gap.path}\`: ${gap.reason}.`).join("\n") || "None among README.md, package.json and docs/README.md."}\n`;
  if (slug === "stack") return `${header}${manifestFacts({ sources }).join("\n")}${footer}`;
  if (slug === "flow")
    return `${header}## Declared project commands\n\n${manifestFacts({ sources, selected: ["scripts"] }).join("\n")}${footer}`;
  if (slug === "roadmap")
    return `${header}## Confirmed project charters\n\n${charters.map((page) => `- [[${page.id}]] ${page.title}`).join("\n") || "No confirmed project charters are present in the Knowledge catalog."}${footer}`;
  if (slug === "mindmap" || slug === "architecture")
    return `${header}## Repository structure\n\n${sources.rootEntries.map((entry) => `- \`${entry}\``).join("\n")}${footer}`;
  const relevant =
    slug === "background" ? sources.files.find((file) => file.path === "README.md") : null;
  return `${header}${relevant ? `## Repository description\n\n${relevant.body.trim() || "The inspected README is empty; repository purpose remains undocumented."}` : "Repository purpose is unknown: README.md was not inspected. See Source gaps."}${footer}`;
}

/** Explicit bootstrap. Existing author roots, including empty files, are never replaced. */
export async function initializeKnowledgeRoots(input: {
  service: KnowledgeService;
  projectId: string;
  projectRoot: string;
}): Promise<{ created: KnowledgeRoot[] }> {
  const sources = await readSources(input.projectRoot);
  const charters = (await input.service.catalog(input.projectId)).filter(
    (page) => page.kind === "project",
  );
  const created: KnowledgeRoot[] = [];
  for (const slug of knowledgeRoots) {
    if (await input.service.readRoot({ projectId: input.projectId, slug })) continue;
    await input.service.writeRoot({
      projectId: input.projectId,
      slug,
      expectedRevision: null,
      body: renderRoot({ slug, sources, charters }),
    });
    created.push(slug);
  }
  await input.service.initializeIndex(input.projectId);
  return { created };
}
