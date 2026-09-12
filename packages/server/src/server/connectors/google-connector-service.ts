import {
  googleConnectorForConfig,
  type ConnectorConfig,
} from "@otto-code/protocol/provider-config";
import type { OttoToolDefinition, OttoToolResult } from "../agent/tools/types.js";
import { GoogleConnectorAuthorization } from "./google-connector-authorization.js";
import { createOfficeApi } from "./office-connector-api.js";
import { googleConnectorTools } from "./google-connector-tools.js";
import { GoogleMcpBackend } from "./google-mcp-backend.js";
import type { ListConnectorToolsResult } from "./connector-tools.js";
import { connectorToolName } from "./connector-tool-name.js";

interface GoogleToolDefinition extends OttoToolDefinition {
  originalName: string;
}

export interface GoogleConnectorServiceOptions {
  authorization: Pick<
    GoogleConnectorAuthorization,
    "configured" | "start" | "disconnect" | "close" | "accessToken" | "reconcile"
  >;
  readConnectors(): readonly ConnectorConfig[];
  /** Host-owned release policy. Public builds use REST until Google grants public MCP access. */
  backend?: "rest" | "mcp";
}

/** One daemon integration with interchangeable REST and hosted MCP implementations.
 * Backend choice never moves account credentials or execution into a renderer/provider. */
export class GoogleConnectorService {
  constructor(private readonly options: GoogleConnectorServiceOptions) {}

  get configured(): boolean {
    return this.options.authorization.configured;
  }
  start(connectionId: string) {
    return this.options.authorization.start(connectionId);
  }
  disconnect(connectionId: string) {
    return this.options.authorization.disconnect(connectionId);
  }
  close() {
    return this.options.authorization.close();
  }
  reconcile() {
    return this.options.authorization.reconcile();
  }

  private api(id: string, signal?: AbortSignal, allowed: () => boolean = () => true) {
    return createOfficeApi({
      family: "google",
      accessToken: async () => {
        const token = await this.options.authorization.accessToken(id);
        if (!allowed()) throw new Error("This connector or tool is no longer enabled.");
        return token;
      },
      signal,
    });
  }

  async getTools(connector: ConnectorConfig, verify = false): Promise<GoogleToolDefinition[]> {
    const service = googleConnectorForConfig(connector);
    if (!service) throw new Error("Unknown native Google connector configuration.");
    const isAllowed = (name: string) => {
      const live = this.options.readConnectors().find((entry) => entry.id === connector.id);
      return (
        !!live &&
        live.enabled !== false &&
        !live.disabledTools?.includes(name) &&
        googleConnectorForConfig(live)?.id === service.id
      );
    };
    await this.options.authorization.accessToken(connector.id);
    const mcpFor = (toolName = "") =>
      new GoogleMcpBackend({
        serviceId: service.id,
        accessToken: async () => {
          const token = await this.options.authorization.accessToken(connector.id);
          if (!isAllowed(toolName)) throw new Error("This connector or tool is no longer enabled.");
          return token;
        },
      });
    const mcp = mcpFor();
    const hosted = this.options.backend === "mcp";
    // A public tools/list is not account access. Never admit hosted tools without a real read.
    if (hosted) await mcp.verify();
    else if (verify) await this.verifyRest(connector.id, service.id);
    const tools = hosted
      ? (await mcp.listTools()).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: (input: unknown, signal?: AbortSignal) =>
            mcpFor(tool.name).call(tool.name, input, signal),
        }))
      : googleConnectorTools(service).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: async (input: unknown, signal?: AbortSignal): Promise<OttoToolResult> => {
            const output = JSON.stringify(
              await tool.run(
                this.api(connector.id, signal, () => isAllowed(tool.name)),
                input,
              ),
            );
            if (output.length > 120_000)
              return failure(
                "This result is too large. Narrow the query or request a smaller page.",
              );
            return { content: [{ type: "text", text: output }] };
          },
        }));
    return tools.map((tool) => ({
      source: "connector",
      originalName: tool.name,
      name: connectorToolName(connector.id, tool.name),
      title: `${connector.label}: ${tool.name}`,
      description: `[${connector.label}] ${tool.description}`,
      inputSchema: tool.inputSchema,
      handler: async (input, context): Promise<OttoToolResult> => {
        const live = this.options.readConnectors().find((entry) => entry.id === connector.id);
        if (
          !live ||
          live.enabled === false ||
          live.disabledTools?.includes(tool.name) ||
          googleConnectorForConfig(live)?.id !== service.id
        )
          return failure("This connector or tool is no longer enabled. Refresh the session tools.");
        try {
          const validated = tool.inputSchema.parse(input);
          return await tool.execute(validated, context.signal);
        } catch (error) {
          // Service errors contain no raw HTTP bodies/tokens; schema failures may contain user input.
          return failure(
            error instanceof Error && error.name !== "ZodError"
              ? error.message
              : "Google returned an unsupported response or the tool input was invalid.",
          );
        }
      },
    }));
  }

  async listTools(connector: ConnectorConfig): Promise<ListConnectorToolsResult> {
    try {
      const tools = await this.getTools(connector, true);
      return {
        error: null,
        tools: tools.map((tool) => {
          const name = tool.originalName;
          return {
            name,
            description: tool.description,
            disabled: connector.disabledTools?.includes(name) ?? false,
          };
        }),
      };
    } catch (error) {
      return {
        tools: [],
        error: error instanceof Error ? error.message : "Could not verify Google access.",
      };
    }
  }

  private async verifyRest(id: string, serviceId: string): Promise<void> {
    const requests = {
      gmail: { url: "https://gmail.googleapis.com/gmail/v1/users/me/labels" },
      "google-drive": {
        url: "https://www.googleapis.com/drive/v3/files",
        query: { pageSize: 1, fields: "files(id)" },
      },
      "google-calendar": {
        url: "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        query: { maxResults: 1, fields: "items(id)" },
      },
    };
    await this.api(id)(requests[serviceId as keyof typeof requests]);
  }
}

function failure(text: string): OttoToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}
