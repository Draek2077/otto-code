"""PipeWire introspection for locating Zoom's audio endpoints."""

import json
import pathlib
import subprocess

from .targets import Endpoints

ZOOM_APP = "ZOOM VoiceEngine"
PLAY_STREAM = "playStream"
REC_STREAM = "recStream"


def app_running():
    """True while the Zoom process exists.

    Zoom destroys its PipeWire nodes when it is not in a call, so the absence of
    audio nodes says nothing about whether the app is still open.
    """
    for entry in pathlib.Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if (entry / "comm").read_text().strip() == "zoom":
                return True
        except OSError:
            continue
    return False


def dump():
    out = subprocess.run(["pw-dump"], capture_output=True, text=True, timeout=15).stdout
    return json.loads(out)


def _props(node):
    return ((node.get("info") or {}).get("props") or {}) if node else {}


def zoom_endpoints():
    """Locate the sink Zoom plays to and the source it captures from.

    Read from Zoom's own links, not the system defaults: Zoom is frequently on a
    different device (a headset mic while the default source is the internal mic).
    """
    nodes, ports, links = {}, {}, []
    for o in dump():
        t = o.get("type", "")
        if t.endswith("Node"):
            nodes[o["id"]] = o
        elif t.endswith("Port"):
            ports[o["id"]] = o
        elif t.endswith("Link"):
            links.append(o)

    def port_node(pid):
        return _props(ports.get(pid)).get("node.id")

    def name_of(nid):
        p = _props(nodes.get(nid))
        return p.get("node.name") or p.get("node.description")

    zoom = [n for n in nodes.values() if _props(n).get("application.name") == ZOOM_APP]

    def running(media_name):
        return [n for n in zoom
                if _props(n).get("media.name") == media_name
                and (n.get("info") or {}).get("state") == "running"]

    sink = source = None
    for n in running(PLAY_STREAM):
        for l in links:
            li = l.get("info") or {}
            if port_node(li.get("output-port-id")) == n["id"]:
                sink = name_of(port_node(li.get("input-port-id")))
                break
        if sink:
            break

    for n in running(REC_STREAM):
        for l in links:
            li = l.get("info") or {}
            if port_node(li.get("input-port-id")) == n["id"]:
                source = name_of(port_node(li.get("output-port-id")))
                break
        if source:
            break

    streams = {_props(n).get("media.name"): (n.get("info") or {}).get("state") for n in zoom}

    play = running(PLAY_STREAM)
    play_node = play[0]["id"] if play else None
    play_ports = _output_ports(ports, play_node) if play_node else ()

    # Only the mic capture stream marks a real call. Observed on Zoom 7.1: playStream
    # runs while Zoom sits idle outside any meeting, so it produces false positives.
    in_call = bool(running(REC_STREAM))
    far = f"zoom-node-{play_node}" if play_ports else sink
    return Endpoints(in_call=in_call, app_present=app_running(), far_target=far,
                     mic_target=source, tap_ports=play_ports, fallback_target=sink,
                     streams=streams)


def _output_ports(ports, node_id):
    """Port object ids for a node's outputs, ordered by channel."""
    found = []
    for o in ports.values():
        p = _props(o)
        if p.get("node.id") == node_id and p.get("port.direction") == "out":
            found.append((p.get("port.id", 0), o["id"]))
    return tuple(pid for _, pid in sorted(found))


def input_ports(node_name):
    """Port object ids for the inputs of a node, found by exact node.name."""
    objs = dump()
    wanted = {o["id"] for o in objs
              if o.get("type", "").endswith("Node") and _props(o).get("node.name") == node_name}
    found = []
    for o in objs:
        if not o.get("type", "").endswith("Port"):
            continue
        p = _props(o)
        if p.get("port.direction") == "in" and p.get("node.id") in wanted:
            found.append((p.get("port.id", 0), o["id"]))
    return tuple(pid for _, pid in sorted(found))


def link(out_port, in_port):
    r = subprocess.run(["pw-link", str(out_port), str(in_port)],
                       capture_output=True, text=True)
    return r.returncode == 0


def links_into(in_port):
    """Count existing links feeding a port, to notice a tap that has dropped."""
    n = 0
    for o in dump():
        if o.get("type", "").endswith("Link"):
            if ((o.get("info") or {}).get("input-port-id")) == in_port:
                n += 1
    return n


def default_endpoints():
    """Fallback targets from PipeWire's default-device metadata."""
    sink = source = None
    for o in dump():
        if o.get("type", "").endswith("Metadata") and (o.get("props") or {}).get("metadata.name") == "default":
            for m in o.get("metadata", []):
                if m.get("key") == "default.audio.sink":
                    sink = (m.get("value") or {}).get("name")
                elif m.get("key") == "default.audio.source":
                    source = (m.get("value") or {}).get("name")
    return sink, source


def record_command(target, capture_sink, raw=False, rate=16000, node_name=None):
    # target None means "do not auto-link"; the caller wires the ports up itself.
    cmd = ["pw-record", "--target", "0" if target is None else target,
           "--rate", str(rate), "--channels", "1", "--format", "s16", "-q", "10"]
    props = []
    if capture_sink:
        props.append("stream.capture.sink=true")
    if node_name:
        props.append(f"node.name={node_name}")
    if props:
        cmd += ["-P", "{ %s }" % " ".join(props)]
    if raw:
        cmd.append("--raw")
    return cmd
