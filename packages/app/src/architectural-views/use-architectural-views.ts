import { useEffect, useState } from "react";
import type { SessionOutboundMessage } from "@otto-code/protocol/messages";
import { useSessionStore } from "@/stores/session-store";

export type ArchitecturalViewSummary = Extract<
  SessionOutboundMessage,
  { type: "architectural-views.list.response" }
>["payload"]["views"][number];

export interface ArchitecturalViewKnowledgeReference {
  kind: "root" | "record";
  id: string;
}

export function useArchitecturalViews(
  serverId: string,
  workspaceId: string,
  knowledgeReference: ArchitecturalViewKnowledgeReference | null,
  loadSelectedContent = true,
): {
  supported: boolean;
  views: ArchitecturalViewSummary[];
  selectedView: ArchitecturalViewSummary | null;
  html: string | null;
  loading: boolean;
  error: string | null;
  selectView: (viewId: string) => void;
} {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.architecturalViews === true,
  );
  const [views, setViews] = useState<ArchitecturalViewSummary[]>([]);
  const [selectedViewId, selectView] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedView = views.find((view) => view.id === selectedViewId) ?? null;
  const knowledgeReferenceKind = knowledgeReference?.kind;
  const knowledgeReferenceId = knowledgeReference?.id;

  useEffect(() => {
    if (!client || !supported) {
      setViews([]);
      selectView(null);
      setHtml(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client
      .listArchitecturalViews({
        workspaceId,
        ...(knowledgeReferenceKind && knowledgeReferenceId
          ? { knowledgeReference: { kind: knowledgeReferenceKind, id: knowledgeReferenceId } }
          : {}),
      })
      .then((result) => {
        if (cancelled) return undefined;
        if (!result.success) throw new Error(result.error ?? "Could not list Architectural Views.");
        setViews(result.views);
        selectView((current) => retainAvailableView(current, result.views));
        return undefined;
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setViews([]);
          selectView(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, knowledgeReferenceId, knowledgeReferenceKind, supported, workspaceId]);

  useEffect(() => {
    if (!client || !supported || !selectedViewId || !loadSelectedContent) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client
      .getArchitecturalViewContent({ workspaceId, viewId: selectedViewId })
      .then((result) => {
        if (cancelled) return undefined;
        if (!result.success || !result.html) {
          throw new Error(result.error ?? "Could not open Architectural View.");
        }
        setHtml(result.html);
        return undefined;
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setHtml(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, loadSelectedContent, selectedViewId, supported, workspaceId]);

  return { supported, views, selectedView, html, loading, error, selectView };
}

function retainAvailableView(
  current: string | null,
  views: readonly ArchitecturalViewSummary[],
): string | null {
  return current && views.some((view) => view.id === current) ? current : (views[0]?.id ?? null);
}
