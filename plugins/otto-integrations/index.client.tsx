import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AtlassianSettings } from "./client/settings.js";
import { BitbucketSettings } from "@getpaseo/plugin/client/otto-bitbucket";
export default function contribute(client: PluginClientContext) {
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
    await bitbucket();
    await account();
  };
}
