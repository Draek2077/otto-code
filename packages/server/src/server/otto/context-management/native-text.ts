import { parseDocument } from "yaml";
import path from "node:path";
import { claudeInstructionText } from "./native-comments.js";
import {
  instructionReferences,
  type InstructionReference,
} from "@getpaseo/plugin/server/otto-openai";

/** Claude imports allow non-Markdown files and escaped spaces. They do not change Otto's own loader. */
export function nativeReferences(text: string, imports: boolean): InstructionReference[] {
  if (imports) text = claudeInstructionText(text, true);
  const result = instructionReferences(text).filter((entry) => entry.kind === "reference");
  if (!imports) return result;
  let fence: { token: string; length: number } | null = null;
  let offset = 0;
  for (const raw of text.split(/(?<=\n)/u)) {
    const line = raw.replace(/\r?\n$/u, "");
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/u);
    if (marker) {
      const token = marker[1]!;
      if (!fence) fence = { token: token[0]!, length: token.length };
      else if (token[0] === fence.token && token.length >= fence.length && !marker[2]!.trim())
        fence = null;
    } else if (!fence) {
      const prose = line.replace(/(`+)(.*?)\1/gu, (match) => " ".repeat(match.length));
      for (const match of prose.matchAll(/(?:^|\s)(@((?:\\ |[^\s,;`])+))(?=$|\s|[,;])/gu)) {
        const target = match[2]!.replace(/\\ /gu, " ");
        // An address or mention is not a local instruction import.
        if (
          !/[./\\]/u.test(target) ||
          (/^[a-z][a-z0-9+.-]*:/iu.test(target) && !path.isAbsolute(target))
        )
          continue;
        const start = offset + match.index! + match[0].length - match[1]!.length;
        result.push({ start, end: start + match[1]!.length, target, kind: "import" });
      }
    }
    offset += raw.length;
  }
  return result.sort((a, b) => a.start - b.start);
}

export function ruleMetadata(text: string): { contextStart: number; conditional: boolean } | null {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return { contextStart: 0, conditional: false };
  if (match[1]!.length > 8192) return null;
  try {
    const document = parseDocument(match[1]!, { uniqueKeys: true });
    if (document.errors.length) return null;
    const value: unknown = document.toJS({ maxAliasCount: 10 });
    if (!value || typeof value !== "object" || !("paths" in value))
      return { contextStart: match[0].length, conditional: false };
    if (!Array.isArray(value.paths) || !value.paths.every((entry) => typeof entry === "string"))
      return null;
    return { contextStart: match[0].length, conditional: value.paths.length > 0 };
  } catch {
    return null;
  }
}

export function memoryIndexHead(text: string): string {
  const lines = text
    .split(/(?<=\n)/u)
    .slice(0, 200)
    .join("");
  let bytes = Buffer.from(lines, "utf8").subarray(0, 25000);
  // A byte cap must not invent replacement characters inside a UTF-8 code point.
  while (!Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)) bytes = bytes.subarray(0, -1);
  return bytes.toString("utf8");
}
export function rosterDescriptor(
  text: string,
  fallbackName?: string,
  provider?: "claude" | "codex" | "opencode",
): { name: string; description: string; advertised: boolean } | null {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match || match[1]!.length > 8192) return null;
  try {
    const document = parseDocument(match[1]!, { uniqueKeys: true });
    if (document.errors.length) return null;
    const value: unknown = document.toJS({ maxAliasCount: 10 });
    if (!value || typeof value !== "object" || !("description" in value)) return null;
    const name = "name" in value ? value.name : fallbackName;
    if (
      typeof name !== "string" ||
      typeof value.description !== "string" ||
      !name.trim() ||
      !value.description.trim()
    )
      return null;
    return {
      name: name.slice(0, 256),
      description: value.description.slice(0, 8192),
      advertised: descriptorAdvertised(value, provider),
    };
  } catch {
    return null;
  }
}
function descriptorAdvertised(
  value: object,
  provider: "claude" | "codex" | "opencode" | undefined,
): boolean {
  if (
    provider === "opencode" &&
    "metadata" in value &&
    value.metadata &&
    typeof value.metadata === "object" &&
    "opencode/autoinvoke" in value.metadata &&
    typeof value.metadata["opencode/autoinvoke"] === "boolean"
  )
    return value.metadata["opencode/autoinvoke"];
  return !("disable-model-invocation" in value && value["disable-model-invocation"] === true);
}
