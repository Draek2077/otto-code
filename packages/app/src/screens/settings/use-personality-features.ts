/**
 * The provider feature toggles a stored template can pin, resolved for the
 * provider/model/mode the draft currently names.
 *
 * Deliberately NOT `useDraftAgentFeatures`: that hook merges the device's
 * last-used feature values in as defaults, which is right for a composer draft
 * and wrong here. A template is host-wide and its values have to come from the
 * template alone, or two people editing the same roster would each save their
 * own machine's toggles over each other's.
 *
 * Probed at host scope (`~`) for the same reason the rest of the editor's
 * catalog is: a template that resolved against one project's directory would
 * pin features the next project cannot offer.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AgentFeature, AgentProvider } from "@otto-code/protocol/agent-types";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

const HOME_SCOPE_CWD = "~";

export interface PersonalityFeaturesResult {
  /** Empty until a provider resolves, or when this provider offers none. */
  features: AgentFeature[];
  isLoading: boolean;
}

export function usePersonalityFeatures(input: {
  serverId: string;
  provider: string;
  modelId: string;
  modeId: string;
  /** The template's own pinned values, which override each feature's default. */
  values: Record<string, unknown>;
}): PersonalityFeaturesResult {
  // Serialized so the query key changes when a pinned value does: the daemon
  // resolves each feature's current value from what it is handed, so the same
  // provider/model with different pins is a different answer.
  const valuesKey = JSON.stringify(input.values);
  const { t } = useTranslation();
  const client = useHostRuntimeClient(input.serverId);
  const isConnected = useHostRuntimeIsConnected(input.serverId);
  const enabled = Boolean(client && isConnected && input.provider);

  // `dataShape: "value"` and not `"list"`: a list shape keeps the previous
  // request's data while the next is in flight, which would briefly hand one
  // provider/model combination's features to another's key.
  const query = useFetchQuery({
    queryKey: [
      "personalityFeatures",
      input.serverId,
      input.provider,
      input.modelId,
      input.modeId,
      valuesKey,
    ],
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
    enabled,
    retry: false,
    queryFn: async () => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const payload = await client.listProviderFeatures({
        provider: input.provider as AgentProvider,
        cwd: HOME_SCOPE_CWD,
        ...(input.modelId ? { model: input.modelId } : {}),
        ...(input.modeId ? { modeId: input.modeId } : {}),
        // Handing the template's pins in means the daemon returns each row
        // already carrying the value this template will launch with, rather
        // than the provider default for us to overlay and get subtly wrong.
        ...(Object.keys(input.values).length > 0 ? { featureValues: input.values } : {}),
      });
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload.features ?? [];
    },
  });

  const features = useMemo<AgentFeature[]>(() => query.data ?? [], [query.data]);

  return { features, isLoading: enabled && query.isLoading };
}
