import { withUnistyles } from "react-native-unistyles";
import {
  Archive,
  ArrowDownUp,
  Download,
  GitCommitHorizontal,
  GitMerge,
  RefreshCcw,
  Upload,
} from "@/components/icons/material-icons";
import type { GitHostingProviderId } from "@otto-code/protocol/messages";
import { GitHostingIcon } from "@/components/icons/git-hosting-icon";
import { GitActionsSplitButton } from "@/git/actions-split-button";
import { useGitActions } from "@/git/use-actions";
import type { Theme } from "@/styles/theme";

interface WorkspaceActionsProps {
  serverId: string;
  cwd: string;
  hideLabels?: boolean;
  // Stretch to fill the available width (content stays centered).
  fill?: boolean;
}

const ThemedGitCommitHorizontal = withUnistyles(GitCommitHorizontal);
const ThemedDownload = withUnistyles(Download);
const ThemedUpload = withUnistyles(Upload);
const ThemedArrowDownUp = withUnistyles(ArrowDownUp);
const ThemedGitHostingIcon = withUnistyles(GitHostingIcon);
const ThemedGitMerge = withUnistyles(GitMerge);
const ThemedRefreshCcw = withUnistyles(RefreshCcw);
const ThemedArchive = withUnistyles(Archive);

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ICONS = {
  commit: <ThemedGitCommitHorizontal size={16} uniProps={mutedColorMapping} />,
  pull: <ThemedDownload size={16} uniProps={mutedColorMapping} />,
  push: <ThemedUpload size={16} uniProps={mutedColorMapping} />,
  pullAndPush: <ThemedArrowDownUp size={16} uniProps={mutedColorMapping} />,
  viewPr: (provider: GitHostingProviderId) => (
    <ThemedGitHostingIcon provider={provider} size={16} uniProps={mutedColorMapping} />
  ),
  createPr: (provider: GitHostingProviderId) => (
    <ThemedGitHostingIcon provider={provider} size={16} uniProps={mutedColorMapping} />
  ),
  mergePrSquash: (provider: GitHostingProviderId) => (
    <ThemedGitHostingIcon provider={provider} size={16} uniProps={mutedColorMapping} />
  ),
  mergePrMerge: (provider: GitHostingProviderId) => (
    <ThemedGitHostingIcon provider={provider} size={16} uniProps={mutedColorMapping} />
  ),
  mergePrRebase: (provider: GitHostingProviderId) => (
    <ThemedGitHostingIcon provider={provider} size={16} uniProps={mutedColorMapping} />
  ),
  merge: <ThemedGitMerge size={16} uniProps={mutedColorMapping} />,
  mergeFromBase: <ThemedRefreshCcw size={16} uniProps={mutedColorMapping} />,
  archive: <ThemedArchive size={16} uniProps={mutedColorMapping} />,
};

export function WorkspaceActions({ serverId, cwd, hideLabels, fill }: WorkspaceActionsProps) {
  const { gitActions } = useGitActions({
    serverId,
    cwd,
    icons: ICONS,
  });

  return <GitActionsSplitButton gitActions={gitActions} hideLabels={hideLabels} fill={fill} />;
}
