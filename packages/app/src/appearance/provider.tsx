import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
} from "react";
import { UnistylesRuntime } from "react-native-unistyles";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAppSettings } from "@/hooks/use-settings";
import {
  rememberPluginThemeHost,
  usePluginThemeCatalog,
  type PluginThemeOption,
} from "@/plugins/themes";
import { syncBlackChatScopeVars } from "@/styles/black-chat-scope";
import { PLUGIN_THEME_PREFERENCE } from "@/styles/theme";
import { applyAppearance } from "./apply";
import { applyColorScheme } from "./color-scheme";

interface ContributedThemes {
  options: PluginThemeOption[];
  selected: PluginThemeOption | null;
  select: (option: PluginThemeOption) => void;
}

const ContributedThemesContext = createContext<ContributedThemes | null>(null);

/** Paseo's single application-level appearance lifecycle, extended by Otto data. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { settings, updateSettings, isLoading } = useAppSettings();
  const options = usePluginThemeCatalog();
  const osColorScheme = useColorScheme();
  const selected = useMemo(
    () =>
      settings.theme === PLUGIN_THEME_PREFERENCE
        ? (options.find((option) => option.id === settings.pluginThemeId) ?? null)
        : null,
    [options, settings.pluginThemeId, settings.theme],
  );

  useLayoutEffect(() => {
    if (isLoading) return;
    // Always repair Otto's adaptive mirrors before selecting the effective key.
    applyColorScheme({
      colorSchemeMode: settings.colorSchemeMode,
      lightTheme: settings.lightTheme,
      darkTheme: settings.darkTheme,
      systemColorScheme: osColorScheme,
      fontContrast: settings.fontContrast,
    });
    if (selected) {
      const name = selected.theme.colorScheme === "light" ? "pluginLight" : "pluginDark";
      if (selected.theme.colorScheme === "light") {
        UnistylesRuntime.updateTheme("pluginLight", () => selected.theme);
      } else {
        UnistylesRuntime.updateTheme("pluginDark", () => selected.theme);
      }
      // The black chat scope keeps its independently complete Otto semantic
      // palette. Plugin contributions only promise Paseo's public roles, so
      // making their sparse colors own the scope would silently degrade Otto
      // status, terminal, usage, and code tokens.
      syncBlackChatScopeVars();
      UnistylesRuntime.setAdaptiveThemes(false);
      UnistylesRuntime.setTheme(name);
    }
  }, [
    isLoading,
    osColorScheme,
    selected,
    settings.colorSchemeMode,
    settings.darkTheme,
    settings.fontContrast,
    settings.lightTheme,
  ]);

  useLayoutEffect(() => {
    if (isLoading) return;
    applyAppearance({
      uiFontFamily: settings.uiFontFamily,
      monoFontFamily: settings.monoFontFamily,
      uiFontSize: settings.uiFontSize,
      contentFontSize: settings.contentFontSize,
      codeFontSize: settings.codeFontSize,
      syntaxTheme: settings.syntaxTheme,
      chatWidth: settings.chatWidth,
    });
    syncBlackChatScopeVars();
  }, [
    isLoading,
    settings.codeFontSize,
    settings.chatWidth,
    settings.contentFontSize,
    settings.monoFontFamily,
    settings.syntaxTheme,
    settings.uiFontFamily,
    settings.uiFontSize,
  ]);

  const select = useCallback(
    (option: PluginThemeOption) => {
      rememberPluginThemeHost(option);
      void updateSettings({ theme: PLUGIN_THEME_PREFERENCE, pluginThemeId: option.id });
    },
    [updateSettings],
  );
  const value = useMemo(() => ({ options, selected, select }), [options, selected, select]);
  return (
    <ContributedThemesContext.Provider value={value}>{children}</ContributedThemesContext.Provider>
  );
}

export function useContributedThemes(): ContributedThemes {
  const themes = useContext(ContributedThemesContext);
  if (themes === null) throw new Error("useContributedThemes requires AppearanceProvider");
  return themes;
}
