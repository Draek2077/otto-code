import { z } from "zod";

import type { OrchestrationOutputField } from "@otto-code/protocol/agent-labels";
import type { GraphOutputField } from "@otto-code/protocol/orchestration";

// The value plane for graph nodes (projects/orchestration-graphs, Stage 1).
//
// A node declares plain JSON field descriptors. This module is the only place
// that knows how to turn them into the three things the runtime needs:
//
//   descriptors → Zod          validate what the agent submitted
//   descriptors → JSON Schema  the submit_output tool's input shape
//   descriptors → prose        the instruction block appended to the task
//
// It also owns the submitted-value store. The submit_output tool handler runs
// inside the daemon (whatever provider the node's seat uses), writes here, and
// the graph engine reads the value once the agent settles. That indirection is
// what makes structured output provider-neutral: no provider ever has to hand
// us a parsed tool call.

export type NodeOutputFieldDescriptor = GraphOutputField | OrchestrationOutputField;

export interface NodeOutputValidationSuccess {
  ok: true;
  value: Record<string, unknown>;
}

export interface NodeOutputValidationFailure {
  ok: false;
  /** Model-facing message: precise enough to correct against, short enough to be cheap. */
  message: string;
}

export type NodeOutputValidation = NodeOutputValidationSuccess | NodeOutputValidationFailure;

// Unknown type names validate as "anything" rather than failing: `type` is an
// open wire vocabulary, and an old daemon meeting a new type should degrade to
// accepting the value, not reject a graph it could otherwise run.
function zodForField(field: NodeOutputFieldDescriptor): z.ZodTypeAny {
  switch (field.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(z.unknown());
    default:
      return z.unknown();
  }
}

/** Compile descriptors into the schema the submitted value is checked against. */
export function compileOutputSchema(
  fields: readonly NodeOutputFieldDescriptor[],
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    const base = zodForField(field);
    // Absent `required` means required — you declared the field, you produce it.
    shape[field.key] = field.required === false ? base.optional() : base;
  }
  return z.object(shape).passthrough() as unknown as z.ZodType<Record<string, unknown>>;
}

/**
 * The submit_output tool's advertised input schema.
 *
 * Every field is optional here even when the contract requires it, and that is
 * deliberate. The catalog parses a tool's input against this schema *before*
 * the handler runs and throws on failure, so a strictly-typed shape would mean
 * a missing field — the most common mistake, and the one worth correcting —
 * surfaces as a thrown parse error rather than as this module's own message.
 * Making the shape permissive hands every such case to the handler, which
 * answers with a precise, correctable tool error on every provider. Requiredness
 * is still enforced (validateNodeOutput) and still stated, in the instruction
 * block the node's task carries and in each field's description.
 */
export function compileOutputToolInputShape(
  fields: readonly NodeOutputFieldDescriptor[],
): z.ZodRawShape {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    const requirement = field.required === false ? "optional" : "required";
    const description = field.description
      ? `${field.description} (${requirement})`
      : `${field.key} (${requirement})`;
    shape[field.key] = zodForField(field).describe(description).optional();
  }
  return shape;
}

export function validateNodeOutput(
  fields: readonly NodeOutputFieldDescriptor[],
  candidate: unknown,
): NodeOutputValidation {
  const parsed = compileOutputSchema(fields).safeParse(candidate);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, message: issues };
}

/**
 * The instruction a node with declared fields carries. Deliberately short: it
 * rides on every dispatch of every such node, so every word is paid for on
 * each spawn. The field list doubles as the contract and the documentation.
 */
export function buildOutputInstruction(fields: readonly NodeOutputFieldDescriptor[]): string {
  const lines = fields.map((field) => {
    const optional = field.required === false ? ", optional" : "";
    const description = field.description ? ` — ${field.description}` : "";
    return `- ${field.key} (${field.type}${optional})${description}`;
  });
  return [
    "When your work is complete, call the submit_output tool exactly once with these fields:",
    ...lines,
    "The tool call is the deliverable — do not write the fields as prose instead. If the tool reports a validation error, correct the values and call it again.",
  ].join("\n");
}

// ── Submitted-value store ───────────────────────────────────────────────────

interface SubmittedOutput {
  value: Record<string, unknown>;
}

/**
 * Where submit_output puts what an agent submitted, keyed by agent id.
 *
 * In-memory and deliberately so: an entry is meaningful only between an agent
 * submitting and the engine harvesting it moments later. The durable copy is
 * the phase candidate's `outputFields` on the Run record, which is what a
 * restart reads.
 */
export class NodeOutputStore {
  private readonly submissions = new Map<string, SubmittedOutput>();

  /** Last valid submission wins — a model that corrects itself means it. */
  record(agentId: string, value: Record<string, unknown>): void {
    this.submissions.set(agentId, { value });
  }

  take(agentId: string): Record<string, unknown> | null {
    const entry = this.submissions.get(agentId);
    if (!entry) {
      return null;
    }
    this.submissions.delete(agentId);
    return entry.value;
  }

  forget(agentId: string): void {
    this.submissions.delete(agentId);
  }
}

// ── Prose fallback ──────────────────────────────────────────────────────────

/**
 * Recover output fields from a final message when the tool was never called.
 *
 * Not a fallback *path* — the feature contract still says "declare fields, get
 * fields". This is the difference between a node whose model wrote its JSON in
 * prose (recoverable, and common on small local models) and a node that
 * produced nothing usable (a real failure worth reporting).
 */
export function extractOutputFieldsFromProse(
  fields: readonly NodeOutputFieldDescriptor[],
  finalMessage: string | null,
): Record<string, unknown> | null {
  if (!finalMessage) {
    return null;
  }
  for (const candidate of balancedJsonObjects(finalMessage)) {
    const validation = validateNodeOutput(fields, candidate);
    if (validation.ok) {
      return validation.value;
    }
  }
  return null;
}

// Yield every balanced {...} span in the text, outermost first, so a fenced or
// prose-wrapped object is found without a parser.
function* balancedJsonObjects(text: string): Generator<unknown> {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const end = findBalancedEnd(text, start);
    if (end === -1) {
      continue;
    }
    try {
      yield JSON.parse(text.slice(start, end + 1));
    } catch {
      // Not JSON; fall through to the next opening brace.
    }
  }
}

/** Index of the `}` closing the `{` at `start`, or -1 if the span never closes. */
function findBalancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index] as string;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}
