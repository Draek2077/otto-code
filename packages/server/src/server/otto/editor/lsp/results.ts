import { z } from "zod";
import type { EditorQueryResult } from "@getpaseo/plugin/otto/editor";
import { EditorError } from "../errors.js";
import { Completion, Definition, Hover, Location, Symbol } from "./schema.js";
import { uriPath } from "./uri.js";

export function emptyResult(action: EditorQueryResult["action"]): EditorQueryResult {
  return {
    action,
    state: "ready",
    message: null,
    locations: [],
    hover: null,
    completions: [],
    symbols: [],
  };
}
export function definitionLocations(value: unknown): EditorQueryResult["locations"] {
  const result = Definition.parse(value);
  if (!result) return [];
  const items = Array.isArray(result) ? result : [result];
  return items.slice(0, 10000).map((item) => {
    if ("targetUri" in item)
      return { file: uriPath(item.targetUri), range: item.targetSelectionRange };
    return { file: uriPath(item.uri), range: item.range };
  });
}
export function referenceLocations(value: unknown): EditorQueryResult["locations"] {
  const result = z.array(Location).nullable().parse(value) ?? [];
  return result.slice(0, 10000).map((item) => ({ file: uriPath(item.uri), range: item.range }));
}
export function hoverText(value: unknown): string | null {
  const hover = Hover.parse(value);
  if (!hover) return null;
  const contents = hover.contents;
  const items = Array.isArray(contents) ? contents : [contents];
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      if ("language" in item) return `\`\`\`${item.language}\n${item.value}\n\`\`\``;
      return item.value;
    })
    .join("\n\n");
}
export function completions(value: unknown): EditorQueryResult["completions"] {
  const result = Completion.parse(value);
  if (!result) return [];
  const items = Array.isArray(result) ? result : result.items;
  return items.slice(0, 10000).map((item) => {
    const documentation =
      typeof item.documentation === "string"
        ? item.documentation
        : (item.documentation?.value ?? "");
    const edit = item.textEdit ? { range: item.textEdit.range, text: item.textEdit.newText } : null;
    const additionalEdits = (item.additionalTextEdits ?? []).map((entry) => ({
      range: entry.range,
      text: entry.newText,
    }));
    return {
      label: item.label,
      detail: item.detail ?? "",
      documentation,
      insertText: item.insertText ?? item.label,
      kind: item.kind ?? null,
      sortText: item.sortText ?? item.label,
      filterText: item.filterText ?? item.label,
      edit,
      additionalEdits,
    };
  });
}
export function symbols(value: unknown): EditorQueryResult["symbols"] {
  const result: EditorQueryResult["symbols"] = [];
  const pending = (z.array(z.unknown()).nullable().parse(value) ?? []).map((item) => ({
    item,
    depth: 0,
  }));
  while (pending.length && result.length < 10000) {
    const entry = pending.shift();
    if (!entry) break;
    if (entry.depth > 32)
      throw new EditorError("invalid", "Language server returned an excessively deep outline.");
    const item = Symbol.parse(entry.item);
    const range = item.selectionRange ?? item.range ?? item.location?.range;
    if (!range)
      throw new EditorError(
        "invalid",
        "Language server returned a symbol without its source range.",
      );
    result.push({
      name: item.name,
      detail: item.detail ?? "",
      kind: item.kind,
      range,
      depth: entry.depth,
    });
    if (item.children)
      pending.unshift(...item.children.map((child) => ({ item: child, depth: entry.depth + 1 })));
  }
  return result;
}
