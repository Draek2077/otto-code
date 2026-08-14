# Otto Zoom Recorder helper

This is the capture and transcription engine imported from the local
zoom-recorder project. Otto replaces its standalone tray and installer with
the Desktop title-bar surface and packages the helper with its Python runtime.

The helper has one Otto-specific command:

    otto-zoom-recorder otto-download-models

It downloads the recognition and voice-activity models into the location named
by ZOOM_RECORDER_HOME. The Desktop process owns that variable and reports
real stage and byte progress by observing the helper's model cache.

The runtime packaging scripts are responsible for producing a self-contained
binary on Windows and Linux. Do not reintroduce a system-Python requirement.
