import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  workflowSave,
  workflowList,
  workflowRead,
  workflowReviewStart,
  workflowStart,
  workflowDelete,
  workflowTransfer,
  workflowPreviewTemplate,
  unwrapWorkflowResult,
} from "@getpaseo/plugin/otto/workflows";
import { WorkflowDaemonService } from "./service.js";
import { WorkflowChanges } from "./changes.js";
import { workflowHostFixture, deferred } from "./test-utils/host-fixture.js";
import { graphDocument } from "./test-utils/fixture.js";
describe("one scoped Workflow RPC service", () => {
  let f: Awaited<ReturnType<typeof workflowHostFixture>>;
  let service: WorkflowDaemonService;
  beforeEach(async () => {
    f = await workflowHostFixture();
    service = new WorkflowDaemonService(f.library, f.host, new WorkflowChanges());
  });
  afterEach(async () => {
    await service.close();
    await f.cleanup();
  });
  test("library create/read/list and stale edit use validated results and preserve peer data", async () => {
    const created = unwrapWorkflowResult(
      workflowSave.output.parse(
        await service.invoke(workflowSave.name, {
          scope: f.scope,
          expectedRevision: null,
          document: graphDocument(),
        }),
      ),
    );
    expect(
      unwrapWorkflowResult(
        workflowRead.output.parse(await service.invoke(workflowRead.name, created.ref)),
      ),
    ).toEqual(created);
    expect(
      unwrapWorkflowResult(
        workflowList.output.parse(
          await service.invoke(workflowList.name, { scope: f.scope, kind: "definition" }),
        ),
      ).items,
    ).toHaveLength(1);
    expect(
      workflowSave.output.parse(
        await service.invoke(workflowSave.name, {
          scope: f.scope,
          ref: created.ref,
          expectedRevision: "stale",
          document: graphDocument(),
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await f.library.read(created.ref)).toEqual(created);
  });
  test("template preview renders an unsaved root against canonical snippets without persisting or opening a session", async () => {
    await f.library.write(
      f.scope,
      { kind: "template", value: { id: "rules", name: "Rules", content: "Cite sources" } },
      null,
    );
    const result = unwrapWorkflowResult(
      workflowPreviewTemplate.output.parse(
        await service.invoke(workflowPreviewTemplate.name, {
          scope: f.scope,
          template: {
            id: "draft",
            name: "Draft",
            content: "Read <%= topic %> · <%- include('rules') %>",
          },
          variables: { topic: "A&B" },
        }),
      ),
    );
    expect(result).toEqual({ text: "Read A&B · Cite sources" });
    expect((await f.library.list(f.scope, "template")).items.map((item) => item.ref.id)).toEqual([
      "rules",
    ]);
    expect(f.agents.size).toBe(0);
  });
  test("preview code requires explicit authority and still never creates a provider session", async () => {
    const input = {
      scope: f.scope,
      template: { id: "math", name: "Math", content: "<%= 1+2 %>" },
      variables: {},
    };
    expect(
      workflowPreviewTemplate.output.parse(
        await service.invoke(workflowPreviewTemplate.name, input),
      ),
    ).toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(
      unwrapWorkflowResult(
        workflowPreviewTemplate.output.parse(
          await service.invoke(workflowPreviewTemplate.name, { ...input, allowCode: true }),
        ),
      ),
    ).toEqual({ text: "3" });
    expect(f.agents.size).toBe(0);
  });
  test("fabricated runs, foreign hosts and unknown dispatch cannot start a provider", async () => {
    expect(
      await service.invoke(workflowSave.name, {
        scope: f.scope,
        expectedRevision: null,
        document: { kind: "run", value: { id: "fake", title: "Fake", status: "done", phases: [] } },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(
      await service.invoke(workflowList.name, {
        scope: { ...f.scope, hostId: "foreign" },
        kind: "run",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(service.invoke("anything.exec", {})).toBeUndefined();
    expect(f.agents.size).toBe(0);
  });
  test("the public start flow requires its exact review and returns a durable Planning run", async () => {
    const review = unwrapWorkflowResult(
      workflowReviewStart.output.parse(
        await service.invoke(workflowReviewStart.name, {
          scope: f.scope,
          workspaceId: "workspace-1",
          launch: f.ai,
          operationId: "rpc-start",
        }),
      ),
    );
    expect(f.agents.size).toBe(0);
    expect(
      await service.invoke(workflowStart.name, {
        scope: f.scope,
        token: review.token,
        operationId: "changed",
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    const entry = unwrapWorkflowResult(
      workflowStart.output.parse(
        await service.invoke(workflowStart.name, {
          scope: f.scope,
          token: review.token,
          operationId: "rpc-start",
        }),
      ),
    );
    expect(entry.document).toMatchObject({
      kind: "run",
      value: { status: "planning", phases: [] },
    });
    expect(f.agents.size).toBe(1);
  });
  test("terminal-looking history cannot be deleted/transferred until native cleanup settles", async () => {
    const closing = deferred<void>(),
      release = deferred<void>();
    f.hooks.close = async () => {
      closing.resolve();
      await release.promise;
    };
    const entry = await f.start(f.graph);
    try {
      await closing.promise;
      const done = await f.library.read(entry.ref);
      expect(done.document.value.status).toBe("done");
      expect(
        await service.invoke(workflowDelete.name, {
          ref: done.ref,
          expectedRevision: done.revision,
          confirmed: true,
        }),
      ).toMatchObject({ ok: false, error: { code: "busy" } });
      expect(
        await service.invoke(workflowTransfer.name, {
          source: done.ref,
          expectedRevision: done.revision,
          destination: "host",
          operation: "move",
          operationId: "settling",
          confirmed: true,
        }),
      ).toMatchObject({ ok: false, error: { code: "busy" } });
    } finally {
      release.resolve();
    }
    await f.host.settled(entry.ref);
  });
});
