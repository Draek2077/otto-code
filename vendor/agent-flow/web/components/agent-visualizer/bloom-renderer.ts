/**
 * Bloom post-processing for holographic glow effect.
 * Takes the main canvas, extracts bright areas, blurs them,
 * and composites back with additive blending.
 *
 * OTTO PATCH (see OTTO-PATCHES.md): on light stages additive ('lighter')
 * compositing adds brightness to an already-bright frame — it clamps toward
 * white and the glow vanishes. When the themed stage background (COLORS.void)
 * is light, composite the blurred frame with 'multiply' at reduced alpha
 * instead: dark glyphs bleed a soft dark halo — the light-theme analog of
 * bloom. Also raises the downsample smoothing quality: the half-res buffer
 * temporal-aliases 1-2px features (stars) as they cross pixel boundaries,
 * which reads as flicker.
 */
import { COLORS } from '@/lib/colors'

// OTTO PATCH (see OTTO-PATCHES.md): fixed top-left-origin magnification of the
// bloom's offset "echo" pass. Upstream drew the bloom scaled up by the display
// devicePixelRatio (a scale-mismatch bug), which pulled a soft ghost of bright
// elements toward the bottom-right and read as a drop-shadow along the top and
// left. It was well-liked as a look but its strength tracked the display dpr
// (≈2 on retina, none at 1x). We keep the look but make it a deliberate
// constant so it's identical on every display and Sharpness setting. The ghost
// displaces every feature by (scale - 1) × its distance from the top-left, so
// this is the tuning knob: 1 aligns the bloom into a plain centered glow (no
// shadow), higher values push the shadow further. ~2 matched the retina-2x
// upstream screenshots but read too strong here; tuned down for a subtler edge.
const BLOOM_ECHO_SCALE = 1.6

// OTTO PATCH (see OTTO-PATCHES.md): opacity multiplier on the composited bloom
// "echo" pass — how strongly the offset ghost / drop-shadow reads over the
// crisp graph. Multiplied onto the base composite alpha (which already folds in
// `intensity` and the light-stage factor), so lower = fainter duplicate layer.
// 1 = full strength (the historical look).
const BLOOM_ECHO_OPACITY = 0.7

// OTTO PATCH (see OTTO-PATCHES.md): on a light stage the echo is composited with
// 'multiply' (dark halo) instead of additive, and it read too faint. This is the
// light-stage multiplier on the composite alpha (was folded in as a bare 0.6);
// raised so the mirrored blur layer registers a bit more strongly on near-white
// backgrounds. Dark stages are unaffected (they use `intensity` directly).
const BLOOM_LIGHT_STAGE_ALPHA = 0.85

function isLightStage(): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(COLORS.void).trim())
  if (!hex) return false
  const value = parseInt(hex[1], 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5
}

export class BloomRenderer {
  private bloomCanvas: HTMLCanvasElement
  private bloomCtx: CanvasRenderingContext2D
  private tempCanvas: HTMLCanvasElement
  private tempCtx: CanvasRenderingContext2D
  private intensity: number
  private darkenBlend: boolean
  private echoScale: number

  private enabled: boolean

  constructor(intensity: number = 0.6) {
    this.intensity = intensity
    this.darkenBlend = isLightStage()
    this.echoScale = BLOOM_ECHO_SCALE
    this.bloomCanvas = document.createElement('canvas')
    this.tempCanvas = document.createElement('canvas')
    const bCtx = this.bloomCanvas.getContext('2d')
    const tCtx = this.tempCanvas.getContext('2d')
    this.enabled = !!(bCtx && tCtx)
    this.bloomCtx = bCtx!
    this.tempCtx = tCtx!
    if (this.enabled) {
      this.bloomCtx.imageSmoothingQuality = 'high'
      this.tempCtx.imageSmoothingQuality = 'high'
    }
  }

  resize(width: number, height: number): void {
    // Bloom at half resolution for performance
    const scale = 0.5
    this.bloomCanvas.width = width * scale
    this.bloomCanvas.height = height * scale
    this.tempCanvas.width = width * scale
    this.tempCanvas.height = height * scale
  }

  apply(sourceCanvas: HTMLCanvasElement, targetCtx: CanvasRenderingContext2D): void {
    const w = this.bloomCanvas.width
    const h = this.bloomCanvas.height

    if (w === 0 || h === 0 || !this.enabled) return

    // Draw source at half resolution
    this.bloomCtx.clearRect(0, 0, w, h)
    this.bloomCtx.drawImage(sourceCanvas, 0, 0, w, h)

    // Apply blur passes (box blur approximation of gaussian)
    this.boxBlur(this.bloomCtx, this.tempCtx, w, h, 8)
    this.boxBlur(this.bloomCtx, this.tempCtx, w, h, 6)
    this.boxBlur(this.bloomCtx, this.tempCtx, w, h, 4)

    // Composite bloom over the target — additive on dark stages, a softer
    // multiply "dark halo" on light stages (see OTTO PATCH header note).
    //
    // OTTO PATCH: reset to device-pixel space first, then draw the bloom scaled
    // up from the top-left origin by a fixed `echoScale`. The caller's ctx
    // carries a scale(dpr, dpr) and sourceCanvas.width/height are physical
    // pixels, so identity space makes the composite dpr-predictable; the fixed
    // scale then reproduces upstream's offset "echo" pass (a soft ghost pulled
    // toward the bottom-right, reading as a top/left drop-shadow) as a
    // deliberate, display-independent effect rather than the old dpr-scale
    // artifact whose strength varied per monitor. echoScale = 1 → aligned glow,
    // no shadow. Because it scales from the origin, the ghost displaces every
    // feature by a constant fraction of its distance from the top-left, so the
    // shadow lands on the top and left regardless of dpr.
    targetCtx.save()
    targetCtx.setTransform(1, 0, 0, 1, 0, 0)
    targetCtx.globalCompositeOperation = this.darkenBlend ? 'multiply' : 'lighter'
    targetCtx.globalAlpha =
      (this.darkenBlend ? this.intensity * BLOOM_LIGHT_STAGE_ALPHA : this.intensity) *
      BLOOM_ECHO_OPACITY
    targetCtx.drawImage(
      this.bloomCanvas,
      0,
      0,
      sourceCanvas.width * this.echoScale,
      sourceCanvas.height * this.echoScale,
    )
    targetCtx.restore()
  }

  private boxBlur(
    srcCtx: CanvasRenderingContext2D,
    tmpCtx: CanvasRenderingContext2D,
    w: number,
    h: number,
    radius: number,
  ): void {
    // Use CSS filter for fast blur
    tmpCtx.clearRect(0, 0, w, h)
    tmpCtx.filter = `blur(${radius}px)`
    tmpCtx.drawImage(srcCtx.canvas, 0, 0)
    tmpCtx.filter = 'none'

    srcCtx.clearRect(0, 0, w, h)
    srcCtx.drawImage(tmpCtx.canvas, 0, 0)
  }

  setIntensity(intensity: number): void {
    this.intensity = Math.max(0, Math.min(1, intensity))
  }

  // OTTO PATCH: lets a host toggle flip the offset "echo" between the
  // deliberate drop-shadow (BLOOM_ECHO_SCALE) and an aligned glow (1). Clamped
  // so a bad value can't invert or wildly oversize the pass.
  setEchoScale(scale: number): void {
    this.echoScale = Math.max(1, Math.min(4, scale))
  }
}
