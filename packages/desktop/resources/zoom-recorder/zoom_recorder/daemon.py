"""Watches for Zoom calls, records them, and transcribes when they end."""

import threading
import time
from datetime import datetime

from . import backend, batch, config, engine, paths, recorder, status

POLL = 2.0
START_CONFIRM = 2   # consecutive positive polls before acting


class Daemon:
    def __init__(self, log=None, on_change=None):
        cfg = config.load()
        self.stop_grace = cfg["stop_grace_seconds"]
        self.cfg = cfg
        self._log = log or self._default_log
        self.on_change = on_change
        self._stop = threading.Event()
        self._session = None
        self._jobs = []
        self._detail = ""
        self.last_transcript = None
        self.unread = None            # transcript written but not yet opened
        self.notify_ready = False     # tray consumes this to raise one notification

    def _default_log(self, msg):
        print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)

    def log(self, msg):
        self._log(msg)

    # -- status ----------------------------------------------------------------

    def state(self):
        if self._session:
            return status.RECORDING
        if any(t.is_alive() for t in self._jobs):
            return status.TRANSCRIBING
        if self.unread:
            return status.READY
        return status.IDLE

    def mark_viewed(self):
        """Clear the ready flag once the transcript has actually been opened."""
        self.unread = None
        self.publish("")

    def publish(self, detail=None):
        if detail is not None:
            self._detail = detail
        st = self.state()
        session = self._session.dir if self._session else None
        status.publish(st, self._detail, session, self.last_transcript)
        if self.on_change:
            self.on_change(st, self._detail)

    # -- call lifecycle --------------------------------------------------------

    def _start_call(self, endpoints):
        if not endpoints.far_target or not endpoints.mic_target:
            dfar, dmic = backend.default_targets()
            endpoints.far_target = endpoints.far_target or dfar
            endpoints.mic_target = endpoints.mic_target or dmic
            endpoints.fallback_target = endpoints.fallback_target or dfar
        if not endpoints.far_target and not endpoints.mic_target:
            self.log("no usable audio endpoints, not starting")
            return

        self._session = recorder.Session(log=self.log)
        self.log(f"recording -> {self._session.dir}")
        self._session.follow(endpoints)
        self.publish("call started")

    def _end_call(self, why):
        self.log(f"call ended ({why})")
        if self._session:
            session, self._session = self._session, None
            manifest = session.close()
            self.log(f"stopped after {manifest['duration']:.0f}s")
            if recorder.has_audio(manifest):
                self._spawn_transcription(session.dir)
            else:
                self.log("no audio captured, skipping transcription")
                self.publish("no audio captured")

    def _spawn_transcription(self, directory):
        def work():
            engine.lower_priority(self.cfg)
            try:
                out = batch.transcribe_session(directory, log=self.log)
                self.last_transcript = out
                if out:
                    self.unread = out
                self._detail = f"transcript ready: {directory.name}"
                self.notify_ready = True
            except Exception as e:
                self.log(f"transcription failed: {e}")
                self._detail = "transcription failed"
            finally:
                # Drop ourselves from the job list first, or state() still reports
                # TRANSCRIBING because this very thread is alive.
                try:
                    self._jobs.remove(threading.current_thread())
                except ValueError:
                    pass
                self.publish()

        t = threading.Thread(target=work, name="transcribe", daemon=True)
        self._jobs.append(t)
        t.start()
        self.publish(f"transcribing {directory.name}")

    # -- main loop -------------------------------------------------------------

    def run(self):
        paths.ensure_dirs()
        self.log(f"watching for Zoom calls ({backend.describe()})")
        self.publish("waiting for a call")
        positives = 0
        last_active = 0.0

        while not self._stop.is_set():
            try:
                ep = backend.detect()
            except Exception as e:
                self.log(f"pw-dump failed: {e}")
                self._sleep()
                continue

            now = time.monotonic()
            if ep.in_call:
                last_active = now
            active = self._session

            if active is None:
                positives = positives + 1 if ep.in_call else 0
                if positives >= START_CONFIRM:
                    positives = 0
                    self._start_call(ep)
            else:
                # Only a departed process stops immediately. Missing audio nodes get the
                # grace period, since Zoom recreates them when devices change.
                if not ep.app_present:
                    self._end_call("Zoom exited")
                elif (now - last_active) > self.stop_grace:
                    self._end_call(f"no call audio for {self.stop_grace:.0f}s")
                else:
                    active.follow(ep)

            self._jobs = [t for t in self._jobs if t.is_alive()]
            self._sleep()

        if self._session:
            self._end_call("shutting down")
        for t in self._jobs:
            t.join(timeout=120)
        status.publish(status.IDLE, "stopped")
        self.log("stopped")

    def _sleep(self):
        self._stop.wait(POLL)

    def stop(self):
        self._stop.set()
