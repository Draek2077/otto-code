---
id: "reference-libuv-fsevents-readiness"
kind: "reference"
title: "libuv macOS filesystem event stream readiness"
status: "proposed"
tags: ["file-observation","macos","reliability"]
reference_disposition: "read"
source_url: "https://raw.githubusercontent.com/libuv/libuv/v1.51.0/src/unix/fsevents.c"
created_at: "2026-11-12T15:07:40.894Z"
updated_at: "2026-11-12T15:07:40.894Z"
---
# libuv macOS filesystem event stream readiness

<!-- compiled_truth -->

libuv's macOS watcher initialization queues work to a separate CF run loop and returns before that loop reschedules the stream. Stream creation starts from the current event ID. This supports checking readiness through an observed filesystem callback rather than assuming the initial canary creation must be delivered.

Otto keeps the existing ten-second readiness deadline and re-signals only its exclusively created temporary canary at most once per second until an actual callback, timeout or shutdown. The OS scheduling race is a source-supported explanation for the intermittent startup failure, not a trace-proven reconstruction of the failed runner. No dependency, watcher backend, general polling loop or platform fork was introduced.

## Timeline

- time: "2026-11-12T15:07:40.894Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-11-12T15:07:40.894Z"
  kind: "evidence"
  summary: "Compared libuv uv__fsevents_init / uv__cf_loop_signal / uv__fsevents_reschedule and stream construction. CI 43231683953 failed the macOS two-watcher startup assertion with one surviving observer. The bounded probe's 8 focused cases and 2 existing filesystem cases passed; fresh CI 43237843713 passed all 21 jobs including macOS file observation at 2b6db984ec8175ff8fd3ac679e36e87a0cdaef70."
