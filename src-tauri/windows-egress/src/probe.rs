use crate::Policy;
use std::{future::Future, net::IpAddr, sync::Arc, time::Duration};

pub const TARGETS: [(&str, &str); 2] = [
    ("223.5.5.5:443", "[2400:3200::1]:443"),
    ("223.6.6.6:443", "[2400:3200:baba::1]:443"),
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Network {
    pub interface: String,
    pub ipv4_index: u32,
    pub ipv6_index: u32,
    pub sources: Vec<std::net::Ipv6Addr>,
    pub identity: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reachability {
    Reachable,
    Failed,
    Uncertain,
}

pub trait Probe: Send + Sync + 'static {
    fn connect(
        &self,
        network: &Network,
        destination: std::net::SocketAddr,
        source: Option<IpAddr>,
    ) -> impl Future<Output = Reachability> + Send;
}

async fn pair<P: Probe>(
    probe: &P,
    network: &Network,
    source: Option<IpAddr>,
    destinations: [std::net::SocketAddr; 2],
) -> Reachability {
    let (first, second) = tokio::join!(
        probe.connect(network, destinations[0], source),
        probe.connect(network, destinations[1], source)
    );
    if [first, second].contains(&Reachability::Reachable) {
        Reachability::Reachable
    } else if [first, second].contains(&Reachability::Uncertain) {
        Reachability::Uncertain
    } else {
        Reachability::Failed
    }
}

pub async fn observe<P: Probe>(
    probe: Arc<P>,
    network: Network,
    current: &Policy,
) -> Option<Policy> {
    tokio::time::timeout(Duration::from_secs(6), async {
        let ipv6 = TARGETS.map(|target| target.1.parse().expect("static IPv6 target"));
        let default = pair(probe.as_ref(), &network, None, ipv6).await;
        if default == Reachability::Reachable {
            return Some(Policy::SystemDefault);
        }
        let mut sources = network.sources.clone();
        if let Policy::BoundSource { interface, address } = current {
            if *interface == network.interface {
                sources.sort_by_key(|source| source != address);
            }
        }
        let mut candidates = tokio::task::JoinSet::new();
        // Bound parallelism prevents a machine with many temporary addresses from flooding probes.
        let permits = Arc::new(tokio::sync::Semaphore::new(8));
        for (priority, source) in sources.into_iter().enumerate() {
            let probe = probe.clone();
            let network = network.clone();
            let permits = permits.clone();
            candidates.spawn(async move {
                let _permit = permits
                    .acquire()
                    .await
                    .expect("probe semaphore remains open");
                (
                    priority,
                    source,
                    pair(probe.as_ref(), &network, Some(source.into()), ipv6).await,
                )
            });
        }
        let ipv4 = TARGETS.map(|target| target.0.parse().expect("static IPv4 target"));
        let control = pair(probe.as_ref(), &network, None, ipv4).await;
        let mut results = Vec::new();
        while let Some(result) = candidates.join_next().await {
            results.push(result.ok()?);
        }
        results.sort_by_key(|result| result.0);
        if let Some((_, address, _)) = results
            .iter()
            .find(|result| result.2 == Reachability::Reachable)
        {
            return Some(Policy::BoundSource {
                interface: network.interface,
                address: *address,
            });
        }
        if default == Reachability::Failed
            && control == Reachability::Reachable
            && results
                .iter()
                .all(|result| result.2 == Reachability::Failed)
        {
            Some(Policy::Ipv4Fallback)
        } else {
            None
        }
    })
    .await
    .ok()
    .flatten()
}

#[derive(Default)]
pub struct Confirmation {
    pending: Option<(String, Policy)>,
}
impl Confirmation {
    pub fn observe(
        &mut self,
        network: &Network,
        observation: Option<Policy>,
        current: &Policy,
    ) -> Option<Policy> {
        let Some(policy) = observation.filter(|policy| policy != current) else {
            self.pending = None;
            return None;
        };
        let next = (network.identity.clone(), policy.clone());
        if self.pending.as_ref() == Some(&next) {
            self.pending = None;
            Some(policy)
        } else {
            self.pending = Some(next);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct FakeProbe {
        default: Reachability,
        candidate: Reachability,
        ipv4: Reachability,
    }
    impl Probe for FakeProbe {
        async fn connect(
            &self,
            _: &Network,
            target: std::net::SocketAddr,
            source: Option<IpAddr>,
        ) -> Reachability {
            if target.is_ipv4() {
                self.ipv4
            } else if source.is_some() {
                self.candidate
            } else {
                self.default
            }
        }
    }
    fn network() -> Network {
        Network {
            interface: "以太网".into(),
            ipv4_index: 19,
            ipv6_index: 19,
            sources: vec!["2001:db8::2".parse().unwrap()],
            identity: "network-a".into(),
        }
    }
    #[tokio::test]
    async fn retains_healthy_system_ipv6() {
        let probe = FakeProbe {
            default: Reachability::Reachable,
            candidate: Reachability::Failed,
            ipv4: Reachability::Failed,
        };
        assert_eq!(
            observe(Arc::new(probe), network(), &Policy::Ipv4Fallback).await,
            Some(Policy::SystemDefault)
        );
    }
    #[tokio::test]
    async fn repairs_broken_default_source_with_a_healthy_candidate() {
        let probe = FakeProbe {
            default: Reachability::Failed,
            candidate: Reachability::Reachable,
            ipv4: Reachability::Reachable,
        };
        assert_eq!(
            observe(Arc::new(probe), network(), &Policy::SystemDefault).await,
            Some(Policy::BoundSource {
                interface: "以太网".into(),
                address: network().sources[0]
            })
        );
    }
    #[tokio::test]
    async fn offline_is_not_evidence_for_ipv4_fallback() {
        let probe = FakeProbe {
            default: Reachability::Failed,
            candidate: Reachability::Failed,
            ipv4: Reachability::Failed,
        };
        assert_eq!(
            observe(Arc::new(probe), network(), &Policy::SystemDefault).await,
            None
        );
    }
    #[tokio::test]
    async fn incomplete_probe_is_not_evidence_for_ipv4_fallback() {
        let probe = FakeProbe {
            default: Reachability::Uncertain,
            candidate: Reachability::Failed,
            ipv4: Reachability::Reachable,
        };
        assert_eq!(
            observe(Arc::new(probe), network(), &Policy::SystemDefault).await,
            None
        );
    }
    #[test]
    fn policy_changes_need_two_consecutive_observations_on_the_same_network() {
        let mut tracker = Confirmation::default();
        let current = Policy::SystemDefault;
        assert_eq!(
            tracker.observe(&network(), Some(Policy::Ipv4Fallback), &current),
            None
        );
        assert_eq!(tracker.observe(&network(), None, &current), None);
        assert_eq!(
            tracker.observe(&network(), Some(Policy::Ipv4Fallback), &current),
            None
        );
        assert_eq!(
            tracker.observe(&network(), Some(Policy::Ipv4Fallback), &current),
            Some(Policy::Ipv4Fallback)
        );
        let mut other = network();
        other.identity = "network-b".into();
        assert_eq!(
            tracker.observe(&network(), Some(Policy::Ipv4Fallback), &current),
            None
        );
        assert_eq!(
            tracker.observe(&other, Some(Policy::Ipv4Fallback), &current),
            None
        );
    }
    #[tokio::test]
    async fn fallback_requires_successful_ipv4_control() {
        let probe = FakeProbe {
            default: Reachability::Failed,
            candidate: Reachability::Failed,
            ipv4: Reachability::Reachable,
        };
        assert_eq!(
            observe(Arc::new(probe), network(), &Policy::SystemDefault).await,
            Some(Policy::Ipv4Fallback)
        );
    }

    struct HungProbe;
    impl Probe for HungProbe {
        async fn connect(
            &self,
            _: &Network,
            _: std::net::SocketAddr,
            _: Option<IpAddr>,
        ) -> Reachability {
            std::future::pending().await
        }
    }
    #[tokio::test(start_paused = true)]
    async fn an_incomplete_round_has_a_six_second_deadline() {
        let start = tokio::time::Instant::now();
        assert_eq!(
            observe(Arc::new(HungProbe), network(), &Policy::SystemDefault).await,
            None
        );
        assert_eq!(start.elapsed(), Duration::from_secs(6));
    }

    struct MultiplePrefixes;
    impl Probe for MultiplePrefixes {
        async fn connect(
            &self,
            _: &Network,
            _: std::net::SocketAddr,
            source: Option<IpAddr>,
        ) -> Reachability {
            match source {
                Some(IpAddr::V6(source)) if source.segments()[3] == 2 => Reachability::Reachable,
                _ => Reachability::Failed,
            }
        }
    }
    #[tokio::test]
    async fn keeps_the_existing_healthy_binding_among_multiple_candidates() {
        let mut network = network();
        network.sources = vec![
            "2001:db8:0:1::1".parse().unwrap(),
            "2001:db8:0:2::1".parse().unwrap(),
            "2001:db8:0:2::2".parse().unwrap(),
        ];
        let current = Policy::BoundSource {
            interface: network.interface.clone(),
            address: network.sources[2],
        };
        assert_eq!(
            observe(Arc::new(MultiplePrefixes), network, &current).await,
            Some(current)
        );
    }
}
