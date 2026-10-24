/**
 * `otto brain scan` - list detected models with their arch, quant, size, native
 * context, vision, calibration state, and source. Returns a typed list the output
 * layer renders as a table (default), json, or yaml.
 */
import type { Command } from "commander";

import { loadBrainConfig, loadProfilesStore } from "../config/index.js";
import { scanModels } from "../models/index.js";
import { CommandError, type AnyCommandResult, type OutputSchema } from "../output/index.js";
import { withActivity } from "../service/activity.js";
import { z } from "zod/v3";
import { selectedBrainCommandHost } from "./target.js";
import { withCommandHost } from "./host-command.js";
import { projectScanRows, ScanReplySchema, type ScanRow } from "./scan-contract.js";
export type { ScanRow } from "./scan-contract.js";

export const scanSchema: OutputSchema<ScanRow> = {
  idField: "model",
  columns: [
    { header: "MODEL", field: "model", width: 40 },
    { header: "ARCH", field: "arch", width: 10 },
    { header: "QUANT", field: "quant", width: 8 },
    { header: "SIZE", field: "size", width: 9, align: "right" },
    { header: "CTX", field: "ctx", width: 9, align: "right" },
    { header: "VIS", field: "vision", width: 4 },
    {
      header: "CAL",
      field: "calibrated",
      width: 4,
      color: (v) => (v === "yes" ? "green" : undefined),
    },
    { header: "FEAT", field: "features", width: 10 },
    { header: "SOURCE", field: "source", width: 8 },
  ],
};

export async function runScanCommand(
  options: { metadata?: boolean },
  _command: Command,
): Promise<AnyCommandResult<ScanRow>> {
  const rows = selectedBrainCommandHost()
    ? await withCommandHost(async (port, signal) => {
        // COMPAT(brainScan): added in v0.10.0; remove after 2027-04-24 when floor >= v0.10.0.
        if (
          !z
            .object({ scan: z.literal(true) })
            .safeParse(await port.request("/__host/capabilities", signal)).success
        )
          throw new CommandError({
            code: "UPDATE_HOST",
            message: "Update the Brain owner to scan its model library.",
          });
        const query = new URLSearchParams({ metadata: String(options.metadata !== false) });
        return ScanReplySchema.parse(await port.request(`/__host/models/discover?${query}`, signal))
          .models;
      })
    : await scanLocal(options);
  return { type: "list", data: rows, schema: scanSchema };
}

async function scanLocal(options: { metadata?: boolean }): Promise<ScanRow[]> {
  const config = loadBrainConfig();
  const store = loadProfilesStore();
  // Announced because a metadata scan opens and reads the GGUF header of every
  // model on disk, which on a large library is seconds of I/O, not milliseconds.
  // Only the explicit `scan` command announces: the other commands call
  // `scanModels` too, and each announcing would fight over the one record.
  const catalog = await withActivity("scan", {}, async () =>
    scanModels(config, process.env, { withMetadata: options.metadata !== false }),
  );

  return projectScanRows(catalog, store, config);
}

export { addScanOptions } from "./options.js";
