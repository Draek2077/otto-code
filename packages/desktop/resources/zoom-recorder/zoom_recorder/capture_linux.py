"""Linux capture: pw-record, plus tapping Zoom's own output stream via pw-link."""

import os
import signal
import subprocess
import time

from . import pipewire


class Part:
    """One continuous pw-record capture. A new part starts if the device changes.

    For the far-end track we attach directly to Zoom's own output stream, so other
    desktop audio (notification sounds, voice cues, music) stays out of the recording.
    """

    def __init__(self, track, target, path, offset, capture_sink, tap_ports=None,
                 fallback=None, log=print):
        self.track, self.target, self.path, self.offset = track, target, path, offset
        self.log = log
        self.tap_ports = tuple(tap_ports or ())
        self.node_name = f"zr-{track}-{os.getpid()}-{int(offset * 1000)}"
        self.in_ports = ()

        if self.tap_ports:
            cmd = pipewire.record_command(None, False, node_name=self.node_name)
        else:
            cmd = pipewire.record_command(target, capture_sink)
        self.proc = subprocess.Popen(cmd + [str(path)],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if self.tap_ports and not self._attach():
            self.tap_ports = ()
            if not fallback:
                self.log(f"{track}: stream tap failed and no device fallback available")
                return
            self.log(f"{track}: stream tap failed, falling back to the monitor of {fallback}")
            self.stop()
            self.path.unlink(missing_ok=True)
            self.proc = subprocess.Popen(
                pipewire.record_command(fallback, True) + [str(path)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _attach(self, timeout=3.0):
        """Link Zoom's output ports into our unlinked recorder."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.in_ports = pipewire.input_ports(self.node_name)
            if self.in_ports:
                break
            time.sleep(0.2)
        if not self.in_ports:
            return False
        target_port = self.in_ports[0]
        linked = sum(pipewire.link(p, target_port) for p in self.tap_ports)
        return linked > 0

    def tap_healthy(self):
        """A tap with no incoming links records silence, so it must be noticed."""
        if not self.tap_ports or not self.in_ports:
            return True
        return pipewire.links_into(self.in_ports[0]) > 0

    def alive(self):
        return self.proc.poll() is None

    def stop(self):
        if self.alive():
            self.proc.send_signal(signal.SIGINT)   # lets pw-record finalise the WAV header
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
