# Changelog

## 0.5.0 - 2026-07-11

### Added

- Agent personalities: named, reusable agent templates you set up once per host. Each binds a provider and model, an effort level, a permission mode, a custom prompt, one or more roles, two spinner glow colors, and a speaking voice — so a personality on a local model is just as capable as one on a frontier API. Pick one atop any model picker (composer, schedules, artifacts), and your agents can spawn them by name.
- A starter team of six personalities (Atlas, Sage, Vera, Pixel, Dash, Sprocket) ships on every new host, covering all seven roles; a "Restore starter team" button brings them back and deleting them all sticks across restarts.
- A running agent now shows its personality's identity — provider icon, name, and a spinner glow in the personality's colors — instead of raw provider/model/effort.
- Switch or clear a running chat agent's personality straight from its model picker: prompt, model, mode, and effort apply together, behind a warning dialog you can suppress. On Claude the change takes effect from your next message.
- Bitbucket Cloud support: PR and issue features now work against Bitbucket Cloud as well as GitHub. Configure providers once in the new "Git providers" host settings section; each workspace picks its provider automatically from the git remote.
- Voice & dictation host settings: choose the engine, speech-to-text and text-to-speech models, voice, and speaking speed for dictation and voice mode right from Host settings, instead of hand-editing config. Includes new Kokoro v1.0 local voices and an OpenAI speech key card.
- Live turn stats: while an agent works, its status shows a running elapsed timer and a ticking token estimate, and each finished turn reports how long it took and the tokens it used.
- Chat message timestamps you can switch between exact clock time and relative ("5m ago"), with an Appearance toggle to reveal per-message details — timestamp, duration, and copy and fork controls.
- Pinnable Changes toolbar: split, tree, expand-all, whitespace, wrap, and refresh controls that you can pin into the strip or tuck away in a menu — your pins are remembered.
- Right-click context menus on workspace and project rows in the sidebar (desktop).
- The settings sidebar can now be dragged to resize, staying in sync with the workspace sidebar width.
- Agents can inspect an artifact's full generation history and manage artifacts on their own — list, retune, and re-run them without the client.

### Improved

- Assistant replies now stream in with a smooth typewriter reveal instead of arriving in sudden bursts.
- Reasoning effort is now one consistent "Effort" control everywhere, mapped to whatever each model actually supports. OpenAI Compatible providers drop their separate reasoning-effort setting and use the standard control like every other provider.
- The agent mode picker is color-coded by risk — green for safe, yellow for moderate, red for dangerous, blue for planning — and the active mode tints the composer chip so you can read the permission level at a glance.
- The schedule form is flatter: project and model are offered from the start, the model survives switching projects on the same host, and the mode picker is gone (scheduled runs are always unattended). "Thinking" is now labeled "Effort".
- Dark themes are a touch lighter across the board (backgrounds lifted so surfaces read more distinctly), and Neotokyo now opens on a visible violet instead of near-black.
- Pinned desktop sidebars get a subtle seam shadow so the main pane reads as sitting above them.
- Explorer header tabs show their labels whenever there's room, instead of always collapsing to icons.
- Regenerating an artifact keeps the last successful version if the new run fails, is canceled, or times out, and shows a banner instead of losing your output.
- Daylight-on-black and Twilight-on-black themes get their real accent colors and matching spinners back.
- Native text-to-speech playback no longer sounds metallic — downsampling is now anti-aliased.
- A polish pass across the sidebar, file explorer, headers, chat, and the Schedules and Artifacts screens.

### Fixed

- Opening a workspace directly by link no longer occasionally leaves the desktop tabs row missing until you reload.
- On Windows/Linux desktop, the window-control buttons now sit on correctly sized, correctly tinted chrome that matches the explorer sidebar beneath them.
- Bottom sheets and popovers that float over the desktop title bar are no longer click-dead where they overlap the drag region.
- Mobile bottom sheets size themselves to their content, so footers no longer sit below the fold out of reach.
- Home page content is now optically centered instead of sitting slightly too low.

### Security

- Bitbucket authentication is built per request and never logged, and merge preconditions are re-checked on the daemon before a merge proceeds.

## 0.4.4 - 2026-07-10

### Added

- Open and edit files directly in a workspace tab, with a live preview and split view alongside the editor
- Jump to any symbol in a file, or to a specific line, without leaving the editor
- Select code and ask an agent to refactor it right from the editor
- Jump to any file by typing part of its name
- Search and replace text across the whole project, with a warning before a replace could touch more than expected
- Markdown files show checkable task lists
- "Find in files" from the Changes view reveals and scrolls to the file in the Files tree
- Add a file to the conversation straight from the Changes view, matching the Files and Search panes
- Add an artifact from the workspace menu on mobile, opening in a bottom sheet

### Improved

- Provider settings are organized into Connection, Models, and Tools tabs instead of one long scrolling list
- The search sidebar shortcut now focuses the search box automatically

### Fixed

- Feature toggles in the mobile Features sheet show their labels clearly instead of being crammed together

## 0.4.3 - 2026-07-09

### Added

- Agents can create artifacts on their own mid-conversation instead of only through the Artifacts screen
- Claude subagent tasks now show up as their own watchable rows in the agent track, so you can follow (and stop) each one instead of reading a flattened log
- Sidebar has new buttons to expand or collapse every project or status group at once
- Chat groups a run of 3+ completed actions into one collapsible row with a plain-language summary ("Read 4 files, edited 2 files, ran a command"), toggleable in Settings > Appearance > Agents
- Pane tab tools (preview, artifacts, splits) reveal on hover and can be pinned so your favorites always stay visible
- OpenAI Compatible providers can auto-compact the conversation as context fills up, with an adjustable threshold in agent settings
- Schedules screen has a new card layout with a project filter and a Failed tab showing why a run didn't succeed

### Improved

- OpenAI Compatible providers now resume with your full conversation history, including past tool calls and reasoning, instead of stopping after 40 messages
- OpenAI Compatible providers connect to MCP servers in parallel, so one slow or unreachable server no longer delays the start of your turn
- Switching between workspaces feels faster and no longer flashes a blank background
- Scripts button now follows the workspace tools sidebar setting instead of always staying in the header
- Sidebar rows are more compact and project/status headers look more distinct from workspace rows; hover cards no longer flash when passing the pointer over the list
- Chat text spacing is more consistent, with no more doubled gaps between paragraphs
- fast-agent provider updated to 0.9.4

### Fixed

- Scroll-to-bottom button area no longer blocks clicks beside it
- Creating a new terminal focuses the pane you clicked, not whichever pane happened to be active
- Black chat background setting no longer bleeds into the top bar and tabs on web until you restart the app
- Scrolled chat content no longer makes parts of the desktop title bar undraggable
- Download page no longer links to macOS or app-store builds this fork doesn't provide

### Security

- OpenAI Compatible agents' web fetch tool now asks for permission in every mode except full auto-approval, closing a way for agents to send data out without a prompt
- Strengthened protection against DNS-rebinding and requests to cloud metadata or internal network addresses
- Auto-approving edits now only applies inside your workspace folder; edits elsewhere still ask first
- Fixed an edit bug where special characters like `$1` in the replacement text could be misapplied instead of inserted as-is

## 0.4.2 - 2026-07-08

### Added

- New Artifacts screen lets you generate, browse, and organize shareable HTML documents per project
- Artifacts open as workspace tabs, and you can watch generation live, cancel it, or regenerate on error
- Desktop app can ask for confirmation before quitting while agents have active sessions, with new window-behavior settings to control it
- Archiving a stopped chat now asks for confirmation, with an option to skip the warning next time
- OpenAI Compatible providers have a new "Web search" toggle in provider settings

### Improved

- Sidebar footer icons are bolder and have tooltips; "Add project" is now labeled "New project"
- fast-agent provider updated to 0.9.3

### Fixed

- OpenAI Compatible providers' `/compact` command no longer collapses long conversations down to a tiny summary, losing files you'd read and errors you were debugging
- The desktop workspace title bar can now be dragged to move the window
- Linux deb/rpm installs put the `otto` CLI on your PATH automatically, no longer requiring a manual step in Settings

### Security

- OpenAI Compatible agents' web fetch tool can no longer be used to reach localhost, cloud metadata endpoints, or private network ranges

## 0.4.1 - 2026-07-06

### Added

- New "Black tab background" option in Appearance settings paints the active chat tab and pane pure black, even in light mode, with colors tuned to match each color theme
- OpenAI Compatible providers support `/compact` to summarize the conversation and free up context space

### Improved

- The composer toolbar keeps the mode selector and context usage ring inline at every screen size instead of dropping them below the input box
- Composer toolbar buttons shrink together to stay usable on narrow screens instead of wrapping or clipping
- Font size settings use a slider instead of typing a number
- Reasoning effort shows a Brain icon in the composer toolbar
- The working indicator has a new look — two glowing lights orbiting each other, colored per theme instead of a fixed amber, and never freezing under reduced-motion settings
- OpenAI Compatible providers show context usage updating in real time during a turn instead of only at the end
- fast-agent provider updated to 0.9.2

### Fixed

- Clearing or resetting an agent no longer stops unrelated dev servers sharing the same port, which could crash the app
- Toast notifications triggered from bottom sheets, like New Workspace, no longer crash the app

### Security

- OpenAI Compatible agents now ask for permission before running Otto's built-in tools (terminal, browser, file access), matching how other providers are gated
- Stopping an external preview server now only works for servers Otto already recognizes as part of your workspace's configured dev servers

## 0.4.0 - 2026-07-06

### Added

- OpenAI Compatible agents can connect to MCP servers, giving local models access to external tools alongside Otto's built-in ones
- OpenAI Compatible agents support adjustable reasoning effort and rewinding a conversation to an earlier message
- MCP prompts from connected servers appear as slash commands in the composer
- Context window usage shows as a ring next to the composer with a popup breakdown, and persists across restarts

### Changed

- The local-endpoint provider preset is now labeled "OpenAI Compatible" instead of "LM Studio," since it works with any compatible server
- otto-code.me now has a Preview features page and a Local models guide

### Fixed

- Home screen no longer lets the Star/Sponsor/Community links overlap content on short screens
- Composer's Stop button icon no longer shows blank
- Mobile chat streaming no longer jitters
- Sending a message on mobile dismisses the keyboard
- Workspace list no longer shows a duplicate diff count when workspace tools are shown inline
- Icons and text scale consistently across compact mobile layouts

## 0.3.3 - 2026-07-05

### Changed

- Refreshed otto-code.me with a redesigned landing page and sponsor page
- fast-agent provider updated to 0.9.1

### Fixed

- Desktop auto-updates for Windows and Linux are published even if the macOS build fails
- Web app deploys and CI test suites work on this fork again

## 0.3.2 - 2026-07-05

### Fixed

- Desktop installers for Windows and Linux are now available to download

## 0.3.1 - 2026-07-05

### Changed

- Desktop downloads and auto-updates now come from this fork's own release page

## 0.3.0 - 2026-07-05

### Changed

- Otto now versions independently of the upstream Otto 0.1.x line, starting at 0.3.0
