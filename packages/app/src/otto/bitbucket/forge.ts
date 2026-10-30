import { z } from "zod";
import {
  defineForgeFacts,
  type ClientForgeLogicModule,
  type MergeCapability,
} from "@/git/client-forge-module";
import type { CheckoutPrMergeMethod } from "@getpaseo/protocol/messages";

const Facts = z
  .object({
    forge: z.literal("bitbucket"),
    mergeStrategiesAllowed: z.array(z.string()).optional(),
    defaultMergeStrategy: z.string().nullable().optional(),
    approvalCount: z.number().optional(),
    changesRequestedCount: z.number().optional(),
  })
  .passthrough();
function method(value: string | null | undefined): CheckoutPrMergeMethod | null {
  if (value === "merge" || value === "squash") return value;
  return null;
}
function merge(facts: z.infer<typeof Facts>): MergeCapability {
  const allowedMethods: CheckoutPrMergeMethod[] = [];
  for (const value of facts.mergeStrategiesAllowed ?? []) {
    const candidate = method(value);
    if (candidate && !allowedMethods.includes(candidate)) allowedMethods.push(candidate);
  }
  return {
    directMergeReady: true,
    canEnableAutoMerge: false,
    autoMergeEnabled: false,
    canDisableAutoMerge: false,
    mergeBlockedByQueue: false,
    allowedMethods,
    preferredMethod: method(facts.defaultMergeStrategy),
  };
}
export const bitbucketCloudForgeLogic = {
  id: "bitbucket-cloud",
  urlGrammar: {
    treeInfix: "/src/",
    blobInfix: "/src/",
    lineAnchor: (start: number, end?: number) =>
      end && end > start ? `#lines-${start}:${end}` : `#lines-${start}`,
    changeRequestChecksSuffix: "/checks",
    referencePaths: [{ kind: "change_request", infix: "/pull-requests/" }],
  },
  facts: defineForgeFacts({ family: "bitbucket", schema: Facts, deriveMergeCapability: merge }),
} satisfies ClientForgeLogicModule<z.infer<typeof Facts>>;
