import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { pino } from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { DevServerManager } from "./dev-server-manager.js";

const managers: DevServerManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
});

function createManager(): DevServerManager {
  const manager = new DevServerManager({
    logger: pino({ enabled: false }),
    readinessTimeoutMs: 20_000,
    pollIntervalMs: 50,
  });
  managers.push(manager);
  return manager;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Real dev-server stand-in: a node HTTP server that logs a startup line, an
 * error-looking line (for the level filter), and serves "ok".
 */
const SERVER_SCRIPT = `
const http = require("http");
const port = Number(process.argv[2]);
console.log("booting sample server");
console.log("error: sample failure line");
const server = http.createServer((req, res) => res.end("ok"));
server.listen(port, "127.0.0.1", () => console.log("listening on " + port));
`;

async function createProject(port: number): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "otto-preview-"));
  await fs.writeFile(path.join(cwd, "server.js"), SERVER_SCRIPT, "utf8");
  await fs.mkdir(path.join(cwd, ".claude"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".claude", "launch.json"),
    JSON.stringify({
      version: "0.0.1",
      configurations: [
        {
          name: "sample",
          runtimeExecutable: "node",
          runtimeArgs: ["server.js", String(port)],
          port,
        },
      ],
    }),
    "utf8",
  );
  return cwd;
}

async function waitForPortClosed(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port, timeout: 500 });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (!open) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe("DevServerManager", () => {
  test("starts a configured server, waits for readiness, and serves traffic", async () => {
    const port = await findFreePort();
    const cwd = await createProject(port);
    const manager = createManager();

    const started = await manager.start({ cwd, name: "sample" });

    expect(started.reused).toBe(false);
    expect(started.server.status).toBe("running");
    expect(started.server.url).toBe(`http://127.0.0.1:${port}/`);
    const response = await fetch(started.server.url);
    await expect(response.text()).resolves.toBe("ok");

    expect(manager.list(cwd)).toHaveLength(1);
  });

  test("reuses an already-running server instead of spawning a duplicate", async () => {
    const port = await findFreePort();
    const cwd = await createProject(port);
    const manager = createManager();

    const first = await manager.start({ cwd, name: "sample" });
    const second = await manager.start({ cwd, name: "sample" });

    expect(second.reused).toBe(true);
    expect(second.server.serverId).toBe(first.server.serverId);
    expect(manager.list(cwd)).toHaveLength(1);
  });

  test("captures logs with lines/level/search filters", async () => {
    const port = await findFreePort();
    const cwd = await createProject(port);
    const manager = createManager();
    const { server } = await manager.start({ cwd, name: "sample" });

    // stdio capture is asynchronous; the listen line proves flushing caught up.
    const deadline = Date.now() + 5_000;
    while (
      !manager.logs(server.serverId).some((line) => line.includes("listening")) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const all = manager.logs(server.serverId);
    expect(all.some((line) => line.includes("booting sample server"))).toBe(true);
    expect(all.some((line) => line.includes(`listening on ${port}`))).toBe(true);

    const errors = manager.logs(server.serverId, { level: "error" });
    expect(errors).toEqual(["error: sample failure line"]);

    const searched = manager.logs(server.serverId, { search: "booting" });
    expect(searched).toEqual(["booting sample server"]);

    expect(manager.logs(server.serverId, { lines: 1 })).toHaveLength(1);
  });

  test("stop kills the process tree and frees the port", async () => {
    const port = await findFreePort();
    const cwd = await createProject(port);
    const manager = createManager();
    const { server } = await manager.start({ cwd, name: "sample" });

    const stopped = await manager.stop(server.serverId);

    expect(stopped.status).toBe("exited");
    await expect(waitForPortClosed(port, 10_000)).resolves.toBe(true);
    expect(manager.list(cwd)).toHaveLength(0);
  });

  test("reports actionable errors for missing config and unknown names", async () => {
    const manager = createManager();
    const emptyCwd = await fs.mkdtemp(path.join(os.tmpdir(), "otto-preview-empty-"));
    await expect(manager.start({ cwd: emptyCwd, name: "sample" })).rejects.toThrow(
      /No .*launch\.json found/,
    );

    const port = await findFreePort();
    const cwd = await createProject(port);
    await expect(manager.start({ cwd, name: "nope" })).rejects.toThrow(
      /No configuration named "nope".*Available: sample/,
    );
  });

  test("fails fast when the configured command exits before binding the port", async () => {
    const port = await findFreePort();
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "otto-preview-crash-"));
    await fs.writeFile(path.join(cwd, "crash.js"), "console.log('boom'); process.exit(7);", "utf8");
    await fs.mkdir(path.join(cwd, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(cwd, ".claude", "launch.json"),
      JSON.stringify({
        version: "0.0.1",
        configurations: [
          { name: "crash", runtimeExecutable: "node", runtimeArgs: ["crash.js"], port },
        ],
      }),
      "utf8",
    );
    const manager = createManager();

    await expect(manager.start({ cwd, name: "crash" })).rejects.toThrow(
      /exited with code 7 before becoming ready[\s\S]*boom/,
    );
    expect(manager.list(cwd)).toHaveLength(0);
  });
});
