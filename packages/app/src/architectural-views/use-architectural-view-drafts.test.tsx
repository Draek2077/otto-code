/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useArchitecturalViewDrafts } from "./use-architectural-view-drafts";

const runtime = vi.hoisted(() => ({
  client: null as { listArchitecturalViewDrafts?: ReturnType<typeof vi.fn> } | null,
  supported: true,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        host: {
          client: runtime.client,
          serverInfo: { features: { architecturalViewDraftDiscovery: runtime.supported } },
        },
      },
    }),
}));

describe("Architectural View draft discovery", () => {
  beforeEach(() => {
    runtime.supported = true;
    runtime.client = null;
  });

  it("does not call a preserved client instance that predates draft discovery", () => {
    runtime.client = {};

    const { result } = renderHook(() =>
      useArchitecturalViewDrafts("host", "workspace", { kind: "record", id: "workflows" }),
    );

    expect(result.current.supported).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("lists drafts when both daemon and client support discovery", async () => {
    const listArchitecturalViewDrafts = vi.fn(async () => ({
      requestId: "request",
      success: true,
      drafts: [],
      error: null,
    }));
    runtime.client = { listArchitecturalViewDrafts };

    const { result } = renderHook(() =>
      useArchitecturalViewDrafts("host", "workspace", { kind: "record", id: "workflows" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listArchitecturalViewDrafts).toHaveBeenCalledWith({
      workspaceId: "workspace",
      knowledgeReference: { kind: "record", id: "workflows" },
    });
  });
});
