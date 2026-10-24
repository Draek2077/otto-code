import path from "node:path";
import { z } from "zod";
import { digest, knowledgeKinds, parseKnowledgePage, type KnowledgeKind } from "./markdown-page.js";
import {
  convertLegacyJson,
  convertLegacyMarkdown,
  migratedSource,
  type LegacyConversion,
} from "./legacy-format.js";
import {
  KnowledgeConflictError,
  listKnowledgePayload,
  readKnowledgeBytes,
  replaceKnowledgeFile,
  withKnowledgeWrite,
  type KnowledgeReplacementPorts,
} from "./knowledge-files.js";
import { assertSafeSegment, type KnowledgeStore } from "./store-resolver.js";

const MARKER = "knowledge/.project-knowledge-json-migrated";
const MAX_BYTES = 67108864;
export interface KnowledgeFormatContext {
  store: KnowledgeStore;
  projectRevision: string;
}
export interface KnowledgeFormatApplication {
  context(): Promise<KnowledgeFormatContext>;
  expectedRevision: string;
  reason: string;
  now(): Date;
  replacement?: KnowledgeReplacementPorts;
}
interface SourceFile {
  label: string;
  file: string;
  store: KnowledgeStore;
  bytes: Buffer;
  revision: string;
}
interface Conversion {
  source: SourceFile;
  target: string;
  expectedRevision: string | null;
  value: LegacyConversion;
}
interface Plan {
  revision: string;
  context: KnowledgeFormatContext;
  sources: SourceFile[];
  conversions: Conversion[];
  json: SourceFile | null;
  indexPending: boolean;
  required: boolean;
}
export class KnowledgeFormatIncompleteError extends Error {
  constructor(cause: unknown) {
    super(
      "Format conversion did not finish cleanly. Verified recovery bytes are retained; reload and inspect before another explicit attempt. No automatic retry or rollback was performed.",
      { cause },
    );
  }
}
function normalized(file: string) {
  const resolved = path.resolve(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function repositoryStore(store: KnowledgeStore): KnowledgeStore {
  return {
    ...store,
    location: "repository",
    boundary: store.projectRoot,
    base: path.join(store.projectRoot, ".otto"),
  };
}
async function source({
  store,
  file,
  label,
}: {
  store: KnowledgeStore;
  file: string;
  label: string;
}): Promise<SourceFile | null> {
  const bytes = await readKnowledgeBytes(store, file);
  if (bytes === null) return null;
  if (bytes.length > 4194304) throw new Error("Knowledge conversion exceeds its safe file limit");
  return { label, file, store, bytes, revision: digest(bytes) };
}
async function sources(context: KnowledgeFormatContext): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  let total = 0;
  const add = (file: SourceFile | null) => {
    if (file) {
      total += file.bytes.length;
      if (total > MAX_BYTES) throw new Error("Knowledge conversion exceeds its safe size limit");
      files.push(file);
    }
  };
  for (const file of await listKnowledgePayload(context.store))
    add(
      await source({
        store: context.store,
        file,
        label: `store/${path.relative(context.store.base, file).split(path.sep).join("/")}`,
      }),
    );
  const repo = repositoryStore(context.store);
  add(
    await source({
      store: repo,
      file: path.join(repo.base, "project-knowledge.json"),
      label: "repository/project-knowledge.json",
    }),
  );
  return files.sort((a, b) => a.label.localeCompare(b.label));
}
function pageTarget({
  store,
  value,
}: {
  store: KnowledgeStore;
  value: Pick<LegacyConversion, "id" | "kind">;
}) {
  assertSafeSegment(value.id);
  return path.join(store.base, "knowledge", knowledgeKinds[value.kind], `${value.id}.md`);
}
function markdownConversions({
  context,
  files,
}: {
  context: KnowledgeFormatContext;
  files: SourceFile[];
}) {
  const conversions: Conversion[] = [];
  const known = new Map<string, { file: SourceFile; kind: KnowledgeKind }>();
  for (const file of files) {
    const segments = file.label.split("/");
    if (segments[0] !== "store" || segments[1] !== "knowledge" || !file.file.endsWith(".md"))
      continue;
    const kind = (Object.keys(knowledgeKinds) as KnowledgeKind[]).find(
      (key) => knowledgeKinds[key] === segments[2],
    );
    if (!kind) continue;
    if (segments.length !== 4) throw new Error("Unsupported nested Knowledge page");
    let value: Pick<LegacyConversion, "id" | "kind">;
    const raw = file.bytes.toString("utf8");
    try {
      value = parseKnowledgePage(raw).metadata;
    } catch {
      const converted = convertLegacyMarkdown(raw);
      value = converted;
      conversions.push({
        source: file,
        target: file.file,
        expectedRevision: file.revision,
        value: converted,
      });
    }
    assertSafeSegment(value.id);
    if (
      value.kind !== kind ||
      normalized(file.file) !== normalized(pageTarget({ store: context.store, value }))
    )
      throw new Error("Legacy identity does not match its canonical path");
    if (known.has(value.id)) throw new Error("Duplicate Knowledge identity");
    known.set(value.id, { file, kind });
  }
  return { conversions, known };
}
function pendingJson({
  context,
  files,
  known,
}: {
  context: KnowledgeFormatContext;
  files: SourceFile[];
  known: ReturnType<typeof markdownConversions>["known"];
}): { json: SourceFile | null; conversions: Conversion[] } {
  const json = files.find((file) => file.label === "repository/project-knowledge.json") ?? null;
  const receipt = files.find((file) => file.label === `store/${MARKER}`);
  if (receipt) {
    const raw = receipt.bytes.toString("utf8").trim();
    // COMPAT(knowledgeJsonReceipt): added v0.10.0; retain frozen 0.9 completion markers until 2027-04-24.
    if (raw === "Legacy JSON migration completed. Do not re-import.")
      return { json: null, conversions: [] };
    const value = z
      .object({
        version: z.literal(1),
        sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
        completedAt: z.string().datetime(),
        reason: z.string().min(1),
      })
      .passthrough()
      .parse(JSON.parse(raw));
    if (json && value.sourceRevision !== json.revision) throw new KnowledgeConflictError();
    return { json: null, conversions: [] };
  }
  if (!json) return { json: null, conversions: [] };
  const conversions: Conversion[] = [];
  for (const value of convertLegacyJson(json.bytes.toString("utf8"))) {
    const existing = known.get(value.id);
    if (existing) {
      const origin = migratedSource(existing.file.bytes.toString("utf8"));
      if (
        existing.kind !== value.kind ||
        origin?.format !== "otto-json-v1" ||
        origin.revision !== json.revision ||
        origin.id !== value.id
      )
        throw new KnowledgeConflictError();
      continue;
    }
    conversions.push({
      source: json,
      target: pageTarget({ store: context.store, value }),
      expectedRevision: null,
      value,
    });
  }
  return { json, conversions };
}
async function plan(context: KnowledgeFormatContext): Promise<Plan> {
  const files = await sources(context);
  const markdown = markdownConversions({ context, files });
  const json = pendingJson({ context, files, known: markdown.known });
  const conversions = [...markdown.conversions, ...json.conversions];
  const hasIndex = files.some((file) => file.label === "store/knowledge/index.md");
  const indexPending =
    !hasIndex &&
    (conversions.length > 0 ||
      json.json !== null ||
      [...markdown.known.values()].some(
        ({ file }) => migratedSource(file.bytes.toString("utf8")) !== null,
      ));
  const additions = json.conversions.length + (json.json ? 1 : 0) + (indexPending ? 1 : 0);
  if (files.filter((file) => file.label.startsWith("store/")).length + additions > 10000)
    throw new Error("Converted Knowledge would exceed the file limit");
  const revision = digest(
    JSON.stringify({
      projectRevision: context.projectRevision,
      base: context.store.base,
      files: files.map(({ label, revision: hash }) => [label, hash]),
    }),
  );
  return {
    revision,
    context,
    sources: files,
    conversions,
    json: json.json,
    indexPending,
    required: conversions.length > 0 || json.json !== null || indexPending,
  };
}
function recoveryBase(value: Plan) {
  return path.join(value.context.store.base, "knowledge-recovery", value.revision);
}
function publicPlan(value: Plan) {
  return {
    revision: value.revision,
    required: value.required,
    count: value.conversions.length,
    omitted: Math.max(0, value.conversions.length - 100),
    recoveryPath: recoveryBase(value),
    changes: value.conversions.slice(0, 100).map((item) => ({
      id: item.value.id,
      kind: item.value.kind,
      title: item.value.title,
      source: item.source.label,
      action:
        item.expectedRevision === null ? ("import-json" as const) : ("convert-markdown" as const),
    })),
  };
}
export async function inspectKnowledgeFormat(context: KnowledgeFormatContext) {
  return publicPlan(await plan(context));
}
async function verify(file: SourceFile) {
  const current = await readKnowledgeBytes(file.store, file.file);
  if (current === null || digest(current) !== file.revision) throw new KnowledgeConflictError();
}
async function backups({
  value,
  replacement,
}: {
  value: Plan;
  replacement?: KnowledgeReplacementPorts;
}) {
  const files = new Map(value.conversions.map((item) => [item.source.label, item.source]));
  if (value.json) files.set(value.json.label, value.json);
  for (const file of files.values()) {
    const target = path.join(recoveryBase(value), file.label);
    const existing = await readKnowledgeBytes(value.context.store, target);
    if (existing !== null && digest(existing) !== file.revision) throw new KnowledgeConflictError();
    if (existing === null)
      await replaceKnowledgeFile({
        store: value.context.store,
        file: target,
        body: file.bytes,
        expectedRevision: null,
        replacement,
      });
    if (digest((await readKnowledgeBytes(value.context.store, target)) ?? "") !== file.revision)
      throw new KnowledgeConflictError();
  }
}
function prepareWrites({ value, now, reason }: { value: Plan; now: string; reason: string }) {
  const replaced = new Set(value.conversions.map((item) => item.target));
  let total = value.sources
    .filter((file) => file.label.startsWith("store/") && !replaced.has(file.file))
    .reduce((sum, file) => sum + file.bytes.length, 0);
  const account = (body: string) => {
    const bytes = Buffer.byteLength(body);
    total += bytes;
    if (bytes > 4194304 || total > MAX_BYTES)
      throw new Error("Converted Knowledge exceeds its safe output limit");
    return body;
  };
  const records = value.conversions.map((item) => ({
    ...item,
    body: account(
      item.value.render({
        now,
        reason: `${reason}\nRecovery bytes: knowledge-recovery/${value.revision}/${item.source.label}`,
      }),
    ),
  }));
  const indexBody = value.indexPending
    ? account(
        "# Project knowledge index\n\nConverted explicitly by Otto. Discover current records and project roots through the project Knowledge tools.\n",
      )
    : null;
  const receiptBody = value.json
    ? account(
        JSON.stringify({
          version: 1,
          sourceRevision: value.json.revision,
          completedAt: now,
          reason,
        }) + "\n",
      )
    : null;
  return { records, indexBody, receiptBody };
}
/** An explicit digest-pinned conversion. Read/preview never writes. Original JSON
 * stays intact; older Markdown has a verified byte recovery copy before change.
 * Partial writes are recoverable, not a multi-file transaction or silent retry. */
export async function applyKnowledgeFormat(input: KnowledgeFormatApplication) {
  if (!input.reason.trim()) throw new Error("A conversion reason is required");
  const initial = await input.context();
  const run = async () => {
    const context = await input.context();
    if (
      context.projectRevision !== initial.projectRevision ||
      normalized(context.store.base) !== normalized(initial.store.base)
    )
      throw new KnowledgeConflictError();
    const current = await plan(context);
    if (current.revision !== input.expectedRevision) throw new KnowledgeConflictError();
    if (!current.required) return { converted: 0, recoveryPath: recoveryBase(current) };
    const now = input.now().toISOString();
    const prepared = prepareWrites({ value: current, now, reason: input.reason.trim() });
    await backups({ value: current, replacement: input.replacement });
    for (const file of current.sources) await verify(file);
    try {
      for (const item of prepared.records) {
        await verify(item.source);
        await replaceKnowledgeFile({
          store: context.store,
          file: item.target,
          expectedRevision: item.expectedRevision,
          body: item.body,
          replacement: input.replacement,
        });
      }
      const index = path.join(context.store.base, "knowledge/index.md");
      if (prepared.indexBody !== null && (await readKnowledgeBytes(context.store, index)) === null)
        await replaceKnowledgeFile({
          store: context.store,
          file: index,
          expectedRevision: null,
          body: prepared.indexBody,
          replacement: input.replacement,
        });
      if (current.json && prepared.receiptBody !== null) {
        await verify(current.json);
        await replaceKnowledgeFile({
          store: context.store,
          file: path.join(context.store.base, MARKER),
          expectedRevision: null,
          body: prepared.receiptBody,
          replacement: input.replacement,
        });
      }
    } catch (error) {
      throw new KnowledgeFormatIncompleteError(error);
    }
    return { converted: current.conversions.length, recoveryPath: recoveryBase(current) };
  };
  // JSON is a read-only import source. Do not create a repository Knowledge
  // directory just to lock it: that would change host-default resolution.
  return withKnowledgeWrite(initial.store, run);
}
