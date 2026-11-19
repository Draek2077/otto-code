# Zoom Recorder and Meeting notes

Zoom Recorder runs on the physical Windows x64 or Linux x64 Desktop host.
Enable **Record Zoom meetings** in **Settings**, under **General → Meetings**.
Enabling downloads the local transcription model if needed. Disabling stops
the capture helper and keeps its model. **Delete model** turns recording off
and removes the downloaded model after confirmation.

The **Meeting notes** titlebar button opens finalized transcripts. You can
select a recording, rename it, copy its transcript, or delete it. Audio capture and
transcription run on the desktop host. The helper owns temporary audio.
Electron moves finalized text into the local Meeting notes library before
acknowledging the helper copy. The restored library stores and displays text
locally. Zoom Chat is outside this surface.

The main process owns opt-in, a serialized action lane and bounded helper
shutdown. Recorder IPC is restricted to the main frame of the app's desktop
windows. The Windows and Linux x64 packaging workflows freeze the native
helper, run its version and status smoke checks, and verify the installed
payload. Other architectures omit the recorder.

For a local native package, create an isolated Python 3.12 environment, install
`packages/desktop/resources/zoom-recorder/requirements-build.txt`, and run
`npm run build:zoom-recorder --workspace=@getpaseo/desktop` before packaging.
