import { z } from "zod";
import { defineRpc } from "../rpc.js";
import {
  BrowserAutomationCommandSchema,
  BrowserAutomationExecuteResponseSchema,
  BrowserAutomationBrowserIdSchema,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
const Scope = z.object({
  hostId: z.string().min(1).max(512),
  workspaceId: z.string().min(1).max(512),
});
export const HostBrowserTabSchema = z.object({
  browserId: BrowserAutomationBrowserIdSchema,
  workspaceId: z.string().min(1).max(512),
  url: z.string().max(8192),
  title: z.string().max(8192),
  isLoading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  viewportWidth: z.number().int().min(1).max(4096),
  viewportHeight: z.number().int().min(1).max(4096),
  state: z.enum(["ready", "suspended", "error"]),
  error: z.string().max(2000).nullable(),
});
export type HostBrowserTab = z.infer<typeof HostBrowserTabSchema>;
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: z.string().max(2000) }),
  ]);
}
const Ticket = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
export const readHostBrowserTabs = defineRpc({
  name: "browser.host.tabs.read.request",
  input: Scope,
  output: result(z.array(HostBrowserTabSchema).max(256)),
});
export const executeHostBrowser = defineRpc({
  name: "browser.host.command.execute.request",
  input: Scope.extend({ command: BrowserAutomationCommandSchema }),
  output: BrowserAutomationExecuteResponseSchema.shape.payload,
});
export const watchHostBrowser = defineRpc({
  name: "browser.host.viewer.watch.request",
  input: Scope.extend({ browserId: BrowserAutomationBrowserIdSchema, ticket: Ticket }),
  output: result(HostBrowserTabSchema),
});
export const ackHostBrowser = defineRpc({
  name: "browser.host.viewer.ack.request",
  input: Scope.extend({ ticket: Ticket, sequence: z.number().int().min(1).max(0xffffffff) }),
  output: result(z.boolean()),
});
export const detachHostBrowser = defineRpc({
  name: "browser.host.viewer.detach.request",
  input: Scope.extend({ ticket: Ticket }),
  output: result(z.literal(true)),
});
const Point = { x: z.number().min(0).max(4096), y: z.number().min(0).max(4096) };
export const HostBrowserInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pointer"),
    phase: z.enum(["down", "up", "move"]),
    ...Point,
    button: z.enum(["left", "right", "middle"]),
  }),
  z.object({
    kind: z.literal("wheel"),
    ...Point,
    deltaX: z.number().min(-100000).max(100000),
    deltaY: z.number().min(-100000).max(100000),
  }),
  z.object({
    kind: z.literal("key"),
    phase: z.enum(["down", "up"]),
    key: z.string().min(1).max(256),
  }),
  z.object({ kind: z.literal("text"), text: z.string().max(16384) }),
  z.object({
    kind: z.literal("touch"),
    phase: z.enum(["start", "move", "end", "cancel"]),
    points: z.array(z.object({ id: z.number().int().min(0).max(15), ...Point })).max(10),
  }),
]);
export type HostBrowserInput = z.infer<typeof HostBrowserInputSchema>;
export const inputHostBrowser = defineRpc({
  name: "browser.host.viewer.input.request",
  input: Scope.extend({ ticket: Ticket, event: HostBrowserInputSchema }),
  output: result(z.literal(true)),
});
