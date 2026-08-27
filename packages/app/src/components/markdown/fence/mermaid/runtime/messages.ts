import type { DiagramColorScheme, DiagramDimensions } from "../render-model";

export interface MermaidRuntimeRenderMessage {
  type: "render";
  revision: number;
  source: string;
  colorScheme: DiagramColorScheme;
  /**
   * Concrete values for mermaid's `base` theme so diagrams follow the app
   * palette instead of the stock built-ins. Empty means "no app theme": the
   * runtime falls back to the stock scheme theme.
   */
  themeVariables: Record<string, string>;
  /** Palette identity, echoed back so the host can match renders to themes. */
  themeKey: string;
  interactive: boolean;
}

export type MermaidRuntimeMessage =
  | { type: "bridgeReady" }
  | ({
      type: "rendered";
      revision: number;
      source: string;
      themeKey: string;
      /** A static SVG artifact for native hosts that cannot embed a live guest. */
      svg?: string;
    } & DiagramDimensions)
  | { type: "renderError"; revision: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isColorScheme(value: unknown): value is DiagramColorScheme {
  return value === "light" || value === "dark";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

export function parseMermaidRuntimeRenderMessage(
  value: unknown,
): MermaidRuntimeRenderMessage | null {
  if (
    !isRecord(value) ||
    value.type !== "render" ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    typeof value.source !== "string" ||
    !isColorScheme(value.colorScheme) ||
    !isStringRecord(value.themeVariables) ||
    typeof value.themeKey !== "string" ||
    typeof value.interactive !== "boolean"
  ) {
    return null;
  }
  return {
    type: "render",
    revision: value.revision,
    source: value.source,
    colorScheme: value.colorScheme,
    themeVariables: value.themeVariables,
    themeKey: value.themeKey,
    interactive: value.interactive,
  };
}

export function parseMermaidRuntimeMessage(value: unknown): MermaidRuntimeMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "bridgeReady") {
    return { type: "bridgeReady" };
  }
  if (
    value.type === "renderError" &&
    typeof value.revision === "number" &&
    Number.isInteger(value.revision)
  ) {
    return { type: "renderError", revision: value.revision };
  }
  if (
    value.type === "rendered" &&
    typeof value.revision === "number" &&
    Number.isInteger(value.revision) &&
    typeof value.source === "string" &&
    typeof value.themeKey === "string" &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width)
  ) {
    const svg = typeof value.svg === "string" ? value.svg : undefined;
    return {
      type: "rendered",
      revision: value.revision,
      source: value.source,
      themeKey: value.themeKey,
      height: value.height,
      width: value.width,
      ...(svg ? { svg } : {}),
    };
  }
  return null;
}

export function serializeMermaidRuntimeRenderMessage(message: MermaidRuntimeRenderMessage): string {
  return JSON.stringify(message).replace(/<\/script/gi, "<\\/script");
}
