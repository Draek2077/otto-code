"""Capture routing and resource ownership, independent of audio hardware."""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from zoom_recorder import capture_windows, daemon, recorder, wasapi
from zoom_recorder.targets import Endpoints


class WindowsCaptureTests(unittest.TestCase):
    def setUp(self):
        self.sd = MagicMock()
        self.enterContext(patch.dict(sys.modules, {"sounddevice": self.sd}))
        self.resolve = self.enterContext(patch.object(wasapi, "input_device", return_value=17))
        self.writer = MagicMock()
        self.enterContext(patch.object(capture_windows.wave, "open", return_value=self.writer))

    def test_selected_zoom_endpoint_reaches_input_stream(self):
        part = capture_windows._DeviceCapture(Path("me.wav"), "wasapi-capture:zoom-mic")
        self.resolve.assert_called_once_with("wasapi-capture:zoom-mic", self.sd)
        self.assertEqual(self.sd.InputStream.call_args.kwargs["device"], 17)
        self.sd.WasapiSettings.assert_called_once_with(auto_convert=True)
        part.stop()
        self.sd.InputStream.return_value.close.assert_called_once()
        self.writer.close.assert_called_once()

    def test_failed_stream_start_closes_stream_and_wav(self):
        self.sd.InputStream.return_value.start.side_effect = RuntimeError("device unavailable")
        with self.assertRaises(RuntimeError):
            capture_windows._DeviceCapture(Path("me.wav"), "wasapi-capture:zoom-mic")
        self.sd.InputStream.return_value.close.assert_called_once()
        self.writer.close.assert_called_once()

    def test_failed_zoom_loopback_never_records_system_audio(self):
        log = MagicMock()
        with patch.object(capture_windows, "_ProcessLoopback", side_effect=RuntimeError("failed")), \
                patch.object(capture_windows, "_DeviceCapture") as microphone:
            part = capture_windows.Part("them", "zoom-pid-123", Path("them.wav"), 0, True, log=log)
            self.assertFalse(part.alive())
            microphone.assert_not_called()
            self.assertIn("failed", log.call_args.args[0])

    def test_unplugged_microphone_is_closed_even_if_stop_fails(self):
        part = capture_windows._DeviceCapture(Path("me.wav"), "wasapi-capture:zoom-mic")
        self.sd.InputStream.return_value.stop.side_effect = RuntimeError("unplugged")
        part.stop()
        self.sd.InputStream.return_value.close.assert_called_once()
        self.writer.close.assert_called_once()


class SessionRoutingTests(unittest.TestCase):
    def setUp(self):
        def part(track, target, path, offset, capture_sink, tap_ports, fallback, log):
            p = MagicMock()
            p.track, p.target, p.path, p.offset = track, target, path, offset
            p.tap_ports = tuple(tap_ports or ())
            p.requested_tap_ports = p.tap_ports
            p.alive.return_value = p.tap_healthy.return_value = True
            return p
        self.factory = self.enterContext(patch.object(recorder, "Part", side_effect=part))
        self.session = recorder.Session(directory=Path("recording"), log=MagicMock())

    def test_microphone_switch_closes_old_part_and_uses_new_target(self):
        self.session.follow(Endpoints(mic_target="zoom-mic-1"))
        old = self.session.active["me"]
        self.session.follow(Endpoints(mic_target="zoom-mic-2"))
        old.stop.assert_called_once()
        self.assertEqual(self.session.active["me"].target, "zoom-mic-2")

    def test_new_playback_ports_roll_part_even_if_node_id_is_same(self):
        self.session.follow(Endpoints(far_target="zoom-node-1", tap_ports=(10, 11)))
        old = self.session.active["them"]
        self.session.follow(Endpoints(far_target="zoom-node-1", tap_ports=(12, 13)))
        old.stop.assert_called_once()
        self.assertEqual(self.session.active["them"].tap_ports, (12, 13))

    def test_linux_device_fallback_does_not_restart_on_every_poll(self):
        ep = Endpoints(far_target="zoom-node-1", tap_ports=(10, 11))
        self.session.follow(ep)
        fallback = self.session.active["them"]
        fallback.tap_ports = ()
        self.session.follow(ep)
        fallback.stop.assert_not_called()
        self.assertEqual(self.factory.call_count, 1)

    def test_missing_route_never_substitutes_default_device(self):
        with patch.object(daemon.config, "load", return_value={"stop_grace_seconds": 10}), \
                patch.object(daemon.backend, "default_targets") as defaults, \
                patch.object(daemon.recorder, "Session") as session, \
                patch.object(daemon.status, "publish"):
            watcher = daemon.Daemon(log=MagicMock())
            watcher._start_call(Endpoints(in_call=True, far_target="zoom-playback"))
            selected = session.return_value.follow.call_args.args[0]
            self.assertIsNone(selected.mic_target)
            defaults.assert_not_called()

    def test_unresolved_endpoints_do_not_start_a_recording(self):
        with patch.object(daemon.config, "load", return_value={"stop_grace_seconds": 10}), \
                patch.object(daemon.recorder, "Session") as session, \
                patch.object(daemon.status, "publish"):
            watcher = daemon.Daemon(log=MagicMock())
            watcher._start_call(Endpoints(in_call=True))
            session.assert_not_called()

    def test_no_live_capture_reports_error_instead_of_recording(self):
        with patch.object(daemon.config, "load", return_value={"stop_grace_seconds": 10}):
            watcher = daemon.Daemon(log=MagicMock())
            watcher._session = MagicMock()
            dead = MagicMock()
            dead.alive.return_value = False
            watcher._session.active = {"me": dead, "them": dead}
            self.assertEqual(watcher.state(), daemon.status.ERROR)
            self.assertIn("could not start", watcher._capture_detail())

    def test_partial_capture_names_the_missing_track(self):
        with patch.object(daemon.config, "load", return_value={"stop_grace_seconds": 10}):
            watcher = daemon.Daemon(log=MagicMock())
            watcher._session = MagicMock()
            microphone = MagicMock()
            microphone.alive.return_value = True
            watcher._session.active = {"me": microphone}
            self.assertEqual(watcher.state(), daemon.status.RECORDING)
            self.assertIn("Zoom playback capture unavailable", watcher._capture_detail())


if __name__ == "__main__":
    unittest.main()
