import {
  openAddProjectFlow,
  openGithubLocationPage,
  applyAvailableAddProjectHosts,
  type AddProjectFlowState,
  type AddProjectHost,
  type GithubRepositoryChoice,
} from "@/add-project-flow/model";
/** A request is consumed once; late host capabilities cannot lose its remote,
 * and returning Back never forces the user into the destination page again. */
export function createBitbucketCloneInitializer(
  preferredHostId?: string,
  repository?: GithubRepositoryChoice,
) {
  let pending = Boolean(preferredHostId && repository);
  function apply(current: AddProjectFlowState, hosts: AddProjectHost[]) {
    const next = applyAvailableAddProjectHosts(current, hosts, preferredHostId);
    if (!pending || !preferredHostId || !repository) return next;
    if (current.pages.length > 1) {
      pending = false;
      return next;
    }
    const page = current.pages[0];
    if (page.kind !== "host" && (page.kind !== "method" || page.hostId !== preferredHostId)) {
      pending = false;
      return next;
    }
    if (
      !hosts.some(
        (host) =>
          host.serverId === preferredHostId &&
          host.canAddProject &&
          host.canCloneGithubRepositories,
      )
    )
      return next;
    pending = false;
    return openGithubLocationPage(next, preferredHostId, repository);
  }
  return {
    open: (hosts: AddProjectHost[]) => apply(openAddProjectFlow({ hosts, preferredHostId }), hosts),
    apply,
  };
}
