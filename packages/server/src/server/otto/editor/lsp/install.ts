/** Commands are selected by the owning host, displayed verbatim, and never run
 * by discovery. Linux package feeds vary; use Microsoft's distro instructions
 * instead of guessing that an apt package/repository exists. */
export function serverPrerequisite(id: string, platform: NodeJS.Platform = process.platform) {
  if (id !== "csharp") return undefined;
  let install = null;
  if (platform === "win32")
    install = {
      command: "winget",
      args: ["install", "--id", "Microsoft.DotNet.SDK.10", "--exact", "--source", "winget"],
      display: "winget install --id Microsoft.DotNet.SDK.10 --exact --source winget",
    };
  if (platform === "darwin")
    install = {
      command: "brew",
      args: ["install", "--cask", "dotnet-sdk"],
      display: "brew install --cask dotnet-sdk",
    };
  return {
    label:
      "Installing current csharp-ls requires .NET SDK 10 or later. Install the SDK first, then open a fresh terminal for the language server command.",
    documentation: "https://learn.microsoft.com/dotnet/core/install/",
    install,
  };
}
