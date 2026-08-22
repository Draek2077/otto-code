import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  createMermaidRenderModel,
  getMermaidRenderRequest,
  reduceMermaidRenderModel,
  type DiagramDimensions,
  type RenderedDiagram,
} from "./render-model";
import { containsUnsafeMermaidSource } from "./source-policy";
import type { MermaidDiagramTheme } from "./theme";
import type { MarkdownPhase } from "../types";

const renderCache = new Map<string, RenderedDiagram>();
const RENDER_CACHE_LIMIT = 50;

function cacheKey(source: string, themeKey: string): string {
  return `${themeKey}\u0000${source}`;
}

function readCachedRender(source: string, themeKey: string): RenderedDiagram | null {
  return renderCache.get(cacheKey(source, themeKey)) ?? null;
}

function cacheRender(rendered: RenderedDiagram): void {
  if (renderCache.size >= RENDER_CACHE_LIMIT) {
    const oldest = renderCache.keys().next().value;
    if (oldest !== undefined) {
      renderCache.delete(oldest);
    }
  }
  renderCache.set(cacheKey(rendered.source, rendered.themeKey), rendered);
}

export function useMermaidRenderModel({
  source,
  phase,
  diagramTheme,
}: {
  source: string;
  phase: MarkdownPhase;
  diagramTheme: MermaidDiagramTheme;
}) {
  const renderInput = useMemo(
    () => ({
      source,
      phase,
      diagramTheme,
      rejected: containsUnsafeMermaidSource(source),
      cached: readCachedRender(source, diagramTheme.key),
    }),
    [diagramTheme, phase, source],
  );
  const [state, dispatch] = useReducer(
    reduceMermaidRenderModel,
    renderInput,
    createMermaidRenderModel,
  );

  useEffect(() => {
    dispatch({ type: "inputChanged", input: renderInput });
  }, [renderInput]);

  const rendered = useCallback(
    (response: {
      revision: number;
      source: string;
      themeKey: string;
      dimensions: DiagramDimensions;
    }) => {
      const cached: RenderedDiagram = {
        source: response.source,
        themeKey: response.themeKey,
        ...response.dimensions,
      };
      cacheRender(cached);
      dispatch({
        type: "rendered",
        revision: response.revision,
        source: response.source,
        themeKey: response.themeKey,
        dimensions: response.dimensions,
      });
    },
    [],
  );
  const renderFailed = useCallback((revision: number) => {
    dispatch({ type: "renderFailed", revision });
  }, []);

  return {
    state,
    request: getMermaidRenderRequest(state),
    rendered,
    renderFailed,
  };
}
