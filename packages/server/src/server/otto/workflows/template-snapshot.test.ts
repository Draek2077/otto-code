import { beforeEach, afterEach, describe, test, expect } from "vitest";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { workflowHostFixture } from "./test-utils/host-fixture.js";
import { captureWorkflowTemplates } from "./template-snapshot.js";
describe("exact Workflow template launch snapshots", () => {
  let f: Awaited<ReturnType<typeof workflowHostFixture>>;
  beforeEach(async () => {
    f = await workflowHostFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });
  test("captures referenced templates and include closure with exact origins/revisions", async () => {
    const snippet = await f.library.write(
      f.scope,
      { kind: "template", value: { id: "rules", name: "Rules", content: "Be precise" } },
      null,
    );
    const main = await f.library.write(
      f.scope,
      {
        kind: "template",
        value: { id: "main", name: "Main", content: "Do <%- include('rules') %>" },
      },
      null,
    );
    if (main.document.kind !== "template") throw new Error("Fixture");
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].promptTemplate = { templateId: "main" };
    const captured = await captureWorkflowTemplates(f.library, f.scope, graph);
    if (captured.kind !== "graph") throw new Error("Fixture");
    expect(captured.templateSnapshots?.map((item) => [item.ref.id, item.revision])).toEqual([
      ["main", main.revision],
      ["rules", snippet.revision],
    ]);
    await f.library.write(
      f.scope,
      { kind: "template", value: { ...main.document.value, content: "Peer edit" } },
      main.revision,
      main.ref,
    );
    expect(captured.templateSnapshots?.[0].template.content).toBe("Do <%- include('rules') %>");
  });
  test("caller-supplied snapshots cannot substitute code for host-resolved template bytes", async () => {
    await f.library.write(
      f.scope,
      { kind: "template", value: { id: "main", name: "Main", content: "Canonical" } },
      null,
    );
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].promptTemplate = { templateId: "main" };
    graph.templateSnapshots = [
      {
        ref: { scope: f.scope, kind: "template", id: "main", location: "host" },
        revision: "forged",
        template: { id: "main", name: "Forged", content: "Malicious" },
      },
    ];
    const captured = await captureWorkflowTemplates(f.library, f.scope, graph);
    if (captured.kind !== "graph") throw new Error("Fixture");
    expect(captured.templateSnapshots?.[0].template.content).toBe("Canonical");
  });
  test("missing and colliding origins block review before any session starts", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].promptTemplate = { templateId: "missing" };
    await expect(f.host.review(f.scope, "workspace-1", graph, "missing")).rejects.toThrow(
      "missing or has multiple origins",
    );
    const document = {
      kind: "template" as const,
      value: { id: "missing", name: "T", content: "Content" },
    };
    await f.library.write(f.scope, document, null);
    await f.library.write(f.scope, document, null, undefined, "host");
    await expect(f.host.review(f.scope, "workspace-1", graph, "collision")).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(f.agents.size).toBe(0);
  });
  test("code approval compiles the captured templates without executing them during review", async () => {
    await f.library.write(
      f.scope,
      {
        kind: "template",
        value: { id: "code", name: "Code", content: "<% throw new Error('executed') %>" },
      },
      null,
    );
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].promptTemplate = { templateId: "code" };
    await expect(f.host.review(f.scope, "workspace-1", graph, "unapproved")).rejects.toThrow(
      "explicitly allow",
    );
    graph.allowTemplateCode = true;
    expect(await f.host.review(f.scope, "workspace-1", graph, "approved")).toMatchObject({
      launch: { allowTemplateCode: true },
    });
    expect(f.agents.size).toBe(0);
  });
  test("an explicit project copy shadows its retained global original without deleting either", async () => {
    await mkdir(path.join(f.home, "prompt-templates"));
    await writeFile(
      path.join(f.home, "prompt-templates/main.json"),
      JSON.stringify({ id: "main", name: "Legacy", content: "Original" }),
    );
    const copied = await f.library.write(
      f.scope,
      {
        kind: "template",
        value: { id: "main", name: "Project", content: "Reviewed project value" },
      },
      null,
    );
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].promptTemplate = { templateId: "main" };
    const captured = await captureWorkflowTemplates(f.library, f.scope, graph);
    if (captured.kind !== "graph") throw new Error("Fixture");
    expect(captured.templateSnapshots?.[0]).toMatchObject({
      revision: copied.revision,
      template: { content: "Reviewed project value" },
    });
  });
  test("include cycles are refused during inert review, before a native agent is created", async () => {
    await f.library.write(
      f.scope,
      {
        kind: "template",
        value: { id: "first", name: "First", content: "<%- include('second') %>" },
      },
      null,
    );
    await f.library.write(
      f.scope,
      {
        kind: "template",
        value: { id: "second", name: "Second", content: "<%- include('first') %>" },
      },
      null,
    );
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].promptTemplate = { templateId: "first" };
    await expect(f.host.review(f.scope, "workspace-1", graph, "cycle")).rejects.toThrow(
      "include cycle",
    );
    expect(f.agents.size).toBe(0);
  });
});
