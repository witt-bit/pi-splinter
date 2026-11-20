# Can text selection be handed to the terminal instead of Pi?

Short answer: yes, and in Ghostty it already is — hold Shift while dragging. If you
want plain drags (no modifier) to be native, either the terminal stops reporting
mouse events or Pi does; there is no third state. Per-card handoff is not possible,
because the handoff itself has to be driven by mouse events that no longer arrive.

This page records what Pi does with the mouse and which knobs exist, so the choice
is made once instead of re-derived.

## What Pi does with the mouse

The mouse lives entirely in the fullscreen renderer, `TuiAltScreen`
(`@earendil-works/pi-tui/dist/tui-alt-screen.js`):

- `beforeTerminalStart()` turns on mouse reporting on every entry to the alternate
  screen: `1000h` (press/release), `1002h` (button-motion), `1004h` (focus), `1006h`
  (SGR coordinates), plus `1003h` (all motion) when the terminal is not a
  multiplexer. A multiplexer (`TMUX`/`ZELLIJ`/`STY`, or `TERM` starting with
  `tmux`/`screen`) gets button-motion only.
- `mouseEnabled` is a field, `options.mouse ?? true`. Pi's own
  `createInteractiveTui` never passes `options.mouse`, so it is always `true`, and
  there is no setting or CLI flag that changes it.
- The enable sequence is written only at alternate-screen entry. `beforeTerminalStop()`
  and `getExitRestorePrefix()` write the matching `1000l/1002l/1003l/1004l/1006l`
  while Pi is away from the screen (external editor, `!command`), and re-entry
  re-enables reporting.
- `handleMouseEvent()` gives the press to the layout first. When a component returns
  a result, Pi records it as the press target and returns — a component that claims
  the press takes text selection away from Pi. This is why the card module leaves the
  press to Pi; see [modules/cards.md](./modules/cards.md#interaction).
- Modifiers are parsed into the event (`shift`, `alt`, `ctrl` from the SGR button
  bits) but never read: no Pi behaviour branches on them, so a modifier cannot
  currently mean "hands off".

The regular renderer, `TuiMainScreen`, contains no mouse code at all (`grep -ci mouse`
returns 0). In `tuiMode: "regular"` Pi never asks the terminal for mouse events, so
the terminal always owns selection — and cards lose every mouse interaction.

## Route 1 — a modifier (no code, works today)

Terminals keep native selection alive behind a bypass modifier even while an
application has mouse reporting on. Ghostty's default is
`mouse-shift-capture = false`, documented as: shift is not sent with the mouse
protocol and extends the selection. So in a card, or anywhere else:

- Shift+drag = terminal selection, Pi sees nothing, nothing folds
- Shift+click goes to the terminal as well

Two Ghostty settings make this path feel finished:

```ini
# ~/.config/ghostty/config
copy-on-select = clipboard      # default is none on macOS: selection alone copies nothing
# mouse-shift-capture = never   # optional: stop the application from overriding shift
```

`clipboard-trim-trailing-spaces = true` is already the default, so card padding and
the `[COPY]` label are trimmed from what you copy, but leading indentation is kept.

If Shift+drag ever folds a card instead of selecting, the application is receiving
the shift bits; set `mouse-shift-capture = never` to take that decision back.

## Route 2 — turn reporting off from the terminal

Ghostty exposes `toggle_mouse_reporting` (present in 1.4.x). Bind it and the whole
terminal stops sending mouse events, in Pi and everywhere else:

```ini
keybind = cmd+shift+m=toggle_mouse_reporting
```

While it is off, Pi's wheel scrolling, click-to-fold, `[COPY]`, and Pi's own
selection are inert — that is the trade. Pi re-requests reporting the next time it
enters the alternate screen (`!command`, external editor), so the toggle may need
pressing again.

## Route 3 — turn reporting off from Pi

Pi has no supported switch, but the protocol is public: writing the DECRST sequence
is enough, and it survives until Pi re-enters the alternate screen.

```ts
process.stdout.write("\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
```

Optionally set the renderer's own flag so re-entry respects the choice. The raw TUI
is reachable from `ctx.ui.custom((tui) => ...)`, which receives the `TuiAltScreen`
instance, where `tui.mouseEnabled = false` is honoured by the next
`beforeTerminalStart()`.

Cost, if this ships as a splinter module: a keybinding module of roughly 30 lines and
a documented trade — while native selection is on, no card interaction exists. Its
only advantage over Route 1 is working without a modifier and inside multiplexers,
which is worth having only if Shift+drag turns out to be unusable.

## What cannot be built

- **Handoff only over code cards.** Deciding "this drag belongs to the terminal" would
  have to happen on press, and the visibility needed to hand it back (hover exit) is
  exactly what reporting-off removes. A hover-based version deadlocks: Pi stops seeing
  the pointer the moment it hands over, so it cannot know when to take it back.
- **Starting a terminal selection programmatically.** Applications can write the
  clipboard (OSC 52) but cannot create or extend a terminal's own selection. "Native"
  means the terminal saw the drag; nothing else produces that highlight.
- **Keeping the wheel and giving away drags.** One mouse report covers press, motion,
  and wheel alike. There is no protocol level at which the wheel stays with Pi and
  the drag goes to the terminal.
