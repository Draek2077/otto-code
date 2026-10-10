import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { FilePlus } from "@/components/icons/material-icons";
import { Button } from "@/components/ui/button";
import { explorerBaseName } from "@/utils/explorer-paths";

/**
 * What a file tab shows for a path with nothing at it. Not an error: opening a
 * file that is about to exist (a link to a doc an agent has yet to write, a
 * config you are about to add) is a normal thing to do, so the tab says so in
 * words and, when the editor can hold the file, offers to create it.
 */
export function MissingFilePrompt({
  path,
  onCreate,
  creating,
}: {
  path: string;
  /** Null when this host or file type cannot be created from the editor. */
  onCreate: (() => void) | null;
  creating: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.container} testID="file-missing-prompt">
      <Text style={styles.title}>
        {t("editor.missingFile.title", { name: explorerBaseName(path) })}
      </Text>
      {onCreate ? (
        <>
          <Text style={styles.body}>{t("editor.missingFile.body")}</Text>
          <Button
            testID="file-missing-create"
            variant="default"
            size="sm"
            leftIcon={FilePlus}
            onPress={onCreate}
            loading={creating}
            disabled={creating}
          >
            {t("editor.missingFile.create")}
          </Button>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  body: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
