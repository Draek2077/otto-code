import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import {
  readKnowledgeSettings,
  type KnowledgeScope,
} from "@getpaseo/plugin/otto/project-knowledge";
import { useFetchQuery } from "@/data/query";
import { SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { KnowledgeStorage } from "./storage";
import { KnowledgeStorageSetup } from "./setup";
import { KnowledgeFormat } from "./format";
import { KnowledgeLockRecovery } from "./lock-recovery";
import { useKnowledgeChanges } from "./use-knowledge-changes";

export function KnowledgeProjectSettings({
  scope,
  active,
}: {
  scope: KnowledgeScope;
  active: boolean;
}) {
  const read = useRpc(readKnowledgeSettings);
  const cache = useQueryClient();
  const settings = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 1000,
    queryKey: ["ottoKnowledge", scope.hostId, scope.target.kind, scope.target.id, "settings"],
    enabled: active,
    retry: false,
    queryFn: async () => {
      const result = await read({ scope });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const observationError = useKnowledgeChanges(scope.hostId, settings.data?.projectId, active);
  const refresh = useCallback(() => {
    void cache.invalidateQueries({ queryKey: ["ottoKnowledge", scope.hostId] });
  }, [cache, scope.hostId]);
  let content = <SettingsRow label="Loading Knowledge settings..." />;
  if (settings.error)
    content = (
      <>
        <Alert variant="error" description={settings.error.message} />
        <Button variant="outline" onPress={refresh}>
          Retry
        </Button>
        <KnowledgeStorageSetup scope={scope} active={active} />
      </>
    );
  else if (settings.data)
    content = <KnowledgeStorage scope={scope} settings={settings.data} onChanged={refresh} />;
  return (
    <>
      {content}
      {observationError ? <Alert variant="warning" description={observationError} /> : null}
      <KnowledgeFormat scope={scope} active={active} />
      <KnowledgeLockRecovery scope={scope} active={active} />
    </>
  );
}
