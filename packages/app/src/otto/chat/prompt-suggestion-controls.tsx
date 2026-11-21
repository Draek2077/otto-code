import { useCallback } from "react";
import { Sparkles } from "lucide-react-native";
import { SettingsSwitch } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/hooks/use-settings";

export function PromptSuggestionSetting() {
  const { settings, updateSettings } = useAppSettings();
  const change = useCallback(
    (promptSuggestionsEnabled: boolean) => void updateSettings({ promptSuggestionsEnabled }),
    [updateSettings],
  );
  return (
    <SettingsSwitch
      label="AI prompt suggestions"
      hint="Show next-prompt predictions from providers that have them enabled."
      value={settings.promptSuggestionsEnabled}
      onValueChange={change}
      testID="settings-prompt-suggestions"
    />
  );
}

export function PromptSuggestionAction({
  suggestion,
  accept,
}: {
  suggestion: string;
  accept: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      leftIcon={Sparkles}
      accessibilityLabel="Use suggested prompt"
      accessibilityHint={suggestion}
      onPress={accept}
      testID="composer-use-prompt-suggestion"
    >
      Use suggestion
    </Button>
  );
}
