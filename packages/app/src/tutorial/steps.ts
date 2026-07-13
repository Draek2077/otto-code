import type { Router } from "expo-router";
import type { TutorialAnchorId } from "./anchor-registry";

// The reactive app state the controller feeds to advanceWhen predicates. Kept
// tiny and route/panel-derived so predicates never couple to feature stores.
export interface TutorialAppState {
  pathname: string;
  isExplorerOpen: boolean;
  // Total registered projects across all hosts (workspaces + empty projects).
  // Adding a project in Otto does NOT navigate — it just registers a directory
  // in the sidebar — so this count is the only signal that "create a project"
  // succeeded.
  projectCount: number;
}

// Benign staging actions a step may run before its target is spotlighted. The
// tour never performs the meaningful create/open/chat action here — the user
// does that on the real highlighted control.
export interface TutorialEnterCtx {
  router: Router;
  isCompact: boolean;
  openSidebar: () => void;
  openComposer: () => void;
  goHome: () => void;
}

export interface TutorialStep {
  id: string;
  // Anchor to spotlight; omit for a centered explainer card (no cutout).
  anchorId?: TutorialAnchorId;
  titleKey: string;
  bodyKey: string;
  hintKey?: string;
  // Informational slide: advances when the dim/card is tapped.
  advanceOnTap?: boolean;
  // Action slide: advances when this predicate flips true (user did the thing).
  advanceWhen?: (state: TutorialAppState) => boolean;
  enter?: (ctx: TutorialEnterCtx) => void | Promise<void>;
  // If the target can't be measured (surface absent), skip instead of showing a
  // centered fallback card.
  optional?: boolean;
}

// The five canonical slides. Ordering makes a real workspace exist by the time
// Explorer/Chat come up: the user creates it in "create-project".
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "settings",
    anchorId: "settings",
    titleKey: "tutorial.steps.settings.title",
    bodyKey: "tutorial.steps.settings.body",
    hintKey: "tutorial.steps.settings.hint",
    enter: ({ isCompact, openSidebar }) => {
      if (isCompact) {
        openSidebar();
      }
    },
    advanceWhen: (s) => s.pathname.startsWith("/settings"),
  },
  {
    id: "create-project",
    anchorId: "add-project",
    titleKey: "tutorial.steps.createProject.title",
    bodyKey: "tutorial.steps.createProject.body",
    hintKey: "tutorial.steps.createProject.hint",
    // Return home so the "Add project" tile is on screen to point at.
    enter: ({ goHome }) => {
      goHome();
    },
    // Adding a project registers it in the sidebar (no route change), so advance
    // on the project count rising. On a device that already has projects this is
    // satisfied on entry → the controller turns it into a tap-to-advance slide.
    advanceWhen: (s) => s.projectCount > 0,
  },
  {
    id: "workspaces",
    anchorId: "workspaces",
    titleKey: "tutorial.steps.workspaces.title",
    bodyKey: "tutorial.steps.workspaces.body",
    enter: ({ isCompact, openSidebar }) => {
      if (isCompact) {
        openSidebar();
      }
    },
    advanceOnTap: true,
  },
  {
    id: "explorer",
    anchorId: "explorer-toggle",
    titleKey: "tutorial.steps.explorer.title",
    bodyKey: "tutorial.steps.explorer.body",
    hintKey: "tutorial.steps.explorer.hint",
    advanceWhen: (s) => s.isExplorerOpen,
    optional: true,
  },
  {
    id: "chat",
    anchorId: "chat-input",
    titleKey: "tutorial.steps.chat.title",
    bodyKey: "tutorial.steps.chat.body",
    hintKey: "tutorial.steps.chat.hint",
    enter: ({ isCompact, openComposer }) => {
      if (isCompact) {
        openComposer();
      }
    },
    // Final slide: tapping finishes the tour and leaves the user in the composer.
    advanceOnTap: true,
    optional: true,
  },
];
