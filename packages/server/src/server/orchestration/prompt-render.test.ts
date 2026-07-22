import { describe, expect, test } from "vitest";

import type { PromptTemplate } from "@otto-code/protocol/orchestration";

import {
  PromptTemplateRenderError,
  renderPromptTemplate,
  resolveTemplateVariables,
} from "./prompt-render.js";

function template(overrides: Partial<PromptTemplate> & { id: string }): PromptTemplate {
  return { name: overrides.id, content: "", ...overrides };
}

describe("renderPromptTemplate", () => {
  test("substitutes variables without escaping them", () => {
    // Prompts are text, not markup: & and quotes must survive verbatim.
    const rendered = renderPromptTemplate({
      template: template({ id: "t", content: "Research <%= topic %> now" }),
      variables: { topic: 'R&D "spikes"' },
      resolveSnippet: () => null,
    });
    expect(rendered).toBe('Research R&D "spikes" now');
  });

  test("includes a snippet from the store, not the filesystem", () => {
    const rendered = renderPromptTemplate({
      template: template({ id: "t", content: "Do it.\n<%- include('rules') %>" }),
      variables: {},
      resolveSnippet: (id) =>
        id === "rules" ? template({ id: "rules", content: "Call the tool." }) : null,
    });
    expect(rendered).toBe("Do it.\nCall the tool.");
  });

  test("a snippet sees the parent's variables plus its own locals", () => {
    const rendered = renderPromptTemplate({
      template: template({
        id: "t",
        content: "<%- include('greet', { name: 'Otto' }) %>",
      }),
      variables: { greeting: "Hello" },
      resolveSnippet: () => template({ id: "greet", content: "<%= greeting %>, <%= name %>" }),
    });
    expect(rendered).toBe("Hello, Otto");
  });

  test("an unknown snippet is a named error, not a silent gap", () => {
    expect(() =>
      renderPromptTemplate({
        template: template({ id: "t", content: "<%- include('missing') %>" }),
        variables: {},
        resolveSnippet: () => null,
      }),
    ).toThrow(PromptTemplateRenderError);
  });

  test("a snippet cycle is caught instead of hanging", () => {
    expect(() =>
      renderPromptTemplate({
        template: template({ id: "a", content: "<%- include('a') %>" }),
        variables: {},
        resolveSnippet: (id) => template({ id, content: "<%- include('a') %>" }),
      }),
    ).toThrow(/nest more than/);
  });

  test("a syntax error names the template", () => {
    expect(() =>
      renderPromptTemplate({
        template: template({ id: "broken", content: "<%= unclosed" }),
        variables: {},
        resolveSnippet: () => null,
      }),
    ).toThrow(/Prompt template "broken"/);
  });
});

describe("resolveTemplateVariables", () => {
  test("resolves literals, graph inputs, and upstream output fields", () => {
    const resolved = resolveTemplateVariables({
      bindings: {
        literal: "just text",
        fromInput: "$inputs.goal",
        fromOutput: "$output.classify.complexity",
      },
      graphInputs: { goal: "ship it" },
      upstreamFields: new Map([["classify", { complexity: "simple" }]]),
    });
    expect(resolved).toEqual({
      literal: "just text",
      fromInput: "ship it",
      fromOutput: "simple",
    });
  });

  test("an unresolvable reference becomes empty rather than leaking its syntax", () => {
    // `$output.missing.x` reaching a prompt would read as an instruction.
    const resolved = resolveTemplateVariables({
      bindings: { a: "$inputs.nope", b: "$output.missing.x" },
      graphInputs: {},
      upstreamFields: new Map(),
    });
    expect(resolved).toEqual({ a: "", b: "" });
  });
});
