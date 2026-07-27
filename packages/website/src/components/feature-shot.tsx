import * as React from "react";

/**
 * Real-capture slots for the landing page.
 *
 * Every image on the feature sections is produced by the demo pipeline
 * (docs/site-demos.md) — never hand-drawn. Until a capture exists, `FeatureShot`
 * renders a placeholder carrying its shot id, kind and the scenario that will
 * produce it, so the page doubles as the capture backlog and no section can
 * point at an asset with no producer.
 *
 * The manifest is projects/marketing-strategy/website-showcase.md.
 *
 * Assets live in `public/shots/<id>.png` (or `.webm` for loops) — a committed
 * directory, hand-picked out of the gitignored `public/demos/` run output. The
 * site is dark-only, so captures only need the Twilight pass.
 */

export type ShotKind = "full" | "focus" | "loop";
export type ShotRatio = "16/9" | "16/10" | "4/3" | "3/2" | "1/1";

// Literal class strings so Tailwind's JIT emits them.
const RATIO_CLASS: Record<ShotRatio, string> = {
  "16/9": "aspect-[16/9]",
  "16/10": "aspect-[16/10]",
  "4/3": "aspect-[4/3]",
  "3/2": "aspect-[3/2]",
  "1/1": "aspect-square",
};

const KIND_LABEL: Record<ShotKind, string> = {
  full: "Full frame",
  focus: "Focus shot",
  loop: "Looping capture",
};

export interface FeatureShotProps {
  /** Manifest shot id — also the asset basename under /shots. */
  id: string;
  kind: ShotKind;
  ratio: ShotRatio;
  /** Alt text for the real asset. Written as site copy, not as a test comment. */
  alt: string;
  /** What must be in frame. Rendered in the placeholder; drives the capture. */
  spec: string;
  /** Demo scenario that produces this shot. Omit when none exists yet. */
  scenario?: string;
  /** Set once the capture lands. Absent means placeholder. */
  src?: string;
  /** Poster frame for a loop. */
  poster?: string;
  /** Desktop window framing — the site's job, per docs/site-demos.md. */
  chrome?: boolean;
  className?: string;
}

export function FeatureShot({
  id,
  kind,
  ratio,
  alt,
  spec,
  scenario,
  src,
  poster,
  chrome = false,
  className = "",
}: FeatureShotProps) {
  return (
    <figure
      className={`overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] ${className}`}
    >
      {chrome ? <WindowChrome /> : null}
      {src ? (
        <ShotAsset id={id} kind={kind} ratio={ratio} alt={alt} src={src} poster={poster} />
      ) : (
        <ShotPlaceholder id={id} kind={kind} ratio={ratio} spec={spec} scenario={scenario} />
      )}
    </figure>
  );
}

function ShotAsset({
  id,
  kind,
  ratio,
  alt,
  src,
  poster,
}: {
  id: string;
  kind: ShotKind;
  ratio: ShotRatio;
  alt: string;
  src: string;
  poster?: string;
}) {
  if (kind === "loop") {
    return (
      <video
        className={`w-full ${RATIO_CLASS[ratio]} object-cover`}
        src={src}
        poster={poster}
        aria-label={alt}
        autoPlay
        loop
        muted
        playsInline
      />
    );
  }
  return (
    <img
      className={`w-full ${RATIO_CLASS[ratio]} object-cover`}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      data-shot={id}
    />
  );
}

function ShotPlaceholder({
  id,
  kind,
  ratio,
  spec,
  scenario,
}: {
  id: string;
  kind: ShotKind;
  ratio: ShotRatio;
  spec: string;
  scenario?: string;
}) {
  return (
    <div className={`relative w-full ${RATIO_CLASS[ratio]}`} data-shot-placeholder={id}>
      <div className="absolute inset-2 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[0.015] p-6 text-center">
        <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[10px] tracking-wide text-white/45 uppercase">
          {KIND_LABEL[kind]}
        </span>
        <p className="max-w-md text-sm leading-relaxed text-white/55">{spec}</p>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[10px] text-white/25">
          <span>/shots/{id}</span>
          {scenario ? (
            <span>← {scenario}</span>
          ) : (
            <span className="text-amber-300/40">no scenario yet</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Desktop window framing. The capture is bare; the chrome is ours. */
function WindowChrome() {
  return (
    <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="flex gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
      </div>
      <div className="min-w-0 flex-1" />
    </div>
  );
}

/** Two- or three-up row of focus shots. */
export function ShotRow({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-4 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {children}
    </div>
  );
}
