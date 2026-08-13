/** Complete source pairs used by the Appearance diff lab.
 *
 * They are inputs to the production diff model, never hand-authored render
 * rows. Keep each case short enough to inspect, but representative enough to
 * exercise one actual layout decision.
 */
export interface StructuralDiffDemoScenario {
  id: string;
  label: string;
  title: string;
  description: string;
  filePath: string;
  before: string;
  after: string;
  expectedBlockKinds: readonly (
    | "shared"
    | "replacement"
    | "formatting"
    | "addition"
    | "removal"
    | "move"
  )[];
}

export const STRUCTURAL_DIFF_DEMO_SCENARIOS: readonly StructuralDiffDemoScenario[] = [
  {
    id: "small-edit",
    label: "Small edit",
    title: "Small edit",
    description: "A small identifier replacement inside one function.",
    filePath: "color.ts",
    before: "export function colorFor(palette: Palette) {\n  return palette.red;\n}\n",
    after: "export function colorFor(palette: Palette) {\n  return palette.blue;\n}\n",
    expectedBlockKinds: ["shared", "replacement"],
  },
  {
    id: "formatting",
    label: "Formatting",
    title: "Formatting only",
    description: "The same call wrapped across several lines.",
    filePath: "route.ts",
    before: "const route = buildRoute({ method, path, handler });\n",
    after: "const route = buildRoute({\n  method,\n  path,\n  handler\n});\n",
    expectedBlockKinds: ["formatting"],
  },
  {
    id: "reorder",
    label: "Reorder",
    title: "Reordered code",
    description: "Two unchanged statements exchanged their order.",
    filePath: "save.ts",
    before: "validate(input);\nsave(input);\n",
    after: "save(input);\nvalidate(input);\n",
    expectedBlockKinds: ["move", "shared"],
  },
  {
    id: "review-mix",
    label: "Review mix",
    title: "Review mix",
    description: "Rename, type annotation, addition, and return-value replacement.",
    filePath: "format.ts",
    before:
      'export function formatPrice(cents: number) {\n  const amount = cents / 100;\n  validateCurrency(amount);\n  const label = "$" + amount;\n  return label;\n}\n',
    after:
      "export function formatAmount(cents: number): string {\n  const amount = cents / 100;\n  const formatted = `$${amount.toFixed(2)}`;\n  validateCurrency(amount);\n  return formatted;\n}\n",
    expectedBlockKinds: ["shared", "replacement", "addition", "removal"],
  },
  {
    id: "imports",
    label: "Imports",
    title: "Import replacement",
    description: "One module source changes while nearby imports remain context.",
    filePath: "panel.ts",
    before:
      'import { Button } from "@/components/ui/button";\nimport { LegacyChart } from "./legacy-chart";\n\nexport const panel = Button;\n',
    after:
      'import { Button } from "@/components/ui/button";\nimport { Chart } from "./chart";\n\nexport const panel = Button;\n',
    expectedBlockKinds: ["shared", "replacement"],
  },
  {
    id: "object-edit",
    label: "Object edit",
    title: "JSON object edit",
    description: "A property replacement and a new nested field in a data file.",
    filePath: "theme.json",
    before: '{\n  "name": "twilight",\n  "palette": { "accent": "cyan" }\n}\n',
    after: '{\n  "name": "midnight",\n  "palette": { "accent": "violet", "contrast": "high" }\n}\n',
    expectedBlockKinds: ["shared", "replacement"],
  },
  {
    id: "function-rewrite",
    label: "Function",
    title: "Function rewrite",
    description: "A multi-line calculation is replaced by a different implementation.",
    filePath: "total.ts",
    before:
      "export function total(items: number[]) {\n  const subtotal = items.reduce((sum, item) => sum + item, 0);\n  return subtotal;\n}\n",
    after:
      "export function total(items: number[]) {\n  return items.reduce((sum, item) => sum + item, 0);\n}\n",
    expectedBlockKinds: ["shared", "replacement", "removal"],
  },
  {
    id: "markdown",
    label: "Markdown",
    title: "Markdown edit",
    description: "A documentation heading and link target change without hiding the body.",
    filePath: "guide.md",
    before: "# Deploy preview\n\nRead the [legacy guide](./legacy.md).\n\nKeep this paragraph.\n",
    after: "# Browser preview\n\nRead the [preview guide](./preview.md).\n\nKeep this paragraph.\n",
    expectedBlockKinds: ["shared", "replacement"],
  },
  {
    id: "html",
    label: "HTML",
    title: "Nested HTML edit",
    description:
      "Text, attributes, and nested markup change while the document structure stays put.",
    filePath: "page.html",
    before:
      '<html>\n<head>\n  <title>Hi!</title>\n</head>\n<body class="foo">\n  <h1>Foo</h1>\n  <p>Story about foo.</p>\n</body>\n</html>\n',
    after:
      '<html>\n<head>\n  <title>Hi</title>\n</head>\n<body class="bar">\n  <h1 id="title">Bar</h1>\n  <p>Story about <strong>bar</strong>.</p>\n</body>\n</html>\n',
    expectedBlockKinds: ["shared", "replacement"],
  },
  {
    id: "comment",
    label: "Comment",
    title: "Comment revision",
    description:
      "Documentation changes should compare directly instead of becoming unrelated delete/add rows.",
    filePath: "query.ts",
    before:
      "export function queryProfile() {\n  // Fetches the current profile.\n  return requestProfile();\n}\n",
    after:
      "export function queryProfile() {\n  // Fetches and validates the current profile.\n  return requestProfile();\n}\n",
    expectedBlockKinds: ["shared", "replacement"],
  },
  {
    id: "nested-javascript",
    label: "Nested JS",
    title: "Nested JavaScript edit",
    description:
      "A conditional wrapper, changed call argument, and list edit in one review fragment.",
    filePath: "people.js",
    before:
      '// hello\nfoo();\nbar(1);\nbaz();\n\nvar people = [\n  "john", "harry", "dick", "eric",\n  "jenny", "alexandra",\n];\n',
    after:
      '// hello\nif (true) {\n  foo();\n  bar(2);\n  baz();\n}\n\nvar people = [\n  "john", "harry", "dick", "yvonne",\n  "eric", "jenny", "alexandra",\n];\n',
    expectedBlockKinds: ["shared", "replacement", "addition"],
  },
];

export function getStructuralDiffDemoScenario(id: string): StructuralDiffDemoScenario {
  const scenario = STRUCTURAL_DIFF_DEMO_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown structural diff demo scenario: ${id}`);
  return scenario;
}
