# Windows TUN: domestic direct connections time out

## Evidence (2026-09-23)

On the affected Windows host, official sing-box 1.14.1 could reach Google
through the proxy in TUN mode. Domestic direct IPv4 requests succeeded, while
IPv6 requests timed out. Mixed-mode domain requests succeeded through IPv4.

The default Ethernet adapter had preferred global IPv6 addresses from two
prefixes. Windows selected the broken prefix for outbound connections, including
sing-box connections observed in `SynSent`. Binding a TCP probe to the other
prefix on the same interface succeeded. An isolated official sing-box process
with both `inet6_bind_address` and `bind_interface` then reached Baidu over IPv6
and retained IPv4 connectivity. No kernel modification was necessary.

Changing only DNS preference cannot repair a connection already addressed to a
real IPv6 literal. Binding only the IPv6 address is also insufficient: sing-box
then bypasses automatic interface detection, so IPv4 needs the explicit interface
binding too. Windows redirected stdin may use GB2312; runtime JSON must use UTF-8
for interface aliases such as `以太网`.

## Implementation

`src-tauri/windows-egress` enumerates Windows default routes and preferred global
unicast sources through IP Helper. Probes are TCP/443 connections explicitly bound
to the selected egress interface, using two AliDNS dual-stack endpoints. Default
IPv6 is tried first, then candidate sources with bounded concurrency. Every socket
has a two-second deadline; a round has a six-second deadline. Offline, incomplete,
and setup-error observations do not trigger IPv4 fallback.

Two consecutive observations on the same network confirm a policy change:

- Healthy default source: preserve the base configuration.
- Healthy alternative source: bind automatically managed direct outbounds to its
  address and interface; preserve DNS policy and proxy outbounds.
- No working IPv6 candidate, with a working IPv4 control: temporarily use
  `dns.strategy = ipv4_only`.

Explicit direct bindings and ordinary mixed-mode configurations are preserved.
Every effective configuration is derived from the base, written as a separate
UTF-8 file, validated by the bundled official `sing-box check`, and activated only
when its content differs. Activation failure restores the previous validated
configuration and stops automatic retries. Manual reload can retry. The config
viewer reads the active runtime file.

The monitor checks every 60 seconds and listens for route/address notifications.
Wake/network-up events force a check; unchanged topology notifications from the
application's own TUN are ignored. Lifecycle operations share a lock and a session
generation prevents stale probes from restarting a stopped session.

## Reproduce and verify on Windows

```powershell
cargo test --manifest-path src-tauri/Cargo.toml -p onebox-windows-egress
cargo test --manifest-path src-tauri/Cargo.toml -p one-box --lib
cargo run --manifest-path src-tauri/Cargo.toml -p onebox-windows-egress --example diagnose
curl.exe --noproxy "*" --max-time 10 -4 https://www.baidu.com/ -o NUL -w "%{http_code}"
curl.exe --noproxy "*" --max-time 10 -6 https://www.baidu.com/ -o NUL -w "%{http_code}"
curl.exe --noproxy "*" --max-time 10 https://www.google.com/ -o NUL -w "%{http_code}"
```

Tests use fake probes and cover healthy IPv6, alternative prefixes, retention of
an existing binding, fallback, offline and incomplete observations, deadlines,
confirmation hysteresis, base immutability, Chinese interface aliases, explicit
bindings, ordinary proxy mode, and replacement/rollback. Application tests cover
runtime validation failure and removal of rejected files.

IPv4 fallback cannot make IPv6-only direct destinations or literal IPv6 addresses
reachable when the upstream has no usable IPv6. Existing application DNS caches
may retain AAAA answers briefly. Policy activation restarts the TUN service and
uses its existing DNS-cache flush; active connections can be interrupted.

## Acceptance results

On the affected host, the application selected a healthy source automatically
and remained in TUN mode with the original `prefer_ipv4` DNS strategy. Baidu and
Google returned HTTP 200 over both IPv4 and IPv6; QQ responded over both families
with its existing HTTP 501 response to curl. The official sing-box executable's
SHA-256 stayed unchanged.

Reloading unchanged input retained the same sing-box PID. Changed input restarted
the service successfully. A configuration rejected by `sing-box check` left the
previous runtime content and running state intact. After Stop, the app remained
idle beyond the 60-second monitor interval; a subsequent Start succeeded. Actual
service activation rollback is covered by fake-activation tests; the live rejection
experiment exercises validation before activation, not that rollback branch.
