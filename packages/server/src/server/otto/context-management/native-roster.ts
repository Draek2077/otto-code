import path from "node:path";
import type { NativeContextPlan, NativeRosterRoot } from "./native-plan.js";
import { NativeContextFiles, type NativeFile } from "./native-files.js";
import { rosterDescriptor } from "./native-text.js";
import type { NativeContextEntry } from "./native-inventory.js";
import type { ContextCategory } from "@getpaseo/plugin/otto/context-management";

async function candidates(
  root: NativeRosterRoot,
  files: NativeContextFiles,
  recursive: boolean,
): Promise<string[]> {
  const result: string[] = [];
  const queue = [{ directory: root.directory, depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    for (const child of await files.children(current.directory)) {
      if (path.basename(child.file).startsWith(".")) continue;
      if (root.kind === "subagent") {
        if (!child.directory && child.file.endsWith(".md")) result.push(child.file);
        continue;
      }
      if (child.directory || child.link) {
        const candidate = path.join(child.file, "SKILL.md");
        if (!recursive || (await files.identity(candidate))) result.push(candidate);
        else if (!child.link && current.depth < 5)
          queue.push({ directory: child.file, depth: current.depth + 1 });
      } else if (recursive && current.depth === 0 && child.file.endsWith(".md"))
        result.push(child.file);
    }
  }
  return result;
}
function skillId(file: string): string {
  return path.basename(file) === "SKILL.md"
    ? path.basename(path.dirname(file))
    : path.basename(file, ".md");
}
export async function inspectNativeRosters(
  input: { plan: NativeContextPlan; root: string; userHome: string },
  files: NativeContextFiles,
  add: (
    source: NativeFile,
    category: ContextCategory,
    costClass: NativeContextEntry["costClass"],
    countedText: string,
    imports: boolean,
  ) => NativeContextEntry | null,
) {
  const disabled = new Set(
    input.plan.disabledSkillPaths.map((file) =>
      path.resolve(input.root, file.replace(/^~[/\\]/u, input.userHome + path.sep)),
    ),
  );
  const selected = new Map<string, NativeContextEntry>();
  for (const root of input.plan.rosterRoots) {
    for (const candidate of await candidates(root, files, input.plan.provider === "opencode")) {
      if (disabled.has(candidate) || disabled.has(path.dirname(candidate))) continue;
      const source = await files.header(candidate);
      if (!source || disabled.has(source.file)) continue;
      const id = skillId(candidate);
      const fallback = input.plan.provider === "codex" ? undefined : id;
      const descriptor = rosterDescriptor(source.text, fallback, input.plan.provider);
      if (!descriptor) {
        files.note(`No valid name/description roster metadata in ${path.basename(candidate)}.`);
        continue;
      }
      const counted = JSON.stringify({
        name: descriptor.name,
        description: descriptor.description,
        file: source.file,
        kind: root.kind,
      });
      const entry = add(
        source,
        "skills_roster",
        descriptor.advertised ? "fixed" : "conditional",
        counted,
        false,
      );
      if (!entry) continue;
      entry.revision = source.revision;
      if (input.plan.provider === "opencode") {
        const key = `${root.kind}/${id}`;
        const previous = selected.get(key);
        if (previous && previous.file !== entry.file) previous.costClass = "conditional";
        selected.set(key, entry);
      }
    }
  }
  if (input.plan.provider === "codex")
    files.note(
      "Skill advertising is budgeted by Codex; this roster estimate is an inventory ceiling, not proof that every entry fits the actual advertised roster.",
    );
}
