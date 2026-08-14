"""Tray-based progress for first-run setup.

Runs under the system interpreter, before the venv exists, so it must stay free of
any ML imports. Hands over to the real tray once setup finishes.
"""

import os
import threading
import time

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("AyatanaAppIndicator3", "0.1")
from gi.repository import AyatanaAppIndicator3 as AppIndicator  # noqa: E402
from gi.repository import GLib, Gtk  # noqa: E402

from . import APP_TITLE, bootstrap, paths, status  # noqa: E402

# Parakeet fp32 plus the Silero VAD. Only used to render a percentage, so an
# approximation is fine; the bar is capped until setup actually reports success.
EXPECTED_MODEL_BYTES = 2_500_000_000


def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.stat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total


def human(n):
    return f"{n / 1e9:.2f} GB" if n >= 1e9 else f"{n / 1e6:.0f} MB"


def is_download_phase(msg):
    """True once a log line says the long model download has begun."""
    lowered = msg.lower()
    if "models ready" in lowered:
        return False
    return "downloading speech recognition model" in lowered or "fetching models" in lowered


def progress_label(phase, downloading, models_dir):
    """The text shown in the tray during setup."""
    if not downloading:
        return phase
    got = dir_size(models_dir)
    pct = min(99, int(100 * got / EXPECTED_MODEL_BYTES))
    return f"Downloading model {pct}% ({human(got)} of ~2.5 GB)"

try:
    gi.require_version("Notify", "0.7")
    from gi.repository import Notify
except (ValueError, ImportError):
    Notify = None


class SetupTray:
    def __init__(self):
        paths.ensure_dirs()
        from .tray import icon_dir
        self.log_file = open(paths.LOGS / "setup.log", "a")
        self.indicator = AppIndicator.Indicator.new_with_path(
            "zoom-recorder-setup", status.ICONS[status.SETUP],
            AppIndicator.IndicatorCategory.APPLICATION_STATUS, icon_dir())
        self.indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        self.indicator.set_title(f"{APP_TITLE}: first-run setup")

        menu = Gtk.Menu()
        self.status_item = Gtk.MenuItem(label="Preparing...")
        self.status_item.set_sensitive(False)
        menu.append(self.status_item)
        quit_item = Gtk.MenuItem(label="Cancel")
        quit_item.connect("activate", lambda *_: Gtk.main_quit())
        menu.append(quit_item)
        menu.show_all()
        self.indicator.set_menu(menu)

        if Notify:
            Notify.init(APP_TITLE)
        self._notify("Setting up", "Downloading the speech model, this happens once.")

        self._phase = "Preparing..."
        self._downloading = False
        self._done = threading.Event()
        threading.Thread(target=self._work, daemon=True).start()
        threading.Thread(target=self._track_progress, daemon=True).start()

    # -- progress ---------------------------------------------------------------

    def _render(self):
        """Compose the menu label from the current phase plus download progress."""
        text = progress_label(self._phase, self._downloading, paths.MODELS)
        self.status_item.set_label(text[:70])
        self.indicator.set_title(f"{APP_TITLE}: {text}")
        return False

    def _track_progress(self):
        while not self._done.is_set():
            GLib.idle_add(self._render)
            time.sleep(2)

    def _notify(self, title, body):
        if Notify:
            try:
                Notify.Notification.new(title, body, "zoom-recorder-idle").show()
            except Exception:
                pass

    def _log(self, msg):
        self.log_file.write(msg + "\n")
        self.log_file.flush()
        # The model download is the long phase, so switch to byte progress for it.
        if is_download_phase(msg):
            self._downloading = True
        elif "models ready" in msg.lower():
            self._downloading = False
        self._phase = msg
        GLib.idle_add(self._render)

    def _work(self):
        rc = bootstrap.run(log=self._log)
        self._done.set()
        GLib.idle_add(self._finish, rc)

    def _finish(self, rc):
        if rc == 0:
            self._notify(APP_TITLE, "Ready. Watching for Zoom calls.")
            Gtk.main_quit()
            # Restart into the real tray, which now has the ML stack available.
            os.execvp("zoom-recorder", ["zoom-recorder", "tray"])
        else:
            self._notify("Setup failed", f"See {paths.LOGS / 'setup.log'}")
            self.status_item.set_label("Setup failed, see logs")
        return False


def main():
    SetupTray()
    Gtk.main()
    return 0
