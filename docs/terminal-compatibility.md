# Terminal compatibility diagnostics

Otto's terminal compatibility surface is read-only and host-scoped. The **Test compatibility**
action is available in Developer mode under Settings → Host → Terminals when the daemon advertises
`server_info.features.terminalCompatibilityDiagnostic`.

Otto terminal rendering is independent of host font setup. Otto loads its bundled JetBrains Mono
text face and a bundled Symbols Nerd Font Mono fallback, so standard Unicode and Nerd Font
private-use glyphs emitted by external CLIs render even when the host has no Nerd Font installed.
The user's configured code font stays first in the terminal stack; the bundled symbol face fills
only missing glyphs. On iOS and Android, the native grid selects that bundled symbol face only for
private-use cells. This also preserves desktop glyph coverage when a prior GPU failure makes the
desktop run Chromium in software rendering, where xterm's WebGL custom-glyph renderer is unavailable.

The diagnostic uses the existing daemon terminal manager and PTY worker for terminal behavior. It
does not install executables, source shell configuration, edit font or terminal settings, or run a
user's Vim/Neovim/tmux configuration. The temporary probe process is killed after the check.

## Result meanings

| Result  | Meaning                                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------- |
| Pass    | The check observed the stated capability or an executable was found and probed.                           |
| Fail    | A required executable or terminal database entry was not available.                                       |
| Warn    | The host reported a limitation that may still be usable, but is below the preferred compatibility target. |
| Unknown | Otto could not verify the behavior honestly from the host-only diagnostic. It is not a failure.           |

## Compatibility matrix

| Area                | What Otto checks                                                                                          | Current contract                                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vim                 | `vim` executable on the daemon host PATH                                                                  | Report availability only. Running Vim is covered by the existing terminal E2E.                                                                                                                                                      |
| Neovim              | `nvim` executable on the daemon host PATH                                                                 | Report availability only. Otto does not embed Neovim in Phase 2.                                                                                                                                                                    |
| tmux                | `tmux` executable on the daemon host PATH                                                                 | Explicit compatibility check only. It does not resolve the unresolved “t-mark” wording.                                                                                                                                             |
| Difftastic          | `difft` executable on the daemon host PATH                                                                | Report availability only. Phase 2 does not integrate Difftastic with Changes or Git.                                                                                                                                                |
| terminfo            | `TERM` entry through `infocmp`                                                                            | Missing `infocmp` or an invalid entry is reported as unknown or fail.                                                                                                                                                               |
| true color          | `COLORTERM`, then terminfo RGB/Tc capabilities                                                            | `TERM_PROGRAM=kitty` alone never passes this check.                                                                                                                                                                                 |
| Nerd Font           | `fc-match` when the host exposes a font database query                                                    | Reports whether the host itself can provide a Nerd Font for user-managed external terminals. Otto's terminal renderer ships a Symbols Nerd Font Mono fallback, so an unknown or missing host font is not an Otto rendering failure. |
| clipboard           | Not inferred from host environment                                                                        | Unknown unless a future interactive client probe can verify browser/Electron permissions.                                                                                                                                           |
| mouse               | Not inferred from host environment                                                                        | Unknown unless a future interactive client probe can exercise pointer input. The existing terminal input protocol supports mouse messages.                                                                                          |
| resize              | Existing PTY session resized from 24×80 to 32×100                                                         | Pass means the daemon session reported the requested dimensions.                                                                                                                                                                    |
| alternate screen    | Existing PTY/headless xterm probe snapshots the active alternate buffer, then the restored primary buffer | Pass requires the alternate snapshot to contain only its marker and the final snapshot to restore the primary marker before normal output. The app-level real Vim behavior remains covered by `terminal-alternate-screen.spec.ts`.  |
| reconnect/restore   | Existing daemon snapshot restore contract                                                                 | Warn because the one-shot diagnostic does not disconnect the user's client. Restore modes remain `live`, `visible-snapshot`, and `full-snapshot`.                                                                                   |
| Kitty compatibility | Explicitly not claimed                                                                                    | Otto uses its existing xterm/PTY stack. `TERM_PROGRAM=kitty` is identity metadata, not evidence of Kitty protocol support.                                                                                                          |

This matrix is intentionally conservative. A result that cannot be measured is shown as unknown,
rather than being converted into a positive terminal-brand claim.
