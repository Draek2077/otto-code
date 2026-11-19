"""User configuration, stored as TOML in ~/.zoom-recorder/config.toml."""

import re
import tomllib

from . import paths

DEFAULTS = {
    "label_me": "Me",
    "label_them": "Others",
    "model": "nemo-parakeet-tdt-0.6b-v2",
    "stop_grace_seconds": 20.0,   # silence tolerated before a call counts as over
    "group_gap_seconds": 2.0,     # merge same-speaker segments closer than this
    "notify": True,

    "delete_audio_after_transcribe": True,  # the transcript is the artefact, not the WAVs
    "transcribe_threads": 0,      # 0 = a quarter of the cores, so the desktop stays usable
    "transcribe_nice": 10,        # renice background transcription

    "fix_acronyms": True,         # "P D P s" -> "PDPs"
    "fix_midsentence_caps": True, # "Suntori And hero" -> "Suntori and hero"
    "remove_fillers": True,
    "fillers": ["um", "umm", "uh", "uhh", "erm", "er"],
    "fix_terms": True,
    # Domain words a general model mishears. Extend this freely, it is just a table.
    "terms": {
        "balvanese": "Balvenie",
        "balvenese": "Balvenie",
        "gleecus": "Glenfarclas",
        "glenfarclass": "Glenfarclas",
        "suntori": "Suntory",
        "click house": "ClickHouse",
        "clickhouse": "ClickHouse",
        "milburn": "Millburn",
        "dalmoor": "Dalmore",
        "aberlore": "Aberlour",
        "cardu": "Cardhu",
        "rasay": "Raasay",
    },
}


def load():
    cfg = dict(DEFAULTS)
    if paths.CONFIG_FILE.exists():
        try:
            cfg.update(tomllib.loads(paths.CONFIG_FILE.read_text()))
        except Exception:
            pass
    return cfg


def _fmt(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return "[%s]" % ", ".join(_fmt(x) for x in v)
    return '"%s"' % str(v).replace('"', '\\"')


def _quote_key(k):
    return k if re.fullmatch(r"[A-Za-z0-9_-]+", k) else '"%s"' % k


def save(cfg):
    paths.ROOT.mkdir(parents=True, exist_ok=True)
    scalars = {k: v for k, v in cfg.items() if not isinstance(v, dict)}
    tables = {k: v for k, v in cfg.items() if isinstance(v, dict)}
    lines = ["# Zoom Recorder configuration", ""]
    lines += [f"{k} = {_fmt(scalars[k])}" for k in sorted(scalars)]
    for name in sorted(tables):
        lines += ["", f"[{name}]"]
        lines += [f"{_quote_key(k)} = {_fmt(v)}" for k, v in sorted(tables[name].items())]
    paths.CONFIG_FILE.write_text("\n".join(lines) + "\n")


def set_value(key, value):
    cfg = load()
    if key not in DEFAULTS:
        raise KeyError(key)
    default = DEFAULTS[key]
    if isinstance(default, (dict, list)):
        raise ValueError(f"edit '{key}' directly in {paths.CONFIG_FILE}")
    if isinstance(default, bool):
        value = str(value).lower() in ("1", "true", "yes", "on")
    elif isinstance(default, float):
        value = float(value)
    elif isinstance(default, int):
        value = int(value)
    cfg[key] = value
    save(cfg)
    return cfg
