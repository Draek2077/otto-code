# Changelog

## 0.6.2 - 2026-07-16

### Added

- A Load demo scenario button in the Visualizer lets you preview the graph without live agents

### Improved

- On machines without GPU acceleration, the Visualizer automatically turns off its expensive bloom glow
- Hiding the Visualizer HUD now hides only the top and control bars, keeping the info panels available
- Agents spawned by another agent appear as child nodes in the Visualizer instead of separate session tabs
- Idle agents in the Visualizer now show as resting instead of endlessly thinking
- The sub-agents panel header now counts active and completed sub-agents and their total tokens
- Sub-agent rows lead with the agent's personality name next to the chat title
- Visualizer startup failures are recorded in the desktop log for troubleshooting
- Installing a desktop update now restarts the app right away, without an extra confirmation
- Pane splitters are slightly easier to grab
- The browser's responsive-mode button uses a clearer devices icon
- Explorer tabs show clearer hover feedback
- Refreshed the bundled versions of several third-party coding agents

### Fixed

- A Visualizer that can't start now shows an explanatory message instead of a silent blank tab
- The Visualizer timeline no longer shows an enormous timestamp
- Tools in the Visualizer no longer fade out while they are still running
- Subagent nodes in the Visualizer no longer flicker or spark repeatedly
- The Visualizer's bloom glow no longer flickers or looks washed out on light themes
- The Visualizer's top-bar count is labeled agents again, since it counts graph nodes
- Sub-agents no longer show up as "general-purpose" — rows are titled by the task they were given
- Cancelling the interrupt confirmation no longer collapses the message box over your unsent text
- Bitbucket pull requests report their state correctly again
- Launching the desktop app with graphics troubleshooting flags no longer drops it into command-line mode

## 0.6.1 - 2026-07-16

### Added

- The Visualizer now plays sound effects for agent activity — spawns, tool calls, completions, and errors — at half volume by default
- Set the Visualizer sound level with a new volume slider in Settings
- The speaker button in the Visualizer now remembers your mute choice across restarts
- A new button in the Visualizer hides the whole overlay, leaving just the animated graph

### Improved

- The Visualizer renders sharper by default, with less on-screen clutter
- Long chat titles no longer crowd out the Visualizer's session tabs
- A Visualizer sharing a split with your chat keeps animating while you type
- Background Visualizer tabs no longer use CPU or GPU
- Quitting the desktop app asks once in a single dialog, even when the schedules warning applies
- Refreshed punctuation and wording across the app
- Refreshed the bundled versions of several third-party coding agents

### Fixed

- Finished subagent tasks now fade out of the Visualizer instead of staying lit forever
- Agent name labels in the Visualizer no longer wobble in time with the node's pulse
- The quit confirmation no longer hangs for several seconds while it checks for enabled schedules
- An error no longer appears at startup on web and desktop from the QR pairing camera
- The Developer Tools menu item no longer appears in packaged desktop builds

## 0.6.0 - 2026-07-16

### Added

- Visualizer: a live, interactive map of what your agents are doing — agents, subagents, tool calls, messages, and a file-attention heatmap — that works for every provider and opens from any chat or scoped to a single run
- Text Effect themes: choose the animated style that sweeps across activity labels while an agent is working, in Appearance settings

### Improved

- Typing in the composer stays smooth while an agent is streaming its response
- The Stats screen fits its tiles to the window width and fills the screen, instead of leaving one row of small squares
- Bitbucket pull requests now show the Bitbucket icon and link straight to the pull request, instead of a GitHub glyph and a broken checks link
- Refreshed the bundled versions of several third-party coding agents

### Fixed

- Creating a second workspace on a folder already backing a live one is now blocked, so branches and diffs no longer silently interfere
- Review comments no longer carry onto an unrelated diff after you switch branches
- Commit, push, PR, and merge actions are locked while a branch switch is in progress, and can no longer fire twice mid-switch
- The setup wizard no longer freezes forever when a saved host is offline
- Leaving project settings with unsaved edits now warns instead of silently discarding them
- A saved personality whose role changed is no longer dropped from the picker
- The desktop app no longer shows a "warn before quitting" prompt when that option is turned off
- Stats tiles no longer flash when you switch the time window
- The chat context meter shows the correct color in the dark chat view
- The agent activity glow is no longer clipped on Android
- The drag preview keeps up when you drag panels quickly
- Branch names no longer render misaligned on Linux
- The marketing website builds correctly from worktree checkouts

## 0.5.8 - 2026-07-14

### Added

- Preview any file on your machine, including files outside your open projects, with out-of-project editing gated behind project links
- Code blocks without a language tag now get syntax highlighting through automatic language detection

### Fixed

- Otto launches reliably on virtual machines without 3D acceleration, which previously left it running with no visible window
- The local daemon starts cleanly instead of spawning runaway background processes when its port is already in use

## 0.5.7 - 2026-07-14

### Fixed

- The Linux desktop app failed to launch after installing the .deb or .rpm package, aborting with a Chromium sandbox error

## 0.5.6 - 2026-07-14

### Added

- Open and edit a file from another project without leaving your current workspace, once you've linked the two projects
- Agents can suggest follow-up tasks as chips, and you can start each one in its own chat, a local run, or a fresh worktree with a tap
- Workflow fan-out now shows up as read-only subagent rows you can watch, alongside Task subagents

### Improved

- Opening a workspace is faster and no longer pauses to fetch pull-request status up front
- Discarding file changes now warns and holds when an agent is working in that folder, matching how committing already behaves
- The desktop app recovers on its own when your local host restarts, instead of getting stuck on a missing host
- Personality picking now behaves consistently across the composer, artifacts, and schedules
- Refreshed the bundled versions of several third-party coding agents

## 0.5.5 - 2026-07-14

### Added

- Schedules can now stop after a set number of runs, or keep running forever
- Schedules remember and show which agent personality, provider, and model last ran them
- Artifacts record the agent personality that generated them and show it on the card

### Improved

- "Team's Role" slots wear a neutral role glyph across the personality, model, artifact, and schedule pickers, so it's clear you're picking a role rather than a specific agent

## 0.5.4 - 2026-07-14

### Added

- Teams can orchestrate multi-phase work on their own, with a new Runs view to watch each orchestration
- New Stats screen surfaces at-a-glance activity counters for your host
- Agents can start background tasks you can monitor, stop, or clear without leaving the chat
- Optional vertical tab rail for each pane, switchable in Appearance settings

### Improved

- Spawning a personality is now frictionless, with role tiers applied on every spawn path
- The daemon reaches Windows clients automatically when running under WSL, with no manual network setup
- More resilient Linux desktop startup with a software-rendering fallback, AppArmor profile, and crash dialog

## 0.5.2 - 2026-07-13

### Added

- Guided first-time setup that detects your providers, picks an interface style, and sets up a starter set of agent personalities and teams
- Agent teams — group personalities into switchable operating templates and flip between them from the sidebar
- User mode — a simplified interface that hides developer panels, with a Files-only explorer you can switch out of anytime

### Improved

- Scheduled and background runs now deny anything not pre-approved instead of running with full permissions
- Stop or archive a subagent straight from its row in the subagents track
- Finished subagents collapse into their own group, and you can clear them all at once
- Subagent rows show their running time and token cost at a glance
- Clearer notifications

## 0.5.1 - 2026-07-12

### Added

- Commit changed files straight from the Changes panel, choosing which to include
- New Git Log tab with commit history, scrollable on desktop web
- Roll back individual files from the Changes view
- AI commit messages come from a matching Writer personality

### Improved

- Mobile Git settings polish

### Fixed

- Explorer, sidebar, and Git chrome scale correctly on compact and mobile layouts
- No white flash when switching between workspaces
- Header Git actions stay hidden for non-Git workspaces
- Regular Git checkouts no longer show an archived workspace as primary
- Clearer fuzzy project search

## 0.5.0 - 2026-07-11

### Added

- Agent personalities — reusable per-host templates (provider, model, effort, mode, prompt, roles, colors, voice)
- A starter team of six personalities on every new host, restorable anytime
- Running agents show their personality's name, icon, and colored spinner
- Switch a running agent's personality from its model picker
- Bitbucket Cloud support for PRs and issues, alongside GitHub
- Voice & dictation settings in Host settings, with new Kokoro v1.0 voices
- Live turn stats — elapsed timer and token count per turn
- Switchable exact/relative chat timestamps
- Pinnable Changes toolbar controls
- Right-click menus on sidebar rows (desktop)
- Drag to resize the settings sidebar
- Agents can manage their own artifacts

### Improved

- Assistant replies stream in with a smooth typewriter reveal
- One consistent "Effort" control across every provider
- Risk-color-coded agent mode picker
- Flatter schedule form
- Slightly lighter dark themes
- Explorer tabs show labels when there's room
- Regenerating an artifact keeps the last good version on failure
- Smoother native text-to-speech playback
- Polish across sidebar, explorer, headers, chat, Schedules, and Artifacts

### Fixed

- Desktop tabs row no longer goes missing when opening a workspace by link
- Correct window-control chrome on Windows/Linux desktop
- Sheets and popovers over the title bar are clickable again
- Mobile bottom sheets fit their content
- Home page content is optically centered

### Security

- Bitbucket auth is per-request and never logged; merges re-check preconditions on the daemon

## 0.4.4 - 2026-07-10

### Added

- Open and edit files in a workspace tab, with live preview and split view
- Jump to any symbol or line in a file
- Select code and ask an agent to refactor it
- Jump to any file by name
- Project-wide search and replace, with a large-replace warning
- Checkable task lists in markdown files
- "Find in files" reveals the file in the Files tree
- Add a file to the conversation from the Changes view
- Add an artifact from the mobile workspace menu

### Improved

- Provider settings split into Connection, Models, and Tools tabs
- The search shortcut focuses the search box

### Fixed

- Mobile Features toggles show their labels clearly

## 0.4.3 - 2026-07-09

### Added

- Agents can create artifacts mid-conversation
- Claude subagent tasks show as their own watchable rows
- Buttons to expand or collapse all sidebar groups
- Chat groups a run of actions into one collapsible summary
- Pin pane tab tools so favorites stay visible
- Auto-compact for OpenAI Compatible providers
- New Schedules card layout with a project filter and Failed tab

### Improved

- OpenAI Compatible providers resume with full history
- OpenAI Compatible providers connect to MCP servers in parallel
- Faster workspace switching, no blank flash
- Scripts button follows the workspace tools setting
- More compact, clearer sidebar rows
- fast-agent updated to 0.9.4

### Fixed

- Scroll-to-bottom button no longer blocks nearby clicks
- New terminals focus the pane you clicked
- Black chat background no longer bleeds into the top bar on web
- Scrolled chat no longer breaks title-bar dragging
- Download page drops builds this fork doesn't provide

### Security

- OpenAI Compatible web fetch asks permission except in full auto-approval
- Stronger DNS-rebinding and internal-address protection
- Auto-approved edits stay inside your workspace folder
- Fixed mishandling of characters like `$1` in replacement text

## 0.4.2 - 2026-07-08

### Added

- New Artifacts screen to generate and organize shareable HTML docs
- Artifacts open as tabs you can watch, cancel, or regenerate
- Optional confirmation before quitting with active sessions
- Confirmation before archiving a stopped chat
- "Web search" toggle for OpenAI Compatible providers

### Improved

- Bolder sidebar footer icons with tooltips; "New project" label
- fast-agent updated to 0.9.3

### Fixed

- OpenAI Compatible `/compact` no longer over-collapses long conversations
- The desktop title bar can be dragged to move the window
- Linux deb/rpm installs put the `otto` CLI on PATH automatically

### Security

- OpenAI Compatible web fetch can't reach localhost or private networks

## 0.4.1 - 2026-07-06

### Added

- "Black tab background" option in Appearance
- `/compact` for OpenAI Compatible providers

### Improved

- Composer keeps the mode selector and context ring inline at any width
- Composer buttons shrink together on narrow screens
- Font size uses a slider
- Brain icon for reasoning effort in the composer
- New working indicator — two orbiting lights, themed
- Live context usage during a turn for OpenAI Compatible providers
- fast-agent updated to 0.9.2

### Fixed

- Clearing an agent no longer stops dev servers on the same port
- Toasts from bottom sheets no longer crash the app

### Security

- OpenAI Compatible agents ask before running Otto's built-in tools
- Stopping a preview server only works for recognized workspace servers

## 0.4.0 - 2026-07-06

### Added

- OpenAI Compatible agents can connect to MCP servers
- OpenAI Compatible agents support reasoning effort and conversation rewind
- MCP prompts appear as composer slash commands
- Context usage ring with a breakdown, persisted across restarts

### Changed

- Local-endpoint preset renamed "OpenAI Compatible" (was "LM Studio")
- otto-code.me adds Preview features and Local models pages

### Fixed

- Home screen links no longer overlap on short screens
- Composer Stop button icon shows again
- Mobile chat streaming no longer jitters
- Sending on mobile dismisses the keyboard
- No more duplicate diff count in the workspace list
- Consistent icon and text scaling on compact layouts

## 0.3.3 - 2026-07-05

### Changed

- Redesigned otto-code.me landing and sponsor pages
- fast-agent updated to 0.9.1

### Fixed

- Windows/Linux desktop updates publish even if the macOS build fails
- Web app deploys and CI pass on this fork again

## 0.3.2 - 2026-07-05

### Fixed

- Windows and Linux desktop installers are available to download

## 0.3.1 - 2026-07-05

### Changed

- Desktop downloads and updates come from this fork's own release page

## 0.3.0 - 2026-07-05

### Changed

- Otto now versions independently, starting at 0.3.0
