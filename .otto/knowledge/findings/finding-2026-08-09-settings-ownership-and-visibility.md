---
id: "finding-2026-08-09-settings-ownership-and-visibility"
kind: "finding"
title: "Settings ownership and visibility catalog"
status: "confirmed"
tags: ["finding","settings-catalog"]
created_at: "2026-08-16T22:16:11.514Z"
updated_at: "2026-08-20T05:37:30.799Z"
---
# Settings ownership and visibility catalog

<!-- compiled_truth -->

Date: 2026-08-09  
Question: Which settings belong to the local App versus a remote Host, and how should they be classified for future User/Developer and Essential/Advanced presentation?

## Method

This is a static inventory of the settings UI and persistence contracts at this revision.

- App UI: `packages/app/src/screens/settings-screen.tsx` and `packages/app/src/screens/settings/**`.
- Local persistence: `packages/app/src/hooks/use-settings/storage.ts`, `update-routing.ts`, and `packages/app/src/desktop/settings/desktop-settings.ts`.
- Host persistence: `packages/protocol/src/messages.ts` (`MutableDaemonConfigSchema` and patch schema), plus the host settings components.
- User-facing names and descriptions: `packages/app/src/i18n/resources/en.ts`.

The inventory distinguishes editable settings from informational or destructive actions. It does not count every provider-specific model or connector field as a separate top-level setting, but it does count the owning setting group and its editable fields.

## Ownership rule

The current implementation has three persistence scopes, not two:

| Scope   | Meaning                                                                                 | Current examples                                                                        |
| ------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| App     | Stored on the current device and affects this client only                               | theme, layout, chat presentation, language, local audio volume                          |
| Desktop | Stored by the Electron wrapper on this computer                                         | built-in daemon management, tray behavior, quit warnings, release channel               |
| Host    | Stored by the daemon in `OTTO_HOME` and shared by every client connected to that daemon | providers, personalities, tools, LSP, terminal profiles, speech engines, storage policy |

The existing App/Host labels should either expose Desktop as a clearly named App subsection, or rename the top-level concept to `This device` and `Host`. Calling Desktop settings App settings is technically understandable but hides an important platform constraint.

## App catalog

All rows below are device-local unless noted. `Essential` means a normal user may reasonably need it to make Otto behave as expected. `Advanced` means it should be hidden behind the Developer interface or an explicit advanced reveal by default.

| Area                 | Settings                                                                                                                                                                                                    | Category and brief description                                                                                     | Audience / visibility                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| General              | `interfaceMode`                                                                                                                                                                                             | Experience depth: User hides developer tools; Developer exposes files, diffs, terminals, Git, and search           | User, Essential                                                       |
| General              | `appStartScreen`                                                                                                                                                                                            | Startup destination: last workspace, Home, or Dashboard                                                            | User, Essential                                                       |
| General              | `language`                                                                                                                                                                                                  | App language or system language                                                                                    | User, Essential                                                       |
| General              | `sendBehavior`                                                                                                                                                                                              | Enter interrupts a running agent or queues the message                                                             | User, Essential                                                       |
| General              | `serviceUrlBehavior`                                                                                                                                                                                        | Where URLs emitted by running services open                                                                        | User, Essential                                                       |
| General              | `linkOpenBehavior`                                                                                                                                                                                          | Whether chat links open in Otto or an external browser                                                             | User, Essential                                                       |
| General              | `toolCallDetailLevel`                                                                                                                                                                                       | Timeline detail level: summary or full tool-call cards                                                             | User, Essential                                                       |
| General              | `promptSuggestionsEnabled`                                                                                                                                                                                  | Show provider-supported predicted next prompts in the composer                                                     | User, Advanced                                                        |
| General              | `rateLimitWarningsEnabled`                                                                                                                                                                                  | Show provider plan usage warnings above the composer                                                               | User, Essential                                                       |
| General              | `contextWarningsEnabled`, `contextWindowTokens`                                                                                                                                                             | Show context pressure warnings and remember the comparison window                                                  | User, Advanced                                                        |
| General              | `terminalScrollbackLines`                                                                                                                                                                                   | Number of terminal output lines retained in the client buffer                                                      | Developer, Advanced                                                   |
| General              | `mountedWorkspaceLimit`, `mountedTabLimit`                                                                                                                                                                  | Client memory/performance limits for retained workspace trees and tabs                                             | Developer, Advanced                                                   |
| General              | `previewServerCloseBehavior`, `previewAutoStartOnRestore`                                                                                                                                                   | Whether preview servers stop with tabs and restart when restored                                                   | Developer, Advanced                                                   |
| Agents and chats     | `autoExpandReasoning`                                                                                                                                                                                       | Expand reasoning blocks by default                                                                                 | User, Advanced                                                        |
| Agents and chats     | `groupConsecutiveActions`, `hideChatMessageDetails`, `chatTimestampDisplay`, `textEffectTheme`, `chatBubbleGradient`, `wrapCodeLines`                                                                       | Chat timeline grouping, chrome density, timestamp format, activity animation, bubble decoration, and code wrapping | User, Advanced                                                        |
| Agents and chats     | `chatMetricsBar`, `clientResourceBarAllPages`                                                                                                                                                               | Show token/cost metrics and the client resource monitor bar                                                        | Developer, Advanced                                                   |
| Agents and chats     | `autoClearCompletedSubagents`, `autoClearCompletedBackgroundTasks`, `autoClearFailedBackgroundTasks`                                                                                                        | Automatically remove settled rows from activity tracks                                                             | User, Advanced                                                        |
| Agents and chats     | `suggestedTasksEnabled`, `suggestedTasksDefaultMode`, `pinnedTaskListEnabled`, `pinnedTaskListAutoDismiss`                                                                                                  | Control suggested follow-up cards and the live task checklist                                                      | User, Advanced                                                        |
| Appearance           | `colorSchemeMode`, `lightTheme`, `darkTheme`                                                                                                                                                                | Color mode and selected light/dark visual theme                                                                    | User, Essential                                                       |
| Appearance           | `animationsEnabled`                                                                                                                                                                                         | Enable or disable app chrome motion                                                                                | User, Advanced                                                        |
| Appearance           | `compactSidebarTopSpacing`, `workspaceToolsPlacement`, `chatWidth`, `hidePinnedToolbarOptions`, `defaultTabOrientation`, `verticalTabRailWidth`, `teamSwitcherPlacement`                                    | Desktop/sidebar density, tool placement, chat width, tab orientation, rail width, and team-switcher placement      | User, Advanced                                                        |
| Appearance           | `uiFontFamily`, `uiFontSize`, `monoFontFamily`, `codeFontSize`, `terminalFontSize`, `fontContrast`                                                                                                          | Interface, code, and terminal typography                                                                           | User, Essential for accessibility, otherwise Advanced                 |
| Appearance           | `syntaxTheme`, `rulerEnabled`, `rulerColumn`                                                                                                                                                                | Code highlighting and editor column ruler                                                                          | Developer, Advanced                                                   |
| Audio                | `voicePlaybackVolume`, `voiceThinkingTone`, `agentAutoSpeechEnabled`                                                                                                                                        | Playback loudness, waiting tone, and per-chat auto-speech                                                          | User, Advanced                                                        |
| Audio                | `agentVoiceCues`, `agentVoiceCuesVolume`, `agentVoiceCuesMuted`                                                                                                                                             | Personality lifecycle voice cues and their device-local volume/mute                                                | User, Advanced                                                        |
| Voice input          | `wakeWordEnabled`, `wakeWordPhrase`, `wakeWordSensitivity`, `wakeWordSilenceTimeoutMs`, `wakeWordAutoSend`, `wakeWordListeningPaused`                                                                       | Local wake-word detector and hands-free send behavior                                                              | User, Advanced; microphone/privacy-sensitive                          |
| Visualizer           | `visualizerSurface`, `visualizerPipOpen`, `visualizerPipSize`, `visualizerPipX`, `visualizerPipY`, `visualizerHudHidden`                                                                                    | Visualizer surface, PIP state, size, position, and chrome visibility                                               | User, Advanced                                                        |
| Visualizer           | `visualizerPanelTimeline`, `visualizerPanelFileAttention`, `visualizerPanelCostOverlay`, `visualizerPanelStats`                                                                                             | Optional information panels and stats overlay                                                                      | User, Advanced                                                        |
| Visualizer           | `visualizerRenderQuality`, `visualizerNodeShape`, `visualizerContextDisplay`, `visualizerRenderBloom`, `visualizerRenderNodeGlow`, `visualizerRenderStars`, `visualizerRenderBackdrop`, `visualizerShowFps` | Rendering quality, node/readout style, decorative layers, and FPS diagnostic                                       | User, Advanced; FPS is Developer                                      |
| Visualizer           | `visualizerSoundVolume`, `visualizerSoundMuted`                                                                                                                                                             | Visualizer sound-effects level and mute                                                                            | User, Advanced                                                        |
| Feature controls     | `featureEnabled`                                                                                                                                                                                            | Sparse per-feature gates that prevent disabled feature code from loading                                           | Developer, Advanced                                                   |
| Editor               | `vimKeybindings`                                                                                                                                                                                            | Vim keybindings in the file editor                                                                                 | Developer, Advanced                                                   |
| Onboarding           | `interfaceMode`, `hasCompletedSetupWizard`, `hasCompletedTutorial`                                                                                                                                          | First-run mode and completion markers                                                                              | User, Essential for first run; completion flags are not user settings |
| Informational/action | Browser-data clear, diagnostics, reset wizard, app updates, connected-host list                                                                                                                             | Actions or status, not persistent preferences                                                                      | User, Essential access; do not mix into search results as settings    |

## Desktop catalog

These are currently rendered in the App settings surface but are persisted by the Electron desktop wrapper, not the shared App settings store.

| Settings                       | Category and brief description                               | Audience / visibility                          |
| ------------------------------ | ------------------------------------------------------------ | ---------------------------------------------- |
| `daemon.manageBuiltInDaemon`   | Whether this desktop manages the localhost daemon            | Developer, Advanced                            |
| `daemon.keepRunningAfterQuit`  | Leave the managed daemon running after the desktop app exits | Developer, Advanced                            |
| `tray.minimizeOnClose`         | Minimize to the system tray when the window closes           | User, Essential on supported desktop platforms |
| `tray.startMinimized`          | Start the desktop app minimized                              | User, Advanced                                 |
| `quit.warnBeforeQuit`          | Ask before quitting                                          | User, Essential                                |
| `quit.onlyWarnForActiveAgents` | Only show the quit warning when agents are active            | User, Advanced                                 |
| `releaseChannel`               | Stable or Beta desktop update channel                        | Developer, Advanced                            |

## Host catalog

Host settings are daemon-owned. They follow the host machine and are visible to every client with access to that daemon.

| Area                    | Settings                                                                                                                             | Category and brief description                                                                                | Audience / visibility                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Connections             | Host label, saved endpoint/auth connection, pair-device action                                                                       | Identify and connect to a daemon; saved connection data is App/device-local, while daemon state is Host-owned | User, Essential; split connection management from host configuration             |
| Orchestration           | `mcp.injectIntoAgents`, `mcp.toolGroups`, `appendSystemPrompt`                                                                       | Enable Otto tools for agents, choose globally available tool groups, and append a system prompt to all agents | Developer, Advanced                                                              |
| Agent behavior          | `agentBehaviors.promptSuggestions`, `agentProgressSummaries`, `notifyOnFinishDefault`, `todoNudge`, `todoReconcileOnIdle`            | Host-wide behavior defaults for agent sessions                                                                | Developer, Advanced                                                              |
| Providers               | `providers[*]` enabled state, provider connection URL/key, custom provider definition, models, model tier overrides, saved endpoints | Configure which agent runtimes and models this host can launch                                                | Developer, Essential when setting up a provider                                  |
| Provider agents         | Per-provider default auto-compact, selector visibility, max tool rounds                                                              | Provider-specific runtime safety and chat defaults                                                            | Developer, Advanced                                                              |
| Provider tools          | Per-provider Otto tool-group allowlist                                                                                               | Restrict tool groups available to a provider/model                                                            | Developer, Advanced                                                              |
| Personalities           | `agentPersonalities.personalities[*]`: name, provider, model, mode, effort, prompt, roles, spinner colors, voice, voice cues, memory | Reusable host-scoped agent templates                                                                          | User, Essential for choosing an agent; prompt/effort/memory details are Advanced |
| Teams                   | `agentTeams.teams[*]`, active team id, team prompt, members, roles                                                                   | Reusable host-scoped groups of personalities                                                                  | User, Advanced                                                                   |
| Speech                  | `speech.dictation`, `speech.voiceMode`, STT/TTS provider/model/language/voice/speed, `speech.openai.apiKey`                          | Host-side speech engines and credentials; playback volume remains App-local                                   | User, Advanced; API key is Developer                                             |
| Git                     | `gitHosting.providers.bitbucketCloud.email/apiToken` and GitHub CLI authentication                                                   | Host credentials for forge operations                                                                         | Developer, Essential only when using Git hosting                                 |
| Code                    | `lsp.enabled`, language enablement, `maxRunningServers`, `idleMinutes`, `backgroundIdleMinutes`                                      | Host language-server policy and resource limits                                                               | Developer, Advanced; master enablement can be Essential for IDE users            |
| Code                    | `dotnetSolutionManagement.enabled`, `maxRunningProbes`, `idleMinutes`                                                                | Host-side .NET solution discovery and sidecar policy                                                          | Developer, Advanced                                                              |
| Brain                   | `brain.enabled`, `autoStart`, `mode`, `defaultModel`, `lockModel`, local `listen`, remote target, auth, TLS, sharing gates           | Manage the local or remote Otto Brain model host                                                              | Developer, Advanced; dangerous network/security controls need prominent warnings |
| Connectors              | `connectors[*]`: name, transport, command/URL, token, enabled state, per-tool enabled state                                          | Host MCP integration registry and credentials                                                                 | Developer, Advanced; connector enablement may be User-visible once installed     |
| Storage                 | `attachmentImageMaxAgeDays`, `attachmentImageMaxTotalMb` plus clear-host-images action                                               | Retention policy and cleanup for agent-produced images on the host                                            | Developer, Advanced                                                              |
| Terminals               | `terminalProfiles[*]`, `defaultTerminalShell`, `terminalTitleMode`, `terminalTitleIncludePaths`, `enableTerminalAgentHooks`          | Host terminal launch commands, shell choice, title policy, and agent-hook integration                         | Developer, Advanced                                                              |
| Workspaces / Git policy | `autoArchiveAfterMerge`, `hideMergeIntoBaseAction`, `metadataGeneration`                                                             | Host-wide source-control and generated metadata behavior                                                      | Developer, Advanced                                                              |
| Daemon lifecycle        | Restart, update, remove host, status/version                                                                                         | Operational actions, not settings                                                                             | Developer, Essential access for host administration                              |

## Ownership findings and likely misplacements

1. The App/Host split is substantively correct for most rows. The strongest invariant is storage scope: device presentation and device hardware belong to App; daemon processes, credentials, provider availability, and shared policy belong to Host.
2. `voiceThinkingTone` is correctly App-owned even though speech engine selection is Host-owned. The tone is local playback behavior.
3. Host speech credentials and engine/model selection are correctly Host-owned. The UI must explain that changing them affects other clients.
4. Host provider settings are correctly Host-owned. Provider connection keys must never be represented as App preferences.
5. Saved host connection records are App-owned despite appearing under Host navigation. They describe how this device reaches a host, not daemon behavior.
6. Desktop settings are neither shared App settings nor remote Host settings. The current two-label model will confuse users unless Desktop is nested under App with a `This device` scope marker.
7. `contextWindowTokens` is a remembered viewing preference, not a project or daemon setting. It should not be presented beside model/provider context limits.
8. `mountedWorkspaceLimit`, `mountedTabLimit`, resource monitoring, FPS, and host LSP/Brain resource caps are all performance controls, but they have different owners. Group by intent only after showing the scope badge.
9. Settings search must index labels, descriptions, aliases, scope, category, audience, visibility, and feature gates. It must also search nested provider, personality, connector, and terminal-profile fields without flattening secrets.

## Proposed classification model

Use independent dimensions rather than one overloaded label:

```text
scope: app | desktop | host
audience: user | developer
visibility: essential | advanced | action | informational
category: appearance | chat | audio | voice-input | agents | providers | tools |
          code | terminals | storage | integrations | security | lifecycle | onboarding
```

Recommended default presentation:

- User mode shows `audience=user` and `visibility=essential`, plus a small number of high-value Advanced controls such as theme, language, chat width, and volume.
- Developer mode shows all settings, with Advanced rows grouped by category and a visible scope badge.
- Search always searches the full catalog. A result can be hidden in the current mode but should say `Developer setting` or `Host setting` rather than appearing absent.
- Never hide a security, credential, destructive, or lifecycle control solely because it is Advanced. Use a warning, confirmation, or an explicit admin gate.
- Do not index secrets or expose secret values in search. Index labels such as `API key`, `token`, and `credentials` only.

## Next validation work

Build a machine-readable registry from the settings metadata rather than maintaining a second hand-written list. Each row should declare `id`, `label`, `description`, `scope`, `audience`, `visibility`, `category`, `platforms`, `featureGate`, and `searchTerms`. Tests should assert that every writable UI field is registered exactly once and that every registry entry maps to a real persistence path.

The first review gate should be the ownership decision for Desktop settings and saved host connections. Those are the two places where the current App/Host mental model is most likely to mislead users.

## Sources

- `packages/app/src/hooks/use-settings/storage.ts`
- `packages/app/src/hooks/use-settings/update-routing.ts`
- `packages/app/src/desktop/settings/desktop-settings.ts`
- `packages/protocol/src/messages.ts`
- `packages/app/src/screens/settings-screen.tsx`
- `packages/app/src/screens/settings/appearance/appearance-section.tsx`
- `packages/app/src/screens/settings/host-page.tsx`
- `packages/app/src/screens/settings/host-brain-page.tsx`
- `packages/app/src/i18n/resources/en.ts`

## Timeline

- time: "2026-08-16T22:16:11.514Z"
  kind: "migration"
  summary: "Migrated from the legacy findings report without discarding its evidence."
  source: "findings/settings-catalog/2026-08-09-settings-ownership-and-visibility.md"
- time: "2026-08-20T05:37:30.799Z"
  kind: "evidence"
  summary: "Implemented a central Settings search catalog with scope, owning section, developer visibility, and aliases for App, Desktop, and Host settings. The Settings search surface merges this catalog as the effective source (catalog entries overwrite legacy duplicate ids), so Bitbucket, Difftastic, Git-fetch/SSH/private-key, Vim/Neovim/vimrc, provider, terminal, Brain, code-intelligence, connector, storage, and lifecycle vocabulary all resolve. Developer-only settings are now discoverable in User mode and explicitly state that Developer mode must be enabled to edit them, rather than disappearing. Added catalog unit tests that pin unique ids, required metadata, empty-query behavior, and key product aliases. Targeted lint, app typecheck, formatting, and the three-test catalog suite passed."
  source: "Implementation verification, 2026-08-19"
  affects: ["settings-search-navigates-to-setting-row","settings-opens-to-search-first-overview","tester-feedback-2026-08-19-first-run-discoverability-and-workflow-friction"]
