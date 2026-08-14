"""Shared status, published to a file so the tray and CLI agree."""

import json
import os
import threading
import time

from . import paths

IDLE = "idle"
RECORDING = "recording"
TRANSCRIBING = "transcribing"
READY = "ready"
SETUP = "setup"
ERROR = "error"

LABELS = {
    IDLE: "Idle, waiting for a Zoom call",
    RECORDING: "Recording call",
    TRANSCRIBING: "Transcribing, this uses some CPU",
    READY: "Transcript ready to read",
    SETUP: "First-run setup",
    ERROR: "Error",
}

ICONS = {
    IDLE: "zoom-recorder-idle",
    RECORDING: "zoom-recorder-recording",
    TRANSCRIBING: "zoom-recorder-transcribing",
    READY: "zoom-recorder-ready",
    SETUP: "zoom-recorder-setup",
    ERROR: "zoom-recorder-idle",
}


def publish(state, detail="", session=None, transcript=None):
    paths.STATE.mkdir(parents=True, exist_ok=True)
    data = {"state": state, "detail": detail, "session": str(session) if session else None,
            "transcript": str(transcript) if transcript else None,
            "since": time.time(), "pid": os.getpid()}
    # Unique temp name per writer: the daemon loop and a transcription thread can
    # publish at the same moment, and a shared temp path loses that race.
    tmp = paths.STATUS_FILE.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_text(json.dumps(data))
        tmp.replace(paths.STATUS_FILE)
    except OSError:
        tmp.unlink(missing_ok=True)   # status is advisory, never fatal
    return data


def read():
    try:
        return json.loads(paths.STATUS_FILE.read_text())
    except Exception:
        return {"state": IDLE, "detail": "not running", "session": None, "since": 0, "pid": None}


def running():
    """True when the pid recorded in the status file is still alive."""
    pid = read().get("pid")
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False
