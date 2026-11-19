"""Log how Zoom's audio nodes change over time.

Useful for confirming what a real call looks like on this machine: joining, muting,
switching headset, and leaving all show up here.
"""

import time
from datetime import datetime

from . import backend


def run(seconds=0, interval=0.5, log=print):
    log(f"{'time':8}  {'proc':5} {'call':5} {'streams':44} sink / source")
    log("-" * 110)
    start = time.monotonic()
    previous = None
    while True:
        try:
            ep = backend.detect()
        except Exception as e:
            log(f"pw-dump failed: {e}")
            time.sleep(interval)
            continue

        streams = ", ".join(f"{k}={v}" for k, v in sorted(ep.streams.items()) if k) or "-"
        snapshot = (ep.app_present, ep.in_call, streams, ep.sink, ep.source)
        if snapshot != previous:
            log(f"{datetime.now():%H:%M:%S}  "
                f"{'yes' if ep.app_present else 'no':5} "
                f"{'YES' if ep.in_call else 'no':5} "
                f"{streams:44} {ep.sink or '-'} / {ep.source or '-'}")
            previous = snapshot

        if seconds and time.monotonic() - start > seconds:
            log("done")
            return 0
        time.sleep(interval)
