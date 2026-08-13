/**
 * One parse-safe structural source pair for every grammar family Otto exposes.
 *
 * These are deliberately small smoke fixtures, not a claim that one example
 * exhausts a language. The invariant is stricter and more useful than an
 * allowlist: every syntax-highlighted extension has a complete-source pair
 * that reaches the Structural planner without an eligibility fallback.
 */
export interface StructuralLanguageFixture {
  id: string;
  extensions: readonly string[];
  before: string;
  after: string;
}

export const STRUCTURAL_DIFF_LANGUAGE_FIXTURES: readonly StructuralLanguageFixture[] = [
  {
    id: "javascript",
    extensions: ["js", "mjs", "cjs"],
    before: 'export function label(value) { return "old"; }\n',
    after: 'export function label(value) { return "new"; }\n',
  },
  {
    id: "jsx",
    extensions: ["jsx"],
    before: "export function Badge() { return <span>old</span>; }\n",
    after: "export function Badge() { return <span>new</span>; }\n",
  },
  {
    id: "typescript",
    extensions: ["ts"],
    before: 'export function label(value: number): string { return "old"; }\n',
    after: 'export function label(value: number): string { return "new"; }\n',
  },
  {
    id: "tsx",
    extensions: ["tsx"],
    before: 'export function Badge() { return <span title="old">old</span>; }\n',
    after: 'export function Badge() { return <span title="new">new</span>; }\n',
  },
  {
    id: "c-family",
    extensions: ["c", "h", "cc", "cpp", "cxx", "hpp", "hxx", "m", "mm"],
    before: "int label(void) { return 1; }\n",
    after: "int label(void) { return 2; }\n",
  },
  {
    id: "json",
    extensions: ["json"],
    before: '{ "status": "old" }\n',
    after: '{ "status": "new" }\n',
  },
  {
    id: "stylesheet",
    extensions: ["css", "scss"],
    before: ".badge { color: red; }\n",
    after: ".badge { color: blue; }\n",
  },
  {
    id: "html",
    extensions: ["html", "htm"],
    before: "<main><p>old</p></main>\n",
    after: "<main><p>new</p></main>\n",
  },
  {
    id: "xml",
    extensions: ["xml"],
    before: '<note value="old" />\n',
    after: '<note value="new" />\n',
  },
  {
    id: "java",
    extensions: ["java"],
    before: 'class Label { String value() { return "old"; } }\n',
    after: 'class Label { String value() { return "new"; } }\n',
  },
  {
    id: "python",
    extensions: ["py"],
    before: 'def label():\n    return "old"\n',
    after: 'def label():\n    return "new"\n',
  },
  {
    id: "go",
    extensions: ["go"],
    before: 'package label\n\nfunc Value() string { return "old" }\n',
    after: 'package label\n\nfunc Value() string { return "new" }\n',
  },
  {
    id: "php",
    extensions: ["php"],
    before: '<?php\nfunction label(): string { return "old"; }\n',
    after: '<?php\nfunction label(): string { return "new"; }\n',
  },
  {
    id: "yaml",
    extensions: ["yaml", "yml"],
    before: "status: old\n",
    after: "status: new\n",
  },
  {
    id: "rust",
    extensions: ["rs"],
    before: 'fn label() -> &\'static str { "old" }\n',
    after: 'fn label() -> &\'static str { "new" }\n',
  },
  {
    id: "swift",
    extensions: ["swift"],
    before: 'func label() -> String { return "old" }\n',
    after: 'func label() -> String { return "new" }\n',
  },
  {
    id: "dart",
    extensions: ["dart"],
    before: 'String label() { return "old"; }\n',
    after: 'String label() { return "new"; }\n',
  },
  {
    id: "csharp",
    extensions: ["cs"],
    before: "public class Label { }\n",
    after: "public class Badge { }\n",
  },
  {
    id: "elixir",
    extensions: ["ex", "exs"],
    before: 'defmodule Label do\n  def value, do: "old"\nend\n',
    after: 'defmodule Label do\n  def value, do: "new"\nend\n',
  },
  {
    id: "markdown",
    extensions: ["md", "mdx"],
    before: "# Old heading\n\nBody\n",
    after: "# New heading\n\nBody\n",
  },
  {
    id: "shell",
    extensions: ["sh", "bash", "zsh", "shell"],
    before: 'echo "old"\n',
    after: 'echo "new"\n',
  },
  {
    id: "sql",
    extensions: ["sql"],
    before: "SELECT old_value FROM labels;\n",
    after: "SELECT new_value FROM labels;\n",
  },
];
