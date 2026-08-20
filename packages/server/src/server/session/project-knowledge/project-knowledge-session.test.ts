import { describe, expect, it, vi } from "vitest";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  ProjectKnowledgeSession,
  type ProjectKnowledgeSessionOptions,
} from "./project-knowledge-session.js";

// The project.knowledge.* RPCs the domain dispatches, with the response type each must
// answer and whether a successful mutation must re-scan and push the context report.
// session.ts keeps one registration line for the whole domain; this is that contract.
const cases: Array<[SessionInboundMessage, string, { pushes: boolean }]> = [
  [
    { type: "project.knowledge.list.request", requestId: "r", workspaceId: "w" },
    "project.knowledge.list.response",
    { pushes: false },
  ],
  [
    { type: "project.knowledge.get.request", requestId: "r", workspaceId: "w", id: "k1" },
    "project.knowledge.get.response",
    { pushes: false },
  ],
  [
    {
      type: "project.knowledge.create.request",
      requestId: "r",
      workspaceId: "w",
      kind: "decision",
      title: "T",
      statement: "S",
    } as unknown as SessionInboundMessage,
    "project.knowledge.create.response",
    { pushes: true },
  ],
  [
    {
      type: "project.knowledge.apply.request",
      requestId: "r",
      workspaceId: "w",
      id: "k1",
      statement: "S2",
      provenanceText: "why",
    },
    "project.knowledge.apply.response",
    { pushes: true },
  ],
  [
    {
      type: "project.knowledge.status.request",
      requestId: "r",
      workspaceId: "w",
      id: "k1",
      status: "confirmed",
    } as unknown as SessionInboundMessage,
    "project.knowledge.status.response",
    { pushes: true },
  ],
  [
    {
      type: "project.knowledge.project.apply.request",
      requestId: "r",
      workspaceId: "w",
      id: "k1",
      deliveryStatus: "in_build",
      reason: "why",
    } as unknown as SessionInboundMessage,
    "project.knowledge.project.apply.response",
    { pushes: true },
  ],
  [
    {
      type: "project.knowledge.reference.apply.request",
      requestId: "r",
      workspaceId: "w",
      id: "k1",
      disposition: "adopted",
      reason: "why",
    } as unknown as SessionInboundMessage,
    "project.knowledge.reference.apply.response",
    { pushes: true },
  ],
  [
    {
      type: "project.knowledge.root.apply.request",
      requestId: "r",
      workspaceId: "w",
      slug: "background",
      body: "…",
    },
    "project.knowledge.root.apply.response",
    { pushes: true },
  ],
  [
    {
      type: "project.knowledge.delete.request",
      requestId: "r",
      workspaceId: "w",
      id: "k1",
      reason: "why",
    },
    "project.knowledge.delete.response",
    { pushes: true },
  ],
];

const record = { id: "k1", kind: "decision", title: "T", statement: "S" };

function buildSession(overrides: Partial<ProjectKnowledgeSessionOptions> = {}) {
  const emitted: SessionOutboundMessage[] = [];
  const pushContextReport = vi.fn(async () => undefined);
  const invalidate = vi.fn();
  const projectKnowledge = {
    catalogViewAtRoot: vi.fn(async () => ({
      records: [],
      rootPages: [],
      findings: [],
      brief: { text: "", estTokens: 0, includedIds: [], omittedCount: 0 },
    })),
    get: vi.fn(async () => record),
    record: vi.fn(async () => record),
    updateTruth: vi.fn(async () => ({ record })),
    applyReviewedMutation: vi.fn(async () => ({ record })),
    setStatus: vi.fn(async () => record),
    updateProject: vi.fn(async () => ({ record })),
    updateReference: vi.fn(async () => ({ record })),
    updateRoot: vi.fn(async () => ({ slug: "background", title: "Background", body: "…" })),
    delete: vi.fn(async () => ({ deleted: true })),
  };
  const session = new ProjectKnowledgeSession({
    host: { emit: (msg) => emitted.push(msg), pushContextReport },
    projectKnowledge:
      projectKnowledge as unknown as ProjectKnowledgeSessionOptions["projectKnowledge"],
    contextManagement: {
      invalidate,
    } as unknown as ProjectKnowledgeSessionOptions["contextManagement"],
    workspaceRegistry: {
      get: vi.fn(async () => ({ id: "w", projectId: "p", cwd: "/repo" })),
    } as unknown as ProjectKnowledgeSessionOptions["workspaceRegistry"],
    projectRegistry: {
      get: vi.fn(async () => ({ id: "p", rootPath: "/repo" })),
    } as unknown as ProjectKnowledgeSessionOptions["projectRegistry"],
    workspaceGitService: {
      resolveRepoRoot: vi.fn(async () => "/repo"),
    } as unknown as ProjectKnowledgeSessionOptions["workspaceGitService"],
    ...overrides,
  });
  return { session, emitted, pushContextReport, invalidate, projectKnowledge };
}

describe("ProjectKnowledgeSession", () => {
  it.each(cases)("answers %j with the matching response", async (msg, responseType, expected) => {
    const { session, emitted, pushContextReport, invalidate } = buildSession();
    const handled = session.dispatch(msg);
    expect(handled).toBeInstanceOf(Promise);
    await handled;
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe(responseType);
    expect((emitted[0] as { payload: { requestId: string } }).payload.requestId).toBe("r");
    // A successful mutation changes the fixed context weight: the domain must
    // invalidate and push the report, and reads must not.
    expect(pushContextReport).toHaveBeenCalledTimes(expected.pushes ? 1 : 0);
    expect(invalidate).toHaveBeenCalledTimes(expected.pushes ? 1 : 0);
  });

  it("answers list with the empty catalog when the daemon has no knowledge service", async () => {
    const { session, emitted } = buildSession({ projectKnowledge: null });
    await session.dispatch({
      type: "project.knowledge.list.request",
      requestId: "r",
      workspaceId: "w",
    });
    expect(emitted[0]).toMatchObject({
      type: "project.knowledge.list.response",
      payload: { requestId: "r", records: [], brief: "", omittedCount: 0 },
    });
  });

  it("returns undefined for messages outside the domain so the dispatch chain continues", () => {
    const { session, emitted } = buildSession();
    expect(session.dispatch({ type: "ping" } as unknown as SessionInboundMessage)).toBeUndefined();
    expect(emitted).toHaveLength(0);
  });
});
