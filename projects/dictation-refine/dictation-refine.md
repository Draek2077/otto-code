# Charter: Dictation Refine — AI cleanup over dictated text

**One-line:** Turn Otto's raw dictation transcript into clean, punctuated, coding-aware text through a **latency-ordered ladder** — an instant deterministic pass, a fast local punctuation model, and an optional LLM "smart refine" pass — where the fast result always lands in the composer immediately and the slow pass only ever _improves_ it in place, so dictation never feels like "submit and wait."

Status: **charter drafted 2026-07-12**, not started. Provider-neutral by design; local-first proof.

---

## Why this exists

Otto already has a full dictation subsystem (local `sherpa-onnx` Parakeet STT + OpenAI Whisper, streamed through [`DictationStreamManager`](../../packages/server/src/server/dictation/dictation-stream-manager.ts)). The complaint is real and specific: the **local Parakeet model emits largely unpunctuated, un-cased text**. The recognizer output is returned verbatim in [`sherpa-parakeet-realtime-session.ts:150`](../../packages/server/src/server/speech/providers/local/sherpa/sherpa-parakeet-realtime-session.ts). The transcription prompt tells the model to "preserve punctuation and casing" ([`dictation-stream-manager.ts:176`](../../packages/server/src/server/dictation/dictation-stream-manager.ts)), but the local model has no punctuation to preserve — that prompt only bites for OpenAI Whisper.

### Why not bundle OpenWhispr

The user asked about embedding [OpenWhispr](https://github.com/OpenWhispr/openwhispr). We won't, and it wouldn't help:

- **It's a standalone Electron end-user app** (React 19 + Electron 41 + better-sqlite3), not a library or SDK. "Including it without the user installing separately" would mean shipping a second desktop app inside Otto.
- **Its STT is the same engines Otto already runs** — `whisper.cpp` + `sherpa-onnx` Parakeet. Adopting it would not improve raw transcription at all.
- **The one thing that makes it "smarter" is an optional LLM post-processing pass** (GPT/Claude/Gemini/Groq/OpenRouter) that punctuates and cleans the transcript. That's the idea worth taking — and Otto is _better positioned_ than OpenWhispr to do it, because the daemon already has every provider wired up, **including the user's local LM Studio over Tailscale**. This is squarely the fork thesis: frontier tooling for every provider, local and cloud alike.

### The paramount constraint: speed

The user's hard requirement: the improvement pass must be **as fast as possible**. A naive "send transcript → await LLM → then insert" flow makes every dictation feel sluggish. The whole design is built around never blocking the user on the slow layer (see **The settle model** below). The user is explicitly open to **shipping a small purpose-built model** for blazing-fast local refinement — which is exactly the right instrument for layers 0–1 below (a punctuation restorer is tens of milliseconds; a general LLM is not).

---

## Non-goals

- Not replacing the STT engines. This operates on the _text_ the existing STT produces.
- Not a general grammar rewriter. Refinement is **meaning-preserving** — punctuate, case, de-um, fix obvious ASR/homophone slips, format code tokens. Never summarize, never add or drop content.
- Not a new browser/audio stack. Reuses the existing dictation pipeline end-to-end.
- Not voice-mode (realtime conversation) — that path has its own turn/STT handling. Dictation only, for now. (The lexical + punctuation layers could later be shared with voice STT, but that's out of scope here.)

---

## Design: the latency ladder

Three layers, applied in order to the final transcript. Each is independently toggleable. Latency rises down the ladder; so does capability.

### Layer 0 — Deterministic lexical pass (instant, ~0 ms, no model, no network)

A pure-function transform in the daemon that rewrites spoken forms into code:

- **Spoken symbols → characters**: "open paren" → `(`, "close brace" → `}`, "new line" → `\n`, "dot" → `.`, "colon", "semicolon", "backtick", "arrow" → `=>`, etc.
- **Casing directives**: "camel case foo bar" → `fooBar`, "snake case", "pascal case", "kebab case", "constant case".
- **Coding vocabulary normalization**: "dot t s" → `.ts`, "npm run dev", "const", "async await", "use effect" → `useEffect`, "type script" → "TypeScript".
- **User-extensible dictionary** (persisted config): a map the user can grow for their own jargon.

This is what makes _coding_ dictation genuinely good, and it costs nothing. It's the same technique Talon/Serenade use. Runs always-on when dictation refine is enabled.

> **Future (noted, not in scope):** dictation happens in a workspace composer, so `cwd` is available at finalization. The lexical/LLM layers can later be **seeded with identifiers from the open repo** so project symbol names get spelled correctly ("use my component" → `MyComponent`). Big accuracy win, deferred.

### Layer 1 — Fast local punctuation + truecasing model (tens of ms, no LLM, no network)

A small, purpose-built ONNX model that restores sentence punctuation and capitalization — **the small blazing-fast model the user asked about, and the right kind of it.** Candidates:

- `sherpa-onnx` CT-Transformer punctuation model (native to the stack we already ship), or
- an ONNX token-classification punctuation restorer (e.g. `oliverguhr/fullstop-punctuation-multilang`).

Ships through the **existing local-speech model download/registry infra** ([`providers/local/models.ts`](../../packages/server/src/server/speech/providers/local/), same pattern as Parakeet/Kokoro) — background-downloaded, readiness-gated, kept warm like the TTS session. Multilingual candidate keeps parity with the STT language config.

Layers 0+1 together already resolve most of the complaint, entirely offline and effectively instant.

### Layer 2 — Optional LLM "smart refine" pass (opt-in; reuses the provider layer)

For disfluency removal, homophone/ASR-error correction, and richer formatting. **Reuses the daemon's existing one-shot generation path** — do not build a parallel LLM client:

- Route through [`resolveStructuredGenerationProviders`](../../packages/server/src/server/agent/structured-generation-providers.ts) / `StructuredTextGeneration` (the same machinery commit-message generation uses). It already: prefers fast small models (`DEFAULT_STRUCTURED_GENERATION_PROVIDERS` = `haiku`, `*-mini`, …), routes to role-matched Agent Personalities first, falls back through a chain, runs as an **internal, non-persisted** session, and can target the user's **local LM Studio**.
- Likely a **new personality role** (e.g. `dictation` / reuse `writer`) so the user can bind a dedicated fast model. Open question below.
- Strict latency budget: temperature 0, minimal/no reasoning effort, hard output-token cap, meaning-preserving system prompt. Final-only — never on partials.

---

## The settle model (this is what makes it not-slow)

**Never block the composer on a slower layer.** The daemon emits results progressively; the client shows the fastest available text instantly and lets slower layers _replace it in place_:

1. STT finalizes → daemon runs Layer 0 (+1 if warm) synchronously (sub-frame) → emits `dictation_stream_final` with the fast, cleaned text. **This is what lands in the composer, immediately, exactly as fast as today.**
2. If Layer 2 is enabled, the daemon kicks off the async LLM pass and, when it returns, emits a new additive `dictation_stream_refined` message with the improved text. The client swaps the composer text in place (only if the user hasn't edited it since).
3. The user can read, edit, or **send at any point**. Send before the refine lands → they send the fast version. The slow layer is pure upside; it never gates the interaction.

Optional polish: stream the Layer-2 output so the swap animates in progressively; a subtle "refining…" affordance that clears on settle.

This inverts the naive flow's latency problem: the perceived latency is always Layer 0/1 (instant), never Layer 2.

---

## Where it plugs in

- **Daemon, finalization:** [`maybeFinalizeDictationStream`](../../packages/server/src/server/dictation/dictation-stream-manager.ts) assembles `orderedText` right before emitting `dictation_stream_final`. Layers 0/1 run there. Layer 2 fires async after the final emit.
- **Protocol (additive only):** new `dictation_stream_refined` outbound message `{ dictationId, text }`. New `server_info.features.dictationRefine` capability flag with a `// COMPAT(dictationRefine)` marker. Refine settings ride the existing speech/dictation config the way `sttLanguages` / model selections already do ([`speech-config-resolver.ts`](../../packages/server/src/server/speech/), `persisted-config.ts`). Wire schemas stay pure-structural per the protocol contract.
- **Client:** composer dictation handling ([`use-dictation.ts`](../../packages/app/src/hooks/use-dictation.ts), [`dictation-controls.tsx`](../../packages/app/src/components/dictation-controls.tsx), [`dictation-stream-sender.ts`](../../packages/app/src/dictation/dictation-stream-sender.ts)) accepts the settle message and swaps text if unedited.
- **Settings:** extend the speech settings surface ([`speech-settings-cards.tsx`](../../packages/app/src/screens/settings/speech-settings-cards.tsx), [`buildSpeechSettingsOptions`](../../packages/server/src/server/speech/speech-settings-options.ts)) — a "Refine dictation" section: master toggle, per-layer toggles (lexical / punctuation / AI), the AI model picker (reusing provider/personality options), and the user lexical dictionary editor.

---

## Build sequence (phased; each phase shippable)

1. **Layer 0 + protocol scaffold.** Deterministic lexical transform (pure, heavily unit-tested), wired into finalization; `dictationRefine` capability flag; settings toggle. Instant, offline, no model download. Biggest bang-for-buck for coding dictation.
2. **Layer 1 punctuation model.** Pick + integrate the ONNX punctuation restorer via the local-model registry; readiness/download gating; keep-warm. Now offline dictation is punctuated + cased.
3. **Layer 2 LLM refine + settle.** `dictation_stream_refined` message; async route through `StructuredTextGeneration`; client in-place swap; latency budget + prompt; model/role picker in settings. Proof provider = local LM Studio.
4. **Polish.** Streaming settle animation, user lexical dictionary UI, i18n, docs fold-in (glossary + a `docs/` entry or extend `preview`/speech docs), capability-gated "Update host" messaging.

Deferred: repo-symbol-seeded refinement; sharing the lexical/punctuation layers with voice-mode STT.

---

## Locked decisions

- **Don't bundle OpenWhispr.** Adopt its LLM-post-processing _idea_; reject the app.
- **Latency ladder with a non-blocking settle**, not a single blocking LLM call. Fast text always lands first.
- **Reuse, don't rebuild:** Layer 2 goes through the existing structured-generation provider chain; Layer 1 goes through the existing local-speech model registry. No parallel LLM client, no parallel model-download path.
- **Provider-neutral, local-first.** Local LM Studio is the Layer-2 proof, not an afterthought.
- **Meaning-preserving only.** Refinement never changes what was said.
- **Additive protocol.** New message + capability flag; old clients keep getting `dictation_stream_final` and simply don't settle.

## Open questions

1. **Layer 2 role/binding:** new `dictation` personality role, or reuse `writer`? A dedicated role lets the user bind a separate ultra-fast model without disturbing commit-message routing. _Leaning: new role._
2. **Layer 1 model choice:** `sherpa-onnx` CT-Transformer (in-stack, simplest) vs. `fullstop` token-classifier (multilingual, slightly richer). Benchmark both for CPU latency on the target hardware.
3. **Server-side vs. client-triggered Layer 2:** server-side keeps it centralized/provider-neutral and gives it `cwd` for future repo-awareness — but the daemon must know per-session that refine is on. _Leaning: server-side._
4. **Default posture:** ship Layers 0+1 **on by default** (they're offline + instant) and Layer 2 **off by default** (uses a model/tokens)? _Leaning: yes._
