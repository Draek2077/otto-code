# The "matrix" text effect needs a per-glyph renderer

`wave` and `flames` shipped 2026-07-20 as pure registry entries. `matrix` cannot
follow, because it is not a gradient sweep.

Related: [projects/text-effects](../text-effects/text-effects.md),
`packages/app/src/styles/text-effects.ts`.

## Why it doesn't fit today

The whole effect system has exactly one animated primitive: a gradient peak
sliding horizontally across the label, masked onto static text
(`background-clip: text` on web, `MaskedView` + a reanimated `translateX` on
native). A theme only swaps gradient stops and animation parameters.

The requested matrix effect is **a strip of green matrix characters passing
through the text as a wave** — that means independent columns, characters
scrambling/cycling, and staggered per-character trails. Per-glyph state is
exactly what the current model does not have.

## What it takes

- Add a discriminator to `TextEffectSpec` (e.g. `kind: "sweep" | "glyph"`),
  keeping the seven existing themes on the `"sweep"` branch **byte-identical**.
- Add a second renderer branch in `ExpandableBadge`
  (`packages/app/src/components/message.tsx`) that splits the label into
  per-character elements.
  - **Web** can stay declarative: per-glyph `animation-delay` on one shared
    keyframe, no JS per frame.
  - **Native** needs a reanimated shared value per glyph — this is where the
    perf constraint bites.

## Hard constraints (from text-effects.md, non-negotiable)

- Both platform paths stay declarative. **No per-frame JS, no per-chunk
  re-renders, no new work during streaming** — these labels animate while agents
  are actively running.
- The character split must be memoized on the label text.
- Colors stay literal hex. **Do not add a `useUnistyles()` call** (banned, see
  [docs/unistyles.md](../../docs/unistyles.md)).

## Note on scope

If `kind: "glyph"` lands, a _geometric_ wave (glyphs displaced vertically in a
sine) becomes possible on the same branch. The shipped `wave` is a colour wave —
which is what was asked for — so treat geometric wave as a separate idea, not a
correction.
