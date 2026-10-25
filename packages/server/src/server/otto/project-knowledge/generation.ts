import type { KnowledgeGenerationSelection } from "@getpaseo/plugin/otto/project-knowledge";
import { createAgentStructuredTextGeneration } from "../../session/checkout/git-metadata-generator.js";

type GenerationDependencies = Omit<
  Parameters<typeof createAgentStructuredTextGeneration>[0],
  "getFocusedSelection"
>;
/** A preferred model leads the existing host fallback chain; credentials and execution stay upstream-owned. */
export function createKnowledgeGeneration(
  deps: GenerationDependencies,
  selection?: KnowledgeGenerationSelection,
) {
  return createAgentStructuredTextGeneration({
    ...deps,
    readDaemonConfig: () => {
      const config = deps.readDaemonConfig();
      return selection
        ? {
            ...config,
            metadataGeneration: {
              ...config.metadataGeneration,
              providers: [selection, ...(config.metadataGeneration?.providers ?? [])],
            },
          }
        : config;
    },
    getFocusedSelection: () => selection,
  });
}
