import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { execForgeCommand } from "./forge-command.js";

test("forge argv preserves multiline queries, quotes and shell metacharacters in a real child", async () => {
  const scratch = fileURLToPath(new URL("../../../../../.tmp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, "forge arguments "));
  try {
    const script = path.join(directory, "read arguments.mjs");
    await writeFile(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    const args = [
      "api",
      "graphql",
      "-f",
      'query=query Status {\n  repository(owner: "fixture", name: "example") {\n    name\n  }\n}',
      'JSON={"label":"a & b | c (100%)", "path":"C:\\\\fixture\\\\"}',
      "literal %PATH% ! ^ < >",
    ];
    const result = await execForgeCommand("node", [script, ...args], { cwd: directory });
    expect(JSON.parse(result.stdout)).toEqual(args);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
