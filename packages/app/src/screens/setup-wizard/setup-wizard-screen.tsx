/**
 * SetupWizardScreen — the first-run wizard shell. Full-screen, no app chrome
 * (the `/setup` route sits outside `shouldShowAppChrome`). Owns step state and
 * the wizard's side effects (persisting `interfaceMode` and the completion
 * flag); the individual steps are presentational.
 *
 * Step order (charter): Welcome → Mode → Providers → Done. The Agents (Phase 3
 * personality presets) and Teams (Phase 4, owned by the Agentic Teams agent)
 * steps slot in between "providers" and "done" — see STEP_SEQUENCE.
 *
 * Bookends (Welcome, Done) render their own full-brand layout with their own
 * buttons; the middle steps get the shared chrome here (progress, Back, Skip,
 * Continue).
 *
 * TODO(i18n): chrome strings are inline English, translated in a later pass
 * (matching the step components).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { AgentProvider } from "@otto-code/protocol/agent-types";
import { persistAppSettings, useAppSettings, type InterfaceMode } from "@/hooks/use-settings";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { getActiveAgentTeam } from "@otto-code/protocol/agent-teams";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useEarliestOnlineHostServerId } from "@/app/_layout";
import { useHosts } from "@/runtime/host-runtime";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { Button } from "@/components/ui/button";
import { WelcomeStep } from "./welcome-step";
import { InterfaceModeStep } from "./interface-mode-step";
import { ProvidersStep } from "./providers-step";
import { TeamStep, type TeamStepHandle } from "./team-step";
import { DoneStep } from "./done-step";

// The ordered step list: Welcome → Mode → Providers → Team → Done. The Team step
// (generative — Otto builds a themed team for the kind you pick) is additive: it
// appends to the host's roster/teams, never deletes, and feature-gates + skips
// gracefully on old hosts.
const STEP_SEQUENCE = ["welcome", "mode", "providers", "team", "done"] as const;
type WizardStep = (typeof STEP_SEQUENCE)[number];

// Which steps get the shared chrome (progress / Back / Skip / Continue). The
// brand bookends own their own layout and buttons instead.
const MIDDLE_STEPS = new Set<WizardStep>(["mode", "providers", "team"]);

export function SetupWizardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const [primaryProvider, setPrimaryProvider] = useState<AgentProvider | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const teamStepRef = useRef<TeamStepHandle>(null);

  const {
    settings: { interfaceMode },
  } = useAppSettings();

  const earliestOnlineServerId = useEarliestOnlineHostServerId();
  const hosts = useHosts();

  // Guard: the providers step (step 2) calls useProvidersSnapshot() which needs a
  // live host connection. If no host is online, redirect to /welcome so the user can
  // connect one first, rather than freezing the wizard indefinitely.
  useEffect(() => {
    if (!earliestOnlineServerId && hosts.length === 0) {
      router.replace("/welcome");
    }
  }, [earliestOnlineServerId, hosts.length, router]);

  const serverId = earliestOnlineServerId ?? hosts[0]?.serverId ?? null;
  const { entries } = useProvidersSnapshot(serverId);
  const { config } = useDaemonConfig(serverId);

  const step = STEP_SEQUENCE[stepIndex];
  const isMiddleStep = MIDDLE_STEPS.has(step);

  // Reserve room on the right for the desktop window-controls (min/max/close)
  // overlay so the Skip button doesn't sit underneath them. Zero on native/web.
  const windowControls = useWindowControlsPadding("detailHeader");

  const chromeStyle = useMemo(
    () => [styles.chrome, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }],
    [insets.top, insets.bottom],
  );

  const headerStyle = useMemo(
    () => [styles.header, windowControls.right > 0 ? { paddingRight: windowControls.right } : null],
    [windowControls.right],
  );

  const goNext = useCallback(() => {
    setStepIndex((index) => Math.min(index + 1, STEP_SEQUENCE.length - 1));
  }, []);

  // "Continue" for the team step first commits whatever the user staged there (a
  // selected-but-not-yet-added generated team) so moving forward actually creates
  // it, then advances. Every other step advances straight away.
  const handleContinue = useCallback(() => {
    if (step !== "team" || !teamStepRef.current) {
      goNext();
      return;
    }
    setIsCommitting(true);
    void (async () => {
      try {
        await teamStepRef.current?.commitPending();
      } finally {
        setIsCommitting(false);
        goNext();
      }
    })();
  }, [step, goNext]);

  const goBack = useCallback(() => {
    setStepIndex((index) => Math.max(index - 1, 0));
  }, []);

  // Finish the wizard and go home. The in-app tutorial is disabled for now, so we
  // also mark it complete to keep the home-screen auto-launch from firing.
  const completeWizard = useCallback(() => {
    void persistAppSettings({ hasCompletedSetupWizard: true, hasCompletedTutorial: true });
    router.replace(buildOpenProjectRoute());
  }, [router]);

  const skipWizard = completeWizard;
  const finishWizard = completeWizard;

  const handleSelectMode = useCallback((mode: InterfaceMode) => {
    // Persist immediately so the rest of the wizard renders at the chosen depth.
    void persistAppSettings({ interfaceMode: mode });
  }, []);

  const primaryProviderLabel = useMemo(
    () => (primaryProvider ? resolveProviderLabel(primaryProvider, entries) : null),
    [primaryProvider, entries],
  );

  const rosterCount = config?.agentPersonalities?.personalities?.length ?? 0;
  const activeTeamName = useMemo(
    () => getActiveAgentTeam(config?.agentTeams)?.name ?? null,
    [config],
  );

  const canContinue = step === "mode" ? interfaceMode !== null : true;

  const renderStep = () => {
    switch (step) {
      case "welcome":
        return <WelcomeStep onStart={goNext} onSkip={skipWizard} />;
      case "mode":
        return <InterfaceModeStep selected={interfaceMode} onSelect={handleSelectMode} />;
      case "providers":
        return (
          <ProvidersStep
            serverId={serverId}
            primaryProvider={primaryProvider}
            onSelectPrimary={setPrimaryProvider}
          />
        );
      case "team":
        return (
          <TeamStep
            ref={teamStepRef}
            serverId={serverId}
            provider={primaryProvider}
            interfaceMode={interfaceMode ?? "developer"}
          />
        );
      case "done":
        return (
          <DoneStep
            interfaceMode={interfaceMode ?? "developer"}
            primaryProviderLabel={primaryProviderLabel}
            rosterCount={rosterCount}
            activeTeamName={activeTeamName}
            onFinish={finishWizard}
          />
        );
    }
  };

  if (!isMiddleStep) {
    // Brand bookends fill the screen and own their own buttons.
    return (
      <View style={styles.root}>
        <TitlebarDragRegion />
        {renderStep()}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <TitlebarDragRegion />
      <View style={chromeStyle}>
        <View style={headerStyle}>
          <StepProgress total={STEP_SEQUENCE.length} current={stepIndex} />
          <Button variant="ghost" size="sm" onPress={skipWizard} testID="setup-skip">
            Skip setup
          </Button>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          {renderStep()}
        </ScrollView>

        <View style={styles.footer}>
          <Button variant="outline" size="lg" onPress={goBack} testID="setup-back">
            Back
          </Button>
          <Button
            variant="default"
            size="lg"
            onPress={handleContinue}
            loading={isCommitting}
            disabled={!canContinue || isCommitting}
            testID="setup-continue"
          >
            Continue
          </Button>
        </View>
      </View>
    </View>
  );
}

type DotState = "active" | "done" | "todo";

function dotState(index: number, current: number): DotState {
  if (index === current) {
    return "active";
  }
  if (index < current) {
    return "done";
  }
  return "todo";
}

function StepProgress({ total, current }: { total: number; current: number }) {
  const dots = useMemo(() => Array.from({ length: total }, (_, index) => index), [total]);
  return (
    <View style={styles.progress} accessibilityRole="progressbar">
      {dots.map((index) => (
        <ProgressDot key={index} state={dotState(index, current)} />
      ))}
    </View>
  );
}

function ProgressDot({ state }: { state: DotState }) {
  const style = useMemo(() => {
    if (state === "active") {
      return [styles.dot, styles.dotActive];
    }
    if (state === "done") {
      return [styles.dot, styles.dotDone];
    }
    return styles.dot;
  }, [state]);
  return <View style={style} />;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  chrome: {
    flex: 1,
    paddingHorizontal: { xs: theme.spacing[4], md: theme.spacing[6] },
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    marginBottom: theme.spacing[4],
  },
  progress: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.border,
  },
  dotActive: {
    backgroundColor: theme.colors.accent,
    width: 22,
  },
  dotDone: {
    backgroundColor: theme.colors.accent,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: theme.spacing[6],
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    marginTop: theme.spacing[4],
  },
}));
