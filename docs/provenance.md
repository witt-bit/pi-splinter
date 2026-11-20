# Provenance

## What this repository is

A new repository with its own remote, not a GitHub fork, and with upstream's
history kept intact. The base is [chengyayu/pi-code-render](https://github.com/chengyayu/pi-code-render)
up to `f373aad Release 0.1.10`, followed by a merge of the two fixes that were
opened upstream and never reviewed:

| Upstream | What it fixes | Opened |
| --- | --- | --- |
| [issue #3](https://github.com/chengyayu/pi-code-render/issues/3) / [PR #4](https://github.com/chengyayu/pi-code-render/pull/4) | Cards keep the old colors after switching light/dark mode | 2026-11-06 |
| [issue #5](https://github.com/chengyayu/pi-code-render/issues/5) / [PR #6](https://github.com/chengyayu/pi-code-render/pull/6) | Cards swallow drags: text inside a card cannot be selected | 2026-11-06 |

Both sat with no review and no comment. Upstream's last commit was 2026-10-17
(`Release 0.1.10`), so the fixes would not have shipped even if merged. This
repository carries them, plus everything else that turns out to be an annoyance.

Keeping the history is deliberate: the `cards` module is mostly someone else's
work, and the commit graph is the honest record of how much of it is upstream's
and where this repository took over. `git log f373aad..HEAD` is everything that
was added here.

## What changed after the merge

- Package identity: `pi-code-render` becomes `pi-splinter`, version reset to 0.1.0.
- The single-file extension was split into `extensions/pi-splinter.ts` (entry, fans
  out to modules), `src/core/module.ts` (the module contract), `src/modules/`
  (one directory per patch), and `src/shared/` (clipboard helper, the first shared
  piece).
- Internal names moved with the package: the patch symbol is
  `pi-splinter.cards.markdown-patch` and the footer status key is `pi-splinter`.
  The two user-facing messages now name the module (`pi-splinter cards disabled for
  this session: ...`).
- The test harness bundles the entry with esbuild instead of transpiling a single
  file, because the extension now spans directories. Pi's packages stay external so
  the harness and the patch share one `Markdown.prototype`.
- Upstream's outreach notes and its draft proposal to Pi core are kept for the
  record under `docs/inherited/`; they are not part of the shipped package.

## What deliberately stayed the same

The card behavior, the interaction contract, and the startup self-check. This import
is meant to preserve upstream's working code, not rewrite it: the logic moved
between files without semantic change, which the render tests verify.
