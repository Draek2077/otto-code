"""System tray indicator. The app has no window; this is its whole UI."""

import os
import pathlib
import subprocess
import threading

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("AyatanaAppIndicator3", "0.1")
from gi.repository import AyatanaAppIndicator3 as AppIndicator  # noqa: E402
from gi.repository import GLib, Gtk  # noqa: E402

from . import APP_TITLE, VERSION_FULL, config, daemon as daemon_mod, paths, status  # noqa: E402

try:
    gi.require_version("Notify", "0.7")
    from gi.repository import Notify
except (ValueError, ImportError):
    Notify = None

AUTOSTART = pathlib.Path.home() / ".config/autostart/zoom-recorder.desktop"


def icon_dir():
    for candidate in (os.environ.get("ZOOM_RECORDER_ICON_DIR"),
                      pathlib.Path.home() / ".local/share/zoom-recorder/icons",
                      "/usr/share/zoom-recorder/icons",
                      pathlib.Path(__file__).resolve().parents[2] / "data/icons"):
        if candidate and pathlib.Path(candidate).is_dir():
            return str(candidate)
    return ""


class Tray:
    def __init__(self):
        paths.ensure_dirs()
        self.cfg = config.load()
        self.indicator = AppIndicator.Indicator.new_with_path(
            "zoom-recorder", status.ICONS[status.IDLE],
            AppIndicator.IndicatorCategory.APPLICATION_STATUS, icon_dir())
        self.indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        self.indicator.set_title(APP_TITLE)
        # ATTENTION swaps to this icon, so it must be set or the indicator blanks.
        self.indicator.set_attention_icon_full(status.ICONS[status.READY], "transcript ready")

        self.daemon = daemon_mod.Daemon(log=self._log, on_change=self._on_change)
        self._build_menu()
        if Notify:
            Notify.init(APP_TITLE)
        self._thread = threading.Thread(target=self.daemon.run, name="daemon", daemon=True)
        self._thread.start()

    # -- menu ------------------------------------------------------------------

    def _build_menu(self):
        menu = Gtk.Menu()

        self.status_item = Gtk.MenuItem(label="Starting...")
        self.status_item.set_sensitive(False)
        menu.append(self.status_item)
        menu.append(Gtk.SeparatorMenuItem())

        open_last = Gtk.MenuItem(label="Open latest transcript")
        open_last.connect("activate", self._on_open_last)
        menu.append(open_last)

        open_dir = Gtk.MenuItem(label="Open recordings folder")
        open_dir.connect("activate", self._on_open_dir)
        menu.append(open_dir)
        menu.append(Gtk.SeparatorMenuItem())

        self.autostart_item = Gtk.CheckMenuItem(label="Start on login")
        self.autostart_item.set_active(AUTOSTART.exists())
        self.autostart_item.connect("toggled", self._on_autostart)
        menu.append(self.autostart_item)

        about = Gtk.MenuItem(label=f"{APP_TITLE} {VERSION_FULL}")
        about.set_sensitive(False)
        menu.append(about)

        quit_item = Gtk.MenuItem(label="Quit")
        quit_item.connect("activate", self._on_quit)
        menu.append(quit_item)

        menu.show_all()
        self.menu = menu
        self.indicator.set_menu(menu)

    # -- daemon callbacks ------------------------------------------------------

    def _log(self, msg):
        print(msg, flush=True)

    def _on_change(self, state, detail):
        GLib.idle_add(self._apply, state, detail)

    def _apply(self, state, detail):
        self.indicator.set_icon_full(status.ICONS.get(state, status.ICONS[status.IDLE]), state)
        label = status.LABELS.get(state, state)
        self.status_item.set_label(f"{label} ({detail})" if detail else label)
        self.indicator.set_title(f"{APP_TITLE}: {label}")
        # Draw attention to a finished transcript without opening anything.
        self.indicator.set_status(AppIndicator.IndicatorStatus.ATTENTION
                                  if state == status.READY
                                  else AppIndicator.IndicatorStatus.ACTIVE)
        if self.daemon.notify_ready:
            self.daemon.notify_ready = False
            self._notify("Transcript ready", "Open it from the tray menu.")
        return False

    def _notify(self, title, body):
        if Notify and self.cfg.get("notify", True):
            try:
                Notify.Notification.new(title, body, "zoom-recorder-idle").show()
            except Exception:
                pass

    # -- menu handlers ---------------------------------------------------------

    def _on_open_last(self, _item):
        target = self.daemon.unread or self.daemon.last_transcript
        if not target or not pathlib.Path(target).exists():
            from . import recorder
            latest = recorder.latest_session()
            target = latest / "transcript.md" if latest else None
        if target and pathlib.Path(target).exists():
            subprocess.Popen(["xdg-open", str(target)])
            self.daemon.mark_viewed()   # icon returns to idle now it has been read
        else:
            self._notify(APP_TITLE, "No transcript yet")

    def _on_open_dir(self, _item):
        subprocess.Popen(["xdg-open", str(paths.RECORDINGS)])

    def _on_autostart(self, item):
        if item.get_active():
            AUTOSTART.parent.mkdir(parents=True, exist_ok=True)
            AUTOSTART.write_text(
                "[Desktop Entry]\n"
                "Type=Application\n"
                f"Name={APP_TITLE}\n"
                "Exec=zoom-recorder tray\n"
                "Icon=zoom-recorder-idle\n"
                "Terminal=false\n"
                "X-GNOME-Autostart-enabled=true\n")
        elif AUTOSTART.exists():
            AUTOSTART.unlink()

    def _on_quit(self, _item):
        self.status_item.set_label("Stopping, finishing current work...")
        self.menu.set_sensitive(False)
        self.daemon.stop()

        def wait():
            self._thread.join(timeout=180)
            GLib.idle_add(Gtk.main_quit)

        threading.Thread(target=wait, daemon=True).start()


def main():
    Tray()
    try:
        Gtk.main()
    except KeyboardInterrupt:
        pass
    return 0
