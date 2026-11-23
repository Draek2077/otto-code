import { z } from "zod";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const schemaMaps = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);
const schemaArrays = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const schemaChildren = new Set([
  "items",
  "additionalItems",
  "additionalProperties",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
]);

/** Zod resolves root definitions, but not arbitrary local JSON Pointers such as
 * monday.com's file-answer reference. Relocate referenced schemas into definitions
 * without expanding shared/recursive schemas or touching example/default data.
 */
export function connectorInputSchema(parameters: Record<string, unknown>): z.ZodType {
  const definitionsKey =
    parameters.$schema === "http://json-schema.org/draft-07/schema#" ||
    parameters.$schema === "http://json-schema.org/draft-04/schema#"
      ? "definitions"
      : "$defs";
  const definitions: Record<string, unknown> = {};
  const references = new Map<string, string>();

  function reference(ref: string): string {
    if (!ref.startsWith("#/")) return ref;
    const existing = references.get(ref);
    if (existing) return existing;
    let target: unknown = parameters;
    for (const part of decodeURIComponent(ref.slice(2)).split("/")) {
      const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
      if ((!isObject(target) && !Array.isArray(target)) || !Object.hasOwn(target, key))
        throw new Error("Connector input schema contains an unresolved local reference.");
      target = (target as Record<string, unknown>)[key];
    }
    if (!isObject(target) && typeof target !== "boolean") {
      throw new Error("Connector input schema reference does not point to a schema.");
    }
    const name = `otto_ref_${references.size}`;
    const relocated = `#/${definitionsKey}/${name}`;
    references.set(ref, relocated);
    definitions[name] = visit(target);
    return relocated;
  }

  function visit(value: unknown): unknown {
    if (!isObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (key === "$ref" && typeof child === "string") return [key, reference(child)];
        if (schemaMaps.has(key) && isObject(child)) {
          return [
            key,
            Object.fromEntries(
              Object.entries(child).map(([name, schema]) => [name, visit(schema)]),
            ),
          ];
        }
        if ((schemaArrays.has(key) || key === "items") && Array.isArray(child)) {
          return [key, child.map(visit)];
        }
        if (schemaChildren.has(key)) return [key, visit(child)];
        return [key, child];
      }),
    );
  }

  const normalized = visit(parameters) as Record<string, unknown>;
  if (references.size > 0) {
    // All local pointers now target this one table. Keeping both tables would
    // let Zod select the wrong one for a draft-7 schema containing $defs.
    delete normalized.$defs;
    delete normalized.definitions;
    normalized[definitionsKey] = definitions;
  }
  return z.fromJSONSchema(normalized);
}
