#[cfg(windows)]
#[tokio::main(flavor = "current_thread")]
async fn main() {
    use onebox_windows_egress::{native, probe, Policy};
    match native::snapshot(&["tun0".into()]) {
        Ok(network) => {
            println!(
                "Egress: {}; IPv6 candidates: {}",
                network.interface,
                network.sources.len()
            );
            println!(
                "Observed policy: {:?}",
                probe::observe(
                    std::sync::Arc::new(native::NativeProbe),
                    network,
                    &Policy::SystemDefault
                )
                .await
            );
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
#[cfg(not(windows))]
fn main() {}
