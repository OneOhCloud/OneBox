# Changelog

{{version-tag-date}}

## Changes

- Fixed mainland China websites failing to open in Windows TUN mode on some IPv6 networks.
- OneBox automatically selects a working IPv6 connection without waiting for unavailable connections during startup, and temporarily uses IPv4 when IPv6 is unavailable.
- The config viewer now shows the config currently in use.
- Updated JavaScript and Rust dependencies.

## 变更

- 修复部分 IPv6 网络下 Windows 开启 TUN 后无法访问中国大陆网站的问题。
- 自动选择可用的 IPv6 连接，启动时无需等待不可用连接超时，IPv6 不可用时临时使用 IPv4。
- 配置查看器现在显示实际生效的配置。
- 更新 JavaScript 与 Rust 依赖。
