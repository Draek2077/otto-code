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

const cardSummaryCache = new Map<string, Promise<string | null>>();

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

async function modelCardSummary(repo: string, token: string | null): Promise<string | null> {
  const cacheKey = repo.toLowerCase();
  const cached = cardSummaryCache.get(cacheKey);
  if (cached) return cached;
  const pending = (async () => {
    const readme = await fetch(`${HF_BASE}/${repo}/raw/main/README.md`, {
      headers: authHeaders(token),
    });
    if (!readme.ok) return null;
    const ownSummary = cleanCardSummary(await readme.text());
    if (ownSummary) return ownSummary;
    const detail = await fetch(`${HF_BASE}/api/models/${repo}`, { headers: authHeaders(token) });
    if (!detail.ok) return null;
    const cardData = (await detail.json()) as { cardData?: { base_model?: string | string[] } };
    const baseModel = Array.isArray(cardData.cardData?.base_model)
      ? cardData.cardData.base_model[0]
      : cardData.cardData?.base_model;
    return baseModel && baseModel.toLowerCase() !== cacheKey
      ? modelCardSummary(baseModel, token)
      : null;
  })().catch(() => null);
  cardSummaryCache.set(cacheKey, pending);
  return pending;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = Array.from({ length: values.length }) as R[];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        output[index] = await mapper(values[index]!);
      }
    }),
  );
  return output;
}

/**
 * Search Hugging Face for GGUF model repos, most-downloaded first. Returns a
 * normalized shape both the TUI and the Otto app can render; drill into a result
 * with {@link listRepoQuants} to see and download its quantizations.
 */
export async function searchModels(
  query: string,
  { limit = 25, token = null }: { limit?: number; token?: string | null } = {},
): Promise<ModelSearchResult[]> {
  const params = new URLSearchParams({
    search: query,
    filter: "gguf",
    sort: "downloads",
    direction: "-1",
    limit: String(limit),
  });
  const res = await fetch(`${HF_BASE}/api/models?${params.toString()}`, {
    headers: authHeaders(token),
  });
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
  return mapWithConcurrency(rows, 4, async (row) => ({
    ...row,
    summary: await modelCardSummary(row.repo, token),
  }));
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
  const res = await fetch(url, { headers: authHeaders(token) });
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
