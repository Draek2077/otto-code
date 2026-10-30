import { useCallback, useMemo, useSyncExternalStore } from "react";
import { View, Linking } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CONNECTOR_CATALOG, type ConnectorCatalogEntry } from "@getpaseo/plugin/otto/connectors";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { SearchField } from "@/components/ui/search-field";
import { Button } from "@/components/ui/button";
import type { ConnectorForm } from "./form-model";

function CatalogRow({ entry, model }: { entry: ConnectorCatalogEntry; model: ConnectorForm }) {
  const add = useCallback(() => model.add(entry.id), [model, entry.id]);
  const docs = useCallback(() => {
    void Linking.openURL(entry.source);
  }, [entry.source]);
  return (
    <SettingsRow label={entry.label} hint={entry.description}>
      <Button variant="outline" size="sm" onPress={docs}>
        Docs
      </Button>
      <Button size="sm" onPress={add}>
        Add
      </Button>
    </SettingsRow>
  );
}
const header = { title: "Add connector" };
export function ConnectorCatalogSheet({ model }: { model: ConnectorForm }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const custom = useCallback(() => model.add(null), [model]);
  const entries = useMemo(() => {
    const query = state.search.trim().toLowerCase();
    return CONNECTOR_CATALOG.filter((entry) =>
      `${entry.label} ${entry.category} ${entry.description}`.toLowerCase().includes(query),
    );
  }, [state.search]);
  return (
    <AdaptiveModalSheet visible={state.catalogOpen} onClose={model.hideCatalog} header={header}>
      <View style={styles.body}>
        <SearchField
          value={state.search}
          onChangeText={model.setSearch}
          placeholder="Search connectors"
          clearAccessibilityLabel="Clear connector search"
        />
        <SettingsCard>
          <SettingsRow
            label="Custom MCP server"
            hint="Connect an HTTP, SSE or local-command server."
          >
            <Button variant="outline" size="sm" onPress={custom}>
              Add custom
            </Button>
          </SettingsRow>
        </SettingsCard>
        <SettingsCard>
          {entries.map((entry) => (
            <CatalogRow key={entry.id} entry={entry} model={model} />
          ))}
          {entries.length === 0 ? <SettingsRow label="No matching connectors" /> : null}
        </SettingsCard>
      </View>
    </AdaptiveModalSheet>
  );
}
const styles = StyleSheet.create((theme) => ({
  body: { padding: theme.spacing[4], gap: theme.spacing[4] },
}));
