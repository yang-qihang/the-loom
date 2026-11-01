# 字体资产

- **Departure Mono** v1.500：像素等宽英文字体，用于 Studio/桌面壳 UI 的英文与数字（**代码编辑器已改用 Maple Mono**）。来源 https://github.com/rektdeckard/departure-mono ，许可证见 `DepartureMono-LICENSE.txt`（SIL OFL 1.1）。
- **Zpix（最像素）** v3.3.0：中文像素字体，作为 UI 的中文 fallback（编辑器用 Maple Mono CN）。来源 https://github.com/SolidZORO/zpix-pixel-font ，作者 SolidZORO；使用前请按上游仓库许可证确认分发范围。
- 字体文件随 Studio 构建进入 `dist/assets`，桌面 App 与浏览器使用同一份文件，避免各平台 fallback 不一致。
- Iosevka 已移除（旧版遗留、已无引用）；代码编辑器字体见 `apps/studio/public/fonts`。
