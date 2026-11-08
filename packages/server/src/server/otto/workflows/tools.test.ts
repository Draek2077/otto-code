import { beforeEach, afterEach, describe, test, expect } from "vitest";
import { workflowHostFixture } from "./test-utils/host-fixture.js";
import { WorkflowDaemonService } from "./service.js";
import { WorkflowChanges } from "./changes.js";
import { NodeOutputStore } from "./node-output.js";
import { createWorkflowTools, constrainWorkflowCatalog, type WorkflowToolPorts } from "./tools.js";
import type { PaseoToolDefinition } from "../../agent/tools/types.js";
import { z } from "zod";
describe("live Workflow tool authority", () => {
  let f: Awaited<ReturnType<typeof workflowHostFixture>>;
  let service: WorkflowDaemonService;
  let caller: ReturnType<WorkflowToolPorts["caller"]>;
  let ports: WorkflowToolPorts;
  beforeEach(async () => {
    f = await workflowHostFixture();
    service = new WorkflowDaemonService(f.library, f.host, new WorkflowChanges());
    caller = { workspaceId: "workspace-1", provider: "test" };
    ports = {
      service,
      outputs: new NodeOutputStore(),
      policy: async () => true,
      caller: () => caller,
      scope: async () => f.scope,
    };
  });
  afterEach(async () => {
    await service.close();
    await f.cleanup();
  });
  test("ordinary callers get only the discovery/call pair, with no template contents or implicit launch", async () => {
    const tools = createWorkflowTools(ports);
    expect(tools.map((t) => t.name)).toEqual(["workflow_catalog", "workflow_operation"]);
    const catalog = await tools[0].handler({}, {});
    expect(catalog.isError).toBeUndefined();
    expect(f.agents.size).toBe(0);
    expect(await tools[1].handler({ method: "arbitrary.exec", input: {} }, {})).toMatchObject({
      isError: true,
    });
  });
  test("foreign scope/workspace and fabricated run authoring are refused", async () => {
    const op = createWorkflowTools(ports)[1];
    expect(
      await op.handler(
        {
          workspaceId: "other",
          method: "workflows.library.list.request",
          input: { scope: f.scope, kind: "run" },
        },
        {},
      ),
    ).toMatchObject({ isError: true });
    expect(
      await op.handler(
        {
          method: "workflows.library.list.request",
          input: { scope: { ...f.scope, projectId: "other" }, kind: "run" },
        },
        {},
      ),
    ).toMatchObject({ isError: true });
  });
  test("conductor plan tool persists a paused plan and returns without waiting inside its turn", async () => {
    const entry = await f.start();
    caller.agentId = z.string().parse(entry.document.value.conductorAgentId);
    const tools = createWorkflowTools(ports);
    expect(tools.map((t) => t.name)).toEqual(["get_workflow_status", "start_workflow"]);
    const plan = tools.find((t) => t.name === "start_workflow")!;
    expect(
      await plan.handler(
        {
          title: "Work plan",
          phases: [{ id: "work", title: "Work", type: "implement", task: "Work", role: "maker" }],
        },
        {},
      ),
    ).toMatchObject({ structuredContent: { status: "paused" } });
    expect(f.agents.size).toBe(1);
    await f.host.control(entry.ref, (await f.library.read(entry.ref)).revision, "cancel");
    await f.host.settled(entry.ref);
    expect(await plan.handler({ phases: [] }, {})).toMatchObject({ isError: true });
  });
  test("retained host/provider ceiling cannot be bypassed by private tools", async () => {
    const entry = await f.start();
    caller.agentId = z.string().parse(entry.document.value.conductorAgentId);
    ports.policy = async () => false;
    expect(await createWorkflowTools(ports)[0].handler({}, {})).toMatchObject({ isError: true });
  });
  test("unowned catalogs preserve identity; reserved member catalogs refuse unmanaged lifecycle", async () => {
    const fn: PaseoToolDefinition = {
      name: "create_agent",
      description: "",
      handler: async () => ({ content: [] }),
    };
    const schedule: PaseoToolDefinition = {
      name: "schedule_operation",
      description: "",
      handler: async () => ({ content: [] }),
    };
    const tools = new Map([
      [fn.name, fn],
      [schedule.name, schedule],
    ]);
    constrainWorkflowCatalog(tools, ports);
    expect(tools.get(fn.name)).toBe(fn);
    expect(tools.get(schedule.name)).toBe(schedule);
    const entry = await f.start();
    caller.agentId = z.string().parse(entry.document.value.conductorAgentId);
    constrainWorkflowCatalog(tools, ports);
    expect(tools.size).toBe(0);
  });
  test("read ceiling ignores third-party hints and pins retained Knowledge to the owned workspace", async () => {
    const graph = structuredClone(f.graph);
    if (graph.kind !== "graph") throw new Error("Fixture");
    graph.graph.nodes[1].access = "read";
    let seen: unknown;
    f.hooks.turn = async (request) => {
      if (request.role === "worker") {
        caller.agentId = request.agentId;
        const tools = new Map<string, PaseoToolDefinition>([
          [
            "vendor_delete",
            {
              name: "vendor_delete",
              description: "",
              annotations: { readOnlyHint: true },
              handler: async () => ({ content: [] }),
            },
          ],
          [
            "read_project_knowledge",
            {
              name: "read_project_knowledge",
              description: "",
              handler: async (input) => {
                seen = input;
                return { content: [] };
              },
            },
          ],
        ]);
        constrainWorkflowCatalog(tools, ports);
        expect(tools.has("vendor_delete")).toBe(false);
        await tools
          .get("read_project_knowledge")!
          .handler({ workspaceId: "other", id: "root" }, {});
      }
      return { failed: false, finalMessage: "Done" };
    };
    const entry = await f.start(graph);
    await f.host.settled(entry.ref);
    expect(seen).toEqual({ workspaceId: "workspace-1", id: "root" });
  });
});
