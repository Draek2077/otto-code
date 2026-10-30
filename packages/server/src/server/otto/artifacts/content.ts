import { Parser } from "htmlparser2";

export const MAX_HTML_BYTES = 320000;
export const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
interface Span {
  start: number;
  end: number;
}
function parse(html: string) {
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error("Artifact HTML exceeds 320 KB.");
  const remove: Span[] = [];
  const blocks: Span[] = [];
  let head = -1,
    headCount = 0,
    htmlCount = 0,
    bodyCount = 0,
    dataStart = -1;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        // CSP must precede every executable element. Do not accept browser-repaired
        // documents whose scripts/text appear before the explicit HTML/head boundary.
        if (
          (!htmlCount && name !== "html") ||
          (htmlCount && head < 0 && name !== "html" && name !== "head")
        )
          throw new Error("Artifact head must precede all executable content.");
        if (name === "html") htmlCount++;
        if (name === "body") bodyCount++;
        if (name === "head") {
          headCount++;
          head = parser.endIndex + 1;
        }
        if (
          name === "base" ||
          (name === "meta" &&
            /^(content-security-policy|refresh)$/i.test(attrs["http-equiv"] ?? ""))
        )
          remove.push({ start: parser.startIndex, end: parser.endIndex + 1 });
        if (attrs.id === "otto-artifact-data") {
          if (
            name !== "script" ||
            attrs.type?.toLowerCase() !== "application/json" ||
            dataStart >= 0
          )
            throw new Error("Use one application/json script named otto-artifact-data.");
          dataStart = parser.endIndex + 1;
        }
      },
      ontext(text) {
        if (head < 0 && text.trim()) throw new Error("Artifact content must follow its head.");
      },
      onclosetag(name) {
        if (name === "script" && dataStart >= 0) {
          blocks.push({ start: dataStart, end: parser.startIndex });
          dataStart = -1;
        }
      },
    },
    { decodeEntities: true, recognizeSelfClosing: false },
  );
  parser.end(html);
  if (
    htmlCount !== 1 ||
    bodyCount !== 1 ||
    headCount !== 1 ||
    head < 0 ||
    !/<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Return one complete self-contained HTML document with head and body.");
  if (blocks.length > 1) throw new Error("Artifact has multiple data contracts.");
  return { remove, head, data: blocks[0] };
}
export function artifactData(html: string): string | null {
  const block = parse(html).data;
  if (!block) return null;
  const text = html.slice(block.start, block.end);
  if (Buffer.byteLength(text) > 100000) throw new Error("Artifact data exceeds 100 KB.");
  JSON.parse(text);
  return text;
}
export function validateArtifactHtml(html: string): void {
  artifactData(html);
}
/** Only the JSON block changes. Never canonicalize the rest of the presentation. */
export function replaceArtifactData(html: string, json: string): string {
  const block = parse(html).data;
  if (!block)
    throw new Error("This artifact has no data contract. Choose Regenerate to change its design.");
  const safe = JSON.stringify(JSON.parse(json), null, 2).replace(/</g, "\\u003c");
  if (Buffer.byteLength(safe) > 100000) throw new Error("Artifact data exceeds 100 KB.");
  const next = html.slice(0, block.start) + safe + html.slice(block.end);
  validateArtifactHtml(next);
  return next;
}
/** Preview-only projection. Original presentation bytes remain on the owning host. */
export function artifactPreview(html: string): string {
  const { remove, head } = parse(html);
  const edits = [
    ...remove.map((span) => ({ start: span.start, end: span.end, text: "" })),
    {
      start: head,
      end: head,
      text: `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`,
    },
  ];
  let output = html;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}
