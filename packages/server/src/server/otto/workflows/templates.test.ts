import { describe, test, expect } from "vitest";
import type { PromptTemplate } from "@getpaseo/plugin/otto/workflows";
import { renderWorkflowTemplate, workflowTemplateVariables } from "./templates.js";
const template = (id: string, content: string): PromptTemplate => ({ id, name: id, content });
function render(
  templates: PromptTemplate[],
  variables: Record<string, unknown> = {},
  allowCode = false,
) {
  return renderWorkflowTemplate({
    id: templates[0].id,
    templates,
    variables,
    allowCode,
    signal: new AbortController().signal,
  });
}
describe("reviewed Workflow prompt rendering", () => {
  test("ordinary substitutions preserve prompt characters without executing code", async () => {
    expect(
      await render([template("main", "Research <%= topic %> now")], { topic: 'R&D "spikes"' }),
    ).toBe('Research R&D "spikes" now');
  });
  test("includes resolve only the captured snippets and preserve parent variables", async () => {
    expect(
      await render(
        [
          template("main", "Do <%- include('rules') %>"),
          template("rules", "<%= topic %> precisely"),
        ],
        { topic: "Work" },
      ),
    ).toBe("Do Work precisely");
  });
  test("advanced EJS is unavailable without explicit code approval", async () => {
    await expect(
      render([template("code", "<% throw new Error('executed') %>")]),
    ).rejects.toMatchObject({ kind: "unsupported" });
  });
  test("approved EJS supports logic and include locals from the reviewed snapshot", async () => {
    expect(
      await render(
        [
          template("main", "<% if (enabled) { %><%- include('greet', {name:'Otto'}) %><% } %>"),
          template("greet", "<%= greeting %>, <%= name %>"),
        ],
        { enabled: true, greeting: "Hello" },
        true,
      ),
    ).toBe("Hello, Otto");
  });
  test("missing variables and unknown snippets are explicit errors, not literal instructions", async () => {
    await expect(render([template("main", "<%= missing %>")])).rejects.toThrow("not supplied");
    await expect(render([template("main", "<%- include('missing') %>")])).rejects.toThrow(
      "missing from",
    );
  });
  test("a snippet cycle fails within its depth budget", async () => {
    await expect(render([template("main", "<%- include('main') %>")])).rejects.toThrow("5 deep");
  });
  test("reserved/prototype names cannot become implicit template data", async () => {
    await expect(render([template("main", "<%= constructor %>")])).rejects.toThrow("reserved");
    await expect(
      render([template("main", "<%= topic.constructor %>")], { topic: {} }),
    ).rejects.toThrow("reserved");
  });
  test("output and malformed delimiters are bounded", async () => {
    await expect(
      render([template("main", "<%= value %>")], { value: "x".repeat(64001) }),
    ).rejects.toThrow("64,000");
    await expect(render([template("main", "<%= unclosed")])).rejects.toThrow("unclosed");
  });
  test("binding references are values and missing upstream fields become empty data", () => {
    const variables = workflowTemplateVariables(
      {
        templateId: "main",
        variables: {
          topic: "$inputs.goal",
          score: "$output.a.score",
          missing: "$output.a.missing",
          literal: "Keep this",
        },
      },
      { goal: "Review" },
      new Map([["a", { score: 0.9 }]]),
    );
    expect(variables).toEqual({ topic: "Review", score: 0.9, missing: "", literal: "Keep this" });
  });
  test("runaway approved EJS cannot block the daemon event loop", async () => {
    let responsive = false;
    const timer = setTimeout(() => {
      responsive = true;
    }, 20);
    try {
      await expect(render([template("main", "<% while(true) {} %>")], {}, true)).rejects.toThrow(
        "one-second",
      );
      expect(responsive).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });
});
