import { describe, expect, it, vi } from "vitest";
import type { ForgeConnectionStore } from "../../services/git-hosting/connection-store.js";
import { execCommand } from "../../utils/spawn.js";
import { resolveGitHubCliToken, resolveKanbanGitHubCredential } from "./github-cli-token.js";

vi.mock("../../executable-resolution/executable-resolution.js", () => ({
  findExecutable: async () => "gh",
}));
vi.mock("../../utils/spawn.js", () => ({
  execCommand: vi.fn(async () => ({ stdout: "named-token\n" })),
}));

describe("Kanban GitHub credential selection", () => {
  it("reads the named gh login without ambient token overrides", async () => {
    expect(await resolveGitHubCliToken("PhilTasty")).toBe("named-token");
    expect(execCommand).toHaveBeenCalledWith(
      "gh",
      ["auth", "token", "--hostname", "github.com", "--user", "PhilTasty"],
      expect.objectContaining({
        envOverlay: expect.objectContaining({ GH_TOKEN: "", GITHUB_TOKEN: "" }),
      }),
    );
  });

  it("uses a selected token connection without consulting gh", async () => {
    vi.mocked(execCommand).mockClear();
    const connections = {
      selectedCredential: vi.fn(() => ({
        connection: {
          account: "PhilTasty",
          method: "token",
        },
        readSecret: async () => "vault-token",
      })),
    } as unknown as ForgeConnectionStore;
    expect(await resolveKanbanGitHubCredential(connections, "project-1")).toEqual({
      token: "vault-token",
      account: "PhilTasty",
      method: "token",
    });
    expect(connections.selectedCredential).toHaveBeenCalledWith(
      "github",
      "github.com",
      "project-1",
    );
    expect(execCommand).not.toHaveBeenCalled();
  });
});
