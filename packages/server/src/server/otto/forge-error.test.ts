import { expect, test } from "vitest";
import { GitHubCommandError } from "../../services/github-service.js";
import { forgeStatusErrorMessage } from "./forge-error.js";

function failure(stderr: string) {
  return new GitHubCommandError({
    args: ["pr", "view", "--json", "number,url,statusCheckRollup"],
    cwd: "fixture",
    exitCode: 1,
    stderr,
  });
}
test.each([
  "GraphQL: Could not resolve to a Repository with the name 'fixture/private'. (repository)",
  "Repository not found",
])(
  "repository access failure explains account/URL uncertainty without dumping argv: %s",
  (stderr) => {
    const message = forgeStatusErrorMessage(failure(stderr));
    expect(message).toContain("could not find this repository");
    expect(message).toContain("account's repository permissions");
    expect(message).not.toContain("--json");
    expect(message).not.toContain("fixture/private");
  },
);
test("other CLI failures keep raw query/response details out of Changes", () => {
  expect(forgeStatusErrorMessage(failure("malformed response: PRIVATE_RAW_PAYLOAD"))).toBe(
    "GitHub pull-request status could not be read. Check this host's GitHub CLI connection and use Refresh to try again.",
  );
});
test("domain errors retain their existing actionable explanation", () => {
  expect(forgeStatusErrorMessage(new Error("The remote host is unsupported."))).toBe(
    "The remote host is unsupported.",
  );
  expect(forgeStatusErrorMessage(null)).toBe("Pull-request status is unavailable on this host.");
});
