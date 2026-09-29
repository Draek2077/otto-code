import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { RemoteBrowserManager } from "./remote-browser-manager.js";

const TEMP_ROOT = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));

describe("host browser profile", () => {
  it("shares site data across workspaces and retains it after a manager restart", async (context) => {
    await mkdir(TEMP_ROOT, { recursive: true });
    const profileDirectory = await mkdtemp(resolve(TEMP_ROOT, "host-browser-profile-"));
    const target = resolve(profileDirectory);
    if (!target.startsWith(resolve(TEMP_ROOT) + sep)) throw new Error("Invalid test profile path");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Profile test</title>");
    });
    let manager = new RemoteBrowserManager(profileDirectory);
    try {
      // A host may not have Chromium installed. Exercise the real browser where available.
      if (!(await manager.hasRuntime())) {
        context.skip();
        return;
      }
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
      const url = `http://127.0.0.1:${address.port}/`;
      const firstId = randomUUID();
      await manager.execute("first-workspace", { kind: "open", browserId: firstId, url });
      const firstPage = manager["tabs"].get(firstId)?.page;
      expect(firstPage).toBeTruthy();
      await firstPage!.evaluate(() => {
        document.cookie = "session=remembered; max-age=3600";
        localStorage.setItem("login", "remembered");
      });
      await manager.execute("first-workspace", { kind: "suspend", browserId: firstId });

      const secondId = randomUUID();
      await manager.execute("second-workspace", { kind: "open", browserId: secondId, url });
      const secondPage = manager["tabs"].get(secondId)?.page;
      expect(
        await secondPage!.evaluate(() => [document.cookie, localStorage.getItem("login")]),
      ).toEqual(["session=remembered", "remembered"]);

      await manager.close();
      manager = new RemoteBrowserManager(profileDirectory);
      const restoredId = randomUUID();
      await manager.execute("second-workspace", { kind: "open", browserId: restoredId, url });
      const restoredPage = manager["tabs"].get(restoredId)?.page;
      expect(
        await restoredPage!.evaluate(() => [document.cookie, localStorage.getItem("login")]),
      ).toEqual(["session=remembered", "remembered"]);
    } finally {
      await manager.close();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(target, { recursive: true, force: true });
    }
  });
});
