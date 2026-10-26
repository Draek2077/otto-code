import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { instructionReferences, renderInstructions } from "./instruction-graph.js";

const MAX_BYTES = 128 * 1024;
const MAX_FILES = 32;
const MAX_DEPTH = 8;

function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function workspaceRoot(cwd: string): Promise<string> {
  for (let directory = cwd; ; directory = path.dirname(directory)) {
    if (await exists(path.join(directory, ".git"))) return directory;
    if (path.dirname(directory) === directory) return cwd;
  }
}

function chain(root: string, directory: string): string[] {
  const parts = path.relative(root, directory).split(path.sep).filter(Boolean);
  return [root, ...parts.map((_, index) => path.join(root, ...parts.slice(0, index + 1)))];
}

/** Local literal imports are instructions; ordinary links and code examples are not. */
function imports(text: string): string[] {
  return instructionReferences(text)
    .filter((reference) => reference.kind === "import")
    .map((reference) => reference.target);
}

export interface InstructionBlock {
  file: string;
  scope: string;
  text: string;
}

/**
 * Provider-owned source for fixed and conditional instructions. Keep this resolver
 * reusable when Context Management returns, rather than starting a second graph.
 * Files are bounded and reread for each request, never copied into persistent chat.
 */
export class InstructionSource {
  private lastBlocks: InstructionBlock[] = [];
  private readonly directories = new Set<string>();
  private admitted = "";
  private constructor(
    private readonly cwd: string,
    private readonly home: string,
    private readonly root: string,
  ) {}

  static async create(options: { cwd: string; home: string }): Promise<InstructionSource> {
    const cwd = await realpath(options.cwd);
    return new InstructionSource(cwd, await realpath(options.home), await workspaceRoot(cwd));
  }

  get workspaceRoot(): string {
    return this.root;
  }

  beginTurn(): void {
    this.directories.clear();
    this.admitted = "";
  }

  async forRequest(): Promise<string> {
    const blocks = await this.load();
    this.admitted = this.signature(blocks);
    this.lastBlocks = blocks;
    return renderInstructions(blocks);
  }

  preparedBlocks(): readonly InstructionBlock[] {
    return this.lastBlocks;
  }

  preparedText(): string {
    return renderInstructions(this.lastBlocks);
  }

  /** Read-only inspection uses the runtime's exact resolver without admitting a write. */
  async inspect(): Promise<{ blocks: InstructionBlock[]; text: string }> {
    const blocks = await this.load();
    return { blocks, text: renderInstructions(blocks) };
  }

  /** A native write waits until its applicable current rules have reached the model. */
  async beforeFile(options: { file: string; write: boolean }): Promise<void> {
    const directory = await realpath(path.dirname(options.file));
    if (contains(this.root, directory)) this.directories.add(directory);
    else if (!options.write) return;
    const current = this.signature(await this.load());
    if (options.write && current !== this.admitted)
      throw new Error(
        "Repository instructions were added or changed. No file was written. Review the current instructions in the next request, then retry this write if it still follows them.",
      );
  }

  private signature(blocks: InstructionBlock[]): string {
    return createHash("sha256").update(JSON.stringify(blocks)).digest("hex");
  }

  private async load(): Promise<InstructionBlock[]> {
    const blocks: InstructionBlock[] = [];
    const seen = new Set<string>();
    let bytes = 0;
    const visit = async (candidate: string, scope: string, depth = 0): Promise<void> => {
      if (depth > MAX_DEPTH) throw new Error("Repository instruction imports exceed 8 levels.");
      const file = await realpath(candidate);
      if (!contains(this.root, file) && !contains(this.home, file))
        throw new Error(`Instruction file is outside the workspace and Otto home: ${candidate}`);
      if (seen.has(file)) return;
      if (seen.size >= MAX_FILES) throw new Error("Repository instructions exceed 32 files.");
      seen.add(file);
      const handle = await open(file, "r");
      let text: string;
      try {
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let size = 0;
        while (size < buffer.length) {
          const result = await handle.read(buffer, size, buffer.length - size, null);
          if (!result.bytesRead) break;
          size += result.bytesRead;
        }
        bytes += size;
        if (bytes > MAX_BYTES) throw new Error("Repository instructions exceed 128 KiB.");
        text = buffer.subarray(0, size).toString("utf8");
      } finally {
        await handle.close();
      }
      if (text.includes("\0")) throw new Error(`Instruction file is not text: ${candidate}`);
      // Windows checkouts can materialize the repository's AGENTS.md symlink as
      // a small file containing CLAUDE.md. Honor only this explicit convention.
      if (path.basename(file) === "AGENTS.md" && text.trim() === "CLAUDE.md") {
        await visit(path.join(path.dirname(file), "CLAUDE.md"), scope, depth + 1);
        return;
      }
      blocks.push({ file, scope, text });
      for (const reference of imports(text))
        await visit(path.resolve(path.dirname(file), reference), scope, depth + 1);
    };
    const directories = new Set([
      this.home,
      ...chain(this.root, this.cwd),
      ...[...this.directories].sort().flatMap((directory) => chain(this.root, directory)),
    ]);
    for (const directory of directories) {
      const agents = path.join(directory, "AGENTS.md");
      const file = (await exists(agents)) ? agents : path.join(directory, "CLAUDE.md");
      if (await exists(file)) await visit(file, directory);
    }
    return blocks;
  }
}
