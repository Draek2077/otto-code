"""Local Zoom call recorder and transcriber."""

# Bump this by hand for a new minor release; the third number is the build revision,
# which resets to 0 when this changes.
BASE_VERSION = "0.1"

# _build.py is generated at package time, so a checkout reports itself as a dev build.
try:
    from ._build import BUILT, REVISION
except ImportError:
    REVISION, BUILT = None, None

__version__ = f"{BASE_VERSION}.{REVISION}" if REVISION is not None else f"{BASE_VERSION}.dev"
VERSION_FULL = __version__

APP_NAME = "zoom-recorder"
APP_TITLE = "Zoom Recorder"
