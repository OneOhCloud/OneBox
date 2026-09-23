use crate::probe::{Network, Probe, Reachability};
use std::{
    net::{IpAddr, Ipv6Addr, SocketAddr},
    os::windows::io::AsRawSocket,
    time::Duration,
};
use windows::Win32::{
    NetworkManagement::{IpHelper::*, Ndis::IfOperStatusUp},
    Networking::WinSock::*,
};

struct Table(*const std::ffi::c_void);
impl Drop for Table {
    fn drop(&mut self) {
        unsafe { FreeMibTable(self.0) }
    }
}

pub fn snapshot(tunnel_interfaces: &[String]) -> Result<Network, String> {
    unsafe {
        let mut size = 16_384u32;
        let mut buffer = Vec::<u64>::new();
        let mut success = false;
        for _ in 0..3 {
            buffer.resize((size as usize + 7) / 8, 0);
            let result = GetAdaptersAddresses(
                AF_UNSPEC.0 as u32,
                GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
                None,
                Some(buffer.as_mut_ptr().cast()),
                &mut size,
            );
            if result == 0 {
                success = true;
                break;
            }
            if result != 111 {
                return Err(format!("adapter enumeration failed: {result}"));
            }
        }
        if !success {
            return Err("adapter enumeration changed repeatedly".into());
        }
        let mut adapters = Vec::new();
        let mut adapter = buffer.as_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
        while !adapter.is_null() {
            let row = &*adapter;
            let name = row
                .FriendlyName
                .to_string()
                .map_err(|error| error.to_string())?;
            let description = row.Description.to_string().unwrap_or_default();
            // The application's tunnel must never become the control probe's egress.
            if row.OperStatus == IfOperStatusUp
                && !tunnel_interfaces.contains(&name)
                && !description.to_lowercase().contains("sing-box")
            {
                adapters.push((
                    row.Luid.Value,
                    row.Anonymous1.Anonymous.IfIndex,
                    row.Ipv6IfIndex,
                    name,
                    row.Ipv4Metric,
                    row.Ipv6Metric,
                ));
            }
            adapter = row.Next;
        }
        let mut table = std::ptr::null_mut();
        GetIpForwardTable2(AF_UNSPEC, &mut table)
            .ok()
            .map_err(|error| error.to_string())?;
        let _table = Table(table.cast());
        let routes =
            std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
        let mut defaults = Vec::new();
        for route in routes
            .iter()
            .filter(|route| route.DestinationPrefix.PrefixLength == 0)
        {
            if let Some(adapter) = adapters
                .iter()
                .find(|adapter| adapter.0 == route.InterfaceLuid.Value)
            {
                let ipv4 = route.DestinationPrefix.Prefix.si_family == AF_INET;
                let metric = route.Metric as u64 + if ipv4 { adapter.4 } else { adapter.5 } as u64;
                defaults.push((!ipv4, metric, adapter, route));
            }
        }
        defaults.sort_by_key(|item| (item.0, item.1));
        let (_, _, adapter, route) = defaults.first().ok_or("no default egress interface")?;
        let mut addresses = std::ptr::null_mut();
        GetUnicastIpAddressTable(AF_INET6, &mut addresses)
            .ok()
            .map_err(|error| error.to_string())?;
        let _addresses = Table(addresses.cast());
        let mut sources = Vec::new();
        for row in std::slice::from_raw_parts(
            (*addresses).Table.as_ptr(),
            (*addresses).NumEntries as usize,
        ) {
            if row.InterfaceLuid.Value != adapter.0
                || row.SkipAsSource
                || row.DadState != IpDadStatePreferred
                || row.PreferredLifetime == 0
            {
                continue;
            }
            let address = Ipv6Addr::from(row.Address.Ipv6.sin6_addr.u.Byte);
            // Public unicast only: ULA, link-local and tunnel addresses aren't internet candidates.
            if address.segments()[0] & 0xe000 == 0x2000 {
                sources.push(address);
            }
        }
        sources.sort();
        sources.dedup();
        let gateway = if route.NextHop.si_family == AF_INET6 {
            format!("{:?}", route.NextHop.Ipv6.sin6_addr.u.Byte)
        } else {
            format!("{:?}", route.NextHop.Ipv4.sin_addr.S_un.S_addr)
        };
        let route_identity: Vec<_> = defaults
            .iter()
            .filter(|item| item.2 .0 == adapter.0)
            .map(|item| {
                let next_hop = if item.3.NextHop.si_family == AF_INET6 {
                    format!("{:?}", item.3.NextHop.Ipv6.sin6_addr.u.Byte)
                } else {
                    format!("{:?}", item.3.NextHop.Ipv4.sin_addr.S_un.S_addr)
                };
                (item.0, item.1, next_hop)
            })
            .collect();
        let identity = format!("{}:{gateway}:{route_identity:?}:{sources:?}", adapter.0);
        Ok(Network {
            interface: adapter.3.clone(),
            ipv4_index: adapter.1,
            ipv6_index: adapter.2,
            sources,
            identity,
        })
    }
}

pub struct NativeProbe;
impl Probe for NativeProbe {
    async fn connect(
        &self,
        network: &Network,
        destination: SocketAddr,
        source: Option<IpAddr>,
    ) -> Reachability {
        let socket = match if destination.is_ipv6() {
            tokio::net::TcpSocket::new_v6()
        } else {
            tokio::net::TcpSocket::new_v4()
        } {
            Ok(socket) => socket,
            Err(_) => return Reachability::Uncertain,
        };
        let (level, option, index) = if destination.is_ipv6() {
            (
                IPPROTO_IPV6.0,
                IPV6_UNICAST_IF,
                network.ipv6_index.to_ne_bytes(),
            )
        } else {
            (
                IPPROTO_IP.0,
                IP_UNICAST_IF,
                network.ipv4_index.to_be_bytes(),
            )
        };
        if unsafe {
            setsockopt(
                SOCKET(socket.as_raw_socket() as usize),
                level,
                option,
                Some(&index),
            )
        } != 0
        {
            return Reachability::Uncertain;
        }
        if let Some(source) = source {
            if socket.bind(SocketAddr::new(source, 0)).is_err() {
                return Reachability::Uncertain;
            }
        }
        match tokio::time::timeout(Duration::from_secs(2), socket.connect(destination)).await {
            Ok(Ok(_)) => Reachability::Reachable,
            Ok(Err(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::AddrNotAvailable | std::io::ErrorKind::PermissionDenied
                ) =>
            {
                Reachability::Uncertain
            }
            _ => Reachability::Failed,
        }
    }
}

static CHANGED: tokio::sync::Notify = tokio::sync::Notify::const_new();
pub fn notify() {
    CHANGED.notify_one();
}
pub async fn changed() {
    CHANGED.notified().await;
}
unsafe extern "system" fn route_changed(
    _: *const std::ffi::c_void,
    _: *const MIB_IPFORWARD_ROW2,
    _: MIB_NOTIFICATION_TYPE,
) {
    notify();
}
unsafe extern "system" fn address_changed(
    _: *const std::ffi::c_void,
    _: *const MIB_UNICASTIPADDRESS_ROW,
    _: MIB_NOTIFICATION_TYPE,
) {
    notify();
}
pub struct Notifications(Vec<usize>);
impl Notifications {
    pub fn register() -> Result<Self, String> {
        unsafe {
            let mut result = Self(Vec::new());
            let mut handle = Default::default();
            NotifyRouteChange2(
                AF_UNSPEC,
                Some(route_changed),
                std::ptr::null(),
                false,
                &mut handle,
            )
            .ok()
            .map_err(|error| error.to_string())?;
            result.0.push(handle.0 as usize);
            NotifyUnicastIpAddressChange(
                AF_UNSPEC,
                Some(address_changed),
                None,
                false,
                &mut handle,
            )
            .ok()
            .map_err(|error| error.to_string())?;
            result.0.push(handle.0 as usize);
            Ok(result)
        }
    }
}
impl Drop for Notifications {
    fn drop(&mut self) {
        for handle in &self.0 {
            unsafe {
                let _ =
                    CancelMibChangeNotify2(windows::Win32::Foundation::HANDLE(*handle as *mut _));
            }
        }
    }
}
