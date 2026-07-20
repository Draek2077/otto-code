import { AppState } from "react-native";
import { isNative } from "@/constants/platform";

/**
 * Whether the app is on screen: foregrounded, and on web not in a hidden tab.
 *
 * Deliberately does NOT require window focus. Focus is lost to anything that
 * takes the caret out of the host document — an Electron `<webview>` (browser
 * pane, editor host), devtools, a second window — none of which make a visible
 * pane invisible. Gating work on focus stalls panes the user is looking at, so
 * anything answering "can this pane show something" belongs here rather than on
 * `getIsAppActivelyVisible`.
 */
export function getIsAppInForeground(appState: string = AppState.currentState): boolean {
  if (appState !== "active") {
    return false;
  }

  if (isNative) {
    return true;
  }

  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * The stricter question: is the user actually *looking at and interacting with*
 * the app right now? Adds window focus on top of foreground, which is what
 * clearing an agent's attention flag means — see `use-agent-attention-clear`.
 */
export function getIsAppActivelyVisible(appState: string = AppState.currentState): boolean {
  if (!getIsAppInForeground(appState)) {
    return false;
  }

  if (isNative) {
    return true;
  }

  return (
    typeof document === "undefined" ||
    typeof document.hasFocus !== "function" ||
    document.hasFocus()
  );
}
