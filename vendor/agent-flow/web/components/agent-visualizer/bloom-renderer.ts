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

  private enabled: boolean

  constructor(intensity: number = 0.6) {
    this.intensity = intensity
    this.darkenBlend = isLightStage()
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
    targetCtx.save()
    targetCtx.globalCompositeOperation = this.darkenBlend ? 'multiply' : 'lighter'
    targetCtx.globalAlpha = this.darkenBlend ? this.intensity * 0.6 : this.intensity
    targetCtx.drawImage(this.bloomCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height)
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
}
