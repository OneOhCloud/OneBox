# Changelog

{{version-tag-date}}

## Changes since v1.4.23

All significant changes in this version are documented here.


### Features

- No new user-facing features in this release.


### Changes

- Updated frontend and Tauri dependencies.
- Upgraded the bundled sing-box kernel from v1.13.11 to v1.13.12.
- Added startup window geometry diagnostics to help troubleshoot display and sizing issues.
- Changed the macOS bypass-router scheduled restart interval from every 4 hours to every 24 hours.


### Bug Fixes

- Fixed the home page being clipped on shorter windows by allowing the app route area to scroll when needed.
- Fixed stale Windows TUN service state by stopping orphaned or already-running service instances before startup/restart.



## 自 v1.4.23 以来的变更

本版本的所有重要变更将记录于此。


### 新增功能

- 本版本没有新增面向用户的功能。


### 变更

- 更新了前端与 Tauri 相关依赖。
- 内置 sing-box 内核从 v1.13.11 升级至 v1.13.12。
- 新增启动时窗口尺寸诊断日志，便于排查显示和窗口大小问题。
- macOS 旁路由定时重启间隔从每 4 小时调整为每 24 小时。



### Bug 修复

- 修复窗口高度较小时主页内容可能被裁切的问题，现在需要时可通过应用路由区域滚动查看。
- 修复 Windows TUN 服务残留旧状态的问题，启动或重启前会停止孤立或已运行的旧服务实例。





---

> 请确保您了解潜在风险后再使用开发版和测试版。
>
> Use development and beta versions only if you are aware of the potential risks.
