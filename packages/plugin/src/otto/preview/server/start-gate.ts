import { previewCommandRevision, readPreviewLaunchConfig } from "./launch-config.js";
export interface PreviewCommandApproval {
  name: string;
  revision: string;
  command: string;
  cwd: string;
  changed: boolean;
}
/** Per live provider session. A catalog refresh cannot silently reapprove a changed command. */
export class PreviewStartGate {
  private readonly baseline = new Map<string, string>();
  private captured = false;
  constructor(private readonly cwd: string) {}
  async capture(): Promise<void> {
    if (this.captured) return;
    this.captured = true;
    try {
      const config = await readPreviewLaunchConfig(this.cwd);
      if (config)
        for (const entry of config.servers)
          this.baseline.set(entry.name, previewCommandRevision(config.cwd, entry));
    } catch {
      // An unreadable initial file grants nothing. Resolving a later valid entry
      // still requires explicit approval; it never establishes a new baseline.
    }
  }
  async resolve(name: string): Promise<PreviewCommandApproval> {
    if (!this.captured) throw new Error("Preview launch approval has not been initialized.");
    const config = await readPreviewLaunchConfig(this.cwd);
    const entry = config?.servers.find((candidate) => candidate.name === name);
    if (!config || !entry)
      throw new Error("Configure this server in .claude/launch.json before starting Preview.");
    const revision = previewCommandRevision(config.cwd, entry);
    return {
      name,
      revision,
      cwd: config.cwd,
      // JSON-quoted argv is presentation, not a shell command to evaluate.
      command: [entry.runtimeExecutable, ...(entry.runtimeArgs ?? [])]
        .map((part) => JSON.stringify(part))
        .join(" "),
      changed: this.baseline.get(name) !== revision,
    };
  }
  async accept(approval: PreviewCommandApproval): Promise<void> {
    const current = await this.resolve(approval.name);
    if (current.revision !== approval.revision)
      throw new Error(
        "The launch command changed during approval. Review it again before starting.",
      );
    this.baseline.set(approval.name, approval.revision);
  }
}
