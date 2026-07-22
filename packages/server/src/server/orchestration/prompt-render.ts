import ejs from "ejs";

import type { PromptTemplate } from "@otto-code/protocol/orchestration";

// Prompt template rendering (projects/orchestration-graphs, Stage 5).
//
// Templates are EJS with one deliberate change: `include("id")` resolves
// against the *template store*, not the filesystem. Templates are host records
// a user authored in the app, not files on disk, so a path-based include would
// be both wrong and a way out of the store.
//
// SECURITY: EJS compiles templates to JavaScript that runs in the daemon
// process. That is acceptable today because templates are authored locally by
// the machine's own user — the same trust level as a workspace script. The day
// templates become shareable or importable, this becomes a code-execution
// vector and needs an explicit trust gate before an unfamiliar template is
// rendered. Do not add an import path without one.

const MAX_INCLUDE_DEPTH = 5;

export interface RenderPromptTemplateInput {
  template: PromptTemplate;
  variables: Record<string, unknown>;
  /** Resolve an included template by id. Return null when it doesn't exist. */
  resolveSnippet: (id: string) => PromptTemplate | null;
}

export class PromptTemplateRenderError extends Error {
  constructor(
    readonly templateId: string,
    message: string,
  ) {
    super(`Prompt template "${templateId}" could not be rendered: ${message}`);
    this.name = "PromptTemplateRenderError";
  }
}

export function renderPromptTemplate(input: RenderPromptTemplateInput): string {
  return renderWithDepth(input, 0);
}

function renderWithDepth(input: RenderPromptTemplateInput, depth: number): string {
  if (depth > MAX_INCLUDE_DEPTH) {
    throw new PromptTemplateRenderError(
      input.template.id,
      `includes nest more than ${MAX_INCLUDE_DEPTH} deep (a snippet cycle?)`,
    );
  }
  // `include` is provided as a plain function in the render scope rather than
  // through EJS's file resolver, so a template can only reach other templates.
  const include = (id: string, locals?: Record<string, unknown>): string => {
    const snippet = input.resolveSnippet(id);
    if (!snippet) {
      throw new PromptTemplateRenderError(input.template.id, `includes unknown snippet "${id}"`);
    }
    return renderWithDepth(
      {
        template: snippet,
        variables: { ...input.variables, ...locals },
        resolveSnippet: input.resolveSnippet,
      },
      depth + 1,
    );
  };
  try {
    return ejs.render(
      input.template.content,
      { ...input.variables, include },
      {
        // Prompts are text, not markup: escaping would corrupt them.
        escape: (value: unknown) => (value === undefined || value === null ? "" : String(value)),
        // No filesystem access from a template, ever.
        filename: undefined,
        cache: false,
      },
    );
  } catch (error) {
    if (error instanceof PromptTemplateRenderError) {
      throw error;
    }
    throw new PromptTemplateRenderError(
      input.template.id,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Resolve a node's variable bindings into concrete values.
 *
 * A binding is a literal, `$inputs.<key>` (a declared graph input), or
 * `$output.<nodeId>.<field>` (an upstream node's output field). An unresolvable
 * reference becomes an empty string rather than the literal text: a prompt
 * containing `$output.classify.missing` would read as an instruction to the
 * model, which is worse than a gap.
 */
export function resolveTemplateVariables(input: {
  bindings: Record<string, string> | undefined;
  graphInputs: Record<string, string>;
  upstreamFields: Map<string, Record<string, unknown>>;
}): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [name, binding] of Object.entries(input.bindings ?? {})) {
    resolved[name] = resolveBinding(binding, input.graphInputs, input.upstreamFields);
  }
  return resolved;
}

function resolveBinding(
  binding: string,
  graphInputs: Record<string, string>,
  upstreamFields: Map<string, Record<string, unknown>>,
): unknown {
  if (binding.startsWith("$inputs.")) {
    return graphInputs[binding.slice("$inputs.".length)] ?? "";
  }
  if (binding.startsWith("$output.")) {
    const [nodeId, ...fieldParts] = binding.slice("$output.".length).split(".");
    const field = fieldParts.join(".");
    if (!nodeId || !field) {
      return "";
    }
    return upstreamFields.get(nodeId)?.[field] ?? "";
  }
  return binding;
}
