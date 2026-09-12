/**
 * Permission classification for Otto catalog tools (browser_*, preview_*,
 * agent/terminal/schedule management). Shared by native tool loops, MCP
 * annotations, and provider-native preapproval rules.
 *
 * CLI providers receive exact read grants where supported and shared MCP
 * read-only hints; their native policies review remaining calls. The openai-compat provider
 * has no CLI in front of it - the daemon executes the call directly - so the
 * daemon must supply the equivalent gating itself. Without it, an "Always Ask"
 * session could create a terminal and send keystrokes (shell execution),
 * upload arbitrary files through a browser form, or flip another agent to
 * bypassPermissions, all without a prompt.
 *
 * The classes mirror CompatToolKind (openai-compat-tools.ts):
 *
 * - "read":     observation only - never prompts.
 * - "interact": drives visible UI the user is watching (browser pane
 *               interaction, preview servers) - prompts in default mode,
 *               auto-approved in acceptEdits, like file edits.
 * - "execute":  can run code, move data off the page, or change what other
 *               agents are allowed to do - prompts in default AND acceptEdits,
 *               like shell commands.
 *
 * Unknown names default to "execute": a new tool must be classified here
 * before it can skip prompts.
 */

export type OttoToolPermissionKind = "read" | "interact" | "execute";

export const OTTO_READ_ONLY_TOOL_NAMES: readonly string[] = [
  // Browser pane observation.
  "browser_list_tabs",
  "browser_snapshot",
  "browser_page_text",
  "browser_screenshot",
  "browser_logs",
  "browser_inspect",
  "browser_network",
  "browser_wait",
  // Preview server observation.
  "preview_list",
  "preview_logs",
  // Agent/terminal/schedule/provider observation.
  "get_chat_status",
  "get_chat_activity",
  "list_chats",
  "list_terminals",
  "capture_terminal",
  "list_schedules",
  "inspect_schedule",
  "schedule_logs",
  "list_providers",
  "list_models",
  "inspect_provider",
  "list_agent_profiles",
  "list_worktrees",
  "list_workspaces",
  "list_project_knowledge",
  "read_project_knowledge",
  "read_project_knowledge_root",
  "query_project_knowledge",
  "lint_project_knowledge_links",
  "read_architectural_view_draft",
  "get_workflow_status",
  "wait_for_chats",
  "list_pending_permissions",
  "list_artifacts",
  "inspect_artifact",
];

const READ_ONLY_TOOLS = new Set(OTTO_READ_ONLY_TOOL_NAMES);
const UNPROMPTED_UI_TOOLS = new Set([
  "speak",
  // Suggesting/withdrawing a background task only draws or removes a card - the
  // work starts when the user clicks Start, which is where the real gate lives.
  "suggest_task",
  "dismiss_task",
]);

const INTERACT_TOOLS = new Set([
  // Browser pane interaction - the same surface the user is watching.
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
  // Dev servers run launch.json commands. "They're pre-authored, and editing
  // the config is itself edit-gated" holds in default mode but not in
  // acceptEdits, where that edit is auto-approved too - so classification
  // alone would let a session write a shell command into launch.json and run
  // it promptless. preview_start therefore keeps "interact" only under an
  // extra check (PreviewStartGate, applied in the agent's tool loop):
  // auto-approval requires the entry's command to match the session-start
  // snapshot, and a command changed during the session prompts, showing what
  // will run. preview_stop is guarded inside DevServerManager instead
  // (workspace scoping, observed-port allowlist for ext: ids).
  "preview_start",
  "preview_stop",
  "rename_workspace",
]);

// Everything else is "execute". Notable members and why:
// - browser_evaluate: arbitrary JS in the page.
// - browser_upload: reads an arbitrary file from disk into a page.
// - create_terminal / send_terminal_keys / kill_terminal: shell execution.
// - create_chat / send_chat_prompt / update_chat / set_chat_mode /
//   respond_to_permission: can grant or exercise more authority than this
//   session has (e.g. spawning a bypassPermissions agent).
// - schedule mutation, worktree mutation, agent lifecycle (cancel/kill/archive).

export function ottoToolPermissionKind(name: string): OttoToolPermissionKind {
  if (READ_ONLY_TOOLS.has(name) || UNPROMPTED_UI_TOOLS.has(name)) return "read";
  if (INTERACT_TOOLS.has(name)) return "interact";
  return "execute";
}

/** UI-only exceptions may skip prompts, but must never claim to be read-only. */
export function isOttoToolReadOnly(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}
