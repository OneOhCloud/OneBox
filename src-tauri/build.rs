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
    tauri_build::build()
}
