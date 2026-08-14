"""Windows call detection through WASAPI audio sessions.

Built from what probe_windows.py measured on Windows 11 build 26200:

  - A call is one Zoom PID whose *capture* session is ACTIVE.
  - An active render session alone is not a call; Zoom flashes one for UI sounds.
  - Mute does not change session state, so a muted stretch is still a call.
  - Sessions are destroyed when a call ends and a new PID appears, so the meeting
    process must be resolved on every poll rather than cached.

See windows/README-windows.md for the raw timeline these rules come from.
"""

import os

from .targets import Endpoints

# Match Zoom's executable names exactly.  A substring check also matches Otto's
# own otto-zoom-recorder.exe, whose microphone capture then makes the watcher
# believe a meeting continues forever after Zoom has left.
ZOOM_PROCESS_NAMES = {"zoom", "zoom.exe", "cpthost", "cpthost.exe"}
STATE_ACTIVE = 1

ERENDER, ECAPTURE, EMULTIMEDIA = 0, 1, 1


def _com():
    import comtypes
    try:
        comtypes.CoInitialize()
    except Exception:
        pass
    return comtypes


def app_running():
    """True while any Zoom process exists, regardless of audio state."""
    try:
        import psutil
    except ImportError:
        return True          # cannot tell, so do not claim Zoom has exited
    for p in psutil.process_iter(["name"]):
        if _is_zoom_process(p.info.get("name") or ""):
            return True
    return False


def _session_manager(direction):
    comtypes = _com()
    from pycaw.pycaw import IAudioSessionManager2, IMMDeviceEnumerator
    try:
        from pycaw.constants import CLSID_MMDeviceEnumerator
    except ImportError:
        from pycaw.pycaw import CLSID_MMDeviceEnumerator

    enumerator = comtypes.CoCreateInstance(
        CLSID_MMDeviceEnumerator, IMMDeviceEnumerator, comtypes.CLSCTX_INPROC_SERVER)
    which = ERENDER if direction == "render" else ECAPTURE
    device = enumerator.GetDefaultAudioEndpoint(which, EMULTIMEDIA)
    activated = device.Activate(IAudioSessionManager2._iid_, comtypes.CLSCTX_ALL, None)
    return activated.QueryInterface(IAudioSessionManager2)


def _sessions(direction):
    """Yield (pid, process_name, state) for one endpoint direction."""
    from pycaw.pycaw import IAudioSessionControl2
    enum = _session_manager(direction).GetSessionEnumerator()
    for i in range(enum.GetCount()):
        control = enum.GetSession(i)
        try:
            pid = control.QueryInterface(IAudioSessionControl2).GetProcessId()
        except Exception:
            continue
        if not pid:
            continue
        try:
            state = control.GetState()
        except Exception:
            continue
        yield pid, _process_name(pid), state


def _process_name(pid):
    try:
        import psutil
        return psutil.Process(pid).name()
    except Exception:
        return ""


def _is_zoom_process(name):
    return name.lower() in ZOOM_PROCESS_NAMES


def default_endpoints():
    """Fallback targets: whole-device loopback, and the default microphone."""
    return "default-render-loopback", "default-capture"


def zoom_endpoints():
    """Locate the Zoom process that is currently in a call."""
    render, capture, streams = {}, {}, {}
    for direction, into in (("render", render), ("capture", capture)):
        try:
            for pid, name, state in _sessions(direction):
                if not _is_zoom_process(name):
                    continue
                into[pid] = state
                streams[f"{direction}:{pid}"] = "ACTIVE" if state == STATE_ACTIVE else "inactive"
        except Exception as e:
            streams[direction] = f"error: {type(e).__name__}"

    # The meeting process is the one actively capturing the microphone.
    talking = [pid for pid, state in capture.items() if state == STATE_ACTIVE]
    meeting_pid = talking[0] if talking else None

    far = f"zoom-pid-{meeting_pid}" if meeting_pid else None
    mic = "default-capture" if meeting_pid else None
    return Endpoints(in_call=bool(meeting_pid), app_present=app_running(),
                     far_target=far, mic_target=mic,
                     fallback_target="default-render-loopback", streams=streams,
                     detail=f"pid {meeting_pid}" if meeting_pid else "")


def meeting_pid(target):
    """Recover the PID from a far_target identity string."""
    if target and target.startswith("zoom-pid-"):
        try:
            return int(target.rsplit("-", 1)[1])
        except ValueError:
            return None
    return None
