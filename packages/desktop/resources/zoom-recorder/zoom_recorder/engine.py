"""Speech recognition model loading.

CPU fp32 measured fastest on this class of hardware (~21x realtime) and leaves the
GPU free for other work, so no CUDA provider is requested.
"""

import os

from . import config, paths

PROVIDERS = ["CPUExecutionProvider"]
SAMPLE_RATE = 16000


def _prepare(threads):
    paths.ensure_dirs()
    os.environ["HF_HOME"] = str(paths.MODELS)
    # onnxruntime reads these at session creation; without them it also spawns
    # OpenMP threads across every core.
    os.environ["OMP_NUM_THREADS"] = str(threads)


def thread_limit(cfg=None):
    """How many cores transcription may use. 0 in config means a sensible fraction."""
    cfg = cfg or config.load()
    n = int(cfg.get("transcribe_threads", 0) or 0)
    if n > 0:
        return n
    return max(1, (os.cpu_count() or 4) // 4)


def _session_options(threads):
    import onnxruntime as rt
    so = rt.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    so.execution_mode = rt.ExecutionMode.ORT_SEQUENTIAL
    return so


def load_asr(model_name=None, cfg=None):
    cfg = cfg or config.load()
    threads = thread_limit(cfg)
    _prepare(threads)
    import onnx_asr
    return onnx_asr.load_model(model_name or cfg["model"], providers=PROVIDERS,
                               sess_options=_session_options(threads))


def load_vad(cfg=None):
    cfg = cfg or config.load()
    threads = thread_limit(cfg)
    _prepare(threads)
    import onnx_asr
    return onnx_asr.load_vad("silero", providers=PROVIDERS,
                             sess_options=_session_options(threads))


def load_segmenting_asr(model_name=None, cfg=None, **vad_options):
    """ASR that splits audio on speech boundaries and returns timed segments."""
    cfg = cfg or config.load()
    asr = load_asr(model_name, cfg)
    opts = {"min_silence_duration_ms": 300, "max_speech_duration_s": 20}
    opts.update(vad_options)
    return asr.with_vad(load_vad(cfg), **opts)


def lower_priority(cfg=None):
    """Renice the calling thread so transcription yields to interactive work."""
    cfg = cfg or config.load()
    n = int(cfg.get("transcribe_nice", 10) or 0)
    if n > 0 and hasattr(os, "nice"):
        try:
            os.nice(n)
        except OSError:
            pass


def download_models(model_name=None, log=print):
    """Force the model files into the local cache, used by first-run setup."""
    log("downloading speech recognition model (about 2.5 GB, once only)")
    load_asr(model_name)
    log("downloading voice activity model")
    load_vad()
    log("models ready")


def delete_audio(directory, manifest, log=print):
    """Drop the WAVs once a transcript exists; the transcript is the artefact."""
    removed = 0
    freed = 0
    for part in manifest.get("parts", []):
        f = directory / part["file"]
        if f.exists():
            freed += f.stat().st_size
            f.unlink()
            removed += 1
    manifest["audio_deleted"] = True
    if removed:
        size = f"{freed / 1e6:.1f} MB" if freed >= 1e6 else f"{freed / 1e3:.0f} KB"
        log(f"removed {removed} audio file(s), freed {size}")
    return freed
