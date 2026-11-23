import type { Board, ProjectBinding, ProjectTarget, Result } from "../shared/model.js";

export interface ProjectSnapshot {
  binding: ProjectBinding;
  revision: string;
  // The host reads the preserved record, including dormant Otto fields.
  record: unknown;
  githubRemote: { owner: string; repository: string } | null;
}

// The eventual host bridge owns authorization, record lookup, locking and atomic
// persistence. No implementation may accept a client-supplied path or whole record.
export interface ProjectBoardPort {
  readonly hostId: string;
  read(binding: ProjectBinding): Promise<Result<ProjectSnapshot>>;
  setTarget(input: {
    binding: ProjectBinding;
    expectedRevision: string;
    target: ProjectTarget | null;
  }): Promise<Result<ProjectSnapshot>>;
}

// Implemented by the owning daemon's existing gh policy. No tokens, headers,
// auth login/refresh/account switching or fetch implementation belong here.
// Return the raw GraphQL envelope, or a safe typed transport/auth error.
export interface GitHubReadPort {
  readonly hostId: string;
  query(input: {
    binding: ProjectBinding;
    document: string;
    variables: Record<string, string | number | null>;
  }): Promise<Result<unknown>>;
}

export type GitHubTarget =
  | { kind: "node"; id: string }
  | { kind: "number"; owner: string; number: number }
  | { kind: "repository"; owner: string; repository: string };

export interface BoardReader {
  read(input: { binding: ProjectBinding; target: GitHubTarget }): Promise<Result<Board>>;
}
