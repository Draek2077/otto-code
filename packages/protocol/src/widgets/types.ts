import { z } from "zod";

/**
 * Inline widgets - an agent emits a tool call carrying a fragment of HTML or
 * SVG, and Otto renders it inline in the transcript at that call's position.
 *
 * Widgets are NOT artifacts. An artifact is a file-backed document the user
 * keeps (see `../artifacts/types.ts`); a widget is a thought the model had in
 * the middle of a sentence. It has no file, no versioning, and no lifetime
 * beyond its transcript position - the tool-call input IS the content, so a
 * re-opened chat re-renders its widgets from the stored timeline for free.
 *
 * See `docs/widgets.md`.
 */

/** Otto tool that carries a widget fragment. */
export const WIDGET_TOOL_NAME = "show_widget";

/** Companion tool returning the host contract the model codes against. */
export const WIDGET_CONTRACT_TOOL_NAME = "widget_contract";

/**
 * Key under a tool call's `metadata` where the normalized widget payload rides.
 *
 * Deliberately NOT a new `ToolCallDetail` variant: `ToolCallDetailPayloadSchema`
 * (messages.ts) is a `z.discriminatedUnion`, so a client that predates widgets
 * would reject an unknown discriminator and fail to parse the ENTIRE timeline
 * message, not just the widget. `metadata` is `z.record(z.string(), z.unknown())`
 * - an old client carries this through untouched and renders the tool call's
 * `plain_text` detail as an ordinary row. That is the protocol contract doing
 * its job.
 */
export const WIDGET_METADATA_KEY = "ottoWidget";

/**
 * Payload shape version. Bumped only on a breaking change to the fields below;
 * a client that does not recognize the version renders the fallback row rather
 * than guessing.
 */
export const WIDGET_PAYLOAD_VERSION = 1;

/**
 * How the fragment is interpreted. Auto-detected from the code itself (a
 * fragment starting with `<svg` is SVG), never asked of the model - one less
 * thing for it to get wrong.
 */
export const WIDGET_MODES = ["html", "svg"] as const;
export type WidgetMode = (typeof WIDGET_MODES)[number];

/**
 * Hard ceiling on a fragment. A widget rides in the timeline and is re-sent on
 * every backfill, so an unbounded one is a permanent tax on the conversation.
 * Generous enough for a dense dashboard; anything past it is a document, and a
 * document is an artifact.
 */
export const WIDGET_MAX_CODE_CHARS = 128_000;

/** Loading messages shown while the fragment streams in. */
export const WIDGET_MAX_LOADING_MESSAGES = 4;
export const WIDGET_MAX_LOADING_MESSAGE_CHARS = 120;

export const WIDGET_MAX_TITLE_CHARS = 120;

const WidgetPayloadSchema = z.object({
  version: z.number().int().positive(),
  id: z.string().min(1),
  title: z.string(),
  mode: z.enum(WIDGET_MODES),
  code: z.string(),
  loadingMessages: z.array(z.string()),
  /** Set when the fragment hit {@link WIDGET_MAX_CODE_CHARS} and was cut. */
  truncated: z.boolean().optional(),
});

export type WidgetPayload = z.infer<typeof WidgetPayloadSchema>;

/**
 * Read a widget payload out of a tool call's metadata bag.
 *
 * Returns null for anything that is not a widget of a version this build
 * understands - the caller renders the ordinary tool-call row instead. Never
 * throws: metadata is `unknown` by contract and may come from a newer daemon.
 */
export function readWidgetPayload(
  metadata: Record<string, unknown> | undefined,
): WidgetPayload | null {
  const raw = metadata?.[WIDGET_METADATA_KEY];
  if (raw === undefined || raw === null) {
    return null;
  }
  const parsed = WidgetPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  if (parsed.data.version !== WIDGET_PAYLOAD_VERSION) {
    return null;
  }
  return parsed.data;
}

/** Detect the render mode from the fragment itself. */
export function detectWidgetMode(code: string): WidgetMode {
  return /^\s*<svg[\s>]/i.test(code) ? "svg" : "html";
}
