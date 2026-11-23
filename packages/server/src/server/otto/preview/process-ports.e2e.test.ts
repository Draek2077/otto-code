import { expect, test } from "vitest";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PreviewManager } from "./manager.js";
import { createPreviewProcessPorts, probePreviewPort } from "./process-ports.js";
import { previewCommandRevision, readPreviewLaunchConfig } from "./launch-config.js";

async function freePorts(): Promise<number[]> {
  const servers = [createServer(), createServer()];
  try {
    await Promise.all(
      servers.map(
        (server) => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
      ),
    );
    return servers.map((server) => {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing isolated fixture port.");
      return address.port;
    });
  } finally {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => {
              if (error) reject(error);
              else resolve();
            }),
          ),
      ),
    );
  }
}
/** CI-only native process proof. Never invokes an installed Otto, browser or model. */
test("production Preview adapter stops its owned process tree and retains final output", async () => {
  if (!process.env.CI)
    throw new Error("Run native Preview acceptance in CI; local process launches are held.");
  const scratch = path.resolve("../../.tmp");
  await mkdir(scratch, { recursive: true });
  const cwd = await mkdtemp(path.join(scratch, "otto-preview-runtime-"));
  const manager = new PreviewManager(createPreviewProcessPorts(new Set()));
  const [port, descendantPort] = await freePorts();
  const script = path.join(cwd, "preview-fixture.cjs");
  try {
    await writeFile(
      script,
      `const {createServer}=require('node:net');const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',${JSON.stringify(`require('node:net').createServer().listen(${descendantPort},'127.0.0.1'); console.log('child-ready');`)}],{stdio:['ignore','inherit','inherit']});
child.on('error',error=>{console.error(error.message);process.exit(1)});
createServer().listen(${port},'127.0.0.1',()=>console.log('parent-ready'));`,
    );
    const entry = {
      name: "native-proof",
      runtimeExecutable: process.execPath,
      runtimeArgs: [script],
      port,
    };
    await mkdir(path.join(cwd, ".claude"));
    await writeFile(
      path.join(cwd, ".claude", "launch.json"),
      JSON.stringify({ configurations: [entry] }),
    );
    const config = await readPreviewLaunchConfig(cwd);
    if (!config) throw new Error("Missing fixture config");
    const started = await manager.start({
      cwd,
      name: entry.name,
      approvedCommandRevision: previewCommandRevision(config.cwd, entry),
    });
    expect(started.server.managed).toBe(true);
    await expect
      .poll(async () => (await manager.list(cwd))[0].status, { timeout: 10000 })
      .toBe("ready");
    await expect.poll(() => probePreviewPort(descendantPort), { timeout: 10000 }).toBe(true);
    await expect
      .poll(async () =>
        (await manager.logs(cwd, started.server.id)).map((line) => line.text).join("\n"),
      )
      .toContain("child-ready");
    expect((await manager.stop(cwd, started.server.id)).status).toBe("stopped");
    await expect.poll(() => probePreviewPort(port), { timeout: 5000 }).toBe(false);
    await expect.poll(() => probePreviewPort(descendantPort), { timeout: 5000 }).toBe(false);
    expect((await manager.logs(cwd, started.server.id)).map((line) => line.text)).toContain(
      "parent-ready",
    );
  } finally {
    // close is idempotent and owns only this manager's fixture descendants.
    await manager.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
