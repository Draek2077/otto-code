"""Selects the platform audio backend.

Everything above this module works in terms of Endpoints and Part, so adding a
platform means implementing those two things and nothing else.
"""

import sys

IS_WINDOWS = sys.platform.startswith("win")
NAME = "windows" if IS_WINDOWS else "linux"

if IS_WINDOWS:
    from . import capture_windows as _capture
    from . import wasapi as _detect
else:
    from . import capture_linux as _capture
    from . import pipewire as _detect

Part = _capture.Part

detect = _detect.zoom_endpoints
default_targets = _detect.default_endpoints
app_running = _detect.app_running


def describe():
    return f"{NAME} audio backend"
