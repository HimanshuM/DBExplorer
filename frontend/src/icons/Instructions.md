On Ubuntu/GNOME, the reliable way is to install a `.desktop` launcher whose `StartupWMClass` matches the running Wails window. The taskbar/overview usually uses that launcher icon, not just the icon embedded in the binary.

Basic setup:

1. Put the SVG somewhere standard:

```bash
mkdir -p ~/.local/share/icons/hicolor/scalable/apps
cp frontend/src/icons/app2.svg ~/.local/share/icons/hicolor/scalable/apps/dbexplorer.svg
```

2. Create a desktop file:

```bash
mkdir -p ~/.local/share/applications
nano ~/.local/share/applications/dbexplorer.desktop
```

Use:

```ini
[Desktop Entry]
Type=Application
Name=DB Explorer
Exec=/absolute/path/to/DBExplorer
Icon=dbexplorer
Terminal=false
Categories=Development;Database;
StartupNotify=true
StartupWMClass=DBExplorer
```

3. Refresh desktop caches:

```bash
gtk-update-icon-cache ~/.local/share/icons/hicolor || true
update-desktop-database ~/.local/share/applications || true
```

4. Launch it from the app grid/launcher, not directly from terminal.

If the icon still does not group correctly, `StartupWMClass` is probably wrong. Find the actual class while the app is running:

```bash
xprop WM_CLASS
```

Then click the DB Explorer window. Use the second value from output like:

```text
WM_CLASS(STRING) = "dbexplorer", "DBExplorer"
```

Set:

```ini
StartupWMClass=DBExplorer
```

For Wayland, you may need:

```bash
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval \
  'global.display.focus_window.get_wm_class()'
```

The key pieces are `Icon=dbexplorer` and matching `StartupWMClass`.
