import { describe, expect, it } from "vitest";
import { buildWorkspaceSetupCreateAgentOptions } from "./workspace-setup-agent-options";

describe("buildWorkspaceSetupCreateAgentOptions", () => {
  it("keeps an image-only initial prompt correlated to its local user message", () => {
    const options = buildWorkspaceSetupCreateAgentOptions({
      composerState: {
        modeOptions: [{ id: "default" }],
        selectedMode: "default",
        effectiveModelId: "gpt-5.4",
        effectiveThinkingOptionId: null,
        agentControls: { personality: null },
      },
      text: "",
      attachments: [],
      encodedImages: [{ data: "image-data", mimeType: "image/png" }],
      workspaceDirectory: "/repo",
      workspaceId: "workspace-1",
      provider: "codex",
      clientMessageId: "client-image-prompt",
    });

    expect(options).toMatchObject({
      provider: "codex",
      cwd: "/repo",
      workspaceId: "workspace-1",
      clientMessageId: "client-image-prompt",
      images: [{ data: "image-data", mimeType: "image/png" }],
    });
    expect(options).not.toHaveProperty("initialPrompt");
  });
});
