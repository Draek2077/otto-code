import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { OTTO_CONFIG_FILENAME } from "./config-migration.js";

export type RetainedToolPolicy = (toolName: string, provider?: string) => Promise<boolean>;
const groups = z.array(z.string());
const provider = z
  .object({
    ottoToolGroupsV2: groups.optional(),
    ottoToolGroups: groups.optional(),
    ottoTools: z
      .object({ enabled: z.boolean().optional(), disabledTools: z.array(z.string()).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
const retained = z
  .object({
    mcp: z
      .object({
        enabled: z.boolean().optional(),
        injectIntoAgents: z.boolean().optional(),
        toolGroupsV2: groups.optional(),
        toolGroups: groups.optional(),
      })
      .passthrough()
      .optional(),
    providers: z.record(z.string(), provider).optional(),
  })
  .passthrough();

function groupEnabled(group: string, v2?: string[], legacy?: string[]) {
  const selected = v2 ?? legacy;
  return selected === undefined || selected.includes(group);
}
function hostEnabled(group: string, mcp: z.infer<typeof retained>["mcp"], insideAgent: boolean) {
  if (mcp?.enabled === false) return false;
  if (insideAgent && mcp?.injectIntoAgents === false) return false;
  return groupEnabled(group, mcp?.toolGroupsV2, mcp?.toolGroups);
}
// COMPAT(otto09ToolCeilings): added v0.10.0; remove after 2027-04-25 once retained tool ceilings have an explicit reviewed migration.
export function retainedToolEnabled(
  group: string,
  value: unknown,
  name: string,
  providerId?: string,
): boolean {
  const config = retained.parse(value);
  if (!hostEnabled(group, config.mcp, Boolean(providerId))) return false;
  const entry = providerId ? config.providers?.[providerId] : undefined;
  if (!groupEnabled(group, entry?.ottoToolGroupsV2, entry?.ottoToolGroups)) return false;
  const policy = entry?.ottoTools;
  return policy?.enabled !== false && !policy?.disabledTools?.includes(name);
}
/** Read-only compatibility ceiling. Missing is new-host default; unreadable/malformed is never consent. */
export function createRetainedToolPolicy(
  group: string,
  home: string,
  readCurrent: () => unknown = () => ({}),
): RetainedToolPolicy {
  if (!path.isAbsolute(home)) throw new Error("Otto tool policy requires the owning host home");
  const file = path.join(home, OTTO_CONFIG_FILENAME);
  return async (name, providerId) => {
    try {
      if (!retainedToolEnabled(group, readCurrent(), name, providerId)) return false;
    } catch {
      return false;
    }
    try {
      if ((await stat(file)).size > 2097152) return false;
      return retainedToolEnabled(group, JSON.parse(await readFile(file, "utf8")), name, providerId);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
      return false;
    }
  };
}
