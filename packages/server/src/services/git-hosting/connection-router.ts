import type { ForgeService } from "../forge-service.js";
import type { ForgeConnectionStore } from "./connection-store.js";
import { resolveForgeConnectionRemote } from "./connection-drivers.js";
import { createGitHostingForgeAdapter } from "./router.js";

/** Composition seam: shared Paseo services become connection-aware without UI branches. */
export function withForgeConnections(
  forge: string,
  base: ForgeService,
  connections: ForgeConnectionStore,
): ForgeService {
  const adapter = createGitHostingForgeAdapter({
    serviceFor: async (cwd) => {
      const remote = await resolveForgeConnectionRemote(cwd);
      return (remote ? await connections.forCwd(cwd, forge, remote.host) : null) ?? base;
    },
    invalidate: (cwd) => {
      connections.invalidate(forge, cwd);
      base.invalidate({ cwd });
    },
    dispose: () => base.dispose?.(),
    onChange: (listener) => connections.subscribe(listener),
  });
  // Leave generic polling to WorkspaceGitService for adapters without their own poller.
  if (!base.retainCurrentPullRequestStatusPoll) delete adapter.retainCurrentPullRequestStatusPoll;
  return Object.assign(adapter, {
    defaultCheckoutRefs: base.defaultCheckoutRefs,
    buildPrLocalBranchName: base.buildPrLocalBranchName,
    supportsCrossRepoCheckoutWithoutRefs: base.supportsCrossRepoCheckoutWithoutRefs,
  });
}
