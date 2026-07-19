# WP-F · Settings placement audit — findings

Status: **audit complete**. Every setting surfaced in the app was enumerated and
classified against the placement rule (daemon behavior → Host settings via
`useDaemonConfig`/`patchConfig`; client presentation → App settings via
`useAppSettings`/AsyncStorage, device-local).

**Result: no misplacements. Zero code corrections applied** — every setting is
already on the correct side of the line, and the known `promptSuggestions`
straddle reads cleanly and non-contradictorily. Two enhancement-level items are
flagged for decision (neither is a placement bug). Since nothing was changed,
there were no files to typecheck/lint.

Method notes:

- Cross-contamination check A: no `patchConfig`/`useDaemonConfig` (daemon writes)
  appear anywhere under `screens/settings/appearance/` or in
  `visualizer-section.tsx` — App pages never mutate daemon config.
- Cross-contamination check B: the only `updateSettings(...)` in `host-page.tsx`
  are `useDesktopSettings().updateSettings({ daemon: { manageBuiltInDaemon } })`
  in the localhost-removal rollback — desktop-managed daemon _lifecycle_, not an
  App presentation setting leaking into a Host page. Correct.
- WP-A's new cards (`OttoToolsSection`, `AgentBehaviorCards`,
  `MetadataGenerationCards`) are correct by construction and were not re-audited.

---

## 1. The `promptSuggestions` straddle — render vs. generation split (CONFIRMED CLEAN)

| Half           | Field                                              | Placement                          | Copy                                                                                                                                         | Reads                                                                            |
| -------------- | -------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Generation** | `agentBehaviors.promptSuggestions` (daemon)        | Host / `AgentBehaviorCards` (WP-A) | "Let capable providers predict a next prompt after each turn. **Costs extra tokens per turn.**"                                              | Whether the daemon spends tokens generating the suggestion.                      |
| **Render**     | `promptSuggestionsEnabled` (app, `storage.ts:113`) | App / Appearance→Agents            | "After a turn, show the agent's predicted next prompt as ghost text in the message box; press Tab to accept it. Available on Claude agents." | Whether _this device_ displays the ghost text. Consumed in `composer/index.tsx`. |

The split is **not duplicated and not contradictory**:

- daemon-off ⇒ nothing generated ⇒ nothing to show (render toggle is moot). OK.
- daemon-on / render-off ⇒ generated but hidden on this device. Inherent to the
  device-local-render vs daemon-generation design; the render hint deliberately
  does **not** claim to save tokens, so it can't mislead a user into thinking the
  app toggle controls cost. The cost lever is the daemon toggle, correctly in Host.

No change required. See flag F-1 below for an optional UX polish.

## 2. Full setting inventory → placement

### 2a. Host settings (daemon config, `host-page.tsx` — all via `useDaemonConfig`/`patchConfig`)

| Setting (daemon field)                         | Card / Section                               | Correct placement | Action    |
| ---------------------------------------------- | -------------------------------------------- | ----------------- | --------- |
| `mcp.injectIntoAgents`                         | InjectOttoToolsCard (Agents)                 | Host              | ok        |
| `browserTools.enabled`                         | BrowserToolsOptInCard (Agents)               | Host              | ok        |
| `appendSystemPrompt`                           | AppendSystemPromptCard (Agents)              | Host              | ok        |
| `agentBehaviors.promptSuggestions`             | AgentBehaviorCards (Agents)                  | Host              | ok (WP-A) |
| `agentBehaviors.agentProgressSummaries`        | AgentBehaviorCards (Agents)                  | Host              | ok (WP-A) |
| `agentBehaviors.notifyOnFinishDefault`         | AgentBehaviorCards (Agents)                  | Host              | ok (WP-A) |
| `metadataGeneration.enabled`                   | MetadataGenerationCards (Agents)             | Host              | ok (WP-A) |
| `metadataGeneration.preferWriterPersonalities` | MetadataGenerationCards (Agents)             | Host              | ok (WP-A) |
| `mcp.toolGroups`                               | OttoToolsSection                             | Host              | ok (WP-A) |
| `autoArchiveAfterMerge`                        | AutoArchiveMergedWorkspacesCard (Workspaces) | Host              | ok        |
| `enableTerminalAgentHooks`                     | EnableTerminalAgentHooksCard (Terminals)     | Host              | ok        |
| `terminalProfiles`                             | TerminalProfilesSection (Terminals)          | Host              | ok        |
| Speech (voice/model)                           | SpeechSettingsCards (Agents)                 | Host              | ok        |
| Git providers                                  | GitProvidersSettingsCards (Workspaces)       | Host              | ok        |
| Providers / Personalities / Teams              | Providers, Agents sections                   | Host              | ok        |

### 2b. App settings (device-local presentation, `storage.ts` `AppSettings` — via `useAppSettings`)

Grouped for brevity; all classified **presentation → App, correctly placed (ok)** unless noted.

| Group                  | Fields                                                                                                                                                                                    | Notes                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Theme / fonts          | `colorSchemeMode`, `lightTheme`, `darkTheme`, `syntaxTheme`, `uiFontFamily`, `monoFontFamily`, `uiFontSize`, `codeFontSize`, `textEffectTheme`, `chatBubbleGradient`, `animationsEnabled` | Pure presentation.                                                                                                                                                                                                                                                       |
| Locale / UI            | `language`, `interfaceMode`, `appStartScreen`, `compactSidebarTopSpacing`, `workspaceToolsPlacement`, `teamSwitcherPlacement`, `defaultTabOrientation`, `chatWidth`, `blackTabBackground` | `teamSwitcherPlacement` explicitly documents the split (active team itself is host-scoped daemon config — correct).                                                                                                                                                      |
| Chat rendering         | `autoExpandReasoning`, `groupConsecutiveActions`, `hidePinnedToolbarOptions`, `hideChatMessageDetails`, `chatTimestampDisplay`, `wrapCodeLines`, `autoClearCompletedSubagents`            | Presentation only; no daemon effect.                                                                                                                                                                                                                                     |
| Composer behavior      | `sendBehavior`                                                                                                                                                                            | Device-local **default** for per-send `delivery` (interrupt/queue) passed on `send_agent_prompt`. Not daemon-persisted policy. ok.                                                                                                                                       |
| Straddle render halves | `promptSuggestionsEnabled`, `rateLimitWarningsEnabled`                                                                                                                                    | `rateLimitWarnings`: daemon emits events regardless; app only chooses to render the strip → App is correct, no generation half needed. `promptSuggestions`: see §1.                                                                                                      |
| Voice                  | `voiceThinkingTone`                                                                                                                                                                       | Device-local audio playback gate. ok. (Speech _engine_ config is daemon/Host — correctly separate.)                                                                                                                                                                      |
| Link opening           | `serviceUrlBehavior`, `linkOpenBehavior`                                                                                                                                                  | Client link-routing (in-app pane vs system browser). Presentation. ok.                                                                                                                                                                                                   |
| Terminal               | `terminalScrollbackLines`                                                                                                                                                                 | Client xterm buffer depth, not daemon PTY. Presentation. ok.                                                                                                                                                                                                             |
| Preview lifecycle      | `previewServerCloseBehavior`, `previewAutoStartOnRestore`                                                                                                                                 | **Borderline — see flag F-2.** Trigger daemon actions but are client-event-driven.                                                                                                                                                                                       |
| Onboarding             | `hasCompletedTutorial`, `hasCompletedSetupWizard`                                                                                                                                         | Per-device one-time flags. ok.                                                                                                                                                                                                                                           |
| Suggested tasks        | `suggestedTasksEnabled`, `suggestedTasksDefaultMode`                                                                                                                                      | Analogous to `promptSuggestions` render half: off suppresses the _card_ on this device; the `spawn_task` tool still runs. No cost-bearing generation to gate on the daemon, so App-only is correct (unlike prompt suggestions, there is no wasted token generation). ok. |
| Visualizer             | `visualizerPanel*`, `visualizerRender*`, `visualizerNodeShape`, `visualizerSound*`, `visualizerVoiceCues`, `visualizerHudHidden`, `visualizerShowFps`                                     | All device-local canvas/render config seeded to the vendored page via the bridge. Presentation. ok.                                                                                                                                                                      |
| Feature registry       | `featureEnabled`                                                                                                                                                                          | Device-local gated-feature map (React.lazy exclusion). Presentation. ok.                                                                                                                                                                                                 |

### 2c. Desktop-owned (merged into `Settings`, handled by `useDesktopSettings`, not daemon config)

| Setting               | Placement                      | Action                                            |
| --------------------- | ------------------------------ | ------------------------------------------------- |
| `manageBuiltInDaemon` | Desktop settings (App/desktop) | ok — desktop daemon lifecycle, not daemon config. |
| `releaseChannel`      | Desktop settings (App/desktop) | ok — app updater channel.                         |

---

## 3. Flagged for decision (neither is a placement bug — both optional enhancements)

- **F-1 (copy/UX, low value):** The App render toggle `promptSuggestionsEnabled`
  and the Host generation toggle `agentBehaviors.promptSuggestions` are on
  different settings pages (Appearance→Agents vs Host→Agents). A user who turns
  the _render_ toggle off to "stop suggestions" still pays generation tokens
  until they also turn off the daemon toggle. Not contradictory (the render hint
  doesn't mention cost), but a one-line cross-reference in the render hint
  ("turn off generation in Host settings to also stop the token cost") could
  reduce confusion. Deferred — it's copy-only and touches i18n; out of the
  low-risk-code-correction scope, and arguably not worth the i18n churn.

- **F-2 (placement judgment call):** `previewServerCloseBehavior` (stop-on-close)
  and `previewAutoStartOnRestore` are currently App/device-local
  (`storage.ts:132-133`). They **trigger daemon actions** (`previewStop` on tab
  close in `workspace-screen.tsx:2429-2436`; `startPreviewFlow` on restore in
  `browser-pane.electron.tsx:799-803`), which by the literal rule points at Host.
  **Recommendation: leave as App (device-local).** The trigger is an inherently
  per-device event (this device closed this tab / restored this workspace), and a
  daemon-global "stop on close" could kill a server another paired device relies
  on. This is a client-action _policy_, legitimately device-local — not daemon
  state. Flagging only because it's the one place the "changes daemon behavior"
  heuristic and the "device-local trigger" reality diverge; a maintainer may want
  to record the decision explicitly rather than have it re-surface each audit.

## 4. Conclusion

The daemon-vs-app placement discipline is holding across the whole surface. WP-A's
new cards landed correctly, the `promptSuggestions` render/generation split is
clean, and no existing setting sits on the wrong side. No corrections were needed
or applied, so the working tree is unchanged apart from this findings file.
