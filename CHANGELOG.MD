# Changelog

{{version-tag-date}}

## Changes since v1.4.34

All significant changes in this version are documented here.

### Changes

- Updated JavaScript and Rust dependencies.
- Added a developer option to show each node's protocol type in the node list (off by default). Thanks to @1392726643 for the contribution.


### Bug Fixes

- Fixed the proxy service sometimes failing to start when a port from the previous run was still in use.
- Fixed the node list, latency tests, and node switching failing when the system already had a proxy set and OneBox was started without changing the system proxy.


## 自 v1.4.34 以来的变更

本版本的所有重要变更将记录于此。

### 变更

- 更新 JavaScript 与 Rust 依赖。
- 新增开发者选项：在节点列表中显示每个节点的协议类型（默认关闭）。感谢 @1392726643 的贡献。


### Bug 修复

- 修复上一次运行的端口仍被占用时，代理服务有时无法启动的问题。
- 修复当系统已存在代理、且以不设置系统代理方式启动时，节点列表、延迟测试与节点切换无法使用的问题。


---

> 请确保您了解潜在风险后再使用开发版和测试版。
>
> Use development and beta versions only if you are aware of the potential risks.
