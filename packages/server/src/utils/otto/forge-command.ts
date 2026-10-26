import { findExecutableWithoutProbing } from "../../executable-resolution/executable-resolution.js";
import { execCommand } from "../spawn.js";

/** Native Windows CLIs receive argv directly: cmd.exe corrupts multiline GraphQL/JSON. */
export async function execForgeCommand(
  binary: string,
  args: string[],
  options: NonNullable<Parameters<typeof execCommand>[2]> & { cwd: string },
): ReturnType<typeof execCommand> {
  const executable =
    process.platform === "win32"
      ? await findExecutableWithoutProbing(binary, {
          cwd: options.cwd,
          path: options.envOverlay?.PATH,
        })
      : null;
  // A missing executable retains normal missing-CLI classification. Resolved .cmd/.bat
  // wrappers retain the shared launcher's script policy; native .exe paths bypass it.
  return execCommand(executable ?? binary, args, options);
}
