# Terminal compatibility diagnostics

Otto's terminal compatibility surface is read-only and host-scoped. The **Test compatibility**
action is available in Developer mode under Settings → Host → Terminals when the daemon advertises
`server_info.features.terminalCompatibilityDiagnostic`.

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

| Area                | What Otto checks                                                                                          | Current contract                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vim                 | `vim` executable on the daemon host PATH                                                                  | Report availability only. Running Vim is covered by the existing terminal E2E.                                                                                                                                                     |
| Neovim              | `nvim` executable on the daemon host PATH                                                                 | Report availability only. Otto does not embed Neovim in Phase 2.                                                                                                                                                                   |
| tmux                | `tmux` executable on the daemon host PATH                                                                 | Explicit compatibility check only. It does not resolve the unresolved “t-mark” wording.                                                                                                                                            |
| Difftastic          | `difft` executable on the daemon host PATH                                                                | Report availability only. Phase 2 does not integrate Difftastic with Changes or Git.                                                                                                                                               |
| terminfo            | `TERM` entry through `infocmp`                                                                            | Missing `infocmp` or an invalid entry is reported as unknown or fail.                                                                                                                                                              |
| true color          | `COLORTERM`, then terminfo RGB/Tc capabilities                                                            | `TERM_PROGRAM=kitty` alone never passes this check.                                                                                                                                                                                |
| Nerd Font           | `fc-match` when the host exposes a font database query                                                    | A fallback match is unknown, not proof of Nerd Font support. Hosts without a query tool remain unknown.                                                                                                                            |
| clipboard           | Not inferred from host environment                                                                        | Unknown unless a future interactive client probe can verify browser/Electron permissions.                                                                                                                                          |
| mouse               | Not inferred from host environment                                                                        | Unknown unless a future interactive client probe can exercise pointer input. The existing terminal input protocol supports mouse messages.                                                                                         |
| resize              | Existing PTY session resized from 24×80 to 32×100                                                         | Pass means the daemon session reported the requested dimensions.                                                                                                                                                                   |
| alternate screen    | Existing PTY/headless xterm probe snapshots the active alternate buffer, then the restored primary buffer | Pass requires the alternate snapshot to contain only its marker and the final snapshot to restore the primary marker before normal output. The app-level real Vim behavior remains covered by `terminal-alternate-screen.spec.ts`. |
| reconnect/restore   | Existing daemon snapshot restore contract                                                                 | Warn because the one-shot diagnostic does not disconnect the user's client. Restore modes remain `live`, `visible-snapshot`, and `full-snapshot`.                                                                                  |
| Kitty compatibility | Explicitly not claimed                                                                                    | Otto uses its existing xterm/PTY stack. `TERM_PROGRAM=kitty` is identity metadata, not evidence of Kitty protocol support.                                                                                                         |

This matrix is intentionally conservative. A result that cannot be measured is shown as unknown,
rather than being converted into a positive terminal-brand claim.
