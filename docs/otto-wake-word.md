# Wake-word listening

**Configure Speech → Hey Otto** is an opt-in, device-local keyword detector that hands one utterance
to the existing dictation pipeline. It is not a daemon capability and it does
not add a second browser or desktop audio stack.

## Chosen implementation

Otto uses Sherpa-ONNX open-vocabulary keyword spotting in the Electron main
process. Sherpa-ONNX itself is Apache-2.0, is already used by Otto's local
speech stack, supports iOS, Android, and desktop Node runtimes, and allows the
keyword to be supplied through a generated keyword file. The selected
GigaSpeech KWS model is distributed by the Apache-2.0 Sherpa-ONNX project and
was trained on the Apache-2.0 GigaSpeech corpus. The exact distribution inputs,
file sizes, and SHA-256 checksums are recorded in
`packages/expo-two-way-audio/wake-word-model.json`. Porcupine was rejected for
this feature because its SDK requires a Picovoice access key and commercial
terms, which adds account and licensing coupling to an otherwise local,
provider-neutral feature.

The first shipped phrase is `Hey Otto`. A release may enable the capability
only when all of these assets are present and load successfully:

- the Sherpa-ONNX native runtime for the target architecture;
- the compact Zipformer KWS encoder, decoder, joiner, and tokens files;
- the generated keyword file for the configured phrase;
- a recorded model version and checksums for the bundled assets.

The model and runtime are loaded by native code. Android supplies 16 kHz mono
PCM directly from its existing AudioRecord tap; idle PCM and derived levels do
not enter JavaScript. Electron uses its existing WebAudio capture engine and a
private, bounded renderer-to-main PCM bridge. Idle audio never reaches the daemon
or a provider on either platform. Plain browsers have no detector fallback.

Sensitivity controls both Sherpa KWS search parameters: higher sensitivity
raises the keyword boosting score so the `Hey Otto` path survives beam search,
and lowers the trigger threshold so a surviving path is easier to accept. The
desktop detector checks for a result after every decode step and emits at most
one detection per session. This avoids losing a transient result when several
audio frames are ready at once.

## Lifecycle

Listening is off for a fresh device. Enabling the device preference arms the
active, connected, dictation-ready chat; opening Settings itself does not
request permission or start capture. The active listener requests microphone
permission and shows its state. Desktop uses the workspace gutter; compact
chat layouts use the composer. Both controls pause listening without disabling
the saved opt-in. Existing 0.9 device keys, sensitivity, pause state and
send-versus-insert preference are preserved. Unsupported saved phrases remain
saved until an explicit tuning change; the bundled model recognizes Hey Otto only.

The native audio layer keeps its microphone-capable session
inactive while neither detecting nor dictating, so operating-system microphone
indicators appear only during active capture. Detection stops keyword decoding
before the existing dictation engine takes ownership. An Otto-owned active-command
observer confirms that same dictation after the saved silence interval; ordinary
manual dictation behavior stays unchanged. An activation with no command speech
cancels after eight seconds. The detector resumes after transcript processing unless the
user disabled it, Android is backgrounded, permission is revoked, or an audio
interruption blocks capture.

Electron retains a short post-detection PCM handoff before stopping its local
capture graph. If that handoff already contains command speech, dictation starts
with speech activity armed so the following silence completes the utterance.
The send-versus-insert decision is captured at detection time and consumed once
at confirmation; later settings renders cannot change it. Automatic sending is
off by default. A single capture owner pauses idle detection before manual
dictation or live voice starts, including pending permission/start operations.
Generation checks invalidate late detection, start and teardown callbacks.
Failures stop listening and require an explicit pause/resume or re-enable to retry.

Plain browser builds remain unavailable. Electron uses the existing desktop
WebAudio capture engine only as a local PCM source and sends those samples over
private renderer-to-main IPC to the local Sherpa detector. It never calls the
daemon audio path. Electron capability is an installation capability: the
desktop runtime and model files must be present, otherwise enabling reports a
recoverable error and the microphone is stopped.

Electron serializes detector startup and teardown across composer instances in
each renderer. A replacement listener releases the previous microphone graph
before starting, and cleanup from an old listener cannot stop the replacement's
native session. This also keeps pending microphone and worklet setup from
resuming after its audio context has been closed.

The five runtime model files are checked into
`packages/expo-two-way-audio/models/wake-word`. Development loads that shared
directory automatically. Electron Builder copies it to the application's
resources directory for every platform and architecture, and the `afterPack`
hook verifies every size and checksum before an installer can be emitted.
Runtime discovery verifies model hashes before constructing native weights. The
Nix wrapper points to the same shared directory in the immutable store.
`OTTO_WAKE_WORD_MODEL_DIR` remains available as an explicit development and
diagnostic override, but a normal development or installed launch does not
require it.

## Mobile status

Android supports foreground-only wake-word listening. The app packages the
official, checksum-pinned Sherpa-ONNX 1.12.28 AAR for all configured Android
ABIs and the same model files used by desktop. Gradle verifies the AAR and every
model asset before compilation, then packages the model under
`assets/wake-word` in the APK/AAB. Release verification checks the actual APK and
AAB assets, provenance and licenses, plus detector JNI libraries for every shipped
ABI. The handoff-buffer JVM tests run with the release variant. Build verification
does not establish physical-device recognition quality.

The detector consumes the existing `AudioRecord` stream directly inside
`AudioEngine`. While listening, neither PCM nor derived volume events cross the
native-module boundary. Detection disables further keyword decoding but keeps
the same microphone capture alive. Up to two seconds of subsequent command
audio is buffered natively and emitted only after dictation takes ownership,
avoiding both a microphone restart gap and the loss of the first command words.
The buffer is single-use and has a three-second handoff deadline.

App backgrounding stops the detector, clears pending handoff audio, and releases
microphone capture. Returning to the foreground restarts listening through the
existing JavaScript lifecycle when the setting remains enabled. Android does
not register a foreground service and cannot listen while Otto is backgrounded.

iOS reports the wake-word capability as unavailable. Settings explains that
boundary and the toolbar icon remains hidden. It must implement the same native privacy and
handoff contract before advertising support.

## Acceptance requirements

- No detector or microphone permission request occurs while the setting is off.
- On Android, no idle PCM crosses the native-module boundary. Electron idle PCM
  stays on its private device-local capture/IPC path.
- A model-less or asset-corrupt build reports unavailable and cannot appear
  active in settings or the toolbar.
- Before a mobile platform advertises support, physical-device tests cover
  detection, interruption, backgrounding, permission denial, teardown, and
  detector-to-dictation handoff.
- False-trigger and missed-trigger measurements are recorded before changing
  the default sensitivity.
