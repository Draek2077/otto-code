import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import { applyTaskListMarkers } from "./task-lists";
import { applyGithubAlerts } from "./github-alerts";
import { applyFootnotes } from "./footnotes";
import { applyMath } from "./math";

const nodeRequire = createRequire(import.meta.url);

// The chain the renderer builds, on whatever `markdown-it` resolves to here.
// The resolution test below is what makes "here" and "inside
// react-native-markdown-display" the same module.
function buildRendererParser() {
  return applyMath(
    applyFootnotes(
      applyGithubAlerts(applyTaskListMarkers(new MarkdownIt({ typographer: true, linkify: true }))),
    ),
  );
}

describe("markdown-it resolution", () => {
  // The root package.json overrides markdown-it to ^15 because the ^10 copy
  // react-native-markdown-display would otherwise install carries quadratic
  // smartquotes and linkify rules (GHSA-6v5v-wf23-fmfq, GHSA-v245-v573-v5vm)
  // that a crafted chat message or repo file can use to freeze the UI thread.
  // npm does not credit the override against the library's declared range
  // (`npm ls` reports it "invalid"), so a future install can quietly re-nest
  // the vulnerable copy; this asserts the version the library actually
  // resolves, from its own directory, the way the bundler would.
  it("react-native-markdown-display resolves the overridden markdown-it", () => {
    const libraryRequire = createRequire(
      nodeRequire.resolve("react-native-markdown-display/package.json"),
    );
    const resolved = libraryRequire("markdown-it/package.json") as { version: string };
    expect(Number(resolved.version.split(".")[0])).toBeGreaterThanOrEqual(15);
  });

  // markdown-it 10 → 15 is a five-major jump; the library's whole contract
  // with it is `parse()` plus the Token fields tokensToAST reads. Run the
  // library's own token → AST path over the renderer's plugin chain to prove
  // that contract still holds.
  it("feeds the library's tokensToAST from the renderer's plugin chain", async () => {
    const { stringToTokens } = (await import(
      // @ts-expect-error: the library publishes raw untyped src
      "react-native-markdown-display/src/lib/util/stringToTokens"
    )) as { stringToTokens: (source: string, markdownIt: unknown) => unknown[] };
    const { default: tokensToAST } = (await import(
      // @ts-expect-error: the library publishes raw untyped src
      "react-native-markdown-display/src/lib/util/tokensToAST"
    )) as { default: (tokens: unknown[]) => Array<{ type: string; content?: string }> };

    const document = [
      "# Heading",
      "",
      'She said "hello" to https://example.com',
      "",
      "- [x] done",
      "",
      "> [!NOTE]",
      "> An alert",
    ].join("\n");

    const tokens = stringToTokens(document, buildRendererParser());
    // stringToTokens swallows parser throws and returns [], so emptiness is
    // the failure signal for an API break, not an exception.
    expect(tokens.length).toBeGreaterThan(0);

    const ast = tokensToAST(tokens);
    const types = ast.map((node) => node.type);
    expect(types).toContain("heading1");
    expect(types).toContain("blockquote");
    expect(types).toContain("bullet_list");

    const flatten = (nodes: typeof ast): typeof ast =>
      nodes.flatMap((node) => [
        node,
        ...flatten((node as { children?: typeof ast }).children ?? []),
      ]);
    const all = flatten(ast);
    // linkify turned the bare URL into a link node…
    expect(all.some((node) => node.type === "link")).toBe(true);
    // …and typographer curled the quotes.
    expect(all.some((node) => node.content?.includes("“hello”"))).toBe(true);
  });
});
