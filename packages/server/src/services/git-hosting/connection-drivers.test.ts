import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForgeConnection } from "@otto-code/protocol/forge-connections";
import { execCommand } from "../../utils/spawn.js";
import { defaultResolveRemoteUrl } from "../forge-cli-command.js";
import { createConnectedForgeService } from "./connection-drivers.js";

vi.mock("../../utils/spawn.js", () => ({
  execCommand: vi.fn(async () => ({ stdout: "[]", stderr: "" })),
}));
vi.mock("../../executable-resolution/executable-resolution.js", () => ({
  findExecutable: vi.fn(async (binary: string) => binary),
}));
vi.mock("../../utils/ssh-hostname.js", () => ({
  resolveSshHostname: vi.fn(async () => "github.com"),
}));
vi.mock("../forge-cli-command.js", async (original) => ({
  ...(await original<typeof import("../forge-cli-command.js")>()),
  defaultResolveRemoteUrl: vi.fn(async () => "git@github-work:team/repo.git"),
}));

describe("connection-bound command transport", () => {
  const services: ReturnType<typeof createConnectedForgeService>[] = [];
  const create = (account: string) => {
    const connection: ForgeConnection = {
      id: account,
      account,
      label: account,
      forge: "github",
      host: "github.com",
      method: "token",
      revision: 1,
    };
    const service = createConnectedForgeService(connection, async () => `fixture-${account}`);
    services.push(service);
    return service;
  };
  afterEach(() => {
    services.splice(0).forEach((s) => s.dispose?.());
    vi.clearAllMocks();
  });

  it("routes SSH aliases to the real API host and isolates simultaneous account environments", async () => {
    const original = process.env.GH_TOKEN;
    await Promise.all([
      create("work").listIssues({ cwd: "/work" }),
      create("personal").listIssues({ cwd: "/personal" }),
    ]);
    const overlays = vi.mocked(execCommand).mock.calls.map((c) => c[2]?.envOverlay);
    expect(overlays).toHaveLength(2);
    expect(overlays).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          GH_HOST: "github.com",
          GH_REPO: "github.com/team/repo",
          GH_TOKEN: "fixture-work",
          GITHUB_TOKEN: "",
          GH_PROMPT_DISABLED: "1",
        }),
        expect.objectContaining({
          GH_HOST: "github.com",
          GH_REPO: "github.com/team/repo",
          GH_TOKEN: "fixture-personal",
          GITHUB_TOKEN: "",
          GH_PROMPT_DISABLED: "1",
        }),
      ]),
    );
    expect(process.env.GH_TOKEN).toBe(original);
  });

  it("refuses to send a bound credential after the repository moves to another host", async () => {
    vi.mocked(defaultResolveRemoteUrl).mockResolvedValueOnce("https://other.example/team/repo.git");
    await expect(create("work").listIssues({ cwd: "/work" })).rejects.toThrow(
      "different Git server",
    );
    expect(execCommand).not.toHaveBeenCalled();
  });
});
