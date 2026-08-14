"""Windows capture.

The far-end track uses per-process loopback so only Zoom's audio is recorded, the
same guarantee the Linux backend gets from tapping Zoom's PipeWire stream. That is
provided by the process-audio-capture package, a thin MIT-licensed wrapper around
Microsoft's ApplicationLoopback sample. If it is unavailable the code falls back to
whole-device loopback and says so, because a silent fall back would quietly put other
desktop audio into transcripts.

The microphone track is ordinary WASAPI input capture via sounddevice.

Live transcription is not implemented here: the loopback library writes a WAV and
exposes no PCM callback, so there is nothing to feed the incremental VAD.
"""

import threading
import wave

from . import wasapi

RATE = 16000
CHANNELS = 1


class _ProcessLoopback:
    """Per-process loopback capture straight to a WAV file."""

    def __init__(self, pid, path):
        from process_audio_capture import ProcessAudioCapture, PacCaptureMode
        self._cap = ProcessAudioCapture(pid=pid, output_path=str(path),
                                        mode=PacCaptureMode.INCLUDE)
        self._cap.start()

    def alive(self):
        try:
            return self._cap.is_capturing
        except Exception:
            return False

    def stop(self):
        try:
            self._cap.stop()
        except Exception:
            pass


class _DeviceCapture:
    """Microphone or whole-device loopback capture, written as a 16 kHz mono WAV."""

    def __init__(self, path, loopback=False):
        import sounddevice as sd
        self._wav = wave.open(str(path), "wb")
        self._wav.setnchannels(CHANNELS)
        self._wav.setsampwidth(2)
        self._wav.setframerate(RATE)
        self._lock = threading.Lock()
        self._failed = None

        def callback(indata, _frames, _time, status):
            if status:
                self._failed = str(status)
            with self._lock:
                if self._wav:
                    self._wav.writeframes(bytes(indata))

        extra = None
        if loopback:
            # WASAPI loopback records what the device is playing rather than an input.
            extra = sd.WasapiSettings(loopback=True)
        self._stream = sd.InputStream(samplerate=RATE, channels=CHANNELS, dtype="int16",
                                      callback=callback, extra_settings=extra)
        self._stream.start()

    def alive(self):
        try:
            return self._stream.active
        except Exception:
            return False

    def stop(self):
        try:
            self._stream.stop()
            self._stream.close()
        except Exception:
            pass
        with self._lock:
            if self._wav:
                self._wav.close()
                self._wav = None


class Part:
    """One continuous capture, interface-compatible with the Linux Part."""

    def __init__(self, track, target, path, offset, capture_sink, tap_ports=None,
                 fallback=None, log=print):
        self.track, self.target, self.path, self.offset = track, target, path, offset
        self.log = log
        self.tap_ports = ()          # Windows does not use PipeWire port linking
        self._impl = None
        self.per_app = False

        pid = wasapi.meeting_pid(target)
        if pid:
            try:
                self._impl = _ProcessLoopback(pid, path)
                self.per_app = True
                return
            except Exception as e:
                self.log(f"{track}: per-process capture unavailable ({e}); "
                         "falling back to whole-device loopback, "
                         "so other audio may appear in the transcript")

        try:
            loopback = capture_sink or target == "default-render-loopback"
            self._impl = _DeviceCapture(path, loopback=loopback)
        except Exception as e:
            self.log(f"{track}: capture failed to start: {e}")
            self._impl = None

    def alive(self):
        return bool(self._impl) and self._impl.alive()

    def tap_healthy(self):
        return True                  # nothing to re-link on this platform

    def stop(self):
        if self._impl:
            self._impl.stop()
            self._impl = None
