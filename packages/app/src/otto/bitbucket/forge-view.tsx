import { SvgPathIcon, type SvgPathIconProps } from "@/components/icons/svg-path-icon";
import type { ClientForgeViewModule } from "@/git/client-forge-module";

function BitbucketIcon(props: SvgPathIconProps) {
  return (
    <SvgPathIcon
      {...props}
      viewBox="0 0 24 24"
      path="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81a1.043 1.043 0 0 0 1.02.872h15.65a.768.768 0 0 0 .768-.645l3.262-20.033a.768.768 0 0 0-.768-.896zM14.52 15.53H9.525L8.173 8.467h7.559z"
    />
  );
}
export const bitbucketCloudForgeView = {
  id: "bitbucket-cloud",
  icon: BitbucketIcon,
  brandColor: { light: "#0052CC", dark: "#579DFF" },
} satisfies ClientForgeViewModule;
