import type { Command } from "commander";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import { connectArchitecturalViewsClient, type ArchitecturalViewCommandOptions } from "./shared.js";

interface DraftCreateOptions extends ArchitecturalViewCommandOptions {
  workspace?: string;
  title?: string;
  link?: string[];
  source?: string;
  quality?: "standard" | "showcase";
}

interface DraftOperationOptions extends ArchitecturalViewCommandOptions {
  workspace?: string;
}

interface DraftResult {
  id: string;
  viewId: string;
  updatedAt: string;
}
interface PublishResult {
  id: string;
  htmlPath: string;
  renderedAt: string;
}
interface DiscardResult {
  id: string;
  discarded: boolean;
}

const draftSchema: OutputSchema<DraftResult> = {
  idField: "id",
  columns: [
    { header: "DRAFT", field: "id", width: 24 },
    { header: "VIEW", field: "viewId", width: 24 },
    { header: "UPDATED", field: "updatedAt", width: 24 },
  ],
};
const publishSchema: OutputSchema<PublishResult> = {
  idField: "id",
  columns: [
    { header: "VIEW", field: "id", width: 24 },
    { header: "HTML", field: "htmlPath", width: 48 },
    { header: "PUBLISHED", field: "renderedAt", width: 24 },
  ],
};
const discardSchema: OutputSchema<DiscardResult> = {
  idField: "id",
  columns: [
    { header: "DRAFT", field: "id", width: 24 },
    { header: "DISCARDED", field: "discarded", width: 12 },
  ],
};

function required(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new Error(`${option} is required.`);
  return value.trim();
}

function links(values: string[] | undefined): Array<{ kind: "root" | "record"; id: string }> {
  const result = values ?? [];
  if (!result.length) throw new Error("At least one --link root:<id> or record:<id> is required.");
  return result.map((value) => {
    const [kind, ...parts] = value.split(":");
    const id = parts.join(":").trim();
    if ((kind !== "root" && kind !== "record") || !id)
      throw new Error(`Invalid Knowledge link "${value}".`);
    return { kind, id };
  });
}

export async function runDraftCreate(
  viewId: string,
  draftId: string,
  options: DraftCreateOptions,
  _command: Command,
): Promise<SingleResult<DraftResult>> {
  const client = await connectArchitecturalViewsClient(options.host);
  try {
    const result = await client.createArchitecturalViewDraft({
      workspaceId: required(options.workspace, "--workspace"),
      viewId,
      draftId,
      title: required(options.title, "--title"),
      knowledgeReferences: links(options.link),
      ...(options.source ? { sourcePath: options.source } : {}),
      ...(options.quality ? { quality: options.quality } : {}),
    });
    if (!result.success || !result.draft)
      throw new Error(result.error ?? "Could not create Architectural View draft.");
    return {
      type: "single",
      data: { id: result.draft.id, viewId: result.draft.viewId, updatedAt: result.draft.updatedAt },
      schema: draftSchema,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runDraftPublish(
  viewId: string,
  draftId: string,
  options: DraftOperationOptions,
  _command: Command,
): Promise<SingleResult<PublishResult>> {
  const client = await connectArchitecturalViewsClient(options.host);
  try {
    const result = await client.publishArchitecturalViewDraft({
      workspaceId: required(options.workspace, "--workspace"),
      viewId,
      draftId,
    });
    if (!result.success || !result.view)
      throw new Error(result.error ?? "Could not publish Architectural View draft.");
    return {
      type: "single",
      data: {
        id: result.view.id,
        htmlPath: result.view.htmlPath,
        renderedAt: result.view.renderedAt,
      },
      schema: publishSchema,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runDraftUpdate(
  viewId: string,
  draftId: string,
  options: DraftCreateOptions,
  _command: Command,
): Promise<SingleResult<DraftResult>> {
  const client = await connectArchitecturalViewsClient(options.host);
  try {
    const result = await client.updateArchitecturalViewDraft({
      workspaceId: required(options.workspace, "--workspace"),
      viewId,
      draftId,
      sourcePath: required(options.source, "--source"),
      ...(options.quality ? { quality: options.quality } : {}),
    });
    if (!result.success || !result.draft)
      throw new Error(result.error ?? "Could not update Architectural View draft.");
    return {
      type: "single",
      data: { id: result.draft.id, viewId: result.draft.viewId, updatedAt: result.draft.updatedAt },
      schema: draftSchema,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runDraftDiscard(
  viewId: string,
  draftId: string,
  options: DraftOperationOptions,
  _command: Command,
): Promise<SingleResult<DiscardResult>> {
  const client = await connectArchitecturalViewsClient(options.host);
  try {
    const result = await client.discardArchitecturalViewDraft({
      workspaceId: required(options.workspace, "--workspace"),
      viewId,
      draftId,
    });
    if (!result.success)
      throw new Error(result.error ?? "Could not discard Architectural View draft.");
    return { type: "single", data: { id: draftId, discarded: true }, schema: discardSchema };
  } finally {
    await client.close().catch(() => {});
  }
}
