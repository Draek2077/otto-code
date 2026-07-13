import { useEffect, useMemo, useRef } from "react";
import { useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { usePathname, useRouter } from "expo-router";
import { useIsCompactFormFactor } from "@/constants/layout";
import { selectIsFileExplorerOpen, usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { useLaunchTutorial } from "./use-launch-tutorial";
import { measureAnchorWithRetry, type MeasureCancelToken } from "./measure";
import { SpotlightOverlay } from "./spotlight-overlay";
import { TUTORIAL_STEPS, type TutorialAppState, type TutorialEnterCtx } from "./steps";
import { useTutorialStore } from "./store";

// Mounted once, app-global (in _layout's surface). Drives the one-time tour:
// stages each slide's benign navigation, waits for the real target to mount and
// settle, spotlights it, and advances when the user performs the real action
// (state-driven) or taps an informational slide. Renders nothing when idle.
export function TutorialController() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const isCompact = useIsCompactFormFactor();
  const { width: winW, height: winH } = useWindowDimensions();

  useLaunchTutorial();

  const status = useTutorialStore((s) => s.status);
  const stepIndex = useTutorialStore((s) => s.stepIndex);
  const rect = useTutorialStore((s) => s.rect);
  const next = useTutorialStore((s) => s.next);
  const exit = useTutorialStore((s) => s.exit);
  const complete = useTutorialStore((s) => s.complete);
  const setRect = useTutorialStore((s) => s.setRect);

  const isExplorerOpen = usePanelStore((s) => selectIsFileExplorerOpen(s, { isCompact }));

  // Total registered projects across all hosts. Returns a primitive so the
  // controller only re-renders when the count actually changes, not on every
  // (frequent) session-store update. Drives the "create a project" advance.
  const projectCount = useSessionStore((s) => {
    let count = 0;
    for (const session of Object.values(s.sessions)) {
      count += session.workspaces.size + session.emptyProjects.size;
    }
    return count;
  });

  // Dev-only manual trigger so the tour can be launched on demand for testing,
  // regardless of the completion flag or current route (which suppress the
  // auto-launch on an already-configured device). Call `ottoStartTutorial()`
  // from the JS console. No-op in production builds.
  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    const g = globalThis as Record<string, unknown>;
    g.ottoStartTutorial = () => {
      // Single atomic transition to a running step 0 (see store.relaunch): never
      // bounce through "idle", which would unmount/remount the overlay.
      useTutorialStore.setState({ status: "running", stepIndex: 0, rect: null });
    };
    return () => {
      delete g.ottoStartTutorial;
    };
  }, []);

  const running = status === "running";
  const step = running ? TUTORIAL_STEPS[stepIndex] : undefined;

  const appState = useMemo<TutorialAppState>(
    () => ({ pathname, isExplorerOpen, projectCount }),
    [pathname, isExplorerOpen, projectCount],
  );
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  // Whether the step's advanceWhen was already satisfied on entry. If so, no
  // state transition will fire, so we fall back to tap-to-advance.
  const initiallySatisfiedRef = useRef(false);

  // Complete once we run past the last step.
  useEffect(() => {
    if (running && !step) {
      complete();
    }
  }, [running, step, complete]);

  // Per-step lifecycle: stage (enter) → measure → reveal. Keyed on step identity
  // only; current app state is read via ref so state ticks don't re-run it.
  useEffect(() => {
    if (!running || !step) {
      return;
    }
    initiallySatisfiedRef.current = step.advanceWhen
      ? step.advanceWhen(appStateRef.current)
      : false;

    const cancel: MeasureCancelToken = { cancelled: false };
    const ctx: TutorialEnterCtx = {
      router,
      isCompact,
      openSidebar: () => usePanelStore.getState().openAgentListForLayout({ isCompact }),
      openComposer: () => usePanelStore.getState().showMobileAgent(),
      goHome: () => router.push(buildOpenProjectRoute()),
    };

    void (async () => {
      setRect(null);
      await Promise.resolve(step.enter?.(ctx));
      if (cancel.cancelled) {
        return;
      }
      if (!step.anchorId) {
        return; // centered explainer card
      }
      const measured = await measureAnchorWithRetry(step.anchorId, { cancel });
      if (cancel.cancelled) {
        return;
      }
      if (measured) {
        setRect(measured);
      } else if (step.optional) {
        next(); // surface absent (e.g. no workspace) → skip
      } else {
        setRect(null); // centered fallback
      }
    })();

    return () => {
      cancel.cancelled = true;
    };
  }, [running, stepIndex, step, router, isCompact, setRect, next]);

  // State-driven advance: predicate flips true (user did the real action).
  useEffect(() => {
    if (!running || !step?.advanceWhen || initiallySatisfiedRef.current) {
      return;
    }
    if (step.advanceWhen(appState)) {
      next();
    }
  }, [running, step, appState, next]);

  // Keep the spotlight glued to its target across resize / orientation, without
  // re-running enter(). Only re-measures a slide that's already showing a hole.
  useEffect(() => {
    const anchorId = step?.anchorId;
    if (!running || !anchorId || !rect) {
      return;
    }
    const cancel: MeasureCancelToken = { cancelled: false };
    void (async () => {
      const measured = await measureAnchorWithRetry(anchorId, { cancel, timeoutMs: 800 });
      if (!cancel.cancelled && measured) {
        setRect(measured);
      }
    })();
    return () => {
      cancel.cancelled = true;
    };
    // rect is intentionally excluded: we react to size changes, not our own writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winW, winH, running, step, setRect]);

  if (!running || !step) {
    return null;
  }

  const advanceOnTap = Boolean(step.advanceOnTap) || initiallySatisfiedRef.current;

  return (
    <SpotlightOverlay
      rect={rect}
      stepKey={step.id}
      title={t(step.titleKey)}
      body={t(step.bodyKey)}
      hint={step.hintKey ? t(step.hintKey) : undefined}
      stepLabel={`${stepIndex + 1} / ${TUTORIAL_STEPS.length}`}
      exitLabel={t("tutorial.exit")}
      advanceOnTap={advanceOnTap}
      onAdvance={next}
      onExit={exit}
    />
  );
}
