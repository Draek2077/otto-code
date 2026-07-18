import { DepthParticle } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'

const NUM_PARTICLES = 80
// OTTO PATCH (see OTTO-PATCHES.md): a second, farther star layer — denser and
// smaller than the near layer, giving the backdrop a two-depth parallax field.
const NUM_FAR_PARTICLES = 150

// OTTO PATCH (see OTTO-PATCHES.md): depth-of-field blur baked into the parallax
// star field, so the backdrop reads as soft/out-of-focus depth behind the crisp
// node graph. These radii are the blur (CSS px) baked into each layer's star
// sprite ONCE at build time — NOT a per-frame ctx.filter (see the sprite cache
// below). 0 = sharp stars (the historical look).
const BACKDROP_BLUR_RADIUS = 1.5
// The far layer's stars are tiny, so a full backdrop blur would erase them.
// A very light blur keeps them as crisp points, not hard-aliased pixels.
const FAR_BACKDROP_BLUR_RADIUS = 0.5

// Largest on-screen radius a star can reach in each layer — the sprite is
// rendered at this size and scaled DOWN per star (never up, so no upscale
// mush). Near: size (0.4–2.0) × depth factor (0.5–1.0) tops out at 2.0.
// Far: size (0.3–0.8), no depth shrink, tops out at 0.8.
const NEAR_STAR_MAX_RADIUS = 2.0
const FAR_STAR_MAX_RADIUS = 0.8

// OTTO PATCH (see OTTO-PATCHES.md): pre-rendered soft-star sprite cache. The
// field used to run TWO live ctx.filter gaussian passes over ~230 particles
// every frame — the dominant visualizer cost. Instead we bake each layer's
// blurred star into an offscreen canvas ONCE and blit it per star with
// drawImage + a per-star globalAlpha (brightness × twinkle). No per-frame
// filtering; per-frame cost is just cheap image blits.
//
// Sprites are supersampled so the ctx's dpr upscale stays crisp on hi-dpi
// displays, then cached at module scope (blur/radius/color are all constant).
const SPRITE_SUPERSAMPLE = 3

type StarSprite = { canvas: HTMLCanvasElement; half: number; radius: number }

let nearStarSprite: StarSprite | null = null
let farStarSprite: StarSprite | null = null

// OTTO PATCH (see OTTO-PATCHES.md): on a light stage the accent-colored stars
// (COLORS.holoBase) nearly vanish against the near-white void — the whole point
// is to see stars on an almost-white background. Multiply each star's final
// alpha by this boost (clamped to 1 at blit time) so most stars go near-opaque
// while the twinkle still swings the dim ones. Dark stages keep the authored
// faint sparkle (boost = 1). Evaluated once — COLORS is merged from the host
// theme at module init (a theme change remounts the whole guest, re-running this).
const STAR_LIGHT_ALPHA_BOOST = 3
function stageIsLight(): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(COLORS.void).trim())
  if (!hex) return false
  const value = parseInt(hex[1], 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5
}
const STAR_ALPHA_BOOST = stageIsLight() ? STAR_LIGHT_ALPHA_BOOST : 1

function buildStarSprite(radius: number, blur: number): StarSprite | null {
  if (typeof document === 'undefined') return null
  const ss = SPRITE_SUPERSAMPLE
  // Pad the canvas by the blur spread so the soft edge isn't clipped.
  const half = radius + blur * 3 + 1
  const dim = Math.max(1, Math.ceil(half * 2 * ss))
  const canvas = document.createElement('canvas')
  canvas.width = dim
  canvas.height = dim
  const g = canvas.getContext('2d')
  if (!g) return null
  if (blur > 0) g.filter = `blur(${blur * ss}px)`
  // Opaque holo disc — brightness/twinkle is applied via globalAlpha at blit.
  g.fillStyle = COLORS.holoBase
  g.beginPath()
  g.arc(dim / 2, dim / 2, radius * ss, 0, Math.PI * 2)
  g.fill()
  return { canvas, half, radius }
}

function starSpriteFor(far: boolean): StarSprite | null {
  if (far) return (farStarSprite ??= buildStarSprite(FAR_STAR_MAX_RADIUS, FAR_BACKDROP_BLUR_RADIUS))
  return (nearStarSprite ??= buildStarSprite(NEAR_STAR_MAX_RADIUS, BACKDROP_BLUR_RADIUS))
}

export function createDepthParticles(width: number, height: number): DepthParticle[] {
  const particles: DepthParticle[] = []
  // Near layer (historical): larger, sparser stars.
  for (let i = 0; i < NUM_PARTICLES; i++) {
    particles.push({
      x: Math.random() * width * 2 - width * 0.5,
      y: Math.random() * height * 2 - height * 0.5,
      // Squared random biases toward small stars so big ones are rare (0.4–2.0).
      size: Math.random() ** 2 * 1.6 + 0.4,
      brightness: Math.random() * 0.4 + 0.15,
      speed: Math.random() * 0.15 + 0.05,
      depth: Math.random(),
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: Math.random() * 3 + 1.6,
    })
  }
  // OTTO PATCH: far layer — smaller stars (size 0.3–0.8 vs the near layer's
  // 0.4–2.0), a higher brightness floor so they stay visible, and a slower
  // autonomous drift. Their camera-parallax is dialed down at draw time so this
  // "distant" layer never scrolls faster than the near layer.
  for (let i = 0; i < NUM_FAR_PARTICLES; i++) {
    particles.push({
      x: Math.random() * width * 2 - width * 0.5,
      y: Math.random() * height * 2 - height * 0.5,
      // Squared random biases small so big far stars are rare (0.3–0.8).
      size: Math.random() ** 2 * 0.5 + 0.3,
      brightness: Math.random() * 0.3 + 0.2,
      speed: Math.random() * 0.03 + 0.015,
      depth: Math.random(),
      far: true,
      // Far stars twinkle a touch faster/livelier, which sells the depth.
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: Math.random() * 4 + 2.4,
    })
  }
  return particles
}

export function updateDepthParticles(
  particles: DepthParticle[],
  deltaTime: number,
  width: number,
  height: number,
): void {
  for (const p of particles) {
    p.x += p.speed * deltaTime * 10 * (1 - p.depth * 0.5)
    p.y -= p.speed * deltaTime * 5 * (1 - p.depth * 0.3)

    // Wrap around
    if (p.x > width * 1.5) p.x = -width * 0.5
    if (p.y < -height * 0.5) p.y = height * 1.5
  }
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  particles: DepthParticle[],
  transform: { x: number; y: number; scale: number },
  time: number,
  activeAgentPos?: { x: number; y: number; color: string },
  // OTTO PATCH (see OTTO-PATCHES.md): false skips the void fill + spotlight
  // (the page body behind the canvas is near-black anyway).
  showBackdrop: boolean = true,
): void {
  if (showBackdrop) {
    // Deep void
    ctx.fillStyle = COLORS.void
    ctx.fillRect(0, 0, width, height)

    // Ambient spotlight following active agent
    if (activeAgentPos) {
      const screenX = activeAgentPos.x * transform.scale + transform.x
      const screenY = activeAgentPos.y * transform.scale + transform.y
      const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, 300)
      gradient.addColorStop(0, activeAgentPos.color + '08')
      gradient.addColorStop(1, 'transparent')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
    }
  }

  // Depth particles (parallax) — soft depth-of-field backdrop (OTTO PATCH).
  // Far layer draws first (behind), near on top. Each star is a blit of that
  // layer's pre-blurred sprite (no per-frame ctx.filter).
  drawStarLayer(ctx, particles, transform, true, time)
  drawStarLayer(ctx, particles, transform, false, time)
}

// OTTO PATCH (see OTTO-PATCHES.md): draw one star layer (near or far) by
// blitting that layer's pre-blurred sprite once per star — no per-frame
// ctx.filter. Passing the whole array and filtering by `far` avoids
// re-allocating per frame.
//
// The far layer uses a smaller parallax factor (0.1–0.3) than the near layer
// (0.3–1.0), so as the camera pans the distant stars scroll SLOWER — they never
// outpace the near layer. Far stars also skip the depth-based size/alpha shrink
// so the tiny points stay visible at their authored brightness.
function drawStarLayer(
  ctx: CanvasRenderingContext2D,
  particles: DepthParticle[],
  transform: { x: number; y: number; scale: number },
  far: boolean,
  time: number,
): void {
  const sprite = starSpriteFor(far)
  if (!sprite) return

  for (const p of particles) {
    if ((p.far ?? false) !== far) continue

    const parallaxFactor = far ? 0.1 + p.depth * 0.2 : 0.3 + p.depth * 0.7
    const px = p.x + transform.x * parallaxFactor * 0.1
    const py = p.y + transform.y * parallaxFactor * 0.1
    const size = far ? p.size : p.size * (0.5 + p.depth * 0.5)
    let alpha = far ? p.brightness : p.brightness * (0.5 + p.depth * 0.5)

    // OTTO PATCH: twinkle — modulate alpha by a per-star sine so each star
    // fades in/out independently. Multiplier swings [0.1, 1.0]: a wide swing so
    // stars sparkle brightly at peak and go nearly transparent (never fully) in
    // the trough. No-op for stars without a twinkle phase.
    if (p.twinkleSpeed !== undefined) {
      alpha *= 0.55 + 0.45 * Math.sin(time * p.twinkleSpeed + (p.twinklePhase ?? 0))
    }

    // OTTO PATCH: light-stage visibility boost (no-op on dark stages).
    alpha = Math.min(1, alpha * STAR_ALPHA_BOOST)

    // Blit the layer sprite scaled to this star's size (its baked blur scales
    // with it). globalAlpha carries brightness × twinkle. dHalf covers the
    // padded sprite (star + blur spread) so the soft edge isn't clipped.
    const dHalf = sprite.half * (size / sprite.radius)
    ctx.globalAlpha = alpha
    ctx.drawImage(sprite.canvas, px - dHalf, py - dHalf, dHalf * 2, dHalf * 2)
  }
  ctx.globalAlpha = 1
}
