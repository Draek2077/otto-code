---
id: "missing-lsp-servers-offer-copy-or-run-in-terminal-install-commands"
kind: "requirement"
title: "Missing LSP servers offer copy or run-in-terminal install commands"
status: "confirmed"
tags: []
created_at: "2026-08-15T23:39:06.230Z"
updated_at: "2026-08-20T06:31:29.323Z"
---
# Missing LSP servers offer copy or run-in-terminal install commands

<!-- compiled_truth -->

When a language server row reports not-installed on the host, the settings screen offers the install command for the daemon's platform: copy-to-clipboard is the primary action, and "run in terminal" is a secondary action that requires an explicit confirm showing the exact command before it fires in a new terminal tab. This extends the never-auto-install rule: Otto shows and executes-on-consent, never installs while the user's back is turned. Install routes are a discriminated per-platform block on the registry row (npm-installable servers install via `npm install -g` cross-distro; csharp-ls needs the .NET SDK bootstrapped per platform — winget Microsoft.DotNet.SDK.9 / brew dotnet-sdk / apt dotnet-sdk-9.0 — then `dotnet tool install -g csharp-ls`; workspace-only rows like oxlint and angular have no host install command and say the project supplies them). The daemon, not the client, resolves the platform-specific command.

## Timeline

- time: "2026-08-15T23:39:06.230Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["toolchain-catalog"]
- time: "2026-08-15T23:39:06.230Z"
  kind: "evidence"
  summary: "User confirmed 2026-07-28: \"I like the idea of giving them the instructions to copy or run in terminal to install the necessary components.\" Extends the confirmed toolchain-catalog design rule \"Never auto-install. Show the command, let the user run it. Copy-to-clipboard is the feature.\" Current code: packages/server/src/server/lsp/registry.ts LSP_SERVER_ROWS (no install block yet), LspLanguageState in service.ts/protocol messages.ts (installed: false with no next step)."
- time: "2026-08-16T00:27:36.987Z"
  kind: "evidence"
  summary: "Implemented 2026-08-15. `LspInstallRoute` in registry.ts is `{ kind: \"command\"; steps: LspInstallStep[] } | { kind: \"manual\"; url }` where each step is argv + exact `display` string + optional `note`; typescript/python rows carry the npm -g route, csharp carries `dotnet tool install -g csharp-ls` (platform-neutral), oxlint/angular have no install field. `LspService.languageStates` resolves via `resolveLspInstall`: for a dotnet step with no `dotnet` on PATH it prepends the per-platform SDK bootstrap (win32 winget Microsoft.DotNet.SDK.9 / darwin brew dotnet-sdk / linux sudo apt-get dotnet-sdk-9.0). The dotnet probe is `commandOnPath(\"dotnet\")` (registry PATH-rung logic), NOT `resolveDotnetRuntime` from the solution-model bootstrap, because that probe also requires the sidecar payload and would misreport SDK-present hosts. Protocol: optional nullable `install: { steps: [{command,args,display,note}], url }` on LspLanguageStateSchema for backward compatibility. UI: LspInstallBlock in code-intelligence-section.tsx — Copy (expo-clipboard + toast.copied with a short-noun key, because copied(label) renders \"Copied: {label}\") is primary; Run in terminal is secondary, absent unless host connected and the user's last workspace on this host is known (uses descriptor.id as createTerminal workspaceId), and always goes through the shared confirmDialog showing the exact display text; argv arrays only, never shell strings. Verified: registry.test.ts pins the row routes (no platform logic in the row, argv purity, display == argv join) and service.test.ts injects dotnetAvailable + platform to pin the three bootstrap variants and the missing/present csharp cases."
- time: "2026-08-20T06:31:29.323Z"
  kind: "evidence"
  summary: "Gap reported by the user 2026-08-20: Run in terminal on the Code settings rows was expected to switch to that workspace, but the shipped implementation only toasted \"Terminal started\" and left the user in Settings. The terminal was really created on the host in their last workspace there, just never shown, so a two-step install (SDK then tool) left the second line to be typed in a terminal they had to go find.\n\nFixed the same day by routing both run-in-terminal surfaces through one resolver, packages/app/src/terminal/run-in-terminal-outcome.ts (`resolveRunInTerminalOutcome`): on success it navigates to `?open=terminal:<id>` in the created terminal's workspace, and only falls back to the toast when the daemon could not bind the terminal to a workspace. The `terminalFailed` string was added for the no-terminal case, which previously fell through silently when the daemon returned neither a terminal nor an error. Shared with the Kanban credential remediation block, so both surfaces end the same way."
  source: "Chat 2026-08-20"
  affects: ["kanban-credential-failures-offer-a-copy-or-run-in-terminal-fix","toolchain-catalog"]
