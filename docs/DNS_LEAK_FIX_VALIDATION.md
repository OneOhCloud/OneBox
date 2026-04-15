# TUN 模式 DNS 泄漏修复 — 跨平台验证手册

**状态**：macOS 已真机验证。Linux / Windows 的代码与 macOS 同构，待各自平台真机编译 + 运行验证。

本文档给下一位 Claude / 工程师完整的上下文、改动摘要、验证步骤、已知风险。
阅读顺序：背景 → 改动 → 验证步骤 → 排错。

---

## 1. 背景

### 1.1 用户现象

OneBox 升级 sing-box 内核从 `v1.13.0` → `v1.13.8` 后，TUN 模式下：

- 浏览器正常走代理（走 `tun.platform.http_proxy` 注入到 macOS 系统 HTTP 代理，浏览器 DNS 由 proxy 端完成）
- 裸 `curl https://www.google.com` 等命令行工具**超时**：DNS 解析到 GFW 注入的假 IP（例如 `174.132.167.252`），代理按假 IP dial 失败

### 1.2 真正的根因（两个，别混淆）

调查经过一次误判修正。结论：**两件事叠加**，但只有第二件是版本回归。

#### 1.2.1 mDNSResponder / Dnscache / systemd-resolved 绕过 TUN（平台级，跨版本成立）

macOS `mDNSResponder` 对每个活动网络服务维护 `scutil --dns` 里的 per-interface nameserver 表，发 DNS 查询时用 `IP_BOUND_IF` 把 UDP socket 绑到物理接口 → `sendto()` **完全绕过路由表** → TUN 看不到这些包。

Windows `Dnscache` 启用 **SMHNR (Smart Multi-Homed Name Resolution)**：并行往所有活跃网卡发 DNS 查询用最先返回的。GFW 注入通常先到。

Linux `systemd-resolved` 新版本可能用 `SO_BINDTODEVICE` 绑 socket 到具体物理接口，绕开 sing-box 的 fwmark 路由。

这三种行为**与 sing-box 版本无关**，是 OS 网络栈本身的设计。任何 userspace TUN 都抓不到这类绑定接口的 DNS 包。sing-tun 在 macOS 上的源码从 v0.8.0-beta.18 到 v0.8.7 字节级一致，没有任何 PF / socket 层拦截实现。

#### 1.2.2 sing-box 1.13.8 砍掉了 `sniff_override_destination`（真正的版本回归）

在 1.13.0 里，TUN inbound 的 `sniff_override_destination: true` 会在 TCP 握手后从 ClientHello 嗅出 SNI，**把 `metadata.Destination` 从原始（被污染的）IP 改写成 domain**。代理按 domain dial，代理端解析到真 IP，curl 就通了 —— 即便 DNS 本身已经泄漏。

1.13.8 commit `8ae93a98e` "Remove overdue deprecated features" 把 TUN inbound 的 `InboundOptions` 路径完全删掉，`RuleActionSniff.OverrideDestination` 字段在 `option/rule_action.go::RouteActionSniff` 里没有任何 JSON 暴露（标着 `// Deprecated`），全项目 grep `OverrideDestination` 的赋值点一个都没有。意思是：**1.13.8 起，没有任何办法通过迁移后的 route-rule sniff 恢复 "destination 被 SNI 改写" 的语义**。

### 1.3 对照实验（证据链）

用同一份迁移后 `config.D.json`（无 legacy `sniff` 字段，有 `{"inbound":"tun","action":"sniff"}` + `{"protocol":"dns","action":"hijack-dns"}` 规则）在同一台机器、同一 Wi-Fi、不设系统 DNS 覆盖下跑 1.13.0 与 1.13.8：

```
v1.13.0   OS列(host)            DG列(dig@1.1.1.1)   SB列(clash /dns/query)
          174.132.167.252!POISON 142.251.154.119✓    142.251.154.119✓

v1.13.8   OS列(host)            DG列(dig@1.1.1.1)   SB列(clash /dns/query)
          174.132.167.252!POISON 142.251.155.119✓    142.251.155.119✓
```

**关键观察**：

1. `OS` 列两个版本**都被 GFW 污染** → 确认 mDNSResponder 旁路是跨版本 OS 行为，不是 sing-box 回归
2. `DG` 列（`dig +short @1.1.1.1`，绕过 mDNSResponder 走路由表）两个版本**都正确** → 只要 DNS 包能进 TUN，sing-box 两个版本都能 sniff → hijack → 解析
3. `SB` 列（clash API 直问 sing-box 内部 DNS router）两个版本**都正确** → 内部 DNS router 完全 OK
4. 但对 `curl https://www.google.com`，**两个版本都 HTTP=000 超时** —— 迁移后的 config 无法恢复 `override_destination`，curl 拿到假 IP 后代理按假 IP dial 就崩了

用户"1.13.0 curl 能用"的记忆来自**原始未迁移 config**（带 legacy `sniff_override_destination: true`）的 TCP 阶段 SNI 补救。迁移后这条补救路径对两个版本都失效。

对照脚本：`config-tests/compare-versions.sh`（参见 sing-box 仓库）。

### 1.4 修复方案

既然 1.13.8 没了 `override_destination`，1.13 官方推荐的新方案是 **FakeIP + DNS hijack**。但 FakeIP 要求 **DNS 查询必须被 sing-box 看见**，才能返回 `198.18.x.x`。对绕过路由表的 DNS（mDNSResponder / Dnscache / SO_BINDTODEVICE），这一步在 userspace 永远无法完成。

**唯一可行解：把系统 DNS 指向 TUN 子网内的网关 IP（`172.19.0.1`）**。这个 IP 只能通过 TUN 到达，任何 `IP_BOUND_IF` 绑到物理接口的 DNS 查询都会因"目的地不可达"而由 OS 改走路由表，或直接落在 TUN 设备被 sing-box `hijack-dns` 捕获。

每个平台都有 OS 原生的"把 DNS 改回默认"命令，所以**恢复阶段不需要快照**：

| 平台 | 覆盖 | 原生恢复 |
|---|---|---|
| macOS | `networksetup -setdnsservers <svc> <gw>` | `networksetup -setdnsservers <svc> empty` |
| Linux | `resolvectl dns <iface> <gw>` | `resolvectl revert <iface>` |
| Windows | `Set-DnsClientServerAddress -InterfaceAlias <alias> -ServerAddresses <gw>` | `Set-DnsClientServerAddress -InterfaceAlias <alias> -ResetServerAddresses` |

### 1.5 macOS 实盘验证结果

```
HTTP probes (applied DNS override):
  google_204  (proxy)  HTTP=204 REMOTE=142.251.150.119  TIME=0.24s ✅
  youtube     (proxy)  HTTP=200 REMOTE=172.253.118.93   TIME=0.71s ✅
  github      (proxy)  HTTP=200 REMOTE=20.205.243.166   TIME=0.30s ✅

DNS table (三列完全一致真实 IP):
  www.google.com    OS=142.251.155.119  DG=142.251.155.119  SB=142.251.155.119
  www.youtube.com   OS=74.125.68.190    DG=74.125.68.190    SB=74.125.68.190
```

---

## 2. 代码改动摘要

### 2.1 设计原则（同 `CLAUDE.md`）

- **状态归系统所有**：不做用户原 DNS 的快照，不维护 marker 文件，不存 in-process state
- **操作幂等**：`apply` 写一次，`restore` 枚举重置所有接口、无论是否被 override 过都安全
- **Scorched-earth cleanup**：restore 不追踪"我设过哪个"，直接把系统里所有接口逐个 reset 到默认
- **Trade-off**：用户在**其他**接口上手动设的 DNS（比如 Wi-Fi 走 OneBox、同时 Ethernet 手动 `1.1.1.1`）停止时会被一并重置 → DHCP 默认。接受

### 2.2 共享辅助

**文件**：`src-tauri/src/vpn/helper.rs`

```rust
/// 从 sing-box 配置里解析 TUN inbound 的首个 IPv4 网关地址。
/// "172.19.0.1/30" → Some("172.19.0.1")。失败返回 None（fail-safe）。
pub fn extract_tun_gateway_from_config(config_path: &str) -> Option<String>
```

`dns_backup_path` 已删除 —— 没有任何平台使用备份文件。

### 2.3 macOS（已真机验证）

**文件**：`src-tauri/src/vpn/macos.rs`

```rust
pub fn apply_system_dns_override(password: &str, config_path: &str) -> Result<(), String>
pub fn restore_system_dns(password: &str) -> Result<(), String>
```

- `detect_active_network_service()` — `route -n get default` → `networksetup -listallhardwareports` 倒推服务名（`Wi-Fi` / `Ethernet` 等）
- `list_all_network_services()` — `networksetup -listallnetworkservices`，去掉标题行和 `*` 开头的禁用服务
- **apply**：检测当前活动服务 → `sudo networksetup -setdnsservers <svc> <gw>` → flush mDNSResponder
- **restore**：枚举所有服务 → 每个 `sudo networksetup -setdnsservers <svc> empty` → flush
- 无文件、无快照、无 stale marker 检查

挂点：
- `create_privileged_command` 尾部（sing-box spawn 之前）
- `stop_tun_process` 开头（kill sing-box 之前）

### 2.4 Linux（待真机验证）

**文件**：`src-tauri/src/vpn/linux.rs`

同签名。

- `detect_active_iface()` — `ip route get 1.1.1.1 | awk '/dev/ {...}'`
- `list_all_ifaces()` — `ip -br link show`，去掉 `lo` 和 `@parent` 后缀
- **apply**：`sudo resolvectl dns <iface> <gw>`
- **restore**：枚举所有 link → 每个 `sudo resolvectl revert <iface>`

`resolvectl revert` 是 systemd-resolved 官方的"回到 NetworkManager / netplan 配置"命令，对没被 override 过的 link 也是幂等 no-op。

**降级**：非 systemd-resolved 的发行版（CentOS / RHEL、某些精简 Debian）`resolvectl` 不存在，`apply` 报错被 warn 吞掉，TUN 正常启动但 DNS 泄漏不会修。可接受。

### 2.5 Windows（待真机验证）

**文件**：`src-tauri/src/vpn/windows.rs`

Windows 的关键约束：`Set-DnsClientServerAddress` 走 CIM，非管理员调用被拒。所以 DNS 操作**必须**在 elevated 上下文内跑。实现方式：把"设 DNS + 启动 sing-box"写到一个 PowerShell 脚本，通过 `ShellExecuteW runas` 提一次 UAC 跑完，stop 也是同一套机制。

```rust
pub fn apply ...    // 实际上嵌在 create_privileged_command 的 PS 脚本里
pub fn restore_system_dns() -> Result<(), String>   // 无 password 参数
```

- `detect_active_interface_alias()` — PS `Get-NetRoute -DestinationPrefix '0.0.0.0/0'`，按 `RouteMetric` 升序，**过滤** `InterfaceAlias -notmatch 'sing-box|WinTUN|utun'` 避免选到 TUN 适配器
- `build_dns_apply_block(alias, gw)` — 返回一段 PS 字符串：`Set-DnsClientServerAddress -InterfaceAlias '<alias>' -ServerAddresses '<gw>'; Clear-DnsClientCache`
- `build_dns_restore_block()` — 返回一段 PS 字符串：`Get-NetAdapter | ForEach-Object { Set-DnsClientServerAddress -InterfaceAlias $_.Name -ResetServerAddresses }; Clear-DnsClientCache`
- **apply 脚本**（`onebox-tun-start.ps1`）= `dns_apply_block` + `& '<sidecar>' run -c '<cfg>'`
- **stop 脚本**（`onebox-tun-stop.ps1`）= `dns_restore_block` + `taskkill /F /IM sing-box.exe`
- **crash 恢复脚本**（`onebox-dns-restore.ps1`）= 仅 `dns_restore_block`

crash 恢复会再弹一次 UAC —— 无法避免，但此时用户的网络已经断，提权代价可接受。

### 2.6 Watchdog 兜底（`core.rs`）

**文件**：`src-tauri/src/core.rs::handle_process_termination`

TUN 模式下 sing-box 进程退出时（正常 stop 路径之外），**无条件**调用对应平台的 `restore_system_dns`。没有 marker 文件检查 —— restore 现在三个平台都是幂等的枚举重置，即便正常 stop 已经跑过，再调一次也就是几条 `setdnsservers empty` 的 no-op。

关键改动：cleanup 块之前先把 `manager.tun_password.clone()` 捕获到局部变量，之后才允许 cleanup 清空 manager，这样 restore 才有密码可用（sudo）。Windows 不需要密码（UAC 走 ShellExecuteW）。

### 2.7 相关但独立：模板迁移 + 缓存购置

这轮工作同时完成 sing-box 配置模板的 1.13.8 迁移（去 legacy `sniff`，加 route-rule `sniff`），以及模板缓存 schema v2 + scorched-earth purge。详见 `CLAUDE.md` 的 "Config Template Loading Flow" 章节。

---

## 3. Linux 验证步骤（Ubuntu 18.04+）

### 3.1 前置

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev libgtk-3-dev \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
rustup target add x86_64-unknown-linux-gnu

# 确认 systemd-resolved 在跑
systemctl status systemd-resolved    # active (running)
resolvectl --version                  # 存在
```

### 3.2 编译

```bash
cd /path/to/OneBox
pnpm install
cd src-tauri && cargo check --target x86_64-unknown-linux-gnu    # 快速类型检查
cd .. && pnpm tauri build
```

编译时重点关注项（我在 macOS 上写的，没实机验证）：

- `use crate::vpn::helper::extract_tun_gateway_from_config;` — 只 import 这一个，`dns_backup_path` 已删
- `list_all_ifaces` 里的 awk 转义：`"ip -br link show 2>/dev/null | awk '{print $1}'"` —— Rust 字符串里嵌 shell 命令，单引号不需要转义
- `detect_active_iface` 里的 awk 转义：`"ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i==\"dev\") print $(i+1)}' | head -1"` —— 双引号需要 `\"` 转义

### 3.3 运行测试

启动 OneBox → 开启 TUN 模式 → 输入 sudo 密码。观察日志（OneBox 日志目录）：

```
[dns] resolvectl override → 172.19.0.1 for [wlp2s0]
```

应有的 DNS 行为：

```bash
host www.google.com
# 应返回真实 Google IP (142.x.x.x / 172.x.x.x)，不是 GFW 污染 IP

curl -v https://www.google.com/generate_204
# HTTP 204，REMOTE 是合理的 Google 段

resolvectl dns wlp2s0
# Link N (wlp2s0): 172.19.0.1
```

停止 TUN 模式后：

```
[dns] restore: reverting N links to defaults
```

```bash
resolvectl dns wlp2s0
# 恢复到 NetworkManager / netplan 配置的原值（或 DHCP 下发的）
```

### 3.4 crash 场景

模拟 sing-box 崩溃（另一终端 `sudo kill -9 <sing-box pid>`）。OneBox 的 `handle_process_termination` 会触发，日志应该有：

```
[dns] TUN process terminated — reverting all links to defaults
```

然后 `resolvectl dns <iface>` 应该已恢复。

### 3.5 Linux 风险点

1. **非 systemd-resolved 系统**：`resolvectl` 命令不存在 → apply 报 warn，TUN 能启动但 DNS 泄漏不会被修。可接受的降级
2. **`ip -br link show` 输出格式**：BusyBox `ip` 可能格式不同；生产 Ubuntu 上是 `<iface>[@<parent>] <state> <addr>` 格式，代码已处理 `@parent` 后缀
3. **多网卡场景**：`detect_active_iface` 只取默认路由的 interface。restore 阶段反正枚举所有 link，覆盖全
4. **WireGuard / 其他 VPN 接口**：restore 阶段会对这些 link 也调 `resolvectl revert`，它们之前如果有手动配置的 DNS 会被清掉。与 macOS 的 trade-off 一致

### 3.6 Linux 验证 checklist

- [ ] `cargo check --target x86_64-unknown-linux-gnu` 通过
- [ ] `pnpm tauri build` 通过
- [ ] TUN 启动日志看到 `[dns] resolvectl override → 172.19.0.1 for [<iface>]`
- [ ] `host www.google.com` 返回真实 Google IP
- [ ] `curl -v https://www.google.com/generate_204` 返回 HTTP 204
- [ ] `resolvectl dns <iface>` 显示 `172.19.0.1`
- [ ] 正常停止 TUN 后看到 `[dns] restore: reverting N links`，`resolvectl dns <iface>` 恢复原值
- [ ] `kill -9 sing-box` 后 OneBox 触发 watchdog 日志，DNS 被重置回默认

---

## 4. Windows 验证步骤

### 4.1 前置

Windows 10 / 11 开发机：

```powershell
rustup target add x86_64-pc-windows-msvc

# 内置 cmdlet 应存在
Get-Command Set-DnsClientServerAddress
Get-Command Get-NetRoute
Get-Command Get-NetAdapter
Get-Command Clear-DnsClientCache
```

### 4.2 编译

```powershell
cd C:\path\to\OneBox
pnpm install
pnpm tauri build
```

编译时重点关注项：

- `use std::process::Command as StdCommand;` — 和 `tauri_plugin_shell::process::Command as TauriCommand` 别名，不能漏
- `.args(["-NoProfile", "-NonInteractive", "-Command", ps.as_str()])` — 四个元素都必须是 `&str`，`ps.as_str()` 不要写成 `&ps`（`&String` 在 `[T; 4]` 同构里会报错）
- `build_dns_restore_block()` 返回的 PS 字符串里有嵌套单引号和 `$_.Name` —— 用 Rust raw string 或普通字符串都行，确认大括号没被 `format!` 吃掉

### 4.3 运行测试

启动 OneBox（UAC 弹窗），切到 TUN 模式。OneBox 日志（一般在 `%APPDATA%\onebox\logs\` 或 `%LOCALAPPDATA%\onebox\`）应看到：

```
[dns] elevated PS script dispatched — alias=[Wi-Fi] gateway=172.19.0.1
Enable tun mode via elevated PS: ...
```

同时 `%TEMP%\onebox-dns.log`（PS transcript 日志，见 `write_ps_script`）应该有：

```
[dns] override OK
[tun] starting sing-box
```

PowerShell 端验证：

```powershell
Get-DnsClientServerAddress -InterfaceAlias Wi-Fi -AddressFamily IPv4
# 显示 ServerAddresses = {172.19.0.1}

Resolve-DnsName www.google.com -Type A
# 应返回真实 Google IP

curl.exe -v https://www.google.com/generate_204
# HTTP 204
```

**关键风险点**：`Set-DnsClientServerAddress` 在非 elevated PS 里跑会报 "拒绝访问 / 无法从客户端发送 CIM 资源"。如果日志里看到这个错误，说明 UAC 提权的 PS 脚本没继承管理员令牌 —— 检查 `run_elevated_powershell_file` 的 `verb="runas"` 和 `SHOW_WINDOW_CMD(0)` 参数是否正确。

### 4.4 停止测试

正常停止 TUN 模式。OneBox 应再弹一次 UAC（`onebox-tun-stop.ps1`），日志看到：

```
[dns] reset Wi-Fi
[dns] reset Ethernet
...
[tun] killing sing-box
```

PowerShell 验证：

```powershell
Get-DnsClientServerAddress -InterfaceAlias Wi-Fi -AddressFamily IPv4
# ServerAddresses 应为空或 DHCP 下发的默认
```

### 4.5 crash 场景

强制结束 sing-box：

```powershell
Stop-Process -Name sing-box -Force
```

OneBox 的 `handle_process_termination` 会调 `restore_system_dns()`，触发 `onebox-dns-restore.ps1` 并**再弹一次 UAC**。用户必须点确认才能恢复 DNS。这是 Windows UAC 模型的限制，没有绕过方法。

**关键检查**：确认 UAC 真的弹了出来。某些 Windows 配置下（Always Notify 关闭、特定组策略）UAC 提示可能被吞。如果发生，`ShellExecuteW` 返回 0，日志会报 `ShellExecuteW failed: code 0`。

### 4.6 Windows 验证 checklist

- [ ] `cargo check --target x86_64-pc-windows-msvc` 通过
- [ ] `pnpm tauri build` 通过
- [ ] TUN 启动弹 UAC，`%TEMP%\onebox-dns.log` 有 `[dns] override OK`
- [ ] `Get-DnsClientServerAddress -InterfaceAlias <Active>` 显示 TUN 网关 IP
- [ ] `Resolve-DnsName www.google.com` 返回真实 IP
- [ ] `curl.exe -v https://www.google.com/generate_204` 返回 HTTP 204
- [ ] TUN 停止弹第二次 UAC，`Get-DnsClientServerAddress` 恢复
- [ ] `Stop-Process sing-box -Force` 触发 crash 恢复 UAC，DNS 最终被重置

---

## 5. 常见排错

### 5.1 "apply 成功了但 DNS 还是泄漏"

检查：

1. `networksetup -getdnsservers Wi-Fi` / `resolvectl dns <iface>` / `Get-DnsClientServerAddress` 的当前值是不是 `172.19.0.1`
2. sing-box 日志里有没有 `router: match[0] inbound=tun => sniff` + `sniffed protocol: dns`
3. `curl --resolve www.google.com:443:<fake_ip> ...` 是否被代理救回 —— 如果是，说明 TUN 捕获 OK，只是 DNS 应答被 GFW 污染在 mDNSResponder 层

如果 (1) 失败：检测到的服务名不对。macOS 上 `networksetup -listallhardwareports` 的输出可能和 `route get default` 拿到的 `interface:` 字段对不上（比如用了 Thunderbolt 网桥）。Linux 上 `ip route get 1.1.1.1` 可能返回 iface 带 `vrf` 修饰，解析需要更稳健。

### 5.2 "停止 OneBox 后网络断了"

DNS 被留在 TUN 网关（`172.19.0.1`），但 TUN 已拆，包没地方去 → 所有 DNS 查询超时。触发条件：`stop_tun_process` 的 restore 路径失败 **且** `handle_process_termination` 的兜底也没跑（或者跑了但失败）。

应急处理：
- macOS：`sudo networksetup -setdnsservers Wi-Fi empty`
- Linux：`sudo resolvectl revert <iface>`
- Windows (管理员 PS)：`Set-DnsClientServerAddress -InterfaceAlias <alias> -ResetServerAddresses`

修复方向：检查日志找 restore 失败的原因。最常见是 `detect_active_network_service` 在 TUN 启动期间检测到了 TUN 本身（没过滤掉）。对 Windows 已经有 `-notmatch 'sing-box|WinTUN|utun'` 过滤。

### 5.3 "用户反馈：我 Ethernet 原来手动配了 1.1.1.1，用了一次 OneBox 就被清掉了"

**这是已知的设计 trade-off**，不是 bug。参见 `CLAUDE.md::Design Philosophy #6`。restore 阶段是 scorched-earth 枚举重置，会把所有接口（不只是被 override 过的）都重置到 DHCP 默认。

如果用户真的强需求保留其他接口的手动 DNS，那是另一个功能（"只 reset 被 override 过的服务"），需要重新引入 per-interface 的 state 跟踪。当前不做。

### 5.4 "OneBox 启动时闪过一次 UAC 然后立刻弹第二次"（仅 Windows）

可能是：之前的会话 crash 后，`onebox-dns-restore.ps1` 被 `handle_process_termination` 触发了第一次 UAC（crash 恢复），紧接着用户又手动开 TUN 又弹了一次 UAC。

正常行为，不是 bug。如果想合并，要把 crash 恢复的 DNS reset 延迟到下次 TUN 启动时一起做，但那会留一段时间 DNS 卡在 TUN 网关上。**不建议合并**。

---

## 6. 相关文件清单

### Rust (src-tauri)

- `src/vpn/helper.rs` — `extract_tun_gateway_from_config`
- `src/vpn/macos.rs` — `apply_system_dns_override` / `restore_system_dns` / `detect_active_network_service` / `list_all_network_services` / `setdnsservers` / `flush_dns_cache`
- `src/vpn/linux.rs` — `apply_system_dns_override` / `restore_system_dns` / `detect_active_iface` / `list_all_ifaces`
- `src/vpn/windows.rs` — `prepare_dns_override` / `build_dns_apply_block` / `build_dns_restore_block` / `run_elevated_powershell_file` / `write_ps_script`
- `src/core.rs::handle_process_termination` — 无条件 watchdog fallback

### TypeScript (src)

- `src/config/version_1_12/zh-cn/config.ts` — 内置 TUN 模板（已迁移：去 legacy sniff、加 route-rule sniff）
- `src/config/common.ts` — `TEMPLATE_CACHE_SCHEMA_VERSION = 2`、`getConfigTemplateCacheKey`、`isStaleTemplatePathOverride`
- `src/hooks/useSwr.ts` — `primeConfigTemplateCache` / `purgeLegacyTemplateCache`
- `src/single/store.ts::getDefaultConfigTemplateURL` — 按 patch 版本选 `conf/1.13.8/` vs `conf/1.13/`
- `src/App.tsx` — mount prime + purge SWR hooks

### 测试脚手架（sing-box 仓库）

- `config-tests/generate.sh` — 生成变体 A–G
- `config-tests/run-variant.sh` — 单变体测试（含可选 `FIX_DNS=1` 调 `fix-macos-dns.sh`）
- `config-tests/run-all.sh` — 跑所有变体并输出裁决表
- `config-tests/compare-versions.sh` — 1.13.0 vs 1.13.8 对照实验（不设系统 DNS 覆盖）
- `config-tests/launch.sh` — 手动测试时的前台启动脚本
- `config-tests/run-clean.sh` — 不动系统 DNS 的纯净启动脚本（测试 1.13.8 在无覆盖时的行为）
- `config-tests/fix-macos-dns.sh` — 独立的 DNS 覆盖 / 恢复脚本

---

## 7. 遗留待办

- [ ] Linux (Ubuntu 22.04+) 真机编译 + 运行验证（section 3）
- [ ] Windows 10/11 真机编译 + 运行验证（section 4）
- [ ] `src/types/definition.ts::SING_BOX_MINOR_VERSION` 从 `"0"` 升到 `"8"` 或以上（跟随 sing-box 二进制升级时改）
- [ ] conf-template 仓库里 `conf/1.13.8/zh-cn/` 的同步 push（可能还在 dev 分支未同步到 stable / beta）
