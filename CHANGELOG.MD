# Changelog

{{version-tag-date}}

## Changes since v1.4.0

All significant changes in this version are documented here.


### ✨ Features

- Refreshed the app with an iOS 26-style design across all pages
- Added dark mode, with a System / Light / Dark picker under Developer options → Appearance
- Added a configuration detail view: tap Details on any config to edit the name, copy its link, copy the full content, refresh, or delete it from one place
- Added live DNS override on macOS so DNS keeps working through Wi-Fi switches, VPN toggles, and wired-to-wireless changes instead of stopping until the next reconnect
- The home screen now shows live upload and download speeds for the active proxy
- Configuration imports from links now verify the source before being applied automatically
- Updating the app no longer re-imports a previously applied configuration on the next launch


### ⚠ Changes

- Updated dependency versions
- Upgraded the kernel
- Redesigned the advanced settings window in a native macOS layout
- Manual configuration add now shows the same progress sheet as link-triggered imports, stays on the current page when done, and no longer automatically starts the service


### 🐛 Bug Fixes

- Fixed the privileged helper tool not upgrading automatically after an app update
- Fixed the service failing to recover after the Mac woke from an extended sleep
- Fixed kernel diagnostics not being captured in TUN mode on macOS
- Fixed the helper connection becoming unresponsive after the helper tool was upgraded
- Fixed stale service state causing incorrect behaviour after rapid restarts
- Fixed a missing configuration file not showing an error message to the user
- Fixed network authentication pages failing to load after switching Wi-Fi networks
- Fixed an issue where logs were being truncated too short
- Fixed DNS state becoming inconsistent after the service stopped on network loss




## 自 v1.4.0 以来的变更

本版本的所有重要变更将记录于此。


### ✨ 新增功能

- 全面采用 iOS 26 风格，界面视觉全面焕新
- 新增深色模式，"开发者选项 → 外观" 提供 跟随系统 / 浅色 / 深色 三种选择
- 新增配置详情页：点任一配置的 详情 可在同一处编辑名称、复制链接、复制完整内容、立即刷新，或删除
- macOS 下 DNS 生效改为实时跟随网络变化，切换 Wi-Fi、开关 VPN、在有线与无线之间切换时不再失效
- 主页现在实时显示当前代理的上传和下载速度
- 通过链接自动应用配置前，会先校验来源是否可信
- 安装应用更新后，不再在下次启动时重复导入此前已应用的配置


### ⚠ 变更

- 更新了依赖版本
- 升级内核
- 高级设置窗口改为原生 macOS 风格
- 手动添加配置的加载界面与链接导入保持一致，完成后停留在当前页面，且不再自动启动服务


### 🐛 Bug 修复

- 修复应用更新后特权助手工具未能自动升级的问题
- 修复 Mac 长时间合盖休眠后服务无法自动恢复的问题
- 修复 macOS TUN 模式下内核日志未被捕获的问题
- 修复助手工具升级后连接失效、需重启才能恢复的问题
- 修复服务快速重启后残留旧状态导致行为异常的问题
- 修复配置文件缺失时未向用户显示任何错误提示的问题
- 修复切换 Wi-Fi 后可能无法打开网络认证页面的问题
- 修复日志记录过短的问题
- 修复网络断开后服务停止时 DNS 状态不一致的问题




---

> 请确保您了解潜在风险后再使用开发版和测试版。
>
> Use development and beta versions only if you are aware of the potential risks.
