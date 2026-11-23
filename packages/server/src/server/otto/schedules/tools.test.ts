import { expect, test, vi } from "vitest";
import * as rpc from "@getpaseo/plugin/otto/schedules";
import { scheduleCatalogTools } from "./tools.js";
import { scheduleApiFixture } from "./test-utils/api-fixture.js";

async function fixture() {
  const f = await scheduleApiFixture();
  const owner = {
    caller: () => ({ agentId: "caller", workspaceId: "workspace", provider: "fixture" }),
    scope: vi.fn(async () => f.scope),
  };
  const invoke = vi.fn((method: string, input: unknown) => f.api.invoke(method, input));
  const definitions = scheduleCatalogTools({ host: { invoke }, policy: async () => true, owner });
  function tool(name: string) {
    const found = definitions.find((row) => row.name === name);
    if (!found) throw new Error("Missing Schedule tool");
    return found;
  }
  return {
    ...f,
    owner,
    invoke,
    definitions,
    catalog: tool("schedule_catalog"),
    operation: tool("schedule_operation"),
  };
}
test("progressive discovery returns operation names and only the requested schema without loading saved contents", async () => {
  const f = await fixture();
  try {
    const result = await f.catalog.handler({}, {});
    expect(result.structuredContent).toEqual({
      scope: f.scope,
      operations: rpc.scheduleOperations.map((operation) => ({
        name: operation.name,
        readOnly: !rpc.scheduleOperationWrites(operation.name),
      })),
    });
    expect(JSON.stringify(result)).not.toContain(f.draft.prompt);
    const schema = await f.catalog.handler({ operation: rpc.controlSchedule.name }, {});
    expect(schema.structuredContent).toMatchObject({
      operations: [{ name: rpc.controlSchedule.name, readOnly: false, input: { type: "object" } }],
    });
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
test("writes require explicit intent and use the same canonical create API without admitting work during review", async () => {
  const f = await fixture();
  try {
    const input = {
      method: rpc.createSchedule.name,
      input: { scope: f.scope, operationId: "tool-create", draft: f.draft },
    };
    expect(await f.operation.handler(input, {})).toMatchObject({
      isError: true,
      structuredContent: { error: "Obtain explicit approval for this exact Schedule write first." },
    });
    expect(await f.registry.catalog()).toHaveLength(0);
    const created = await f.operation.handler({ ...input, userApproved: true }, {});
    expect(created.structuredContent).toMatchObject({
      ok: true,
      value: {
        ref: { scope: f.scope },
        schedule: { prompt: f.draft.prompt, otto: { creation: { operationId: "tool-create" } } },
      },
    });
    expect(await f.registry.catalog()).toHaveLength(1);
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
test("chat workspace, canonical project and host cannot be replaced by input labels or paths", async () => {
  const f = await fixture();
  try {
    const invoke = f.invoke;
    expect(await f.catalog.handler({ workspaceId: "different" }, {})).toMatchObject({
      isError: true,
    });
    expect(
      await f.operation.handler(
        { method: rpc.listSchedules.name, input: { scope: { ...f.scope, projectId: "other" } } },
        {},
      ),
    ).toMatchObject({ isError: true });
    expect(
      await f.operation.handler(
        { method: rpc.listSchedules.name, input: { scope: { ...f.scope, hostId: "other" } } },
        {},
      ),
    ).toMatchObject({ isError: true });
    expect(
      await f.operation.handler(
        { method: rpc.listSchedules.name, input: { scope: f.scope, includeLegacy: true } },
        {},
      ),
    ).toMatchObject({ isError: true });
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
test("a live caller losing its workspace cannot borrow an outside-chat workspace", async () => {
  const f = await fixture();
  try {
    const definitions = scheduleCatalogTools({
      host: f.api,
      policy: async () => true,
      owner: { ...f.owner, caller: () => ({ agentId: "gone", provider: "fixture" }) },
    });
    const catalog = definitions.find((row) => row.name === "schedule_catalog");
    if (!catalog) throw new Error("Missing catalog");
    expect(await catalog.handler({ workspaceId: "workspace" }, {})).toMatchObject({
      isError: true,
    });
    expect(f.owner.scope).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
test("malformed success and lost transport do not acknowledge or replay a mutation", async () => {
  const f = await fixture();
  try {
    const saved = await f.create(),
      invoke = vi.fn(async (): Promise<unknown> => ({ ok: true, value: {} }));
    const definitions = scheduleCatalogTools({
      host: { invoke },
      policy: async () => true,
      owner: f.owner,
    });
    const operation = definitions.find((row) => row.name === "schedule_operation");
    if (!operation) throw new Error("Missing operation");
    const input = {
      method: rpc.controlSchedule.name,
      userApproved: true,
      input: { ref: saved.ref, expectedRevision: saved.revision, command: { type: "delete" } },
    };
    expect(await operation.handler(input, {})).toMatchObject({ isError: true });
    invoke.mockRejectedValueOnce(new Error("private transport details"));
    expect(await operation.handler(input, {})).toMatchObject({ isError: true });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(await f.registry.catalog()).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});
