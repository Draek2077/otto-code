import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Read-only host introspection in the credential-free CI fixture. Never opens a session. */
export async function inspectMuseSettings({ binary, workspace, root }) {
  if (process.env.CI !== "true" || process.platform !== "linux") throw new Error("CI Linux only.");
  const child = spawn(binary, ["serve"], { cwd: workspace, stdio: "pipe", detached: true });
  const lines = createInterface({ input: child.stdout });
  const responses = [];
  let bytes = 0;
  let stderr = "";
  let failure = null;
  const pending = new Set([2, 3, 4, 5]);
  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
  child.stdin.on("error", () => {});
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });
  const stopped = new Promise((resolve) => {
    child.once("error", (error) => {
      failure = error.code ?? "spawn";
    });
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const kill = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  };
  const timer = setTimeout(kill, 20000);
  lines.on("line", (line) => {
    bytes += Buffer.byteLength(line);
    if (bytes > 524288) {
      failure = "oversized";
      kill();
      return;
    }
    try {
      const frame = JSON.parse(line);
      responses.push(frame);
      if (frame.id === 1) {
        if (frame.error) {
          child.stdin.end();
          return;
        }
        send({ jsonrpc: "2.0", method: "initialized", params: {} });
        for (const [index, method] of [
          "settings/read",
          "settings/readSchema",
          "permissionProfile/list",
          "plugin/list",
        ].entries())
          send({ jsonrpc: "2.0", id: index + 2, method, params: {} });
      } else if (pending.delete(frame.id) && pending.size === 0) child.stdin.end();
    } catch {
      failure = "invalid JSON frame";
      kill();
    }
  });
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      clientInfo: { name: "otto_context_contract", version: "1" },
      capabilities: { experimentalApi: true },
    },
  });
  try {
    const exit = await stopped;
    await writeFile(
      path.join(root, "muse-settings-contract.json"),
      JSON.stringify({ ...exit, failure, stderr, responses }, null, 2),
    );
  } finally {
    clearTimeout(timer);
    lines.close();
    kill();
  }
}
