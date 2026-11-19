"""Linux routing regressions from synthetic PipeWire graphs, without audio capture."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from zoom_recorder import pipewire


def obj(kind, id_, props, state="running"):
    return {"id": id_, "type": f"PipeWire:Interface:{kind}",
            "info": {"props": props, "state": state}}


def graph(identity=None, labels=("Speaker audio", "Microphone audio"), client=False):
    identity = identity or {"application.process.binary": "zoom", "application.name": "New Zoom label"}
    streams = {"client.id": "90"} if client else identity
    result = [
        obj("Node", 1, {**streams, "media.class": "Stream/Output/Audio", "media.name": labels[0]}),
        obj("Node", 2, {**streams, "media.class": "Stream/Input/Audio", "media.name": labels[1]}),
        obj("Node", 3, {"node.name": "zoom-headset-speakers", "media.class": "Audio/Sink"}),
        obj("Node", 4, {"node.name": "zoom-headset-mic", "media.class": "Audio/Source"}),
        obj("Node", 5, {"node.name": "unrelated-default-mic", "media.class": "Audio/Source"}),
        obj("Port", 10, {"node.id": "1", "port.id": "1", "port.direction": "out"}),
        obj("Port", 11, {"node.id": "1", "port.id": "0", "port.direction": "out"}),
        obj("Port", 12, {"node.id": "3", "port.direction": "in"}),
        obj("Port", 13, {"node.id": "4", "port.direction": "out"}),
        obj("Port", 14, {"node.id": "2", "port.direction": "in"}),
        {"id": 20, "type": "PipeWire:Interface:Link", "info": {"output-port-id": "11", "input-port-id": "12"}},
        {"id": 21, "type": "PipeWire:Interface:Link", "info": {"output-port-id": "13", "input-port-id": "14"}},
    ]
    if client:
        result.append(obj("Client", 90, identity))
    return result


class PipeWireTests(unittest.TestCase):
    def detect(self, data):
        with patch.object(pipewire, "dump", return_value=data), patch.object(pipewire, "app_running", return_value=False):
            return pipewire.zoom_endpoints()

    def test_renamed_streams_follow_zoom_devices_and_tap_only_zoom_playback(self):
        ep = self.detect(graph())
        self.assertTrue(ep.in_call)
        self.assertTrue(ep.app_present)
        self.assertEqual(ep.mic_target, "zoom-headset-mic")
        self.assertEqual(ep.far_target, "zoom-node-1")
        self.assertEqual(ep.tap_ports, (11, 10))
        self.assertEqual(ep.fallback_target, "zoom-headset-speakers")

    def test_client_owned_identity_is_resolved(self):
        self.assertTrue(self.detect(graph(client=True)).in_call)

    def test_flatpak_identity_without_process_name(self):
        self.assertTrue(self.detect(graph(identity={"application.id": "us.zoom.Zoom"})).in_call)

    def test_known_application_name_without_binary(self):
        self.assertTrue(self.detect(graph(identity={"application.name": "ZOOM VoiceEngine"})).in_call)

    def test_stream_labels_alone_cannot_identify_zoom(self):
        ep = self.detect(graph(identity={"application.process.binary": "otto-zoom-recorder"},
                               labels=("playStream", "recStream")))
        self.assertFalse(ep.in_call)
        self.assertIsNone(ep.mic_target)
        self.assertEqual(ep.tap_ports, ())

    def test_non_audio_zoom_stream_is_excluded(self):
        data = graph()
        data[1]["info"]["props"]["media.class"] = "Stream/Input/Video"
        data[1]["info"]["props"]["media.name"] = "recStream"
        self.assertFalse(self.detect(data).in_call)

    def test_playback_alone_does_not_start_a_call(self):
        data = graph()
        data[1]["info"]["state"] = "suspended"
        self.assertFalse(self.detect(data).in_call)

    def test_old_labels_without_media_class_still_work(self):
        data = graph(identity={"application.name": "ZOOM VoiceEngine"}, labels=("playStream", "recStream"))
        for node in data[:2]:
            del node["info"]["props"]["media.class"]
        self.assertTrue(self.detect(data).in_call)

    def test_link_node_ids_without_port_objects(self):
        data = [o for o in graph() if not o["type"].endswith("Port")]
        data[-2]["info"] = {"output-node-id": "1", "input-node-id": "3"}
        data[-1]["info"] = {"output-node-id": "4", "input-node-id": "2"}
        ep = self.detect(data)
        self.assertEqual(ep.mic_target, "zoom-headset-mic")
        self.assertEqual(ep.far_target, "zoom-headset-speakers")

    def test_missing_mic_link_does_not_select_default_microphone(self):
        ep = self.detect(graph()[:-1])
        self.assertTrue(ep.in_call)
        self.assertIsNone(ep.mic_target)

    def test_microphone_device_change_updates_target(self):
        data = graph()
        data.append(obj("Node", 6, {"node.name": "new-zoom-usb-mic", "media.class": "Audio/Source"}))
        data.append(obj("Port", 15, {"node.id": "6", "port.direction": "out"}))
        data[11]["info"]["output-port-id"] = "15"
        self.assertEqual(self.detect(data).mic_target, "new-zoom-usb-mic")

    def test_input_port_ids_are_normalized(self):
        data = graph()
        with patch.object(pipewire, "dump", return_value=data):
            self.assertEqual(pipewire.input_ports("zoom-headset-speakers"), (12,))

    def test_link_health_normalizes_port_ids(self):
        with patch.object(pipewire, "dump", return_value=graph()):
            self.assertEqual(pipewire.links_into(12), 1)


if __name__ == "__main__":
    unittest.main()
