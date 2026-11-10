import { CLAUDE_FAMILY_ALTERNATION } from './canvas-constants'

/** Convert a 0–1 alpha value to a two-character hex string (e.g. 0.5 → '80') */
export function alphaHex(alpha: number): string {
  return Math.floor(alpha * 255).toString(16).padStart(2, '0')
}

function hexChannel(hex: string, offset: number): number {
  return parseInt(hex.slice(offset, offset + 2), 16)
}

/** Parse a `#rgb`/`#rrggbb` string to [r, g, b] (0–255). Returns null on
 *  anything it can't read, so callers can fall back gracefully. */
function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null
  return [hexChannel(h, 0), hexChannel(h, 2), hexChannel(h, 4)]
}

/** OTTO PATCH (OTTO-PATCHES.md): linearly blend two hex colors. `t` is the
 *  weight of `to` (0 → `from`, 1 → `to`). Used to derive a personality node's
 *  muted (idle) and vivid (thinking) tints from its identity color and to
 *  darken it into the node interior fill. Falls back to `from` if either
 *  input can't be parsed. */
export function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  if (!a || !b) return from
  const k = Math.max(0, Math.min(1, t))
  const ch = (i: number) => Math.round(a[i] + (b[i] - a[i]) * k).toString(16).padStart(2, '0')
  return `#${ch(0)}${ch(1)}${ch(2)}`
}

/** Format a token count for display (e.g. 128500 → '128k', 1000000 → '1M').
 *  OTTO PATCH (OTTO-PATCHES.md): render millions as 'M' so a 1M context budget
 *  reads '1M' instead of '1000k'. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  return `${Math.floor(tokens / 1000)}k`
}

/** Truncate a file path to the last N segments (e.g. '/a/b/c/d.ts' → 'b/c/d.ts') */
export function truncatePath(path: string, segments = 3): string {
  return path.split('/').slice(-segments).join('/')
}

const PROVIDER_PREFIX = /^[a-z]+\.anthropic\./i
const VERSION_SUFFIX = /-v\d+:\d+$/i
const DATE_STAMP = /-\d{8}(?=$|-)/

const CLAUDE_NEW = new RegExp(`claude-(${CLAUDE_FAMILY_ALTERNATION})-(\\d+)(?:-(\\d+))?`, 'i')
const CLAUDE_LEGACY = new RegExp(`claude-(\\d+)(?:-(\\d+))?-(${CLAUDE_FAMILY_ALTERNATION})`, 'i')
const GPT = /gpt-(\S+?)(?:-\d{4}-\d{2}-\d{2})?$/i

function claudeLabel(family: string, major: string, minor?: string): string {
  const name = family[0].toUpperCase() + family.slice(1).toLowerCase()
  return minor ? `${name} ${major}.${minor}` : `${name} ${major}`
}

/** Format a raw model ID for display (e.g. 'claude-opus-4-6-20250514' → 'Opus 4.6'). */
export function formatModelName(model: string): string {
  const base = model
    .replace(PROVIDER_PREFIX, '')
    .replace(VERSION_SUFFIX, '')
    .replace(DATE_STAMP, '')

  const m = base.match(CLAUDE_NEW)
  if (m) return claudeLabel(m[1], m[2], m[3])

  const legacy = base.match(CLAUDE_LEGACY)
  if (legacy) return claudeLabel(legacy[3], legacy[1], legacy[2])

  const gpt = base.match(GPT)
  if (gpt) return `GPT-${gpt[1]}`

  return base
}
