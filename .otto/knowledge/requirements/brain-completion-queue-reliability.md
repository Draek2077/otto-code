---
id: "brain-completion-queue-reliability"
kind: "requirement"
title: "Otto Brain must preserve busy completion requests"
status: "confirmed"
tags: ["otto-brain", "reliability", "scheduling", "inference"]
created_at: "2026-08-12T04:20:08.732Z"
updated_at: "2026-08-16T12:39:40.814Z"
---

# Otto Brain must preserve busy completion requests

<!-- compiled_truth -->

Otto Brain must queue completion requests when all inference slots are busy and hold them until a slot becomes available, without imposing a router-side wait deadline. A busy model must not surface an upstream 502; 502 remains reserved for an actual upstream connection failure.

## Timeline

- time: "2026-08-12T04:20:08.732Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T04:20:08.732Z"
  kind: "evidence"
  summary: "User report, 2026-08-11: a second request while the model was busy surfaced `Upstream llama-server error: socket hang up`; user explicitly requires waiting indefinitely until the model can serve it. Existing scheduler implementation in packages/brain/src/service/scheduler.ts queues extra same-model requests up to profile.parallelSlots."
- time: "2026-08-12T04:23:17.106Z"
  kind: "evidence"
  summary: "The failure is reproducible when two clients alternately submit requests to the same Otto Brain model. This narrows the issue from a one-off model crash to multi-client handoff behavior."
  source: "User report, 2026-08-11"
- time: "2026-08-16T12:39:40.814Z"
  kind: "evidence"
  summary: "2026-08-26 root cause found for the \"queue never releases, needs reboot\" report: in packages/brain/src/service/router.ts proxyBuffered, the job promise resolved only via upstream \"end\"/\"aborted\"/\"error\". When the client (desktop side) closed its connection mid-stream, the code destroyed the upstream REQUEST but the already-open upstream RESPONSE stream kept no firing event, so done() never ran, the scheduler worker awaited job.run() forever, and — with parallelSlots=1 — the model's single slot stayed pinned, wedging every later request from every session until reboot. Fix: res.on(\"close\") now calls done() (idempotent) as the authoritative slot release, and the upstream error path guards the 502 write with res.writableEnded/res.destroyed before calling done(). Regression tests added in router.test.ts: a client departure mid-stream frees the slot for the next request, and an upstream socket hang-up 502s only the dead request. This is a release-of-slot bug, not a scheduling bug; the scheduler's turn workers were already correctly independent."
