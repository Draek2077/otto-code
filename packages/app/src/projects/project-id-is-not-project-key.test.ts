import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

// A `projectId` is per-host and opaque (`prj_...`); the daemon looks it up in its
// project registry and throws `Project not found for worktree: <value>` on a miss.
// A `projectKey` is the deliberately cross-host grouping key `deriveProjectKey`
// derives from the remote or the path -- two clones of one repo on two hosts
// collapse onto one key, which is the entire point of it, and which is also why
// it can never identify a project on a particular host.
//
// The two coincide for a project Otto seeded itself, because the seeding path
// writes the key into the id. So passing one where the other is wanted is
// invisible until a project is registered through the path that mints a real id
// -- and then every workspace creation for that project fails. It shipped
// exactly that way. Reviewing the assignment cannot catch it; the names read
// like synonyms. So assert it structurally instead.
//
// If this test fails: reach for `getHostProjectId(project, serverId)`, which
// takes the id off the host placement, or omit `projectId` entirely and let the
// daemon resolve the project from the source directory. Do not silence it by
// widening the allowlist without the reason spelled out below.

const SOURCE_ROOT = path.resolve(__dirname, "..");

// The one place a key legitimately lands in a `projectId`. Keep the reason with
// the line, not just here.
const ALLOWED = new Set(["workspace/legacy-daemon-workspaces.ts"]);

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }
    return [entryPath];
  });
}

/** True when the expression reads a `projectKey` anywhere it is not shadowed by a nested function. */
function readsProjectKey(expression: ts.Expression): boolean {
  let found = false;

  function visit(node: ts.Node): void {
    if (found) {
      return;
    }
    if (node !== expression && ts.isFunctionLike(node)) {
      return;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "projectKey") {
      found = true;
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "projectKey"
    ) {
      found = true;
      return;
    }
    if (ts.isIdentifier(node) && node.text === "projectKey") {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(expression);
  return found;
}

function describeLocation(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const relativePath = path.relative(SOURCE_ROOT, sourceFile.fileName).replaceAll("\\", "/");
  return `${relativePath}:${line + 1}`;
}

function findProjectKeyAsProjectId(filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const offenders: string[] = [];

  function visit(node: ts.Node): void {
    // `{ projectId: project.projectKey }` -- request payloads, route options.
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
      node.name.text === "projectId" &&
      readsProjectKey(node.initializer)
    ) {
      offenders.push(describeLocation(sourceFile, node));
    }
    // `<Sheet projectId={project.projectKey} />` -- the same mistake as a prop.
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "projectId" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      readsProjectKey(node.initializer.expression)
    ) {
      offenders.push(describeLocation(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return offenders;
}

describe("a projectKey is never sent as a projectId", () => {
  it("finds no app source assigning a projectKey into a projectId", () => {
    const offenders = listSourceFiles(SOURCE_ROOT)
      .filter(
        (filePath) => !ALLOWED.has(path.relative(SOURCE_ROOT, filePath).replaceAll("\\", "/")),
      )
      .flatMap(findProjectKeyAsProjectId);

    expect(offenders).toEqual([]);
  });

  it("detects the shapes the bug actually took", () => {
    const fixture = ts.createSourceFile(
      "fixture.tsx",
      `
        const a = { projectId: project.projectKey };
        const b = { projectId: agent.projectPlacement?.projectKey };
        const c = { projectId: getHostProjectId(project, serverId) ?? undefined };
        const d = <Sheet projectId={project.projectKey} />;
        const e = <Sheet projectId={target.projectId} />;
      `,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const offenders: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "projectId" &&
        readsProjectKey(node.initializer)
      ) {
        offenders.push(node.getText(fixture));
      }
      if (
        ts.isJsxAttribute(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "projectId" &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression &&
        readsProjectKey(node.initializer.expression)
      ) {
        offenders.push(node.getText(fixture));
      }
      ts.forEachChild(node, visit);
    }
    visit(fixture);

    expect(offenders).toEqual([
      "projectId: project.projectKey",
      "projectId: agent.projectPlacement?.projectKey",
      "projectId={project.projectKey}",
    ]);
  });
});
