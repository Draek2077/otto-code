import { z } from "zod";
import {
  defineForgeFacts,
  type ClientForgeLogicModule,
  type MergeCapability,
} from "@/git/client-forge-module";
import type { CheckoutPrMergeMethod } from "@otto-code/protocol/messages";

/**
 * Bitbucket Cloud's client-side merge logic.
 *
 * Otto's Bitbucket adapter is registered into the forge registry under the
 * forge id `github`, which is the provider-routing facade (see
 * `server/src/server/bootstrap.ts`), so a Bitbucket workspace's wire `forge`
 * never reads "bitbucket" and this module is never reached by
 * `getClientForgeLogicModule`. It is reached by the facts family instead:
 * `bitbucket-cloud-service.ts` tags its `forgeSpecific` envelope
 * `forge: "bitbucket"`, and `deriveMergeCapability` matches modules by parsing
 * that envelope rather than by id. That is also why there is no `urlGrammar`
 * and no `.view.tsx` sibling here - both of those are looked up by forge id.
 *
 * Server twin: `server/src/services/git-hosting/bitbucket-facts.ts`.
 */
const BitbucketMergeFactsSchema = z
  .object({
    forge: z.literal("bitbucket"),
    mergeStrategiesAllowed: z.array(z.string()).optional().default([]),
    defaultMergeStrategy: z.string().nullable().optional().default(null),
    approvalCount: z.number().optional().default(0),
    changesRequestedCount: z.number().optional().default(0),
  })
  .passthrough();

type BitbucketMergeFacts = z.infer<typeof BitbucketMergeFactsSchema>;

function normalizeBitbucketMergeMethod(value: string | null): CheckoutPrMergeMethod | null {
  if (value === "merge" || value === "squash" || value === "rebase") {
    return value;
  }
  return null;
}

function deriveBitbucketMergeCapability(bitbucket: BitbucketMergeFacts): MergeCapability {
  const allowedMethods: CheckoutPrMergeMethod[] = [];
  for (const strategy of bitbucket.mergeStrategiesAllowed) {
    const method = normalizeBitbucketMergeMethod(strategy);
    if (method && !allowedMethods.includes(method)) {
      allowedMethods.push(method);
    }
  }
  return {
    // Bitbucket Cloud reports no computed mergeability (`mergeable` is always
    // UNKNOWN), so readiness cannot be derived from the facts. The daemon
    // re-checks that the PR is open before merging and Bitbucket enforces its
    // own merge checks server-side, so offer the action and let the forge
    // refuse - the same posture the pre-forge policy took.
    directMergeReady: true,
    // Bitbucket Cloud has no auto-merge and no merge queue.
    canEnableAutoMerge: false,
    autoMergeEnabled: false,
    canDisableAutoMerge: false,
    mergeBlockedByQueue: false,
    allowedMethods,
    preferredMethod: normalizeBitbucketMergeMethod(bitbucket.defaultMergeStrategy),
  };
}

export const bitbucketForgeLogic = {
  id: "bitbucket",
  facts: defineForgeFacts({
    family: "bitbucket",
    schema: BitbucketMergeFactsSchema,
    deriveMergeCapability: deriveBitbucketMergeCapability,
  }),
} satisfies ClientForgeLogicModule<BitbucketMergeFacts>;
