import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useHostFeature } from "@/runtime/host-features";
import type { ViewScope, ViewReference } from "@getpaseo/plugin/otto/architectural-views";
import type { KnowledgeSelection } from "../knowledge/document";
import { openArchitecturalViews } from "./navigation";
/** A narrow Knowledge presentation contribution; it owns no Knowledge writes or storage preferences. */
export function KnowledgeViewsButton({
  scope,
  selection,
}: {
  scope: ViewScope;
  selection: KnowledgeSelection;
}) {
  const available = useHostFeature(scope.hostId, "ottoArchitecturalViews");
  const reference = useMemo<ViewReference>(
    () =>
      selection.type === "root"
        ? { kind: "root", id: selection.slug }
        : { kind: "record", id: selection.id },
    [selection],
  );
  const open = useCallback(() => openArchitecturalViews(scope, { reference }), [scope, reference]);
  return available ? (
    <Button size="sm" variant="outline" onPress={open}>
      Views
    </Button>
  ) : null;
}
