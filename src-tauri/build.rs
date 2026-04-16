fn main() {
    // ACCELERATE_URL is a secret fallback endpoint.
    //
    // Local builds:  set the env var before building.
    //   export ACCELERATE_URL=https://...
    //   cargo tauri build
    //
    // CI (GitHub Actions): store the value as a repository secret and expose it
    // only to the build job — never echo it or print it in workflow steps:
    //   env:
    //     ACCELERATE_URL: ${{ secrets.ACCELERATE_URL }}
    //
    // The `cargo:rustc-env=` directive below is consumed silently by Cargo and
    // does NOT appear in CI logs. Avoid printing the value anywhere else.
    let accelerate_url = std::env::var("ACCELERATE_URL").unwrap_or_default();
    println!("cargo:rustc-env=ACCELERATE_URL={}", accelerate_url);
    println!("cargo:rerun-if-env-changed=ACCELERATE_URL");

    // Compile the Objective-C XPC client shim used to talk to the macOS
    // privileged helper (see src/engine/macos/helper.m).
    //
    // Two gates, both necessary:
    //
    //   - Outer `#[cfg(target_os = "macos")]`: in a build script this
    //     resolves against the HOST. Non-mac hosts don't have the `cc`
    //     crate in scope (Cargo.toml declares it as a macOS-only
    //     build-dependency), so we mustn't even mention `cc::Build` in
    //     their compile.
    //
    //   - Inner `CARGO_CFG_TARGET_OS` check: on a mac host cross-
    //     compiling to Linux/Windows, the outer gate still passes but
    //     running clang-over-ObjC would fail against a non-mac sysroot.
    //     Skip the compile when the TARGET isn't mac.
    //
    // Cross-compiling mac ObjC from non-mac hosts is a non-goal (and
    // clang/ObjC toolchains don't readily support it), so the host-
    // gated outer cfg doesn't lose any supported configurations.
    #[cfg(target_os = "macos")]
    {
        if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
            cc::Build::new()
                .file("src/engine/macos/helper.m")
                .flag("-fobjc-arc")
                .flag("-fmodules")
                .compile("onebox_helper_client");
            println!("cargo:rustc-link-lib=framework=Foundation");
            println!("cargo:rustc-link-lib=framework=ServiceManagement");
            println!("cargo:rustc-link-lib=framework=Security");
            println!("cargo:rerun-if-changed=src/engine/macos/helper.m");
        }
    }

    tauri_build::build()
}
