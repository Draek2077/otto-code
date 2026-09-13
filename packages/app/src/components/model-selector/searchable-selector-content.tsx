import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { resolveModelBrowserScrolling } from "../model-browser-view";
import { ModelBrowserContent } from "../model-browser";
import { HeaderSettingsIcon, iconButtonStyle, SelectorContent } from "./selector-content";
import type { SelectorView } from "./selector-content";

export function selectorScrollEnabled(view: SelectorView, query: string, native = false) {
  return !(view.kind === "all" && query.trim()) && (view.kind !== "provider" || !native);
}

export function SearchableSelectorContent(props: ComponentProps<typeof SelectorContent>) {
  const isCompact = useIsCompactFormFactor();
  if (props.view.kind === "all" && props.searchQuery.trim()) {
    return (
      <ModelBrowserContent
        serverId={props.serverId ?? null}
        view={props.view}
        providers={props.providers}
        selectedProvider={props.selectedProvider}
        selectedModel={props.selectedModel}
        searchQuery={props.searchQuery}
        isSearchFocused={false}
        personality={null}
        onSelect={props.onSelect}
        onDrillDown={props.onDrillDown}
        scrolling={resolveModelBrowserScrolling({ isNative, isCompact })}
      />
    );
  }
  return <SelectorContent {...props} />;
}

export function ModelProfilesHeaderAction({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={iconButtonStyle}
      accessibilityRole="button"
      accessibilityLabel={t("modelSelector.editProfilesLabel")}
      testID="model-profiles-edit"
    >
      <HeaderSettingsIcon disabled={false} />
    </Pressable>
  );
}
