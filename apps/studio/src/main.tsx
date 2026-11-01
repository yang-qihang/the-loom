import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DesktopTitlebar } from "./components/DesktopTitlebar";
import { isDesktopShell } from "./desktop";

const scale = new URLSearchParams(window.location.search).get("scale");
if (scale) document.documentElement.style.zoom = scale;
import { installNativeGuard } from "./native-guard";
import "./styles.css";
import "./guidance.css";

if (isDesktopShell()) installNativeGuard();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root container");

createRoot(root).render(
  <StrictMode>
    {isDesktopShell() ? <DesktopTitlebar /> : null}
    <App />
  </StrictMode>,
);
