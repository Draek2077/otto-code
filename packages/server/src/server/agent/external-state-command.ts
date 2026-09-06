export function commandMayHaveChangedExternalState(command: string): boolean {
  const normalized = command.toLowerCase();
  // Commands that operate on remote state and do NOT trigger local file
  // watchers. Local git mutations (commit, checkout, merge, rebase, reset,
  // pull) are already caught by watchers on .git/HEAD and refs/heads/.
  return (
    // GitHub PR operations (merge, close, create, edit, comment, review)
    /\bgh\s+pr\s+(merge|close|create|edit|comment|review)\b/.test(normalized) ||
    // Pushes to remote - local refs unchanged, but remote state (PR checks,
    // mergeable status) may shift immediately after.
    /\bgit\s+push\b/.test(normalized) ||
    // Fetches update refs/remotes/ which our watchers do not watch, so
    // ahead/behind counts can drift stale until the next refresh.
    /\bgit\s+fetch\b/.test(normalized)
  );
}
