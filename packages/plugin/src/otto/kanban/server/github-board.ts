import { z } from "zod";
import { failure, type Board, type ProjectBinding, type Result } from "../shared/model.js";
import { readFieldsDocument, readItemsDocument } from "./github-documents.js";

const PageSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const FieldSchema = z.object({
  __typename: z.string(),
  id: z.string(),
  name: z.string(),
  options: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});
const HeaderSchema = z.object({
  __typename: z.literal("ProjectV2"),
  id: z.string(),
  updatedAt: z.string(),
});
const FieldsSchema = HeaderSchema.extend({
  title: z.string(),
  url: z.string(),
  fields: z.object({ nodes: z.array(FieldSchema).max(100), pageInfo: PageSchema }),
});
const contentFields = {
  title: z.string(),
  body: z.string(),
  assignees: z.object({
    nodes: z.array(z.object({ login: z.string() })).max(100),
    pageInfo: PageSchema,
  }),
};
const ContentSchema = z.discriminatedUnion("__typename", [
  z.object({ __typename: z.literal("DraftIssue"), ...contentFields }),
  z.object({ __typename: z.literal("Issue"), ...contentFields, url: z.string() }),
  z.object({ __typename: z.literal("PullRequest"), ...contentFields, url: z.string() }),
]);
const ItemSchema = z.object({
  id: z.string(),
  isArchived: z.boolean(),
  content: ContentSchema.nullable(),
  fieldValueByName: z
    .object({
      __typename: z.string(),
      optionId: z.string().nullable().optional(),
      field: z.object({ id: z.string().min(1) }).optional(),
    })
    .nullable(),
});
const ItemsSchema = HeaderSchema.extend({
  items: z.object({ nodes: z.array(ItemSchema).max(100), pageInfo: PageSchema }),
});

type Field = z.infer<typeof FieldSchema>;
type Item = z.infer<typeof ItemSchema>;
type PageInfo = z.infer<typeof PageSchema>;
type BoardHeader = Pick<z.infer<typeof FieldsSchema>, "id" | "title" | "url" | "updatedAt">;
export type GitHubQuery = (
  binding: ProjectBinding,
  document: string,
  variables: Record<string, string | number | null>,
) => Promise<Result<unknown>>;

interface Page<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

interface BoardLayout {
  status: Field | undefined;
  columns: Board["columns"];
  columnIds: Set<string>;
}

export const UNASSIGNED_COLUMN = "otto:unassigned";

export function invalidResponse(): Result<never> {
  return failure(
    "invalid_response",
    "GitHub returned an incomplete or unsupported board response.",
  );
}

function nextCursor(page: PageInfo, seen: Set<string>): Result<string | null> {
  if (!page.hasNextPage) return { ok: true, value: null };
  if (!page.endCursor || seen.has(page.endCursor)) return invalidResponse();
  seen.add(page.endCursor);
  return { ok: true, value: page.endCursor };
}

async function collectPages<T extends { id: string }>(input: {
  load(cursor: string | null): Promise<Result<Page<T>>>;
  limit: number;
  limitMessage: string;
}): Promise<Result<T[]>> {
  const rows: T[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const response = await input.load(cursor);
    if (!response.ok) return response;
    const page = response.value;
    if (page.pageInfo.hasNextPage && !page.nodes.length) return invalidResponse();
    for (const row of page.nodes) {
      if (ids.has(row.id)) return invalidResponse();
      ids.add(row.id);
      rows.push(row);
    }
    const next = nextCursor(page.pageInfo, cursors);
    if (!next.ok) return next;
    cursor = next.value;
    if (rows.length > input.limit || (rows.length >= input.limit && cursor)) {
      return failure("read_limit", input.limitMessage);
    }
  } while (cursor);
  return { ok: true, value: rows };
}

async function readFields(input: {
  query: GitHubQuery;
  binding: ProjectBinding;
  id: string;
}): Promise<Result<{ header: BoardHeader; fields: Field[] }>> {
  let header: BoardHeader | undefined;
  const fields = await collectPages<Field>({
    limit: 500,
    limitMessage: "This board exceeds Otto's 500-field read limit.",
    async load(cursor) {
      const response = await input.query(input.binding, readFieldsDocument, {
        id: input.id,
        cursor,
      });
      if (!response.ok) return response;
      const parsed = z.object({ node: FieldsSchema.nullable() }).safeParse(response.value);
      if (!parsed.success) return invalidResponse();
      const node = parsed.data.node;
      if (!node)
        return failure("not_found", "The configured GitHub board is missing or inaccessible.");
      if (node.id !== input.id) return invalidResponse();
      if (header && header.updatedAt !== node.updatedAt) {
        return failure("unavailable", "The board changed during the read. Refresh it.");
      }
      header = node;
      return { ok: true, value: node.fields };
    },
  });
  if (!fields.ok) return fields;
  if (!header) return invalidResponse();
  return { ok: true, value: { header, fields: fields.value } };
}

function readLayout(fields: Field[]): Result<BoardLayout> {
  const statusFields = fields.filter(
    (field) =>
      field.__typename === "ProjectV2SingleSelectField" && field.name.toLowerCase() === "status",
  );
  const candidates = statusFields.length
    ? statusFields
    : fields.filter(
        (field) =>
          field.__typename === "ProjectV2SingleSelectField" && field.name.toLowerCase() === "state",
      );
  if (candidates.length > 1)
    return failure("unsupported", "Choose a board with one Status or State field.");
  const status = candidates[0];
  if (status && !status.options) return invalidResponse();
  const columns = (status?.options ?? []).map((option) => ({ id: option.id, title: option.name }));
  columns.push({ id: UNASSIGNED_COLUMN, title: "Unassigned" });
  const columnIds = new Set(columns.map((column) => column.id));
  if (columnIds.size !== columns.length) return invalidResponse();
  return { ok: true, value: { status, columns, columnIds } };
}

function cardColumn(item: Item, layout: BoardLayout): Result<string> {
  const value = item.fieldValueByName;
  if (!layout.status || !value) return { ok: true, value: UNASSIGNED_COLUMN };
  if (
    value.__typename !== "ProjectV2ItemFieldSingleSelectValue" ||
    value.field?.id !== layout.status.id
  )
    return invalidResponse();
  const columnId = value.optionId ?? UNASSIGNED_COLUMN;
  return layout.columnIds.has(columnId) ? { ok: true, value: columnId } : invalidResponse();
}

function projectCard(item: Item, layout: BoardLayout): Result<Board["cards"][number]> {
  const content = item.content;
  if (content?.assignees.pageInfo.hasNextPage)
    return failure("read_limit", "A card exceeds Otto's 100-assignee read limit.");
  const column = cardColumn(item, layout);
  if (!column.ok) return column;
  return {
    ok: true,
    value: {
      id: item.id,
      title: content?.title ?? "Unavailable item",
      description: content?.body ?? "",
      url: content && "url" in content ? content.url : null,
      kind: content?.__typename ?? "unavailable",
      columnId: column.value,
      archived: item.isArchived,
      assignees: content?.assignees.nodes.map((person) => person.login) ?? [],
    },
  };
}

function projectCards(items: Item[], layout: BoardLayout): Result<Board["cards"]> {
  const cards: Board["cards"] = [];
  for (const item of items) {
    const card = projectCard(item, layout);
    if (!card.ok) return card;
    cards.push(card.value);
  }
  return { ok: true, value: cards };
}

async function readCards(input: {
  query: GitHubQuery;
  binding: ProjectBinding;
  header: BoardHeader;
  layout: BoardLayout;
}): Promise<Result<Board["cards"]>> {
  return collectPages<Board["cards"][number]>({
    limit: 2000,
    limitMessage: "This board exceeds Otto's 2,000-item read limit.",
    async load(cursor) {
      const response = await input.query(input.binding, readItemsDocument, {
        id: input.header.id,
        cursor,
        statusName: input.layout.status?.name ?? "Status",
      });
      if (!response.ok) return response;
      const parsed = z.object({ node: ItemsSchema.nullable() }).safeParse(response.value);
      if (!parsed.success) return invalidResponse();
      const node = parsed.data.node;
      if (!node)
        return failure("not_found", "The configured GitHub board is missing or inaccessible.");
      if (node.id !== input.header.id) return invalidResponse();
      if (node.updatedAt !== input.header.updatedAt) {
        return failure("unavailable", "The board changed during the read. Refresh it.");
      }
      const cards = projectCards(node.items.nodes, input.layout);
      if (!cards.ok) return cards;
      return { ok: true, value: { nodes: cards.value, pageInfo: node.items.pageInfo } };
    },
  });
}

export async function readGitHubBoard(input: {
  query: GitHubQuery;
  binding: ProjectBinding;
  id: string;
}): Promise<Result<Board>> {
  const fields = await readFields(input);
  if (!fields.ok) return fields;
  const { header } = fields.value;
  const layout = readLayout(fields.value.fields);
  if (!layout.ok) return layout;
  const cards = await readCards({
    query: input.query,
    binding: input.binding,
    header,
    layout: layout.value,
  });
  if (!cards.ok) return cards;
  return {
    ok: true,
    value: {
      provider: "github",
      id: header.id,
      title: header.title,
      url: header.url,
      revision: header.updatedAt,
      capabilities: {
        read: true,
        create: false,
        link: false,
        move: false,
        edit: false,
        remove: false,
      },
      columns: layout.value.columns,
      cards: cards.value,
    },
  };
}
