import type { Command } from "commander";

const resolutionHelp =
  "\nHub origin precedence: command origin/--hub, OTTO_HUB_URL, active stored login, then https://hub.otto-code.me.\nCredential precedence: --api-key, OTTO_HUB_API_KEY, then a stored login for the exact resolved origin.\n";

export function addHubResolutionHelp(command: Command): Command {
  return command.addHelpText("after", resolutionHelp);
}
