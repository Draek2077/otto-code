import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { formatCaughtValue } from "./root-error-details";

interface SettingsContentErrorBoundaryProps {
  children: ReactNode;
  // Changing this value resets the boundary. Pass a stable identity for the
  // active settings view so navigating to a different section clears a caught
  // error and re-attempts the render.
  resetKey: string;
}

interface SettingsContentErrorBoundaryState {
  error: string | null;
}

// Scoped boundary around the settings *content* pane only. The settings header
// (BackHeader / ScreenHeader) renders outside it, so a render failure in a
// section keeps a working way out instead of bubbling to the full-screen root
// fallback — which is the "gray screen, no controls, no back" symptom users hit.
export class SettingsContentErrorBoundary extends Component<
  SettingsContentErrorBoundaryProps,
  SettingsContentErrorBoundaryState
> {
  state: SettingsContentErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): SettingsContentErrorBoundaryState {
    return { error: formatCaughtValue(error) };
  }

  componentDidUpdate(prev: SettingsContentErrorBoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("[SettingsContentErrorBoundary] Settings section render error", {
      error: formatCaughtValue(error),
      componentStack: errorInfo.componentStack,
    });
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error !== null) {
      return <SettingsContentErrorFallback error={this.state.error} onRetry={this.retry} />;
    }
    return this.props.children;
  }
}

function SettingsContentErrorFallback({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.container} testID="settings-content-error-boundary">
      <Text style={styles.title}>{t("rootError.title")}</Text>
      <Text style={styles.body}>{t("rootError.body")}</Text>
      <View style={styles.messageBox}>
        <Text style={styles.message}>{error}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={retryButtonStyle}
        testID="settings-content-error-boundary-retry"
      >
        <Text style={styles.retryButtonText}>{t("common.actions.retry")}</Text>
      </Pressable>
    </View>
  );
}

function retryButtonStyle({ pressed }: PressableStateCallbackType) {
  return [styles.retryButton, pressed ? styles.retryButtonPressed : null];
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[6],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  body: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  messageBox: {
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[4],
  },
  message: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  retryButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  retryButtonPressed: {
    opacity: 0.85,
  },
  retryButtonText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
}));
