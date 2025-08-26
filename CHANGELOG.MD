# Changelog

All annotation changes for this release will be recorded in this file.

### New Features
- Added real-time network speed display in the log page
- Added sing-box log API interface support
- Windows systems now use API method for log retrieval by default
- Other systems now use IPC method for log retrieval by default
- Note: Specifically addresses log stream access issues in Windows TUN mode caused by UAC permissions

### System Optimizations
- Changed default DNS resolution method from LOCAL to DHCP
- Significantly improved access speed for non-proxied websites on Windows
- Resolved performance bottleneck issues in LOCAL DNS resolution mode

## 中文

此版本的所有值得注意的变更都将记录在此文件中。

### 新增功能
- 新增实时网速在日志页面中
- 新增 sing-box 日志 API 接口支持
- Windows 系统默认使用 API 方式获取日志
- 其他系统默认使用 IPC 方式获取日志
- 优化说明：特别解决了 Windows TUN 模式下，因 UAC 权限导致的日志流获取问题

### 系统优化
- 将默认 DNS 解析方式从 LOCAL 调整为 DHCP
- 显著提升 Windows 系统上非代理网站的访问速度
- 解决了 LOCAL 模式下 DNS 解析性能瓶颈问题