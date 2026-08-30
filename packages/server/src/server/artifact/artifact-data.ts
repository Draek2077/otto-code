/**
 * The one mutable seam in an artifact. Everything outside this script element
 * is presentation and remains byte-for-byte untouched by data updates.
 */
export const ARTIFACT_DATA_ELEMENT_ID = "otto-artifact-data";

interface DataElementBounds {
  contentStart: number;
  contentEnd: number;
}

function findDataElement(html: string): DataElementBounds | null {
  // This reads one known script element from generated artifact HTML. Allow the
  // permissive end-tag syntax that HTML parsers accept, including attributes.
  const script = /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = script.exec(html))) {
    const openingTagEnd = match[0].indexOf(">");
    const openingTag = match[0].slice(0, openingTagEnd + 1);
    const hasDataId = new RegExp(`\\bid\\s*=\\s*(["'])${ARTIFACT_DATA_ELEMENT_ID}\\1`, "i").test(
      openingTag,
    );
    if (hasDataId) {
      return {
        contentStart: match.index + openingTagEnd + 1,
        contentEnd: match.index + match[0].lastIndexOf("</"),
      };
    }
  }
  return null;
}

export function readArtifactData(html: string): unknown | null {
  const bounds = findDataElement(html);
  if (!bounds) {
    return null;
  }
  try {
    return JSON.parse(html.slice(bounds.contentStart, bounds.contentEnd)) as unknown;
  } catch {
    throw new Error(
      `Artifact data block #${ARTIFACT_DATA_ELEMENT_ID} must contain valid JSON. Regenerate the artifact to repair it.`,
    );
  }
}

export function replaceArtifactData(html: string, data: unknown): string {
  const bounds = findDataElement(html);
  if (!bounds) {
    throw new Error(
      `Artifact does not support data-only updates. Regenerate it first so it includes #${ARTIFACT_DATA_ELEMENT_ID}.`,
    );
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch {
    throw new Error("Artifact data must be JSON-serializable.");
  }
  if (serialized === undefined) {
    throw new Error("Artifact data must be JSON-serializable.");
  }
  // The block is parsed by the HTML tokenizer before JSON.parse ever sees it,
  // so a "</script>" (or "<!--") inside a string value would close the data
  // element early and hand the remainder to the page as live markup. Escaping
  // every "<" keeps the JSON byte-for-byte equivalent after JSON.parse while
  // guaranteeing the tokenizer never finds a tag inside the block.
  const htmlSafe = serialized.replace(/</g, "\\u003c");
  return `${html.slice(0, bounds.contentStart)}${htmlSafe}${html.slice(bounds.contentEnd)}`;
}
