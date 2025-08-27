# Windows 特权控制器使用说明

## 概述

为了解决 Windows 上 TUN 模式需要管理员权限的问题，我们实现了一个基于 Socket 的特权控制器方案。用户只需要在首次使用时进行一次 UAC 提权，后续的 sing-box 启动/停止操作就无需再次提权。

## 工作原理

1. **特权控制器进程**: 一个独立的控制器进程通过 Windows UAC 以管理员权限启动
2. **Socket 通信**: 主应用通过 TCP Socket (端口 18888) 与控制器通信
3. **sing-box 管理**: 控制器负责启动和停止 sing-box 进程，具有管理员权限

## 架构组件

### 1. 特权控制器 (`privilege-controller.exe`)
- 独立的二进制文件，位于 `target/debug/privilege-controller.exe`
- 通过 UAC 以管理员权限运行
- 监听 TCP 端口 18888
- 管理 sing-box 进程的生命周期

### 2. 控制器客户端 (`PrivilegeControllerClient`)
- 主应用中的客户端库
- 通过 Socket 发送命令给特权控制器
- 处理启动、停止、状态查询等操作

### 3. Windows VPN 模块更新
- 修改了 `create_privileged_command` 函数
- 使用特权控制器替代直接的 UAC 提权
- 简化了 TUN 模式的进程管理

## 核心功能

### 支持的命令

```rust
pub enum PrivilegeCommand {
    Start { 
        sing_box_path: String,
        config_path: String 
    },  // 启动 sing-box
    Stop,           // 停止 sing-box
    Status,         // 查询状态
    Shutdown,       // 关闭控制器
}
```

### 响应类型

```rust
pub enum PrivilegeResponse {
    Success,                    // 操作成功
    Error { message: String },  // 操作失败
    Status { running: bool },   // 状态响应
}
```

## 使用流程

### 1. 首次启动 TUN 模式
1. 用户选择 TUN 模式并启动
2. 系统检测到需要特权权限
3. 通过 UAC 启动特权控制器 (`ShellExecuteW` with "runas")
4. 用户确认 UAC 提示
5. 特权控制器启动并监听端口 18888
6. 主应用通过 Socket 发送启动命令
7. 控制器启动 sing-box 进程

### 2. 后续操作
1. 停止: 主应用发送停止命令，控制器杀死 sing-box 进程
2. 重启: 直接通过 Socket 通信，无需再次提权
3. 状态查询: 实时查询 sing-box 运行状态

### 3. 清理
- 应用退出时自动发送 Shutdown 命令
- 控制器进程正常退出

## 安全考虑

### 1. 本地通信
- 使用 127.0.0.1 本地回环地址
- 仅接受本地连接，避免网络安全风险

### 2. 权限最小化
- 控制器仅管理 sing-box 进程
- 不提供其他系统级别的操作接口

### 3. 进程隔离
- 控制器作为独立进程运行
- 主应用崩溃不影响控制器运行

## 文件结构

```
src-tauri/
├── src/
│   ├── bin/
│   │   └── privilege-controller.rs    # 控制器主程序入口
│   └── vpn/
│       ├── privilege_controller.rs    # 控制器核心逻辑
│       ├── windows.rs                 # Windows VPN 实现
│       └── mod.rs                     # VPN 模块定义
└── target/debug/
    └── privilege-controller(.exe)     # 编译后的控制器二进制
```

## 编译

```bash
# 编译特权控制器
cargo build --bin privilege-controller

# 编译主应用
cargo build
```

## 配置

- **端口**: 默认使用 18888，可通过命令行参数修改
- **超时**: 控制器启动等待时间为 5 秒
- **重试**: 主应用会自动检测并重启控制器

## 错误处理

### 常见错误场景
1. **UAC 拒绝**: 用户拒绝 UAC 提示，返回权限错误
2. **端口占用**: 端口 18888 被占用，启动失败
3. **控制器崩溃**: 自动重启控制器
4. **sing-box 路径错误**: 返回路径错误信息

### 日志记录
- 控制器使用 `println!` 输出日志
- 主应用使用 `log::info/error` 记录操作

## 优势

1. **用户体验**: 只需一次 UAC 提权，后续操作无感知
2. **稳定性**: 控制器独立运行，不受主应用影响
3. **安全性**: 最小权限原则，仅管理必要的进程
4. **可维护性**: 模块化设计，易于扩展和维护

## 注意事项

1. 首次使用需要管理员权限确认
2. 控制器进程会在后台运行，直到应用退出
3. 端口 18888 需要保持空闲状态
4. 适用于 Windows 平台的 TUN 模式场景

这个方案完美解决了 Windows 上 TUN 模式频繁 UAC 提权的问题，提供了更好的用户体验。
