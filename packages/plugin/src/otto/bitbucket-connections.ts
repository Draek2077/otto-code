import { z } from "zod";
import { defineRpc } from "../rpc.js";

const Id = z.string().min(1).max(256);
export const BitbucketConnectionSummarySchema = z
  .object({
    id: Id,
    label: z.string().max(200),
    account: z.string().max(320),
    email: z.string().max(320).nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const BitbucketConnectionsSchema = z
  .object({
    revision: Id,
    projectId: Id.nullable(),
    selectedId: Id.nullable(),
    hostDefaultId: Id.nullable(),
    projectOverrideId: Id.nullable(),
    connections: z.array(BitbucketConnectionSummarySchema).max(100),
  })
  .strict();
export const BitbucketConnectionActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("select"), connectionId: Id.nullable() }).strict(),
  z.object({ kind: z.literal("remove"), id: Id }).strict(),
  z
    .object({
      kind: z.literal("save"),
      id: Id.optional(),
      label: z.string().trim().min(1).max(200),
      email: z.string().trim().email().max(320),
      credential: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("keep") }).strict(),
        z.object({ kind: z.literal("replace"), value: z.string().min(1).max(131072) }).strict(),
      ]),
      select: z.boolean(),
    })
    .strict(),
]);
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({
      ok: z.literal(false),
      error: z
        .object({
          kind: z.enum(["validation", "conflict", "unavailable"]),
          message: z.string().max(1024),
        })
        .strict(),
    }),
  ]);
}
const Scope = { hostId: Id, projectId: Id.optional() };
export const readBitbucketConnections = defineRpc({
  name: "forge.bitbucket.connections.read",
  input: z.object(Scope).strict(),
  output: result(BitbucketConnectionsSchema),
});
export const writeBitbucketConnections = defineRpc({
  name: "forge.bitbucket.connections.write",
  input: z
    .object({ ...Scope, expectedRevision: Id, action: BitbucketConnectionActionSchema })
    .strict(),
  output: result(BitbucketConnectionsSchema),
});
export type BitbucketConnections = z.infer<typeof BitbucketConnectionsSchema>;
export type BitbucketConnectionAction = z.infer<typeof BitbucketConnectionActionSchema>;

export const BitbucketRepositorySchema = z
  .object({
    fullName: z.string().max(512),
    name: z.string().max(256),
    description: z.string().nullable(),
    private: z.boolean(),
    updatedAt: z.string().nullable(),
    cloneUrl: z.string().max(2048),
    sshUrl: z.string().max(2048),
    url: z.string().max(2048),
  })
  .strict();
export const readBitbucketRepositories = defineRpc({
  name: "forge.bitbucket.repositories.read",
  input: z
    .object({ ...Scope, workspace: z.string().min(1).max(256), query: z.string().max(1000) })
    .strict(),
  output: result(
    z
      .object({ repositories: z.array(BitbucketRepositorySchema).max(100), truncated: z.boolean() })
      .strict(),
  ),
});
export const createBitbucketRepository = defineRpc({
  name: "forge.bitbucket.repositories.create",
  input: z
    .object({
      ...Scope,
      expectedRevision: Id,
      workspace: z.string().min(1).max(256),
      name: z.string().trim().min(1).max(256),
      description: z.string().max(10000),
      private: z.boolean(),
    })
    .strict(),
  output: result(BitbucketRepositorySchema),
});
export type BitbucketRepository = z.infer<typeof BitbucketRepositorySchema>;

export const BitbucketWorkspaceSchema = z
  .object({
    id: Id,
    label: z.string().max(256),
    administrator: z.boolean(),
  })
  .strict();
export type BitbucketWorkspace = z.infer<typeof BitbucketWorkspaceSchema>;
export const readBitbucketWorkspaces = defineRpc({
  name: "forge.bitbucket.workspaces.read",
  input: z.object(Scope).strict(),
  output: result(
    z
      .object({
        workspaces: z.array(BitbucketWorkspaceSchema).max(100),
        truncated: z.boolean(),
      })
      .strict(),
  ),
});
export const setBitbucketThreadResolution = defineRpc({
  name: "forge.bitbucket.thread.resolve",
  input: z
    .object({
      hostId: Id,
      cwd: z.string().min(1).max(32768),
      expectedRevision: Id,
      number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      commentId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      resolved: z.boolean(),
    })
    .strict(),
  output: result(z.object({ resolved: z.boolean() }).strict()),
});
