# Module: cards

Fenced code blocks in assistant messages render as theme-colored, full-width cards
with a `[COPY]` button and a click-to-toggle raw view. Text inside a card can be
dragged over like normal text, and the cards repaint when the light/dark theme
changes.

Screenshots: [before](../before.png) / [after](../card.png).

## What it changes

| Action | Result |
| --- | --- |
| Click `[COPY]` | Copy that block's source (fences stripped) |
| Drag inside a card | Select its text; the press goes to Pi, not to the patch |
| Click anywhere else on a card | Toggle that block to the original fenced text |
| Click a raw block's code, or its opening fence row | Toggle it back to a card |
| Drag over a raw block's code | Select it as normal text |
| `Ctrl+Alt+C` | Copy the most recently rendered block |

Details that were deliberate:

- The `[COPY]` button sits at the end of the block's first line, so the code starts
  immediately, with no language-label header above it.
- The press is left to Pi except on the button, and the event bubbles up through
  the transcript containers as unhandled. That is what lets Pi start a text
  selection: dragging inside a card selects text (and copies it in fullscreen mode,
  where copy-on-select is on) instead of folding the block. Folding hangs off Pi's
  click, which is dispatched only when press and release land on the same cell.
  Double-click selects a word and never folds.
- A press records the block it landed on. If streaming renumbers blocks before the
  click arrives, the click refuses to act rather than folding its neighbour.
- Info strings like ` ```js workflow ` highlight as JavaScript; unknown languages
  keep plain-text rendering.
- Code blocks in user messages and in thinking blocks keep native rendering.

## Theme switching

Card rows are painted when they are rendered, so a repaint has to be forced when
the palette changes. Two locks, because Pi offers two ways to replace a theme:

1. `Markdown.invalidate()` is patched to drop this module's row cache, so the
   path Pi already uses — `ui.invalidate()` on a theme change or a theme preview —
   repaints the cards with the new palette.
2. The cache key carries a palette fingerprint (the card background plus the
   accent colour) and Pi's own cache is dropped when that fingerprint moves, so a
   paint that arrives without an invalidate still recolours: same-text `setText`,
   a preview that swaps the theme object underneath, or a future Pi release that
   stops invalidating on a theme change.

Both are asserted in the render tests: one case invalidates between renders, one
case deliberately does not.

## Duplicate blocks

Pi 1.5.x renders a document in one pass and memoises each block by `token.raw`:
a byte-identical second code block reuses the first one's lines and never reaches
`renderToken`. The block capture then holds fewer entries than the transcript has
cards, and every card after the duplicate is mapped to its neighbour — clicking the
card that displays block N copies block N+1's source, and the last card does
nothing.

The fix uses Pi's own escape hatch, two lines above that memo:
`reuseBlocks = Object.keys(tokens.links).length === 0`. For the duration of one
render the text is prefixed with a link definition Pi never renders, which turns
reuse off for the document; the original text is restored in a `finally`. It is
prepended rather than appended because an unterminated fence at the end of a
message would swallow an appended definition into its code token.

## Why it is a patch and not a hook

Pi's extension API can add commands, shortcuts, and overlays, but there is no
supported way to change how the assistant transcript renders markdown block-level
content. The `MarkdownTheme` surface covers colors and the code-block indent, not
structure. This module therefore replaces `Markdown.prototype.renderToken`,
`render`, `handleMouse`, and `invalidate`, and restores them on shutdown.

## Startup self-check

On every session start the module renders a fixed code sample through the patched
class and asserts three invariants: the hit mapping locates exactly one copy
button, the copy anchor survives into the rendered rows, and no fence row leaks
into the output. If any of them fails, the patch is restored and a warning names
the reason, rather than leaving every code block silently unstyled.

## Limits

- Requires Pi 0.99.0 or later; verified against Pi 1.5.2.
- TUI modes only. Non-TUI modes are untouched.
- Mouse reporting is a fullscreen feature, so regular mode never sends card clicks:
  the terminal's own selection (Shift-drag in most terminals) applies there.
- To keep selection terminal-native instead of Pi-native, see
  [../native-selection.md](../native-selection.md).
- Two byte-identical code blocks in one message can be toggled as a pair. Pi's
  Markdown renderer memoizes blocks by raw source, so the second copy never reaches
  the patch and a click resolves to the wrong index. Two cases in
  `test/render.test.mjs` cover this and currently fail; the defect predates this
  package and fails upstream too.
- A future Pi release can change the renderer shape. The self-check turns that into
  a warning and native rendering rather than a broken transcript; CI additionally
  tests the latest and previous-minor Pi releases.

## Provenance

This module is pi-code-render 0.1.10 by chengyayu, plus the two fixes that were
opened upstream and never reviewed:

- chengyayu/pi-code-render#3 (colors kept after a theme switch), fixed by PR #4
- chengyayu/pi-code-render#5 (cards swallow drags), fixed by PR #6

See [../provenance.md](../provenance.md).
