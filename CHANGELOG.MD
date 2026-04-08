# Changelog

{{version-tag-date}}

## Changes since v1.3.26

All significant changes in this version are documented here.


### ⚠ CHANGES

- Updated dependencies
- VPN now automatically restarts when network connectivity is restored after an outage, replacing the previous sleep-duration-based restart
- Rapid network switching (e.g. in public places) is handled safely: restarts are debounced and only trigger after the network has been stable for 3 seconds; brief outages under 2 seconds are ignored entirely
- Supported on both macOS and Windows 10 2004+; older Windows versions gracefully skip network monitoring with no impact on other functionality





## 自 v1.3.26 以来的变更

本版本的所有重要变更将记录于此。


### ⚠ 变更

- 更新了依赖项
- VPN 现在在网络断开恢复后自动重启，替代了原先基于睡眠时长的重启机制
- 安全处理公共场所的频繁网络切换：重启有 3 秒防抖，2 秒内的短暂断网不触发重启
- 支持 macOS 及 Windows 10 2004+；旧版 Windows 自动跳过网络监控，不影响其他功能



---

> 请确保您了解潜在风险后再使用开发版和测试版。
> 
> Use development and beta versions only if you are aware of the potential risks.
