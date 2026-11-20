# pi-splinter

> Pi 终端里那些提了上游却没人管的小别扭，收进一个插件一次修掉。

[English](./README.md) | 中文

`pi-splinter` 是 [Pi coding agent](https://pi.dev/) 的扩展包。一个模块负责一类别扭，
每个模块独占一个目录、一篇文档，各自安装与卸载，互不依赖。

![代码卡片效果](https://raw.githubusercontent.com/witt-bit/pi-splinter/main/docs/card.png)

## 模块

| 模块 | 修什么 | 文档 |
| --- | --- | --- |
| `cards` | assistant 消息里的代码块渲染成整宽卡片：`[COPY]` 按钮、点击切原文、卡片内可拖动选中、明暗切换重绘 | [docs/modules/cards.md](./docs/modules/cards.md) |
| `selection` | 复制成功后释放鼠标选区：选中区域不再一直高亮到下次点击，也不会盖住输入光标 | [docs/modules/selection.md](./docs/modules/selection.md) |

## 安装

```bash
pi install npm:pi-splinter
```

安装后重启 Pi，或执行 `/reload`。只想试一次、不动配置：

```bash
pi -e npm:pi-splinter
```

## 使用：cards

| 操作 | 结果 |
| --- | --- |
| 点击 `[COPY]` | 复制该代码块源码到剪贴板 |
| 在卡片上拖动 | 按普通文本选中（Pi 的选中即复制会一并复制） |
| 点击卡片其他位置 | 在卡片与原始围栏文本之间切换 |
| 点击原始文本里的代码 | 折回卡片 |
| 在原始文本的代码上拖动 | 按普通文本选中 |
| `Ctrl+Alt+C` | 复制最近渲染的代码块 |

press 交给 Pi，所以拖动可以起选区；只有 `[COPY]` 按钮会接住 press。折叠因此挂在
Pi 回派的 click 上——按下与松开落在同一格时才派发：原地单击折叠卡片，拖动则是选中
文本，双击仍然选词。

## 兼容性

- 需要 Pi 0.99.0 或更高版本；当前按 Pi 1.5.2 验证。
- regular 与 fullscreen TUI 均可工作；非 TUI 模式不受影响。
- 模块通过 patch Pi 内部渲染器实现，Pi 目前没有公开的 transcript 样式钩子，未来
  版本可能需要本包跟进。
- **启动自检**：每次 session start，`cards` 会用固定样例走一遍 patch 并校验卡片形状。
  形状不符时还原原生渲染并发 warning 说明原因，而不是静默失效。CI 对最新版与上一
  minor 的 Pi 各跑一遍测试。

## 已知问题

- 同一条消息里两个逐字节相同的代码块会被一起切换：Pi 的 Markdown 渲染器按代码块源码
  做块级复用，第二份不会走到 patch，点击会落到错误的块上。对应
  `test/render.test.mjs` 中两条失败用例（「相同源码：raw 块落在两张卡片之间」、
  「相同源码：raw 位移后仍能切换第三张」），上游同样失败。

## 新增模块

```text
src/modules/<id>/index.ts    接线：监听、快捷键、卸载；导出一个 SplinterModule
src/modules/<id>/*.ts        patch 本体，可用任何 Pi 暴露的缝隙
src/modules/index.ts         一行：把模块加进列表
docs/modules/<id>.md         改了什么、怎么交互、边界在哪
```

约定：

- 模块之间不互相 import，共用工具放 `src/shared/`。
- 每个模块在 `session_start` 装配、`session_shutdown` 完整还原，`/reload` 不能叠加第二份。
- 任何 patch Pi 内部的模块都要带启动自检，形状不符时退回原生渲染。
- 不想要的模块 = 删掉 `src/modules/index.ts` 里那一行、目录和文档页。

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm test            # 渲染测试（node test/render.test.mjs）
```

## 来历

`cards` 模块来自 [chengyayu/pi-code-render](https://github.com/chengyayu/pi-code-render)
0.1.10，并合入两个上游提交了但一直没人评审的修复（chengyayu/pi-code-render#3 及 #4、
#5 及 #6）。上游的 commit 历史完整保留，`f373aad` 之后才是本包自己的改动。
详见 [docs/provenance.md](./docs/provenance.md)。

## License

MIT。来自上游的部分版权归 pi-code-render contributors（2026），见 [LICENSE](./LICENSE)。
