"""First-run setup: build the local venv and fetch models into ~/.zoom-recorder.

Runs under the system interpreter, so nothing here may import the ML stack.
"""

import os
import pathlib
import shutil
import subprocess
import sys

from . import paths

REQUIREMENTS = ["onnx-asr[hub]", "onnxruntime", "numpy"]

# Windows needs its own audio stack: session enumeration for call detection, and
# per-process loopback plus device capture for recording.
WINDOWS_REQUIREMENTS = ["pycaw", "comtypes", "psutil",
                        "process-audio-capture", "sounddevice"]


def requirements():
    if sys.platform.startswith("win"):
        return REQUIREMENTS + WINDOWS_REQUIREMENTS
    return REQUIREMENTS
PKG_PARENT = str(pathlib.Path(__file__).resolve().parents[1])


def _run(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def _is_progress_bar(line):
    """tqdm and pip redraw lines constantly; they would flood a GUI label."""
    return any(m in line for m in ("it/s", "B/s", "%|", "\r")) or line.startswith("  ")


def _run_streaming(cmd, log, env=None):
    """Run a child process, forwarding its interesting output to log()."""
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in proc.stdout:
        line = line.rstrip()
        if line and not _is_progress_bar(line):
            log(line)
    rc = proc.wait()
    if rc != 0:
        raise subprocess.CalledProcessError(rc, cmd)


def venv_ready():
    return paths.VENV_PYTHON.exists()


def deps_ready():
    if not venv_ready():
        return False
    check = "import onnx_asr, onnxruntime"
    if sys.platform.startswith("win"):
        check += "; import pycaw, sounddevice"
    probe = subprocess.run([str(paths.VENV_PYTHON), "-c", check], capture_output=True)
    return probe.returncode == 0


def complete():
    return paths.SETUP_STAMP.exists() and deps_ready()


def _create_venv(log):
    if venv_ready():
        return
    # --system-site-packages so the tray can use the distro's python3-gi bindings.
    log(f"creating environment in {paths.VENV}")
    try:
        _run([sys.executable, "-m", "venv", "--system-site-packages", str(paths.VENV)])
    except subprocess.CalledProcessError:
        uv = shutil.which("uv")
        if not uv:
            raise
        log("falling back to a uv-managed interpreter")
        _run([uv, "venv", "--python", "3.12", "--system-site-packages", str(paths.VENV)])


def _install_deps(log):
    if deps_ready():
        log("dependencies already present")
        return
    log("installing dependencies (a few hundred MB)")
    pip = [str(paths.VENV_PYTHON), "-m", "pip", "install", "--upgrade"]
    try:
        _run_streaming(pip + requirements(), log)
    except subprocess.CalledProcessError:
        uv = shutil.which("uv")
        if not uv:
            raise
        log("pip failed, retrying with uv")
        _run([uv, "pip", "install", "--python", str(paths.VENV_PYTHON)] + requirements())


def _fetch_models(log):
    env = dict(os.environ, PYTHONPATH=PKG_PARENT, HF_HOME=str(paths.MODELS),
               PYTHONUNBUFFERED="1")
    # Streamed so the child's own progress messages reach the caller's log, which is
    # what the tray displays during first-run setup.
    _run_streaming([str(paths.VENV_PYTHON), "-c",
                    "from zoom_recorder import engine; engine.download_models()"],
                   log, env=env)


def run(force=False, log=print):
    paths.ensure_dirs()
    if complete() and not force:
        log("setup already complete")
        return 0
    try:
        _create_venv(log)
        _install_deps(log)
        _fetch_models(log)
    except subprocess.CalledProcessError as e:
        log(f"setup failed: {e}")
        return 1
    paths.SETUP_STAMP.write_text("ok\n")
    log(f"setup complete, everything lives in {paths.ROOT}")
    return 0
