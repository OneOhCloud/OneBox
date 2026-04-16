# OneBox privileged helper

A root-level launchd daemon invoked from the OneBox main app via XPC. Its only
purpose is to run privileged operations (TUN startup, DNS override, IP
forwarding, route cleanup) without the main app ever holding the user's sudo
password. It replaces the `echo 'PASSWORD' | sudo -S ...` pattern that leaks
credentials via `ps -ef`.

## Status

- **Phase 1** (done): helper binary, SMJobBless install from the main app,
  XPC plumbing, tauri-native bundle integration, audit-token caller
  validation in `shouldAcceptNewConnection`. Only `ping` is exposed.
- **Phase 2+** (TODO): migrate the real privileged calls (sing-box startup,
  DNS override, IP forwarding, route cleanup) off `echo | sudo -S` onto
  helper methods, then delete the password-based code paths from
  `src-tauri/src/vpn/macos.rs`.

## Layout

```
src-tauri/helper/
  Sources/main.m        Objective-C XPC protocol + NSXPCListener + caller
                        validation (audit_token_t -> SecCode ->
                        SecCodeCheckValidity against hard-coded DR).
  Info.plist            Embedded via __TEXT,__info_plist — lists the main
                        app's designated requirement in SMAuthorizedClients
                        (checked at SMJobBless install time).
  Launchd.plist         Embedded via __TEXT,__launchd_plist — launchd reads
                        Label + MachServices straight out of the binary.
  README.md             This file.
```

Neither plist is consumed from disk at runtime. `SMJobBless` and `launchd`
read them directly out of the `__TEXT` sections inside the binary, which is
why `scripts/build-helper.sh` passes `-sectcreate` to the linker. The
on-disk copies are only the source of truth for the embed step.

## Build pipeline

The helper is built, signed, and placed inside the `.app` bundle entirely
through `cargo tauri build`:

1. `scripts/prebundle.sh` is wired into `tauri.conf.json`
   `build.beforeBundleCommand`. It runs *after* the Rust binary compiles and
   *before* Tauri assembles the `.app`.
2. `prebundle.sh` invokes `scripts/build-helper.sh` (clang -fobjc-arc +
   `-sectcreate` + `lipo` to produce a universal Mach-O) then
   `scripts/sign-helper.sh` (codesign with hardened runtime + DR check).
3. Tauri's `copy_custom_files_to_bundle` reads
   `bundle.macOS.files` from `tauri.macos.conf.json` and copies the signed
   helper into `OneBox.app/Contents/Library/LaunchServices/`.
4. Tauri's `create_info_plist` merges
   `src-tauri/Info.privileged-helper.plist` (containing only
   `SMPrivilegedExecutables`) into the main app's `Info.plist`.
5. Tauri runs `codesign --force -s <identity>` on the outer bundle. No
   `--deep`, so the helper's pre-signed identifier, hardened-runtime flag,
   and embedded sections are preserved — the bundle only re-hashes them
   into `CodeResources`.
6. DMG / updater / notarization continue through Tauri's normal flow; they
   all see the patched bundle.

No post-build scripts. No Info.plist re-injection. No re-sign. The whole
integration is now just three config lines + one prebuild shell script.

## Hard-coded invariants

- **Main app bundle identifier**: `cloud.oneoh.onebox`.
- **Helper bundle identifier**: `cloud.oneoh.onebox.helper`. Changing this
  requires updating `Info.plist` (`CFBundleIdentifier`), `Launchd.plist`
  (`Label` and `MachServices` key), every `machServiceName:` reference in
  `Sources/main.m` and `src-tauri/src/helper_client.m`, and the
  `SMPrivilegedExecutables` key in `src-tauri/Info.privileged-helper.plist`.
- **Team ID**: `GN2W3N34TM`. Appears in four places that must stay in sync:
  `Info.plist` `SMAuthorizedClients` (install-time gate), `Sources/main.m`
  `kClientRequirement` (runtime gate), `Info.privileged-helper.plist`
  `SMPrivilegedExecutables` (main app → helper DR), and the signing
  identity in `scripts/sign-helper.sh` + `tauri.macos.conf.json`
  `signingIdentity`.
- **Mach service name**: matches the helper bundle identifier. launchd
  publishes the service under this name; the client connects with
  `NSXPCConnection(machServiceName:options:.privileged)`.

## Caller validation

`validateClient()` in `Sources/main.m` resolves each incoming
`NSXPCConnection`'s `audit_token_t` (via the undocumented-but-stable
`auditToken` property) to a `SecCodeRef`, then calls
`SecCodeCheckValidity` against a hard-coded requirement string
(`identifier "cloud.oneoh.onebox" and anchor apple generic and certificate
1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[...]
and subject.OU = "GN2W3N34TM"`). Any other local process — unsigned,
different Team ID, tampered — is rejected at `shouldAcceptNewConnection`
and never reaches an exported method.

This complements the install-time `SMAuthorizedClients` gate: SMJobBless
refuses to bless a helper whose embedded `SMAuthorizedClients` list doesn't
include the caller's DR, but that only validates "can this app install me"
once. The runtime check validates "can this peer call me right now" on
every connection.
