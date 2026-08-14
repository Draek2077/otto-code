#!/usr/bin/env python3
"""Freeze the local Zoom Recorder helper for the current release platform."""

from __future__ import annotations

import argparse
import importlib.util
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


DESKTOP_ROOT = Path(__file__).resolve().parents[1]
HELPER_ROOT = DESKTOP_ROOT / "resources" / "zoom-recorder"
ENTRY_POINT = HELPER_ROOT / "otto_zoom_recorder.py"
OUTPUT_ROOT = HELPER_ROOT / "bin" / "x64"

COMMON_MODULES = ("numpy", "onnx_asr", "onnxruntime", "PyInstaller")
WINDOWS_MODULES = ("comtypes", "process_audio_capture", "psutil", "pycaw", "sounddevice")


def require_modules(names: tuple[str, ...]) -> None:
    missing = [name for name in names if importlib.util.find_spec(name) is None]
    if not missing:
        return
    quoted = " ".join(missing)
    raise SystemExit(
        f"Zoom Recorder runtime dependencies are missing: {quoted}. "
        "Install the release build environment before freezing the helper."
    )


def build(output: Path) -> None:
    system = platform.system()
    if system not in {"Linux", "Windows"}:
        raise SystemExit(f"Zoom Recorder is not enabled for {system} builds yet.")

    require_modules(COMMON_MODULES + (WINDOWS_MODULES if system == "Windows" else ()))

    executable_name = "otto-zoom-recorder.exe" if system == "Windows" else "otto-zoom-recorder"
    build_root = DESKTOP_ROOT / ".build" / "zoom-recorder"
    shutil.rmtree(build_root, ignore_errors=True)
    output.mkdir(parents=True, exist_ok=True)

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        "otto-zoom-recorder",
        "--paths",
        str(HELPER_ROOT),
        "--distpath",
        str(output),
        "--workpath",
        str(build_root / "work"),
        "--specpath",
        str(build_root / "spec"),
        "--collect-all",
        "onnx_asr",
        "--collect-all",
        "onnxruntime",
        "--hidden-import",
        "numpy",
    ]
    if system == "Windows":
        command.extend(
            [
                "--collect-all",
                "comtypes",
                "--hidden-import",
                "process_audio_capture",
                "--hidden-import",
                "pycaw.pycaw",
                "--hidden-import",
                "sounddevice",
            ]
        )
    command.append(str(ENTRY_POINT))
    subprocess.run(command, check=True, cwd=HELPER_ROOT)

    executable = output / executable_name
    if not executable.is_file():
        raise SystemExit(f"PyInstaller did not produce {executable}")
    smoke_test(executable)


def smoke_test(executable: Path) -> None:
    """Prove the frozen native helper starts without touching a user's cache."""
    with tempfile.TemporaryDirectory(prefix="otto-zoom-recorder-smoke-") as data_root:
        env = os.environ.copy()
        env["ZOOM_RECORDER_HOME"] = data_root
        for args in (("--version",), ("status",)):
            subprocess.run(
                [str(executable), *args],
                check=True,
                cwd=HELPER_ROOT,
                env=env,
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Freeze Otto Zoom Recorder helper")
    parser.add_argument("--output", type=Path, default=OUTPUT_ROOT)
    args = parser.parse_args()
    build(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
