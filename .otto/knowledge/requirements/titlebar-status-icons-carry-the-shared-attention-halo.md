---
id: "titlebar-status-icons-carry-the-shared-attention-halo"
kind: "requirement"
title: "Title-bar status icons carry the shared attention halo"
status: "proposed"
tags: ["app","ui","workspace","status","visual-design"]
created_at: "2026-08-21T04:44:40.433Z"
updated_at: "2026-08-21T04:44:40.433Z"
---
# Title-bar status icons carry the shared attention halo

<!-- compiled_truth -->

Workspace title-bar icons that report a green, amber, or red state render the same `StatusPulseGlow` halo the chat attention status buckets use, on the same tuning: pulsing when Appearance -> Animations is on, and held at the pulse peak when animations are off. Three icons qualify today, and they are the only three title-bar glyphs with tri-state colour: Zoom team chat presence, the Zoom meeting recorder, and the wake word listener.

The halo is never derived from state a second time. Each call site resolves the colour its glyph is about to use, then hands that exact colour to `notifyHaloColor(theme, glyphColor)`, which passes it through only when it is one of the three notify tones and returns null otherwise. Glyph and halo therefore resolve from one theme pass and cannot drift when a state is added or recoloured, which is the same rule `status-bucket-icon.tsx` follows.

Resting states get no halo, deliberately. That covers muted grey (away, offline, pending, disconnected, wake word idle) and the recorder's blue `statusInfo` tone, which means "working on it" rather than "look at me". A halo around grey does not read as a halo, and a halo around every state reports nothing.

## Timeline

- time: "2026-08-21T04:44:40.433Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["chat-status-halos-are-compact-and-soft","august-20-ux-feedback-sweep"]
- time: "2026-08-21T04:44:40.433Z"
  kind: "evidence"
  summary: "Requested by the user on 2026-08-20: \"I like the idea of adding glow to the title bar icons that have green/amber/red states. with pulse, animated or frozen like the other ones we did.\" The \"other ones\" are the chat attention status buckets recorded in [[chat-status-halos-are-compact-and-soft]], whose tuning (1.75x extent, softened four-stop falloff, static path held at the pulse peak) this reuses rather than re-derives.\n\nImplemented in `packages/app/src/components/status-pulse-glow.tsx` (new exported `notifyHaloColor`), `packages/app/src/screens/workspace/team-chat-titlebar.tsx` (`ZoomTeamChatTitleGlyph` and `ZoomRecorderGlyph`, both wrapped with `withUnistyles`), and `packages/app/src/voice/workspace-wake-word-button.tsx` (`WakeWordGlyph`).\n\nAn earlier pass in this same batch wired a `tone`-based variant of the halo into these three icons and was lost from the shared checkout before it was committed; the component survived and was retuned for the chat buckets with a `color`-based API. This record exists partly so the title-bar half is not mistaken for the chat half again. App typecheck, focused lint, and format clean. Not visually verified in the running app: the halo is drawn at 1.75x the glyph, so a title-bar trigger slot carrying `overflow: hidden` would clip it."
