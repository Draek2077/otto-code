import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { loadMcpTools } from "./mcp.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});

async function scratch() {
  const root = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "mcp-transports-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

it("runs stdio MCP in the session cwd/environment, preserves grants and cancels one request without losing the connection", async () => {
  const cwd = await scratch();
  const script = path.join(cwd, "server.mjs");
  await writeFile(
    script,
    `
    import { createInterface } from 'node:readline';
    import { writeFileSync } from 'node:fs';
    let canceled = 0;
    const reply = (id, result) => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
    const lines = createInterface({input:process.stdin});
    lines.on('line', line => {
      const p = JSON.parse(line);
      if(p.method === 'initialize') reply(p.id, {protocolVersion:'2024-11-05',capabilities:{tools:{}},instructions:'Preserve stdio instructions.'});
      else if(p.method === 'tools/list') reply(p.id,{tools:[{name:'inspect',inputSchema:{type:'object'}}]});
      else if(p.method === 'notifications/cancelled') canceled++;
      else if(p.method === 'tools/call' && !p.params.arguments.hang) reply(p.id,{content:[{type:'text',text:JSON.stringify({cwd:process.cwd(),value:process.env.MCP_FIXTURE_VALUE,canceled})}]});
    });
    lines.on('close', () => {writeFileSync('closed.txt','closed');process.exit(0);});
  `,
  );
  const loaded = await loadMcpTools(
    {
      local: {
        type: "stdio",
        command: process.execPath,
        args: [script],
        env: { MCP_FIXTURE_VALUE: "configured" },
      },
    },
    5000,
    AbortSignal.timeout(10000),
    { cwd, env: { MCP_FIXTURE_VALUE: "session" } },
  );
  cleanup.push(loaded.close);
  expect(loaded.instructions).toEqual(["[local]\nPreserve stdio instructions."]);
  expect(loaded.tools[0]!.preapproval).toEqual({ server: "local", tool: "inspect" });
  await expect(loaded.tools[0]!.execute({ hang: true }, AbortSignal.timeout(50))).rejects.toThrow();
  const result = JSON.parse(await loaded.tools[0]!.execute({}, AbortSignal.timeout(5000)));
  expect(result).toEqual({ cwd, value: "configured", canceled: 1 });
  await loaded.close();
  expect(await readFile(path.join(cwd, "closed.txt"), "utf8")).toBe("closed");
});

it("cleans up a stdio process when initialization is canceled", async () => {
  const cwd = await scratch();
  const script = path.join(cwd, "server.mjs");
  const pidFile = path.join(cwd, "pid.txt");
  await writeFile(
    script,
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); process.stdin.resume(); setInterval(()=>{},1000);`,
  );
  const controller = new AbortController();
  const loading = loadMcpTools(
    { local: { type: "stdio", command: process.execPath, args: [script] } },
    5000,
    controller.signal,
    { cwd, env: {} },
  );
  const rejection = expect(loading).rejects.toThrow();
  await expect.poll(async () => Number(await readFile(pidFile, "utf8"))).toBeGreaterThan(0);
  const pid = Number(await readFile(pidFile, "utf8"));
  controller.abort();
  await rejection;
  expect(() => process.kill(pid, 0)).toThrow();
});

it("rejects invalid stdio framing without logging the server's stdout", async () => {
  const cwd = await scratch();
  const script = path.join(cwd, "server.mjs");
  await writeFile(
    script,
    `process.stdout.write('sensitive-server-output\\n');process.stdin.resume();`,
  );
  await expect(
    loadMcpTools(
      { local: { type: "stdio", command: process.execPath, args: [script] } },
      1000,
      AbortSignal.timeout(3000),
      { cwd, env: {} },
    ),
  ).rejects.toThrow("Invalid MCP message");
});

it("negotiates legacy SSE, handles server pings, and closes its receive stream", async () => {
  let stream: import("node:http").ServerResponse | undefined;
  let pingResponse = false;
  let disconnected = false;
  const server = createServer(async (request, response) => {
    expect(request.headers.authorization).toBe("Bearer fixture");
    if (request.method === "GET") {
      stream = response;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("event: endpoint\r\ndata: /messages?session=one\r\n\r\n");
      request.on("close", () => {
        disconnected = true;
      });
      return;
    }
    expect(request.url).toBe("/messages?session=one");
    let body = "";
    for await (const chunk of request) body += chunk;
    const packet = JSON.parse(body);
    response.writeHead(202);
    response.end();
    if (packet.id === "ping-1") {
      pingResponse = true;
      return;
    }
    if (!packet.id) return;
    let result: unknown;
    if (packet.method === "initialize")
      result = {
        protocolVersion: "2024-11-05",
        instructions: "SSE instructions.",
        capabilities: { tools: {} },
      };
    else if (packet.method === "tools/list")
      result = {
        tools: [{ name: "echo", description: "Echo text.", inputSchema: { type: "object" } }],
      };
    else result = { content: [{ type: "text", text: "SSE result" }] };
    if (packet.method === "initialize")
      stream!.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: "ping-1", method: "ping" })}\n\n`,
      );
    stream!.write(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: packet.id, result })}\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing fixture address");
  const loaded = await loadMcpTools(
    {
      remote: {
        type: "sse",
        url: `http://127.0.0.1:${address.port}/events`,
        headers: { authorization: "Bearer fixture" },
      },
    },
    5000,
    AbortSignal.timeout(10000),
    { cwd: process.cwd(), env: {} },
  );
  cleanup.push(loaded.close);
  expect(loaded.instructions).toEqual(["[remote]\nSSE instructions."]);
  expect(await loaded.tools[0]!.execute({}, AbortSignal.timeout(5000))).toBe("SSE result");
  expect(pingResponse).toBe(true);
  await loaded.close();
  await expect.poll(() => disconnected).toBe(true);
});

it("refuses a cross-origin SSE message endpoint before forwarding configured credentials", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end("event: endpoint\ndata: https://other.invalid/messages\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing fixture address");
  await expect(
    loadMcpTools(
      {
        remote: {
          type: "sse",
          url: `http://127.0.0.1:${address.port}/events`,
          headers: { authorization: "Bearer fixture" },
        },
      },
      1000,
      AbortSignal.timeout(3000),
      { cwd: process.cwd(), env: {} },
    ),
  ).rejects.toThrow("same origin");
});
