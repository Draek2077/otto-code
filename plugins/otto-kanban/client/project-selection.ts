export interface ProjectChoice {
  projectId: string;
  projectDisplayName: string;
}

export interface ProjectSelection {
  hostId: string;
  projectId: string;
}

export function resolveProjectSelection(input: {
  hostId: string;
  projects: readonly ProjectChoice[];
  explicit: ProjectSelection | null;
  hint: ProjectSelection | null;
}): string | null {
  for (const selection of [input.explicit, input.hint]) {
    if (
      selection?.hostId === input.hostId &&
      input.projects.some((project) => project.projectId === selection.projectId)
    ) {
      return selection.projectId;
    }
  }
  // The absence of workspace context is not authority to choose another project.
  return null;
}

export function projectHint(params: Record<string, string>): ProjectSelection | null {
  return params.projectHostId && params.projectId
    ? { hostId: params.projectHostId, projectId: params.projectId }
    : null;
}
