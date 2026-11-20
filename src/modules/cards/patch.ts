import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  stripTerminalSequences,
  visibleWidth,
  wrapTextWithAnsi,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Constants and types
// ---------------------------------------------------------------------------

const PATCH = Symbol.for("pi-splinter.cards.markdown-patch");
const CARD_BG = "toolSuccessBg" as const;
const COPY_LABEL = "[COPY]";
/**
 * Zero-width prefix on the rendered label: prose or inline code can end with
 * the literal `[COPY]`, and such a row would hijack the anchor search.
 */
const COPY_ANCHOR = `\u200b${COPY_LABEL}`;
/**
 * Zero-width mark on a raw block's opening fence row. Row scanning cannot find
 * that fence (`trim().startsWith("```")`) because Pi prefixes rows inside a
 * blockquote with its border, so the scan would run on and anchor the block to
 * a later block's fence.
 */
const RAW_ANCHOR = "\u2060";
/**
 * Fixed sample the startup self-check renders through the patched Markdown to
 * confirm Pi's renderer still has the shape the patch assumes.
 */
const SELF_CHECK_SAMPLE = "```ts\nconst alpha = 1;\nconst beta = alpha + 2;\n```";
/** Terminal width used by the self-check; wide enough to avoid wrapping. */
const SELF_CHECK_WIDTH = 60;

/** Left/right padding inside a code card, in terminal columns. */
const CARD_PAD = "  ";

type CodeToken = {
  type?: string;
  lang?: string;
  text?: string;
};

type CodeBlock = {
  source: string;
  /** Line count produced for the card presentation. */
  cardLines?: number;
  /** Line count produced for the original fenced presentation. */
  rawLines?: number;
  raw?: boolean;
};

type BlockRange = {
  startY: number;
  endY: number;
  index: number;
};

type CopyHit = {
  y: number;
  startX: number;
  endX: number;
  source: string;
};

type Gesture = {
  /** Copy-button source; set only when the press landed on the button. */
  source: string;
  index: number;
  /** Source of the pressed block; a streaming update renumbers blocks. */
  blockSource: string;
};

/**
 * The block a press landed on, kept so a click can refuse to act when streaming
 * renumbered the blocks under the pointer between the press and its click.
 */
type PressedBlock = {
  index: number;
  source: string;
};

type LayoutCache = {
  key: string;
  hits: CopyHit[];
  ranges: BlockRange[];
  lines: string[];
};

/**
 * `Omit` drops the private members before re-declaring them, so the
 * intersection does not collapse to `never`.
 */
type MarkdownWithPrivateRenderer = Omit<Markdown, "renderToken" | "render" | "handleMouse"> & {
  renderToken: (
    token: CodeToken,
    width: number,
    nextTokenType?: string,
    styleContext?: unknown,
  ) => string[];
  render: (width: number) => string[];
  handleMouse?: (event: TuiMouseEvent) => TuiMouseEventResult | undefined;
  invalidate: () => void;
};

type VerifyResult = { ok: boolean; reason?: string };

type PatchRecord = {
  restore: () => void;
  /** Render a fixed sample through the patch and confirm the card shape. */
  verify: () => VerifyResult;
};

const EMPTY_HITS: CopyHit[] = [];
const EMPTY_RANGES: BlockRange[] = [];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function languageFromInfo(info: unknown): string {
  return typeof info === "string" ? info.trim().split(/\s+/, 1)[0] ?? "" : "";
}

function normalizeCodeToken(token: CodeToken, language: string): CodeToken {
  // Markdown info strings can include metadata (for example, "js workflow").
  return language && token.lang !== language ? { ...token, lang: language } : token;
}

/** Pad a styled line with the card background out to `width` columns. */
function fillRow(text: string, width: number, bg: (value: string) => string): string {
  const clipped =
    visibleWidth(text) <= width ? text : (wrapTextWithAnsi(text, Math.max(1, width))[0] ?? "");
  return bg(clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped))));
}

// ---------------------------------------------------------------------------
// Markdown patch: code cards, copy button, raw-text toggle
// ---------------------------------------------------------------------------

/** Locate every code block in the rendered output and derive click targets. */
function locateBlocks(
  plainLines: readonly string[],
  blocks: readonly CodeBlock[],
  copyButtonWidth: number,
): { hits: CopyHit[]; ranges: BlockRange[] } {
  const hits: CopyHit[] = [];
  const ranges: BlockRange[] = [];
  let cursor = 0;

  for (const [index, block] of blocks.entries()) {
    let y = cursor;

    if (block.raw) {
      while (y < plainLines.length && !(plainLines[y] ?? "").includes(RAW_ANCHOR)) y++;
      if (y >= plainLines.length) continue;

      const endY = y + Math.max(1, block.rawLines ?? 1) - 1;
      ranges.push({ startY: y, endY, index });
      cursor = endY + 1;
      continue;
    }

    // The card opens with a blank padding row, then the code's first line
    // carries the right-aligned copy button. Anchor on that button row, which
    // is identified by the zero-width marker in the label.
    while (y < plainLines.length && !(plainLines[y] ?? "").includes(COPY_ANCHOR)) y++;
    if (y >= plainLines.length) continue;

    const line = plainLines[y] ?? "";
    const startX = visibleWidth(line.slice(0, line.lastIndexOf(COPY_ANCHOR)));
    const endY = y + Math.max(1, block.cardLines ?? 1) - 1;
    hits.push({ y, startX, endX: startX + copyButtonWidth, source: block.source });
    ranges.push({ startY: Math.max(cursor, y - 1), endY, index });
    cursor = endY + 1;
  }

  return { hits, ranges };
}

function buildCard(
  highlighted: readonly string[],
  cardWidth: number,
  codeIndent: string,
  bg: (value: string) => string,
  accent: (value: string) => string,
): string[] {
  const innerWidth = Math.max(1, cardWidth - CARD_PAD.length * 2);
  const buttonWidth = visibleWidth(COPY_LABEL);
  const align = (line: string): string =>
    line.startsWith(codeIndent) ? line.slice(codeIndent.length) : line;
  const firstLine = highlighted[0] === undefined ? "" : align(highlighted[0]);
  const firstLineWidth = Math.max(1, innerWidth - buttonWidth - CARD_PAD.length);
  const wrappedFirstLine = wrapTextWithAnsi(firstLine, firstLineWidth);
  const firstLineContent = wrappedFirstLine[0] ?? "";
  const gapWidth = Math.max(1, innerWidth - visibleWidth(firstLineContent) - buttonWidth);
  const card = [
    fillRow("", cardWidth, bg),
    fillRow(
      `${CARD_PAD}${firstLineContent}${" ".repeat(gapWidth)}${accent(COPY_ANCHOR)}${CARD_PAD}`,
      cardWidth,
      bg,
    ),
  ];

  for (const line of wrappedFirstLine.slice(1)) {
    card.push(fillRow(`${CARD_PAD}${line}${CARD_PAD}`, cardWidth, bg));
  }

  for (const line of highlighted.slice(1)) {
    const wrapped = wrapTextWithAnsi(align(line), innerWidth);
    for (const wrappedLine of wrapped.length > 0 ? wrapped : [""]) {
      card.push(fillRow(`${CARD_PAD}${wrappedLine}${CARD_PAD}`, cardWidth, bg));
    }
  }

  card.push(fillRow("", cardWidth, bg));
  return card;
}

export function installPatch(
  getTheme: () => ExtensionContext["ui"]["theme"],
  copyCode: (source: string) => void,
  setLatestCode: (source: string) => void,
): PatchRecord {
  const prototype = Markdown.prototype as unknown as MarkdownWithPrivateRenderer &
    Record<PropertyKey, PatchRecord | undefined>;
  prototype[PATCH]?.restore();

  const originalRenderToken = prototype.renderToken;
  const originalRender = prototype.render;
  const originalHandleMouse = prototype.handleMouse;
  const originalInvalidate = prototype.invalidate;

  const captureBlocks = new WeakMap<Markdown, CodeBlock[]>();
  /** Survives cached renders, where renderToken only fires on cold renders. */
  const knownBlocks = new WeakMap<Markdown, CodeBlock[]>();
  /**
   * Blocks toggled to raw, keyed by index and paired with their source so
   * streaming edits and byte-identical siblings stay independent.
   */
  const rawSources = new WeakMap<Markdown, Map<number, string>>();
  const gestures = new WeakMap<Markdown, Gesture>();
  /**
   * Instances whose captured release will echo a click event. Pi dispatches the
   * click itself after a captured release, and the release already acted, so
   * that echo is not a second activation.
   */
  const capturedEcho = new WeakSet<Markdown>();
  const pressedBlocks = new WeakMap<Markdown, PressedBlock>();
  const layoutCache = new WeakMap<Markdown, LayoutCache>();
  /** Palette each instance was last rendered with, to notice a switch nobody invalidated. */
  const paletteSeen = new WeakMap<Markdown, string>();

  const getText = (instance: Markdown): string =>
    (instance as unknown as { text?: string }).text ?? "";

  /**
   * User messages and thinking blocks pass a defaultTextStyle to Markdown;
   * assistant transcript text does not. Keep Pi's native rendering there.
   */
  const isPlainTextContext = (instance: Markdown): boolean =>
    !!(instance as unknown as { defaultTextStyle?: unknown }).defaultTextStyle;

  /**
   * Fingerprint of the palette the cached rows were painted with.
   *
   * `patchedInvalidate` already drops the cache whenever Pi invalidates the
   * component tree, which is what a theme switch does. This is the second lock:
   * if some path repaints without invalidating — `setText` with unchanged text,
   * a preview that swaps the theme object under the patch, a future Pi version
   * that stops calling `invalidate` — the key still changes and the stale, already
   * painted rows are not returned. Two probes are enough: the card background and
   * the accent are the only colours this patch applies.
   */
  const paletteKey = (): string => {
    const theme = getTheme();
    return `${theme.bg(CARD_BG, "")}\u0000${theme.fg("accent", "")}`;
  };

  const cacheLayout = (
    instance: Markdown,
    key: string,
    lines: string[],
    hits: CopyHit[] = EMPTY_HITS,
    ranges: BlockRange[] = EMPTY_RANGES,
  ): string[] => {
    layoutCache.set(instance, { key, hits, ranges, lines });
    return lines;
  };

  const renderWithoutCards = (instance: Markdown, width: number, key: string): string[] => {
    const lines = originalRender.call(instance, width);
    knownBlocks.delete(instance);
    return cacheLayout(instance, key, lines);
  };

  const patchedRenderToken = function (
    this: Markdown,
    token: CodeToken,
    width: number,
    nextTokenType?: string,
    styleContext?: unknown,
  ): string[] {
    if (token?.type !== "code") {
      return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
    }

    const language = languageFromInfo(token.lang);
    const capture = captureBlocks.get(this);
    const source = token.text ?? "";

    // Plain contexts (user messages, thinking) and empty tokens from stray or
    // unterminated fences keep Pi's native presentation.
    if (isPlainTextContext(this) || source.trim() === "") {
      return originalRenderToken.call(
        this,
        normalizeCodeToken(token, language),
        width,
        nextTokenType,
        styleContext,
      );
    }

    const index = capture?.length ?? -1;
    const block: CodeBlock = { source };
    capture?.push(block);

    // Toggled blocks render as the original fenced text.
    if (rawSources.get(this)?.get(index) === source) {
      const rawRendered = originalRenderToken.call(this, token, width, nextTokenType, styleContext);
      block.raw = true;
      // Pi re-wraps every token row at this width after renderToken returns, so
      // counting rawRendered.length ends the click range short and the bottom
      // of the raw block stops responding.
      block.rawLines = rawRendered.reduce(
        (total, line) => total + Math.max(1, wrapTextWithAnsi(line, width).length),
        0,
      );
      if (rawRendered.length > 0) rawRendered[0] = `${rawRendered[0] ?? ""}${RAW_ANCHOR}`;
      return rawRendered;
    }

    const rendered = originalRenderToken.call(
      this,
      normalizeCodeToken(token, language),
      width,
      nextTokenType,
      styleContext,
    );

    // Scan backwards for the closing fence: code content may itself contain
    // bare fence rows, and only the last one is the one Pi appended.
    let closingFence = -1;
    for (let lineIndex = rendered.length - 1; lineIndex > 0; lineIndex--) {
      if (stripTerminalSequences(rendered[lineIndex] ?? "").trim() === "```") {
        closingFence = lineIndex;
        break;
      }
    }

    if (closingFence < 1) return rendered; // Pi's output shape changed; bail out.

    const theme = getTheme();
    const card = buildCard(
      rendered.slice(1, closingFence),
      Math.max(1, width),
      (this as unknown as { theme?: { codeBlockIndent?: string } }).theme?.codeBlockIndent ?? "  ",
      (value) => theme.bg(CARD_BG, value),
      (value) => theme.fg("accent", value),
    );
    if (nextTokenType && nextTokenType !== "space") card.push("");
    // `card` starts with a blank padding row; the click anchor is the next row.
    block.cardLines = Math.max(1, card.length - 1);
    return card;
  };

  const patchedRender = function (this: Markdown, width: number): string[] {
    const text = getText(this);
    const palette = paletteKey();
    // Pi memoises its own rows by text and width only, so a palette change that
    // arrives without an invalidate (same-text setText, a preview that swaps the
    // theme object) would come back from Pi's cache still painted with the old
    // theme. Drop Pi's cache for this instance when the palette moved; Pi clears
    // it for the same reason, just only on its own invalidate path.
    if (paletteSeen.get(this) !== undefined && paletteSeen.get(this) !== palette) {
      originalInvalidate.call(this);
    }
    paletteSeen.set(this, palette);
    const key = `${width}\u0000${text}\u0000${palette}`;
    const cached = layoutCache.get(this);
    if (cached?.key === key) return cached.lines;

    // Plain contexts (user messages, thinking) keep native rendering.
    if (isPlainTextContext(this)) return renderWithoutCards(this, width, key);

    const currentBlocks: CodeBlock[] = [];
    captureBlocks.set(this, currentBlocks);
    let lines: string[];
    try {
      lines = originalRender.call(this, width);
    } finally {
      captureBlocks.delete(this);
    }

    // A message with no code tokens needs no per-render bookkeeping. Never key
    // this on the source text: an indented code block has no ``` but is still
    // rendered as a card.
    if (currentBlocks.length > 0) {
      knownBlocks.set(this, currentBlocks);
    } else if (!lines.some((line) => line.includes(COPY_ANCHOR) || line.includes(RAW_ANCHOR))) {
      knownBlocks.delete(this);
    }

    const blocks = knownBlocks.get(this) ?? [];
    if (blocks.length === 0) return cacheLayout(this, key, lines);

    const plainLines = lines.map((line) => stripTerminalSequences(line));
    const { hits, ranges } = locateBlocks(plainLines, blocks, visibleWidth(COPY_LABEL));

    const last = blocks[blocks.length - 1];
    if (last) setLatestCode(last.source);
    return cacheLayout(this, key, lines, hits, ranges);
  };

  const toggleRawBlock = (instance: Markdown, index: number): boolean => {
    const block = knownBlocks.get(instance)?.[index];
    if (!block) return false;

    const toggled = rawSources.get(instance) ?? new Map<number, string>();
    if (toggled.get(index) === block.source) toggled.delete(index);
    else toggled.set(index, block.source);
    rawSources.set(instance, toggled);
    layoutCache.delete(instance);
    instance.invalidate();
    return true;
  };

  const patchedHandleMouse = function (
    this: Markdown,
    event: TuiMouseEvent,
  ): TuiMouseEventResult | undefined {
    if (event.button !== "left") {
      return originalHandleMouse?.call(this, event);
    }

    const layout = layoutCache.get(this);
    const rangeAt = (y: number): BlockRange | undefined =>
      layout?.ranges.find((item) => y >= item.startY && y <= item.endY);
    const hitAt = (x: number, y: number): CopyHit | undefined =>
      layout?.hits.find((item) => item.y === y && x >= item.startX && x < item.endX);

    if (event.type === "press") {
      capturedEcho.delete(this);
      const range = rangeAt(event.y);
      const block = range ? knownBlocks.get(this)?.[range.index] : undefined;
      // Remember what was pressed so the click below can refuse to act on a
      // block that streaming renumbered, but do not capture the press itself:
      // Pi can only start a text selection from a press it handles.
      if (range && block) pressedBlocks.set(this, { index: range.index, source: block.source });
      else pressedBlocks.delete(this);

      const hit = hitAt(event.x, event.y);
      if (!range || !block || !hit) {
        gestures.delete(this);
        return originalHandleMouse?.call(this, event);
      }

      // The copy button is the one target that owns its press: keeping it means
      // the click Pi dispatches afterwards cannot also start a selection under
      // the button, and a release outside it cancels the copy.
      gestures.set(this, { source: hit.source, index: range.index, blockSource: block.source });
      return { handled: true, capture: true };
    }

    // Folding is driven by Pi's click, which is dispatched only when press and
    // release land on the same cell. Dragging therefore selects text instead of
    // folding, and a press Pi kept for selection still folds on a plain click.
    if (event.type === "click") {
      if (capturedEcho.delete(this)) return originalHandleMouse?.call(this, event);
      // Pi counts multi-clicks here too, and those select a word or a line.
      // Folding the block on the second click would throw that selection away.
      if ((event.clickCount ?? 1) > 1) return originalHandleMouse?.call(this, event);
      if (hitAt(event.x, event.y)) return originalHandleMouse?.call(this, event);

      const range = rangeAt(event.y);
      const block = range ? knownBlocks.get(this)?.[range.index] : undefined;
      const pressed = pressedBlocks.get(this);
      pressedBlocks.delete(this);
      if (
        !range ||
        !block ||
        !pressed ||
        pressed.index !== range.index ||
        pressed.source !== block.source
      ) {
        return originalHandleMouse?.call(this, event);
      }
      if (toggleRawBlock(this, range.index)) return { handled: true, render: true };
      return originalHandleMouse?.call(this, event);
    }

    const gesture = gestures.get(this);
    if (!gesture) return originalHandleMouse?.call(this, event);

    // The pressed target captured the press, so Pi is not selecting: swallow the
    // motion and stop it from triggering a repaint on every cell.
    if (event.type === "drag" || event.type === "move") {
      return { handled: true, render: false };
    }

    if (event.type === "release") {
      gestures.delete(this);
      const range = rangeAt(event.y);
      const block = range ? knownBlocks.get(this)?.[range.index] : undefined;
      const hit = hitAt(event.x, event.y);
      // A release that left the button cancels the copy; a changed source means
      // a streaming update renumbered the blocks under the pointer.
      if (
        !range ||
        range.index !== gesture.index ||
        block?.source !== gesture.blockSource ||
        !hit ||
        hit.source !== gesture.source
      ) {
        return { handled: true };
      }

      capturedEcho.add(this);
      copyCode(gesture.source);
      return { handled: true };
    }

    return { handled: true };
  };

  prototype.renderToken = patchedRenderToken;
  prototype.render = patchedRender;
  prototype.handleMouse = patchedHandleMouse;

  /**
   * Drop the cached rows whenever the component is invalidated.
   *
   * The rows kept in `layoutCache` are already painted, so they belong to the
   * theme that was active when they were rendered. Pi invalidates the component
   * tree when the theme changes or is previewed (`Markdown.invalidate()` clears
   * its own cache for exactly that reason), and without this the cached rows
   * would be returned unchanged and the cards would keep the old colours after
   * a light/dark switch.
   */
  const patchedInvalidate = function (this: Markdown): void {
    layoutCache.delete(this);
    originalInvalidate.call(this);
  };
  prototype.invalidate = patchedInvalidate;

  /**
   * Render a fixed code-only sample through the patched class and assert the
   * three invariants the patch relies on: the hit mapping finds exactly one
   * button, the copy anchor survives into the rendered rows, and no fence row
   * leaks into the output. Runs on its own Markdown instance, so it touches no
   * transcript state.
   */
  const verify = (): VerifyResult => {
    try {
      // Also proves the theme getter resolves; a missing context fails here.
      getTheme();
      const markdownTheme = {
        codeBlock: (value: string) => value,
        codeBlockBorder: (value: string) => value,
        codeBlockIndent: "  ",
      } as unknown as ConstructorParameters<typeof Markdown>[3];
      const instance = new Markdown(SELF_CHECK_SAMPLE, 0, 0, markdownTheme);
      const rendered = instance.render(SELF_CHECK_WIDTH);
      const layout = layoutCache.get(instance);
      const plain = rendered.map((line) => stripTerminalSequences(line));
      if (!layout || layout.hits.length !== 1) {
        return { ok: false, reason: "copy button was not located" };
      }
      if (!plain.some((line) => line.includes(COPY_ANCHOR))) {
        return { ok: false, reason: "copy anchor missing from rendered card" };
      }
      if (plain.some((line) => line.trimStart().startsWith("```"))) {
        return { ok: false, reason: "fence rows survived card rendering" };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };

  const record: PatchRecord = {
    verify,
    restore() {
      if (prototype.renderToken === patchedRenderToken) prototype.renderToken = originalRenderToken;
      if (prototype.render === patchedRender) prototype.render = originalRender;
      if (prototype.handleMouse === patchedHandleMouse) {
        if (originalHandleMouse) prototype.handleMouse = originalHandleMouse;
        else delete prototype.handleMouse;
      }
      if (prototype.invalidate === patchedInvalidate) prototype.invalidate = originalInvalidate;
      if (prototype[PATCH] === record) delete prototype[PATCH];
    },
  };
  prototype[PATCH] = record;
  return record;
}

