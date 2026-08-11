/**
 * Hugging Face repo introspection: list the GGUF quantizations a repo offers so a
 * user can pick which one to download (tweak Q4 <-> Q5 <-> Q6). Uses the public
 * tree API - no SDK, no auth required for public repos - and pairs multipart
 * shards and the shared vision projector the way the local scanner does.
 */
import type { BrainConfig } from "../config/schema.js";
import type { Model } from "../types.js";
import { detectQuant, isProjectorFile } from "./scan.js";

const HF_BASE = "https://huggingface.co";

/**
 * The Hugging Face repo a scanned model came from: its catalog match, else the
 * first two segments of its id (`<publisher>/<repo>/<file>`). Null when the layout
 * does not name a repo. Shared so the TUI, the CLI, and the daemon all agree on
 * which local models belong to a given repo.
 */
export function repoOfModel(model: Model): string | null {
  if (model.catalogHfRepo) return model.catalogHfRepo;
  const segments = model.id.split("/");
  return segments.length >= 3 ? segments.slice(0, 2).join("/") : null;
}

/** Resolve an HF token: env first (runtime override), then persisted config. */
export function resolveHfToken(
  config?: BrainConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return env.HF_TOKEN || env.HUGGING_FACE_HUB_TOKEN || config?.hfToken || null;
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** One entry from the HF `tree` listing. */
interface HfTreeEntry {
  path: string;
  type: string;
  size?: number;
  lfs?: { size?: number };
}

function entryBytes(entry: HfTreeEntry): number {
  return entry.size ?? entry.lfs?.size ?? 0;
}

/** A downloadable quantization: its label, the repo-relative file(s), total size. */
export interface QuantOption {
  quant: string;
  files: string[];
  sizeBytes: number;
}

/** The quants a repo offers plus its shared vision projector, if any. */
export interface RepoQuants {
  repo: string;
  quants: QuantOption[];
  mmproj: { files: string[]; sizeBytes: number } | null;
}

/** One GGUF repo from a search, in a surface-agnostic shape (TUI and app share). */
export interface ModelSearchResult {
  repo: string;
  author: string;
  downloads: number;
  likes: number;
  updatedAt: string | null;
  gated: boolean;
  summary: string | null;
}

interface HfSearchEntry {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  gated?: boolean | string;
}

/**
 * Model-card summaries, and the three traps they set.
 *
 * 1. **`base_model` chains can be circular.** A quantizer's card names its base,
 *    whose card can name the quantization straight back. Two guards, because one
 *    is not enough: the chain of repos being resolved is carried down the
 *    recursion and re-entering a repo already on it is refused, and the chain is
 *    depth-capped. A guard on direct self-reference alone misses A -> B -> A.
 * 2. **A shared cache of *pending* promises reintroduces the deadlock the chain
 *    guard just removed.** With three rows resolving concurrently, A -> B -> C -> A
 *    can have each stack awaiting another stack's in-flight entry, a wait-for
 *    cycle no per-stack chain can observe. So the cache holds *settled values
 *    only*, and the in-flight dedupe map is consulted **only at the top level**,
 *    never inside the recursion. Every in-flight promise therefore resolves
 *    without ever awaiting another in-flight promise, which makes the wait-for
 *    graph a forest and a cycle unrepresentable.
 * 3. **The service is long lived.** The cache is capped and LRU-evicted, and
 *    entries expire, with a much shorter life for misses so a transient failure
 *    does not stick for the process lifetime.
 *
 * Every fetch also carries a timeout, and the caller's abort signal, so a slow or
 * hanging remote cannot pin an RPC open.
 */
const SUMMARY_CACHE_MAX = 256;
const SUMMARY_TTL_MS = 30 * 60_000;
/** Misses expire fast: a 404 today is often a card published tomorrow. */
const SUMMARY_MISS_TTL_MS = 5 * 60_000;
const SUMMARY_FETCH_TIMEOUT_MS = 4_000;
/** Deadline for the search and tree listings, which carry the actual payload. */
const REQUEST_TIMEOUT_MS = 15_000;
/** How long a whole search may spend on summaries before degrading to null. */
const DEFAULT_SUMMARY_BUDGET_MS = 2_500;
/** Repos one `base_model` branch may visit before giving up on finding prose. */
const MAX_BASE_MODEL_DEPTH = 3;

interface CachedSummary {
  value: string | null;
  expiresAt: number;
}

const cardSummaryCache = new Map<string, CachedSummary>();
const inFlightSummaries = new Map<string, Promise<string | null>>();

/** A live cache entry, or null when absent or expired. Refreshes LRU recency. */
function readCachedSummary(key: string): CachedSummary | null {
  const hit = cardSummaryCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cardSummaryCache.delete(key);
    return null;
  }
  // Re-insert so the most recently read key is the youngest in iteration order.
  cardSummaryCache.delete(key);
  cardSummaryCache.set(key, hit);
  return hit;
}

function writeCachedSummary(key: string, value: string | null): void {
  cardSummaryCache.delete(key);
  cardSummaryCache.set(key, {
    value,
    expiresAt: Date.now() + (value === null ? SUMMARY_MISS_TTL_MS : SUMMARY_TTL_MS),
  });
  // Map iterates in insertion order, so the first key is the least recently used.
  while (cardSummaryCache.size > SUMMARY_CACHE_MAX) {
    const oldest = cardSummaryCache.keys().next();
    if (oldest.done) break;
    cardSummaryCache.delete(oldest.value);
  }
}

/** Drop every cached summary. Exported for tests and for a token change, which
 * can flip which repos are readable at all. */
export function clearCardSummaryCache(): void {
  cardSummaryCache.clear();
  inFlightSummaries.clear();
}

function cleanCardSummary(markdown: string): string | null {
  const body = markdown.replace(/^---\s*[\s\S]*?---\s*/u, "");
  const paragraphs = body
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) =>
      paragraph
        .replace(/<[^>]+>/gu, " ")
        .replace(/!?(\[[^\]]*\]\([^)]*\))/gu, "$1")
        .replace(/[>*#`_]/gu, " ")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter((paragraph) => paragraph.length >= 80);
  const useful = paragraphs.find(
    (paragraph) =>
      !/^(community model|special thanks|disclaimers|model creator|gguf quantization)/iu.test(
        paragraph,
      ) &&
      !/lm studio community models highlights program|lm studio is not the creator/iu.test(
        paragraph,
      ),
  );
  if (!useful) return null;
  const sentences = useful.match(/[^.!?]+[.!?]+(?:\s|$)/gu) ?? [useful];
  const summary = sentences.slice(0, 2).join(" ").trim();
  return summary.length >= 80 ? summary.slice(0, 360).trim() : null;
}

/**
 * A request the caller cannot proceed without, so a failure throws rather than
 * reporting absence. It is still bounded: without a deadline a remote that
 * accepts the connection and then goes quiet pins the RPC that awaits it open
 * for as long as the socket lives, which is the whole reason the summary
 * fetches carry one too.
 */
async function fetchHf(url: string, token: string | null, what: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new Error(
      timedOut
        ? `Hugging Face ${what} timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Hugging Face ${what} could not reach the server`,
      { cause },
    );
  }
}

/**
 * One card fetch, bounded by its own timeout and by the caller's abort. Returns
 * null on any failure: discovery reports absence rather than throwing, and a
 * missing card is the overwhelmingly common case (most GGUF repos have none).
 */
async function fetchCard(
  url: string,
  token: string | null,
  signal: AbortSignal | undefined,
): Promise<Response | null> {
  const timeout = AbortSignal.timeout(SUMMARY_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: authHeaders(token),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    return null;
  }
}

/**
 * Resolve one repo's summary, following `base_model` when the repo has no card
 * prose of its own. `chain` is every repo already being resolved on this branch,
 * lowercased; it is both the cycle guard and the depth counter. Never consults
 * the in-flight map (see the header note): the recursion only ever reads settled
 * cache entries, so it cannot wait on another row's unfinished work.
 */
async function resolveCardSummary(
  repo: string,
  token: string | null,
  chain: readonly string[],
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const key = repo.toLowerCase();
  const cached = readCachedSummary(key);
  if (cached) return cached.value;

  const readme = await fetchCard(`${HF_BASE}/${repo}/raw/main/README.md`, token, signal);
  let summary: string | null = null;
  if (readme?.ok) {
    summary = cleanCardSummary(await readme.text().catch(() => ""));
  }

  // Only a depth cut makes the answer chain-specific: this repo might still
  // have resolved from a shallower entry point, so that null must not be cached.
  let truncated = false;
  // Once the caller has given up, do not spend a second round trip chasing the
  // base model: the answer can no longer be used.
  if (summary === null && !signal?.aborted) {
    if (chain.length >= MAX_BASE_MODEL_DEPTH) {
      truncated = true;
    } else {
      // The repo names no prose of its own, so try the model it was quantized
      // from. The `${HF_BASE}/` prefix is committed before the interpolation, so
      // a hostile base_model cannot redirect this off huggingface.co and leak
      // the token; keep that ordering if you touch these URLs.
      const detail = await fetchCard(`${HF_BASE}/api/models/${repo}`, token, signal);
      if (detail?.ok) {
        const card = (await detail.json().catch(() => null)) as {
          cardData?: { base_model?: string | string[] };
        } | null;
        const declared = card?.cardData?.base_model;
        const baseModel = Array.isArray(declared) ? declared[0] : declared;
        // Refusing a repo already on this branch is what breaks A -> B -> A.
        // Caching the null is still correct here: a cycle carries no prose at
        // any entry point, so every member resolves to null however it is
        // reached.
        const baseKey = baseModel?.toLowerCase();
        if (baseModel && baseKey && !chain.includes(baseKey)) {
          summary = await resolveCardSummary(baseModel, token, [...chain, baseKey], signal);
        }
      }
    }
  }

  // An aborted branch resolved nothing because we stopped asking, not because
  // the repo has no card. Caching that would let one slow search poison the next.
  if (!truncated && !signal?.aborted) writeCachedSummary(key, summary);
  return summary;
}

/**
 * Top-level entry: the only place the in-flight map is read, so duplicate repos
 * in one result set share a fetch without ever forming a wait-for cycle.
 */
function modelCardSummary(
  repo: string,
  token: string | null,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const key = repo.toLowerCase();
  const cached = readCachedSummary(key);
  if (cached) return Promise.resolve(cached.value);
  const existing = inFlightSummaries.get(key);
  if (existing) return existing;
  const pending = resolveCardSummary(repo, token, [key], signal)
    .catch(() => null)
    .finally(() => {
      inFlightSummaries.delete(key);
    });
  inFlightSummaries.set(key, pending);
  return pending;
}

async function mapWithConcurrency<T>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        await mapper(values[index]!, index);
      }
    }),
  );
}

/**
 * Search Hugging Face for GGUF model repos, most-downloaded first. Returns a
 * normalized shape both the TUI and the Otto app can render; drill into a result
 * with {@link listRepoQuants} to see and download its quantizations.
 *
 * Card summaries are a *bounded* enrichment, never a gate on the result set. Each
 * one costs one or two extra round trips, so the whole batch shares one budget
 * (`summaryBudgetMs`, 0 to skip them entirely); rows that miss it come back with
 * `summary: null`, which every consumer already treats as "not available". When
 * the budget expires the outstanding fetches are aborted rather than left to run,
 * so the one-shot `otto brain search --json` the daemon shells out to can exit
 * immediately instead of lingering on open sockets.
 */
export async function searchModels(
  query: string,
  {
    limit = 25,
    token = null,
    summaryBudgetMs = DEFAULT_SUMMARY_BUDGET_MS,
  }: { limit?: number; token?: string | null; summaryBudgetMs?: number } = {},
): Promise<ModelSearchResult[]> {
  const params = new URLSearchParams({
    search: query,
    filter: "gguf",
    sort: "downloads",
    direction: "-1",
    limit: String(limit),
  });
  const res = await fetchHf(`${HF_BASE}/api/models?${params.toString()}`, token, "search");
  if (!res.ok) {
    throw new Error(`Hugging Face search failed (${res.status}) for "${query}"`);
  }
  const entries = (await res.json()) as HfSearchEntry[];
  const rows = entries.map((entry) => ({
    repo: entry.id,
    author: entry.author ?? entry.id.split("/")[0] ?? "",
    downloads: entry.downloads ?? 0,
    likes: entry.likes ?? 0,
    updatedAt: entry.lastModified ?? null,
    gated: Boolean(entry.gated),
  }));
  const summaries: (string | null)[] = rows.map(() => null);
  if (summaryBudgetMs > 0 && rows.length > 0) {
    const controller = new AbortController();
    const gather = mapWithConcurrency(rows, 4, async (row, index) => {
      summaries[index] = await modelCardSummary(row.repo, token, controller.signal);
    }).catch(() => undefined);
    let expire: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      expire = setTimeout(resolve, summaryBudgetMs);
      // Never let the budget timer itself be the reason a CLI run stays alive.
      expire.unref?.();
    });
    await Promise.race([gather, deadline]);
    if (expire) clearTimeout(expire);
    controller.abort();
  }
  return rows.map((row, index) => ({ ...row, summary: summaries[index] ?? null }));
}

/**
 * Quality order for display: higher bits-per-weight is more faithful and larger.
 * Q2 < Q3 < ... < Q8 < F16 < F32, with K_S < K_M < K_L and _0 < _1 as tie-breaks.
 */
export function quantRank(quant: string): number {
  const q = quant.toUpperCase();
  const digits = /Q(\d+)/.exec(q);
  const base = digits ? Number(digits[1]) : /BF16|F16/.test(q) ? 16 : /F32/.test(q) ? 32 : 99;
  const sub = /_K_S/.test(q)
    ? 0.1
    : /_K_M/.test(q)
      ? 0.2
      : /_K_L/.test(q)
        ? 0.3
        : /_1$/.test(q)
          ? 0.05
          : 0;
  return base + sub;
}

/**
 * List the GGUF quantizations available in a Hugging Face repo. Model files are
 * grouped by detected quant (shards summed); the vision projector is returned
 * separately because one projector serves every quant in the repo.
 */
export async function listRepoQuants(
  repo: string,
  token: string | null = null,
): Promise<RepoQuants> {
  const url = `${HF_BASE}/api/models/${repo}/tree/main?recursive=true`;
  const res = await fetchHf(url, token, `listing for ${repo}`);
  if (!res.ok) {
    throw new Error(`Hugging Face listing failed (${res.status}) for ${repo}`);
  }
  const entries = (await res.json()) as HfTreeEntry[];
  const ggufs = entries.filter((e) => e.type === "file" && e.path.toLowerCase().endsWith(".gguf"));

  const basename = (p: string): string => p.split("/").pop() ?? p;
  const projectors = ggufs.filter((e) => isProjectorFile(basename(e.path)));
  const modelFiles = ggufs.filter((e) => !isProjectorFile(basename(e.path)));

  const byQuant = new Map<string, QuantOption>();
  for (const entry of modelFiles) {
    // Skip files whose quant we cannot classify: we could not present or manage
    // an unlabelled blob sensibly, and it is usually an F16/BF16 conversion the
    // picker does not want to offer as a "quant".
    const quant = detectQuant(basename(entry.path));
    if (!quant) continue;
    const option = byQuant.get(quant) ?? { quant, files: [], sizeBytes: 0 };
    option.files.push(entry.path);
    option.sizeBytes += entryBytes(entry);
    byQuant.set(quant, option);
  }
  // Keep shard order stable so the first file is the 00001 shard.
  for (const option of byQuant.values()) option.files.sort();

  const quants = [...byQuant.values()].sort((a, b) => quantRank(a.quant) - quantRank(b.quant));

  // One projector serves every quant; download only the largest, matching what
  // the scanner picks, rather than every precision the repo ships.
  const largestProjector = projectors.reduce<HfTreeEntry | null>(
    (best, entry) => (best === null || entryBytes(entry) > entryBytes(best) ? entry : best),
    null,
  );
  const mmproj = largestProjector
    ? { files: [largestProjector.path], sizeBytes: entryBytes(largestProjector) }
    : null;

  return { repo, quants, mmproj };
}
