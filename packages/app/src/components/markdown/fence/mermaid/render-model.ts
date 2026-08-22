import type { MarkdownPhase } from "../types";
import type { MermaidDiagramTheme } from "./theme";

export type DiagramColorScheme = "light" | "dark";

export interface DiagramDimensions {
  height: number;
  width: number;
}

export interface RenderedDiagram extends DiagramDimensions {
  source: string;
  /** The palette the render was produced under - see MermaidDiagramTheme.key. */
  themeKey: string;
}

export interface MermaidRenderInput {
  source: string;
  phase: MarkdownPhase;
  diagramTheme: MermaidDiagramTheme;
  rejected: boolean;
  cached: RenderedDiagram | null;
}

export interface MermaidRenderRequest {
  revision: number;
  source: string;
  colorScheme: DiagramColorScheme;
  themeKey: string;
  themeVariables: Record<string, string>;
}

export interface MermaidRenderModel {
  revision: number;
  source: string;
  phase: MarkdownPhase;
  diagramTheme: MermaidDiagramTheme;
  status: "pending" | "rendered" | "failed" | "rejected";
  visible: RenderedDiagram | null;
}

export type MermaidRenderAction =
  | { type: "inputChanged"; input: MermaidRenderInput }
  | {
      type: "rendered";
      revision: number;
      source: string;
      themeKey: string;
      dimensions: DiagramDimensions;
    }
  | { type: "renderFailed"; revision: number };

function reduceRendered(
  state: MermaidRenderModel,
  action: Extract<MermaidRenderAction, { type: "rendered" }>,
): MermaidRenderModel {
  if (action.themeKey !== state.diagramTheme.key) {
    return state;
  }
  if (action.revision !== state.revision || action.source !== state.source) {
    const isStreamingPrefix =
      state.phase === "streaming" &&
      action.revision < state.revision &&
      state.source.startsWith(action.source);
    const isNewerPreview =
      state.visible === null || action.source.length > state.visible.source.length;
    if (!isStreamingPrefix || !isNewerPreview) {
      return state;
    }
    return {
      ...state,
      visible: {
        source: action.source,
        themeKey: action.themeKey,
        ...action.dimensions,
      },
    };
  }
  return {
    ...state,
    status: "rendered",
    visible: {
      source: action.source,
      themeKey: action.themeKey,
      ...action.dimensions,
    },
  };
}

export function createMermaidRenderModel(input: MermaidRenderInput): MermaidRenderModel {
  if (input.rejected) {
    return {
      revision: 1,
      source: input.source,
      phase: input.phase,
      diagramTheme: input.diagramTheme,
      status: "rejected",
      visible: input.phase === "complete" ? null : input.cached,
    };
  }
  return {
    revision: 1,
    source: input.source,
    phase: input.phase,
    diagramTheme: input.diagramTheme,
    status: "pending",
    visible: input.cached,
  };
}

export function reduceMermaidRenderModel(
  state: MermaidRenderModel,
  action: MermaidRenderAction,
): MermaidRenderModel {
  if (action.type === "rendered") {
    return reduceRendered(state, action);
  }

  if (action.type === "renderFailed") {
    if (action.revision !== state.revision) {
      return state;
    }
    return {
      ...state,
      status: "failed",
      visible: state.phase === "complete" ? null : state.visible,
    };
  }

  const { input } = action;
  const isSameRender =
    input.source === state.source && input.diagramTheme.key === state.diagramTheme.key;
  if (isSameRender) {
    if (input.phase === state.phase) {
      return state;
    }
    const finalFailure = input.phase === "complete" && state.status === "failed";
    return {
      ...state,
      phase: input.phase,
      visible: finalFailure ? null : state.visible,
    };
  }

  if (input.rejected) {
    return {
      revision: state.revision + 1,
      source: input.source,
      phase: input.phase,
      diagramTheme: input.diagramTheme,
      status: "rejected",
      visible: input.phase === "complete" ? null : (input.cached ?? state.visible),
    };
  }

  return {
    revision: state.revision + 1,
    source: input.source,
    phase: input.phase,
    diagramTheme: input.diagramTheme,
    status: "pending",
    visible: input.cached ?? state.visible,
  };
}

export function getMermaidRenderRequest(state: MermaidRenderModel): MermaidRenderRequest | null {
  if (state.status !== "pending") {
    return null;
  }
  return {
    revision: state.revision,
    source: state.source,
    colorScheme: state.diagramTheme.colorScheme,
    themeKey: state.diagramTheme.key,
    themeVariables: state.diagramTheme.variables,
  };
}
