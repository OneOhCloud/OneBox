# OneBox

[![Dev Build](https://github.com/OneOhCloud/OneBox/actions/workflows/dev-release.yml/badge.svg)](https://github.com/OneOhCloud/OneBox/actions/workflows/dev-release.yml)
[![Beta Build](https://github.com/OneOhCloud/OneBox/actions/workflows/beta-release.yml/badge.svg)](https://github.com/OneOhCloud/OneBox/actions/workflows/beta-release.yml)
[![Stable Build](https://github.com/OneOhCloud/OneBox/actions/workflows/stable-release.yml/badge.svg)](https://github.com/OneOhCloud/OneBox/actions/workflows/stable-release.yml)
[![sing-box](https://repology.org/badge/version-for-repo/homebrew/sing-box.svg?header=sing-box-latest-version)](https://github.com/SagerNet/sing-box)

**简单、稳定、安全。无需繁琐配置，开箱即用。**


基于 [sing-box](https://github.com/SagerNet/sing-box) 内核的跨平台 GUI 客户端，专为追求简洁易用的普通用户设计。如果你偏好复杂配置和深度折腾，建议选择其他项目。



## 目录

- [软件截图](#软件截图)
- [特色功能](#特色功能)
- [平台支持](#平台支持)
- [下载安装](#下载安装)
- [支持级别说明](#支持级别说明)




## 软件截图

|![主页](./docs/image/zh/Home.png)|![配置](./docs/image/zh/Config.png)|![设置](./docs/image/zh/Settings.png)|
|:---:|:---:|:---:|



## 特色功能

- **安全高效**：采用安全的 Rust 语言开发，性能优异且资源占用低。
- **隐私保护**：使用安全与隐私保护最佳实践，如密码等机密信息存储在系统钥匙串中。
- **可信安装**：macOS 版本已通过苹果官方公证，可直接下载安装，无需繁琐授权。

> [!WARNING]
> 我们已采取多项安全措施，但底层内核的安全性及漏洞修复依赖于 sing-box 项目，相关风险和修复并非本项目可直接控制。




## 平台支持


<!-- | Tier      | Platform | Status & Maintenance                                                                 |
|-----------|----------|--------------------------------------------------------------------------------------|
| **Tier 1: Official**      | macOS    | Production-ready. Fully maintained by the core team with priority bug fixes.        |
| **Tier 2: Community**     | Windows，Ubuntu | Stable. Maintained by the community; features and fixes may lag behind Tier 1.     |
| **Tier 3: Experimental**  | Linux    | Beta. Unstable or incomplete. Use at your own risk; no guaranteed fixes.           | -->

| 支持级别      | 平台 | 状态与维护                                                                 |
|-----------|----------|--------------------------------------------------------------------------------------|
| **Tier 1：官方支持**      | macOS    | 生产就绪。由核心团队全面维护，优先修复问题。        |
| **Tier 2：社区支持**     | Windows，Ubuntu | 稳定。由社区贡献者维护；功能和修复可能落后于一级支持。     |
| **Tier 3：实验性支持**  | Linux    | 测试版。不稳定或不完整。请自行承担风险使用；不保证修复。           |

## 下载安装

请访问我们的[官方网站](https://sing-box.net)或[发布页面](https://github.com/OneOhCloud/OneBox/releases)获取最新版本。



## 测试说明

要运行测试并在控制台显示输出，请使用以下命令：

```rust
cargo test  -- --nocapture 
```
## 许可证和品牌使用
本软件采用 **Apache 2.0 许可证** 进行许可。

请注意：**OneBox** 名称、标志和图标是 OneOh Cloud LLC 的专有资产。Apache 许可证并未授予在衍生作品中使用这些品牌元素的权限。任何对这些资产或产品名称的使用均必须遵守我们的 [NOTICE](./NOTICE) 政策。