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
    // privileged helper (see src/engine/macos/helper.m). Gate on the
    // TARGET's os, not the host's: a bare `#[cfg(target_os = ...)]`
    // inside a build script resolves against the HOST, so a macOS host
    // cross-compiling to Linux/Windows would otherwise try (and fail)
    // to run clang over ObjC here. `CARGO_CFG_TARGET_OS` is Cargo's
    // standard way to inspect the target from a build script.
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

    tauri_build::build()
}
