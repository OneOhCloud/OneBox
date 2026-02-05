# OneBox

[简体中文](./README_CN.md)

[![Dev Build](https://github.com/OneOhCloud/OneBox/actions/workflows/dev-release.yml/badge.svg)](https://github.com/OneOhCloud/OneBox/actions/workflows/dev-release.yml)
[![Beta Build](https://github.com/OneOhCloud/OneBox/actions/workflows/beta-release.yml/badge.svg)](https://github.com/OneOhCloud/OneBox/actions/workflows/beta-release.yml)
[![Stable Build](https://github.com/OneOhCloud/OneBox/actions/workflows/stable-release.yml/badge.svg)](https://github.com/OneOhCloud/OneBox/actions/workflows/stable-release.yml)
[![sing-box](https://repology.org/badge/version-for-repo/homebrew/sing-box.svg?header=sing-box-latest-version)](https://github.com/SagerNet/sing-box)

**Simplicity, Stability, Security. No complex configuration, ready to use out of the box.**



A cross-platform GUI client based on [sing-box](https://github.com/SagerNet/sing-box) kernel, targeting ordinary users. For those who prefer complex configurations and tinkering, please refer to other projects.






## Table of Contents

- [Screenshots](#screenshots)
- [Key Features](#key-features)
- [Platform Support](#platform-support)
- [Download and Installation](#download-and-installation)
- [Support Level Explanation](#support-level-explanation)


## Screenshots

|![Home](./docs/image/en/Home.png)|![Config](./docs/image/en/Config.png)|![Settings](./docs/image/en/Settings.png)|
|:---:|:---:|:---:|



## Key Features

- **Performance**: Developed in Rust, ensuring excellent performance and low resource consumption.
- **Security & Privacy**: Implements best practices for security and privacy, such as storing sensitive information like passwords in the system keychain.
- **Trusted Installation**: The macOS version is notarized by Apple, allowing direct installation without complicated authorization.

> [!WARNING]
> While we have implemented multiple security measures, the security and vulnerability fixes of the underlying kernel depend on the sing-box project, and the associated risks and fixes are not directly controlled by this project.




## Platform Support

| Tier      | Platform | Status & Maintenance                                                                 |
|-----------|----------|--------------------------------------------------------------------------------------|
| **Tier 1: Official**      | macOS    | Production-ready. Fully maintained by the core team with priority bug fixes.        |
| **Tier 2: Community**     | Windows，Ubuntu | Stable. Maintained by the community; features and fixes may lag behind Tier 1.     |
| **Tier 3: Experimental**  | Linux    | Beta. Unstable or incomplete. Use at your own risk; no guaranteed fixes.           |


## Download and Installation

Please visit our [official website](https://sing-box.net) or the [Releases page](https://github.com/OneOhCloud/OneBox/releases) to get the latest version.




## Test Instructions

To run tests with output displayed in the console, use the following command:

```rust
cargo test  -- --nocapture 
```

## License & Brand Usage
This software is licensed under the **Apache License 2.0**. 

Please note: The **OneBox** name, logos, and icons are proprietary assets of OneOh Cloud LLC. The Apache License does **not** grant permission to use these branding elements in derivative works. Any use of these assets or the product name must comply with our [NOTICE](./NOTICE) policy.