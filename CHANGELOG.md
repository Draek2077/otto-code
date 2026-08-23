# Changelog

## 0.8.13 - 2026-08-22

### Added

- Integrate Paseo v0.4.0's updated task, chat, and orchestration experience
- Add an Otto tool-selection evaluator backed by the selected host configuration
- Add Obsidian and Ivory monochrome themes, plus a theme-state gallery
- Preview saved Markdown comments when hovering their source sections
- Offer a start-empty workspace action
- Name the code inside slow frames: performance captures now record long-frame script attribution and keep the pre-capture growth trend
- Let OpenAI-compatible and Otto Brain models ask up to three multiple-choice questions mid-turn, using Otto's shared question UI
- Carry the active workspace's host and project into History, Artifacts, Schedules, Runs, and Kanban, with matching scope controls on each page

### Changed

- Refine Brain process management, model serving indicators, benchmark persistence, and VRAM budget stability
- Refine sidebar navigation, workspace tools, agent handoffs, composer controls, and responsive layouts
- Use clearer semantic icons and theme-aware accent colors throughout the app
- Improve rendered Markdown table borders and mobile chat presentation
- Give the public site and documentation pages a shared, consistent frame

### Fixed

- Prevent the Visualizer from freezing behind a stuck session-switch gate
- Keep Brain benchmark results available across host restarts
- Prevent duplicate observed-subagent rows and stale model spinners
- Keep the composer toolbar stable during rotation and attachment-pill layouts compact
- Repair upstream drift checks and tag resolution for the Paseo integration
- Restore Settings search indexing, so matching rows appear and open reliably
- Stop Otto Brain reporting a thinking slot after a chat is interrupted: request stages are now leased, a cancelled request is never dispatched, and any stage the engine contradicts is released automatically

## 0.8.12 - 2026-08-20

### Added

- Attach a file, a selected range, or an @ mention to the chat as a removable context pill, from the File Editor, its right-click menu, and the composer
- Comment on a rendered Markdown heading to hand that section, and its source location, to the agent
- Render LaTeX math in chat replies and in the prompts you send
- Search inside the file editor's rendered Preview, with the same match count and next/previous behavior as the code view
- Keep Markdown files in Otto's editor while an external editor opens everything else
- When a Kanban board's GitHub credential is missing scopes, Otto shows the exact command that fixes it, with Copy and Run in terminal actions
- Status icons now pulse with a soft halo in their semantic color, including the Zoom presence, meeting recorder, and wake word icons in the title bar
- Let Otto follow the agent's own next-prompt suggestion automatically, off by default, bounded at three in a row with a Stop control
- Show complete tool-call names and summaries on wrapped lines instead of truncating them
- Split panes on desktop with keyboard shortcuts
- Copy filename, full path, or workspace-relative path from a file tab's context menu
- Create a project README directly from the new workspace screen
- Spell-check in the composer

### Changed

- The File Editor toolbar now sheds its least important buttons in a narrow pane, so the view mode bar stays reachable
- Settings search now finds more settings
- Developer-only settings now show a hint that Developer mode is required to edit them
- Bundled ACP agents move to their latest published versions

### Fixed

- A provider outage now reports one actionable error instead of a raw failure repeated in the transcript
- Chats now keep a scrolled-up reader's place when the tab is unloaded and reopened
- Opening the explorer sidebar no longer re-downloads the whole diff on large repositories
- Zoom keeps its title-bar icon when Chat goes offline, so there is a way back online without opening Settings
- Deleting all review comments now sweeps the whole branch, including comments the current view does not show, and says so before deleting
- Outdated pull-request comments are left out of "Add all to chat"
- On mobile, the per-bubble speaker fades so it stops covering the text underneath
- Context removed from the composer, including dismissed meeting notes, is now permanently discarded
- Wrap long lines now wraps structural diff rows too
- Background shell tasks stop auto-clearing while their track is open
- The meeting notes popup keeps its title, recorder control, and search in place while the list scrolls
- Settings row pickers no longer collapse to a single character, and their menus are wide enough to read every option
- The file outline keeps each heading level marker on one line
- Changes view no longer blanks when a personal git config reshapes patch headers
- Files tab no longer errors over the whole tree when a folder was deleted after last expansion
- Structural review comments now sit inline with their code rows
- Run in terminal now navigates to the terminal it starts in
- On mobile, chats now apply the black chat background setting correctly
- Git fetch no longer queues in the background after the policy is disabled
- New Project no longer flashes a self-duplicate error
- The model picker no longer implicitly selects the Claude ultracode workflow

## 0.8.11 - 2026-08-19

### Added

- Kanban boards are reached by picking a host and a project, and the project's board is chosen in that project's settings
- GitHub boards sign in with the GitHub CLI, and Jira boards use the Atlassian account credential shared with Bitbucket
- Jira boards show the board's real columns, and moving a card transitions the issue
- Use Zoom Team Chat from Otto, including conversations, presence, notifications, favorites, and search
- Record meetings locally and browse saved transcripts from the desktop app
- Tune local Brain models with sampling controls, cached chats, clearer live status, and on-demand log streaming
- Choose how often Otto fetches Git repositories and trigger a manual fetch when needed
- Install a missing language server directly from Otto, or copy its install command
- Choose a conventional commit type when committing from the Changes panel
- Let Android follow the device’s rotation setting

### Fixed

- OpenAI-compatible chats no longer break when a model leaves an unexpected system message in the conversation
- Local Brain workloads share available model slots reliably across concurrent chats
- C# language-server crashes no longer take down the daemon, and cold hovers recover reliably
- Microphone capture now uses the current browser audio API
- Chat replay no longer re-types messages after a live correction
- Native desktop layouts keep the vertical tab rail available outside split views

## 0.8.10 - 2026-08-13

### Fixed

- Chats scroll again, and jump to the bottom again, instead of opening stuck in place
- Closing a tab that holds a Vim or Neovim session now warns that the external editor will be stopped

## 0.8.9 - 2026-08-13

### Added

- Opt-in Vim keybindings in the File Editor, with modal feedback and rebindable Space-leader shortcuts
- Choose Otto, Vim, Neovim, or a custom command as the desktop File editor
- Read-only terminal compatibility checks for Vim, Neovim, tmux, Difftastic, and terminal behavior
- Review code changes with Structural Diff, including moved code, token replacements, and formatting-only edits
- Configure Brain prompt and template profiles for local models, including model-family defaults
- Coordinate agent-team runs with one reliable completion handoff

### Fixed

- Browser-mode tests now use Vitest's supported browser entry point
- Hardened terminal-backed Vim and Neovim editing against option-like file paths, renderer reloads,
  duplicate embedded sessions, and accidental tab closure
- Improved terminal compatibility evidence for alternate-screen restoration and older-host update
  prompts
- Qwen Sharp prompt templates now load the intended tool-safe conversation format
- Brain hosting-profile family defaults now recognize compatible downloaded and LM Studio GGUF models outside the curated catalog
- Hardened Brain model-profile edits against unsafe template ids, stale context windows, incompatible runtime components, and orphaned materialized templates
- Opening a file with Vim or Neovim now keeps editing in its existing file tab instead of creating a workspace terminal tab
- Branch switching now carries uncommitted changes into the destination workspace
- Structural diffs, Refine previews, and Brain job progress now remain stable through reloads and long-running operations

## 0.8.8 - 2026-08-11

### Added

- Manage Brain model runtimes, with bundled model downloads that resume after an interruption
- Model bundles can now include a vision projector for image understanding or a speculative draft model for faster generation
- Upgrading Brain runtimes unlocks support for newly bundled models, including Muse Glimmer 30B
- Findings are now a first-class knowledge record type, including import of legacy findings
- Permanently delete a knowledge record with a destructive confirmation step
- Explore the Visualizer's built-in demo scenario when a workspace has no chats

### Changed

- Cleaned up and refined the Knowledge, Context, and Brain UIs across many small details
- Improved Hugging Face model search results and how catalog and downloaded models are displayed
- Improved the run comparison view in Brain's Benchmark tab
- Brain model management and live status updates are clearer and more responsive
- Bundled ACP agents move to their latest published versions

### Fixed

- Tightened knowledge article title layout so titles sit closer to their icon
- Hardened the Brain model card cache against concurrent lookups that could deadlock
- Rejected unsafe CLI argument values and fixed removing a remote Brain runtime
- A queued chat turn no longer restarts immediately behind a message you just stopped
- Swept leftover temp files from interrupted knowledge writes and repaired dangling links left by a purge
- Visualizer live graphs now keep activity up to date for every visible agent

## 0.8.7 - 2026-08-09

### Added

- Choose whether to archive or permanently delete chats, with provider-aware archive cleanup
- See live client resource metrics with adaptive severity and capture repeatable performance reports
- Artifacts can now receive data-only updates
- Search Settings and jump directly to the matching setting
- Added clearer History archive controls, storage reporting, host filters, and metadata layout
- Added file-type icons and context-menu actions in the Files sidebar

### Changed

- Refined workspace tabs, chat menus, file dropping, theme surfaces, and light-theme contrast
- Opening a dropped file now opens it in the text editor instead of adding it to the composer
- Improved wake-word lifecycle handling and immediate Visualizer picture-in-picture session hydration
- Knowledge-entry tags now offer contextual suggestions while remaining free-form

### Fixed

- Fixed terminal path quoting on POSIX and Windows command-script invocation
- Hardened the desktop renderer trust boundary and artifact content-security-policy validation
- Fixed short-viewport timeline pagination, Visualizer and wake-word state synchronization
- Remediated MCP SDK and code-scanning security findings

## 0.8.6 - 2026-08-08

### Added

- Export chats as Markdown transcripts on web, desktop, and native platforms
- Open projects from routed desktop links and restore pending project-open requests
- Manage repository-owned project knowledge, including project plans, requirements, decisions,
  references, and architecture
- Use bundled offline Hey Otto wake-word detection on desktop and Android
- Configure wake-word sensitivity, microphone permissions, audio handoff, and lifecycle recovery
- Set terminal font size independently from editor and diff font size
- Group active-team controls across multiple connected hosts

### Changed

- Brain model management and live status updates are clearer and more responsive
- Chat expand and collapse controls are revealed on hover and cascade through nested groups
- Composer controls now better reflect drafts, queued messages, and interrupt actions
- Chat metrics appear below the composer
- Hey Otto listens only in the focused chat or pane
- Wake-word controls distinguish feature availability from temporarily paused listening
- Native chat scrolling remains anchored during touch interaction, momentum scrolling, and streaming
- Settings now describes the bundled Otto skills and their project-knowledge capabilities
- Keep workspace navigation consistent across desktop and mobile

### Fixed

- Preserve project keys when creating worktrees
- Prevent worktree creation from breaking project routing
- Prevent background chats and unfocused panes from responding to Hey Otto
- Improve wake-word behavior when switching chats, changing focus, or recovering from interruptions
- Fix theme-dependent styling being read before the persisted theme is available
- Improve composer draft ownership, dictation delivery, terminal layout, file links, and mobile spacing
- Improve desktop packaging, Android verification, demos, and end-to-end test stability

## 0.8.5 - 2026-08-07

### Added

- Show token pricing and estimated costs for Codex and OpenCode usage across agent accounting,
  statistics, diffs, and visualizer events

### Fixed

- Preserve queued image attachments while a queue request is in flight, and restore them when
  editing or sending queued messages
- Keep queued attachment state rooted until the daemon removes the corresponding queue entry
- Preserve downloaded desktop updates across automatic rechecks

## 0.8.4 - 2026-08-06

### Added

- View a file revision as rendered Markdown from Git history
- Navigate from an open file back to its location in the file tree
- Use Bitbucket Cloud as a first-class Git hosting provider
- Remember reasoning preferences per model and apply advertised reasoning levels to OpenAI-compatible models

### Fixed

- Fixed chat history loading, scrolling, and prompt jumps losing the reader's place
- Restored the draggable chat scrollbar on the web
- Fixed steering messages being left behind when an agent turn finalized at the same time
- Fixed timeline entries remaining pending when catch-up required another attempt
- Fixed the mobile model selector collapsing to zero height
- Fixed Linux desktop startup metadata so installed launches are recognized correctly
- Fixed desktop browser snapshots reading the wrong MCP response field

## 0.8.3 - 2026-08-06

### Added

- Brain status now updates the instant it changes instead of waiting on the next poll
- The Brain overview and rail show live inference stage and token throughput as it happens
- Cancel a running Brain model download from the Models tab or search results

### Fixed

- Fixed Linux desktop installs killing long-running Brain commands like `otto brain serve` a few seconds after they started
- Fixed `otto brain start` failing right after a Linux install because the self-launched command was built wrong
- Fixed the Brain runtime status briefly showing "Install llama.cpp" before the host had actually answered whether a runtime was installed
- Fixed chat messages alternating between code and rendered markdown when a reply wrapped its output in an extra markdown code fence
- Fixed Codex chats reporting roughly double the actual token usage

## 0.8.2 - 2026-08-05

### Added

- Rename a Brain model's display name from the Models tab, with a reset back to its scanned default
- The Brain overview panel shows live model activity: which slot is running, whether it's reading the prompt or generating, and tokens per second
- An agent team member row shows its provider, model and effort level

### Fixed

- Fixed some Codex tool actions staying stuck showing "running" after their turn ended without a final status
- Fixed personality provider icons with gradient colors failing to render on some browsers
- Fixed a chat tab losing your scroll position after switching away and back
- Fixed the brain icon reading smaller than the icons beside it
- A browser tab now shows a plain loading spinner instead of the AI thinking indicator while a page loads
- Fixed a typed slash command like /compact sometimes rendering out of order or disappearing after a reload
- Fixed a race where changing a session's personality or model right after a turn finished could break the next message
- Fixed a git status check sometimes waiting for the next background refresh instead of fetching PR status right away

## 0.8.1 - 2026-08-04

### Fixed

- Installing the local brain's Linux runtime could finish successfully and still leave a runtime that failed to start
- A local brain runtime that can't find a supported GPU now warns instead of silently running on the CPU
- Fixed the Windows installer sometimes failing to relaunch Otto after installing or updating
- Fixed the chat transcript no longer auto-scrolling to new messages at some display zoom levels
- Fixed the chat transcript jumping to the very top while it was still loading earlier history

## 0.8.0 - 2026-08-03

### Added

- A top-level Brain page manages your local models: overview, models, a downloadable library, benchmarks and logs
- Load, unload or delete a Brain model, and edit its profile, without leaving the page
- Brain shows a live VRAM budget as you adjust a model's settings, before you apply them
- The connector picker gains a search box and an audience filter, and expands a connector in place instead of leaving the list

### Changed

- The connector catalog now covers 29 sources with cited setup instructions, 25 of them one-click sign-in
- Connecting most sources goes through Otto's own sign-in flow instead of pasting a token
- The old Brain settings dashboard sheet is replaced by the Brain page
- The bundled agent catalog picks up current versions of Factory Droid and Qwen Code

### Fixed

- A pasted connector token was echoed back to every client instead of staying secret

## 0.7.6 - 2026-08-03

### Added

- Markdown files open in a live preview that hides the syntax on every line except the one your caret is on
- Format Markdown from a toolbar and keyboard shortcuts, laid out for touch on mobile
- Move around a Markdown document from a heading outline
- Build and edit GitHub-flavored tables inside a Markdown file
- Paste HTML into a Markdown file and it arrives as Markdown
- Turn an HTML table in a Markdown file into a GitHub-flavored one
- TeX math renders wherever Markdown does
- GitHub alert blocks render as themed callouts
- Footnotes render in Markdown
- Tick a task-list checkbox straight in the file
- Export a Markdown document as standalone HTML or as a PDF
- Drop an image into a Markdown file to insert it
- Write binary files from the file explorer
- A run of tool calls collapses into one overview row, so a turn that reads twenty files is one line instead of twenty cards
- Claude's thinking can be turned off, per model
- Workspace scripts pick up the npm scripts already in package.json, not only what otto.json declares
- Search the keyboard shortcuts dialog
- A provider's sub-agent opens as its own tab
- Attachments travel with the queued message they belong to when you send the queue
- Agents can create, list and archive workspaces through Otto's own tools

### Changed

- Otto is rebuilt on Paseo v0.2.5, adopting everything upstream shipped since v0.2.1
- The workspace sidebar, footer nav and segmented control share one set of heights and radii instead of restating them per component
- A single icon set now covers tool calls and roles, which were missing icons before
- Otto is clearer about when an agent actually wants your attention
- Picking a model explicitly leaves the mode that was choosing one for you
- Large files transfer as a stream instead of being held whole in memory
- A workspace script that serves a URL offers to open it, the same as a declared service route
- An agent can only delete the heartbeats it created
- The Windows installer puts ~/.local/bin on your PATH
- The bundled agent catalog picks up current versions of Cline, CodeBuddy, Dimcode, Dirac, Factory Droid, Gemini CLI, Nova, Qoder and Qwen Code

### Fixed

- The Settings sidebar stays where you left it when you pick a section
- The chat transcript no longer mistakes your own scrolling for drift and pulls you back
- Returning to a busy chat lands on its settled state instead of replaying it
- A chat asks for older history when the first page does not fill the window
- Stop actually stops the agent, or says why it could not
- Stop holds the queued messages instead of firing them at an agent that is stopping
- A workspace opened on a subdirectory stays on that subdirectory when you cut a worktree from it
- A git worktree you created by hand groups under its repository instead of standing up as its own project
- An archived workspace reopens even when its project is archived too
- Saving a file no longer reports a conflict with its own unchanged contents
- File permissions survive a save
- OpenCode token counts add up across a turn instead of showing only the last step
- Otto no longer labels every git host as GitHub
- A browser directory left empty counts as not installed
- Quitting the desktop app does not re-ask a question the update already answered
- Otto Brain says why its terminal UI cannot run under the bundled Windows binary

## 0.7.5 - 2026-07-31

### Added

- Otto Brain, a host for local GGUF models that stays off until you turn it on
- Otto Brain downloads its own llama.cpp runtime and models, so nothing else needs installing
- Otto Brain measures what a model really costs in VRAM and refuses to start one that will not fit
- Otto Brain caps the thinking budget on reasoning models, which otherwise spend a whole turn reasoning and return nothing
- A curated catalog of 16 local models sized for 12-32GB of VRAM
- Search Hugging Face and add any model repo from Brain settings
- Repos and quantizations you already have are flagged as you browse Hugging Face
- Pick a quantization when you download a model
- See what your local models cost on disk, and delete the ones you no longer want
- Run Otto Brain on another machine and drive it from Otto
- Connectors, a way to attach a data source once and reach it from every provider
- A browse-and-prefill picker for connectors, covering office, marketing, ads and social sources
- LinkedIn Ads, LinkedIn Pages and Microsoft (Bing) Ads connectors
- Send every queued composer message at once with Send all
- Write a personality's profile prose from its name, roles and colors
- Task-list reminders on every provider, not only the ones that ship their own

### Changed

- The voice cues for a personality are written in one pass, so all four moments sound like the same character
- Stopping a background task clears its row instead of leaving it for you to dismiss
- Otto's own face marks its tool calls in the transcript, and winks while one is running
- The bundled agent catalog picks up current versions of Auggie, Cline, CodeBuddy, DeepAgents, Dirac, Factory Droid, Nova, Qoder and Qwen Code
- The queue move arrows in the composer stack vertically
- Every critical advisory in Otto's dependencies is cleared

### Fixed

- The chat transcript stays where you left it while you read, instead of scrolling out from under you
- Streaming a long chat costs far less on mobile and mobile web
- Opening a preview no longer opens a second tab for the same page
- Codex answers no longer get a stray divider inserted between paragraphs
- Each fanned card in the composer is shaded down its full tucked edge

## 0.7.4 - 2026-07-30

### Added

- Move a chat to another workspace from the workspace tab menu

### Changed

- The Changes diff in a worktree compares against the branch the worktree was created from
- The diff base you pick for a checkout is remembered the next time you open it
- The bundled agent catalog picks up current versions of CodeBuddy, DeepAgents, Dimcode, Dirac, Factory Droid, fast-agent and Qoder

### Fixed

- Escape no longer clears what you typed in the composer
- Voice cues, Visualizer, Explorer and Play move into the "..." menu on a narrow window instead of disappearing

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

- Moving between workspaces is faster - the app stops re-asking the host for state it already has
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

- A new Context tab accounts for everything sent to the agent before you type - context files, memory, skills, MCP tools, and Otto's own prompt - read as a share of the model window rather than a bare token count
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
- Otto now credits both projects it builds on - Paseo and Agent Flow - and sends support to both

### Fixed

- The warning bands above the message box were never actually tinted - they painted a plain background in every theme
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
- After a turn, the agent's predicted next prompt appears as ghost text in the message box - press Tab to accept (Claude agents), with a new Settings toggle
- A warning strip above the message box when your Claude plan usage nears or hits a rate limit, with a new Settings toggle
- Press Up and Down in an empty message box to recall messages you've already sent
- The personality editor is now organized into Identity, Personality, Model, and Voice tabs
- Voice cues let a personality speak a short line when its agent joins, first starts thinking, and finishes - write them yourself or generate with AI, off by default
- Choose how a suggested task starts by default - New chat, Sub-agent, Worktree, or In session
- Pick the shape of Visualizer agent nodes - hexagon, square, octagon, or circle
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
- Sub-agents no longer show up as "general-purpose" - rows are titled by the task they were given
- Cancelling the interrupt confirmation no longer collapses the message box over your unsent text
- Bitbucket pull requests report their state correctly again
- Launching the desktop app with graphics troubleshooting flags no longer drops it into command-line mode

## 0.6.1 - 2026-07-16

### Added

- The Visualizer now plays sound effects for agent activity - spawns, tool calls, completions, and errors - at half volume by default
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

- Visualizer: a live, interactive map of what your agents are doing - agents, subagents, tool calls, messages, and a file-attention heatmap - that works for every provider and opens from any chat or scoped to a single run
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
- Agent teams - group personalities into switchable operating templates and flip between them from the sidebar
- User mode - a simplified interface that hides developer panels, with a Files-only explorer you can switch out of anytime

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

- Agent personalities - reusable per-host templates (provider, model, effort, mode, prompt, roles, colors, voice)
- A starter team of six personalities on every new host, restorable anytime
- Running agents show their personality's name, icon, and colored spinner
- Switch a running agent's personality from its model picker
- Bitbucket Cloud support for PRs and issues, alongside GitHub
- Voice & dictation settings in Host settings, with new Kokoro v1.0 voices
- Live turn stats - elapsed timer and token count per turn
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
- New working indicator - two orbiting lights, themed
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
