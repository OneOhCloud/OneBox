# Changelog

{{version-tag-date}}

## Changes since v1.4.23

All significant changes in this version are documented here.

### Features

- Added a custom proxy port setting for the HTTP/SOCKS mixed inbound.
- Added a macOS bypass-router Watchdog setting with 4-hour, 12-hour, 24-hour, and disabled options.

### Changes

- Updated frontend and Tauri dependencies.
- Upgraded the bundled sing-box kernel from v1.13.11 to v1.13.12.
- Changed OneBox and sing-box log timestamps/file dates to use the local timezone.
- Added startup window geometry diagnostics to help troubleshoot display and sizing issues.
- Changed the default macOS bypass-router scheduled restart interval from every 4 hours to every 24 hours.
- Changing the proxy port now stops the VPN service so the new port is applied cleanly on the next start.

### Bug Fixes

- Fixed the home page being clipped on shorter windows by allowing the app route area to scroll when needed.
- Fixed stale Windows TUN service state by stopping orphaned or already-running service instances before startup/restart.

## 自 v1.4.23 以来的变更

本版本的所有重要变更将记录于此。

### 新增功能

- 新增 HTTP/SOCKS 混合入站的自定义代理端口设置。
- 新增 macOS 旁路由 Watchdog 设置，可选择 4 小时、12 小时、24 小时或禁用。

### 变更

- 更新了前端与 Tauri 相关依赖。
- 内置 sing-box 内核从 v1.13.11 升级至 v1.13.12。
- 新增启动时窗口尺寸诊断日志，便于排查显示和窗口大小问题。
- 修改代理端口时会停止 VPN 服务，下次启动时干净应用新端口。
- OneBox 与 sing-box 日志时间戳/文件日期改为使用本地时区。
- macOS 旁路由默认定时重启间隔从每 4 小时调整为每 24 小时。

### Bug 修复

- 修复 Windows TUN 服务残留旧状态的问题，启动或重启前会停止孤立或已运行的旧服务实例。
- 修复窗口高度较小时主页内容可能被裁切的问题，现在需要时可通过应用路由区域滚动查看。

---

> 请确保您了解潜在风险后再使用开发版和测试版。
>
> Use development and beta versions only if you are aware of the potential risks.
