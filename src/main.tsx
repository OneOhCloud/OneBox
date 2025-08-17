import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import { setupStatusListener, setupTrayIcon } from "./tray";
import WindowManger from './window-manger';


const appWindow = getCurrentWindow();

if (appWindow.label === "main") {
  setupTrayIcon();
  setupStatusListener();
}


ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WindowManger />
  </React.StrictMode>,
);