# Speech

Otto extends Paseo's existing speech service, audio engine and dictation flow.
It does not create another recording engine, speech daemon or browser connection.
The bundled `otto-speech` plugin contributes **Configure Speech** in the selected
host's Plugins settings. The app-owned screen uses the ordinary Settings cards,
rows, inputs, expanders and explicit Save/Reload controls.

## Ownership

`packages/server/src/server/otto/speech/` owns settings, compatibility selection,
request admission, narration preparation and runtime replacement. The existing
speech-service factory constructs the local Sherpa worker or OpenAI provider.
`packages/app/src/otto/speech/` owns presentation, device preferences and a single
speaker queue. Small `OTTO(speech)` seams connect those modules to Paseo's voice
provider, settled messages, composer and canonical timeline subscription owner.
The structural contracts live in `@getpaseo/plugin/otto/speech`.

`server_info.features.ottoSpeech` gates the extension once. Old hosts keep their
existing speech functionality; the new screen asks for a host update. Relay
framing, identifiers and handshakes remain Paseo's.

## Host settings and secrets

Recognition has a dictation selection and a live-conversation selection. Local
selections are independent. OpenAI recognition shares one configured API model;
changing it updates both API selections rather than displaying contradictory
choices. Live voice retains Paseo's local or OpenAI turn detection.

Text to speech has provider, model, voice and speaking speed. Local choices include
the existing Kokoro 0.19 model and restored Kokoro 1.0 multilingual and int8 models.
The v1 packages support English and Chinese, with the original 53 speaker IDs;
their voice labels do not imply support for every language prefix. Fresh installs
retain Paseo's model default. Model-specific filenames, lexicons and default
speakers are selected before constructing native weights. Voice and speed changes
reuse those weights.

OpenAI speech accepts custom endpoint/model/voice IDs and speed from 0.25 through 4. Endpoint keys use explicit Keep, Replace and Remove actions. A blank replacement
does not remove a key. Snapshots contain only key presence/source, never saved
values. Speech saves preserve the existing shared OpenAI key, unrelated providers,
VAD thresholds, LLM settings and unknown configuration fields. Effective
environment-owned fields are labeled and locked; secrets are never copied from
the environment into the saved file. URL validation accepts HTTP(S) API prefixes,
without embedded credentials, query strings or fragments.

Save compares the originating revision and atomically replaces the configuration.
A stale or uncertain write retains the draft and requires confirmed Reload;
there is no automatic retry or rebase. Runtime replacement waits for existing
capture/TTS leases to finish, coalesces changes, then exposes the new readiness.
Settings show downloads, pending changes, errors and an explicit retry action.
Preview uses the saved provider/model and may audition unsaved voice/speed.

The dated compatibility overlay reads supported model, speaker and speed values
from preserved Otto 0.9 settings only when the current configuration has not
selected them. It does not rewrite the old file, reset preferences, move models
or replace keys. Models remain in the owning host's `models/local-speech` store.

Explicit API model IDs bypass local-model quarantine. If an early 0.10 baseline
already displaced an API ID, recovery fills only a missing model whose explicit
API provider and exact ID are proven by both the original config backup and
preserved sidecar. Current selections, local-origin IDs and ambiguous/corrupt
evidence remain untouched. The evidence files and credentials are not rewritten.

## Reading and playback

Completed, visually settled assistant messages expose **Read aloud** / **Stop
reading** with a tooltip. The composer exposes **Read new replies in this chat**.
Automatic reading follows new completed paragraphs and the final paragraph at
turn close. It retains demand through the existing canonical timeline owner,
including off-screen chats, without making them visible or remembering extra
tabs. Initial hydration and reconnect seed already-finished content without
reading history. Turning the preference off releases demand and queued speech.

Manual playback replaces the queue. New automatic material arriving during
manual playback is consumed without becoming a stale backlog. Live conversation
has priority over readout and activity cues. Dictation also stops output before
requesting microphone access and keeps capture priority through a pending start
and actual stop, so narration cannot feed back into recognition. One device queue has a 32-item bound,
a 65,536-character reply bound and one generated segment of read-ahead. Each
generation is bounded by the host's two-job admission limit and 8 MiB PCM limit.
Cancellation is client-owned: it stops playback and cloud requests; pending
native generation retains its lease/admission until it settles, and late audio
is discarded. Playback failure is visible and drops the remaining backlog.

The daemon normalizes Markdown and spoken dates, numbers, prices and units once,
then segments narration at sentence/clause boundaries. The original authored
punctuation pauses are PCM silence, not UI timers. Prepared segments are not
normalized a second time. The same narration preparation wraps live voice output.

Device preferences preserve the Otto 0.9 keys and 0..100 volume scale: playback
volume, thinking tone, activity cue enable/mute/volume, and host+chat automatic
reading. Activity cues use the original default starting/thinking/waiting/done
lines and the host's selected voice. They are suppressed for automatically read
chats. Agent-profile voice assignment and wake-word listening are separate work.

## Mobile background playback

Readout/preview WAVs use the existing Expo audio player. The SDK54-compatible
`expo-audio` 1.1.1 media controls keep Android playback eligible for its media
foreground service; the app config enables the iOS audio background mode.
Lock-screen metadata is the generic **Otto speech**, with no chat text. Stop and
failure remove media controls before releasing the player. The file watchdog
accounts for operating-system pause/resume and settles even if cleanup fails.

Playback alone sets recording and background recording to false. It does not
initialize the two-way microphone engine. Activity cues do not acquire background
media controls. Device/native acceptance remains separate from browser and pure
adapter tests; background playback is not permission to record in the background.

## Verification boundaries

Focused fixtures cover config/CAS/credential preservation, real local HTTP speech
and transcription using the existing OpenAI SDK, WAV cadence, native constructor
injection, cancellation and runtime leases, Markdown/spoken forms, device queue,
retained timeline demand, volume and native-player cleanup. No vendor account or
developer microphone/model is used by those fixtures.

`e2e/browser/otto-speech.spec.ts` runs through a disposable daemon and actual app
in the existing Otto App Acceptance lane, wide and compact. It covers settings,
real WAV preview, errors, stale saves, completed-message readout, automatic new
replies and history suppression. Its endpoints and audio are synthetic. It does
not establish physical-device listening quality, native background behavior or
live vendor/model availability. See [testing.md](testing.md).

OpenAI's current lifecycle notice schedules `tts-1`, `tts-1-hd` and
`gpt-4o-mini-tts` shutdown for January 6, 2027. Existing IDs and compatible endpoints
remain selectable; Otto does not silently replace them with another API.
See the [vendor speech reference](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).
