import { createHash } from "node:crypto";
import { z } from "zod";
import {
  connectorServerSummary,
  legacyConnectorBundle,
  type ConnectorBundle,
} from "./configuration.js";
import type { ConnectorEntry } from "./store.js";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export interface LegacyConnectorRecord {
  entry: ConnectorEntry;
  bundle: ConnectorBundle | null;
}
function unavailable(id: string, fingerprint: string): LegacyConnectorRecord {
  const message =
    "This preserved configuration is unavailable. Reconfigure or remove it here; the original settings remain unchanged.";
  return {
    bundle: null,
    entry: {
      id,
      label: "Preserved connector",
      catalogId: null,
      generation: `legacy-${fingerprint}`,
      fingerprint,
      enabled: false,
      disabledTools: [],
      server: {
        type: "unavailable",
        endpoint: null,
        command: null,
        argumentCount: 0,
        environmentNames: [],
        headerNames: [],
      },
      authorization: { state: "error", account: null, scopes: [], message },
      verification: { state: "failed", checkedAt: null, fingerprint: null, message, tools: [] },
    },
  };
}

/** A malformed legacy row cannot make every other connector unmanageable. */
export function legacyConnectorRecords(records: unknown[]): Map<string, LegacyConnectorRecord> {
  const result = new Map<string, LegacyConnectorRecord>();
  for (const value of records) {
    const fingerprint = hash(value);
    const record = z.record(z.string(), z.unknown()).safeParse(value);
    const raw = record.success ? record.data : {};
    const parsedId = z.string().min(1).max(256).safeParse(raw.id);
    const id = parsedId.success ? parsedId.data : `legacy-invalid-${fingerprint.slice(0, 32)}`;
    if (result.has(id)) {
      result.set(id, unavailable(id, hash([result.get(id)?.entry.fingerprint, fingerprint])));
      continue;
    }
    try {
      if (!parsedId.success) throw new Error("Invalid preserved identity");
      const bundle = legacyConnectorBundle(raw);
      let authorizationState: ConnectorEntry["authorization"]["state"] = "not-required";
      if (bundle.authorization) authorizationState = "connected";
      else if (bundle.oauth) authorizationState = "disconnected";
      const entry: ConnectorEntry = {
        id,
        label:
          typeof raw.label === "string" && raw.label ? raw.label.slice(0, 200) : id.slice(0, 200),
        catalogId: null,
        generation: `legacy-${fingerprint}`,
        fingerprint,
        enabled: raw.enabled !== false,
        disabledTools: z
          .array(z.string().max(256))
          .max(1024)
          .parse(raw.disabledTools ?? []),
        server: connectorServerSummary(bundle.server),
        authorization: {
          state: authorizationState,
          account: null,
          scopes: [],
          message: null,
        },
        verification: {
          state: "unverified",
          checkedAt: null,
          fingerprint: null,
          message: null,
          tools: [],
        },
      };
      result.set(id, { entry, bundle });
    } catch {
      result.set(id, unavailable(id, fingerprint));
    }
  }
  return result;
}
