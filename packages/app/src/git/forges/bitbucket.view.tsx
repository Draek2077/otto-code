import { BitbucketIcon } from "@/components/icons/bitbucket-icon";
import type { ClientForgeViewModule } from "@/git/client-forge-module";

/**
 * Paired with `bitbucket.ts` so the registries stay symmetric. Bitbucket rides
 * the `github` forge id as a routing facade, so nothing looks this module up by
 * id today — icon rendering for a Bitbucket workspace goes through
 * `git-hosting-icon.tsx` on the hosting-provider id instead. It exists so the
 * mark is already registered the day the facade is retired.
 */
export const bitbucketForgeView = {
  id: "bitbucket",
  icon: BitbucketIcon,
  brandColor: {
    light: "#2684FF",
    dark: "#2684FF",
  },
} satisfies ClientForgeViewModule;
