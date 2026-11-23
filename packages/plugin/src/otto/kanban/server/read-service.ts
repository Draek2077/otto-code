import {
  failure,
  ProjectBindingSchema,
  type BoardRead,
  type ProjectBinding,
  type ProjectConfiguration,
  type Result,
} from "../shared/model.js";
import type { BoardReader, ProjectBoardPort, ProjectSnapshot } from "./ports.js";
import { normalizeTarget, readProjectTarget, resolveGitHubTarget } from "./project-config.js";

function validateBinding(hostId: string, binding: ProjectBinding): Result<ProjectBinding> {
  if (!ProjectBindingSchema.safeParse(binding).success || hostId !== binding.hostId) {
    return failure("wrong_host", "Select this project's owning host.");
  }
  return { ok: true, value: binding };
}

function validateSnapshot(
  binding: ProjectBinding,
  snapshot: ProjectSnapshot,
): Result<ProjectSnapshot> {
  if (
    snapshot.binding.hostId !== binding.hostId ||
    snapshot.binding.projectId !== binding.projectId
  ) {
    return failure("wrong_host", "The host returned settings for a different project.");
  }
  return { ok: true, value: snapshot };
}

// Construction is inert. Only explicit calls use injected host ports.
export function createBoardService(ports: { projects: ProjectBoardPort; github: BoardReader }) {
  async function project(binding: ProjectBinding): Promise<Result<ProjectSnapshot>> {
    const valid = validateBinding(ports.projects.hostId, binding);
    if (!valid.ok) return valid;
    try {
      const result = await ports.projects.read(binding);
      return result.ok ? validateSnapshot(binding, result.value) : result;
    } catch {
      return failure("unavailable", "The owning host could not read Project Settings.");
    }
  }

  return {
    async read(binding: ProjectBinding): Promise<BoardRead> {
      const result = await project(binding);
      if (!result.ok) return { status: "error", binding, error: result.error };
      const snapshot = result.value;
      const target = readProjectTarget(snapshot.record);
      if (!target.ok) return { status: "error", binding, error: target.error };
      if (!target.value)
        return { status: "unconfigured", binding, settingsRevision: snapshot.revision };
      const resolved = resolveGitHubTarget({ target: target.value, remote: snapshot.githubRemote });
      if (!resolved.ok) return { status: "error", binding, error: resolved.error };
      let board;
      try {
        board = await ports.github.read({ binding, target: resolved.value });
      } catch {
        return {
          status: "error",
          binding,
          error: { code: "unavailable", message: "The owning host could not read the board." },
        };
      }
      return board.ok
        ? { status: "ready", binding, settingsRevision: snapshot.revision, board: board.value }
        : { status: "error", binding, error: board.error };
    },
    async setTarget(input: {
      binding: ProjectBinding;
      expectedRevision: string;
      target: unknown;
    }): Promise<Result<ProjectConfiguration>> {
      const valid = validateBinding(ports.projects.hostId, input.binding);
      if (!valid.ok) return valid;
      if (!input.expectedRevision)
        return failure("revision_conflict", "Reload Project Settings before saving.");
      const target =
        input.target === null ? { ok: true as const, value: null } : normalizeTarget(input.target);
      if (!target.ok) return target;
      try {
        const result = await ports.projects.setTarget({ ...input, target: target.value });
        if (!result.ok) return result;
        const saved = validateSnapshot(input.binding, result.value);
        if (!saved.ok) return saved;
        const storedTarget = readProjectTarget(saved.value.record);
        if (!storedTarget.ok) return storedTarget;
        // Return only non-secret feature data, never the host's raw project record.
        return {
          ok: true,
          value: {
            binding: input.binding,
            settingsRevision: saved.value.revision,
            target: storedTarget.value,
          },
        };
      } catch {
        return failure("unavailable", "The owning host could not save Project Settings.");
      }
    },
  };
}
