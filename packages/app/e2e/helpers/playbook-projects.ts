import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * E2E's door onto the boilerplate-project corpus in `test-documents/projects`.
 *
 * The corpus and its materializer are shared with the usage playbooks
 * (`scripts/dev-agent-bootstrap.mjs`) and with marketing captures. That sharing is
 * the point, not a convenience: a spec asserting about Otto and an agent driving it
 * by hand have to be working against identical ground truth, or a green suite stops
 * being evidence about the thing the agent just looked at. See
 * `projects/usage-playbooks/usage-playbooks.md`.
 *
 * Loaded through a file URL at call time rather than a static import, the same way
 * `daemon-client-loader.ts` reaches `packages/client/dist`. The materializer is a
 * plain `.mjs` outside this package, so it is not in the app's TS project graph and
 * a static import would not resolve.
 */

export interface PlaybookTemplate {
  name: string;
  dir: string;
  treeDir: string;
  label: string;
  description: string;
  tool: string | null;
  toolVersionArgs: string[];
  build: string[] | null;
  test: string[] | null;
  breaks: Array<{ slug: string; detail?: string }>;
}

export interface MaterializeResult {
  dir: string;
  template: PlaybookTemplate;
  /** False when the directory already held a repo and was left alone. */
  created: boolean;
  branches: string[];
}

export interface TemplateCheckResult {
  status: "passed" | "failed" | "skipped" | "failed-as-expected" | "unexpectedly-passed";
  reason?: string;
  steps: Array<{ label: string; status: "passed" | "failed"; output: string }>;
}

interface PlaybookProjectsModule {
  TEMPLATE_ROOT: string;
  listTemplates(): string[];
  readTemplate(name: string): PlaybookTemplate;
  listBranches(dir: string): string[];
  materializeTemplate(input: {
    name: string;
    targetDir: string;
    force?: boolean;
  }): MaterializeResult;
  runTemplateChecks(input: {
    dir: string;
    template: PlaybookTemplate;
    expectFailure?: boolean;
  }): TemplateCheckResult;
}

let cached: PlaybookProjectsModule | null = null;

export async function loadPlaybookProjects(): Promise<PlaybookProjectsModule> {
  if (cached) {
    return cached;
  }
  const repoRoot = path.resolve(__dirname, "../../../..");
  const moduleUrl = pathToFileURL(path.join(repoRoot, "scripts/playbook-projects.mjs")).href;
  cached = (await import(moduleUrl)) as PlaybookProjectsModule;
  return cached;
}

/**
 * Materializes a template into a throwaway directory and returns it on `main`.
 *
 * Specs get a real git repo with real code and a real history, plus the
 * `break/<slug>` branches for anything that needs a failing build. Nothing is
 * cleaned up here — pass a path under the run's temp dir and let the harness that
 * owns it do the removal.
 */
export async function materializePlaybookProject(input: {
  name: string;
  targetDir: string;
  force?: boolean;
}): Promise<MaterializeResult> {
  const playbookProjects = await loadPlaybookProjects();
  return playbookProjects.materializeTemplate(input);
}

export async function listPlaybookTemplates(): Promise<string[]> {
  const playbookProjects = await loadPlaybookProjects();
  return playbookProjects.listTemplates();
}
