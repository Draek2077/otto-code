# Otto render-layer integration

The `web/` renderer and its existing Otto patches were initially recovered from
Otto's frozen `95a19522a191394a874320041eaf05f6c5f3c682` tree. The source is
Apache-2.0 licensed; see LICENSE and TRADEMARK.md. Otto's product UI calls this
feature Visualizer. Attribution is displayed in Settings, About.

Only rendering code is present. The upstream extension, CLI, collectors, relay,
server and provider-log ingestion are excluded. `packages/otto-visualizer` owns
the offline build, fonts and validated guest bridge. `packages/app/src/otto/visualizer`
projects the current Paseo timeline and owns app integration. No upstream vendor
runtime or second chat/session store runs alongside Otto.

The current restoration patches are listed in OTTO-PATCHES.md. The offline
Tailwind build scans only this renderer, so unrelated checkout or scratch files
cannot change the committed package.

Preserve OTTO-PATCHES.md as the historical renderer patch log. Document additional
renderer patches there; keep app orchestration outside this vendor directory.
