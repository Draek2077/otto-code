import type { BrainStateInput } from "./input";
import {
  deriveBrainActivity,
  deriveBrainState,
  resolveBrainActivityLabel,
  resolveBrainRailLabel,
  resolveBrainRailPresentation,
  shouldShowBrainRail,
  type BrainRailActivity,
  type BrainState,
} from "./state";

export const BRAIN_UI_BRIDGE_VERSION = 1;

export interface BrainUiSnapshot {
  serverId: string;
  enabled: boolean | undefined;
  connection: "connecting" | "connected" | "disconnected";
  status: BrainStateInput | null;
}

/** One parent-owned, demand-driven store shared by screen, header and footer. */
export interface BrainUiBridge {
  version: typeof BRAIN_UI_BRIDGE_VERSION;
  /** Referentially stable until the selected host's snapshot changes. */
  getSnapshot: () => BrainUiSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Acquire host status demand; cleanup releases only this consumer. */
  retainStatus: () => () => void;
  openBrain: () => void;
  openSettings: () => void;
}

export interface BrainUiPresentation {
  state: BrainState;
  activity: BrainRailActivity;
  label: string;
  visible: boolean;
  disabled: boolean;
}

export function presentBrainSnapshot(snapshot: BrainUiSnapshot): BrainUiPresentation {
  let state: BrainState;
  if (snapshot.connection === "connected") {
    state = deriveBrainState(snapshot.status);
  } else {
    state = "unreachable";
  }
  const presentation = resolveBrainRailPresentation(state, snapshot.enabled);
  const canShowActivity = !presentation.disabled && snapshot.connection === "connected";
  const activity: BrainRailActivity = canShowActivity
    ? deriveBrainActivity(snapshot.status)
    : { kind: "single", state: presentation.state };
  const label = presentation.disabled
    ? resolveBrainRailLabel(presentation)
    : resolveBrainActivityLabel(activity);
  return {
    state: presentation.state,
    activity,
    label,
    visible: shouldShowBrainRail(snapshot.enabled),
    disabled: presentation.disabled,
  };
}
