# Otto terminal additions

Paseo 0.12 owns the PTY worker, xterm rendering, snapshots, input modes, retained
sessions, profiles, Find, file links, mobile controls and built-in Vim keybindings.
Otto extends those owners through marked composition points. It does not replace
the terminal stack or install shells, editors, multiplexers, fonts or user configuration
on the daemon host.

## Settings ownership

Host → Terminals retains Paseo's agent hooks and command profiles and adds one
Terminal preferences section. Automatic titles, path visibility and the Windows
default shell apply to newly created sessions. An explicit command profile or
caller-provided shell takes precedence. A missing selected shell fails visibly;
it does not silently switch to another shell. Existing sessions and manual names
retain their current behavior.

The feature stores nonsecret preferences in the owning host's
`terminal/settings.json`, using revision-pinned, atomic writes. Before the first
save, preserved Otto 0.9 `daemon.terminalTitleMode`, `terminalTitleIncludePaths`
and `defaultTerminalShell` values are read from `otto-config.json`. That shared
preservation document remains read-only. Unknown fields in the feature's settings
are retained. A corrupt file blocks writes. A stale or failed save retains the
local draft and requires an explicit, confirmed reload before another attempt.

The existing authenticated plugin RPC bridge carries settings and diagnostics;
the single `server_info.features.ottoTerminal` gate handles older hosts. The
terminal launch policy crosses only private worker IPC, captured at creation.
There are no changes to relay framing or an alternate PTY API.

## Compatibility check

Test compatibility runs only when requested. It discovers Vim, Neovim, tmux and
Difftastic without running their configurations, queries the host terminfo entry
for Paseo's `xterm-256color`, and starts one bounded scratch PTY through the
existing manager to observe resize and alternate/primary buffer restoration.
Concurrent clients share one diagnostic operation. Cleanup closes only that
scratch session and directory.

Pass reports an observed fact. Missing optional tools are warnings. Clipboard,
mouse, client rendering and reconnect remain unknown to a host-only check.
`TERM_PROGRAM` alone never establishes a terminal protocol or true-color claim.

## Terminal paths

Terminal link recognition stays in Paseo. Otto defers host path resolution until
activation, then reuses the shared workspace path resolver and Explorer reveal
actions. Directories open the existing Files view on wide and compact layouts;
file locations and side-pane intent are retained. Hidden panes invalidate late
resolution replies. Failed resolutions remain visible in the terminal.

Dropped POSIX filenames are single-quoted rather than stripped of punctuation or
shell-looking characters. Windows drop handling stays with Paseo.

## Glyph coverage

The app ships the original licensed Symbols Nerd Font Mono fallback. The user's
text font stays first in the desktop/browser font stack. Native grid runs select
the bundled face only for private-use characters, preserving ordinary text and
cell geometry. The native WebView embeds the same font bytes for offline use.
DOM-rendered terminals opt out of the app-wide interface-font rule.

No additional setting is needed for glyph coverage. Existing scrollback, code-font
and terminal-profile settings remain canonical.

## Scope comparison

| Previous Otto behavior                                             | Paseo 0.12 / restoration decision                       |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| Profiles, Find, alternate screens, resize, snapshots, mobile input | Reuse Paseo                                             |
| Built-in editor Vim mode                                           | Reuse Paseo; no duplicate setting                       |
| Directory links and lookup-on-activation                           | Shared path resolver and existing Explorer              |
| POSIX filename drops                                               | Literal quoting preserves all filename characters       |
| Nerd Font symbols                                                  | Bundled app-owned fallback                              |
| Host compatibility diagnostics                                     | Host service, explicit action on existing settings page |
| Automatic/default titles and path visibility                       | Host-owned launch policy                                |
| Windows default shell                                              | Discovered on the actual owning host                    |
| Terminal-backed file editor and Otto-specific Vim leader mappings  | Separate deferred File Editor scope                     |
| Direct Neovim UI embedding                                         | Remains deferred by the recorded product decision       |

The real-daemon wide/compact journey is `otto-terminal.spec.ts`. Pure fixtures
cover settings continuity, stale writes, retained drafts, lifecycle and glyph
classification. Physical Android/iOS rendering and user-configured Vim/Neovim/tmux
workflows require their separate device/host acceptance; host diagnostics do not
stand in for that evidence.
