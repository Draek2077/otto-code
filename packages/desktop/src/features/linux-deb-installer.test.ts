import { describe, expect, it, vi } from "vitest";
import { installLinuxDeb, runDebInstallerCommand } from "./linux-deb-installer";

function fixture() {
  const run = vi.fn(async (command: string, _args: string[]) => ({
    code: 0 as number | null,
    stdout:
      {
        "/usr/bin/dpkg-deb": "otto-code-desktop\n1.2.4",
        "/usr/bin/dpkg-query": "install ok installed\n1.2.4",
      }[command] ?? "",
    stderr: "",
  }));
  return { run, checkFile: vi.fn(async () => undefined), isRoot: () => false, log: vi.fn() };
}

describe("installLinuxDeb", () => {
  it("passes a literal filename directly to polkit and verifies the installed version", async () => {
    const deps = fixture();
    const file = "/home/user's downloads/Otto $(touch nope); update.deb";
    await installLinuxDeb(file, deps.log, deps);
    expect(deps.run.mock.calls).toEqual([
      ["/usr/bin/dpkg-deb", ["--show", "--showformat=${Package}\n${Version}", file]],
      ["/usr/bin/pkexec", ["--disable-internal-agent", "/usr/bin/dpkg", "-i", file]],
      [
        "/usr/bin/dpkg-query",
        ["--show", "--showformat=${Status}\n${Version}", "otto-code-desktop"],
      ],
    ]);
  });

  it.each([
    [126, "dismissed", "cancelled"],
    [127, "No authentication agent found", "could not authorize"],
    [1, "dpkg: error: database lock held by another process", "database lock"],
  ])(
    "reports exit %s without running apt or claiming installation",
    async (code, stderr, message) => {
      const deps = fixture();
      deps.run.mockImplementationOnce(async () => ({
        code: 0,
        stdout: "otto-code-desktop\n1.2.4",
        stderr: "",
      }));
      deps.run.mockImplementationOnce(async () => ({ code, stdout: "", stderr }));
      await expect(installLinuxDeb("/tmp/update.deb", deps.log, deps)).rejects.toThrow(message);
      expect(deps.run).toHaveBeenCalledTimes(2);
      expect(deps.log).toHaveBeenCalledWith(stderr);
    },
  );

  it.each(["ENOENT: no such file or directory", "EACCES: permission denied"])(
    "reports file preflight failures before requesting authorization: %s",
    async (message) => {
      const deps = fixture();
      deps.checkFile.mockRejectedValueOnce(new Error(`${message}: /tmp/update.deb`));
      await expect(installLinuxDeb("/tmp/update.deb", deps.log, deps)).rejects.toThrow(message);
      expect(deps.run).not.toHaveBeenCalled();
    },
  );

  it("does not accept a zero exit with the old version still installed", async () => {
    const deps = fixture();
    deps.run.mockImplementation(async (command) => ({
      code: 0,
      stderr: "",
      stdout: command.endsWith("dpkg-deb")
        ? "otto-code-desktop\n1.2.4"
        : "install ok installed\n1.2.3",
    }));
    await expect(installLinuxDeb("/tmp/update.deb", deps.log, deps)).rejects.toThrow(
      "Expected otto-code-desktop 1.2.4",
    );
  });

  it("installs directly when already running as root", async () => {
    const deps = fixture();
    await installLinuxDeb("/tmp/update.deb", deps.log, { ...deps, isRoot: () => true });
    expect(deps.run).toHaveBeenCalledWith("/usr/bin/dpkg", ["-i", "/tmp/update.deb"]);
    expect(deps.checkFile).not.toHaveBeenCalledWith("/usr/bin/pkexec", true);
  });

  it("waits for authorization to complete before verifying", async () => {
    const deps = fixture();
    const run = deps.run.getMockImplementation()!;
    let approve!: () => void;
    const authorization = new Promise<void>((resolve) => {
      approve = resolve;
    });
    deps.run.mockImplementation(async (command, args) => {
      if (command.endsWith("pkexec")) await authorization;
      return run(command, args);
    });
    const pending = installLinuxDeb("/tmp/update.deb", deps.log, deps);
    await vi.waitFor(() => expect(deps.run).toHaveBeenCalledTimes(2));
    approve();
    await pending;
    expect(deps.run).toHaveBeenCalledTimes(3);
  });
});

describe("runDebInstallerCommand", () => {
  it("captures real asynchronous process output without interpreting argument metacharacters", async () => {
    const argument = "a path/'with spaces'; $(echo bad)";
    const result = await runDebInstallerCommand(process.execPath, [
      "-e",
      "process.stdout.write(process.argv[1]); process.stderr.write('diagnostic'); process.exitCode = 9;",
      argument,
    ]);
    expect(result).toMatchObject({ code: 9, stdout: argument, stderr: "diagnostic" });
  });

  it("preserves missing executable errors", async () => {
    await expect(runDebInstallerCommand("/otto-nonexistent/installer", [])).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
