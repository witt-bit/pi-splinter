# pi-splinter

Small quality-of-life patches for the [Pi coding agent](https://pi.dev/) TUI — the
ones that were reported upstream and never got to.

One package, one module per annoyance. Each module owns a directory, a docs page,
and its own wiring, so a patch can be added or dropped without touching the rest.

![code cards](https://raw.githubusercontent.com/witt-bit/pi-splinter/main/docs/card.png)

## Modules

| Module | Fixes | Docs |
| --- | --- | --- |
| `cards` | Flush-edge code cards in the assistant transcript, with a `[COPY]` button, a click-to-toggle raw view, mouse text selection inside a card, and repaint on light/dark switch | [docs/modules/cards.md](./docs/modules/cards.md) |

## Install

```bash
pi install npm:pi-splinter
```

Then restart Pi or run `/reload`. To try it without touching your settings:

```bash
pi -e npm:pi-splinter
```

## Usage: cards

| Action | Result |
| --- | --- |
| Click `[COPY]` | Copy that block's source to the clipboard |
| Drag inside a card | Select its text as normal text (Pi's copy-on-select copies it) |
| Click anywhere else on a card | Toggle between card and raw fenced text |
| Click a raw block's code | Toggle it back to a card |
| Drag over a raw block's code | Select it as normal text |
| `Ctrl+Alt+C` | Copy the most recently rendered code block |

The press is left to Pi so a drag selects text; only the `[COPY]` button keeps it.
Folding therefore hangs off Pi's click, which is dispatched when press and release
land on the same cell: a plain click folds the block, a drag selects its text, and
double-click still selects a word.

## Compatibility

- Requires Pi 0.99.0 or later; verified against Pi 1.5.2.
- Works in regular and fullscreen TUI modes; non-TUI modes are unaffected.
- Modules patch Pi's internal renderer, which exposes no public hook for
  transcript styling. A future Pi release may require an update here.
- **Startup self-check.** On every session start the `cards` module renders a fixed
  sample through its patch and verifies the card shape. If Pi's internals no longer
  match what the patch assumes, it restores native rendering and posts a warning
  explaining why, instead of failing silently. CI runs the test suite against the
  latest and previous-minor Pi releases.

## Known issues

- Two byte-identical code blocks in one message can be toggled as a pair: Pi's
  Markdown renderer memoizes blocks by their raw source, so the second copy never
  reaches the patch and the click resolves to the wrong block. Tracked by the two
  failing cases in `test/render.test.mjs` ("相同源码：raw 块落在两张卡片之间",
  "相同源码：raw 位移后仍能切换第三张"); they fail upstream as well.

## Adding a module

```text
src/modules/<id>/index.ts    wiring: listeners, shortcuts, teardown; exports a SplinterModule
src/modules/<id>/*.ts        the patch itself, free to use whatever seam Pi exposes
src/modules/index.ts         one line: add the module to the list
docs/modules/<id>.md         what it changes, its interaction, its limits
```

Rules that keep the package maintainable:

- One module never imports another. Shared helpers go in `src/shared/`.
- Each module installs in `session_start` and fully reverts in `session_shutdown`;
  a `/reload` must not stack a second copy of a patch.
- Anything that patches Pi internals ships a startup self-check that degrades to
  native behaviour instead of breaking the transcript.
- A module that turns out to be unwanted is deleted by removing its line in
  `src/modules/index.ts`, its directory, and its docs page.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # render tests (node test/render.test.mjs)
```

## Notes

- [docs/native-selection.md](./docs/native-selection.md) — why text selection either
  belongs to Pi or to the terminal, which knobs exist (Ghostty `mouse-shift-capture`,
  `toggle_mouse_reporting`, `tuiMode: regular`), and what cannot be built.

## Provenance

The `cards` module started as [chengyayu/pi-code-render](https://github.com/chengyayu/pi-code-render)
0.1.10, plus the two fixes that were opened upstream and never reviewed
(chengyayu/pi-code-render#3 with #4, and #5 with #6). Upstream's commit history is
kept intact: everything after `f373aad` is this package's own work. See
[docs/provenance.md](./docs/provenance.md).

## License

MIT. Upstream portions copyright (c) 2026 pi-code-render contributors; see
[LICENSE](./LICENSE).
