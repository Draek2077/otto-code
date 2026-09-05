// Verified composition seams, not an inventory of every imported component.
// Change an owner only with its feature owner's behavioral evidence. See
// docs/upstream-merges.md; source evidence: Paseo 20d7efc46 and repairs 01/02.
export const CONTRACT_VERSION = 1;
const app = "packages/app/src/";
const server = "packages/server/src/server/";
const root = app + "app/_layout.tsx";
const sidebar = app + "components/left-sidebar.tsx";
const symbol = (file, name) => ({
  file,
  name,
  ...(file.startsWith(app + "plugins/") ? { barrels: [app + "plugins/index.ts"] } : {}),
});

export const MOUNT_CONTRACTS = [
  {
    id: "plugin-catalog",
    edges: [
      [symbol(root, "ProvidersWrapper"), symbol(root, "HostSessionManager")],
      [symbol(root, "HostSessionManager"), symbol(root, "ManagedDaemonSession")],
      [
        symbol(root, "ManagedDaemonSession"),
        symbol(app + "plugins/catalog-sync.tsx", "PluginCatalogSync"),
        symbol(app + "contexts/session-context.tsx", "SessionProvider"),
        { serverId: { parameter: "daemon", member: "serverId" }, client: { local: "client" } },
      ],
    ],
  },
  {
    id: "plugin-command",
    edges: [
      [
        symbol(root, "AppContainer"),
        symbol(app + "plugins/command-center/registration.tsx", "PluginCommandCenterActions"),
        symbol(app + "command-center/provider.tsx", "CommandCenterProvider"),
      ],
    ],
  },
  {
    id: "plugin-sidebar-compact",
    edges: [
      [symbol(sidebar, "LeftSidebar"), symbol(sidebar, "MobileSidebar")],
      [
        symbol(sidebar, "MobileSidebar"),
        symbol(app + "plugins/sidebar-items.tsx", "PluginSidebarItems"),
        null,
        { onBeforeNavigate: { parameter: "closeSidebar" } },
      ],
    ],
  },
  {
    id: "plugin-sidebar-wide",
    edges: [
      [symbol(sidebar, "LeftSidebar"), symbol(sidebar, "DesktopSidebar")],
      [
        symbol(sidebar, "DesktopSidebar"),
        symbol(app + "plugins/sidebar-items.tsx", "PluginSidebarItems"),
      ],
    ],
  },
  {
    id: "skills-renderer",
    edges: [
      [
        symbol(root, "AppContainer"),
        symbol(app + "agent-skills/legacy-migration.tsx", "LegacyAgentSkillsMigration"),
      ],
    ],
  },
];

export const SKILL_OWNERS = {
  bootstrap: symbol(server + "bootstrap.ts", "createOttoDaemon"),
  startup: symbol(server + "orchestration-skills/startup.ts", "createStartupOrchestrationSkills"),
  migration: symbol(app + "agent-skills/legacy-migration.tsx", "LegacyAgentSkillsMigration"),
  controller: symbol(
    app + "agent-skills/legacy-migration-controller.ts",
    "createLegacyMigrationController",
  ),
  ports: {
    getLocalStatus: symbol(app + "desktop/daemon/desktop-daemon.ts", "getDesktopDaemonStatus"),
    read: symbol(app + "desktop/daemon/desktop-daemon.ts", "readLegacySkillSelection"),
    remove: symbol(app + "desktop/daemon/desktop-daemon.ts", "deleteLegacySkillSelection"),
  },
};

export const EXCLUSIONS = [
  {
    id: "hub",
    path: server + "hub/",
    reason:
      "Permanent upstream exclusion. Retained source and erased types are allowed; runtime value imports terminate at hub-disabled. Compiled graph check remains required.",
  },
  {
    id: "plugin-themes",
    path: app + "plugins/themes/",
    reason:
      "Retained parsing plumbing; palette application deferred pending Otto appearance design. This does not exclude plugin catalog, commands or sidebars.",
  },
  {
    id: "old-editor-targets",
    path: "packages/desktop/src/features/editor-targets.ts",
    reason: "Superseded by the live features/editor-targets/ipc.ts owner.",
  },
  {
    id: "plugin-process",
    path: server + "plugins/plugin-process.ts",
    reason:
      "Intentional dynamic child-process entry, launched by plugins/runtime.ts rather than imported.",
  },
];
