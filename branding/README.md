# Otto brand assets

Otto's mark is a robot face built from the letters of the name: reading O·T·T·O left to
right gives _eye, brow, brow, eye_. The two O's are the eyes, each T's crossbar floats
above the neighboring O as an eyebrow, and the two T stems form the nose bridge between
the eyes. The design is inspired by boxy 80's-movie robots without copying any of them.

## Files

| File                  | What it is                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `otto-logo.svg`       | Full logo: robot layer (`#robot`) + wordmark layer (`#wordmark`), 512×512                                                                                                                                                                   |
| `otto-icon.svg`       | Icon: face only (eyes, brows, nose bridge, lens rings), 512×512                                                                                                                                                                             |
| `otto-icon-small.svg` | Small-size icon: same outer geometry, lens rings dropped and pupils enlarged to solid dots. Used by the generator for anything rendered at 48px or below (favicons, notification icon, small ICO/ICNS entries) where concentric rings fuse. |
| `otto-icon-wink.svg`  | Expression variant: raised left brow + winking right eye. Not shipped as the app icon; reserved for fun surfaces (stickers, success states).                                                                                                |

All masters draw with `stroke="currentColor"` so they preview in any color context.

## Geometry contract

Everything is mirror-symmetric around x=256 (the wink variant is the deliberate
exception). Rules that keep the mark coherent when editing:

- **T ratio:** each crossbar has its stem exactly ⅓ from the inner end (logo: 84-long
  bar, 28 inner / 56 outer; icon: 96-long bar, 32 / 64). Less than that stops reading
  as a letter T; more stops reading as an eyebrow.
- **Eyes touch the stems:** each O's outer edge (center + radius + half stroke) lands
  exactly on its stem's centerline (logo: 162+48+10 = 220; icon: 132+70+14 = 216).
- **Brow gap:** crossbar bottom edge floats 10 units (logo) / 20 units (icon) above the
  eye's top edge.
- **Baseline:** stems end at the same y as the O's outer bottom edge (logo 330, icon 364).
- Icon face bounding box is 48..464 × 148..364 — centered on (256,256) both ways.

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
