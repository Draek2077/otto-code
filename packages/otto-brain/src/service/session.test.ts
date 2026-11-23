import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { BrainConfigSchema } from "../config/schema.js";
import { BrainServiceSession, type BrainServiceSessionPorts } from "./session.js";
import type { ServiceHandle } from "./serve.js";

function handle(): ServiceHandle {
  return {
    server: http.createServer(),
    host: "fixture",
    port: 0,
    secure: false,
    displayHost: "fixture",
    stop: vi.fn().mockResolvedValue(undefined),
  };
}
function fixture() {
  let config = BrainConfigSchema.parse({});
  const handles: ServiceHandle[] = [];
  const ports: BrainServiceSessionPorts = {
    readConfig: vi.fn(() => config),
    start: vi.fn(async () => {
      const next = handle();
      handles.push(next);
      return next;
    }),
  };
  return {
    ports,
    handles,
    session: new BrainServiceSession(ports),
    stage: () => {
      config = BrainConfigSchema.parse({ listen: { port: 4321 } });
      return config;
    },
  };
}
describe("explicit Brain owner service session", () => {
  it("is inert until explicit start, then applies newly saved configuration on a single restart", async () => {
    const f = fixture();
    expect(f.ports.readConfig).not.toHaveBeenCalled();
    await f.session.start();
    expect(f.ports.start).toHaveBeenLastCalledWith(expect.anything(), expect.any(Function), {
      kind: "initial",
    });
    const next = f.stage();
    await f.session.restart("actual/model");
    expect(f.handles[0].stop).toHaveBeenCalledTimes(1);
    expect(f.ports.start).toHaveBeenLastCalledWith(next, expect.any(Function), {
      kind: "restart",
      modelId: "actual/model",
    });
    await f.session.stop();
    expect(f.handles[1].stop).toHaveBeenCalledTimes(1);
  });
  it("does not stop the working listener when saved configuration is invalid", async () => {
    const f = fixture();
    await f.session.start();
    vi.mocked(f.ports.readConfig).mockImplementation(() => {
      throw new Error("invalid saved config");
    });
    await expect(f.session.restart(null)).rejects.toThrow("invalid saved config");
    expect(f.handles[0].stop).not.toHaveBeenCalled();
    await f.session.stop();
  });
  it("serializes restart and shutdown without relaunching after a late stop", async () => {
    const f = fixture();
    await f.session.start();
    let release!: () => void;
    vi.mocked(f.handles[0].stop).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const restart = f.session.restart(null);
    await expect(f.session.restart(null)).rejects.toThrow("already running");
    const stop = f.session.stop();
    release();
    await Promise.all([restart, stop]);
    expect(f.ports.start).toHaveBeenCalledTimes(1);
  });
  it("closes a listener whose initial startup completes after shutdown was requested", async () => {
    const f = fixture();
    let ready!: (host: ServiceHandle) => void;
    vi.mocked(f.ports.start).mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const starting = f.session.start();
    const stopped = f.session.stop();
    const late = handle();
    ready(late);
    await Promise.all([starting, stopped]);
    expect(late.stop).toHaveBeenCalledTimes(1);
    await expect(f.session.restart(null)).rejects.toThrow("not running");
  });
  it("does not retry a failed replacement or turn it into another start", async () => {
    const f = fixture();
    await f.session.start();
    vi.mocked(f.ports.start).mockRejectedValue(new Error("new listener failed"));
    await expect(f.session.restart(null)).rejects.toThrow("new listener failed");
    expect(f.ports.start).toHaveBeenCalledTimes(2);
    await f.session.stop();
  });
});
