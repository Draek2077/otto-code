import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { InstructionSource } from "./instructions.js";
import { OpenAiSession } from "./session.js";
import { providerSettings } from "../shared/settings.js";
import type { ChatMessage } from "./completions.js";

async function fixture() {
  const temporary = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(path.join(temporary, "provider-instructions-"));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const cwd = path.join(project, "src");
  const child = path.join(cwd, "nested");
  for (const directory of [home, child]) await mkdir(directory, { recursive: true });
  await writeFile(path.join(project, ".git"), "gitdir: fixture");
  return {
    root,
    home,
    project,
    cwd,
    child,
    source: () => InstructionSource.create({ cwd, home }),
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test("loads global and ancestor rules, Windows link files and local imports without loading links or code", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.home, "AGENTS.md"), "HOST_RULE");
    await writeFile(path.join(f.project, "AGENTS.md"), "CLAUDE.md\n");
    await writeFile(
      path.join(f.project, "CLAUDE.md"),
      "ROOT_RULE\n@rules.md\n[Optional](optional.md)\n`@missing.md`\n```md\n@missing-too.md\n```",
    );
    await writeFile(path.join(f.project, "rules.md"), "IMPORTED_RULE\n@CLAUDE.md");
    await writeFile(path.join(f.project, "optional.md"), "MUST_NOT_AUTOLOAD");
    await writeFile(path.join(f.cwd, "CLAUDE.md"), "CHILD_FALLBACK");
    await writeFile(path.join(f.child, "AGENTS.md"), "DEEP_RULE");
    const source = await f.source();
    const initial = await source.forRequest();
    for (const rule of ["HOST_RULE", "ROOT_RULE", "IMPORTED_RULE", "CHILD_FALLBACK"])
      expect(initial).toContain(rule);
    expect(initial).not.toContain("MUST_NOT_AUTOLOAD");
    expect(initial).not.toContain("DEEP_RULE");
    expect(initial.match(/ROOT_RULE/gu)).toHaveLength(1);
    await source.beforeFile({ file: path.join(f.child, "file.txt"), write: false });
    expect(await source.forRequest()).toContain("DEEP_RULE");
    source.beginTurn();
    expect(await source.forRequest()).not.toContain("DEEP_RULE");
    // An intentionally empty AGENTS file overrides the CLAUDE fallback.
    await writeFile(path.join(f.cwd, "AGENTS.md"), "");
    expect(await source.forRequest()).not.toContain("CHILD_FALLBACK");
  } finally {
    await f.close();
  }
});

test("instruction boundaries and budgets fail visibly without rewriting the source", async () => {
  const f = await fixture();
  try {
    const file = path.join(f.project, "AGENTS.md");
    await writeFile(path.join(f.root, "outside.md"), "OUTSIDE");
    await writeFile(file, "@../outside.md");
    await expect((await f.source()).forRequest()).rejects.toThrow("outside the workspace");
    expect(await readFile(file, "utf8")).toBe("@../outside.md");
    await writeFile(file, "x".repeat(128 * 1024 + 1));
    await expect((await f.source()).forRequest()).rejects.toThrow("128 KiB");
    for (let index = 0; index < 10; index++)
      await writeFile(path.join(f.project, `${index}.md`), `@${index + 1}.md`);
    await writeFile(file, "@0.md");
    await expect((await f.source()).forRequest()).rejects.toThrow("8 levels");
  } finally {
    await f.close();
  }
});

test("native writes wait for scoped and changed rules to reach the model, without persisting instruction copies", async () => {
  const f = await fixture();
  const events: ProviderEvent[] = [];
  const requests: ChatMessage[][] = [];
  const observed: string[] = [];
  const file = path.join(f.child, "proof.txt");
  await writeFile(path.join(f.project, "AGENTS.md"), "ROOT_RULE");
  const scoped = path.join(f.child, "AGENTS.md");
  await writeFile(scoped, "DEEP_RULE");
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push(input.messages);
    const round = requests.length;
    if (round < 4) {
      observed.push(await readFile(file, "utf8"));
      if (round === 2) await writeFile(scoped, "DEEP_RULE_CHANGED");
    }
    const delta =
      round < 4
        ? {
            tool_calls: [
              {
                index: 0,
                id: `write-${round}`,
                type: "function",
                function: {
                  name: "otto_write_file",
                  arguments: JSON.stringify({ path: "nested/proof.txt", content: "written" }),
                },
              },
            ],
          }
        : { content: "Done." };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: round < 4 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await writeFile(file, "unchanged");
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing fixture endpoint");
  const session = new OpenAiSession({
    id: "instructions",
    config: {
      cwd: f.cwd,
      env: {},
      model: "fixture",
      mcpServers: {},
      settings: { auto_compact: "off" },
      persist: true,
      mode: "acceptEdits",
    },
    settings: providerSettings.schema.parse({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "fixture",
    }),
    instructions: await f.source(),
    emit: (event) => events.push(event),
  });
  try {
    session.start({
      clientMessageId: "write",
      delivery: "auto",
      input: { type: "message", content: [{ type: "text", text: "Write the file" }] },
    });
    await expect.poll(() => session.running).toBe(false);
    expect(events.findLast((event) => event.type === "session.turn")).toMatchObject({
      state: "completed",
    });
    expect(requests).toHaveLength(4);
    expect(session.inspectContext()).toMatchObject({
      phase: "completed",
      system: requests[3]![0]!.content,
      instructionText: expect.stringContaining("DEEP_RULE_CHANGED"),
    });
    expect(
      session.inspectContext()?.blocks.some((block) => block.text === "DEEP_RULE_CHANGED"),
    ).toBe(true);
    expect(observed).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(requests[0]![0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("ROOT_RULE"),
    });
    expect(requests[0]![0]!.content).not.toContain("DEEP_RULE");
    expect(requests[1]![0]!.content).toContain("DEEP_RULE");
    expect(requests[2]![0]!.content).toContain("DEEP_RULE_CHANGED");
    expect(await readFile(file, "utf8")).toBe("written");
    expect(JSON.stringify(session.messages)).not.toContain("ROOT_RULE");
    expect(JSON.stringify(session.messages)).not.toContain("DEEP_RULE");
  } finally {
    await session.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
  }
});

test("inspection shares request resolution without admitting native writes", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.project, "AGENTS.md"), "RULE\n@extra.md");
    await writeFile(path.join(f.project, "extra.md"), "EXTRA");
    const source = await f.source();
    const inspection = await source.inspect();
    expect(inspection.text).toBe(await source.forRequest());
    expect(inspection.blocks.map((block) => block.text)).toContain("EXTRA");
    source.beginTurn();
    await source.inspect();
    await expect(
      source.beforeFile({ file: path.join(f.cwd, "proof.txt"), write: true }),
    ).rejects.toThrow("Review the current instructions");
  } finally {
    await f.close();
  }
});
