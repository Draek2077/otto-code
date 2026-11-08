import { useCallback, useState } from "react";
import { ScrollView } from "react-native";
import { router } from "expo-router";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { ArtifactRef } from "@getpaseo/plugin/otto/artifacts";
import { buildPluginSurfaceRoute } from "@/plugins/routes";
import { Alert } from "@/components/ui/alert";
import { ArtifactDetail } from "./detail";
import { styles } from "./styles";

/** Exact result links use the recorded origin, including workspace-owned Artifacts.
 * Invalid or cross-host links never fall through to another Artifact collection. */
export function artifactRouteRef(hostId: string, encoded: string): ArtifactRef | null {
  try {
    const parsed = ArtifactRef.safeParse(JSON.parse(encoded));
    return parsed.success && parsed.data.scope.hostId === hostId ? parsed.data : null;
  } catch {
    return null;
  }
}
export function ArtifactRouteDestination({
  props,
  encoded,
  active,
}: {
  props: PluginScreenProps;
  encoded: string;
  active: boolean;
}) {
  const reference = artifactRouteRef(props.host.id, encoded);
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision((value) => value + 1), []);
  const closed = useCallback(
    () =>
      router.replace(
        buildPluginSurfaceRoute(props.host.id, "otto-artifacts", {
          kind: "surface",
          id: "artifacts",
        }),
      ),
    [props.host.id],
  );
  if (!reference)
    return (
      <Alert
        variant="error"
        description="This Artifact link has an invalid or different owning host. Open the original Schedule result on its owning host."
      />
    );
  return (
    <ScrollView
      testID="otto-artifact-result"
      style={styles.column}
      contentContainerStyle={styles.content}
    >
      <ArtifactDetail
        key={revision}
        reference={reference}
        draftSurface="result-link"
        active={active}
        changed={changed}
        closed={closed}
        navigation={props.navigation}
      />
    </ScrollView>
  );
}
