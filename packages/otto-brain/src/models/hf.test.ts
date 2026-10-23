import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

import { clearCardSummaryCache, listRepoQuants, searchModels } from "./hf.js";

const PROSE =
  "This model is a compact instruction tuned assistant that answers coding " +
  "questions with short, precise explanations and runnable examples. It was " +
  "trained on a public corpus and released under a permissive license.";

interface RepoFixture {
  /** Card body, or null for a repo whose README 404s or carries nothing useful. */
  readme?: string | null;
  /** What `cardData.base_model` declares, if anything. */
  baseModel?: string | string[];
}

/**
 * Stub the three endpoints the search path touches, counting calls so a test can
 * prove a repo was refetched (cache evicted or expired) rather than served warm.
 */
function stubHf(repos: Record<string, RepoFixture>, hits?: string[]): { calls: string[] } {
  const calls: string[] = [];
  const ids = Object.keys(repos);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/models?")) {
        return Response.json(
          (hits ?? ids).map((id) => ({ id, author: id.split("/")[0], downloads: 1 })),
        );
      }
      const readmeRepo = ids.find(
        (id) => url === `https://huggingface.co/${id}/raw/main/README.md`,
      );
      if (readmeRepo) {
        const body = repos[readmeRepo]!.readme;
        return body == null ? new Response("", { status: 404 }) : new Response(body);
      }
      const detailRepo = ids.find((id) => url === `https://huggingface.co/api/models/${id}`);
      if (detailRepo) {
        const base = repos[detailRepo]!.baseModel;
        return Response.json(base === undefined ? {} : { cardData: { base_model: base } });
      }
      return new Response("", { status: 404 });
    }),
  );
  return { calls };
}

/**
 * A remote that never answers. Matches real `fetch` on an aborted signal, which
 * rejects at once rather than waiting for an `abort` event that already fired.
 */
function hangingResponse(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

/**
 * Race a search against a short sentinel. A regression that reintroduces the
 * circular-chain deadlock fails here in a second with a readable message rather
 * than hanging until the runner's own timeout kills the whole file.
 */
async function searchWithin(ms: number, budgetMs: number): Promise<unknown> {
  const sentinel = Symbol("hung");
  return Promise.race([
    searchModels("q", { summaryBudgetMs: budgetMs }),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(sentinel), ms);
      timer.unref?.();
    }).then((value): never => {
      throw new Error(`searchModels did not settle within ${ms}ms (${String(value)})`);
    }),
  ]);
}

beforeEach(() => {
  clearCardSummaryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearCardSummaryCache();
});

test("a circular base_model chain resolves instead of deadlocking the search", async () => {
  // a -> b -> a. Both cards are prose-free, so each falls through to the other.
  stubHf({
    "owner/a": { readme: null, baseModel: "owner/b" },
    "owner/b": { readme: null, baseModel: "owner/a" },
  });

  const results = (await searchWithin(1_000, 5_000)) as { repo: string; summary: string | null }[];

  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => r.summary),
    [null, null],
  );
});

test("a self-referential base_model resolves", async () => {
  stubHf({ "owner/a": { readme: null, baseModel: "owner/a" } });

  const results = (await searchWithin(1_000, 5_000)) as { summary: string | null }[];

  assert.equal(results[0]?.summary, null);
});

test("a longer cycle entered from three concurrent rows still resolves", async () => {
  // a -> b -> c -> a, with every row resolving at once. This is the shape a
  // per-stack chain guard alone misses if the cache can hand out pending work.
  stubHf({
    "owner/a": { readme: null, baseModel: "owner/b" },
    "owner/b": { readme: null, baseModel: "owner/c" },
    "owner/c": { readme: null, baseModel: "owner/a" },
  });

  const results = (await searchWithin(1_000, 5_000)) as { summary: string | null }[];

  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.summary === null));
});

test("follows base_model to the repo that actually carries the prose", async () => {
  stubHf({
    "owner/quant": { readme: null, baseModel: ["owner/base", "owner/other"] },
    "owner/base": { readme: PROSE },
  });

  const results = await searchModels("q", { summaryBudgetMs: 5_000 });

  assert.ok(results[0]?.summary?.startsWith("This model is a compact"));
  // The base repo's own row is served from the same resolution.
  assert.equal(results[1]?.summary, results[0]?.summary);
});

test("stops following base_model after the depth cap", async () => {
  // Only `a` is a search hit; b, c and d are reachable only by following the
  // chain, so nothing warms the cache from a shallower entry point.
  const chain: Record<string, RepoFixture> = {
    "owner/b": { readme: null, baseModel: "owner/c" },
    "owner/c": { readme: null, baseModel: "owner/d" },
    "owner/d": { readme: PROSE },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes("/api/models?")) return Response.json([{ id: "owner/a", downloads: 1 }]);
      if (url === "https://huggingface.co/owner/a/raw/main/README.md") {
        return new Response("", { status: 404 });
      }
      if (url === "https://huggingface.co/api/models/owner/a") {
        return Response.json({ cardData: { base_model: "owner/b" } });
      }
      for (const [id, fixture] of Object.entries(chain)) {
        if (url === `https://huggingface.co/${id}/raw/main/README.md`) {
          return fixture.readme == null
            ? new Response("", { status: 404 })
            : new Response(fixture.readme);
        }
        if (url === `https://huggingface.co/api/models/${id}`) {
          return Response.json({ cardData: { base_model: fixture.baseModel } });
        }
      }
      return new Response("", { status: 404 });
    }),
  );

  const results = await searchModels("q", { summaryBudgetMs: 5_000 });

  // a -> b -> c fills the branch, so d's prose is never reached.
  assert.equal(results[0]?.summary, null);
});

test("returns promptly with null summaries when the budget expires", async () => {
  const ids = ["owner/a"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input).includes("/api/models?")) {
        return Response.json(ids.map((id) => ({ id, downloads: 1 })));
      }
      // A remote that never answers until the caller gives up.
      return hangingResponse(init?.signal);
    }),
  );

  const results = (await searchWithin(1_000, 50)) as { repo: string; summary: string | null }[];

  assert.equal(results[0]?.repo, "owner/a");
  assert.equal(results[0]?.summary, null);
});

test("does not cache the null left behind by an expired budget", async () => {
  let hang = true;
  const readme = `https://huggingface.co/owner/a/raw/main/README.md`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/models?")) return Response.json([{ id: "owner/a", downloads: 1 }]);
      if (hang) {
        return hangingResponse(init?.signal);
      }
      return url === readme ? new Response(PROSE) : new Response("", { status: 404 });
    }),
  );

  const first = (await searchWithin(1_000, 50)) as { summary: string | null }[];
  assert.equal(first[0]?.summary, null);

  hang = false;
  const second = await searchModels("q", { summaryBudgetMs: 5_000 });
  assert.ok(second[0]?.summary?.startsWith("This model is a compact"));
});

test("skips summaries entirely on a zero budget", async () => {
  const { calls } = stubHf({ "owner/a": { readme: PROSE } });

  const results = await searchModels("q", { summaryBudgetMs: 0 });

  assert.equal(results[0]?.summary, null);
  assert.equal(calls.length, 1, "only the search itself should have been fetched");
});

test("caps the cache, evicting the least recently used entries", async () => {
  // 300 repos against a smaller cache. Each follow-up search asks for a single
  // repo: re-running the full 300 would simply thrash the cache and prove
  // nothing, since every miss evicts an entry the same pass is about to want.
  const repos: Record<string, RepoFixture> = {};
  for (let i = 0; i < 300; i++) repos[`owner/r${i}`] = { readme: PROSE };
  stubHf(repos);
  await searchModels("q", { summaryBudgetMs: 30_000 });

  const newest = stubHf(repos, ["owner/r299"]);
  await searchModels("q", { summaryBudgetMs: 30_000 });
  assert.ok(
    !newest.calls.some((url) => url.endsWith("/raw/main/README.md")),
    "the most recent entry should still be served from cache",
  );

  const oldest = stubHf(repos, ["owner/r0"]);
  await searchModels("q", { summaryBudgetMs: 30_000 });
  assert.ok(
    oldest.calls.some((url) => url.endsWith("/raw/main/README.md")),
    "the least recently used entry should have been evicted",
  );
});

test("expires a cached miss so a transient failure does not stick", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { calls } = stubHf({ "owner/a": { readme: null } });

  await searchModels("q", { summaryBudgetMs: 30_000 });
  const afterFirst = calls.length;

  // Inside the miss TTL the second search asks nothing new.
  await searchModels("q", { summaryBudgetMs: 30_000 });
  const cached = calls.length - afterFirst;
  assert.equal(cached, 1, "only the search request itself should repeat");

  vi.setSystemTime(Date.now() + 10 * 60_000);
  await searchModels("q", { summaryBudgetMs: 30_000 });

  assert.ok(
    calls.slice(afterFirst + cached).some((url) => url.endsWith("/raw/main/README.md")),
    "an expired miss should be retried",
  );
});

test("bounds the search request and names the timeout", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: string, init?: RequestInit) => {
      assert.ok(init?.signal, "the primary search must carry an abort signal");
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }),
  );

  await assert.rejects(searchModels("q"), (error: Error) => {
    assert.match(error.message, /timed out after \d+ms/u);
    return true;
  });
});

test("bounds the repo listing and names the repo it could not reach", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("fetch failed");
    }),
  );

  await assert.rejects(listRepoQuants("owner/a"), (error: Error) => {
    assert.match(error.message, /could not reach the server/u);
    assert.match(error.message, /owner\/a/u);
    return true;
  });
});

test("still reports a rejected search by status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 429 })),
  );

  await assert.rejects(searchModels("q"), /Hugging Face search failed \(429\)/u);
});
