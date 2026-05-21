<div align="center">
  <img src="./.github/assets/brand/readme-hero.png" alt="OneBox banner" width="100%">

  <p>
    <a href="./README_CN.md">简体中文</a>
    ·
    <a href="#screenshots">Screenshots</a>
    ·
    <a href="#features">Features</a>
    ·
    <a href="#download">Download</a>
    ·
    <a href="#development">Development</a>
  </p>

  <p>
    <a href="https://github.com/SagerNet/sing-box"><img alt="sing-box latest version" src="https://repology.org/badge/version-for-repo/homebrew/sing-box.svg?header=sing-box"></a>
    <a href="https://github.com/OneOhCloud/OneBox/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/OneOhCloud/OneBox?display_name=tag&sort=semver"></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  </p>

  <p>
    <a href="https://play.google.com/store/apps/details?id=cloud.oneoh.networktools"><img alt="Get it on Google Play" src="./.github/assets/store/google-play-en.png" width="185" height="56" align="middle"></a>
    <a href="https://apps.apple.com/us/app/oneboxm/id6759716475"><img alt="Download on the App Store" src="./.github/assets/store/app-store-en.svg" width="185" height="56" align="middle"></a>
  </p>
</div>

## About

OneBox is a cross-platform desktop client built with Tauri, React, Rust, and the [sing-box](https://github.com/SagerNet/sing-box) network core.

It is designed for people who want a clean daily-driver client instead of a configuration workshop: add a subscription, pick a route mode, start the service, and let the app handle the platform details.

> [!NOTE]
> OneBox is not a playground for wish-list driven sing-box customization. Requests for full manual control, endless knobs, or niche behavior are out of scope, and related PRs are not guaranteed to be accepted. If you need that workflow, fork the project, build your own copy, and maintain it yourself.

## Screenshots

| Home | Configuration | Settings |
| :---: | :---: | :---: |
| <img src="./.github/assets/en/Home.png" alt="OneBox home screen" width="240"> | <img src="./.github/assets/en/Config.png" alt="OneBox configuration screen" width="240"> | <img src="./.github/assets/en/Settings.png" alt="OneBox settings screen" width="240"> |

## Features

| Capability | What OneBox does |
| --- | --- |
| Subscription-first workflow | Imports remote configuration links, tracks traffic metadata, refreshes subscriptions, and supports deep-link based setup. |
| Route modes | Provides mixed and TUN modes with rule/global templates maintained for supported sing-box versions. |
| System integration | Includes tray controls, system proxy helpers, autostart, updater flow, and platform-specific service handling. |
| Privacy-conscious storage | Stores sensitive values through system-backed mechanisms instead of treating secrets as plain UI state. |
| Developer visibility | Ships log, generated config, and config-template views for debugging without exposing casual users to noise. |
| Built on Rust and Tauri | Keeps the desktop shell lightweight while delegating network execution to the sing-box core. |

> [!WARNING]
> OneBox applies multiple security and privacy controls, but vulnerabilities in the underlying network core are handled by the upstream sing-box project. Track upstream advisories when assessing operational risk.

## Platform Support

| Tier | Platform | Status |
| --- | --- | --- |
| Tier 1: Official | macOS | Production-ready and maintained by the core team with priority fixes. |
| Tier 2: Community | Windows, Ubuntu | Stable, with fixes and feature parity depending on community maintenance. |
| Tier 3: Experimental | Linux | Beta quality. Expect incomplete behavior and use at your own risk. |

## Download

Get the latest build from the [GitHub Releases page](https://github.com/OneOhCloud/OneBox/releases), or install the mobile companion from the store badges above.

The macOS build is notarized by Apple, so it can be installed without manual security overrides.

## Development

Install dependencies:

```bash
bun install
```

Start the desktop frontend during development:

```bash
bun run dev
```

Build the web bundle:

```bash
bun run build
```

Run the frontend test suite:

```bash
bun run test
```

Run Rust tests with captured output shown:

```bash
cargo test -- --nocapture
```

## Project Notes

- Config templates are synchronized before `dev` and `build` through `scripts/sync-templates.ts`.
- The Windows TUN service is built through `scripts/build-tun-service.ts`.
- Platform-specific Tauri settings live under `src-tauri/tauri.*.conf.json`.
- Human-facing protocol notes are available under `docs/spec/zh/`.

## License & Brand Usage

This software is licensed under the [Apache License 2.0](./LICENSE).

The **OneBox** name, logos, icons, and other brand assets are proprietary assets of OneOh Cloud LLC. The Apache License does not grant permission to use those branding elements in derivative works. Any use of these assets or the product name must follow the [NOTICE](./NOTICE) policy.
