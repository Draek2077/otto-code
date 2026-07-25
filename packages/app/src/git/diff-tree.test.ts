import { describe, expect, it } from "vitest";
import {
  buildDiffTree,
  collectDirPaths,
  compressSingleChildChains,
  flattenDiffTree,
  type DiffTreeRow,
} from "./diff-tree";
import { treeRailContinuesAt } from "@/components/tree-rail-mask";
import type { ParsedDiffFile } from "@/git/use-diff-query";

function createFile(path: string, additions = 1, deletions = 0): ParsedDiffFile {
  return {
    path,
    isNew: false,
    isDeleted: false,
    additions,
    deletions,
    hunks: [],
  };
}

// The Changes tree is fed the already-path-sorted diff files; build against that.
function tree(paths: Array<string | ParsedDiffFile>) {
  return buildDiffTree(paths.map((p) => (typeof p === "string" ? createFile(p) : p)));
}

function compressed(paths: Array<string | ParsedDiffFile>) {
  return compressSingleChildChains(tree(paths));
}

function rowLabels(rows: DiffTreeRow[]): string[] {
  return rows.map((row) =>
    row.kind === "folder"
      ? `${"  ".repeat(row.depth)}[${row.displayName}]`
      : `${"  ".repeat(row.depth)}${row.file.path.split("/").pop()}`,
  );
}

describe("buildDiffTree", () => {
  it("returns an empty root for no files", () => {
    const root = tree([]);
    expect(root.dirPath).toBe("");
    expect(root.children).toEqual([]);
  });

  it("places root-level files directly under the root with no folder", () => {
    const root = tree(["README.md", "package.json"]);
    expect(root.children.every((c) => c.kind === "file")).toBe(true);
    expect(root.children.map((c) => (c.kind === "file" ? c.name : c.dirPath))).toEqual([
      "README.md",
      "package.json",
    ]);
  });

  it("nests files under their directory, keyed by full path", () => {
    const root = tree(["src/a.ts", "src/nested/b.ts"]);
    expect(root.children).toHaveLength(1);
    const src = root.children[0];
    expect(src.kind).toBe("dir");
    if (src.kind !== "dir") return;
    expect(src.dirPath).toBe("src");
    const nested = src.children.find((c) => c.kind === "dir");
    expect(nested?.kind === "dir" && nested.dirPath).toBe("src/nested");
  });

  it("orders directories before files within a level, each alphabetically", () => {
    // Input alpha-by-full-path puts the file 'src/a.ts' before dir 'src/z/...',
    // but rendering wants dirs first.
    const root = tree(["src/a.ts", "src/z/deep.ts", "src/m/mid.ts"]);
    const src = root.children[0];
    if (src.kind !== "dir") throw new Error("expected dir");
    expect(
      src.children.map((c) => (c.kind === "dir" ? `dir:${c.name}` : `file:${c.name}`)),
    ).toEqual(["dir:m", "dir:z", "file:a.ts"]);
  });
});

describe("compressSingleChildChains", () => {
  it("collapses a single-child chain into one row keyed by the deepest dir", () => {
    const rows = flattenDiffTree(compressed(["packages/app/src/git/diff-pane.tsx"]), new Set());
    expect(rowLabels(rows)).toEqual(["[packages/app/src/git]", "  diff-pane.tsx"]);
    const folder = rows[0];
    expect(folder.kind === "folder" && folder.dirPath).toBe("packages/app/src/git");
  });

  it("stops compressing where a directory has multiple children", () => {
    const rows = flattenDiffTree(
      compressed(["packages/app/a.ts", "packages/server/b.ts"]),
      new Set(),
    );
    // "packages" has two dir children, so it stays its own row.
    expect(rowLabels(rows)).toEqual([
      "[packages]",
      "  [app]",
      "    a.ts",
      "  [server]",
      "    b.ts",
    ]);
  });

  it("compresses a chain that ends in a file-bearing directory", () => {
    const rows = flattenDiffTree(compressed(["a/b/c/one.ts", "a/b/c/two.ts"]), new Set());
    expect(rowLabels(rows)).toEqual(["[a/b/c]", "  one.ts", "  two.ts"]);
  });

  it("does not merge the virtual root with a single top-level dir's siblings", () => {
    const rows = flattenDiffTree(compressed(["only/deep/file.ts"]), new Set());
    expect(rows[0].kind === "folder" && rows[0].displayName).toBe("only/deep");
  });
});

describe("flattenDiffTree", () => {
  it("expands everything when the collapsed set is empty", () => {
    const rows = flattenDiffTree(compressed(["src/a.ts", "src/b.ts"]), new Set());
    expect(rowLabels(rows)).toEqual(["[src]", "  a.ts", "  b.ts"]);
  });

  it("omits descendants of a collapsed directory but keeps the folder row", () => {
    const root = compressed(["src/a.ts", "src/b.ts"]);
    const rows = flattenDiffTree(root, new Set(["src"]));
    expect(rowLabels(rows)).toEqual(["[src]"]);
  });

  it("collapsing a parent hides nested folders and files", () => {
    const root = compressed(["src/deep/a.ts", "src/top.ts"]);
    const rows = flattenDiffTree(root, new Set(["src"]));
    expect(rowLabels(rows)).toEqual(["[src]"]);
  });

  it("sums descendant additions/deletions onto the folder row", () => {
    const root = compressed([createFile("src/a.ts", 3, 1), createFile("src/nested/b.ts", 5, 2)]);
    const rows = flattenDiffTree(root, new Set());
    const srcFolder = rows.find((r) => r.kind === "folder" && r.dirPath === "src");
    expect(srcFolder).toMatchObject({ additions: 8, deletions: 3 });
  });

  it("reports full aggregate stats even when the folder is collapsed", () => {
    const root = compressed([createFile("src/a.ts", 3, 1), createFile("src/b.ts", 4, 0)]);
    const rows = flattenDiffTree(root, new Set(["src"]));
    expect(rows[0]).toMatchObject({ kind: "folder", additions: 7, deletions: 1 });
  });
});

describe("flattenDiffTree indent rails", () => {
  // Same reading as TreeIndentGuides: one char per rail column, column `i` holding
  // the rail of depth `i + 1`. "|" runs full height, "L" stops at the row's tick,
  // " " means that ancestor's branch already closed above.
  function rails(rows: DiffTreeRow[]): string[] {
    return rows.map((row) => {
      let out = "";
      for (let index = 0; index < row.depth; index += 1) {
        const railDepth = index + 1;
        if (treeRailContinuesAt(row.ancestorMask, railDepth)) {
          out += "|";
        } else {
          out += railDepth === row.depth ? "L" : " ";
        }
      }
      return out;
    });
  }

  it("closes the rail on the last child and keeps it running on the others", () => {
    const root = compressed(["src/a.ts", "src/b.ts", "src/c.ts"]);
    const rows = flattenDiffTree(root, new Set());
    // [src] sits at depth 0 (no rails); its three files are depth 1.
    expect(rowLabels(rows)).toEqual(["[src]", "  a.ts", "  b.ts", "  c.ts"]);
    expect(rails(rows)).toEqual(["", "|", "|", "L"]);
  });

  it("blanks the ancestor column once the parent folder was itself last", () => {
    // [pkg]
    // ├─ [a] ── x.ts        parent still has a sibling → column 0 keeps running
    // └─ [b] ── y.ts        parent was last          → column 0 goes blank
    const root = compressed(["pkg/a/x.ts", "pkg/a/x2.ts", "pkg/b/y.ts", "pkg/b/y2.ts"]);
    const rows = flattenDiffTree(root, new Set());
    const railByLabel = new Map(rowLabels(rows).map((label, index) => [label, rails(rows)[index]]));
    expect(railByLabel.get("  [a]")).toBe("|");
    expect(railByLabel.get("    x2.ts")).toBe("|L");
    expect(railByLabel.get("  [b]")).toBe("L");
    expect(railByLabel.get("    y2.ts")).toBe(" L");
  });

  it("does not let a collapsed folder's descendants affect its own rail", () => {
    const root = compressed(["src/nested/a.ts", "src/z.ts"]);
    const rows = flattenDiffTree(root, new Set(["src/nested"]));
    expect(rowLabels(rows)).toEqual(["[src]", "  [nested]", "  z.ts"]);
    expect(rails(rows)).toEqual(["", "|", "L"]);
  });
});

describe("collectDirPaths", () => {
  it("returns every logical directory path in the compressed tree", () => {
    const root = compressed(["packages/app/a.ts", "packages/server/b.ts"]);
    expect(collectDirPaths(root).sort()).toEqual(["packages", "packages/app", "packages/server"]);
  });
});
