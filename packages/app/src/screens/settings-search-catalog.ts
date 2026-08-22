import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";

export interface SettingsSearchItem {
  id: string;
  title: string;
  description: string;
  keywords: string;
  scope: "App" | "Desktop" | "Host";
  section: SettingsSectionSlug | HostSectionSlug;
  host: boolean;
  developerOnly?: boolean;
}

function app(
  id: string,
  title: string,
  description: string,
  keywords: string,
  section: SettingsSectionSlug,
  developerOnly = false,
): SettingsSearchItem {
  return { id, title, description, keywords, scope: "App", section, host: false, developerOnly };
}

function desktop(
  id: string,
  title: string,
  description: string,
  keywords: string,
): SettingsSearchItem {
  return { id, title, description, keywords, scope: "Desktop", section: "general", host: false };
}

function host(
  id: string,
  title: string,
  description: string,
  keywords: string,
  section: HostSectionSlug,
  developerOnly = false,
): SettingsSearchItem {
  return { id, title, description, keywords, scope: "Host", section, host: true, developerOnly };
}

/**
 * Search metadata is intentionally independent of the rendered settings rows.
 * It indexes a setting's user-facing name, aliases, scope, and owning section,
 * never the value of a credential or other secret. Keep additions here grouped
 * by the settings screen that owns their canonical editor.
 */
export const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
  // App: General
  app(
    "interface-mode",
    "Interface mode",
    "Choose User or Developer mode",
    "user developer interface advanced",
    "general",
  ),
  app(
    "app-start",
    "App starts on",
    "Choose the first screen Otto opens",
    "startup home dashboard workspace launch",
    "general",
  ),
  app("language", "Language", "Choose the app language", "locale translation", "general"),
  app(
    "send-behavior",
    "Default send",
    "Choose whether Enter interrupts or queues",
    "enter interrupt queue message composer",
    "general",
  ),
  app(
    "service-url",
    "Service links",
    "Choose where running service URLs open",
    "preview server url browser external",
    "general",
  ),
  app(
    "link-open",
    "Open links",
    "Choose where chat links open",
    "browser external web url",
    "general",
  ),
  app(
    "tool-call-detail",
    "Tool call display",
    "Show summary or full tool-call detail",
    "timeline tools detail actions",
    "general",
  ),
  app(
    "prompt-suggestions",
    "Prompt suggestions",
    "Show provider-supported next prompts",
    "composer predicted suggestions",
    "general",
    true,
  ),
  app(
    "follow-prompt-suggestions",
    "Follow prompt suggestions",
    "Send a predicted next prompt automatically",
    "composer suggestions autonomy automatic follow",
    "general",
    true,
  ),
  app(
    "rate-limit-warnings",
    "Rate limit warnings",
    "Show provider usage warnings",
    "quota plan limits usage",
    "general",
  ),
  app(
    "context-warnings",
    "Context warnings",
    "Warn when an agent nears its context window",
    "tokens context window pressure",
    "general",
    true,
  ),
  app(
    "task-list",
    "Task list",
    "Configure suggested tasks and the pinned task list",
    "todo checklist suggested tasks",
    "general",
    true,
  ),
  app(
    "background-cleanup",
    "Completed task cleanup",
    "Remove completed background task rows automatically",
    "subagent background clear history",
    "general",
    true,
  ),
  app(
    "terminal-scrollback",
    "Terminal scrollback",
    "Lines kept in the terminal buffer",
    "terminal lines buffer output",
    "general",
    true,
  ),
  app(
    "retained-workspaces",
    "Retained workspaces and tabs",
    "Limit inactive workspace and tab retention",
    "memory performance mounted tabs",
    "general",
    true,
  ),
  app(
    "preview-lifecycle",
    "Preview server lifecycle",
    "Control preview servers when tabs close or restore",
    "preview dev server restart close",
    "general",
    true,
  ),

  // App: Appearance, editor, and diff presentation
  app(
    "theme",
    "Theme",
    "Choose color mode and visual theme",
    "dark light color appearance",
    "appearance",
  ),
  app(
    "fonts",
    "Fonts",
    "Adjust interface, code, and terminal typography",
    "font size typeface accessibility mono",
    "appearance",
  ),
  app(
    "animations",
    "Animations",
    "Control interface motion",
    "motion reduce accessibility",
    "appearance",
  ),
  app(
    "wrap-tool-call-text",
    "Wrap tool-call text",
    "Show complete tool-call names and summaries without truncation",
    "tool calls tools actions timeline wrap full text truncation ellipsis",
    "appearance",
  ),
  app(
    "chat-layout",
    "Chat layout",
    "Adjust chat width, tabs, and message presentation",
    "chat width tabs messages",
    "appearance",
  ),
  app(
    "workspace-layout",
    "Workspace layout",
    "Adjust workspace tools, tab orientation, and tab rails",
    "vertical horizontal tabs sidebar rail",
    "appearance",
  ),
  app(
    "syntax-theme",
    "Syntax theme",
    "Choose code highlighting colors",
    "editor code highlighting",
    "editor",
    true,
  ),
  app(
    "editor-ruler",
    "Editor ruler",
    "Show a preferred code column",
    "column guide line length",
    "editor",
    true,
  ),
  app(
    "diff-presentation",
    "Diff presentation",
    "Choose line or structural review diffs",
    "difftastic semantic syntax aware changes review line structured",
    "appearance",
  ),
  app(
    "visualizer",
    "Visualizer",
    "Configure the agent visualizer",
    "graph nodes panels sound fps pip",
    "visualizer",
    true,
  ),
  app(
    "vim",
    "Vim keybindings",
    "Use Vim keybindings in the file editor",
    "vi editor keyboard modal",
    "editor",
    true,
  ),
  app(
    "file-editor",
    "File editor",
    "Choose Otto, Vim, Neovim, or a custom file editor, with a Markdown Otto editor override",
    "nvim vimrc external terminal editor markdown preview built-in",
    "editor",
    true,
  ),
  app(
    "keyboard-shortcuts",
    "Keyboard shortcuts",
    "View and customize keyboard commands",
    "hotkeys keybindings navigation focus",
    "shortcuts",
  ),
  desktop(
    "desktop-window",
    "Window behavior",
    "Configure tray, startup, and quit behavior",
    "desktop tray minimize quit",
  ),
  app(
    "desktop-daemon",
    "Built-in daemon",
    "Configure the desktop-managed local daemon",
    "localhost server background daemon",
    "general",
    true,
  ),
  app(
    "permissions",
    "Permissions",
    "Manage desktop permissions",
    "microphone camera notifications privacy",
    "permissions",
  ),
  app(
    "diagnostics",
    "Diagnostics",
    "Inspect and troubleshoot this Otto app",
    "logs debug support",
    "diagnostics",
  ),
  app(
    "about",
    "About Otto",
    "View app version and updates",
    "release version update beta",
    "about",
  ),
  app(
    "integrations",
    "Desktop integrations",
    "Configure desktop integrations and tools",
    "cli skills zoom meeting",
    "integrations",
  ),
  app(
    "notifications",
    "Notifications",
    "Choose when Otto shows desktop notifications",
    "alerts badges sounds desktop",
    "notifications",
  ),

  // Host: connection, agents, and tools
  host(
    "host-configuration",
    "Host configuration",
    "View and manage this host",
    "daemon server status version name update",
    "host",
  ),
  host(
    "projects",
    "Projects",
    "Manage projects on this host",
    "project workspace repository kanban",
    "projects",
  ),
  host(
    "connections",
    "Connections",
    "Manage this device's connection to the host",
    "remote endpoint relay socket reconnect",
    "connections",
  ),
  host(
    "pair-device",
    "Pair device",
    "Pair another device with this host",
    "pairing pair device qr code phone mobile",
    "pair-device",
  ),
  host(
    "personalities",
    "Agent personalities",
    "Create reusable agent templates",
    "agents model prompt role voice",
    "teams",
  ),
  host(
    "teams",
    "Agent teams",
    "Group personalities into reusable teams",
    "team members roles prompt",
    "teams",
  ),
  host(
    "agent-defaults",
    "Agent behavior",
    "Configure host-wide agent defaults",
    "notifications progress todo prompts",
    "agents",
  ),
  host(
    "otto-tools",
    "Otto tools",
    "Choose which tools agents can use",
    "tools preview browser schedules artifacts mcp",
    "tools",
  ),
  host(
    "mcp-tools",
    "MCP tools",
    "Configure injected MCP tool groups",
    "model context protocol tools inject",
    "tools",
  ),
  host(
    "metadata-generation",
    "Metadata generation",
    "Configure AI-generated workspace metadata",
    "title description summary generate workspace",
    "metadata",
  ),

  // Host: providers and integrations
  host(
    "providers",
    "Providers",
    "Configure agent providers, models, and connections",
    "model api key server url agent inference llm",
    "providers",
  ),
  host(
    "provider-models",
    "Provider models",
    "Manage provider models and model defaults",
    "catalog model effort thinking compact",
    "providers",
  ),
  host(
    "git-hosting",
    "Git hosting",
    "Configure GitHub and Bitbucket Cloud integrations",
    "bitbucket github gitlab forge pull request token api",
    "workspaces",
    true,
  ),
  host(
    "git-fetch",
    "Git fetch",
    "Control automatic fetches for active workspaces",
    "git ssh credentials private key remote origin background automatic interval",
    "workspaces",
    true,
  ),
  host(
    "worktree-policy",
    "Worktrees",
    "Configure workspace and worktree behavior",
    "branch checkout archive pull request",
    "workspaces",
    true,
  ),
  host(
    "connectors",
    "Connectors",
    "Configure MCP connectors and their tools",
    "integration mcp command url token",
    "tools",
  ),

  // Host: code, Brain, storage, and terminal
  host(
    "code-intelligence",
    "Code intelligence",
    "Configure language servers and code navigation",
    "lsp definition references diagnostics language",
    "code",
  ),
  host(
    "dotnet-solutions",
    "Solution view",
    "Configure .NET solution discovery",
    "dotnet sln csharp msbuild",
    "code",
  ),
  host(
    "brain",
    "Otto Brain",
    "Configure the local or remote model host",
    "local model llama remote tls gpu",
    "brain",
  ),
  host(
    "brain-security",
    "Brain network security",
    "Configure remote Brain authentication and TLS",
    "security certificate token encrypted",
    "brain",
  ),
  host(
    "provider-usage",
    "Provider usage",
    "View provider usage and refresh its current limits",
    "usage quota rate limit tokens cost credits",
    "usage",
  ),
  host(
    "storage",
    "Images from agents",
    "Manage host image retention and storage",
    "attachments screenshots disk cleanup retention",
    "storage",
  ),
  host(
    "terminals",
    "Terminal profiles",
    "Configure host terminal commands and profiles",
    "shell command powershell hooks",
    "terminals",
    true,
  ),
  host(
    "terminal-appearance",
    "Terminal appearance",
    "Configure terminal titles and the default shell",
    "shell title command prompt powershell",
    "terminals",
    true,
  ),
  host(
    "terminal-compatibility",
    "Terminal compatibility",
    "Check Vim, Neovim, Difftastic, and terminal support",
    "nvim vim difftastic diagnostic fonts terminfo",
    "terminals",
    true,
  ),
];

export function searchSettingsCatalog(query: string): SettingsSearchItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }
  return SETTINGS_SEARCH_ITEMS.filter((item) =>
    `${item.title} ${item.description} ${item.keywords} ${item.scope}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
}
