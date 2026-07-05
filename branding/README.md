# Otto brand assets

Otto's mark is a robot face built from the letters of the name: reading O·T·T·O left to
right gives _eye, brow, brow, eye_. The two O's are the eyes, each T's crossbar floats
above the neighboring O as an eyebrow, and the two T stems form the nose bridge between
the eyes. The design is inspired by boxy 80's-movie robots without copying any of them.

## Files

| File                       | What it is                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `otto-logo.svg`            | Full logo: robot layer (`#robot`) + wordmark layer (`#wordmark`), 512×512                                                                                                                                                                                                                                                 |
| `otto-icon.svg`            | Icon: face only (eyes, brows, nose bridge), single solid pupil per eye, 512×512                                                                                                                                                                                                                                           |
| `otto-icon-small.svg`      | Small-size icon. Currently identical geometry to `otto-icon.svg` — the single solid pupil already reads cleanly at 48px and below, so there's no separate ring-dropping step anymore. Kept as its own file so a future redesign can reintroduce small-size-specific simplification without touching the full-size master. |
| `otto-icon-wink.svg`       | Expression variant: raised left brow + winking right eye. Not shipped as the app icon; reserved for fun surfaces (stickers, success states).                                                                                                                                                                              |
| `otto-icon-wink-small.svg` | Small-size wink variant, same relationship to `otto-icon-wink.svg` as `otto-icon-small.svg` has to `otto-icon.svg` — currently identical geometry.                                                                                                                                                                        |

All masters draw with `stroke="currentColor"` (and `fill="currentColor"` on solid pupils)
so they preview in any color context. Keep that convention when editing in Inkscape or
similar: an ungroup operation resolves inherited `currentColor` into a literal hex value
on each element, which silently breaks recoloring for every generated asset. Re-wrap
edited shapes in a `<g stroke="currentColor">` (or re-apply `stroke="currentColor"`
directly) before saving, and save as **Plain SVG** — Inkscape's default save format embeds
`sodipodi:`/`inkscape:` editor metadata that the generator script's regex-based extractor
can't parse, and the whole run will throw an XML namespace error.

## Geometry contract

Everything is mirror-symmetric around x=256 (the wink variant is the deliberate
exception). Rules that keep the mark coherent when editing:

- **T ratio:** each crossbar has its stem exactly ⅓ from the inner end (logo: 84-long
  bar, 28 inner / 56 outer; icon: 96-long bar, 32 / 64). Less than that stops reading
  as a letter T; more stops reading as an eyebrow. Unchanged by the July 2026 redesign.
- **Eyes overlap the stems:** each O now sits far enough inward that its inner edge
  (center ± radius ± half stroke) lands _past_ its stem's centerline rather than
  exactly on it — the stem visually enters the ring, reading closer to a lowercase
  "d"/"b" than a tangent touch (logo: eyes at 171.87/340.13, overlap 9.87; icon: eyes
  at 145.57/366.43, overlap 13.57). This replaces the older "eyes touch the stems"
  rule — deliberate as of the July 2026 redesign, not a regression.
- **Brow gap:** crossbar bottom edge floats 10 units (logo) / 20 units (icon) above the
  eye's top edge. Unchanged — this only depends on each eye's cy/r, which the redesign
  didn't touch.
- **Baseline:** stems end at the same y as the O's outer bottom edge (logo 330, icon 364).
  Unchanged for the same reason.
- Icon face bounding box is ~61.6..450.4 × 148..364 — still centered on (256,256), but
  narrower horizontally than before (was 48..464) since the eyes moved inward.

## Two-layer loading pulse

`#wordmark` and `#robot` in `otto-logo.svg` are separate layers on purpose: the app's
startup splash keeps the wordmark solid and fades the robot layer in and out as the
loading pulse. Keep any new detail in the correct layer — nothing in `#wordmark` may
animate, and `#robot` must remain legible-optional (the wordmark alone must read as
OTTO).

## Regenerating shipped assets

All raster and derived assets (app icons, favicons + status variants, splash, PWA,
desktop `.ico`/`.icns`, website logo/favicon) are generated from these masters:

```bash
node scripts/generate-brand-assets.mjs
```

Edit the masters (or the tile/badge parameters in the script), re-run, and commit the
regenerated files. Do not hand-edit the generated files — the script is the source of
truth for sizes, tile radii, and status-badge colors (blue `#3b82f6` running, green
`#22c55e` attention, matching `use-favicon-status.ts`).
