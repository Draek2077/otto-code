# Changelog

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
