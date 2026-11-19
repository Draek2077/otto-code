"""Command line interface."""

import argparse
import contextlib
import os
import pathlib
import shutil
import signal
import sys
import time

from . import APP_TITLE, BUILT, VERSION_FULL, batch, config, daemon as daemon_mod, engine
from . import backend, paths, recorder, status


def cmd_tray(args):
    from . import tray
    return tray.main()


def cmd_watch(args):
    paths.ensure_dirs()
    lock_path = paths.ROOT / "watch.lock"
    lock_file = lock_path.open("a+b")
    lock_file.seek(0)
    if lock_file.tell() == 0:
        lock_file.write(b"0")
        lock_file.flush()
    try:
        if os.name == "nt":
            import msvcrt

            lock_file.seek(0)
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (BlockingIOError, OSError):
        print("watcher already running", file=sys.stderr)
        lock_file.close()
        return 73

    d = daemon_mod.Daemon()
    signal.signal(signal.SIGINT, lambda *_: d.stop())
    signal.signal(signal.SIGTERM, lambda *_: d.stop())
    try:
        d.run()
        return 0
    finally:
        with contextlib.suppress(Exception):
            if os.name == "nt":
                import msvcrt

                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()


def cmd_record(args):
    """Record now, ignoring Zoom detection, until interrupted."""
    paths.ensure_dirs()
    ep = backend.detect()
    sink, source = ep.far_target, ep.mic_target
    if not sink or not source:
        dsink, dsource = backend.default_targets()
        sink, source = sink or dsink, source or dsource
    if not sink and not source:
        print("no audio endpoints found", file=sys.stderr)
        return 1

    session = recorder.Session()
    session.follow(ep)

    print(f"recording to {session.dir} (Ctrl+C to stop)")
    stopping = {"now": False}
    signal.signal(signal.SIGINT, lambda *_: stopping.__setitem__("now", True))
    while not stopping["now"]:
        time.sleep(0.5)
    print("\nstopping")
    manifest = session.close()
    if recorder.has_audio(manifest):
        batch.transcribe_session(session.dir)
    return 0


def cmd_transcribe(args):
    target = pathlib.Path(args.session) if args.session else recorder.latest_session()
    if not target or not (target / "manifest.json").exists():
        print("no session found; pass a directory", file=sys.stderr)
        return 1
    print(f"session: {target}")
    return 0 if batch.transcribe_session(target) else 1


def cmd_probe(args):
    from . import probe
    return probe.run(seconds=args.seconds)


def cmd_status(args):
    s = status.read()
    live = status.running()
    print(f"state:    {s['state']}")
    print(f"detail:   {s.get('detail') or '-'}")
    print(f"session:  {s.get('session') or '-'}")
    daemon_state = "running (pid %s)" % s.get("pid") if live else "not running"
    print(f"daemon:   {daemon_state}")
    print(f"backend:  {backend.describe()}")
    return 0


def cmd_sessions(args):
    rows = sorted((d for d in paths.RECORDINGS.glob("*") if (d / "manifest.json").exists()),
                  key=lambda d: d.name)
    if not rows:
        print("no sessions yet")
        return 0
    for d in rows:
        try:
            m = recorder.read_manifest(d)
            mins = m.get("duration", 0) / 60
            done = "transcript" if (d / "transcript.md").exists() else "-"
            print(f"{d.name:22} {mins:6.1f} min  {m.get('mode', 'batch'):6} {done}")
        except Exception:
            print(f"{d.name:22} (unreadable manifest)")
    return 0


def cmd_config(args):
    if not args.key:
        for k, v in sorted(config.load().items()):
            print(f"{k} = {v}")
        return 0
    if args.value is None:
        print(config.load().get(args.key))
        return 0
    try:
        config.set_value(args.key, args.value)
    except KeyError:
        print(f"unknown key: {args.key}", file=sys.stderr)
        return 1
    print(f"{args.key} = {config.load()[args.key]}")
    return 0


def cmd_setup(args):
    from . import bootstrap
    return bootstrap.run(force=args.force)


def cmd_otto_download_models(args):
    """Download the frozen Otto helper's model cache with live status output."""
    paths.ensure_dirs()
    status.publish(status.SETUP, "downloading speech recognition model")
    try:
        engine.download_models(log=print)
    except Exception as e:
        status.publish(status.ERROR, f"model download failed: {e}")
        print(f"model download failed: {e}", file=sys.stderr)
        return 1
    paths.SETUP_STAMP.write_text("ok\n")
    status.publish(status.IDLE, "model ready")
    return 0


def cmd_purge_data(args):
    if not args.yes:
        print(f"this deletes {paths.ROOT} including recordings and transcripts")
        print("re-run with --yes to confirm")
        return 1
    if paths.ROOT.exists():
        shutil.rmtree(paths.ROOT)
        print(f"removed {paths.ROOT}")
    return 0


def build_parser():
    p = argparse.ArgumentParser(prog="zoom-recorder", description=f"{APP_TITLE}: record and transcribe Zoom calls locally")
    p.add_argument("--version", action="version", version=f"{APP_TITLE} {VERSION_FULL}" + (f" (built {BUILT})" if BUILT else ""))
    sub = p.add_subparsers(dest="command")

    sub.add_parser("tray", help="run the tray indicator (no window)").set_defaults(func=cmd_tray)
    sub.add_parser("watch", help="watch for Zoom calls headlessly").set_defaults(func=cmd_watch)
    sub.add_parser("record", help="record right now until interrupted").set_defaults(func=cmd_record)

    tr = sub.add_parser("transcribe", help="transcribe a recorded session (default: latest)")
    tr.add_argument("session", nargs="?")
    tr.set_defaults(func=cmd_transcribe)

    sub.add_parser("status", help="show what the app is doing").set_defaults(func=cmd_status)
    sub.add_parser("sessions", help="list recorded sessions").set_defaults(func=cmd_sessions)

    pr = sub.add_parser("probe", help="log Zoom audio state changes, for diagnosing detection")
    pr.add_argument("--seconds", type=int, default=0, help="stop after this long (0 = forever)")
    pr.set_defaults(func=cmd_probe)

    c = sub.add_parser("config", help="show or change settings")
    c.add_argument("key", nargs="?")
    c.add_argument("value", nargs="?")
    c.set_defaults(func=cmd_config)

    s = sub.add_parser("setup", help="prepare the local environment and models")
    s.add_argument("--force", action="store_true")
    s.set_defaults(func=cmd_setup)

    # Otto ships this helper with its Python runtime and dependencies frozen into
    # the desktop installer. This command deliberately skips the standalone
    # project's venv bootstrap and only provisions the user-owned model cache.
    sub.add_parser(
        "otto-download-models",
        help="download models for the Otto-packaged recorder helper",
    ).set_defaults(func=cmd_otto_download_models)

    pd = sub.add_parser("purge-data", help=f"delete {paths.ROOT}")
    pd.add_argument("--yes", action="store_true")
    pd.set_defaults(func=cmd_purge_data)

    return p


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        args = parser.parse_args(["tray"])   # bare invocation opens the tray
    return args.func(args)
