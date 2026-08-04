import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(__dirname, "..");

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function containsEagerStyleRead(initializer: ts.Expression): boolean {
  if (ts.isFunctionLike(initializer)) {
    return false;
  }

  let found = false;

  function visit(node: ts.Node): void {
    if (node !== initializer && ts.isFunctionLike(node)) {
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text !== "StyleSheet" &&
      /styles$/i.test(node.expression.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(initializer);
  return found;
}

function findEagerModuleStyleReads(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) {
      return [];
    }
    return statement.declarationList.declarations.flatMap((declaration) => {
      if (!declaration.initializer || !containsEagerStyleRead(declaration.initializer)) {
        return [];
      }
      const line =
        sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile)).line + 1;
      // Forward slashes so the baseline below reads the same on Windows and CI.
      const relativePath = path.relative(SOURCE_ROOT, filePath).split(path.sep).join("/");
      return [`${relativePath}:${line}`];
    });
  });
}

// Files that already read a style proxy at module scope when this guard arrived
// with the Paseo v0.2.5 merge. The rule is real and documented (docs/unistyles.md
// - a module-level read can bake in the pre-theme value, which is how settings
// dividers once rendered light inside a dark card), but 42 files predate the
// guard. The baseline is a ratchet, not an exemption: it may only shrink, and a
// file that no longer offends must leave it. Draining it is tracked in
// projects/README.md.
const BASELINE: string[] = JSON.parse(
  readFileSync(path.join(__dirname, "unistyles-module-scope.baseline.json"), "utf8"),
) as string[];

describe("Unistyles module scope", () => {
  it("does not materialize style proxies before the persisted theme loads", () => {
    const violations = listSourceFiles(SOURCE_ROOT).flatMap(findEagerModuleStyleReads);
    const offendingFiles = new Set(violations.map((violation) => violation.split(":")[0]));
    const baseline = new Set(BASELINE);

    const introduced = [...offendingFiles].filter((file) => !baseline.has(file)).sort();
    expect(introduced).toEqual([]);
  });

  it("keeps the baseline honest as files are cleaned up", () => {
    const violations = listSourceFiles(SOURCE_ROOT).flatMap(findEagerModuleStyleReads);
    const offendingFiles = new Set(violations.map((violation) => violation.split(":")[0]));

    // A baseline entry that no longer offends has been fixed - drop it, so the
    // ratchet tightens instead of quietly permitting a future regression.
    const stale = BASELINE.filter((file) => !offendingFiles.has(file));
    expect(stale).toEqual([]);
  });
});
