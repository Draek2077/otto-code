import type { ViewDocument } from "@getpaseo/plugin/otto/architectural-views";
import { ArchitecturalViewError } from "./specification.js";
/** Stay below the smallest supported native harness's 16k-character result cap.
 * Compact model text avoids a second pretty-print multiplier. */
export const VIEW_MODEL_CHARACTERS = 14000;
export function viewModelText(value: unknown): string {
  const text = JSON.stringify(value);
  if (text.length > VIEW_MODEL_CHARACTERS)
    throw new ArchitecturalViewError(
      "invalid",
      "Narrow this View read; its result exceeds the model transfer budget.",
    );
  return text;
}
export function viewSourcePart(
  document: ViewDocument,
  input: { offset?: number; expectedRevision?: string },
) {
  const metadata = document.kind === "draft" ? document.draft : document.view;
  const offset = input.offset ?? 0;
  if (
    (offset > 0 && !input.expectedRevision) ||
    (input.expectedRevision && input.expectedRevision !== metadata.revision)
  )
    throw new ArchitecturalViewError(
      "conflict",
      "Read the current View metadata first, then pin every source part to that revision.",
    );
  const source = JSON.stringify(document.specification, null, 2);
  if (offset > source.length)
    throw new ArchitecturalViewError("invalid", "Source offset is outside this View.");
  let length = Math.min(8000, source.length - offset);
  const envelope = () => ({
    kind: document.kind,
    ...(offset === 0 ? { [document.kind === "draft" ? "draft" : "view"]: metadata } : {}),
    source: {
      revision: metadata.revision,
      offset,
      text: source.slice(offset, offset + length),
      characters: source.length,
      nextOffset: offset + length < source.length ? offset + length : null,
    },
  });
  while (JSON.stringify(envelope()).length > VIEW_MODEL_CHARACTERS && length > 0)
    length = Math.floor(length / 2);
  const result = envelope();
  viewModelText(result);
  return result;
}
