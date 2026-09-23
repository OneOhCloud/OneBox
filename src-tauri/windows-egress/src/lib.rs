use serde_json::Value;
use std::net::Ipv6Addr;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Policy {
    SystemDefault,
    BoundSource {
        interface: String,
        address: Ipv6Addr,
    },
    Ipv4Fallback,
}

#[cfg(windows)]
pub mod native;
pub mod probe;
pub mod transaction;

pub fn effective_config(base: &Value, policy: &Policy) -> Result<Value, String> {
    if !base.is_object() {
        return Err("configuration must be a JSON object".into());
    }
    let mut effective = base.clone();
    let is_tun = base["inbounds"]
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item["type"] == "tun"));
    if !is_tun
        || policy == &Policy::SystemDefault
        || base["route"].get("default_interface").is_some()
    {
        return Ok(effective);
    }
    let Some(outbounds) = effective["outbounds"].as_array_mut() else {
        return Ok(effective);
    };
    let eligible = |outbound: &Value| {
        outbound["type"] == "direct"
            && [
                "bind_interface",
                "inet4_bind_address",
                "inet6_bind_address",
                "network_strategy",
                "network_type",
            ]
            .iter()
            .all(|key| outbound.get(key).is_none())
    };
    let has_managed_direct = outbounds.iter().any(eligible);
    match policy {
        Policy::BoundSource { interface, address } => {
            for outbound in outbounds.iter_mut().filter(|outbound| eligible(outbound)) {
                outbound["bind_interface"] = interface.clone().into();
                outbound["inet6_bind_address"] = address.to_string().into();
            }
        }
        Policy::Ipv4Fallback if has_managed_direct => {
            effective["dns"]["strategy"] = "ipv4_only".into();
        }
        _ => {}
    }
    Ok(effective)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> Value {
        json!({
            "dns": {"strategy":"prefer_ipv4", "servers":[{"tag":"system","type":"udp","server":"223.5.5.5"}]},
            "inbounds": [{"type":"tun","tag":"tun","strict_route":true}],
            "outbounds": [
                {"tag":"direct","type":"direct","domain_resolver":"system"},
                {"tag":"proxy","type":"tuic","server":"example.com"}
            ],
            "route": {"auto_detect_interface":true,"rules":[{"rule_set":["geoip-cn"],"outbound":"direct"}]}
        })
    }

    fn bound() -> Policy {
        Policy::BoundSource {
            interface: "以太网".into(),
            address: "2001:db8::2".parse().unwrap(),
        }
    }

    #[test]
    fn default_policy_preserves_the_entire_configuration() {
        let config = base();
        assert_eq!(
            effective_config(&config, &Policy::SystemDefault).unwrap(),
            config
        );
    }

    #[test]
    fn binds_both_source_and_interface_without_changing_routing_or_proxy() {
        let config = base();
        let effective = effective_config(&config, &bound()).unwrap();
        assert_eq!(
            effective["outbounds"][0]["inet6_bind_address"],
            "2001:db8::2"
        );
        assert_eq!(effective["outbounds"][0]["bind_interface"], "以太网");
        assert_eq!(effective["route"], config["route"]);
        assert_eq!(effective["outbounds"][1], config["outbounds"][1]);
        assert_eq!(config, base());
    }

    #[test]
    fn fallback_and_recovery_are_derived_from_the_original_configuration() {
        let config = base();
        assert_eq!(
            effective_config(&config, &Policy::Ipv4Fallback).unwrap()["dns"]["strategy"],
            "ipv4_only"
        );
        assert_eq!(
            effective_config(&config, &Policy::SystemDefault).unwrap(),
            config
        );
    }

    #[test]
    fn explicit_user_binding_is_never_replaced() {
        let mut config = base();
        config["outbounds"][0]["bind_interface"] = json!("Corporate VPN");
        assert_eq!(effective_config(&config, &bound()).unwrap(), config);
        assert_eq!(
            effective_config(&config, &Policy::Ipv4Fallback).unwrap(),
            config
        );
    }

    #[test]
    fn ordinary_proxy_configuration_is_unchanged() {
        let mut config = base();
        config["inbounds"] = json!([{"type":"mixed"}]);
        assert_eq!(effective_config(&config, &bound()).unwrap(), config);
    }
}
