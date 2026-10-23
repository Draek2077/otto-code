import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { commandPlan } from "./command.js";
import { run } from "./repo.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-npm-"));
  roots.push(root);
  for (const name of ["npm", "npx"])
    fs.writeFileSync(
      path.join(root, `${name}-cli.js`),
      "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
    );
  return { root, env: { ...process.env, npm_execpath: path.join(root, "npm-cli.js") } };
}

it("keeps Windows npm/npx arguments literal without a command shell", async () => {
  const { env } = fixture();
  const args = ["path with spaces & metacharacters", "$(literal)", "a;b", '"quoted"'];
  for (const name of ["npm", "npx"]) {
    const plan = commandPlan(name, args, env, "win32");
    expect(plan.command).toBe(process.execPath);
    const result = await run(plan.command, plan.args, { env: plan.env });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.stdout)).toEqual(args);
  }
  expect(env.ELECTRON_RUN_AS_NODE).toBe(process.env.ELECTRON_RUN_AS_NODE);
});

it("fails before launch when Windows npm cannot be resolved", () => {
  const { root } = fixture();
  expect(() =>
    commandPlan("npm", [], { PATH: "" }, "win32", path.join(root, "missing-node.exe")),
  ).toThrow("could not locate npm-cli.js");
});

it("cancels an owned silent fixture command", async () => {
  await expect(
    run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { signal: AbortSignal.timeout(100) }),
  ).rejects.toThrow();
});
