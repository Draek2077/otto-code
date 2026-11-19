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

ERENDER, ECAPTURE, DEVICE_STATE_ACTIVE = 0, 1, 1


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


def _devices(direction):
    comtypes = _com()
    from pycaw.pycaw import IMMDeviceEnumerator
    try:
        from pycaw.constants import CLSID_MMDeviceEnumerator
    except ImportError:
        from pycaw.pycaw import CLSID_MMDeviceEnumerator

    enumerator = comtypes.CoCreateInstance(
        CLSID_MMDeviceEnumerator, IMMDeviceEnumerator, comtypes.CLSCTX_INPROC_SERVER)
    which = ERENDER if direction == "render" else ECAPTURE
    # Zoom can use a headset while Windows defaults to a different microphone.
    # Default-endpoint sessions then remain inactive throughout a real meeting.
    return enumerator.EnumAudioEndpoints(which, DEVICE_STATE_ACTIVE)


def _sessions(direction):
    """Yield (pid, process_name, state, endpoint_id) across enabled devices."""
    from pycaw.pycaw import IAudioSessionControl2, IAudioSessionManager2
    comtypes = _com()
    devices = _devices(direction)
    first_error = None
    for i in range(devices.GetCount()):
        try:
            device = devices.Item(i)
            endpoint_id = device.GetId()
            activated = device.Activate(IAudioSessionManager2._iid_, comtypes.CLSCTX_ALL, None)
            enum = activated.QueryInterface(IAudioSessionManager2).GetSessionEnumerator()
            count = enum.GetCount()
        except Exception as e:
            first_error = first_error or e
            continue
        for j in range(count):
            try:
                control = enum.GetSession(j)
                pid = control.QueryInterface(IAudioSessionControl2).GetProcessId()
                state = control.GetState()
            except Exception:
                continue
            if pid:
                yield pid, _process_name(pid), state, endpoint_id
    # Report an inaccessible device to probe, after scanning the remaining devices.
    if first_error is not None:
        raise first_error


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
    render, capture, streams, microphones = {}, {}, {}, {}
    for direction, into in (("render", render), ("capture", capture)):
        try:
            for pid, name, state, endpoint_id in _sessions(direction):
                if not _is_zoom_process(name):
                    continue
                # Device switches leave an inactive session for the same PID on
                # the old device. It must not overwrite an active session elsewhere.
                into[pid] = STATE_ACTIVE if STATE_ACTIVE in (state, into.get(pid)) else state
                streams[f"{direction}:{pid}"] = "ACTIVE" if into[pid] == STATE_ACTIVE else "inactive"
                if direction == "capture" and state == STATE_ACTIVE:
                    microphones[pid] = endpoint_id
        except Exception as e:
            streams[direction] = f"error: {type(e).__name__}"

    # The meeting process is the one actively capturing the microphone.
    talking = [pid for pid, state in capture.items() if state == STATE_ACTIVE]
    meeting_pid = talking[0] if talking else None

    far = f"zoom-pid-{meeting_pid}" if meeting_pid else None
    mic = f"wasapi-capture:{microphones[meeting_pid]}" if meeting_pid else None
    return Endpoints(in_call=bool(meeting_pid), app_present=app_running(),
                     far_target=far, mic_target=mic,
                     streams=streams,
                     detail=f"pid {meeting_pid}" if meeting_pid else "")


def meeting_pid(target):
    """Recover the PID from a far_target identity string."""
    if target and target.startswith("zoom-pid-"):
        try:
            return int(target.rsplit("-", 1)[1])
        except ValueError:
            return None
    return None


def _portaudio_endpoint_id(portaudio, index):
    """Read the identity behind one PortAudio WASAPI device without owning it."""
    import ctypes
    from pycaw.pycaw import IMMDevice

    get_device = portaudio.PaWasapi_GetIMMDevice
    get_device.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)]
    get_device.restype = ctypes.c_int
    pointer = ctypes.c_void_p()
    if get_device(index, ctypes.byref(pointer)) != 0 or not pointer.value:
        return None
    endpoint = ctypes.cast(pointer, ctypes.POINTER(IMMDevice))
    # PaWasapi_GetIMMDevice returns a borrowed pointer. comtypes will release
    # its wrapper, so take our own reference before reading the endpoint ID.
    endpoint.AddRef()
    return endpoint.GetId()


def input_device(target, sd):
    """Resolve Zoom's exact IMMDevice ID to a sounddevice WASAPI input index."""
    import ctypes

    prefix = "wasapi-capture:"
    if not target or not target.startswith(prefix):
        raise ValueError("Zoom microphone endpoint was not identified")
    wanted = target[len(prefix):]
    _com()
    # sounddevice caches PortAudio devices at import. Refresh only when opening a
    # new microphone part, after the previous part has closed, to include hotplug.
    sd._terminate()
    sd._initialize()
    # The pinned sounddevice wheel does not expose this public PortAudio extension
    # through its CFFI wrapper. Use its already-loaded DLL, never a second library.
    portaudio = ctypes.CDLL(sd._libname)
    apis = sd.query_hostapis()
    for index, info in enumerate(sd.query_devices()):
        if not info["max_input_channels"] or apis[info["hostapi"]]["name"] != "Windows WASAPI":
            continue
        if _portaudio_endpoint_id(portaudio, index) == wanted:
            return index
    raise RuntimeError("Zoom's microphone is no longer available")
