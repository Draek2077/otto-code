import { z } from "zod";
import { defineRpc } from "../rpc.js";

export const BrowserHistoryEntrySchema = z.object({
  url: z.string().max(8192),
  title: z.string().max(512),
  visitedAt: z.string().datetime(),
});
export type BrowserHistoryEntry = z.infer<typeof BrowserHistoryEntrySchema>;
export const BrowserHistoryScopeSchema = z.object({
  hostId: z.string().min(1).max(512),
  workspaceId: z.string().min(1).max(512),
});
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({
      ok: z.literal(false),
      error: z.object({ code: z.enum(["invalid", "unavailable"]), message: z.string() }),
    }),
  ]);
}
export const searchBrowserHistory = defineRpc({
  name: "browser.history.search.request",
  input: BrowserHistoryScopeSchema.extend({ query: z.string().max(8192) }),
  output: result(z.array(BrowserHistoryEntrySchema).max(10)),
});
export const recordBrowserHistory = defineRpc({
  name: "browser.history.record.request",
  input: BrowserHistoryScopeSchema.extend({
    url: z.string().max(8192),
    title: z.string().max(512),
  }),
  output: result(z.object({ recorded: z.literal(true) })),
});
export const clearBrowserHistory = defineRpc({
  name: "browser.history.clear.request",
  input: BrowserHistoryScopeSchema.extend({ userApprovedClear: z.literal(true) }),
  output: result(z.object({ cleared: z.literal(true) })),
});
