# Changelog / 更新日志

[English](#english) | [中文](#chinese)

## English

All notable changes to this project will be documented in this file.

### New Features
- Added core log API interface support
- Windows systems now use API method for log retrieval by default
- Other systems continue to use IPC method for logging
- Note: Specifically addresses log stream access issues in Windows TUN mode caused by UAC permissions

### System Optimizations
- Changed default DNS resolution method from LOCAL to DHCP
- Significantly improved access speed for non-proxied websites on Windows
- Resolved performance bottleneck issues in LOCAL DNS resolution mode

## Chinese

此项目的所有值得注意的变更都将记录在此文件中。

### 新增功能
- 新增核心日志 API 接口支持
- Windows 系统默认使用 API 方式获取日志
- 其他系统继续使用 IPC 方式获取日志
- 优化说明：特别解决了 Windows TUN 模式下，因 UAC 权限导致的日志流获取问题

### 系统优化
- 将默认 DNS 解析方式从 LOCAL 调整为 DHCP
- 显著提升 Windows 系统上非代理网站的访问速度
- 解决了 LOCAL 模式下 DNS 解析性能瓶颈问题