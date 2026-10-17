import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { connectToDaemon } from "../../utils/client.js";
import { addSendOptions, runSendCommand } from "./send.js";

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(),
  getDaemonHost: vi.fn(() => "unused-test-host"),
}));

const sendAgentMessage = vi.fn();
const waitForFinish = vi.fn();
const close = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  sendAgentMessage.mockResolvedValue({ queued: false, queuedMessageId: null });
  close.mockResolvedValue(undefined);
  vi.mocked(connectToDaemon).mockResolvedValue({
    sendAgentMessage,
    waitForFinish,
    close,
  } as unknown as Awaited<ReturnType<typeof connectToDaemon>>);
});

describe("agent send delivery", () => {
  it.each([
    {
      name: "omitted delivery preserves interrupt defaults",
      options: {},
      expected: { images: undefined },
    },
    {
      name: "explicit queue preserves queued delivery",
      options: { queue: true },
      expected: { images: undefined, delivery: "queue" },
    },
    {
      name: "explicit steer sends both SDK dispatch options",
      options: { steer: true },
      expected: {
        images: undefined,
        delivery: "interrupt",
        activeTurnBehavior: "steer",
      },
    },
  ])("$name", async ({ options, expected }) => {
    await runSendCommand("chat-id", "prompt", { ...options, wait: false }, new Command());

    expect(sendAgentMessage).toHaveBeenCalledExactlyOnceWith("chat-id", "prompt", expected);
    expect(sendAgentMessage.mock.calls[0]?.[2]).toStrictEqual(expected);
    expect(waitForFinish).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects conflicting delivery options before connecting", async () => {
    await expect(
      runSendCommand("chat-id", "prompt", { steer: true, queue: true }, new Command()),
    ).rejects.toMatchObject({
      code: "CONFLICTING_DELIVERY_OPTIONS",
      message: "Cannot combine --steer and --queue",
    });
    expect(connectToDaemon).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["--steer", "--queue"],
    ["--queue", "--steer"],
  ])("rejects conflicting parsed flags %s %s", (first, second) => {
    const command = addSendOptions(new Command())
      .exitOverride()
      .configureOutput({ writeErr: () => {} });

    expect(() => command.parse(["chat-id", "prompt", first, second], { from: "user" })).toThrow(
      "cannot be used with option",
    );
    expect(connectToDaemon).not.toHaveBeenCalled();
  });

  it("parses --steer with --no-wait and explains its limits in help", () => {
    const command = addSendOptions(new Command());
    command.parse(["chat-id", "prompt", "--steer", "--no-wait"], { from: "user" });

    expect(command.opts()).toMatchObject({ steer: true, wait: false });
    const help = command.helpInformation();
    expect(help).toContain("--steer");
    expect(help).toContain("default: interrupt a busy agent");
    expect(help).toContain("interrupt if unsupported");
    expect(help).toContain("compaction may queue");
  });

  it("reports a queued acknowledgment even when steering was requested", async () => {
    sendAgentMessage.mockResolvedValue({
      queued: true,
      queuedMessageId: "queued-message-id",
    });

    const result = await runSendCommand("chat-id", "prompt", { steer: true }, new Command());

    expect(result.data.message).toBe("Agent is busy; message queued to run as its next turn");
    expect(waitForFinish).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
