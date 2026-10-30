import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AtlassianSettings } from "./client/settings.js";
import { BitbucketSettings } from "@getpaseo/plugin/client/otto-bitbucket";
import { ConnectorSettings } from "@getpaseo/plugin/client/otto-connectors";
export default function contribute(client: PluginClientContext) {
  const connectors = client.addSettingsScreen({
    id: "connectors",
    title: "Connectors",
    icon: "Plug",
    Component: ConnectorSettings,
  });
  const account = client.addSettingsScreen({
    id: "atlassian",
    title: "Atlassian account",
    icon: "Plug",
    Component: AtlassianSettings,
  });
  const bitbucket = client.addSettingsScreen({
    id: "bitbucket",
    title: "Bitbucket connections",
    icon: "GitPullRequest",
    Component: BitbucketSettings,
  });
  return async () => {
    await connectors();
    await bitbucket();
    await account();
  };
}
