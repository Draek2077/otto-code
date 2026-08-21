import { describe, expect, test } from "vitest";
import type { HostProjectListItem } from "./host-project-model";
import {
  canCreateWorkspaceForHostProject,
  getHostProjectId,
  getHostProjectSourceDirectory,
  getWorktreeSupportForHostProject,
  hostProjectFromRoute,
  hostProjectFromWorkspace,
  resolveInitialWorkspaceProject,
  resolveEquivalentHostProjectCandidate,
} from "./host-project-model";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { normalizeWorkspaceDescriptor } from "@/stores/session-store";

function project(): HostProjectListItem {
  return {
    viewKey: "view:acme/app",
    projectKey: "remote:github.com/acme/app",
    projectName: "acme/app",
    projectKind: "git",
    iconWorkingDir: "/repo/a",
    hosts: [
      {
        serverId: "host-a",
        projectId: "prj_a",
        iconWorkingDir: "/repo/a",
        worktreeSupport: "supported" as const,
      },
      {
        serverId: "host-b",
        projectId: "prj_b",
        iconWorkingDir: "/repo/b",
        worktreeSupport: "supported" as const,
      },
    ],
    workspaceKeys: [],
  };
}

describe("host project lookups", () => {
  test("resolves equivalent projects without Array.prototype.toSorted", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
    Reflect.deleteProperty(Array.prototype, "toSorted");
    const first = project();
    first.viewKey = "view:first";
    first.projectName = "First";
    const second = project();
    second.viewKey = "view:second";
    second.projectName = "Second";
    const projects = [second, first];

    try {
      expect(
        resolveEquivalentHostProjectCandidate({
          candidate: first,
          projects,
          serverId: "host-a",
        }),
      ).toBe(first);
      expect(projects).toEqual([second, first]);
    } finally {
      if (descriptor) Reflect.defineProperty(Array.prototype, "toSorted", descriptor);
    }
  });

  test("returns host-local ids and roots without falling back to the grouping key", () => {
    expect(getHostProjectId(project(), "host-b")).toBe("prj_b");
    expect(getHostProjectSourceDirectory(project(), "host-b")).toBe("/repo/b");
    expect(getHostProjectId(project(), "missing")).toBeNull();
  });

  test("checks workspace creation against the selected host placement", () => {
    expect(
      canCreateWorkspaceForHostProject({
        project: project(),
        serverId: "host-b",
        allowAllProjects: false,
      }),
    ).toBe(true);
  });

  test("checks worktree capability against the selected host placement", () => {
    const groupedProject = project();
    groupedProject.hosts[1] = {
      ...groupedProject.hosts[1]!,
      worktreeSupport: "unsupported" as const,
    };

    expect(getWorktreeSupportForHostProject({ project: groupedProject, serverId: "host-a" })).toBe(
      "supported",
    );
    expect(getWorktreeSupportForHostProject({ project: groupedProject, serverId: "host-b" })).toBe(
      "unsupported",
    );
    expect(getWorktreeSupportForHostProject({ project: groupedProject, serverId: "missing" })).toBe(
      "unknown",
    );
  });

  test("marks route placeholder worktree support as unknown", () => {
    const routeProject = hostProjectFromRoute({
      serverId: "host-a",
      projectId: "prj_a",
      displayName: "App",
      sourceDirectory: "/repo/a",
    });
    expect(routeProject).not.toBeNull();
    expect(routeProject!.projectKind).toBe("unknown");
    expect(getWorktreeSupportForHostProject({ project: routeProject!, serverId: "host-a" })).toBe(
      "unknown",
    );
  });

  test("builds an unhydrated route project around the routed project id", () => {
    expect(
      hostProjectFromRoute({
        serverId: "host-a",
        projectId: "prj_a",
        displayName: "App",
        sourceDirectory: "/repo/a",
      }),
    ).toMatchObject({
      projectKey: null,
      hosts: [{ serverId: "host-a", projectId: "prj_a" }],
    });
  });

  test("keeps canonical equivalence identity separate from host placement identity", () => {
    const normalizedWorkspace = normalizeWorkspaceDescriptor({
      id: "workspace-a",
      projectId: "project-a",
      projectDisplayName: "App",
      projectRootPath: "/repo/app",
      workspaceDirectory: "/repo/app",
      projectKind: "git",
      workspaceKind: "local_checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
      project: {
        projectKey: "remote:github.com/acme/app",
        projectName: "App",
        checkout: {
          cwd: "/repo/app",
          isGit: true,
          currentBranch: "main",
          remoteUrl: "https://github.com/acme/app.git",
          worktreeRoot: "/repo/app",
          isOttoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      },
    });

    expect(
      hostProjectFromWorkspace({ serverId: "host-a", workspace: normalizedWorkspace }),
    ).toMatchObject({
      viewKey: JSON.stringify(["host-a", "project-a"]),
      projectKey: "remote:github.com/acme/app",
      hosts: [{ serverId: "host-a", projectId: "project-a" }],
    });
  });
});

// The daemon looks a `projectId` up in its project registry and throws
// "Project not found for worktree: <value>" on a miss. `deriveProjectKey`
// produces `host:<serverId>:<path>` and `remote:<host>/<path>`, and neither
// is ever a registry id -- so a create request carrying one is the bug.
function looksLikeGroupingKey(value: string | null): boolean {
  return value !== null && /^(?:host:|remote:)/u.test(value);
}

function workspace(input: { projectId: string }): WorkspaceDescriptor {
  return {
    id: "ws-main",
    projectId: input.projectId,
    projectDisplayName: "acme/app",
    projectRootPath: "/repo/a",
    workspaceDirectory: "/repo/a",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

// Regression: the New Workspace screen took `project.projectKey` as the
// `projectId` it sent to the daemon. That is invisible whenever the two happen
// to coincide -- which they do for a project Otto seeded itself -- so every
// fixture here keeps them apart, and every assertion is on the wire value the
// screen would actually send: `getHostProjectId(resolvedProject, serverId)`.
describe("the project id sent for workspace creation", () => {
  test("is the host id, whether or not the routed project hydrates against the list", () => {
    const routeProject = hostProjectFromRoute({
      serverId: "host-a",
      projectId: "prj_a",
      displayName: "App",
      sourceDirectory: "/repo/a",
    });

    // Hydrated: the route matches the loaded project by its host placement,
    // even though the routed value matches no project's `projectKey`.
    const hydrated = resolveInitialWorkspaceProject({
      routeProject,
      lastActiveProject: null,
      projects: [project()],
      serverId: "host-a",
      allowAllProjects: false,
    });
    expect(hydrated?.projectKey).toBe("remote:github.com/acme/app");
    expect(getHostProjectId(hydrated!, "host-a")).toBe("prj_a");

    // Unhydrated: the list has not arrived yet, so the screen falls back to the
    // route project itself. That fallback must still carry a usable id.
    const unhydrated = resolveInitialWorkspaceProject({
      routeProject,
      lastActiveProject: null,
      projects: [],
      serverId: "host-a",
      allowAllProjects: false,
    });
    expect(getHostProjectId(unhydrated!, "host-a")).toBe("prj_a");
  });

  test("is never the cross-host grouping key, from any source the screen resolves", () => {
    const sources = [
      project(),
      hostProjectFromRoute({
        serverId: "host-a",
        projectId: "prj_a",
        displayName: "App",
        sourceDirectory: "/repo/a",
      })!,
      hostProjectFromWorkspace({
        serverId: "host-a",
        workspace: workspace({ projectId: "prj_a" }),
      })!,
    ];

    for (const source of sources) {
      const sent = getHostProjectId(source, "host-a");
      expect(sent).toBe("prj_a");
      expect(looksLikeGroupingKey(sent)).toBe(false);
    }
  });

  test("is absent rather than wrong when the project has no placement on this host", () => {
    // A project row groups hosts, so it can be visible while carrying nothing
    // for the selected host. Callers send `undefined` and let the daemon
    // resolve the project from the source directory; they must not substitute
    // `projectKey`, which resolves to a different project or to none.
    expect(getHostProjectId(project(), "host-c")).toBeNull();
  });
});
