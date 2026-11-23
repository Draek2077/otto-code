// Select the native dev-home wrapper. Windows' `bash` can mean WSL, whose
// environment and filesystem are separate from the checkout's Node install.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const windows = process.platform === "win32";
const args = windows
  ? ["-NoProfile", "-File", path.join(root, "scripts/otto/dev-cli.ps1"), ...process.argv.slice(2)]
  : [
      path.join(root, "scripts/dev-home.sh"),
      process.execPath,
      "--import",
      "tsx",
      path.join(root, "packages/cli/src/index.ts"),
      ...process.argv.slice(2),
    ];
const child = spawn(windows ? "powershell.exe" : "bash", args, { cwd: root, stdio: "inherit" });
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
