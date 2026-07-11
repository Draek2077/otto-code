import type { GitHostingProviderId } from "@otto-code/protocol/messages";
import { BitbucketIcon } from "@/components/icons/bitbucket-icon";
import { GitHubIcon } from "@/components/icons/github-icon";

interface GitHostingIconProps {
  provider?: GitHostingProviderId | null;
  size?: number;
  color?: string;
}

// The provider mark for the workspace's git hosting service. Defaults to
// GitHub for legacy paths that don't know the provider yet.
export function GitHostingIcon({ provider, size, color }: GitHostingIconProps) {
  if (provider === "bitbucket-cloud") {
    return <BitbucketIcon size={size} color={color} />;
  }
  return <GitHubIcon size={size} color={color} />;
}
