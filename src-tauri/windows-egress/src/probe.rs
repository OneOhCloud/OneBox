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
    let first = probe.connect(network, destinations[0], source);
    let second = probe.connect(network, destinations[1], source);
    tokio::pin!(first, second);
    let (completed, remaining) = tokio::select! {
        result = &mut first => (result, second),
        result = &mut second => (result, first),
    };
    if completed == Reachability::Reachable {
        return completed;
    }
    match remaining.await {
        Reachability::Reachable => Reachability::Reachable,
        Reachability::Failed if completed == Reachability::Failed => Reachability::Failed,
        _ => Reachability::Uncertain,
    }
}

pub async fn observe<P: Probe>(
    probe: Arc<P>,
    network: Network,
    current: &Policy,
) -> Option<Policy> {
    tokio::time::timeout(Duration::from_secs(6), async {
        let ipv6 = TARGETS.map(|target| target.1.parse().expect("static IPv6 target"));
        let ipv4 = TARGETS.map(|target| target.0.parse().expect("static IPv4 target"));
        let mut sources = network.sources.clone();
        if let Policy::BoundSource { interface, address } = current {
            if *interface == network.interface {
                sources.sort_by_key(|source| source != address);
            }
        }
        // Default, control and candidate probes must not serialize their failure timeouts.
        let mut tasks = tokio::task::JoinSet::new();
        let permits = Arc::new(tokio::sync::Semaphore::new(8));
        for (priority, source, destinations) in std::iter::once((0, None, ipv6))
            .chain(
                sources
                    .iter()
                    .enumerate()
                    .map(|(index, source)| (index + 1, Some(IpAddr::V6(*source)), ipv6)),
            )
            .chain(std::iter::once((usize::MAX, None, ipv4)))
        {
            let probe = probe.clone();
            let network = network.clone();
            let permits = permits.clone();
            tasks.spawn(async move {
                let _permit = if source.is_some() {
                    Some(
                        permits
                            .acquire()
                            .await
                            .expect("probe semaphore remains open"),
                    )
                } else {
                    None
                };
                (
                    priority,
                    pair(probe.as_ref(), &network, source, destinations).await,
                )
            });
        }
        let mut best: Option<(usize, Policy)> = None;
        let mut default = Reachability::Uncertain;
        let mut control = Reachability::Uncertain;
        let mut candidates_failed = true;
        let mut settle_at = tokio::time::Instant::now() + Duration::from_secs(6);
        while !tasks.is_empty() {
            let result = tokio::select! {
                result = tasks.join_next() => result?.ok()?,
                _ = tokio::time::sleep_until(settle_at), if best.is_some() => break,
            };
            let (priority, result) = result;
            match priority {
                0 => {
                    default = result;
                    if result == Reachability::Reachable {
                        return Some(Policy::SystemDefault);
                    }
                }
                usize::MAX => control = result,
                _ => {
                    candidates_failed &= result == Reachability::Failed;
                    if result == Reachability::Reachable
                        && best.as_ref().is_none_or(|best| priority < best.0)
                    {
                        if best.is_none() {
                            // Allow a fast default/current-source result to win, without waiting for bad paths.
                            settle_at = tokio::time::Instant::now() + Duration::from_millis(50);
                        }
                        best = Some((
                            priority,
                            Policy::BoundSource {
                                interface: network.interface.clone(),
                                address: sources[priority - 1],
                            },
                        ));
                    }
                }
            }
        }
        // Dropping JoinSet cancels outstanding probes after a positive result.
        if let Some((_, policy)) = best {
            return Some(policy);
        }
        if default == Reachability::Failed
            && control == Reachability::Reachable
            && candidates_failed
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
    struct SlowFailures;
    impl Probe for SlowFailures {
        async fn connect(
            &self,
            _: &Network,
            _: std::net::SocketAddr,
            source: Option<IpAddr>,
        ) -> Reachability {
            if source.is_some() {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Reachability::Reachable
            } else {
                tokio::time::sleep(Duration::from_secs(2)).await;
                Reachability::Failed
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn healthy_candidate_does_not_wait_for_default_or_ipv4_timeouts() {
        let start = tokio::time::Instant::now();
        let policy = observe(Arc::new(SlowFailures), network(), &Policy::SystemDefault).await;
        assert!(matches!(policy, Some(Policy::BoundSource { .. })));
        assert!(
            start.elapsed() <= Duration::from_millis(100),
            "elapsed: {:?}",
            start.elapsed()
        );
    }

    struct SlowSecondaryEndpoint;
    impl Probe for SlowSecondaryEndpoint {
        async fn connect(
            &self,
            _: &Network,
            target: std::net::SocketAddr,
            _: Option<IpAddr>,
        ) -> Reachability {
            if target == TARGETS[0].1.parse().unwrap() {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Reachability::Reachable
            } else {
                tokio::time::sleep(Duration::from_secs(2)).await;
                Reachability::Failed
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn one_healthy_endpoint_is_enough_without_waiting_for_its_peer() {
        let start = tokio::time::Instant::now();
        assert_eq!(
            observe(
                Arc::new(SlowSecondaryEndpoint),
                network(),
                &Policy::SystemDefault
            )
            .await,
            Some(Policy::SystemDefault)
        );
        assert!(
            start.elapsed() <= Duration::from_millis(100),
            "elapsed: {:?}",
            start.elapsed()
        );
    }
}
