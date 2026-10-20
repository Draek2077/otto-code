---
id: "finding-2026-10-02-linux-fps-collapse"
kind: "finding"
title: "Linux 0.9.28 FPS collapse has little attributable renderer work"
status: "proposed"
tags: ["finding","performance","linux","client"]
created_at: "2026-10-02T15:01:06.253Z"
updated_at: "2026-10-02T15:02:39.558Z"
---
# Linux 0.9.28 FPS collapse has little attributable renderer work

<!-- compiled_truth -->

## Observation

A six-minute installed Linux Otto 0.9.28 performance capture shows an abrupt and sustained fall in requestAnimationFrame cadence. The median sampled FPS is 101.05 during seconds 120–230, 25.49 during seconds 230–300, and 20.19 during seconds 300–380 (final 16.49). Median p95 frame gap in those windows is 25, 75.1, and 91.8 ms. The frame sampler counted no >1 s stalls.

The late slowdown occurs without matching growth in sampled chat count (27 throughout), renderer heap (about 185–222 MB over the capture), query observers (709–757), or daemon inbound handler load (generally below 1.8 ms/s). At seconds 232–252, DOM node count holds at 5,383 and inbound traffic is 0.6–0.7 messages/s while sampled FPS remains about 25.4–25.9.

The final 200 Long Animation Frames span roughly 27 seconds: 196 have zero Chromium blocking duration, 101 name no script, and retained top-five script durations sum to 1.67 s versus 14.23 s of frame duration. Their mean reported style/layout time is 0.78 ms. The daemon's final 30-second runtime window reports event-loop delay p99 18 ms, max 27 ms, and no buffered WebSocket data. Earlier worst frames do include expensive gesture timer callbacks and nearby terminal/Unistyles mutations, but they precede the sustained low-FPS phase and do not establish its cause.

## Interpretation and open proof

The JSON proves low rAF callback cadence and does not reveal a sustained renderer script, layout, inbound-decode, or daemon backlog sufficient to explain the late phase. Chromium LoAF does not attribute compositor/GPU scheduling or OS window occlusion, so those remain hypotheses, not findings. Also, rAF cadence is not a direct presented-frame measurement. The decisive next capture is a Chromium Performance trace and GPU/compositor status on the affected Linux installation during a foreground, visibly slow period; record whether changing to an empty workspace restores cadence.

## Timeline

- time: "2026-10-02T15:01:06.253Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-10-02T15:01:06.253Z"
  kind: "evidence"
  summary: "Source: capture-2026-10-02T14-39-42-822Z-d9aa0fcb-af77-48df-93b5-9f9059852329.json supplied by user, capture window 2026-10-02 14:33:24.817–14:39:42.723 UTC. Metrics computed from 40 samples and the final 200 longFrames.entries; interpretation checked against docs/client-performance.md, frame-rate-sampler.ts, and long-frame-attribution.ts. No source edit or Linux runtime experiment was performed."
- time: "2026-10-02T15:02:39.558Z"
  kind: "evidence"
  summary: "The user confirmed Otto was in front and visibly slow during the final ~2.5 minutes of the 2026-10-02 capture (14:37:15–14:39:42 UTC). This rules out ordinary background-window or covered-window throttling for the sustained low-FPS phase as the user experienced it; it does not by itself distinguish Electron scheduling, GPU/compositor stalls, or an unmeasured renderer path."
  source: "User clarification in this investigation, 2026-10-02"
