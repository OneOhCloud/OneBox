# Changelog

{{version-tag-date}}

## Changes since v1.4.0

All significant changes in this version are documented here.


### ✨ Features

- Added dark mode, with a System / Light / Dark picker under Developer options → Appearance
- Added a configuration detail view: tap Details on any config to edit the name, copy its link, copy the full content, refresh, or delete it from one place
- Added live DNS override on macOS so DNS keeps working through Wi-Fi switches, VPN toggles, and wired-to-wireless changes instead of stopping until the next reconnect


### ⚠ Changes

- Redesigned the advanced settings window in a native macOS layout
- Refreshed the main app appearance
- Manual configuration add now shows the same progress sheet as link-triggered imports, stays on the current page when done, and no longer automatically starts the service
- Balanced the action labels on the Configuration page and tightened the wording of the copy actions in the detail view
- Configuration imports from links now verify the source before being applied automatically


### 🐛 Bug Fixes

- Fixed an issue where installing an app update could trigger a duplicate import of a previously applied configuration on next launch




## 自 v1.4.0 以来的变更

本版本的所有重要变更将记录于此。


### ✨ 新增功能

- 新增深色模式，"开发者选项 → 外观" 提供 跟随系统 / 浅色 / 深色 三种选择
- 新增配置详情页：点任一配置的 详情 可在同一处编辑名称、复制链接、复制完整内容、立即刷新，或删除
- macOS 下 DNS 生效改为实时跟随网络变化，切换 Wi-Fi、开关 VPN、在有线与无线之间切换时不再失效


### ⚠ 变更

- 高级设置窗口改为原生 macOS 风格
- 全局界面外观整体刷新
- 手动添加配置的加载界面与链接导入保持一致，完成后停留在当前页面，且不再自动启动服务
- 配置页的按钮文案长度对齐，详情页的复制操作文案也同步精简
- 通过链接自动应用配置前，会先校验来源是否可信




---

> 请确保您了解潜在风险后再使用开发版和测试版。
>
> Use development and beta versions only if you are aware of the potential risks.
