import path from "node:path";
import { z } from "zod";
import {
  CONNECTOR_CATALOG,
  ConnectorTransportSchema,
  type ConnectorSetupInput,
  type ConnectorSummary,
  type ConnectorTransport,
  googleConnectorForConfig,
  type ConnectorCatalogEntry,
} from "@getpaseo/plugin/otto/connectors";

export class ConnectorError extends Error {
  constructor(
    readonly kind:
      | "validation"
      | "conflict"
      | "unavailable"
      | "authorization"
      | "vendor"
      | "uncertain",
    message: string,
  ) {
    super(message);
  }
}
export interface ConnectorBundle {
  server: ConnectorTransport;
  builtin?: string;
  oauth: boolean;
  scope: string;
  client?: { clientId: string; clientSecret?: string };
  /** Daemon-only grant state; parsed by the appropriate authorization driver. */
  authorization?: Record<string, unknown>;
  /** Retained legacy fields are not promoted into any broader authority. */
  legacy?: Record<string, unknown>;
}
export const ConnectorBundleSchema = z
  .object({
    server: ConnectorTransportSchema,
    builtin: z.string().optional(),
    oauth: z.boolean(),
    scope: z.string(),
    client: z.object({ clientId: z.string(), clientSecret: z.string().optional() }).optional(),
    authorization: z.record(z.string(), z.unknown()).optional(),
    legacy: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export function connectorEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError("validation", "Enter a complete HTTP(S) server URL.");
  }
  const local = new Set(["127.0.0.1", "[::1]", "localhost"]);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local.has(url.hostname))) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new ConnectorError(
      "validation",
      "Use HTTPS, or HTTP on loopback, without embedded account credentials or a fragment.",
    );
  return url;
}

function oauthCatalogBundle(
  setup: Extract<ConnectorCatalogEntry["setup"], { kind: "oauth" }>,
  input: Extract<ConnectorSetupInput, { kind: "catalog" }>,
): ConnectorBundle {
  if (setup.registration?.required && (!input.client?.clientId || !input.client.clientSecret))
    throw new ConnectorError(
      "validation",
      "This provider requires a registered MCP app. Enter its client ID and client secret, using the callback shown in Connectors.",
    );
  if (setup.builtin && input.client)
    throw new ConnectorError(
      "validation",
      "Native Google connectors use the host's publisher registration.",
    );
  return {
    server: { type: setup.transport, url: setup.url, headers: {} },
    builtin: setup.builtin,
    oauth: true,
    scope: setup.scope ?? "",
    client: input.client,
  };
}
export function connectorSetup(input: ConnectorSetupInput): {
  catalogId: string | null;
  bundle: ConnectorBundle;
} {
  if (input.kind === "custom") {
    if (input.oauth && input.server.type === "stdio")
      throw new ConnectorError("validation", "Browser sign-in requires an HTTP or SSE connector.");
    if (
      input.oauth &&
      input.server.type !== "stdio" &&
      Object.keys(input.server.headers).some((name) => name.toLowerCase() === "authorization")
    )
      throw new ConnectorError(
        "validation",
        "Choose browser sign-in or an Authorization header, rather than both.",
      );
    if (input.server.type !== "stdio") connectorEndpoint(input.server.url);
    return {
      catalogId: null,
      bundle: {
        server: input.server,
        oauth: input.oauth,
        scope: input.scope,
        client: input.client,
      },
    };
  }
  const entry = CONNECTOR_CATALOG.find((row) => row.id === input.catalogId);
  if (!entry)
    throw new ConnectorError("validation", "Choose a connector from the current catalog.");
  const setup = entry.setup;
  if (setup.kind === "oauth") {
    return {
      catalogId: entry.id,
      bundle: oauthCatalogBundle(setup, input),
    };
  }
  if (setup.transport === "http")
    return {
      catalogId: entry.id,
      bundle: { server: { type: "http", url: setup.url, headers: {} }, oauth: false, scope: "" },
    };
  const args = [...setup.args];
  const env: Record<string, string> = {};
  if (entry.id === "filesystem") {
    if (!input.roots.length || input.roots.some((root) => !path.isAbsolute(root)))
      throw new ConnectorError(
        "validation",
        "Choose at least one absolute directory on this host for Local files.",
      );
    args.push(...input.roots);
  }
  if (setup.kind === "token") {
    if (!input.credential?.trim())
      throw new ConnectorError(
        "validation",
        `Enter the ${setup.credential.label.toLowerCase()} for this connector.`,
      );
    env[setup.credential.envVar] = input.credential;
  }
  return {
    catalogId: entry.id,
    bundle: {
      server: { type: "stdio", command: setup.command, args, env },
      oauth: false,
      scope: "",
    },
  };
}

/** Arguments, query parameters, environment values and headers are write-only.
 * Existing secret values never make a round trip through a settings form.
 */
export function connectorServerSummary(server: ConnectorTransport): ConnectorSummary["server"] {
  if (server.type === "stdio")
    return {
      type: "stdio",
      command: server.command,
      endpoint: null,
      argumentCount: server.args.length,
      environmentNames: Object.keys(server.env),
      headerNames: [],
    };
  const url = connectorEndpoint(server.url);
  url.search = "";
  return {
    type: server.type,
    endpoint: url.toString(),
    command: null,
    argumentCount: 0,
    environmentNames: [],
    headerNames: Object.keys(server.headers),
  };
}

/** Read-only 0.9 projection. Preserve the original record; never accept its auth
 * block from a client and never rewrite it while normalizing a transport.
 */
export function legacyConnectorBundle(raw: Record<string, unknown>): ConnectorBundle {
  const server = z
    .object({
      type: z.enum(["stdio", "http", "sse"]),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      url: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .parse(raw.server);
  const transport = ConnectorTransportSchema.parse(
    server.type === "stdio"
      ? { type: "stdio", command: server.command, args: server.args ?? [], env: server.env ?? {} }
      : { type: server.type, url: server.url, headers: server.headers ?? {} },
  );
  const auth =
    raw.auth && typeof raw.auth === "object" && !Array.isArray(raw.auth)
      ? z.record(z.string(), z.unknown()).parse(raw.auth)
      : undefined;
  return {
    server: transport,
    builtin: typeof raw.builtin === "string" ? raw.builtin : undefined,
    oauth:
      Boolean(auth) ||
      Boolean(
        googleConnectorForConfig({
          builtin: typeof raw.builtin === "string" ? raw.builtin : undefined,
          server: transport,
        }),
      ),
    scope: "",
    authorization: auth,
    legacy: raw,
  };
}

export function serializeConnectorBundle(bundle: ConnectorBundle): string {
  const value = JSON.stringify(ConnectorBundleSchema.parse(bundle));
  if (Buffer.byteLength(value) > 120_000)
    throw new ConnectorError(
      "validation",
      "This connector configuration exceeds secure storage limits. Reduce its arguments, environment or headers.",
    );
  return value;
}

/** Explicitly clearing a grant must not reactivate an older preserved grant. */
export function disconnectedConnectorBundle(bundle: ConnectorBundle): ConnectorBundle {
  return {
    ...bundle,
    authorization: { kind: "disconnected" },
    ...(bundle.legacy ? { legacy: { ...bundle.legacy, auth: undefined } } : {}),
  };
}
