import type { GitHostingProviderId } from "@otto-code/protocol/messages";
import { withUnistyles } from "react-native-unistyles";
import {
  Archive,
  ArrowDownUp,
  Download,
  GitCommitHorizontal,
  GitMerge,
  RefreshCcw,
  Upload,
} from "lucide-react-native";
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
  commit: <ThemedGitCommitHorizontal size={16} uniProps={mutedColorMapping} />,
  pull: <ThemedDownload size={16} uniProps={mutedColorMapping} />,
  push: <ThemedUpload size={16} uniProps={mutedColorMapping} />,
  pullAndPush: <ThemedArrowDownUp size={16} uniProps={mutedColorMapping} />,
  fetch: <ThemedRefreshCcw size={16} uniProps={mutedColorMapping} />,
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
