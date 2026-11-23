import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { createRetainedKanbanToolPolicy, retainedKanbanToolEnabled } from "./tool-policy.js";
import { MutableDaemonConfigSchema } from "@getpaseo/protocol/messages";
const parent = fileURLToPath(
  new URL("../../../../../../.tmp/kanban-tool-policy/", import.meta.url),
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(parent, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Fixture escaped");
    await rm(root, { recursive: true, force: true });
  }
});
it.each([
  { config: {}, enabled: true },
  { config: { mcp: { enabled: false } }, enabled: false },
  { config: { mcp: { injectIntoAgents: false } }, enabled: false },
  { config: { providers: { local: { ottoToolGroupsV2: [] } } }, enabled: false },
  {
    config: { providers: { local: { ottoToolGroupsV2: ["agents"], ottoToolGroups: ["kanban"] } } },
    enabled: false,
  },
  { config: { providers: { local: { ottoToolGroups: ["kanban"] } } }, enabled: true },
  { config: { mcp: { toolGroupsV2: [] } }, enabled: false },
  { config: { mcp: { toolGroupsV2: ["kanban"] } }, enabled: true },
  { config: { mcp: { toolGroupsV2: ["agents"], toolGroups: ["kanban"] } }, enabled: false },
  { config: { mcp: { toolGroups: ["kanban"] } }, enabled: true },
  { config: { mcp: { toolGroups: ["agents"] } }, enabled: false },
  { config: { providers: { local: { ottoTools: { enabled: false } } } }, enabled: false },
  {
    config: { providers: { local: { ottoTools: { disabledTools: ["kanban_create_card"] } } } },
    enabled: false,
  },
])("preserves the retained host/provider ceiling: $config", ({ config, enabled }) => {
  expect(retainedKanbanToolEnabled(config, "kanban_create_card", "local")).toBe(enabled);
});
it("keeps per-provider name restrictions scoped to that provider and action", () => {
  const config = { providers: { local: { ottoTools: { disabledTools: ["kanban_create_card"] } } } };
  expect(retainedKanbanToolEnabled(config, "kanban_get_board", "local")).toBe(true);
  expect(retainedKanbanToolEnabled(config, "kanban_create_card", "other")).toBe(true);
});
it("honors legacy fields kept by the primary Paseo passthrough schema, not just split sidecar values", async () => {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "primary-"));
  roots.push(root);
  let config = MutableDaemonConfigSchema.parse({
    mcp: { injectIntoAgents: true, toolGroupsV2: [] },
  });
  const policy = createRetainedKanbanToolPolicy(root, () => config);
  expect(await policy("kanban_create_card", "local")).toBe(false);
  config = MutableDaemonConfigSchema.parse({
    mcp: { injectIntoAgents: true, toolGroupsV2: ["kanban"] },
  });
  expect(await policy("kanban_create_card", "local")).toBe(true);
  config = MutableDaemonConfigSchema.parse({
    mcp: { injectIntoAgents: true },
    providers: { local: { ottoToolGroupsV2: [] } },
  });
  expect(await policy("kanban_create_card", "local")).toBe(false);
});
it("reads changes without rewriting any retained keys or secrets, and refuses malformed policy", async () => {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "fixture-"));
  roots.push(root);
  const file = path.join(root, "otto-config.json");
  const policy = createRetainedKanbanToolPolicy(root);
  expect(await policy("kanban_create_card")).toBe(true);
  const bytes = JSON.stringify({
    mcp: { toolGroupsV2: [] },
    secret: "fixture-secret-never-returned",
    future: { retained: true },
  });
  await writeFile(file, bytes);
  expect(await policy("kanban_create_card")).toBe(false);
  expect(await readFile(file, "utf8")).toBe(bytes);
  await writeFile(file, JSON.stringify({ mcp: { toolGroupsV2: ["kanban"] } }));
  expect(await policy("kanban_create_card")).toBe(true);
  await writeFile(file, "{malformed");
  expect(await policy("kanban_create_card")).toBe(false);
  expect(await readFile(file, "utf8")).toBe("{malformed");
});
