# Workspace scripts should run as visible terminals

Scripts are terminals that run a command on launch, and they should look and
behave like it. Today a script can start with nothing to show for it.

Related: [docs/service-proxy.md](../../docs/service-proxy.md),
[docs/preview.md](../../docs/preview.md).

## The problems

1. **The Run Scripts button is lost in the main title bar.** It needs a
   placement people can find. (Note: the sidebar placement's label threshold was
   fixed 2026-07-20 in
   `packages/app/src/components/sidebar/sidebar-active-workspace-tools.tsx`;
   this item is about the _header_ placement.)

2. **Running a script MUST open a visual tab showing its output.** Background
   running is the wrong default — an invisible script is a useless script. They
   are terminals; show the terminal.

3. **Scripts must run in the right directory** — the worktree, or whatever the
   base folder of the workspace is. Not wherever the daemon happens to be.

## Notes

- The pieces already exist: `WorkspaceScriptsButton` starts a script terminal
  and both call sites already pass an `onScriptTerminalStarted` that opens a
  focused terminal tab (`sidebar-active-workspace-tools.tsx`,
  `workspace-screen.tsx`). Verify why that path doesn't always produce a visible
  tab rather than building a second mechanism.
- Item 3 is a correctness bug, not a preference — confirm what cwd the daemon
  actually uses to spawn a script terminal today before designing anything.
- Item 1 overlaps with `compact-header-actions.ts`'s `DROP_ORDER`, which decides
  which header buttons survive at narrow widths.
