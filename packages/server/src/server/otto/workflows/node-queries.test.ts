import { beforeEach, afterEach, describe, test, expect } from "vitest";
import path from "node:path";
import { writeFile, symlink } from "node:fs/promises";
import { executeWorkflowQuery, workflowQueryProblems } from "./node-queries.js";
import { workflowHostFixture } from "./test-utils/host-fixture.js";
import type { GraphQueryTool } from "@getpaseo/plugin/otto/workflows";
const signal = () => new AbortController().signal;
describe("node-local declared queries", () => {
  let f: Awaited<ReturnType<typeof workflowHostFixture>>;
  beforeEach(async () => {
    f = await workflowHostFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });
  test("argv substitution remains one argument; execution is injected here and never treated as read-only", async () => {
    const query: GraphQueryTool = {
      name: "inspect",
      description: "Inspect",
      kind: "command",
      command: ["node", "{{value}}"],
      parameters: [{ key: "value", type: "string" }],
    };
    let observed: string[] = [];
    expect(
      await executeWorkflowQuery(query, { value: "a; $(delete) && b" }, f.repo, signal(), {
        command: async (argv) => {
          observed = argv;
          return "Done";
        },
      }),
    ).toBe("Done");
    expect(observed).toEqual(["node", "a; $(delete) && b"]);
    const launch = structuredClone(f.graph);
    if (launch.kind !== "graph") throw new Error("Fixture");
    launch.graph.nodes[1].queryTools = [query];
    expect(workflowQueryProblems(launch).join(" ")).toContain("explicit approval");
    launch.allowQueryEffects = true;
    launch.graph.nodes[1].access = "read";
    expect(workflowQueryProblems(launch).join(" ")).toContain("not a read-only boundary");
  });
  test("file query reads bounded workspace bytes and refuses parent traversal", async () => {
    await writeFile(path.join(f.repo, "readme.txt"), "Actual bytes");
    await writeFile(path.join(f.other, "outside.txt"), "Outside");
    expect(
      await executeWorkflowQuery(
        { name: "read", description: "Read", kind: "file-read", path: "readme.txt" },
        {},
        f.repo,
        signal(),
      ),
    ).toBe("Actual bytes");
    await expect(
      executeWorkflowQuery(
        { name: "read", description: "Read", kind: "file-read", path: "../other/outside.txt" },
        {},
        f.repo,
        signal(),
      ),
    ).rejects.toThrow("outside");
  });
  test("file query rejects a linked directory escape", async () => {
    await writeFile(path.join(f.other, "outside.txt"), "Outside");
    await symlink(f.other, path.join(f.repo, "link"), "junction");
    await expect(
      executeWorkflowQuery(
        { name: "read", description: "Read", kind: "file-read", path: "link/outside.txt" },
        {},
        f.repo,
        signal(),
      ),
    ).rejects.toThrow("outside");
  });
  test("HTTP uses the literal approved origin, encoded data, GET, no credentials/headers and no redirects", async () => {
    let url = "";
    let options: RequestInit | undefined;
    const transport: typeof fetch = async (input, init) => {
      url = String(input);
      options = init;
      return new Response("Actual result");
    };
    expect(
      await executeWorkflowQuery(
        {
          name: "lookup",
          description: "Lookup",
          kind: "http-get",
          url: "https://example.invalid/?q={{value}}",
          parameters: [{ key: "value", type: "string" }],
        },
        { value: "&secret=x" },
        f.repo,
        signal(),
        { fetch: transport },
      ),
    ).toBe("Actual result");
    expect(url).toBe("https://example.invalid/?q=%26secret%3Dx");
    expect(options).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    expect(options?.headers).toBeUndefined();
  });
  test("HTTP caps bodies and cancels the stream instead of buffering unbounded output", async () => {
    await expect(
      executeWorkflowQuery(
        { name: "lookup", description: "Lookup", kind: "http-get", url: "https://example.invalid" },
        {},
        f.repo,
        signal(),
        { fetch: async () => new Response("x".repeat(64001)) },
      ),
    ).rejects.toThrow("64 KB");
  });
  test("unsupported kinds, duplicate names and dynamic/credentialed origins fail preflight", () => {
    const launch = structuredClone(f.graph);
    if (launch.kind !== "graph") throw new Error("Fixture");
    launch.allowQueryEffects = true;
    launch.graph.nodes[1].queryTools = [
      { name: "same", description: "", kind: "http-get", url: "https://{{host}}/" },
      { name: "same", description: "", kind: "future" },
      {
        name: "credentials",
        description: "",
        kind: "http-get",
        url: "https://u:p@example.invalid",
      },
    ];
    const problems = workflowQueryProblems(launch).join(" ");
    expect(problems).toContain("duplicate");
    expect(problems).toContain("Unknown query kind");
    expect(problems).toContain("literal HTTP(S)");
  });
  test("aborted authority cannot invoke a command/network port", async () => {
    const abort = new AbortController();
    abort.abort(new Error("Canceled"));
    let called = false;
    await expect(
      executeWorkflowQuery(
        { name: "read", description: "", kind: "command", command: ["anything"] },
        {},
        f.repo,
        abort.signal,
        {
          command: async () => {
            called = true;
            return "";
          },
        },
      ),
    ).rejects.toThrow("Canceled");
    expect(called).toBe(false);
  });
});
