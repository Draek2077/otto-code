"""Transcribe a finished recording into a speaker-labelled transcript."""

import json
import os
import time
import wave

from . import config, engine, postprocess, recorder


def hhmmss(t):
    t = int(t)
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def wav_seconds(path):
    try:
        with wave.open(str(path)) as w:
            return w.getnframes() / w.getframerate()
    except Exception:
        return 0.0


def group_turns(segments, gap):
    """Merge consecutive segments from one speaker so pauses do not fragment a turn."""
    turns = []
    for start, end, track, text in segments:
        if turns and turns[-1][2] == track and start - turns[-1][1] < gap:
            turns[-1][1] = end
            turns[-1][3] += " " + text
        else:
            turns.append([start, end, track, text])
    return turns


def render(turns, labels, started):
    lines = [f"# Meeting transcript {started}", ""]
    for start, _end, track, text in turns:
        lines.append(f"`{hhmmss(start)}` **{labels.get(track, track)}:** {text}")
        lines.append("")
    return "\n".join(lines) + "\n"


def transcribe_session(directory, log=print, progress=None):
    cfg = config.load()
    labels = {"me": cfg["label_me"], "them": cfg["label_them"]}
    manifest = recorder.read_manifest(directory)
    parts = [p for p in manifest["parts"] if p.get("bytes", 0) > 1024]
    if not parts:
        log("nothing to transcribe")
        return None

    audio_total = sum(wav_seconds(directory / p["file"]) for p in parts)
    log(f"{len(parts)} part(s), {audio_total / 60:.1f} min of audio")

    t0 = time.time()
    asr = engine.load_segmenting_asr(cfg["model"], cfg)
    log(f"model loaded in {time.time() - t0:.1f}s "
        f"({engine.thread_limit(cfg)} of {os.cpu_count()} cores)")

    segments = []
    t0 = time.time()
    for i, p in enumerate(parts, 1):
        if progress:
            progress(i, len(parts))
        n = 0
        for seg in asr.recognize(str(directory / p["file"])):
            text = postprocess.clean((seg.text or "").strip(), cfg)
            if not text:
                continue
            segments.append((p["offset"] + seg.start, p["offset"] + seg.end, p["track"], text))
            n += 1
        log(f"{p['file']}: {n} segment(s)")

    elapsed = time.time() - t0
    segments.sort(key=lambda s: s[0])
    turns = group_turns(segments, cfg["group_gap_seconds"])
    # Re-clean the joined text: rules needing sentence context cannot see across a
    # segment boundary, so "... Suntory" + "And hero" only reads as one sentence here.
    for turn in turns:
        turn[3] = postprocess.clean(turn[3], cfg)

    transcript = directory / "transcript.md"
    transcript.write_text(render(turns, labels, manifest["started"]))
    (directory / "segments.json").write_text(json.dumps(
        [{"start": round(s, 2), "end": round(e, 2), "speaker": labels.get(t, t), "text": x}
         for s, e, t, x in segments], indent=2))

    rate = audio_total / elapsed if elapsed else 0
    log(f"{len(segments)} segments in {elapsed:.1f}s ({rate:.0f}x realtime)")
    log(f"wrote {transcript}")

    if cfg.get("delete_audio_after_transcribe", True):
        engine.delete_audio(directory, manifest, log)
        recorder.write_manifest(directory, manifest)
    return transcript
