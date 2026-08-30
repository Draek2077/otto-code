import type { Command } from "commander";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import { connectArchitecturalViewsClient, type ArchitecturalViewCommandOptions } from "./shared.js";

interface DeliverArchitecturalViewOptions extends ArchitecturalViewCommandOptions {
  workspace?: string;
  source?: string;
  title?: string;
  link?: string[];
  quality?: "standard" | "showcase";
}

interface DeliveredArchitecturalViewResult {
  id: string;
  location: "repository" | "host" | null;
  htmlPath: string | null;
}

const deliveredArchitecturalViewSchema: OutputSchema<DeliveredArchitecturalViewResult> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 24 },
    { header: "STORED", field: "location", width: 14 },
    { header: "HTML", field: "htmlPath", width: 48 },
  ],
};

function requiredOption(value: string | undefined, option: string): string {
  const trimmed = value?.trim();
  if (!trimmed)
    throw { code: "MISSING_ARCHITECTURAL_VIEW_OPTION", message: `${option} is required.` };
  return trimmed;
}

function parseKnowledgeReferences(
  values: string[] | undefined,
): Array<{ kind: "root" | "record"; id: string }> {
  const references = values ?? [];
  if (references.length === 0) {
    throw {
      code: "MISSING_ARCHITECTURAL_VIEW_LINK",
      message: "At least one --link root:<id> or record:<id> is required.",
    };
  }
  return references.map((value) => {
    const separator = value.indexOf(":");
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1).trim();
    if ((kind !== "root" && kind !== "record") || !id) {
      throw {
        code: "INVALID_ARCHITECTURAL_VIEW_LINK",
        message: `Invalid Knowledge link "${value}". Use root:<id> or record:<id>.`,
      };
    }
    return { kind, id };
  });
}

export async function runDeliverArchitecturalViewCommand(
  viewId: string,
  options: DeliverArchitecturalViewOptions,
  _command: Command,
): Promise<SingleResult<DeliveredArchitecturalViewResult>> {
  const client = await connectArchitecturalViewsClient(options.host);
  try {
    const payload = await client.deliverArchitecturalView({
      workspaceId: requiredOption(options.workspace, "--workspace"),
      viewId: requiredOption(viewId, "Architectural View ID"),
      title: requiredOption(options.title, "--title"),
      sourcePath: requiredOption(options.source, "--source"),
      knowledgeReferences: parseKnowledgeReferences(options.link),
      ...(options.quality ? { quality: options.quality } : {}),
    });
    if (!payload.success) throw new Error(payload.error ?? "Architectural View delivery failed.");
    return {
      type: "single",
      data: { id: payload.viewId, location: payload.storeLocation, htmlPath: payload.htmlPath },
      schema: deliveredArchitecturalViewSchema,
    };
  } finally {
    await client.close().catch(() => {});
  }
}
