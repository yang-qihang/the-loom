# 字体资产

- **Zpix + Departure Mono**：像素字体，保留给**装饰性部分**（章节标题、按钮、标签、chip、角色名“艾拉”等）；来源与许可见同目录旧文件。
- **MiSans VF**：小米 MiSans 可变字体（Normal 版，web 子集切片），用于**非像素、非装饰性的正文/普通 UI 文本**（长段叙述、手记、说明文字），Noto Sans SC 作为 fallback；来源 npm `misans@5.0.0`（https://www.npmjs.com/package/misans ），许可证 Apache-2.0，见 `misans/MiSans-LICENSE.txt`。
- **Noto Sans SC**（task-2 起）：可读非衬线中文字体，用于长段正文（剧情叙述、幕/关开场、手记、教练卡长句、手册说明）；短标题/按钮/标签保留像素字（Zpix/Departure Mono），“非像素正文”用 MiSans VF。来源 https://github.com/notofonts/noto-cjk （`Sans/SubsetOTF/SC`），许可证 SIL OFL 1.1，见 `NotoSansSC-OFL.txt`。
  - 随包文件：`noto-sans-sc-400.woff2`（Regular）、`noto-sans-sc-700.woff2`（Bold），各约 1.1 MB，合计约 2.2 MB。
  - **已子集化**：字符集 = GB2312 全部字符（7445）+ ASCII + 仓库文本实际用字，共 7554 码点（字体 cmap 7557）。清单与哈希见 `noto-sans-sc-coverage.json`。
  - 复跑：`python scripts/build-font-subset.py`（源 OTF 缓存在 `.tools/fonts-src`，缺失时自动下载；依赖 fonttools/brotli）。
  - 校验：`node scripts/check-font-coverage.mjs`（字体完整性/体积预算/UI 文本缺字/`typography.css` 引用）。
- 字体文件随 Studio 构建进入 `dist/assets`，桌面 App 与浏览器使用同一份文件，避免各平台 fallback 不一致。
- 字体用途映射集中在 `apps/studio/src/typography.css`：`--font-pixel` / `--font-text` / `--font-code` 三个语义变量（定义在 `styles.css` 的 `:root`）。
- Iosevka 已移除（旧版遗留、已无引用）；Maple Mono（代码字体）与 MiSans VF 的桌面壳副本见 `apps/studio/public/fonts`。
