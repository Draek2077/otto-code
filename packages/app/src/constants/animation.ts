// Shared motion timings for the app-wide "Animations" setting (Appearance →
// Animations). One place so page transitions and sidebar slides stay in sync;
// tune here, not at the call sites. Kept deliberately short — these are chrome
// transitions, not showpieces, and a long duration reads as sluggish when you
// are switching pages rapidly.

// Duration of the visible page transition (RouteFadeContainer). Driven per
// platform, never by the native-stack `animation` prop (react-native-screens
// ignores stack animations on web/Electron):
//   - Native: Reanimated fades the routed content up through the themed surface0
//     backdrop over this duration.
//   - Web/Electron: a surface0 veil REVEALS (fades back out) over this duration.
//     Web uses a CSS-transition veil, not a JS-thread opacity animation, because
//     the heavy target screens (Settings, the Workspace deck) block the JS thread
//     while they mount — which would starve any rAF-driven fade and make it
//     choppy. The compositor-driven veil stays smooth regardless of mount cost.
export const PAGE_TRANSITION_DURATION_MS = 300;

// When a transition targets a workspace, the reveal is HELD until that
// workspace's panes have actually mounted (RouteFadeContainer gates the reveal on
// a readiness signal) — otherwise the veil lifts on the bare shell and the panes
// pop in a beat later. This is the safety net: if a workspace never reports ready
// (unexpected gate, disconnected host), reveal anyway after this long so the veil
// can never get stuck covering the screen. Comfortably longer than a normal cold
// mount, short enough to not read as a hang.
export const PAGE_TRANSITION_MAX_HOLD_MS = 1500;

// Open/close slide for the desktop left (agent list) and right (file explorer)
// sidebars. Mobile sidebars already slide via the gesture-driven panel model
// (mobile-panels/presentation.tsx) and do not use this.
export const SIDEBAR_SLIDE_DURATION_MS = 180;
