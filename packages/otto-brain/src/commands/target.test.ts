import { afterEach, expect, it, vi } from "vitest";
import { createBrainCommand } from "../cli.js";
import { withCommandHost, type HostCommandPort } from "./host-command.js";
import { selectedBrainCommandHost, withBrainCommandHost } from "./target.js";

afterEach(() => vi.restoreAllMocks());
function readInstance() {
  return withCommandHost(async (port) => port.instanceId);
}

function host(id: string): HostCommandPort {
  return {
    instanceId: id,
    request: vi.fn(async (route, signal) => {
      signal.throwIfAborted();
      if (route === "/__host/capabilities")
        return {
          modelAcquisition: true,
          catalog: true,
          hfSearch: true,
          inventory: true,
          jobs: true,
          events: true,
        };
      if (route === "/__host/models") return { models: [] };
      if (route.startsWith("/__host/hf/search?"))
        return {
          models: [
            {
              repo: `${id}/model`,
              downloads: 12,
              likes: 3,
              gated: false,
              summary: "Selected owner",
            },
          ],
        };
      throw new Error("Unexpected test command");
    }),
    events: async () => {},
  };
}

it.each([
  { flags: ["--json"], expected: '"repo": "selected/model"' },
  { flags: ["--format", "yaml"], expected: "repo: selected/model" },
  { flags: ["--quiet"], expected: "selected/model" },
  { flags: ["--no-color"], expected: "REPO" },
])(
  "uses the shared parsed options, handler and formatter on an injected owner: $flags",
  async ({ flags, expected }) => {
    const owner = host("selected");
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const command = createBrainCommand({
      execute: (_command, execute) => withBrainCommandHost(owner, execute),
    });
    await command.parseAsync([...flags, "search", "test", "--limit", "7"], { from: "user" });
    expect(lines.join("")).toContain(expected);
    expect(owner.request).toHaveBeenCalledWith(
      "/__host/hf/search?query=test&limit=7",
      expect.any(AbortSignal),
    );
    expect(selectedBrainCommandHost()).toBeUndefined();
  },
);

it("keeps concurrent command targets separate and restores their parent after a nested command", async () => {
  const first = host("first");
  const second = host("second");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = withBrainCommandHost(first, async () => {
    await waiting;
    expect(selectedBrainCommandHost()).toBe(first);
    await withBrainCommandHost(second, async () => {
      expect(await readInstance()).toBe("second");
    });
    expect(selectedBrainCommandHost()).toBe(first);
  });
  await withBrainCommandHost(second, async () => {
    expect(await readInstance()).toBe("second");
    release();
  });
  await pending;
  expect(selectedBrainCommandHost()).toBeUndefined();
});

it("propagates an injected owner's failure without falling back to the local home or retaining its scope", async () => {
  const owner = host("failed");
  const primary = new Error("Synthetic selected-owner failure");
  vi.mocked(owner.request).mockRejectedValue(primary);
  await expect(
    withBrainCommandHost(owner, () =>
      withCommandHost((port, signal) => port.request("/__host/models", signal)),
    ),
  ).rejects.toBe(primary);
  expect(owner.request).toHaveBeenCalledOnce();
  expect(selectedBrainCommandHost()).toBeUndefined();
});
