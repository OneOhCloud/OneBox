<div align="center">
  <img src="./.github/assets/brand/readme-hero.png" alt="OneBox 横幅" width="100%">

  <p>
    <a href="./README.md">English</a>
    ·
    <a href="#软件截图">软件截图</a>
    ·
    <a href="#特色功能">特色功能</a>
    ·
    <a href="#下载安装">下载安装</a>
    ·
    <a href="#开发说明">开发说明</a>
  </p>

  <p>
    <a href="https://github.com/SagerNet/sing-box"><img alt="sing-box 最新版本" src="https://repology.org/badge/version-for-repo/homebrew/sing-box.svg?header=sing-box"></a>
    <a href="https://github.com/OneOhCloud/OneBox/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/OneOhCloud/OneBox?display_name=tag&sort=semver"></a>
    <a href="./LICENSE"><img alt="许可证" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  </p>

  <p>
    <a href="https://play.google.com/store/apps/details?id=cloud.oneoh.networktools"><img alt="在 Google Play 上获取" src="https://play.google.com/intl/en_us/badges/static/images/badges/zh-cn_badge_web_generic.png" height="56" align="middle"></a>
    <a href="https://apps.apple.com/us/app/oneboxm/id6759716475"><img alt="在 App Store 下载" src="https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/zh-cn?size=250x83" height="38" align="middle"></a>
  </p>
</div>

## 项目简介

OneBox 是一个基于 Tauri、React、Rust 和 [sing-box](https://github.com/SagerNet/sing-box) 网络内核构建的跨平台桌面客户端。

它面向希望日常稳定使用的普通用户：添加订阅、选择路由模式、启动服务，其余平台细节交给应用处理。

> [!NOTE]
> OneBox 不是用来承接各种 sing-box 高度定制许愿的项目。完全手动控制、一堆开关、小众行为都不在本项目范围内，相关 PR 也不保证接受。如果你需要这种工作流，请自行 fork / clone，自己编译，自己维护。

## 软件截图

| 主页 | 配置 | 设置 |
| :---: | :---: | :---: |
| <img src="./.github/assets/zh/Home.png" alt="OneBox 主页" width="240"> | <img src="./.github/assets/zh/Config.png" alt="OneBox 配置页" width="240"> | <img src="./.github/assets/zh/Settings.png" alt="OneBox 设置页" width="240"> |

## 特色功能

| 能力 | OneBox 提供的体验 |
| --- | --- |
| 订阅优先的工作流 | 导入远程配置链接，展示流量元信息，刷新订阅，并支持 deep link 配置导入。 |
| 路由模式 | 提供 mixed 与 TUN 模式，并维护适配 sing-box 版本的规则/全局模板。 |
| 系统集成 | 提供托盘控制、系统代理辅助、开机自启、更新流程和平台相关服务处理。 |
| 隐私友好的存储 | 对敏感值使用系统级安全机制，避免把密钥当作普通界面状态处理。 |
| 调试可见性 | 提供日志、生成配置和配置模板视图，方便排查问题，同时不打扰普通用户。 |
| Rust 与 Tauri 构建 | 保持桌面壳轻量，并将网络执行交给 sing-box 内核。 |

> [!WARNING]
> OneBox 已采取多项安全与隐私保护措施，但底层网络内核的漏洞修复依赖上游 sing-box 项目。评估运行风险时请同时关注上游安全公告。

## 平台支持

| 支持级别 | 平台 | 状态 |
| --- | --- | --- |
| Tier 1：官方支持 | macOS | 生产就绪，由核心团队维护并优先修复问题。 |
| Tier 2：社区支持 | Windows、Ubuntu | 稳定，功能一致性和修复进度取决于社区维护。 |
| Tier 3：实验性支持 | Linux | 测试版，可能存在不完整行为，请自行承担风险。 |

## 下载安装

请从 [GitHub Releases](https://github.com/OneOhCloud/OneBox/releases) 获取最新桌面版本，或通过上方商店徽章安装移动端配套应用。

macOS 版本已通过 Apple 公证，可直接安装，无需手动绕过系统安全限制。

## 开发说明

安装依赖：

```bash
bun install
```

启动桌面前端开发服务：

```bash
bun run dev
```

构建 Web 产物：

```bash
bun run build
```

运行前端测试：

```bash
bun run test
```

运行 Rust 测试并显示输出：

```bash
cargo test -- --nocapture
```

## 项目备注

- 配置模板会在 `dev` 和 `build` 前通过 `scripts/sync-templates.ts` 同步。
- Windows TUN 服务通过 `scripts/build-tun-service.ts` 构建。
- 平台相关的 Tauri 配置位于 `src-tauri/tauri.*.conf.json`。
- 面向实现者的协议说明位于 `docs/spec/zh/`。

## 许可证和品牌使用

本软件采用 [Apache License 2.0](./LICENSE) 许可证。

**OneBox** 名称、标志、图标和其他品牌资产是 OneOh Cloud LLC 的专有资产。Apache 许可证并未授予在衍生作品中使用这些品牌元素的权限。任何对这些资产或产品名称的使用均必须遵守 [NOTICE](./NOTICE) 政策。
