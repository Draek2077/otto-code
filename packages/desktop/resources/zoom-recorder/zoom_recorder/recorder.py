"""Two-track recording: what you hear, and what your mic sends."""

import json
import time
from datetime import datetime

from . import paths
from .backend import Part

RATE = 16000        # Parakeet's native rate, so nothing needs resampling later
TRACKS = ("them", "me")


def new_session_dir():
    paths.RECORDINGS.mkdir(parents=True, exist_ok=True)
    base = paths.RECORDINGS / datetime.now().strftime("%Y-%m-%d_%H%M")
    d, n = base, 1
    while d.exists():
        n += 1
        d = base.with_name(f"{base.name}-{n}")
    d.mkdir(parents=True)
    return d


class Session:
    def __init__(self, directory=None, log=print):
        self.dir = directory or new_session_dir()
        self.log = log
        self.t0 = time.monotonic()
        self.started = datetime.now().isoformat(timespec="seconds")
        self.parts = []
        self.active = {}
        self.idx = {t: 0 for t in TRACKS}

    def elapsed(self):
        return time.monotonic() - self.t0

    def ensure(self, track, target, capture_sink, tap_ports=None, fallback=None):
        cur = self.active.get(track)
        if cur and cur.alive() and cur.target == target:
            if cur.tap_healthy():
                return
            self.log(f"{track}: stream tap dropped, reattaching")
        if cur:
            if not cur.alive():
                why = "recorder exited"
            elif cur.target != target:
                why = "device changed"
            else:
                why = "tap lost"
            self.log(f"{track}: {why}, rolling to a new part")
            cur.stop()
        if target is None and not tap_ports:
            self.active.pop(track, None)
            return
        i = self.idx[track]
        self.idx[track] += 1
        path = self.dir / f"{track}-{i:03d}.wav"
        offset = self.elapsed()
        part = Part(track, target, path, offset, capture_sink, tap_ports, fallback, self.log)
        self.active[track] = part
        self.parts.append(part)
        how = "tap on Zoom stream" if part.tap_ports else f"monitor of {target}"
        self.log(f"{track}: {path.name} <- {how} (+{offset:.1f}s)")

    def follow(self, endpoints):
        """Track live endpoints; a momentarily missing one is ignored, not a stop."""
        # The backend has already decided how the far end is reached, so this stays
        # platform-neutral: a tap where one is available, a device otherwise.
        if endpoints.far_target:
            self.ensure("them", endpoints.far_target, True,
                        endpoints.tap_ports, fallback=endpoints.fallback_target)
        if endpoints.mic_target:
            self.ensure("me", endpoints.mic_target, False)

    def close(self):
        for part in self.active.values():
            part.stop()
        self.active.clear()
        manifest = {
            "started": self.started,
            "ended": datetime.now().isoformat(timespec="seconds"),
            "duration": round(self.elapsed(), 1),
            "parts": [
                {"track": p.track, "file": p.path.name, "offset": round(p.offset, 3),
                 "bytes": p.path.stat().st_size if p.path.exists() else 0}
                for p in self.parts
            ],
        }
        write_manifest(self.dir, manifest)
        return manifest


def write_manifest(directory, manifest):
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))


def read_manifest(directory):
    return json.loads((directory / "manifest.json").read_text())


def has_audio(manifest, min_bytes=1024):
    return any(p.get("bytes", 0) > min_bytes for p in manifest.get("parts", []))


def latest_session():
    dirs = [d for d in paths.RECORDINGS.glob("*") if (d / "manifest.json").exists()]
    return max(dirs, key=lambda d: d.stat().st_mtime) if dirs else None
