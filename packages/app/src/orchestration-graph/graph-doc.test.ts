import { describe, expect, test } from "vitest";

import {
  carryUneditedEdgeFields,
  carryUneditedNodeFields,
  formatOutputFields,
  formatQueryTools,
  formatTemplateVariables,
  graphEdgeKey,
  parseOutputFields,
  parseQueryTools,
  parseTemplateVariables,
} from "./graph-doc";

describe("output field text form", () => {
  test("round-trips name, type, description and optionality", () => {
    const fields = [
      { key: "complexity", type: "string", description: "simple or complex" },
      { key: "score", type: "number" },
      { key: "notes", type: "string", required: false },
    ];
    expect(parseOutputFields(formatOutputFields(fields))).toEqual(fields);
  });

  test("a bare name is a required string — the common case needs no syntax", () => {
    expect(parseOutputFields("summary")).toEqual([{ key: "summary", type: "string" }]);
  });

  test("keeps colons inside a description", () => {
    expect(parseOutputFields("verdict : string : pass: or fail:")).toEqual([
      { key: "verdict", type: "string", description: "pass: or fail:" },
    ]);
  });

  test("ignores blank lines and nameless entries", () => {
    expect(parseOutputFields("\n  \n : string \nreal")).toEqual([{ key: "real", type: "string" }]);
  });
});

describe("query tool text form", () => {
  test("round-trips a command tool and derives its parameters from the spec", () => {
    const text = "recent | command | git log -n {{count}} | Recent commits";
    expect(parseQueryTools(text)).toEqual([
      {
        name: "recent",
        kind: "command",
        description: "Recent commits",
        parameters: [{ key: "count", type: "string" }],
        command: ["git", "log", "-n", "{{count}}"],
      },
    ]);
  });

  test("a URL's colons survive — the separator is a pipe for exactly this reason", () => {
    expect(
      parseQueryTools("status | http-get | https://example.test/api?q={{q}} | Status"),
    ).toEqual([
      {
        name: "status",
        kind: "http-get",
        description: "Status",
        parameters: [{ key: "q", type: "string" }],
        url: "https://example.test/api?q={{q}}",
      },
    ]);
  });

  test("an untouched line hands back the original tool, keeping detail the form can't show", () => {
    const original = {
      name: "issues",
      kind: "command",
      description: "Open issues",
      parameters: [{ key: "label", type: "string", description: "Filter label", required: false }],
      command: ["gh", "issue", "list", "--label", "{{label}}"],
    };
    const parsed = parseQueryTools(formatQueryTools([original]), [original]);
    expect(parsed).toEqual([original]);
    expect(parsed[0]).toBe(original);
  });

  test("an edited line is re-parsed, replacing the original", () => {
    const original = {
      name: "issues",
      kind: "command",
      description: "Open issues",
      command: ["gh", "issue", "list"],
    };
    expect(parseQueryTools("issues | command | gh pr list | Open PRs", [original])).toEqual([
      { name: "issues", kind: "command", description: "Open PRs", command: ["gh", "pr", "list"] },
    ]);
  });

  test("a line with no spec is not a tool", () => {
    expect(parseQueryTools("\n  \nhalf | command |  \n")).toEqual([]);
  });

  test("an unknown kind is preserved rather than coerced into a command", () => {
    // Coercing would run something the author never asked for; the daemon
    // refuses the unknown kind instead.
    expect(parseQueryTools("x | graphql | query {} | X")[0]).toMatchObject({ kind: "graphql" });
    expect(parseQueryTools("x | graphql | query {} | X")[0]).not.toHaveProperty("command");
  });
});

describe("prompt-template variable bindings", () => {
  test("round-trips names and values", () => {
    const variables = { topic: "$inputs.subject", tone: "brisk" };
    expect(parseTemplateVariables(formatTemplateVariables(variables))).toEqual(variables);
  });

  test("keeps equals signs inside a value", () => {
    expect(parseTemplateVariables("filter = a=b")).toEqual({ filter: "a=b" });
  });

  test("ignores lines that bind nothing", () => {
    expect(parseTemplateVariables("no separator here\n = orphan\ngood = 1")).toEqual({ good: "1" });
  });
});

describe("carrying properties the designer cannot edit", () => {
  test("a node keeps capabilities the canvas has no control for", () => {
    // The designer rebuilds nodes on export; without this, opening a graph that
    // uses a newer property and pressing Save would silently delete it. The
    // property is a passthrough one on purpose — this guards the properties
    // that do not exist yet.
    const carried = carryUneditedNodeFields({
      id: "a",
      kind: "agent",
      title: "A",
      prompt: "p",
      somethingNewer: { shape: 1 },
    } as never);
    expect(carried).toEqual({ somethingNewer: { shape: 1 } });
  });

  test("properties the canvas does own are not carried, so edits win", () => {
    const carried = carryUneditedNodeFields({
      id: "a",
      kind: "agent",
      title: "A",
      prompt: "p",
      role: "coder",
      access: "read",
      output: { fields: [{ key: "x", type: "string" }] },
      retry: { maxAttempts: 3, backoffMs: 2000 },
      timeoutMs: 60_000,
      tools: ["workspace"],
      queryTools: [{ name: "issues", description: "List issues", kind: "command" }],
      promptTemplate: { templateId: "research" },
    });
    expect(carried).toEqual({});
  });

  test("an edge keeps its condition and field selection", () => {
    expect(
      carryUneditedEdgeFields({
        from: "a",
        to: "b",
        when: { expression: 'complexity = "simple"' },
        fields: ["complexity"],
        label: "simple",
      }),
    ).toEqual({
      when: { expression: 'complexity = "simple"' },
      fields: ["complexity"],
      label: "simple",
    });
  });

  test("edges are keyed by their endpoints, so redrawing a wire keeps its meaning", () => {
    expect(graphEdgeKey("a", "b")).toBe(graphEdgeKey("a", "b"));
    expect(graphEdgeKey("a", "b")).not.toBe(graphEdgeKey("b", "a"));
  });
});
