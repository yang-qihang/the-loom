import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DesktopTitlebar } from "./components/DesktopTitlebar";
import { isDesktopShell, isTopLevelWindow } from "./desktop";

const scale = new URLSearchParams(window.location.search).get("scale");
if (scale) document.documentElement.style.zoom = scale;
import { installNativeGuard } from "./native-guard";
import "./styles.css";
import "./guidance.css";
import "./narrative.css";
import "./typography.css";

if (isDesktopShell()) installNativeGuard();

/**
 * 桌面壳在 iframe 里加载 Studio 时，Tauri 也会把 `__TAURI_INTERNALS__` 注入子 frame，
 * 于是 Studio 曾误以为自己是顶层应用、再画一条标题栏 → 打包版出现双标题栏 + 36px 偏移。
 * 标题栏是窗口级 UI，只允许顶层 Studio 渲染；壳内（iframe）和浏览器直开都不渲染。
 */
const renderOwnTitlebar = isDesktopShell() && isTopLevelWindow();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root container");

createRoot(root).render(
  <StrictMode>
    {renderOwnTitlebar ? <DesktopTitlebar /> : null}
    <App />
  </StrictMode>,
);
