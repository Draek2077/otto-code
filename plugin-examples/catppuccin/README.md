# Catppuccin plugin example

This example adds **Catppuccin Mocha** to Settings → Appearance. Otto ships Catppuccin as a
syntax-highlight theme; this contributes it as an app theme.

A theme is data, so the whole plugin is one `addTheme` call in `index.ts` — no client file, no RPC.

Register it in `$OTTO_HOME/config.json`:

```json
{
  "pluginsEnabled": true,
  "plugins": {
    "catppuccin": {
      "source": "directory",
      "path": "/absolute/path/to/otto/plugin-examples/catppuccin"
    }
  }
}
```

Then run `otto reload` and pick **Catppuccin Mocha** in Settings → Appearance.

The colors come straight from the [Catppuccin Mocha](https://catppuccin.com/palette/) palette:
`base`, `text`, `surface0`, `surface1`, `mauve`, `subtext0`, and `overlay0`. Otto expands them
into the full token set, so `accent` (`mauve`) drives buttons and selection while `border`
(`surface1`, shared with `control`) stays the border and raised-surface tint.
