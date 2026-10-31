# 字体资产

- **Departure Mono** v1.500：像素等宽英文字体，用于代码/英文与数字。来源 https://github.com/rektdeckard/departure-mono ，许可证见 `DepartureMono-LICENSE.txt`（SIL OFL 1.1）。
- **Zpix（最像素）** v3.3.0：中文像素字体，只作为中文 fallback。来源 https://github.com/SolidZORO/zpix-pixel-font ，作者 SolidZORO；使用前请按上游仓库许可证确认分发范围。
- 字体文件随 Studio 构建进入 `dist/assets`，桌面 App 与浏览器使用同一份文件，避免各平台 fallback 不一致。
