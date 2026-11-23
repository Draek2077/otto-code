import type {
  WorkflowLaunch,
  WorkflowScope,
  WorkflowTemplateSnapshot,
  PromptTemplate,
} from "@getpaseo/plugin/otto/workflows";
import { WorkflowLibrary } from "./library.js";
import { WorkflowError, assertWorkflowId } from "./files.js";
import { validateDataTemplate } from "./templates.js";
import { renderReviewedEjs } from "./template-worker.js";
import type { WorkflowStore } from "./stores.js";

/** Capture exact project/legacy origins before review. Execution never follows a mutable template pointer. */
export async function captureWorkflowTemplates(
  library: WorkflowLibrary,
  scope: WorkflowScope,
  launch: WorkflowLaunch,
): Promise<WorkflowLaunch> {
  if (launch.kind !== "graph") return structuredClone(launch);
  const pending = launch.graph.nodes.flatMap((node) =>
    node.promptTemplate ? [node.promptTemplate.templateId] : [],
  );
  const snapshots = await captureWorkflowTemplateClosure(
    library,
    scope,
    pending,
    launch.allowTemplateCode === true,
  );
  return { ...launch, templateSnapshots: snapshots };
}
export async function captureWorkflowTemplateClosure(
  library: WorkflowLibrary,
  scope: WorkflowScope,
  roots: string[],
  allowCode: boolean,
  override?: PromptTemplate,
): Promise<WorkflowTemplateSnapshot[]> {
  const stores = await library.ports.stores.locations(scope);
  const legacy = library.ports.stores.legacy(scope, stores[0].project, "template");
  if (legacy) stores.push(legacy);
  const pending = [...roots];
  const snapshots: WorkflowTemplateSnapshot[] = [];
  const seen = new Set<string>();
  let bytes = 0,
    cursor = 0;
  while (cursor < pending.length) {
    const id = pending[cursor++];
    if (seen.has(id)) continue;
    seen.add(id);
    assertWorkflowId(id);
    if (seen.size > 64)
      throw new WorkflowError(
        "invalid",
        "A Workflow may snapshot at most 64 prompt templates/snippets.",
      );
    const snapshot = await resolveTemplateSnapshot(library, stores, id, override);
    const template = snapshot.template;
    bytes += Buffer.byteLength(JSON.stringify(template));
    if (bytes > 1024 * 1024)
      throw new WorkflowError("invalid", "Workflow template snapshots exceed one MiB.");
    snapshots.push(snapshot);
    pending.push(...(template.includes ?? []));
    for (const match of template.content.matchAll(/\binclude\s*\(\s*['"]([A-Za-z0-9_.-]+)['"]/g))
      pending.push(match[1]);
  }
  validateLiteralIncludes(snapshots.map((snapshot) => snapshot.template));
  if (snapshots.length && allowCode)
    await renderReviewedEjs(
      snapshots[0].template.id,
      snapshots.map((snapshot) => snapshot.template),
      {},
      AbortSignal.timeout(1500),
      true,
    );
  else for (const snapshot of snapshots) validateDataTemplate(snapshot.template);
  return snapshots;
}
async function resolveTemplateSnapshot(
  library: WorkflowLibrary,
  stores: WorkflowStore[],
  id: string,
  override?: PromptTemplate,
): Promise<WorkflowTemplateSnapshot> {
  // An explicit preview root is transient data, never a persisted source or a launch snapshot.
  if (override?.id === id)
    return {
      ref: { scope: stores[0].scope, kind: "template", id, location: "repository" },
      revision: "preview-draft",
      template: structuredClone(override),
    };
  const found = [];
  for (const store of stores) {
    const item = await library.readAt(store, "template", id);
    if (item) found.push(item);
  }
  // COMPAT(otto09GlobalTemplates): added v0.10.0; remove after 2027-05-05 following explicit project copies. A unique project-owned template shadows its retained global original.
  const projectOwned = found.filter((item) => item.store.location !== "legacy"),
    selected = projectOwned.length ? projectOwned : found;
  if (selected.length !== 1)
    throw new WorkflowError(
      "conflict",
      `Prompt template ${id} is missing or has multiple origins. Resolve its library identity before launch.`,
    );
  const entry = selected[0].entry;
  if (entry.document.kind !== "template")
    throw new WorkflowError("invalid", "Template snapshot refers to another document kind.");
  return { ref: entry.ref, revision: entry.revision, template: entry.document.value };
}
function validateLiteralIncludes(templates: PromptTemplate[]) {
  const graph = new Map(
    templates.map((template) => [
      template.id,
      [...template.content.matchAll(/\binclude\s*\(\s*['"]([A-Za-z0-9_.-]+)['"]/g)].map(
        (match) => match[1],
      ),
    ]),
  );
  const depths = new Map<string, number>();
  const walk = (id: string, path: string[]): number => {
    if (path.includes(id))
      throw new WorkflowError("invalid", `Template include cycle: ${[...path, id].join(" → ")}`);
    if (path.length > 5)
      throw new WorkflowError("invalid", "Template includes exceed five levels.");
    const known = depths.get(id);
    if (known !== undefined) return known;
    let depth = 1;
    for (const child of graph.get(id) ?? [])
      depth = Math.max(depth, 1 + walk(child, [...path, id]));
    if (depth > 6) throw new WorkflowError("invalid", "Template includes exceed five levels.");
    depths.set(id, depth);
    return depth;
  };
  for (const id of graph.keys()) walk(id, []);
}
