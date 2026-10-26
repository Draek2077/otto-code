import { expect, test } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BrowserToolsBroker } from "../../../browser-tools/broker.js";
import { BrowserAdmissions } from "../admission.js";
import { createNativeHostBrowser } from "./native.js";
import { OTTO_BROWSER_HOST_ID } from "./service.js";
import { SessionDelivery } from "../../../session/owned-subscriptions/index.js";
import { hostBrowserRequestSource } from "./source.js";
import {
  decodeBrowserPaintFrame,
  type BrowserPaintFrame,
} from "@getpaseo/protocol/otto/browser-frames";
import {
  watchHostBrowser,
  ackHostBrowser,
  inputHostBrowser,
  type HostBrowserInput,
} from "@getpaseo/plugin/otto/host-browser";
import type { BrowserAutomationCommand } from "@getpaseo/protocol/browser-automation/rpc-schemas";

/** Production Chromium, CDP, shared refs and source-bound JPEGs. Never invoked by local validation. */
test("native Host Browser executes against the streamed page and preserves its own profile", async () => {
  if (!process.env.CI)
    throw new Error("Run native Host Browser acceptance in CI; local browser launches are held.");
  const scratch = fileURLToPath(new URL("../../../../../../../.tmp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const home = await mkdtemp(path.join(scratch, "host-browser-native-"));
  const artifacts =
    process.env.OTTO_HOST_BROWSER_ARTIFACT_DIR ??
    path.join(scratch, "host-browser-native-artifacts");
  await mkdir(artifacts, { recursive: true });
  const trace: Array<{ command: string; result: unknown }> = [];
  const html = `<!doctype html><title>Host Browser native proof</title>
<style>body{font:20px sans-serif;background:#ddeeff;padding:30px} input,button,select{font:inherit} #result{padding:30px}</style>
<h1>Host Browser native proof</h1><input aria-label="Name"><button onclick="document.querySelector('#result').textContent='Hello '+document.querySelector('input').value">Apply</button>
<select aria-label="Choice"><option value="one">One</option><option value="two">Two</option></select>
<input type="file" aria-label="Upload"><p id="result">Ready</p><a href="/second">Second page</a>
<script>console.log('HOST_BROWSER_CONSOLE_PROOF');fetch('/probe')</script>`;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/probe" ? "application/json" : "text/html");
    response.end(request.url === "/probe" ? '{"proof":true}' : html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No host browser fixture address.");
  const url = `http://127.0.0.1:${address.port}`;
  const admission = new BrowserAdmissions({
    previewTarget: async () => null,
    lookup: async () => [{ address: "127.0.0.1" }],
  });
  const broker = new BrowserToolsBroker({
    ottoNewTabHostId: () => OTTO_BROWSER_HOST_ID,
    ottoAdmission: (input, next) => admission.execute(input, next),
  });
  const service = createNativeHostBrowser({
    home,
    hostId: "native-proof",
    broker,
    reportError: (error) =>
      trace.push({
        command: "runtime-error",
        result:
          error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      }),
    workspaces: {
      get: async (id) => (id === "workspace" ? { cwd: home, archivedAt: null } : null),
    },
  });
  service.register();
  const scope = { hostId: "native-proof", workspaceId: "workspace" },
    ticket = randomUUID(),
    socket = {},
    peer = {};
  const paints: BrowserPaintFrame[] = [],
    recipients: object[] = [],
    ackErrors: unknown[] = [];
  const delivery = new SessionDelivery(
    () => {},
    (source, bytes) => {
      expect(delivery.permitsBinary(source, bytes)).toBe(true);
      recipients.push(source);
      const paint = decodeBrowserPaintFrame(bytes);
      if (!paint) return;
      paints.push(paint);
      void owned(ackHostBrowser.name, { ...scope, ticket, sequence: paint.sequence }).catch(
        (error: unknown) => ackErrors.push(error),
      );
    },
  );
  delivery.attach(socket, true);
  delivery.attach(peer, true);
  async function owned(method: string, input: unknown) {
    let output: unknown;
    await delivery.request(socket, { type: "ping", requestId: randomUUID() }, async () => {
      output = await service.invoke(method, input, hostBrowserRequestSource(delivery));
    });
    return output;
  }
  async function execute(command: BrowserAutomationCommand) {
    const result = await broker.execute({
      workspaceId: scope.workspaceId,
      cwd: home,
      agentId: "fixture-agent",
      command,
    });
    trace.push({ command: command.command, result });
    if (!result.ok) throw new Error(`${command.command}: ${result.error.message}`);
    return result;
  }
  async function evaluate(browserId: string, source: string) {
    const response = await execute({ command: "evaluate", args: { browserId, function: source } });
    if (response.result.command !== "evaluate") throw new Error("Expected evaluate result.");
    return JSON.parse(response.result.resultJson);
  }
  async function ref(browserId: string, name: string) {
    const snapshot = await execute({ command: "snapshot", args: { browserId } });
    if (snapshot.result.command !== "snapshot") throw new Error("Expected shared ARIA snapshot.");
    const line = snapshot.result.snapshot
      .split("\n")
      .find((row) => row.includes(JSON.stringify(name)));
    const found = line?.match(/@e\d+/)?.[0];
    if (!found) throw new Error(`Missing ref for ${name}: ${snapshot.result.snapshot}`);
    return found;
  }
  const failures: unknown[] = [];
  try {
    const created = await execute({ command: "new_tab", args: { url } });
    if (created.result.command !== "new_tab") throw new Error("Expected a host-owned tab.");
    const browserId = created.result.browserId;
    await execute({
      command: "fill",
      args: { browserId, ref: await ref(browserId, "Name"), value: "Otto" },
    });
    await execute({
      command: "click",
      args: {
        browserId,
        ref: await ref(browserId, "Apply"),
        button: "left",
        doubleClick: false,
        modifiers: [],
      },
    });
    await execute({ command: "wait", args: { browserId, text: "Hello Otto", timeoutMs: 5000 } });
    await execute({
      command: "select",
      args: { browserId, ref: await ref(browserId, "Choice"), value: "two" },
    });
    expect(await evaluate(browserId, "() => document.querySelector('select').value")).toBe("two");
    const upload = path.join(home, "upload.txt");
    await writeFile(upload, "Host-owned upload proof");
    await execute({
      command: "upload",
      args: { browserId, ref: await ref(browserId, "Upload"), filePaths: [upload] },
    });
    expect(
      await evaluate(browserId, "() => document.querySelector('input[type=file]').files[0].name"),
    ).toBe("upload.txt");
    const watching = watchHostBrowser.output.parse(
      await owned(watchHostBrowser.name, { ...scope, browserId, ticket }),
    );
    expect(watching.ok).toBe(true);
    await expect.poll(() => paints.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await writeFile(path.join(artifacts, "first-paint.jpg"), paints[0].jpeg);
    expect(paints[0]).toMatchObject({ ticket, viewportWidth: 390, viewportHeight: 844 });
    await execute({
      command: "click",
      args: {
        browserId,
        ref: await ref(browserId, "Name"),
        button: "left",
        doubleClick: false,
        modifiers: [],
      },
    });
    const input: HostBrowserInput = { kind: "text", text: " viewer" };
    expect(
      inputHostBrowser.output.parse(
        await owned(inputHostBrowser.name, { ...scope, ticket, event: input }),
      ).ok,
    ).toBe(true);
    expect(await evaluate(browserId, "() => document.querySelector('input').value")).toContain(
      "viewer",
    );
    await execute({ command: "resize", args: { browserId, width: 1280, height: 720 } });
    await expect.poll(() => paints.at(-1)?.viewportWidth, { timeout: 10_000 }).toBe(1280);
    const screenshot = await execute({
      command: "screenshot",
      args: { browserId, fullPage: false },
    });
    if (screenshot.result.command !== "screenshot")
      throw new Error("Expected rendered screenshot.");
    expect(screenshot.result.width * screenshot.result.height).toBeLessThanOrEqual(1_150_000);
    await writeFile(
      path.join(artifacts, "rendered-page.png"),
      Buffer.from(screenshot.result.dataBase64, "base64"),
    );
    const dialog = await execute({
      command: "evaluate",
      args: { browserId, function: "() => { alert('HOST_DIALOG_PROOF'); return true; }" },
    });
    expect(dialog.dialogs).toContainEqual(
      expect.objectContaining({ type: "alert", action: "accepted" }),
    );
    const logs = await execute({ command: "logs", args: { browserId, maxEntries: 200 } });
    if (logs.result.command !== "logs") throw new Error("Expected bounded logs.");
    expect(
      logs.result.console.some((entry) => entry.message.includes("HOST_BROWSER_CONSOLE_PROOF")),
    ).toBe(true);
    await evaluate(
      browserId,
      "() => { document.cookie='ottoHostFixture=yes;path=/'; return true; }",
    );
    await delivery.detach(socket);
    const count = paints.length;
    await evaluate(browserId, "() => { document.body.style.background='pink'; return true; }");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(paints).toHaveLength(count);
    expect(recipients.every((recipient) => recipient === socket)).toBe(true);
    expect(ackErrors).toEqual([]);
    await execute({ command: "close_tab", args: { browserId } });
    const reopened = await execute({ command: "new_tab", args: { url } });
    if (reopened.result.command !== "new_tab") throw new Error("Expected reopened host tab.");
    expect(reopened.result.browserId).not.toBe(browserId);
    expect(await evaluate(reopened.result.browserId, "() => document.cookie")).toContain(
      "ottoHostFixture=yes",
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    await writeFile(path.join(artifacts, "native-trace.json"), JSON.stringify(trace, null, 2));
  } catch (error) {
    failures.push(error);
  }
  {
    const cleanup = await Promise.allSettled([service.close(), delivery.close()]);
    server.closeAllConnections();
    try {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    } catch (error) {
      failures.push(error);
    }
    const failed = cleanup.filter((result) => result.status === "rejected");
    failures.push(...failed.map((result) => result.reason));
    if (!failed.length) {
      try {
        const relative = path.relative(await realpath(scratch), await realpath(home));
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
          throw new Error("Native browser fixture escaped its scratch root.");
        await rm(home, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Native Host Browser proof failed.", { cause: failures[0] });
}, 120_000);
