import { useMemo } from "react";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  ListChevronsDownUp,
  ListChevronsUpDown,
  RotateCw,
  WrapText,
} from "@/components/icons/material-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { PinnableToolbarItem } from "@/components/ui/pinnable-toolbar";
import type { ProjectSearchToolbarItemId } from "@/components/project-search-toolbar-items";
import type { Theme } from "@/styles/theme";

const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedWrapText = withUnistyles(WrapText);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedListChevronsUpDown = withUnistyles(ListChevronsUpDown);
const ThemedListChevronsDownUp = withUnistyles(ListChevronsDownUp);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

/**
 * The Search toolbar's catalog in fixed order, built the way the Changes
 * toolbar builds its own: each entry's icon and label state the action it
 * performs, and the pinned strip and the ▾ menu share them verbatim. An option
 * that has nothing to act on is omitted rather than shown dead.
 */
export function useProjectSearchToolbarItems({
  wrapLines,
  hasResults,
  allFilesExpanded,
  isSearching,
  canRefresh,
  onToggleWrapLines,
  onToggleExpandAll,
  onRefresh,
}: {
  wrapLines: boolean;
  hasResults: boolean;
  allFilesExpanded: boolean;
  isSearching: boolean;
  canRefresh: boolean;
  onToggleWrapLines: () => void;
  onToggleExpandAll: () => void;
  onRefresh: () => void;
}): PinnableToolbarItem<ProjectSearchToolbarItemId>[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const list: PinnableToolbarItem<ProjectSearchToolbarItemId>[] = [];

    list.push({
      id: "wrap",
      label: wrapLines ? t("projectSearch.scrollLongLines") : t("projectSearch.wrapLongLines"),
      renderIcon: (size) => <ThemedWrapText size={size} uniProps={mutedIconColorMapping} />,
      onPress: onToggleWrapLines,
      testID: "project-search-toggle-wrap-lines",
    });

    if (hasResults) {
      list.push({
        id: "expand",
        label: allFilesExpanded ? t("projectSearch.collapseAll") : t("projectSearch.expandAll"),
        renderIcon: (size) =>
          allFilesExpanded ? (
            <ThemedListChevronsDownUp size={size} uniProps={mutedIconColorMapping} />
          ) : (
            <ThemedListChevronsUpDown size={size} uniProps={mutedIconColorMapping} />
          ),
        onPress: onToggleExpandAll,
        testID: "project-search-toggle-expand-all",
      });
    }

    list.push({
      id: "refresh",
      label: isSearching ? t("projectSearch.searching") : t("projectSearch.refresh"),
      renderIcon: (size) =>
        isSearching ? (
          <ThemedLoadingSpinner size={size} uniProps={mutedIconColorMapping} />
        ) : (
          <ThemedRotateCw size={size} uniProps={mutedIconColorMapping} />
        ),
      onPress: onRefresh,
      disabled: isSearching || !canRefresh,
      separatorBefore: true,
      testID: "project-search-refresh",
    });

    return list;
  }, [
    allFilesExpanded,
    canRefresh,
    hasResults,
    isSearching,
    onRefresh,
    onToggleExpandAll,
    onToggleWrapLines,
    t,
    wrapLines,
  ]);
}
