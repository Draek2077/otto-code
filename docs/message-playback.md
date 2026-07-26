# Message playback and auto-speech

Two ways to hear a reply instead of reading it: press play on one message, or turn
on auto-speech and have every reply read to you as it arrives. Both synthesize on
the host and play through the app's shared audio engine, and both are gated on the
daemon's `ttsSpeak` capability — a host that cannot synthesize shows neither
control.

## When the play button appears

The per-bubble button (`components/message-playback-button.tsx`, mounted by
`components/message.tsx`) appears on a bubble only once that bubble is **settled**:

- the model has moved past it — it is not the growing end of a running turn, and
- the typewriter reveal (`agent-stream/turn-reveal.ts`) has finished laying it out.

Both halves matter. A Play affordance on a message still being written offers
something that does not exist yet, and the icon riding an expanding bubble's edge
looks broken. `agent-stream/view.tsx` computes the live turn's tail item — the last
id in the reveal spans — and passes `isTurnTail` down; when nothing is running there
are no spans, so every message counts as finished.

One button per _visual_ bubble, on the segment that closes the group, reading the
whole group's joined text (`agent-stream/assistant-bubble-text.ts`).

## Auto-speech

The composer's speaker toggle (`composer/input/auto-speech-button.tsx`, beside the
dictation mic) turns on the read-aloud mode. It is a device-local app setting
(`autoSpeech`), off by default, and the toggle is its only UI.

From then on every assistant bubble **segment** is queued the moment it settles and
spoken one after another. Per segment rather than per bubble on purpose: blocks are
promoted out of the live item as they complete, so queueing each one keeps the
speech following the reply paragraph by paragraph instead of waiting for the whole
turn. Synthesis is slower than generation, so playback falls behind — the queue is
what makes that fine instead of a pile-up.

The mode reads what it **watched being written**, never what was already on screen:
opening a chat does not start reciting its history. A message row only offers itself
if it rendered at least once as part of a running turn.

That makes the reveal's idea of "the running turn" load-bearing for speech, and two
things protect it — both learned from the same bug, where hitting send read the
previous reply's last paragraph back at you:

- **A turn that has already been settled never spans anything.** Sending flips the
  agent to running a beat before the daemon echoes the user row, and the boundary
  search skips optimistic rows (a steer must not restart the turn it interrupts), so
  for that beat the search lands on the finished turn. `agent-stream/view.tsx` latches
  the boundary key while the agent is idle and hands it to `computeLiveTurnReveal`,
  which spans nothing until the new turn's own user row arrives.
- **The watched-live latch outlives the row.** One segment cannot settle while its
  turn runs — the reply's last paragraph, the growing end — and it is remounted at
  the exact instant it becomes speakable. Twice over: every assistant row subscribes
  to the reveal ticker whether it is spanned or not, because swapping the element
  type when the spans clear remounted it; and the id it is keyed by changes anyway,
  from `<group>:head` while it streams to `<group>:block:<n>` when the head flushes
  into the canonical tail. A latch held in a ref died there, and multi-paragraph
  replies were read up to their final paragraph and then stopped. The latch therefore
  lives in `agent-stream/live-turn-witness.ts`, a module registry keyed by
  (group, block index) — the pair the flush leaves untouched.

### The two halves

`voice/auto-speech-queue.ts` is a module singleton holding pure control flow — the
queue, the dedupe, the interruption rules — and no way to make a sound. There is
exactly one speaker on the device, so two chats streaming side by side must share
one serial queue, and the call sites that reach it (a message row deep in a
virtualized list, the composer toggle, a playback button) share no React ancestor
short of the app root.

`voice/auto-speech-host.tsx` supplies the other half: one speaker per connected
host, registered into the queue, owning the runtime client, the shared audio engine
and the personality voice. It is headless and mounted in `app/_layout.tsx` beside
`AgentVoiceCuesHost`, inside `VoiceProvider` (so the audio engine resolves) and
above the router (so a route change cannot cut a queue short).

### Interruption rules

| Trigger                                           | What happens                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| Auto-speech toggled off                           | Current utterance aborts and the queue empties, immediately              |
| Play pressed on any message                       | Queue empties, auto playback is held until that playback ends            |
| That manual playback finishes                     | Auto-speech resumes with whatever arrives **next**, not with the backlog |
| Play pressed on the bubble auto-speech is reading | Goes quiet and drops the backlog; the mode stays on                      |

The backlog is dropped rather than resumed deliberately: by the time you finish
listening to the message you asked for, the queue behind it is stale.

Live voice mode always wins — it owns the mic and the speaker, and a message read
over it would be picked back up as user speech.

## Cadence: pauses are synthesized, not rendered

Punctuation pauses in spoken replies come from the daemon, not from the TTS
model. Every synthesis segment is its own provider request and the client
splices the returned buffers together gapless — so the pause a period implies
never exists in any buffer unless we put it there. Worse, the local Kokoro
frontend flattens most punctuation even inside a single request. The segmenter
(`packages/server/src/server/speech/tts-segmenter.ts`) therefore splits text at
sentence _and_ clause boundaries, tags each segment with the pause its ending
mark denotes, and appends that many zero samples of PCM to the segment's audio.

Punctuation divides into two kinds, and they are handled oppositely:

- **Marks the voice pronounces** — `,` `;` `:` and the terminal `.` `?` `!`.
  These shape pitch, not just timing: a question mark is the difference between
  asking and stating. They stay in the segment text exactly as written, and a
  segment always keeps the terminal mark of the sentence it ends, so the closing
  rise or fall survives the cut. A question **is** clause-cut like anything
  else — its rise lands on the closing fragment, the one holding the `?`.
- **Marks that are pure notation** — em dashes, spaced dashes, brackets. A voice
  does not say them; it rests where they sit. They are consumed at the boundary
  and re-expressed as silence, which is more reliable than hoping the model
  infers a rest from a glyph it may not even have a phoneme for.

Rules that matter when touching it:

- **`TTS_PAUSE_MS` is the single tuning point.** One entry per punctuation
  meaning (comma, aside, dash, semicolon, colon, bullet, sentence, paragraph),
  each justified by what the mark means in English. Tweak durations there,
  nowhere else.
- **An explicitly authored break bypasses the stub guard.** Dashes and brackets
  pause at any length — "Rendered above" earns its beat before an em dash the
  way a two-word comma stub does not. Only inferred comma-grade splits have to
  clear `MIN_CLAUSE_CHARS`.
- **Spacing decides whether a dash is a break.** " - " and " — " are breaks;
  "sword-smith" and "well-lit" are words and are left exactly alone. A dash
  between numbers is a range, not a pause.
- **Brackets only split when they are set off by whitespace and well formed.**
  Both edges test for the whole construct, so `parseConfig(options)` is never
  torn apart at either end.
- **Notation is trimmed off fragment edges** by `trimNotationMarks`, which
  preserves terminal punctuation — "(finally)." becomes "finally."

### Spoken forms

`spoken-forms.ts` rewrites written notation into words before any splitting:
dates, clock times, currency, percentages, measurements, ranges and written
ordinals. "2026-07-25" becomes "July twenty-fifth, twenty twenty-six" and
"$1,200.50" becomes "one thousand two hundred dollars and fifty cents".

This exists because **we configure no text normalization at all**: sherpa-onnx
supports rule-based normalization through `ruleFsts` on the `OfflineTts` config
and we set none, so without this pass the only thing between an ISO date and
the speaker is espeak-ng's fallback guessing, which reads it as arithmetic.

The scope rule: a number is spelled out only when it is part of a construct
being rewritten anyway, because the words around it have to agree with it. A
**bare integer is left alone** — every engine reads "42" correctly, and
spelling out every loose number would wreck ports, versions and identifiers.
The rewrites are ordered so constructs that own their separators (dates own
their hyphens, times own their colon) are consumed before the looser rules see
them, and phone numbers and version strings are guarded out explicitly.

- **Bullets read like semicolons.** A line without terminal punctuation is a
  list fragment and gets the semicolon-grade pause; a bullet that is a full
  sentence keeps its full stop.
- **Clauses shorter than `MIN_CLAUSE_CHARS` are never cut.** "So, we ship."
  stays one segment — a hard pause after a two-word stub reads as a stammer.
- **Only raw PCM gets padded.** Compressed formats pass through untouched;
  bare `pcm` (OpenAI) is assumed 24 kHz, matching the app's audio engines.
- **The final segment always carries pause 0** so an utterance never ends in
  dead air the client must play before confirming.

## Volume: three channels, no mixing

The app makes noise on three unrelated channels, and each owns a slider. Nothing
multiplies across them.

| Channel          | Setting                                          | Where it is set              | Default |
| ---------------- | ------------------------------------------------ | ---------------------------- | ------- |
| Spoken replies   | `voicePlaybackVolume`                            | Settings → \<host\> → Agents | 50      |
| Agent voice cues | `agentVoiceCuesVolume` / `agentVoiceCuesMuted`   | Settings → \<host\> → Agents | 50      |
| Visualizer sound | `visualizerSoundVolume` / `visualizerSoundMuted` | Settings → Visualizer        | 50      |

They are separate because they answer different questions. Spoken replies are the
agent talking _to you_ — voice mode, auto-speech, the per-bubble play button, and
voice mode's thinking tone, which rides this channel because a tone louder than the
reply it accompanies is the loudest thing in the conversation. Cues are a
notification that fires while you are somewhere else. The Visualizer is ambience for
a graph you are watching. A level that suits one rarely suits another.

All three default to **50**, so the sliders start level. Note what that means for
spoken replies specifically: they had no level at all before this setting existed and
played at whatever the host synthesized, so the default deliberately makes speech
quieter than it used to be rather than preserving the old loudness.

**The engine takes gain per play call, not a master volume**
(`voice/audio-engine-types.ts`). Both channels share one `AudioEngine`, so a master
would collapse them; instead whoever calls `play()` knows which channel it is
speaking on and passes that level. Web inserts a `GainNode` (only when the level is
below full — the common path is an unchanged direct connection); native has no
volume control in `expo-two-way-audio`, so `voice/audio-gain.ts` scales the PCM16
samples themselves. Gain 0 still plays, silently, for the clip's full duration:
callers ack chunks and advance queues on completion, and skipping would desync them.

Read at **fire time**, never subscribed to (`voice/voice-playback-gain.ts`). Every
caller sits inside a long-lived effect, a websocket handler, or a plain module, where
re-subscribing on a slider drag would tear down the thing that is currently playing.

Two deliberate exceptions. Settings → Diagnostics' **playback test stays at full
volume** — it answers "do my speakers work", and a silent diagnostic at 0% reads as a
broken one. **Voice previews follow the channel they preview**: the Voice settings
picker at the spoken-reply level, the personality editor at the cue level, passed as
`VoicePreviewButton`'s `gain` prop.

## Gotchas

**Dedupe is on the message text, not the row id.** Stream item ids are not stable: a
canonical timeline replace rebuilds a finished turn's items with freshly derived
ids, so the same prose comes back under a new identity and the row remounts. Keying
the dedupe on the id let that through, and because the host's `speakMessage` cancels
whatever is playing before it starts, the duplicate did not queue politely behind
the original — it cut it off and restarted from sentence one, forever. The cost of
text-keyed dedupe is that a reply repeating itself verbatim within the last 512
segments is read once, which is the right way to be wrong.

**Speaker teardown is deferred by a microtask.** React tears an effect down before it
sets the replacement up, so a re-render — or a hot reload — is indistinguishable from
a disconnect at that instant. Tearing down eagerly aborted the utterance in flight
every time the host component's effect churned.

**The drain loop races the speaker against its own abort.** A speaker's `stop()`
cancels a host RPC and cannot promise the round trip ever returns, so the queue
advances on its own abort rather than on the speaker's cooperation.

**The composer toggle initializes the audio engine on press.** Browsers only resume a
suspended `AudioContext` inside a live user activation, and every later utterance is
triggered by an arriving message, not by a click. That press is the one gesture
auto-speech gets.
