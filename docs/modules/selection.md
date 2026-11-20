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

## Why this is not a copy-latency fix

The reported symptom was "the copy is slow: `Copied!` shows up late, and the
clipboard only has the text after that". Measurement says the copy path is not the
bottleneck, and the lingering highlight was what made it look like one: with no
visible end to the gesture, the next click becomes the moment the action feels
finished.

Numbers from a real `TuiAltScreen` driven with SGR mouse sequences on macOS:

| Step | Measured |
| --- | --- |
| release event to `copySelectionToClipboard` | 0.19 - 0.34 ms |
| release to clipboard write finished | 0.38 ms |
| release to the first painted frame (incl. `Copied!`) | 2.1 ms |
| native clipboard write (darwin prebuilt) | 0.3 ms steady, 6.1 ms first call |
| `pbcopy` fallback spawn | 10 - 15 ms |
| selection text extraction | 12 ms per 1000 rows |

So the fix that helped was releasing the selection, not speeding up the copy. If a
delay ever shows up for real, measure it rather than guessing: the render floor is
`MIN_RENDER_INTERVAL_MS = 16` per frame, and text extraction is the only part that
grows with the size of the selection.

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
