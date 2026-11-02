# 61 · 字体与行内代码 Style Guide（强制契约）

> 状态：生效（2026-11-02）｜负责人：Lead｜适用：所有 Studio / 桌面壳 / 教材 / 内容文案 / 前端 agent
> 实现：`apps/studio/src/typography.css`、`apps/studio/src/styles.css`、`apps/desktop/shell/*`
> 自动化：`npm run check:style`、`apps/studio/e2e/style-policy.spec.ts`、`apps/studio/e2e/typography.spec.ts`

## 0. 一句话版本

**代码 = Maple Mono；非像素正文 = MiSans VF（Noto Sans SC 只做 fallback）；像素装饰字 = Zpix + Departure Mono（只用于短标题/按钮/标签/角色名）。**
**所有用户可见的 `` `行内代码` `` 必须渲染成 `<code class="inline-code">`，绝不能显示反引号、不能单独起段。**

## 1. 三条字体轨道（唯一合法用途）

| Token / CSS 变量 | 字体栈（权威） | 允许出现的位置 | 禁止出现的位置 |
|---|---|---|---|
| `--font-code`（`code` / `pre` / `kbd` / `.mono` / `.inline-code` 等） | `"Maple Mono", "Maple Mono CN", "Noto Sans CJK SC", ...` | Monaco 编辑器；参考解；指令手册签名/示例；织典代码；试符台输入/历史；日志中的代码；`inline-code`；教材代码块；错误条里的代码 | 任何叙述、标题、按钮、标签、正文 |
| `--font-text` / `--font-reading`（`body`、长文、普通 UI 文本） | `"MiSans VF", "MiSans", "Noto Sans SC", ...` | 序章/幕/关开场正文；旅途手记；教练长句；结算说明；手册说明；织典正文；教材正文/目标；伴玩/向导正文/表单；HUD 说明 | 代码（含行内代码）；像素装饰短标题/按钮/标签 |
| `--font-pixel` / `--serif` / `--mono`（像素装饰） | `"Zpix", "Departure Mono", ...` | **短、低信息量**的装饰部分：h1–h6 章节/关卡标题、`.btn` 按钮、chip/标签、kicker、卡片标题、角色名（“艾拉”）、HUD 短标签、键帽、地图墙标题、结算标题、教材标题/按钮、`stage-speaker` | **代码（绝对禁止）**；长段正文；任何需要逐行阅读的说明 |

补充：
- **Noto Sans SC 只做 MiSans 的 fallback**，不得重新把 `--font-text` 主字体改回 Noto；地图墙/标题若使用 `--pixel`，不得改成 MiSans。
- **像素字体绝对禁止用于代码**：`code` / `pre` / `kbd` / `.mono` / `.inline-code` / `.solution-code` / `.gd-signature` / `.gd-example` / `.codex-code` / `.repl-input` / `.hud-value` 等任何代码或代码值渲染点，computed `font-family` 必须含 `Maple Mono`，不得含 `Zpix`/`Departure Mono`/`Noto Sans SC` 作为主字体。
- 任何“看起来像代码”的**行内**片段（API 名、方法调用、关键字、变量名、文件名、坐标表达式、`Esc`/`help` 键名）都必须走行内代码渲染，不能手写 `<span>` + 像素字，也不能用块级 `<pre>`。
- 例外：**代码块**（多行示例）使用 `pre > code`；这里允许代码自身包含反引号（JS/TS 模板字符串）。禁止把行内片段做成独立段落。
- 不靠系统 fallback 假装一致：三类字体全部随包（MiSans/Maple/Noto 在 `src/assets/fonts`，像素字在 `src/assets/fonts` + `public/fonts`），桌面壳用 `public/fonts` 同一份。

## 2. 行内代码渲染契约（必须遵守）

数据里的写法：`"先写 \`golem.moveTo(lamp1)\` 再运行"`（反引号包裹）。

渲染规则：
1. **唯一入口**：React 文本一律通过 `apps/studio/src/components/RichText.tsx`（或教材渲染器里已复用它的 `RichText`）：
   ```tsx
   <RichText text={copy.coordHint} />
   ```
2. 输出必须是**行内** `<code className="inline-code">`；`RichText` 不得改为块级、不得加 `<p>`/`<div>`、不得把片段单独起段。
3. 字段边界：标题（h2/h3）、按钮、标签、列表项、目标、结算行、教材目标、codex 正文、HUD 说明、REPL notice/error、手册 footHint/noPoints、MC 帮助步骤……**只要该字段可能含反引号，就必须走 RichText**。
4. 禁止：
   - 直接把数据变量放进 JSX：`<p>{copy.footHint}</p>`（会显示字面反引号）；
   - 对含反引号的文本用 `dangerouslySetInnerHTML` 或正则拼 HTML；
   - 用浏览器默认字体渲染代码片段；
   - 把行内代码拆成独立 `<p>` 或 `<pre>`（除非它本来就是多行代码块）。
5. 占位符/`placeholder`/`title`/`aria-label` 等非富文本属性：去掉反引号，改用普通文字（例如 `golem.moveTo(-12, -2)`），不要指望它们渲染 HTML。

## 3. 前端改动检查清单（AI / teammate 合并前逐条过）

- [ ] 新增/修改的可见文本字段含反引号时，渲染点使用 `<RichText>`；长文容器确认没有被 `white-space: pre-wrap` 破坏行内布局。
- [ ] 没有把标题/按钮/标签改成 MiSans（像素修饰仍用 `--font-pixel`/`--mono`）。
- [ ] 没有把正文改成像素字或 Maple；没有把代码改成像素/MiSans。
- [ ] 新增的 `font-family` 全部走语义变量；没有新增硬编码 `Zpix`/`Departure Mono` 到代码选择器。
- [ ] `npm run check:style` 通过。
- [ ] `apps/studio/e2e/style-policy.spec.ts` 与 `typography.spec.ts` 通过（真实引擎配置）。
- [ ] 若新增含反引号的文案，补一条 DOM 断言或在 style-policy 的扫描范围内。

## 4. 自动化门禁（防回归，不靠人肉）

| 门禁 | 命令 | 断言 |
|---|---|---|
| 静态样式契约 | `npm run check:style` | 三轨道 token 正确；代码选择器禁用像素字；`--font-pixel` 保留 Zpix/Departure；`--font-text` 主字体 MiSans；`--font-code` 主字体 Maple |
| 字体/组件 e2e | `cd apps/studio && npx playwright test -c playwright.config.ts e2e/typography.spec.ts e2e/style-policy.spec.ts` | 代码点 computed family 含 Maple、不含像素；长文含 MiSans；标题/按钮/角色名含像素；`document.fonts.check` 三类字体加载 |
| 行内代码 DOM 审计 | 同上（style-policy 的 `literal backticks` 扫描） | 页面可见文本不得出现未被代码元素包住的反引号；跳过 `code/pre/textarea`（合法代码块） |
| 全量门禁 | `bash scripts/verify.sh` | l0 已接入 `check:style`；2026-11-02 实测 pass（仅既有 `G-FRESH-READER` tracked warn）；Studio real e2e 37/38 通过 + `runtime-recovery` 单测重跑通过（已知偶发，非字体回归）；mock e2e 5/5 |

## 5. 当前组件映射（新增组件按同类字段照做）

| 组件/文件 | 应使用的字段字体 | 备注 |
|---|---|---|
| `onboarding.tsx`（序章/幕/关开场/手记） | 正文 `--font-text`（MiSans）；标题/角色名/按钮像素 | 已删除 `.stage-lines` 横向金线（2026-11-02 用户要求） |
| `RichText.tsx` | `<code class="inline-code">` = `--font-code` | 所有反引号文本的唯一渲染器 |
| `CodexScreen.tsx` | title/subtitle/solve/mechanism/cost/inGame/misconception 全部 `RichText`；code 块 `pre>code` Maple | 新增 codex 文案必须走 RichText |
| `TextbookContent.tsx` / `TextbookWindow.tsx` | 正文/目标/列表 `RichText`；h2/h3/callout title/caption/term 也 `RichText`；code 块 Maple | 教材 markdown 源仍用反引号表示行内代码 |
| `GuidanceManual.tsx` / `PositionHud.tsx` / `ReplScreen.tsx` / `Workbench.tsx` / `SolutionViewer.tsx` | 说明文字 RichText；代码/签名 Maple；按钮像素 | 已知历史 bug 点：`footHint`、`noPoints`、`coordHint`、`helpHint`、`helpOpened`、`mcHelpSteps` |
| `MapWall.tsx` / `ResultCard.tsx` | 标题/按钮像素；目标/判据/codeRequirements 由 RichText；代码块 Maple | 新增字段若来自 copy JSON 且含反引号，必须 RichText |
| `apps/desktop/shell/*` | 标题/按钮/日志/role 名像素；正文/表单 MiSans；无代码字体混入 UI | 桌面壳与 Studio 同一字体资产 |

## 6. 变更流程（防止 teammate 破坏 invariants）

1. 先读本文档 + `docs/20 §3b4`；任何字体/文案渲染改动都要过 §3 清单。
2. 改完跑 §4 的三条命令；`check:style` 失败禁止合并。
3. 新增用户可见文案若包含反引号，必须在 `style-policy.spec.ts` 的扫描路径覆盖的页面可见，或补一条 `expect(locator).toContainText` 断言确认渲染成 `.inline-code`。
4. Lead 合并前抽查 `git diff` 里所有 `font-family` 与新增 `{...}` 文本渲染；发现回归直接 BLOCK。
5. 若确需例外（例如纯 ASCII 键帽必须等宽），在 PR/commit 说明里写明理由并更新本文档，不得静默破坏。
