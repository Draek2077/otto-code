import { z } from "zod";
import { defineRpc } from "../rpc.js";

export const GIT_FETCH_INTERVALS = [60, 180, 300, 600, 900, 1800, 3600] as const;
export const GitFetchPreferencesSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.union([
    z.literal(60),
    z.literal(180),
    z.literal(300),
    z.literal(600),
    z.literal(900),
    z.literal(1800),
    z.literal(3600),
  ]),
});
export type GitFetchPreferences = z.infer<typeof GitFetchPreferencesSchema>;
export const DEFAULT_GIT_FETCH_PREFERENCES: GitFetchPreferences = Object.freeze({
  enabled: true,
  intervalSeconds: 180,
});
export const GitFetchPatchSchema = GitFetchPreferencesSchema.partial().strict();
export const GitFetchSettingsSchema = z.object({
  revision: z.string().min(1).max(256),
  preferences: GitFetchPreferencesSchema,
});
export type GitFetchSettings = z.infer<typeof GitFetchSettingsSchema>;
const Host = z.object({ hostId: z.string().min(1).max(256) });
const Failure = z.object({
  ok: z.literal(false),
  error: z.object({
    kind: z.enum(["conflict", "unavailable", "failed"]),
    message: z.string().max(1000),
  }),
});
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), value }), Failure]);
}
export const readGitFetchPolicy = defineRpc({
  name: "workspace.git.fetch.settings.read.request",
  input: Host,
  output: result(GitFetchSettingsSchema),
});
export const saveGitFetchPolicy = defineRpc({
  name: "workspace.git.fetch.settings.save.request",
  input: Host.extend({ expectedRevision: z.string().min(1).max(256), patch: GitFetchPatchSchema }),
  output: result(GitFetchSettingsSchema),
});
export const fetchWorkspaceGit = defineRpc({
  name: "workspace.git.fetch.request",
  input: Host.extend({ workspaceId: z.string().min(1).max(256) }),
  output: result(z.object({ remote: z.literal("origin") })),
});
