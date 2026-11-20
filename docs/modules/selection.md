# selection

Drops the mouse selection as soon as its copy lands.

## What it changes

Pi's fullscreen TUI copies a drag selection on release (`fullscreenCopyOnSelect`,
on by default) but keeps the selection afterwards: `selectionAnchor` and
`selectionFocus` survive, so the highlight stays painted until the next click.
Visually that reads as a stuck caret — the highlighted rows cover the spot the
input cursor sits in, and the only way to get a clean screen back is to click
somewhere else.

This module clears that state right after a *successful* copy and requests one
repaint, so the transcript returns to how it looked before the drag.

- Copy succeeds: selection cleared, one extra repaint, `Copied!` still flashes.
- Copy fails or is unavailable: selection is kept, so the text is still there to
  retry.
- Nothing is cleared on a plain press or a click that a component handled; those
  keep Pi's own behaviour.

Both copy entry points are covered, because Pi copies the active selection from
two places: the copy-on-select release path, and the explicit copy keybinding that
falls back to the selection when `fullscreenCopyOnSelect` is off.

## Where it hooks

`TuiAltScreen.prototype`, the fullscreen renderer:

| Method | Wrapped to |
| --- | --- |
| `copySelectionToClipboard()` | clear the selection after a `true` result |
| `copyActiveSelectionToClipboard()` | same |

Both are public in `tui-alt-screen.d.ts`; `clearTextSelection()` (which also stops
selection auto-scroll and resets the multi-click history) and `requestRender()` are
public too. The extra `requestRender()` is not redundant: the clear happens in a
microtask after the clipboard write resolves, which is already after Pi queued the
release frame, so without it the old highlight stays painted until something else
repaints.

The startup self-check confirms the three methods still exist and that the patch
is the installed one. If a Pi upgrade renames or drops them, the module restores
the originals and warns once, instead of silently doing nothing.

## Limits

- Fullscreen TUI only. The regular renderer has no mouse code and no selection, so
  there is nothing to release there.
- Relies on Pi's renderer methods, not on a supported extension API. The self-check
  covers the "method disappeared" case; a changed *meaning* for the same name would
  not be caught, so the tests in `test/selection.test.mjs` drive a real
  `TuiAltScreen` through press/drag/release.
- Re-copying the same text with the copy keybinding no longer works: the selection
  is already gone. Select again, or use the `cards` module's `[COPY]` button for
  code blocks.
