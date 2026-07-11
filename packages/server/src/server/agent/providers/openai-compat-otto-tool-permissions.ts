/**
 * Permission classification for Otto catalog tools (browser_*, preview_*,
 * agent/terminal/schedule management) when the openai-compat provider is the
 * tool runtime.
 *
 * CLI providers reach these tools through their own MCP client, so the CLI's
 * permission system prompts before running them. The openai-compat provider
 * has no CLI in front of it — the daemon executes the call directly — so the
 * daemon must supply the equivalent gating itself. Without it, an "Always Ask"
 * session could create a terminal and send keystrokes (shell execution),
 * upload arbitrary files through a browser form, or flip another agent to
 * bypassPermissions, all without a prompt.
 *
 * The classes mirror CompatToolKind (openai-compat-tools.ts):
 *
 * - "read":     observation only — never prompts.
 * - "interact": drives visible UI the user is watching (browser pane
 *               interaction, preview servers) — prompts in default mode,
 *               auto-approved in acceptEdits, like file edits.
 * - "execute":  can run code, move data off the page, or change what other
 *               agents are allowed to do — prompts in default AND acceptEdits,
 *               like shell commands.
 *
 * Unknown names default to "execute": a new tool must be classified here
 * before it can skip prompts.
 */

export type OttoToolPermissionKind = "read" | "interact" | "execute";

const READ_ONLY_TOOLS = new Set([
  // Browser pane observation.
  "browser_list_tabs",
  "browser_snapshot",
  "browser_screenshot",
  "browser_logs",
  "browser_inspect",
  "browser_network",
  "browser_wait",
  // Preview server observation.
  "preview_list",
  "preview_logs",
  // Agent/terminal/schedule/provider observation.
  "speak",
  "get_agent_status",
  "get_agent_activity",
  "list_agents",
  "list_terminals",
  "capture_terminal",
  "list_schedules",
  "inspect_schedule",
  "schedule_logs",
  "list_providers",
  "list_models",
  "inspect_provider",
  "list_worktrees",
  "list_pending_permissions",
  "list_artifacts",
  "inspect_artifact",
]);

const INTERACT_TOOLS = new Set([
  // Browser pane interaction — the same surface the user is watching.
  "browser_new_tab",
  "browser_close_tab",
  "browser_navigate",
  "browser_back",
  "browser_forward",
  "browser_reload",
  "browser_click",
  "browser_fill",
  "browser_type",
  "browser_keypress",
  "browser_hover",
  "browser_select",
  "browser_drag",
  "browser_scroll",
  "browser_resize",
  // Dev servers run pre-authored launch.json commands; editing that config
  // is itself an edit-gated operation.
  "preview_start",
  "preview_stop",
  "rename_workspace",
]);

// Everything else is "execute". Notable members and why:
// - browser_evaluate: arbitrary JS in the page.
// - browser_upload: reads an arbitrary file from disk into a page.
// - create_terminal / send_terminal_keys / kill_terminal: shell execution.
// - create_agent / send_agent_prompt / update_agent / set_agent_mode /
//   respond_to_permission: can grant or exercise more authority than this
//   session has (e.g. spawning a bypassPermissions agent).
// - schedule mutation, worktree mutation, agent lifecycle (cancel/kill/archive).

export function ottoToolPermissionKind(name: string): OttoToolPermissionKind {
  if (READ_ONLY_TOOLS.has(name)) return "read";
  if (INTERACT_TOOLS.has(name)) return "interact";
  return "execute";
}
