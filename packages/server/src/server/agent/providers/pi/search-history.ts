import { readFile } from "node:fs/promises";
import { z } from "zod";
import { collectImportedHistory } from "../../provider-session-import.js";
import { getUserMessageText, streamPiHistory } from "./history-mapper.js";
import type { PiAgentMessage } from "./rpc-types.js";

const entrySchema = z.object({
  id: z.string(),
  parentId: z.string().nullable().optional(),
  message: z.object({ role: z.string() }).passthrough().optional(),
});

/** Read the active native branch without starting Pi's RPC process or any tools. */
export async function readPiSearchHistory(sessionFile: string, provider: string) {
  const content = await readFile(sessionFile, "utf8");
  const entries = content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => entrySchema.parse(JSON.parse(line)));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const chain: typeof entries = [];
  const seen = new Set<string>();
  let current = entries.at(-1);
  while (current) {
    if (seen.has(current.id)) throw new Error("Pi history contains a cyclic branch");
    seen.add(current.id);
    chain.push(current);
    if (current.parentId && !byId.has(current.parentId))
      throw new Error("Pi history contains a missing branch parent");
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  const messages: PiAgentMessage[] = [];
  const userEntries: { id: string; text: string }[] = [];
  for (const entry of chain.toReversed()) {
    if (
      !entry.message ||
      !["user", "assistant", "toolResult", "custom", "bashExecution"].includes(entry.message.role)
    )
      continue;
    const message = entry.message as unknown as PiAgentMessage;
    messages.push(message);
    if (message.role === "user")
      userEntries.push({ id: entry.id, text: getUserMessageText(message.content) });
  }
  return (await collectImportedHistory(streamPiHistory(provider, messages, userEntries))).timeline;
}
