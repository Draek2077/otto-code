import type { KnowledgeGenerationSelection } from "@getpaseo/plugin/otto/project-knowledge";
import { createAgentStructuredTextGeneration } from "../../session/checkout/git-metadata-generator.js";
import type { StructuredTextGeneration } from "../../session/checkout/git-metadata-generator.js";

type GenerationDependencies = Omit<
  Parameters<typeof createAgentStructuredTextGeneration>[0],
  "getFocusedSelection"
>;
/** Break the host -> AgentManager -> host bootstrap cycle before either is usable. */
export function createKnowledgeGenerationSource() {
  let dependencies: GenerationDependencies | undefined;
  return {
    initialize(next: GenerationDependencies) {
      if (dependencies) throw new Error("Knowledge generation is already initialized");
      dependencies = next;
    },
    forSelection(selection?: KnowledgeGenerationSelection): StructuredTextGeneration {
      if (!dependencies) throw new Error("Knowledge generation is not ready");
      return createKnowledgeGeneration(dependencies, selection);
    },
  };
}
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
