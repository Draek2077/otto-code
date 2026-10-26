import { createHash } from "node:crypto";

export interface InstructionReference {
  start: number;
  end: number;
  target: string;
  kind: "import" | "reference";
}
/** One parser for the loader and graph. Fenced examples and inline code never load files. */
export function instructionReferences(text: string): InstructionReference[] {
  const references: InstructionReference[] = [];
  let fence: { character: string; length: number } | null = null;
  let offset = 0;
  for (const raw of text.split(/(?<=\n)/u)) {
    const line = raw.replace(/\r?\n$/u, "");
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/u);
    if (marker) {
      const token = marker[1]!;
      if (!fence) fence = { character: token[0]!, length: token.length };
      else if (token[0] === fence.character && token.length >= fence.length && !marker[2]!.trim())
        fence = null;
    } else if (!fence) {
      // Mask, rather than remove, inline code so source offsets remain exact UTF-16 indices.
      const prose = line.replace(/(`+)(.*?)\1/gu, (match) => " ".repeat(match.length));
      for (const match of prose.matchAll(
        /(?:^|\s)(@((?:\.{0,2}\/)?[\w./-]+\.md))(?=$|\s|[,;])/gu,
      )) {
        const start = offset + match.index! + match[0].length - match[1]!.length;
        references.push({
          start,
          end: start + match[1]!.length,
          target: match[2]!,
          kind: "import",
        });
      }
      for (const match of prose.matchAll(/(?<!!)\[[^\]\n]*\]\(([^\s()]+\.md)(?:#[^\s()]*)?\)/gu)) {
        if (/^[a-z][a-z0-9+.-]*:/iu.test(match[1]!)) continue;
        references.push({
          start: offset + match.index!,
          end: offset + match.index! + match[0].length,
          target: match[1]!,
          kind: "reference",
        });
      }
    }
    offset += raw.length;
  }
  return references.sort((a, b) => a.start - b.start);
}
export function instructionDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function renderInstructions(
  blocks: readonly { file: string; scope: string; text: string }[],
): string {
  if (!blocks.length) return "";
  return [
    "Current host and repository instructions follow. Deeper directory rules apply only within that directory and override broader rules. Current files take precedence over historical instruction copies in this conversation. Before using a shell or MCP tool to change files, inspect instructions in the affected subdirectories.",
    ...blocks.map(
      ({ file, scope, text }) =>
        `${JSON.stringify({ instructionFile: file, appliesWithin: scope })}\n${text}`,
    ),
  ].join("\n\n");
}
