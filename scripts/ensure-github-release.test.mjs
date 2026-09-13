import assert from "node:assert/strict";
import test from "node:test";
import { ensureGitHubRelease } from "./ensure-github-release.mjs";
import { getGitHubRelease, getReleaseLookupTag } from "./github-release.mjs";
const notFound = () => Object.assign(new Error("missing"), { stderr: "HTTP 404" });
const args = {
  repo: "Draek2077/otto-code",
  tag: "v0.9.10",
  mode: "create",
  draft: true,
  prerelease: false,
  timeoutSeconds: 1,
};
const quiet = { log() {} };

test("draft lookup accepts exact Otto, historical Paseo and tag identities", () => {
  const calls = [];
  const release = {
    id: 4,
    draft: true,
    name: "Otto v0.9.10",
    tag_name: "untagged-4",
    html_url: "https://github.com/Draek2077/otto-code/releases/tag/untagged-4",
  };
  const found = getGitHubRelease(args.repo, args.tag, (_cmd, argv) => {
    calls.push(argv);
    if (calls.length === 1) throw notFound();
    return JSON.stringify([release]);
  });
  assert.deepEqual(found, release);
  assert.equal(getReleaseLookupTag(found), "untagged-4");
  assert.deepEqual(calls[0], ["api", "repos/Draek2077/otto-code/releases/tags/v0.9.10"]);
  assert.equal(
    calls[1][3],
    '[.[] | select(.draft == true and (.tag_name == "v0.9.10" or .name == "Otto v0.9.10" or .name == "Paseo v0.9.10"))] | sort_by(.id)',
  );
});

test("existing hidden draft never triggers another create", async () => {
  const calls = [];
  await ensureGitHubRelease(args, {
    ...quiet,
    execFileSync(_cmd, argv) {
      calls.push(argv);
      if (argv[1].includes("/tags/")) throw notFound();
      return JSON.stringify([{ id: 3, draft: true }]);
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(
    calls.some((argv) => argv[0] === "release"),
    false,
  );
});

test("creator retains Otto identity and draft/prerelease flags", async () => {
  const calls = [];
  await ensureGitHubRelease(
    { ...args, prerelease: true },
    {
      ...quiet,
      execFileSync(_cmd, argv) {
        calls.push(argv);
        if (argv[1].includes("/tags/")) throw notFound();
        return "[]";
      },
    },
  );
  assert.deepEqual(calls.at(-1), [
    "release",
    "create",
    "v0.9.10",
    "--repo",
    "Draek2077/otto-code",
    "--title",
    "Otto v0.9.10",
    "--notes",
    "",
    "--prerelease",
    "--draft",
  ]);
});

test("a failed create is accepted only after exact release lookup succeeds", async () => {
  let created = false;
  await ensureGitHubRelease(args, {
    ...quiet,
    execFileSync(_cmd, argv) {
      if (argv[0] === "release") {
        created = true;
        throw new Error("raced");
      }
      if (created) return JSON.stringify({ id: 8, tag_name: args.tag });
      if (argv[1].includes("/tags/")) throw notFound();
      return "[]";
    },
  });
  assert.equal(created, true);
});

test("lookup authorization errors fail without creating", async () => {
  let calls = 0;
  const error = Object.assign(new Error("forbidden"), { stderr: "HTTP 403" });
  await assert.rejects(
    ensureGitHubRelease(args, {
      ...quiet,
      execFileSync() {
        calls += 1;
        throw error;
      },
    }),
    error,
  );
  assert.equal(calls, 1);
});

test("wait mode times out without creating a release", async () => {
  let now = 0;
  const calls = [];
  await assert.rejects(
    ensureGitHubRelease(
      { ...args, mode: "wait" },
      {
        ...quiet,
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        execFileSync(_cmd, argv) {
          calls.push(argv);
          if (argv[1].includes("/tags/")) throw notFound();
          return "[]";
        },
      },
    ),
    /did not appear within 1s/,
  );
  assert.equal(
    calls.some((argv) => argv[0] === "release"),
    false,
  );
});
