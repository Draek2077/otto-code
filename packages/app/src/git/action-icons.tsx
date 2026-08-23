import type { GitHostingProviderId } from "@otto-code/protocol/messages";
import { withUnistyles } from "react-native-unistyles";
import {
  Archive,
  ArrowDownUp,
  Download,
  RefreshCcw,
  Upload,
} from "@/components/icons/material-icons";
import { GitCommitHorizontal, GitMerge } from "@/components/icons/lucide";
import type { Theme } from "@/styles/theme";
import { GitHostingIcon } from "@/components/icons/git-hosting-icon";

const ThemedGitCommitHorizontal = withUnistyles(GitCommitHorizontal);
const ThemedDownload = withUnistyles(Download);
const ThemedUpload = withUnistyles(Upload);
const ThemedArrowDownUp = withUnistyles(ArrowDownUp);
const ThemedGitMerge = withUnistyles(GitMerge);
const ThemedRefreshCcw = withUnistyles(RefreshCcw);
const ThemedArchive = withUnistyles(Archive);
const ThemedGitHostingIcon = withUnistyles(GitHostingIcon);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const GIT_ACTION_ICONS = {
  commit: <ThemedGitCommitHorizontal size="md" uniProps={mutedColorMapping} />,
  pull: <ThemedDownload size="md" uniProps={mutedColorMapping} />,
  push: <ThemedUpload size="md" uniProps={mutedColorMapping} />,
  pullAndPush: <ThemedArrowDownUp size="md" uniProps={mutedColorMapping} />,
  fetch: <ThemedRefreshCcw size="md" uniProps={mutedColorMapping} />,
  viewPr: (provider: GitHostingProviderId) => (
    <ThemedGitHostingIcon provider={provider} size="md" uniProps={mutedColorMapping} />
  ),
  createPr: (provider: GitHostingProviderId) => (
    <ThemedGitHostingIcon provider={provider} size="md" uniProps={mutedColorMapping} />
  ),
  mergePrSquash: (provider: GitHostingProviderId) => (
    <ThemedGitHostingIcon provider={provider} size="md" uniProps={mutedColorMapping} />
  ),
  mergePrMerge: (provider: GitHostingProviderId) => (
    <ThemedGitHostingIcon provider={provider} size="md" uniProps={mutedColorMapping} />
  ),
  mergePrRebase: (provider: GitHostingProviderId) => (
    <ThemedGitHostingIcon provider={provider} size="md" uniProps={mutedColorMapping} />
  ),
  merge: <ThemedGitMerge size="md" uniProps={mutedColorMapping} />,
  mergeFromBase: <ThemedRefreshCcw size="md" uniProps={mutedColorMapping} />,
  archive: <ThemedArchive size="md" uniProps={mutedColorMapping} />,
};
