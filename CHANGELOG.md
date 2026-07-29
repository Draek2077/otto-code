# Changelog

## 0.7.3 - 2026-07-29

### Added

- Code Intelligence settings lists every language server this machine can run, whether or not a workspace is open

### Changed

- The bundled agent catalog picks up current versions of Gemini CLI, Qwen Code, Cline, Droid and others
- C# language support and the solution sidecar share a single cap on how many .NET processes Otto will start
- MSBuild workers started for a C# project exit with the work that started them instead of lingering for fifteen minutes

### Fixed

- Otto no longer gets steadily slower as you add workspaces, because background git work now follows the workspace you are looking at
- Switching branches in a terminal reaches the Changes sidebar instead of going unnoticed
- A long chat keeps far fewer messages rendered once you have scrolled away from them
- A screenshot in a message no longer shrinks on every layout pass until it disappears
- The Files tab no longer flashes an error when it opens before the folder listing arrives
- A slow Bash or PowerShell command no longer appears as a sub-agent that never finishes
- An interrupted background shell command on Windows no longer stays listed as running
- Detaching a sub-agent clears it from the parent's sub-agents track right away instead of only after a reload
- Releases include an Android APK again, after several shipped without one

## 0.7.2 - 2026-07-27

### Added

- Background shell tasks that fail collect in their own Failed group, in red, with their own clear-all
- Auto-clear for failed background tasks is its own setting, separate from completed ones
- Opus 4.5, Sonnet 4.5 and Sonnet 4.5 1M are selectable in the model picker

### Changed

- Stopping a run keeps the messages you had queued behind it instead of discarding them
- Opus 4.7, 4.8 and 5 report their real 1M context window, so the duplicate "1M" entries for them are gone
- Fast mode is offered only on the Opus releases that still support it
- The auto-clear settings for sub-agents and background tasks moved from Appearance to General
- The token count on a running turn keeps a decimal so it visibly moves instead of jumping a thousand at a time

### Fixed

- A failed background task no longer sits in the active list looking finished, with nothing to say it failed
- Reading back through a turn while it streams no longer throws your position toward the top of the chat
- A sub-agent no longer shows up twice, once in the sub-agents track and once in background tasks
- Commands an agent runs on Windows no longer lose part of the system PATH, which broke git hooks and npm scripts inside agent sessions
- Cost estimates cover Fable 5, Opus 4.5 and Sonnet 4.5
- A chat, personality or team saved against a "1M" model id keeps its model features instead of silently losing them

## 0.7.1 - 2026-07-27

### Added

- Images an agent produces are kept under a retention policy and swept automatically once they age out or the store grows too large
- A Storage section in Settings reports what stored images and the preview cache are using, and can clear either
- The file pane has a real image viewer, with fit-to-window, zoom and actual size
- Binary and image files show a facts row in the file pane instead of an empty pane
- Selecting a row in Context Management shows the assembled text that section will actually send
- A section Otto cannot read because the provider composes it internally now says so rather than reading as empty
- Preview attaches to a dev server already running on a configured port instead of reporting it as an error

### Changed

- Auto-speech keeps reading a reply after you switch to another chat
- Spoken replies keep playing at full speed while the app sits in the background
- The workspace tab row attaches to a preview server that is already up rather than asking for a new one
- Quitting the desktop app stops its daemon on new installs, and the previous behaviour is one toggle away
- Importing an existing agent session from a chat lands in that workspace instead of one guessed from its directory
- The editor's code area sits on the same surface as code quoted in chat

### Fixed

- Images in chat no longer render at zero size
- The browser pane draws the same auto-hiding scrollbar as the rest of the app, instead of a permanent one that shifted the page it was previewing
- Naming a new chat falls back to that chat's own model, so a host with a single provider configured gets titles

## 0.7.0 - 2026-07-25

### Added

- Jump to a symbol's definition, see its type on hover, find every reference, and rename it across a project
- Problems from your language server and your linter show up in the editor gutter and in a diagnostics panel
- Refine rewrites the prose in your documents as a proposal you read and accept before anything is written
- Create, rename, delete and move files from the file explorer
- The Solution lens shows a .NET solution the way the build system sees it, with each project's real file set
- Agent personalities remember what they learn, and you can read, edit and transfer those lessons
- A Context Management tab shows everything filling an agent's context window and what each part costs
- Agents can put a small interactive widget straight into the conversation
- Mermaid diagrams render on every surface and platform
- AsciiDoc files render as formatted documents
- Images referenced by a relative path now appear in rendered markdown and AsciiDoc
- Delete a chat you have archived, or clear all of them at once
- A metrics bar above the chat shows what the conversation has cost so far
- Queue messages while an agent is working and they arrive together on its next turn
- Start a project from scratch on a new-project page
- A Metrics screen readout for how the app itself is using memory, timers and network
- Choose how many workspaces stay loaded in the background
- Send feedback from inside the app
- A font-contrast control for how strong the reading ink is
- Spoken replies queue up and play in order, with pauses where a voice would take them
- A volume slider for spoken replies, on its own audio channel
- Orchestration nodes declare what they can do and which workspace they may reach
- Pick a per-worktree base branch for the Changes view

### Changed

- Moving between workspaces is faster — the app stops re-asking the host for state it already has
- The Changes view resolves its base at the fork point, so a busy base branch no longer inflates the diff
- Speech reads notation as words and rests at the marks a voice does not say
- Cost is reported by the provider or shown as blank, never estimated from a rate table

### Fixed

- The composer no longer keeps a Features button it has no room for
- Auto-speech no longer re-reads the previous reply when you send a new message
- Voice mode keeps its live indicator when the message row it belongs to is redrawn
- Checking pull-request status no longer overwrites git state right after a commit
- The editor's diagnostic gutter stays right of the line numbers
- Hover signatures no longer paint a slab inside the tooltip
- Cancelling an orchestration run now stops the children it started
- Widgets load correctly in the desktop app

## 0.6.7 - 2026-07-21

### Added

- Reopen a worktree you archived earlier from the workspace list, recreated from its branch if the folder is gone
- Archiving a worktree offers to delete the branch it sat on, saying whether it is fully merged and how many commits deleting would discard
- A playback button on each agent message reads that message aloud
- The agent's task list is now an open checklist that shows which item is in progress
- Pin the task list above the chat so it stays visible while the agent works, and it closes itself once every task is done
- Search inside a file you are previewing, with case, whole-word, and regular-expression matching
- Open a worktree's base checkout from the workspace menu
- Workspace tabs that no longer fit collapse into an overflow menu instead of being cut off

### Changed

- Spoken replies start playing sooner in voice mode

### Fixed

- Voice mode recovers on its own when the microphone stops capturing audio
- In voice mode the agent no longer repeats its spoken reply as message text

## 0.6.6 - 2026-07-20

### Added

- Investigate any file through git: which commits touched it, what each one changed, and who created it
- Blame shows who last wrote each line of the file you are reading
- The Visualizer can run as a small picture-in-picture viewport pinned over your workspace, so the graph stays glanceable while you work
- Drag the picture-in-picture anywhere and pick between two sizes
- Workspace scripts now run as real terminal tabs with their own environment
- Agent voice cues are their own feature with a toggle and volume in Agents settings, and they keep working when the Visualizer is turned off
- A speech button in the workspace header silences voice cues without opening settings, separately from the setting that turns them off for good
- Three new working-indicator text effects: Wave, Flames, and Matrix
- Detail cards above the composer now rise from behind the message box and sink back down when they close
- A setting hides "merge into base branch" for pull-request-only workflows
- The Visualizer's context readout can be a ring hugging the node instead of a segmented bar
- The Visualizer gained a toolbar for its display and sound options

### Fixed

- The composer no longer drops the keystroke that wraps a line
- Starting a chat with a team's default personality no longer falls back to a random base model with no personality applied
- The Linux desktop icon is no longer blurry, now shipping sizes up to 512px
- Each personality gets its own distinct voice cue lines instead of every agent sounding the same
- Asking an agent to suggest a task now actually produces one
- The Visualizer fills its pane on small graphs instead of leaving most of the frame as margin
- Splitters follow the pointer from the first pixel rather than sticking and then jumping
- Dragging the vertical tab rail no longer stutters while it resizes
- The workspace tools row shows its labels as soon as they fit instead of waiting for a much wider sidebar
- Bundled third-party agents Factory Droid, fast-agent, and GLM are pinned to their current releases

## 0.6.5 - 2026-07-20

### Added

- Provider settings remember endpoints you have used before, so pointing a provider back at an earlier URL is one pick instead of retyping it
- The editor gained a status bar showing the file's language, cursor position, size and line endings
- A configurable ruler column marks the line-length limit behind the editor text
- Opening a browser tab or a preview while Browser Tools is off now explains the host setting and offers to turn it on
- The website offers the macOS desktop builds that releases have been shipping
- Visualizer voice cues are on by default

### Fixed

- Manage context is reachable from every workspace row and from the workspace menu, where before it only appeared on workspaces that had setup commands configured
- The Context tab reports on a workspace you have not started a chat in yet, instead of coming up empty
- The Context tab shows a loading state while it scans your context files
- Re-opening the Context tab paints the last report straight away rather than starting blank
- A context scan that fails now says what went wrong instead of looking like an empty workspace
- The message box uses your active team's personality on a fresh install instead of starting with none
- Toggle tooltips and the help dialog show your remapped shortcut rather than the default
- macOS no longer prompts for a desktop update it cannot install

### Improved

- Modals and sheets scroll consistently, with matching edge fades and multiline inputs throughout
- Links open in the in-app browser tab by default
- Agent teams and personality selection got a pass over their settings sections
- The desktop updates panel and the project settings screen were tidied up
- Bundled ACP agents (dimcode, Factory Droid, Nova and Qoder) move to their latest published versions

## 0.6.4 - 2026-07-19

### Added

- A new Context tab accounts for everything sent to the agent before you type — context files, memory, skills, MCP tools, and Otto's own prompt — read as a share of the model window rather than a bare token count
- The Context tab's "worth fixing" list takes you straight to the lines a finding is about
- A warning above the message box when fixed context takes a large share of the window, with its own Settings toggle
- Usage & cost gains a Log tab: an itemized ledger of every agent's tokens and cost, grouped under the chat turn that spawned it
- The usage Summary now shows real provider cost beside tokens, split across main chat, generations, sub-agents, and compaction
- A Reset button clears your usage counters and ledger, behind a confirm
- View the generation chat behind an artifact, or a schedule's last run, as a read-only transcript
- Otto Tools and Browser Tools move to their own Tools section in host settings, with a row per tool group
- Page transitions are animated, with a toggle to turn them off
- The Visualizer can be turned off entirely
- Unsigned macOS desktop builds are now attached to releases ([#4](https://github.com/Draek2077/otto-code/pull/4) by [@kerv](https://github.com/kerv))

### Improved

- Sub-agent token and cost figures are now measured per sub-agent at any nesting depth, and a parent's cost no longer double-counts its children
- The rate-limit warning is now a fly-out above the message box that names your actual provider and stays dismissed until the limit escalates
- Documents render embedded HTML instead of printing raw tags, so a README's centered headings and badges look the way they do on GitHub
- An image that can't be shown falls back to its alt text, and previewing a repo document can no longer reach the network
- The Context tab's sidebar drags to any width and remembers it
- Speech settings move onto the Agents page, split into Dictation, Voice, and OpenAI sections
- New artifacts and schedules default to your team's Artificer and Scheduler
- Otto's own scrollbar now appears on mobile web and the open-project screen instead of the platform's
- Screens hold their fade until the panes actually mount, rather than revealing a half-built view
- Otto now credits both projects it builds on — Paseo and Agent Flow — and sends support to both

### Fixed

- The warning bands above the message box were never actually tinted — they painted a plain background in every theme
- Replayed Visualizer history no longer collapses into a single instant
- Clearing a chat no longer leaves the Visualizer stuck on the archived one
- A new chat appears in the Visualizer before you send the first message
- Pressing play in the Visualizer at the end of a run replays it from the start
- The Visualizer's star field no longer collapses into a thin column when a shrunk pane grows back
- Viewing documentation for a project you already have open now shows the README instead of an error
- Every session no longer starts with a run of empty bookkeeping entries at the top

## 0.6.3 - 2026-07-17

### Added

- Chats now get a short AI-generated title from your first message, replacing the placeholder first-line title
- After a turn, the agent's predicted next prompt appears as ghost text in the message box — press Tab to accept (Claude agents), with a new Settings toggle
- A warning strip above the message box when your Claude plan usage nears or hits a rate limit, with a new Settings toggle
- Press Up and Down in an empty message box to recall messages you've already sent
- The personality editor is now organized into Identity, Personality, Model, and Voice tabs
- Voice cues let a personality speak a short line when its agent joins, first starts thinking, and finishes — write them yourself or generate with AI, off by default
- Choose how a suggested task starts by default — New chat, Sub-agent, Worktree, or In session
- Pick the shape of Visualizer agent nodes — hexagon, square, octagon, or circle
- A new Visualizer toolbar collects its controls at the top of the tab
- An FPS meter toggle for the Visualizer, and a Gradient toggle for chat message bubbles in Appearance settings

### Improved

- Press Escape once to clear a typed-but-unsent message, and again to cancel the running agent
- Tool calls now show a single friendly name everywhere they appear
- Clicking a file link in chat opens it in a side pane instead of taking over your conversation
- Responses stream in with a smoother typewriter reveal and a live token count for the turn
- Completed sub-agents can auto-clear from a chat's track once they settle, with their token totals still counted in the header
- The Visualizer's per-node glow and full-scene bloom are now independent toggles
- A Claude Workflow run breaks out into one Visualizer row per agent it spawns
- Visualizer file paths now display relative to the agent's folder
- New chats no longer open inside the Visualizer pane
- The model picker groups your personalities into a drill-down submenu
- Refreshed the bundled versions of several third-party coding agents

### Fixed

- Sub-agent nodes in the Visualizer now settle correctly at the end of a run instead of lingering
- Archiving a chat now clears its Visualizer session

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
