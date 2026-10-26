import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import {
  clearBrowserHistory,
  recordBrowserHistory,
  searchBrowserHistory,
} from "@getpaseo/plugin/otto/browser-history";
import { BrowserHistoryHost } from "./history-host.js";
const parent = fileURLToPath(
  new URL("../../../../../../.tmp/browser-history-host/", import.meta.url),
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw Error("Fixture escaped");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir(parent, { recursive: true });
  const home = await mkdtemp(path.join(parent, "case-"));
  roots.push(home);
  const workspaces = new Map([
    ["one", { projectId: "project", archivedAt: null }],
    ["peer", { projectId: "project", archivedAt: null }],
    ["other", { projectId: "other-project", archivedAt: null }],
    ["archived", { projectId: "project", archivedAt: "2026-01-01" }],
  ]);
  return new BrowserHistoryHost({
    home,
    hostId: "own-host",
    workspaces: { get: async (id) => workspaces.get(id) ?? null },
  });
}
const scope = { hostId: "own-host", workspaceId: "one" };
test("the daemon resolves shared-project history from the canonical workspace, ignoring client project claims", async () => {
  const host = await fixture();
  expect(
    await host.invoke(recordBrowserHistory.name, {
      ...scope,
      projectId: "forged",
      url: "https://example.test/one",
      title: "One",
    }),
  ).toEqual({ ok: true, value: { recorded: true } });
  expect(
    await host.invoke(searchBrowserHistory.name, { ...scope, workspaceId: "peer", query: "" }),
  ).toMatchObject({ ok: true, value: [{ url: "https://example.test/one" }] });
  expect(
    await host.invoke(searchBrowserHistory.name, { ...scope, workspaceId: "other", query: "" }),
  ).toEqual({ ok: true, value: [] });
});
test.each([
  { ...scope, hostId: "wrong-host" },
  { ...scope, workspaceId: "missing" },
  { ...scope, workspaceId: "archived" },
])("foreign, absent and archived workspace scopes cannot read or change history", async (input) => {
  const host = await fixture();
  expect(
    await host.invoke(recordBrowserHistory.name, {
      ...input,
      url: "https://example.test",
      title: "Denied",
    }),
  ).toMatchObject({ ok: false });
  expect(await host.invoke(searchBrowserHistory.name, { ...input, query: "" })).toMatchObject({
    ok: false,
  });
});
test("clear requires explicit approval and unknown RPC methods are not claimed", async () => {
  const host = await fixture();
  expect(
    await host.invoke(clearBrowserHistory.name, { ...scope, userApprovedClear: false }),
  ).toMatchObject({ ok: false, error: { code: "invalid" } });
  expect(
    host.invoke("knowledge.clear.request", { ...scope, userApprovedClear: true }),
  ).toBeUndefined();
});
