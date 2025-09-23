# Changelog
Use development and beta versions only if you are aware of the potential risks.

## Changes since v1.1.59
All significant changes in this version are documented here.


### ✨ Features
- Added a local configuration switch to enable or disable the drag-and-drop import of local configuration files.
- On macOS, when starting in TUN mode, the default `ulimit` has been adjusted to 65535 as an optimization for scenarios like bypass routing.


### ⚠ CHANGES LOG
- Updated dependencies.
- Removed duplicate sniff configuration.
- Added connection timeout configuration for DNS servers, default value is 5 seconds.
- Unified the speed test URL in the configuration file to `https://www.google.com/generate_204` to prevent cheating during latency checks.

### 🐛 Bug Fixes
- Fixed layout inconsistency between Windows and macOS homepages.
- Fixed issue where node list did not refresh when switching between different subscriptions.


## 自 v1.1.59 以来的变更
本版本的所有重要变更将记录于此。

### ✨ 新增功能
- 新增本地配置开关，可以开启或关闭拖拽导入本地配置文件的功能。
- 在 macOS 上以 TUN 模式启动时，默认的 `ulimit` 限制已调整为 65535, 作为旁路由等场景的优化。


### ⚠ 变更日志
- 更新依赖项
- 去掉重复 sniff 的配置
- DNS 服务器添加连接超时配置，默认值为 5 秒
- 统一配置文件中的测速 URL 为 `https://www.google.com/generate_204`，防止检测延迟时作弊


### 🐛 问题修复
- 修复切换不同订阅时，节点列表未刷新的问题。
- 修复 Windows 与 macOS 主页布局不一致的问题。
