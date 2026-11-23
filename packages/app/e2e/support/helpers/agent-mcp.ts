import { expect } from "@playwright/test";
import { z } from "zod";
import { getE2EDaemonPort } from "./daemon-port";

/** Verify both MCP representations using the selected catalog's text contract. */
export async function callAgentMcp(
  name: string,
  args: Record<string, unknown>,
  textFormat: "json" | "summary-json" = "summary-json",
) {
  const response = await fetch(`http://127.0.0.1:${getE2EDaemonPort()}/mcp/agents`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) throw new Error(`Isolated agent MCP request failed: ${response.status}`);
  const text = await response.text();
  const event = text.split("\n").find((line) => line.startsWith("data:"));
  const envelope = z
    .object({
      result: z.object({
        structuredContent: z.unknown(),
        content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
      }),
    })
    .parse(JSON.parse(event ? event.slice(5).trim() : text));
  expect(envelope.result.content).toHaveLength(1);
  const visible = envelope.result.content[0].text;
  // The normal Paseo catalog prefixes JSON with array count/ID summary lines.
  // Knowledge supplies its own JSON text and must keep that stricter contract.
  const separator = textFormat === "summary-json" ? visible.indexOf("\n\n") : -1;
  const body = separator < 0 ? visible : visible.slice(separator + 2);
  expect(JSON.parse(body)).toEqual(envelope.result.structuredContent);
  return envelope.result.structuredContent;
}
