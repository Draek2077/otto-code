import { BitbucketIcon } from "@/components/icons/bitbucket-icon";
import type { ClientForgeViewModule } from "@/git/client-forge-module";

export const bitbucketCloudForgeView = {
  id: "bitbucket-cloud",
  icon: BitbucketIcon,
  brandColor: {
    light: "#2684FF",
    dark: "#2684FF",
  },
} satisfies ClientForgeViewModule;
