import type { GitHostingProviderId } from "@otto-code/protocol/messages";
import { GitHostingIcon } from "@/components/icons/git-hosting-icon";

export function PullRequestTabIcon({
  size,
  color,
  provider,
}: {
  size: number;
  color: string;
  provider?: GitHostingProviderId | null;
}) {
  return <GitHostingIcon provider={provider} size={size} color={color} />;
}
