use super::*;

#[test]
fn test_best_dns_server_selection() {
    // 由于实际的网络条件会影响测试结果，这里只测试是否能成功返回一个 DNS 服务器
    let rt = tokio::runtime::Runtime::new().unwrap();
    let res = rt.block_on(get_best_dns_server());
    println!("Best DNS server: {:?}", res);
    assert!(res.is_some());
}

// 在 macOS 平台上测试 is_private_ip
#[cfg(target_os = "macos")]
#[test]
fn test_is_private_ip_macos() {
    assert!(is_private_ip("10.0.0.1"));
    assert!(is_private_ip("172.16.5.4"));
    assert!(is_private_ip("192.168.0.100"));
    assert!(!is_private_ip("8.8.8.8"));
}
