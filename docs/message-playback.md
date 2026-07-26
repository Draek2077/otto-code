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

Rules that matter when touching it:

- **`TTS_PAUSE_MS` is the single tuning point.** One entry per punctuation
  meaning (comma, dash, semicolon, colon, bullet, sentence, paragraph), each
  justified by what the mark means in English. Tweak durations there, nowhere
  else.
- **Bullets read like semicolons.** A line without terminal punctuation is a
  list fragment and gets the semicolon-grade pause; a bullet that is a full
  sentence keeps its full stop.
- **Clauses shorter than `MIN_CLAUSE_CHARS` are never cut.** "So, we ship."
  stays one segment — a hard pause after a two-word stub reads as a stammer.
- **Only raw PCM gets padded.** Compressed formats pass through untouched;
  bare `pcm` (OpenAI) is assumed 24 kHz, matching the app's audio engines.
- **The final segment always carries pause 0** so an utterance never ends in
  dead air the client must play before confirming.

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
