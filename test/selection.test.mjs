// ---------------------------------------------------------------------------
// Selection release: Pi keeps the highlight after copy-on-select, this module
// drops it. The harness drives a real TuiAltScreen with SGR mouse sequences so
// the assertions cover the release path Pi actually runs, not a reimplementation
// of it.
// ---------------------------------------------------------------------------
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));

// Same staging strategy as render.test.mjs: bundle to a temp file inside the
// repo, keep Pi external so the harness and the extension share one
// `@earendil-works/pi-tui` instance and the prototype patch applies to it.
const { outputFiles } = await build({
  entryPoints: [resolve(here, "../extensions/pi-splinter.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["@earendil-works/*"],
  write: false,
  logLevel: "warning",
});
const staging = await mkdtemp(resolve(here, ".staged-"));
const stagedFile = resolve(staging, "pi-splinter.mjs");
await writeFile(stagedFile, outputFiles[0].text, "utf8");
const { default: extension } = await import(pathToFileURL(stagedFile).href);
await rm(staging, { recursive: true, force: true });

const { Box, Text, TuiAltScreen } = await import("@earendil-works/pi-tui");

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`PASS  ${name}${detail ? `  | ${detail}` : ""}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${name}${detail ? `  | ${detail}` : ""}`);
};

const WIDTH = 80;
const ROWS = 30;

/**
 * Pi's fullscreen renderer over a stub terminal. Only the methods the selection
 * path touches are implemented; writes are dropped because the assertions are
 * about renderer state and render requests, not painted bytes.
 */
function createRenderer(copySelection) {
  const state = { feed: undefined, writes: 0, renders: 0, copies: 0 };
  const terminal = {
    columns: WIDTH,
    rows: ROWS,
    write: () => {
      state.writes += 1;
    },
    start: (onInput) => {
      state.feed = onInput;
      return () => {};
    },
    stop: () => {},
    hideCursor: () => {},
    showCursor: () => {},
    isTTY: true,
  };
  const tui = new TuiAltScreen(terminal, false, undefined, {
    copyOnSelect: true,
    copySelection: async (text) => {
      state.copies += 1;
      state.copiedText = text;
      return copySelection ? copySelection(text) : true;
    },
  });
  const body = new Box(0, 0);
  for (let i = 0; i < 12; i += 1) body.addChild(new Text(`line ${i} ${"x".repeat(20)}`, 0, 0));
  tui.layoutRoot = body;
  tui.render(WIDTH);
  tui.start();
  // Count render requests after start(), so the baseline is not the startup frame.
  const requestRender = tui.requestRender.bind(tui);
  tui.requestRender = (...args) => {
    state.renders += 1;
    return requestRender(...args);
  };
  return { tui, state };
}

const press = (x, y) => `\x1b[<0;${x};${y}M`;
const drag = (x, y) => `\x1b[<32;${x};${y}M`;
const release = (x, y) => `\x1b[<0;${x};${y}m`;
const settle = () => new Promise((r) => setTimeout(r, 25));

/**
 * Drag across rows 4-5, which the layout puts body text on, and report how many
 * render requests the release itself caused: drag motions request renders too,
 * so the count has to be taken right before the release.
 */
async function dragSelect(renderer) {
  renderer.state.feed(press(3, 4));
  for (let x = 4; x <= 16; x += 1) renderer.state.feed(drag(x, 4));
  for (let x = 16; x >= 3; x -= 1) renderer.state.feed(drag(x, 5));
  const beforeRelease = renderer.state.renders;
  renderer.state.feed(release(3, 5));
  await settle();
  return renderer.state.renders - beforeRelease;
}

const selectionState = (tui) => ({
  anchor: tui.selectionAnchor,
  focus: tui.selectionFocus,
  pressActive: tui.selectionPressActive,
  dragged: tui.selectionDragged,
});

const tuiContext = () => ({ mode: "tui", ui: { setStatus() {}, notify() {} } });
/** Pi runs every registered handler; fan out like Pi, not one handler per name. */
const installExtension = async () => {
  const handlers = {};
  extension({
    registerShortcut() {},
    on(name, fn) { (handlers[name] ??= []).push(fn); },
  });
  const emit = (name, ...args) => {
    for (const fn of handlers[name] ?? []) fn(...args);
  };
  emit("session_start", {}, tuiContext());
  await settle();
  return { emit };
};

console.log("\n-- 1. Pi 的原行为：复制后选区仍在（可证伪基线） --");
let rendersAfterStockRelease = 0;
{
  const { tui, state } = createRenderer();
  rendersAfterStockRelease = await dragSelect({ tui, state });
  const after = selectionState(tui);
  check("未打补丁：release 触发了复制", state.copies === 1, `copies=${state.copies}`);
  check("未打补丁：复制后 selectionAnchor 仍在", after.anchor !== undefined);
  check("未打补丁：复制后 selectionFocus 仍在", after.focus !== undefined);
}

console.log("\n-- 2. 打了补丁：复制成功后选区被释放 --");
const handlers = await installExtension();
let rendersAfterSuccessfulCopy = 0;
{
  const { tui, state } = createRenderer();
  rendersAfterSuccessfulCopy = await dragSelect({ tui, state });
  const after = selectionState(tui);
  check("补丁：release 触发了复制", state.copies === 1, `copies=${state.copies}`);
  check("补丁：复制后 selectionAnchor 被清掉", after.anchor === undefined);
  check("补丁：复制后 selectionFocus 被清掉", after.focus === undefined);
  check("补丁：按下态一并复位", after.pressActive === false && after.dragged === false);
  check(
    "补丁：清理后比 Pi 原行为多请求一次重绘（否则高亮留在屏上）",
    rendersAfterSuccessfulCopy === rendersAfterStockRelease + 1,
    `原=${rendersAfterStockRelease} 补丁=${rendersAfterSuccessfulCopy}`,
  );
  check("补丁：复制内容非空", typeof state.copiedText === "string" && state.copiedText.length > 0);
}

console.log("\n-- 3. 复制失败时保留选区，便于重试 --");
{
  const { tui, state } = createRenderer(() => false);
  const rendersAfterFailedCopy = await dragSelect({ tui, state });
  const after = selectionState(tui);
  check("失败：复制被调用过", state.copies === 1);
  check("失败：selectionAnchor 保留", after.anchor !== undefined);
  check(
    "失败：重绘次数与 Pi 原行为一致（没有多画一帧）",
    rendersAfterFailedCopy === rendersAfterStockRelease,
    `原=${rendersAfterStockRelease} 失败=${rendersAfterFailedCopy}`,
  );
}

console.log("\n-- 4. 显式复制键（Ctrl+X 走的选择分支）同样释放选区 --");
{
  const { tui } = createRenderer();
  tui.selectionAnchor = { row: 4, col: 3, scrollView: undefined };
  tui.selectionFocus = { row: 5, col: 3, scrollView: undefined };
  tui.selectionPressActive = false;
  const copied = await tui.copyActiveSelectionToClipboard();
  check("显式复制：返回 true", copied === true);
  check("显式复制：选区被释放", tui.selectionAnchor === undefined && tui.selectionFocus === undefined);
}

console.log("\n-- 5. session_shutdown 后恢复 Pi 的原行为 --");
{
  handlers.emit("session_shutdown", {}, tuiContext());
  await settle();
  const { tui, state } = createRenderer();
  await dragSelect({ tui, state });
  check("还原：复制仍发生", state.copies === 1);
  check("还原：选区重新保留（回到 Pi 原行为）", tui.selectionAnchor !== undefined);
}

if (failures > 0) {
  console.log(`\n${failures} 项失败`);
  process.exit(1);
}
console.log("\n全部通过");
