// Mermaid can fetch external resources while *rendering* — image shapes
// (`A@{ img: "url" }`) construct an Image and await decode before any output
// sanitization runs, and CSS can pull url()/@import — so a prompt-injected
// diagram could exfiltrate data in a request URL. securityLevel "strict" does
// not prevent this (mermaid-js/mermaid#7645).
//
// Shape data is also how Mermaid exposes its modern diagram templates, though.
// Rejecting every `@{ ... }` made safe shapes, labels, dimensions, and collapsed
// groups silently fall back to source. Accept the ordinary flat mapping form and
// reject only resource-bearing properties. YAML aliases, anchors, tags, flow
// collections, and complex keys stay out: Mermaid accepts them, but they make a
// property-level policy ambiguous and are not needed for documentation templates.
// Formatting-only `<br>` and `<i>` tags are common in generated labels and carry
// no resource-bearing attributes; all other tags (and entity-encoded text that
// could smuggle one) are rejected.
const UNSAFE_MERMAID_SOURCE = /url\s*\(|@import\b|themeCSS|&#|<(?!\/?(?:br|i)\s*\/?>)[a-z!/]/i;

const RESOURCE_SHAPE_PROPERTIES = new Set(["href", "icon", "image", "img", "link", "src", "url"]);

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (/\s/.test(source[index] ?? "")) {
    index += 1;
  }
  return index;
}

function readQuotedValue(source: string, start: number): number | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") {
    return null;
  }
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === quote) {
      return index + 1;
    }
  }
  return null;
}

function readShapeData(source: string, start: number): { content: string; end: number } | null {
  let index = start;
  let quote: string | null = null;
  while (index < source.length) {
    const character = source[index];
    if (quote) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      index += 1;
      continue;
    }
    if (character === "}") {
      return { content: source.slice(start, index), end: index + 1 };
    }
    // The Mermaid grammar has no nested shape-data object. Treat one as
    // malformed rather than trying to second-guess YAML's complex-key syntax.
    if (character === "{") {
      return null;
    }
    index += 1;
  }
  return null;
}

function readShapeDataKey(content: string, start: number): { key: string; end: number } | null {
  let end = start;
  while (/[A-Za-z0-9_-]/.test(content[end] ?? "")) {
    end += 1;
  }
  if (start === end || !/[A-Za-z_]/.test(content[start] ?? "")) {
    return null;
  }
  return { key: content.slice(start, end).toLowerCase(), end };
}

function readUnquotedShapeDataValue(content: string, start: number): number | null {
  let end = start;
  while (end < content.length && content[end] !== "," && content[end] !== "\n") {
    if ("&*!?[".includes(content[end] ?? "")) {
      return null;
    }
    end += 1;
  }
  return content.slice(start, end).trim().length > 0 ? end : null;
}

function readShapeDataPair(content: string, start: number): number | null {
  const keyResult = readShapeDataKey(content, start);
  if (!keyResult || RESOURCE_SHAPE_PROPERTIES.has(keyResult.key)) {
    return null;
  }
  const valueStart = skipWhitespace(content, keyResult.end);
  if (content[valueStart] !== ":") {
    return null;
  }
  const value = skipWhitespace(content, valueStart + 1);
  return readQuotedValue(content, value) ?? readUnquotedShapeDataValue(content, value);
}

function readShapeDataSeparator(content: string, start: number): number | null {
  let end = start;
  let separatedByNewline = false;
  while (/\s/.test(content[end] ?? "")) {
    separatedByNewline ||= content[end] === "\n";
    end += 1;
  }
  if (end === content.length) {
    return end;
  }
  if (content[end] === ",") {
    return skipWhitespace(content, end + 1);
  }
  return separatedByNewline ? end : null;
}

function isSafeShapeData(content: string): boolean {
  let index = skipWhitespace(content, 0);
  let pairCount = 0;
  while (index < content.length) {
    const valueEnd = readShapeDataPair(content, index);
    if (valueEnd === null) {
      return false;
    }
    pairCount += 1;
    const next = readShapeDataSeparator(content, valueEnd);
    if (next === null) {
      return false;
    }
    index = next;
  }
  return pairCount > 0;
}

function containsUnsafeShapeData(code: string): boolean {
  const shapeDataStart = /@\s*\{/g;
  while (shapeDataStart.exec(code)) {
    const shapeData = readShapeData(code, shapeDataStart.lastIndex);
    if (!shapeData || !isSafeShapeData(shapeData.content)) {
      return true;
    }
    shapeDataStart.lastIndex = shapeData.end;
  }
  return false;
}

// Mermaid labels can contain escaped text. Decode the escape forms we care
// about before running the denylist so disguised HTML still gets caught.
// Invalid escape sequences fail closed and fall back to the source block.
function normalizeMermaidSource(code: string): string | null {
  try {
    return code
      .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, hex: string) =>
        decodeCodePointEscape(Number.parseInt(hex, 16)),
      )
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/["'`\\]/g, "");
  } catch {
    return null;
  }
}

function decodeCodePointEscape(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) {
    throw new RangeError("Invalid Unicode code point");
  }
  return String.fromCodePoint(value);
}

export function containsUnsafeMermaidSource(code: string): boolean {
  if (containsUnsafeShapeData(code) || UNSAFE_MERMAID_SOURCE.test(code)) {
    return true;
  }
  const normalized = normalizeMermaidSource(code);
  if (normalized === null) {
    return true;
  }
  return UNSAFE_MERMAID_SOURCE.test(normalized);
}
