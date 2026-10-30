import type { ConnectorTransport } from "@getpaseo/plugin/otto/connectors";
import { ConnectorError } from "./configuration.js";

export function connectorPrivateValues(server: ConnectorTransport): string[] {
  const values = Object.values(server.type === "stdio" ? server.env : server.headers);
  if (server.type !== "stdio") values.push(...new URL(server.url).searchParams.values());
  return [
    ...new Set(
      values.flatMap((value) => [value, value.replace(/^Bearer\s+/i, "")]).filter(Boolean),
    ),
  ].toSorted((a, b) => b.length - a.length);
}
export function redactConnectorText(text: string, secrets: readonly string[]): string {
  for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
  return text;
}
/** Redact before JSON escaping, including keys, and bound the traversal. */
export function redactConnectorJson(value: unknown, secrets: readonly string[]): unknown {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ConnectorError("vendor", "The connector returned unsupported non-JSON data.");
  }
  if (serialized === undefined)
    throw new ConnectorError("vendor", "The connector returned unsupported non-JSON data.");
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024)
    throw new ConnectorError("vendor", "The connector result is too large. Narrow the request.");
  let nodes = 0;
  function visit(input: unknown, depth: number): unknown {
    if (++nodes > 20000 || depth > 32)
      throw new ConnectorError(
        "vendor",
        "The connector returned an overly complex result. Narrow the request.",
      );
    if (typeof input === "string") return redactConnectorText(input, secrets);
    if (Array.isArray(input)) return input.map((item) => visit(item, depth + 1));
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input).map(([key, child]) => [
          redactConnectorText(key, secrets),
          visit(child, depth + 1),
        ]),
      );
    return input;
  }
  return visit(value, 0);
}
