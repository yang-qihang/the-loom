import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DesktopTitlebar } from "./components/DesktopTitlebar";
import { isDesktopShell } from "./desktop";
import { installNativeGuard } from "./native-guard";
import "./styles.css";

if (isDesktopShell()) installNativeGuard();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root container");

createRoot(root).render(
  <StrictMode>
    {isDesktopShell() ? <DesktopTitlebar /> : null}
    <App />
  </StrictMode>,
);
