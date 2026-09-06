import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "vitest";
import { killProcessTree } from "../e2e/support/helpers/spawn-node";

test.skipIf(process.platform !== "win32")(
  "fixture cleanup terminates a child and its worker",
  async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
    const { spawn } = require('node:child_process');
    const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(worker.pid);
    setInterval(() => {}, 1000);
  `,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      const [output] = await once(child.stdout, "data");
      const workerPid = Number(String(output).trim());
      expect(workerPid).toBeGreaterThan(0);
      await killProcessTree(child);
      for (const pid of [child.pid!, workerPid]) {
        await expect
          .poll(() => {
            try {
              process.kill(pid, 0);
              return true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
              throw error;
            }
          })
          .toBe(false);
      }
    } finally {
      await killProcessTree(child);
    }
  },
  20000,
);
