import { View, Text } from "react-native";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type {
  ViewScope,
  ViewIdentity,
  ViewSelection,
} from "@getpaseo/plugin/otto/architectural-views";
import { useViewContent } from "./data";
import { ArchitecturalViewer } from "./viewer";
import { styles } from "./styles";
export function ViewPreview({
  scope,
  identity,
  selection,
  revision,
  active,
}: {
  scope: ViewScope;
  identity: ViewIdentity;
  selection: ViewSelection;
  revision: string;
  active: boolean;
}) {
  const content = useViewContent(scope, identity, selection, revision, active);
  const refresh = useCallback(() => {
    void content.refetch();
  }, [content]);
  if (content.error)
    return (
      <View style={styles.content}>
        <Alert variant="error" description={content.error.message} />
        <Button variant="outline" onPress={refresh} disabled={!active || content.isFetching}>
          Render current View
        </Button>
      </View>
    );
  if (!content.data)
    return (
      <View style={styles.content}>
        <Text style={styles.muted}>Rendering View...</Text>
      </View>
    );
  return <ArchitecturalViewer key={revision} html={content.data} active={active} />;
}
