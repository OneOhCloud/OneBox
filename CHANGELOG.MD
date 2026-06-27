# Changelog

{{version-tag-date}}

## Changes since v1.4.31

All significant changes in this version are documented here.

### Changes

- Updated JavaScript and Rust dependencies.
- Added an option to start VPN in non-TUN mode without setting the system proxy.
- Redesigned the rules page with editable rules and a new Reject action that blocks matched traffic.

### Bug Fixes

- Fixed quitting OneBox clearing a system proxy that OneBox did not set.
- Fixed proxy and DNS settings not taking effect on macOS when the active network service had been renamed (such as a renamed Wi-Fi).

## 自 v1.4.31 以来的变更

本版本的所有重要变更将记录于此。

### 变更

- 更新 JavaScript 与 Rust 依赖。
- 新增选项：非 TUN 模式启动 VPN 时可不设置系统代理。
- 重新设计了规则页面，规则可编辑，并新增「拒绝」动作以拦截匹配的流量。

### Bug 修复

- 修复退出 OneBox 时清除并非由 OneBox 设置的系统代理的问题。
- 修复 macOS 上重命名网络服务（例如改名后的 Wi-Fi）后，代理与 DNS 设置无法生效的问题。

---

> 请确保您了解潜在风险后再使用开发版和测试版。
>
> Use development and beta versions only if you are aware of the potential risks.
