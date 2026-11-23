import { z } from "zod";
import { googleConnectorForConfig, type ConnectorTool } from "@getpaseo/plugin/otto/connectors";
import type { PaseoToolDefinition, PaseoToolResult } from "../../../../server/agent/tools/types.js";
import { ConnectorError } from "../configuration.js";
import { ConnectorStore } from "../store.js";
import { ConnectorOAuthBroker } from "../oauth-broker.js";
import { connectorToolName } from "../tool-name.js";
import { googleConnectorTools } from "./google-connector-tools.js";
import { createOfficeApi, OfficeApiError } from "./office-connector-api.js";
import { redactConnectorJson, redactConnectorText } from "../redaction.js";

const reads = new Set([
  "list_emails",
  "read_email",
  "list_files",
  "read_file",
  "list_calendars",
  "list_events",
  "read_event",
]);
interface GoogleTool extends PaseoToolDefinition {
  inputSchema: z.ZodType;
  originalName: string;
  readOnly: boolean;
}
interface ServicePorts {
  store: Pick<ConnectorStore, "open">;
  authorization: Pick<ConnectorOAuthBroker, "authorize">;
  fetcher?: typeof fetch;
}
function failure(message: string): PaseoToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Native Google API tools use the same host authority and tool catalog as MCP
 * connectors. They never launch an external server or export an account token.
 */
export class GoogleConnectorTools {
  constructor(private readonly ports: ServicePorts) {}
  async definitions(id: string): Promise<GoogleTool[]> {
    const opened = await this.ports.store.open(id);
    const service = googleConnectorForConfig(opened.bundle);
    if (!service) throw new ConnectorError("validation", "This is not a native Google connector.");
    return googleConnectorTools(service).map(
      (tool): GoogleTool => ({
        originalName: tool.name,
        readOnly: reads.has(tool.name),
        annotations: { readOnlyHint: reads.has(tool.name) },
        name: connectorToolName(id, tool.name),
        title: `${opened.entry.label}: ${tool.name}`,
        description: `[${opened.entry.label}] ${tool.description}`,
        inputSchema: tool.inputSchema,
        handler: async (input, context) => {
          const tokens = new Set<string>();
          const current = async () => {
            const live = await this.ports.store.open(id);
            if (!live.entry.enabled || live.entry.disabledTools.includes(tool.name))
              throw new ConnectorError(
                "unavailable",
                "This connector or tool is disabled. Refresh the chat's tool catalog.",
              );
            if (
              live.entry.generation !== opened.entry.generation ||
              googleConnectorForConfig(live.bundle)?.id !== service.id
            )
              throw new ConnectorError(
                "conflict",
                "This Google connector changed. Refresh the chat's tool catalog.",
              );
            return live;
          };
          const clean = (text: string) => redactConnectorText(text, [...tokens]);
          try {
            await current();
            const validated = tool.inputSchema.parse(input);
            const api = createOfficeApi({
              family: "google",
              signal: context.signal,
              fetch: this.ports.fetcher,
              accessToken: async () => {
                const live = await current();
                const authorized = await this.ports.authorization.authorize(
                  live,
                  context.signal ?? new AbortController().signal,
                );
                await current();
                if (authorized.server.type === "stdio")
                  throw new ConnectorError(
                    "authorization",
                    "The Google connector no longer has API authorization.",
                  );
                const header = authorized.server.headers.Authorization;
                if (!header?.startsWith("Bearer "))
                  throw new ConnectorError(
                    "authorization",
                    "Sign in to this Google service in Connectors.",
                  );
                const token = header.slice(7);
                tokens.add(token);
                return token;
              },
            });
            const output = await tool.run(api, validated);
            const value = JSON.stringify(output);
            if (value.length > 120000)
              return failure(
                "This Google result is too large. Narrow the query or request a smaller page.",
              );
            return {
              content: [
                { type: "text", text: JSON.stringify(redactConnectorJson(output, [...tokens])) },
              ],
            };
          } catch (error) {
            if (context.signal?.aborted)
              throw new DOMException("Google request canceled.", "AbortError");
            if (error instanceof z.ZodError)
              return failure(
                "The Google tool input or response is unsupported. Check the tool's required fields.",
              );
            return failure(
              clean(
                error instanceof ConnectorError || error instanceof OfficeApiError
                  ? error.message
                  : "Google did not complete the request. Verify write outcomes before repeating them.",
              ).slice(0, 2048),
            );
          }
        },
      }),
    );
  }
  async inspect(id: string): Promise<ConnectorTool[]> {
    return (await this.definitions(id)).map((tool) => ({
      name: tool.originalName,
      description: tool.description,
      inputSchema: z.record(z.string(), z.json()).parse(z.toJSONSchema(tool.inputSchema)),
      readOnly: tool.readOnly,
    }));
  }
  async verify(id: string, signal: AbortSignal): Promise<ConnectorTool[]> {
    const opened = await this.ports.store.open(id);
    const service = googleConnectorForConfig(opened.bundle);
    if (!service) throw new ConnectorError("validation", "Choose a native Google connector.");
    const api = createOfficeApi({
      family: "google",
      signal,
      fetch: this.ports.fetcher,
      accessToken: async () => {
        const current = await this.ports.store.open(id);
        if (current.entry.generation !== opened.entry.generation)
          throw new ConnectorError("conflict", "The connector changed while verifying access.");
        const authorized = await this.ports.authorization.authorize(current, signal);
        const admitted = await this.ports.store.open(id);
        if (admitted.entry.generation !== opened.entry.generation)
          throw new ConnectorError("conflict", "The connector changed while verifying access.");
        if (
          authorized.server.type === "stdio" ||
          !authorized.server.headers.Authorization?.startsWith("Bearer ")
        )
          throw new ConnectorError(
            "authorization",
            "Sign in to this Google service in Connectors.",
          );
        return authorized.server.headers.Authorization.slice(7);
      },
    });
    if (service.id === "gmail")
      await api({ url: "https://gmail.googleapis.com/gmail/v1/users/me/labels" });
    else if (service.id === "google-drive")
      await api({
        url: "https://www.googleapis.com/drive/v3/files",
        query: { pageSize: 1, fields: "files(id)" },
      });
    else
      await api({
        url: "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        query: { maxResults: 1 },
      });
    return this.inspect(id);
  }
}
