"""Everything the app writes lives under ~/.zoom-recorder."""

import os
import pathlib

ROOT = pathlib.Path(os.environ.get("ZOOM_RECORDER_HOME", pathlib.Path.home() / ".zoom-recorder"))

VENV = ROOT / "venv"
VENV_PYTHON = VENV / "bin" / "python"
MODELS = ROOT / "models"
RECORDINGS = ROOT / "recordings"
TMP = ROOT / "tmp"
STATE = ROOT / "state"
LOGS = ROOT / "logs"

CONFIG_FILE = ROOT / "config.toml"
STATUS_FILE = STATE / "status.json"
LOCK_FILE = STATE / "daemon.lock"
SETUP_STAMP = ROOT / "state" / "setup-complete"

ALL_DIRS = (ROOT, MODELS, RECORDINGS, TMP, STATE, LOGS)


def ensure_dirs():
    for d in ALL_DIRS:
        d.mkdir(parents=True, exist_ok=True)
    # Keep HF and temp files inside our own tree rather than scattering them in $HOME.
    os.environ.setdefault("HF_HOME", str(MODELS))
    os.environ.setdefault("TMPDIR", str(TMP))
