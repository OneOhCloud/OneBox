# Changelog

{{version-tag-date}}

## Changes since v1.4.28

All significant changes in this version are documented here.

### Changes

- Updated sing-box core to v1.13.13.
- Updated JavaScript and Rust dependencies.
- Attempted to stop processes occupying ports and improved prompts.
- Added `make update PORT=...` proxy support for dependency and binary updates.
- Added a developer option to start VPN in non-TUN mode without setting the system proxy.
- Changed TUN DNS override to prepend the TUN gateway DNS instead of replacing existing DNS servers.

### Bug Fixes

- Fixed TUN shutdown so it removes only the inserted gateway DNS and preserves the user's other DNS servers.

## 自 v1.4.28 以来的变更

本版本的所有重要变更将记录于此。

### 变更

- 更新 JavaScript 与 Rust 依赖。
- 更新 sing-box 内核至 v1.13.13。
- 尝试停止端口占用的进程，并改进提示。
- 新增开发者选项：非 TUN 模式启动 VPN 时可不设置系统代理。
- 新增 `make update PORT=...` 代理端口支持，用于依赖和二进制更新。
- TUN DNS 覆写改为将 TUN 网关 DNS 放在第一位，而不是替换掉现有 DNS 服务器。


### Bug 修复

- 修复 TUN 关闭时的 DNS 恢复逻辑，现在只删除插入的网关 DNS，并保留用户的其他 DNS 服务器。

---

> 请确保您了解潜在风险后再使用开发版和测试版。
>
> Use development and beta versions only if you are aware of the potential risks.
