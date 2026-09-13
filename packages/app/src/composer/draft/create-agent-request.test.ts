import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { encodeImages } from "@/utils/encode-images";
import { requestWorkspaceDraftAgent } from "./create-agent-request";
vi.mock("@/utils/encode-images", () => ({ encodeImages: vi.fn() }));

describe("workspace draft creation boundary", () => {
  it("encodes images and retains Otto identity and authoring alongside the ordinary first turn", async () => {
    const sourceImages = [
      {
        id: "image",
        mimeType: "image/png",
        storageType: "web-indexeddb" as const,
        storageKey: "attachments/image",
        createdAt: 1,
      },
    ];
    const encoded = [{ data: "image-bytes", mimeType: "image/png" }];
    vi.mocked(encodeImages).mockResolvedValue(encoded);
    const createAgent = vi.fn().mockResolvedValue({ id: "created" });
    const client = { createAgent } as unknown as DaemonClient;
    const config = { provider: "codex", cwd: "/repo" };
    const architecturalViewDraft = { viewId: "view", draftId: "draft" };
    const result = await requestWorkspaceDraftAgent(client, {
      workspaceId: "workspace",
      config,
      text: "author this view",
      clientMessageId: "message",
      personality: "local-chatter",
      architecturalViewDraft,
      images: sourceImages,
    });
    expect(encodeImages).toHaveBeenCalledWith(sourceImages);
    expect(createAgent).toHaveBeenCalledWith({
      config,
      workspaceId: "workspace",
      initialPrompt: "author this view",
      clientMessageId: "message",
      images: encoded,
      personality: "local-chatter",
      architecturalViewDraft,
    });
    expect(result.id).toBe("created");
  });
  it("does not dispatch creation when image encoding fails", async () => {
    vi.mocked(encodeImages).mockRejectedValue(new Error("missing attachment"));
    const createAgent = vi.fn();
    await expect(
      requestWorkspaceDraftAgent({ createAgent } as unknown as DaemonClient, {
        workspaceId: "workspace",
        config: { provider: "codex", cwd: "/repo" },
        text: "prompt",
        clientMessageId: "message",
      }),
    ).rejects.toThrow("missing attachment");
    expect(createAgent).not.toHaveBeenCalled();
  });
});
