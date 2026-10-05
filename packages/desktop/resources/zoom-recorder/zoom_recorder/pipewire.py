"""PipeWire introspection for locating Zoom's audio endpoints."""

import json
import pathlib
import subprocess

from .targets import Endpoints

PLAY_STREAM = "playStream"
REC_STREAM = "recStream"
ZOOM_NAMES = {"zoom", "zoom voiceengine", "zoom workplace"}
ZOOM_IDS = {"us.zoom.zoom"}


def _id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_zoom(props):
    # Identity comes from the owning application, never a stream's display name.
    binary = pathlib.PurePosixPath(str(props.get("application.process.binary") or "")).name
    return (binary.casefold() == "zoom"
            or str(props.get("application.id") or "").casefold() in ZOOM_IDS
            or str(props.get("application.name") or "").casefold() in ZOOM_NAMES)


def _direction(props):
    media_class = props.get("media.class")
    if media_class:
        return {"Stream/Output/Audio": "play", "Stream/Input/Audio": "record"}.get(media_class)
    # Older PulseAudio bridges may omit media.class. Only use the known labels
    # in that case; an explicitly non-audio stream must never qualify.
    return {PLAY_STREAM: "play", REC_STREAM: "record"}.get(props.get("media.name"))


def app_running():
    """True while the Zoom process exists.

    Zoom destroys its PipeWire nodes when it is not in a call, so the absence of
    audio nodes says nothing about whether the app is still open.
    """
    for entry in pathlib.Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if (entry / "comm").read_text().strip().casefold() == "zoom":
                return True
        except OSError:
            continue
    return False


def dump():
    out = subprocess.run(["pw-dump"], capture_output=True, text=True, timeout=15, check=True).stdout
    return json.loads(out)


def _props(node):
    return ((node.get("info") or {}).get("props") or {}) if node else {}


def zoom_endpoints():
    """Locate the sink Zoom plays to and the source it captures from.

    Read from Zoom's own links, not the system defaults: Zoom is frequently on a
    different device (a headset mic while the default source is the internal mic).
    """
    nodes, ports, clients, links = {}, {}, {}, []
    for o in dump():
        t = o.get("type", "")
        if t.endswith("Node"):
            nodes[o["id"]] = o
        elif t.endswith("Port"):
            ports[o["id"]] = o
        elif t.endswith("Link"):
            links.append(o)
        elif t.endswith("Client"):
            clients[o["id"]] = o

    def port_node(pid):
        return _id(_props(ports.get(_id(pid))).get("node.id"))

    def name_of(nid):
        p = _props(nodes.get(nid))
        return p.get("node.name")

    def identity(n):
        props = _props(n)
        return {**_props(clients.get(_id(props.get("client.id")))), **props}

    zoom = [n for n in nodes.values() if _is_zoom(identity(n))]

    def running(direction):
        return [n for n in zoom
                if _direction(_props(n)) == direction
                and (n.get("info") or {}).get("state") == "running"]

    def ends(link):
        li = link.get("info") or {}
        return (_id(li.get("output-node-id")) or port_node(li.get("output-port-id")),
                _id(li.get("input-node-id")) or port_node(li.get("input-port-id")))

    sink = source = None
    play = running("play")
    record = running("record")
    for n in play:
        for l in links:
            output, input_ = ends(l)
            if output == n["id"]:
                sink = name_of(input_)
                break
        if sink:
            break

    for n in record:
        for l in links:
            output, input_ = ends(l)
            if input_ == n["id"]:
                source = name_of(output)
                break
        if source:
            break

    streams = {f"{_direction(_props(n)) or 'other'}:{n['id']}:{_props(n).get('media.name') or '-'}":
               (n.get("info") or {}).get("state") for n in zoom}

    play_node = play[0]["id"] if play else None
    play_ports = _output_ports(ports, play_node) if play_node else ()

    # Only the mic capture stream marks a real call. Observed on Zoom 7.1: playStream
    # runs while Zoom sits idle outside any meeting, so it produces false positives.
    in_call = bool(record)
    far = f"zoom-node-{play_node}" if play_ports else sink
    return Endpoints(in_call=in_call, app_present=bool(zoom) or app_running(), far_target=far,
                     mic_target=source, tap_ports=play_ports, fallback_target=sink,
                     streams=streams)


def _output_ports(ports, node_id):
    """Port object ids for a node's outputs, ordered by channel."""
    found = []
    for o in ports.values():
        p = _props(o)
        if _id(p.get("node.id")) == node_id and p.get("port.direction") == "out":
            found.append((_id(p.get("port.id")) or 0, o["id"]))
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
        if p.get("port.direction") == "in" and _id(p.get("node.id")) in wanted:
            found.append((_id(p.get("port.id")) or 0, o["id"]))
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
            if _id((o.get("info") or {}).get("input-port-id")) == _id(in_port):
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
