import { expect, test } from "vitest";
import { canFitAssistantProse } from "./bubble-layout";

test.each([
  "The first reply is ready to read.",
  "Great!",
  "A **strong** and *emphasized* reply.",
  "Use `npm run dev`.",
  "A [link](https://example.com).",
  "\\![literal, not an image](image.png)",
])("completed inline prose can size to its content: %s", (source) => {
  expect(canFitAssistantProse(source, true)).toBe(true);
});

test.each([
  "![Screenshot](image.png)",
  "Before ![inline image](image.png) after.",
  "[![linked image](image.png)](https://example.com)",
  "```mermaid\nflowchart LR\nA --> B\n```",
  "~~~mermaid\nflowchart LR\nA --> B\n~~~",
  '```widget\n{"type":"chart"}\n```',
  '```html\n<iframe src="about:blank"></iframe>\n```',
  "```ts\nconst result = 1;\n```",
  '<iframe src="about:blank"></iframe>',
  "Before <custom-widget /> after.",
  "| Name | State |\n| --- | --- |\n| Build | Ready |",
  "- [x] A task\n- [ ] Another task",
  "> A quoted block",
  "# Heading",
  "---",
  "One paragraph.\n\nAnother paragraph.",
])("structured or embedded content retains its column: %s", (source) => {
  expect(canFitAssistantProse(source, true)).toBe(false);
});

test("streaming content keeps a stable containing column before settlement", () => {
  expect(canFitAssistantProse("A reply", false)).toBe(false);
  expect(canFitAssistantProse("```mermaid\nflowchart LR", false)).toBe(false);
});

test("empty and large messages do not opt into prose sizing", () => {
  expect(canFitAssistantProse("", true)).toBe(false);
  expect(canFitAssistantProse("A long reply. ".repeat(400), true)).toBe(false);
});
