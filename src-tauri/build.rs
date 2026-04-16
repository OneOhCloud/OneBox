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
    // privileged helper (see src/helper_client.m). Phase 1b only uses it for
    // a ping round-trip; real privileged operations land in later phases.
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/helper_client.m")
            .flag("-fobjc-arc")
            .flag("-fmodules")
            .compile("onebox_helper_client");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=ServiceManagement");
        println!("cargo:rustc-link-lib=framework=Security");
        println!("cargo:rerun-if-changed=src/helper_client.m");
    }

    tauri_build::build()
}
