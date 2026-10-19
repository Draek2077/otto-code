import type { Command } from "commander";
import { connectToDaemon } from "../../utils/client.js";
import type { CommandOptions, OutputSchema, SingleResult } from "../../output/index.js";
import {
  ProviderDiscoveryOptionsSchema,
  type ProviderDiscoveryDiagnostic,
} from "@otto-code/protocol/provider-discovery";

export interface ProviderDiagnosticResult {
  provider: string;
  diagnostic: string;
  discovery?: ProviderDiscoveryDiagnostic;
}

export const providerDiagnosticSchema: OutputSchema<ProviderDiagnosticResult> = {
  idField: "provider",
  columns: [
    { header: "PROVIDER", field: "provider" },
    { header: "DIAGNOSTIC", field: "diagnostic" },
  ],
  renderHuman(result) {
    if (result.type === "single")
      return result.data.discovery
        ? JSON.stringify(result.data.discovery, null, 2)
        : result.data.diagnostic;
    return result.data.map((entry) => entry.diagnostic).join("\n\n");
  },
};

export interface ProviderDiagnosticOptions extends CommandOptions {
  host?: string;
  thread?: string;
  limit?: string;
  cursor?: string;
  cwd?: string;
  compareSource?: string;
}

export async function runDiagnosticCommand(
  provider: string,
  options: ProviderDiagnosticOptions,
  _command: Command,
): Promise<SingleResult<ProviderDiagnosticResult>> {
  if (
    !options.thread &&
    [options.limit, options.cursor, options.cwd, options.compareSource].some((v) => v !== undefined)
  ) {
    throw new Error("--limit, --cursor, --cwd and --compare-source require --thread.");
  }
  const discovery =
    options.thread === undefined
      ? undefined
      : ProviderDiscoveryOptionsSchema.parse({
          threadId: options.thread,
          ...(options.limit !== undefined ? { limit: Number(options.limit) } : {}),
          ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
          ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
          ...(options.compareSource !== undefined ? { compareSource: options.compareSource } : {}),
        });
  const client = await connectToDaemon({ host: options.host });
  try {
    const result = await client.getProviderDiagnostic(
      provider.trim().toLowerCase(),
      discovery ? { discovery } : undefined,
    );
    if (discovery && !result.discovery)
      throw new Error("Host did not return a discovery diagnostic.");
    return {
      type: "single",
      data: {
        provider: result.provider,
        diagnostic: result.diagnostic,
        ...(result.discovery ? { discovery: result.discovery } : {}),
      },
      schema: providerDiagnosticSchema,
    };
  } finally {
    await client.close();
  }
}
