import { useStyles } from "./styles";

import { useBrainOperations, useBrainHost } from "../context";
import { useCallback, useMemo, useRef, useState } from "react";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { Text, View } from "react-native";

import type { BrainHfSearchResult, BrainJob } from "../contracts/models";

import { Button } from "@/components/ui/button";
import { BrainLoadingSpinner as LoadingSpinner } from "../theme";

import { settingsStyles } from "@/styles/settings";

import { ThemedTextInput, installedIcon, useReportBrainError, formatBytes } from "./common";
import {
  formatDownloads,
  searchPlaceholderProps,
  type PinnedHuggingFaceModel,
  QuantPicker,
} from "./quant-picker";
export function SearchResultRow({
  serverId,
  result,
  showBorder,
  busy,
  jobs,
  onDownload,
  onCancel,
}: {
  serverId: string;
  result: BrainHfSearchResult;
  showBorder: boolean;
  busy: boolean;
  jobs: BrainJob[];
  onDownload: (
    repo: string,
    quant: string,
    components?: string[],
    expectedBytes?: number,
  ) => Promise<void>;
  onCancel: (jobId: string) => void;
}) {
  const styles = useStyles();
  const rowStyle = useMemo(
    () => [styles.tightRow, showBorder && settingsStyles.rowBorder],
    [styles, showBorder],
  );
  return (
    <View style={rowStyle}>
      <View style={styles.modelHeader}>
        <Text style={[settingsStyles.rowTitle, styles.modelTitle]} numberOfLines={1}>
          {result.repo}
        </Text>
        <View style={styles.rowActions}>
          <QuantPicker
            serverId={serverId}
            repo={result.repo}
            busy={busy}
            jobs={jobs}
            onDownload={onDownload}
            onCancel={onCancel}
          />
        </View>
      </View>
      <View style={styles.modelDetails}>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {formatDownloads(result.downloads)} downloads · {result.likes} likes
          {result.gated ? " · gated" : ""}
        </Text>
        {result.summary ? (
          <Text style={settingsStyles.rowHint} numberOfLines={2}>
            {result.summary}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function PinnedModelRow({
  serverId,
  model,
  showBorder,
  busy,
  jobs,
  onDownload,
  onCancel,
}: {
  serverId: string;
  model: PinnedHuggingFaceModel;
  showBorder: boolean;
  busy: boolean;
  jobs: BrainJob[];
  onDownload: (
    repo: string,
    quant: string,
    components?: string[],
    expectedBytes?: number,
  ) => Promise<void>;
  onCancel: (jobId: string) => void;
}) {
  const styles = useStyles();
  const rowStyle = useMemo(
    () => [styles.tightRow, showBorder && settingsStyles.rowBorder],
    [styles, showBorder],
  );
  const meta = [model.quant, model.sizeBytes ? formatBytes(model.sizeBytes) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={rowStyle}>
      <View style={styles.modelHeader}>
        <Text style={[settingsStyles.rowTitle, styles.modelTitle]} numberOfLines={1}>
          {model.name}
        </Text>
        <View style={styles.rowActions}>
          <View style={styles.installedTag}>
            {installedIcon}
            <Text style={styles.installedTagText}>Installed</Text>
          </View>
          {model.repo ? (
            <QuantPicker
              serverId={serverId}
              repo={model.repo}
              initialQuant={model.quant}
              initialModelId={model.id}
              knownBundle={model.hasProjector}
              busy={busy}
              jobs={jobs}
              onDownload={onDownload}
              onCancel={onCancel}
            />
          ) : null}
        </View>
      </View>
      <View style={styles.modelDetails}>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {meta || "Hugging Face source unavailable"}
        </Text>
        {model.hasProjector ? (
          <Text style={settingsStyles.rowHint}>Bundle: Vision projector</Text>
        ) : null}
      </View>
    </View>
  );
}

export function HuggingFaceSearch({
  serverId,
  busy,
  jobs,
  onStarted,
  onCancel,
}: {
  serverId: string;
  busy: boolean;
  jobs: BrainJob[];
  onStarted: (job: BrainJob) => void;
  onCancel: (jobId: string) => void;
}) {
  const styles = useStyles();
  const reportError = useReportBrainError();
  const supported = useBrainHost().access.hfSearch;
  const client = useBrainOperations();
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<EditingTextInputHandle>(null);
  const [results, setResults] = useState<BrainHfSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // A monotonic request token so an out-of-order search response from a
  // superseded query (or one abandoned via Clear) can't overwrite the current
  // results.
  const searchSeq = useRef(0);
  const hasSearched = query.length > 0 || results.length > 0;

  const runSearch = useCallback(() => {
    const searchText = searchInputRef.current?.getText() ?? query;
    if (!client || !searchText.trim()) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    void client
      .searchModels(searchText.trim(), 30)
      .then((rows) => {
        if (seq === searchSeq.current) setResults(rows);
        return;
      })
      .catch((error) => reportError("Search failed", error))
      .finally(() => {
        if (seq === searchSeq.current) setSearching(false);
      });
  }, [client, query, reportError]);

  const handleClear = useCallback(() => {
    searchSeq.current++;
    searchInputRef.current?.replaceText("");
    setQuery("");
    setResults([]);
    setSearching(false);
  }, []);

  const handleDownload = useCallback(
    async (repo: string, quant: string, components?: string[], expectedBytes?: number) => {
      const job = await client.addModel({ repo, quant, components, expectedBytes });
      onStarted(job);
    },
    [client, onStarted],
  );

  if (!supported) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.subheading}>Search Hugging Face</Text>
      <View style={styles.searchRow}>
        <ThemedTextInput
          ref={searchInputRef}
          style={styles.searchInput}
          uniProps={searchPlaceholderProps}
          initialValue={query}
          onChangeText={setQuery}
          onSubmitEditing={runSearch}
          placeholder="Search GGUF models…"
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          variant="outline"
          size="sm"
          onPress={runSearch}
          disabled={!query.trim() || searching}
        >
          Search
        </Button>
        {hasSearched ? (
          <Button variant="ghost" size="sm" onPress={handleClear}>
            Clear
          </Button>
        ) : null}
      </View>
      {searching ? (
        <View style={styles.searchLoading}>
          <LoadingSpinner size="small" />
        </View>
      ) : null}
      {results.map((r, index) => (
        <SearchResultRow
          key={r.repo}
          serverId={serverId}
          result={r}
          showBorder={index > 0}
          busy={busy}
          jobs={jobs}
          onDownload={handleDownload}
          onCancel={onCancel}
        />
      ))}
    </View>
  );
}

/** A persistent download library, deliberately separate from search results. */
export function DownloadedHuggingFaceModels({
  serverId,
  models,
  busy,
  jobs,
  onStarted,
  onCancel,
}: {
  serverId: string;
  models: PinnedHuggingFaceModel[];
  busy: boolean;
  jobs: BrainJob[];
  onStarted: (job: BrainJob) => void;
  onCancel: (jobId: string) => void;
}) {
  const styles = useStyles();
  const client = useBrainOperations();
  const handleDownload = useCallback(
    async (repo: string, quant: string, components?: string[], expectedBytes?: number) => {
      const job = await client.addModel({ repo, quant, components, expectedBytes });
      onStarted(job);
    },
    [client, onStarted],
  );

  if (models.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.subheading}>Downloaded models</Text>
      {models.map((model, index) => (
        <PinnedModelRow
          key={model.id}
          serverId={serverId}
          model={model}
          showBorder={index > 0}
          busy={busy}
          jobs={jobs}
          onDownload={handleDownload}
          onCancel={onCancel}
        />
      ))}
    </View>
  );
}

// The "Models" and "Operations" settings sections that used to live here are
// gone. Downloading a model, installing a runtime, calibrating VRAM, sweeping a
// reasoning budget and running a benchmark are work, not settings, and they now
// live on the Brain page (`screens/brain/`), which composes the components above
// directly. What remains in this file is those building blocks.

// Styles
