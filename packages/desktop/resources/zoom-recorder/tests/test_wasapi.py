"""Windows detection regressions; no audio hardware or Windows imports required."""

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from zoom_recorder import wasapi


def device(*sessions, error=None, endpoint_id="microphone"):
    endpoint = MagicMock()
    endpoint.GetId.return_value = endpoint_id
    if error:
        endpoint.Activate.side_effect = error
        return endpoint
    controls = []
    for pid, state in sessions:
        control = MagicMock()
        control.QueryInterface.return_value.GetProcessId.return_value = pid
        control.GetState.return_value = state
        controls.append(control)
    enumerator = endpoint.Activate.return_value.QueryInterface.return_value.GetSessionEnumerator.return_value
    enumerator.GetCount.return_value = len(controls)
    enumerator.GetSession.side_effect = controls
    return endpoint


class DetectionTests(unittest.TestCase):
    def setUp(self):
        interfaces = types.ModuleType("pycaw.pycaw")
        interfaces.IMMDeviceEnumerator = object()
        interfaces.IAudioSessionManager2 = types.SimpleNamespace(_iid_=object())
        interfaces.IAudioSessionControl2 = object()
        constants = types.ModuleType("pycaw.constants")
        constants.CLSID_MMDeviceEnumerator = object()
        modules = {"pycaw": types.ModuleType("pycaw"), "pycaw.pycaw": interfaces,
                   "pycaw.constants": constants}
        self.enterContext(patch.dict(sys.modules, modules))
        self.com = MagicMock()
        self.enterContext(patch.object(wasapi, "_com", return_value=self.com))
        self.enterContext(patch.object(wasapi, "app_running", return_value=True))
        names = {100: "Zoom.exe", 200: "otto-zoom-recorder.exe", 300: "music.exe"}
        self.enterContext(patch.object(wasapi, "_process_name", side_effect=lambda pid: names.get(pid, "")))
        self.enumerator = self.com.CoCreateInstance.return_value
        self.devices(render=[], capture=[])

    def devices(self, render, capture):
        def collection(flow, state_mask):
            endpoints = render if flow == wasapi.ERENDER else capture
            result = MagicMock()
            result.GetCount.return_value = len(endpoints)
            result.Item.side_effect = lambda i: endpoints[i]
            return result

        self.enumerator.EnumAudioEndpoints.side_effect = collection
        # The default endpoint is deliberately different from Zoom's device.
        self.enumerator.GetDefaultAudioEndpoint.side_effect = lambda flow, role: (
            render[-1] if flow == wasapi.ERENDER else capture[-1])

    def test_detects_meeting_on_nondefault_microphone(self):
        self.devices(render=[device((100, 1)), device((100, 0))],
                     capture=[device((100, 1)), device((100, 0))])
        ep = wasapi.zoom_endpoints()
        self.assertTrue(ep.in_call)
        self.assertEqual(ep.far_target, "zoom-pid-100")
        self.assertEqual(ep.streams["capture:100"], "ACTIVE")
        self.assertEqual(ep.mic_target, "wasapi-capture:microphone")

    def test_inactive_duplicate_never_overwrites_active_session(self):
        for states in ((1, 0), (0, 1)):
            with self.subTest(states=states):
                self.devices(render=[], capture=[device((100, s)) for s in states])
                ep = wasapi.zoom_endpoints()
                self.assertTrue(ep.in_call)
                self.assertEqual(ep.streams["capture:100"], "ACTIVE")

    def test_render_only_does_not_start_recording(self):
        self.devices(render=[device((100, 1))], capture=[device((100, 0))])
        self.assertFalse(wasapi.zoom_endpoints().in_call)

    def test_other_apps_and_recorder_are_not_zoom(self):
        self.devices(render=[], capture=[device((200, 1), (300, 1))])
        self.assertFalse(wasapi.zoom_endpoints().in_call)

    def test_device_failure_does_not_hide_meeting_on_other_device(self):
        self.devices(render=[], capture=[device(error=OSError("unavailable")), device((100, 1))])
        ep = wasapi.zoom_endpoints()
        self.assertTrue(ep.in_call)
        self.assertIn("error", ep.streams["capture"])

    def test_no_devices_is_idle(self):
        ep = wasapi.zoom_endpoints()
        self.assertFalse(ep.in_call)
        self.assertEqual(ep.streams, {})

    def test_leaving_call_is_detected_on_next_poll(self):
        self.devices(render=[], capture=[device((100, 1))])
        self.assertTrue(wasapi.zoom_endpoints().in_call)
        self.devices(render=[], capture=[device((100, 0))])
        self.assertFalse(wasapi.zoom_endpoints().in_call)

    def test_microphone_switch_updates_capture_target(self):
        self.devices(render=[], capture=[device((100, 1), endpoint_id="headset")])
        self.assertEqual(wasapi.zoom_endpoints().mic_target, "wasapi-capture:headset")
        self.devices(render=[], capture=[device((100, 0), endpoint_id="headset"),
                                        device((100, 1), endpoint_id="usb")])
        self.assertEqual(wasapi.zoom_endpoints().mic_target, "wasapi-capture:usb")


class InputDeviceTests(unittest.TestCase):
    def setUp(self):
        self.sd = MagicMock()
        self.sd.query_hostapis.return_value = [{"name": "MME"}, {"name": "Windows WASAPI"}]
        self.sd.query_devices.return_value = [
            {"name": "Microphone", "hostapi": 0, "max_input_channels": 1},
            {"name": "Microphone", "hostapi": 1, "max_input_channels": 1},
            {"name": "Microphone", "hostapi": 1, "max_input_channels": 1},
            {"name": "Speakers", "hostapi": 1, "max_input_channels": 0},
        ]
        self.enterContext(patch.object(wasapi, "_com"))
        self.enterContext(patch("ctypes.CDLL"))
        self.enterContext(patch.object(wasapi, "_portaudio_endpoint_id", side_effect=lambda dll, i: {1: "other-mic", 2: "zoom-mic"}[i]))

    def test_duplicate_display_names_select_exact_zoom_endpoint(self):
        self.assertEqual(wasapi.input_device("wasapi-capture:zoom-mic", self.sd), 2)
        self.sd._terminate.assert_called_once()
        self.sd._initialize.assert_called_once()

    def test_disconnected_device_never_uses_default_microphone(self):
        with self.assertRaisesRegex(RuntimeError, "no longer available"):
            wasapi.input_device("wasapi-capture:disconnected", self.sd)

    def test_unidentified_endpoint_is_rejected(self):
        with self.assertRaises(ValueError):
            wasapi.input_device("default-capture", self.sd)


if __name__ == "__main__":
    unittest.main()
