import type { PromptTemplate, NodePromptTemplateRef } from "@getpaseo/plugin/otto/workflows";
import { WorkflowError } from "./files.js";
import { renderReviewedEjs } from "./template-worker.js";

const reserved = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "include",
  "settings",
  "locals",
  "globalThis",
  "process",
  "require",
]);
function validateValueExpression(expression: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(expression))
    throw new WorkflowError(
      "unsupported",
      "This template contains EJS code. Review and explicitly allow template code before execution.",
    );
  for (const key of expression.split(".")) {
    if (reserved.has(key))
      throw new WorkflowError("invalid", "A template variable uses a reserved name.");
  }
}
export function validateDataTemplate(template: PromptTemplate): void {
  let offset = 0;
  for (const match of template.content.matchAll(/<%([=-]?)([\s\S]*?)%>/g)) {
    offset = match.index + match[0].length;
    if (!match[1])
      throw new WorkflowError(
        "unsupported",
        "This template contains EJS code. Review and explicitly allow template code before execution.",
      );
    const expression = match[2].trim();
    if (!/^include\(\s*['"]([A-Za-z0-9_.-]+)['"]\s*\)$/.test(expression))
      validateValueExpression(expression);
  }
  if (template.content.slice(offset).includes("<%"))
    throw new WorkflowError("invalid", "Template has an unclosed EJS delimiter.");
}
function templateValue(expression: string, variables: Record<string, unknown>): unknown {
  validateValueExpression(expression);
  let current: unknown = variables;
  for (const key of expression.split(".")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key))
      throw new WorkflowError("invalid", `Template variable ${expression} was not supplied.`);
    current = Reflect.get(current, key);
  }
  return current;
}
function renderDataTemplate(
  template: PromptTemplate,
  templates: ReadonlyMap<string, PromptTemplate>,
  variables: Record<string, unknown>,
  depth: number,
): string {
  if (depth > 5)
    throw new WorkflowError(
      "invalid",
      "Template includes nest more than 5 deep (a snippet cycle?).",
    );
  let result = "";
  let offset = 0;
  for (const match of template.content.matchAll(/<%([=-]?)([\s\S]*?)%>/g)) {
    result += template.content.slice(offset, match.index);
    offset = match.index + match[0].length;
    if (!match[1])
      throw new WorkflowError(
        "unsupported",
        "This template contains EJS code. Review and explicitly allow template code before execution.",
      );
    const expression = match[2].trim();
    const include = /^include\(\s*['"]([A-Za-z0-9_.-]+)['"]\s*\)$/.exec(expression);
    if (include) {
      const snippet = templates.get(include[1]);
      if (!snippet)
        throw new WorkflowError(
          "invalid",
          `Included template ${include[1]} is missing from the reviewed snapshot.`,
        );
      result += renderDataTemplate(snippet, templates, variables, depth + 1);
    } else {
      const value = templateValue(expression, variables);
      result += value == null ? "" : String(value);
    }
    if (result.length > 64000)
      throw new WorkflowError("invalid", "Rendered template exceeds 64,000 characters.");
  }
  const rest = template.content.slice(offset);
  if (rest.includes("<%"))
    throw new WorkflowError("invalid", "Template has an unclosed EJS delimiter.");
  result += rest;
  if (result.length > 64000)
    throw new WorkflowError("invalid", "Rendered template exceeds 64,000 characters.");
  return result;
}
export async function renderWorkflowTemplate(input: {
  id: string;
  templates: PromptTemplate[];
  variables: Record<string, unknown>;
  allowCode: boolean;
  signal: AbortSignal;
}): Promise<string> {
  input.signal.throwIfAborted();
  if (
    input.templates.length > 64 ||
    Buffer.byteLength(JSON.stringify(input.templates)) > 1024 * 1024
  )
    throw new WorkflowError("invalid", "Template snapshot exceeds its rendering budget.");
  const templates = new Map(input.templates.map((template) => [template.id, template]));
  const selected = templates.get(input.id);
  if (!selected)
    throw new WorkflowError(
      "invalid",
      "The selected prompt template is not in this run's reviewed snapshot.",
    );
  for (const key of Object.keys(input.variables))
    if (reserved.has(key))
      throw new WorkflowError("invalid", "A template variable uses a reserved name.");
  if (input.allowCode)
    return renderReviewedEjs(input.id, input.templates, input.variables, input.signal);
  return renderDataTemplate(selected, templates, input.variables, 0);
}
/** Pure, explicit bindings. Absent upstream references become empty data, never a second instruction. */
export function workflowTemplateVariables(
  ref: NodePromptTemplateRef,
  inputs: Record<string, string>,
  upstream: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(ref.variables ?? {}).map(([name, binding]) => [
      name,
      resolveBinding(binding, inputs, upstream),
    ]),
  );
}
function resolveBinding(
  binding: string,
  inputs: Record<string, string>,
  upstream: Map<string, Record<string, unknown>>,
): unknown {
  if (binding.startsWith("$inputs."))
    return Object.hasOwn(inputs, binding.slice(8)) ? inputs[binding.slice(8)] : "";
  if (binding.startsWith("$output.")) {
    const [node, ...fields] = binding.slice(8).split(".");
    const values = upstream.get(node);
    const key = fields.join(".");
    return values && Object.hasOwn(values, key) ? values[key] : "";
  }
  return binding;
}
