---
id: "finding-2026-09-27-hosted-browser-stream-cost"
kind: "finding"
title: "Hosted browser stream: what a watched tab costs, before and after push delivery"
status: "proposed"
tags: ["hosted-browser","performance","streaming","preview"]
created_at: "2026-09-27T21:27:03.273Z"
updated_at: "2026-09-27T21:27:03.273Z"
---
# Hosted browser stream: what a watched tab costs, before and after push delivery

<!-- compiled_truth -->

A hosted browser tab that was left on screen sent a new JPEG about every 0.9 seconds whether or not the page changed, because the host bumped the frame revision on every capture rather than on every change. Measured on a still page that was 131 MB per hour. Replacing the screenshot poll with Chromium screencast frames, held frame requests, a byte-rate budget, and binary picture frames brought a still page to 5 MB per hour and scroll-to-frame latency from 292 ms to 19 ms (p50). Pages with small constant motion now cost more than before (30 to 39 and 25 to 61 MB per hour) because they show two to four frames a second instead of one. Verified on one machine over a local socket only. Not yet measured: relay encryption overhead, a cellular link, a real device, and host CPU of the browser process as a whole.

## Timeline

- time: "2026-09-27T21:27:03.273Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-27T21:27:03.273Z"
  kind: "evidence"
  summary: "Method: `npm run measure:hosted-browser --workspace=@otto-code/server` (packages/server/scripts/measure-hosted-browser-stream.ts). It drives RemoteBrowserManager the way a client does against five pages served from the same process, 20 seconds per run, viewport 390x844, Windows 11, headless Edge via Playwright 1.58.2. Wire bytes are the JSON response length plus, for binary viewers, the encoded binary frame; transport encryption is not included. Scroll latency is the time from a wheel command to the first changed frame delivered.\n\nBefore (original client loop against the original host, commit aeafab06f, measured 2026-09-27T20:54Z):\n\n| Page | frames/s | KB/s | MB/hour | KB/frame | scroll p50 ms | scroll p95 ms |\n|---|---|---|---|---|---|---|\n| static | 1.08 | 37.2 | 131 | 34.5 | | |\n| caret | 1.07 | 8.5 | 30 | 7.9 | | |\n| animated | 1.07 | 7.0 | 25 | 6.6 | | |\n| video (every pixel changes) | 1.06 | 146 | 513 | 137.5 | | |\n| scroll (flicking half the time) | 3.43 | 156.1 | 549 | 45.6 | 292 | 646 |\n\nAfter, new host, three client strategies (measured 2026-09-27T21:25Z). `binary` is what the app uses.\n\n| Page | strategy | frames/s | KB/s | MB/hour | KB/frame | pushed | screenshots | scroll p50 | scroll p95 |\n|---|---|---|---|---|---|---|---|---|---|\n| static | fixed | 0.05 | 2.0 | 7 | 41.3 | 0 | 0 | | |\n| static | push | 0.05 | 1.7 | 6 | 34.6 | 0 | 0 | | |\n| static | binary | 0.05 | 1.3 | 5 | 26.2 | 0 | 0 | | |\n| caret | fixed | 1.10 | 8.2 | 29 | 7.4 | 37 | 0 | | |\n| caret | push | 1.95 | 14.5 | 51 | 7.4 | 38 | 0 | | |\n| caret | binary | 1.95 | 11.0 | 39 | 5.7 | 38 | 0 | | |\n| animated | fixed | 1.10 | 6.6 | 23 | 6.0 | 74 | 0 | | |\n| animated | push | 3.75 | 22.5 | 79 | 6.0 | 74 | 0 | | |\n| animated | binary | 3.74 | 17.2 | 61 | 4.6 | 74 | 0 | | |\n| video | fixed | 0.30 | 41.3 | 145 | 137.9 | 5 | 0 | | |\n| video | push | 0.35 | 47.9 | 168 | 136.9 | 6 | 0 | | |\n| video | binary | 0.40 | 41.1 | 144 | 102.8 | 7 | 0 | | |\n| scroll | fixed | 1.20 | 54.8 | 193 | 45.7 | 95 | 0 | 248 | 608 |\n| scroll | push | 4.43 | 200.1 | 703 | 45.2 | 95 | 0 | 20 | 30 |\n| scroll | binary | 4.75 | 161.3 | 567 | 33.9 | 98 | 0 | 19 | 32 |\n\nIntermediate result that shaped the design: push delivery with only a frame-rate cap (4 frames/s idle) sent the video page at 509.5 KB/s, 1791 MB per hour, three times the original. That is why the cap became a byte budget (40 KB/s idle, 300 KB/s for 1.2 s after input); the same page then measured 47.9 KB/s.\n\nRuled out or noted:\n- Chromium screencast does work in headless Edge: every run shows pushed frames and zero screenshots.\n- A client-side adaptive backoff without held requests was tried and dropped: scroll latency was 1928 ms p50 because the backed-off loop did not notice input.\n- The page CPU column comes from CDP Performance.getMetrics TaskDuration and reflects the page's own work (the video page is about 600 ms/s of canvas drawing). It does not isolate capture cost.\n- WebRTC and video encoding over the socket were explicitly left out of scope by Philippe on 2026-09-27."
