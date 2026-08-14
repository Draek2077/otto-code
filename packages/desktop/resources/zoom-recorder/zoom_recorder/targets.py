"""Platform-neutral description of what to record, shared by both backends."""


class Endpoints:
    """Where a call's audio is right now.

    far_target and mic_target are opaque identity strings. The recorder only compares
    them for equality to notice a device change; each backend decides what they mean.
    """

    def __init__(self, in_call=False, app_present=False, far_target=None, mic_target=None,
                 tap_ports=(), fallback_target=None, streams=None, detail=""):
        self.in_call = in_call
        self.app_present = app_present        # the Zoom process exists
        self.far_target = far_target          # what the other participants are heard through
        self.mic_target = mic_target          # our own microphone
        self.tap_ports = tuple(tap_ports)     # PipeWire only: ports to link into
        self.fallback_target = fallback_target
        self.streams = streams or {}          # diagnostics, shown by `probe`
        self.detail = detail

    # Older names, kept because `probe` and `record` read them directly.
    @property
    def sink(self):
        return self.far_target

    @property
    def source(self):
        return self.mic_target

    def __repr__(self):
        return (f"Endpoints(in_call={self.in_call}, app_present={self.app_present}, "
                f"far={self.far_target!r}, mic={self.mic_target!r})")
