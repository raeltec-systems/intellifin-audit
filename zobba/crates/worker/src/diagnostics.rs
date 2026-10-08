//! Fixed codes only; one message per code per five seconds, with bounded counters.
use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Clone, Copy)]
#[repr(usize)]
pub enum Code {
    DiscoveryFailed,
    CoordinationFailed,
    ConsumptionUncertain,
    ReleaseFailed,
    AuthorityFailed,
    ReceiptWriteFailed,
    ReceiptRetriesExhausted,
    ReconciliationFailed,
    RunnerFailed,
    CoordinatorFailed,
    ShutdownTimeout,
    ProcessJoinUnconfirmed,
    ProcessStartFailed,
    DatabaseUnavailable,
}
impl Code {
    const COUNT: usize = 14;
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DiscoveryFailed => "discovery_failed",
            Self::CoordinationFailed => "coordination_failed",
            Self::ConsumptionUncertain => "consumption_uncertain",
            Self::ReleaseFailed => "delivery_release_failed",
            Self::AuthorityFailed => "authority_failed",
            Self::ReceiptWriteFailed => "receipt_write_failed",
            Self::ReceiptRetriesExhausted => "receipt_retries_exhausted",
            Self::ReconciliationFailed => "reconciliation_failed",
            Self::RunnerFailed => "runner_failed",
            Self::CoordinatorFailed => "coordinator_failed",
            Self::ShutdownTimeout => "shutdown_timeout",
            Self::ProcessJoinUnconfirmed => "process_join_unconfirmed",
            Self::ProcessStartFailed => "process_start_failed",
            Self::DatabaseUnavailable => "database_unavailable",
        }
    }
}

struct Inner {
    started: Instant,
    counts: [AtomicU64; Code::COUNT],
    next_message: [AtomicU64; Code::COUNT],
}
#[derive(Clone)]
pub struct Diagnostics(Arc<Inner>);
impl Default for Diagnostics {
    fn default() -> Self {
        Self(Arc::new(Inner {
            started: Instant::now(),
            counts: std::array::from_fn(|_| AtomicU64::new(0)),
            next_message: std::array::from_fn(|_| AtomicU64::new(0)),
        }))
    }
}
impl Diagnostics {
    pub fn record(&self, code: Code) -> bool {
        self.0.counts[code as usize].fetch_add(1, Ordering::Relaxed);
        let now = self.0.started.elapsed().as_millis() as u64 + 1;
        let next = &self.0.next_message[code as usize];
        let previous = next.load(Ordering::Relaxed);
        if now >= previous
            && next
                .compare_exchange(
                    previous,
                    now + Duration::from_secs(5).as_millis() as u64,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                )
                .is_ok()
        {
            eprintln!("worker: {}", code.as_str());
            true
        } else {
            false
        }
    }
    pub fn count(&self, code: Code) -> u64 {
        self.0.counts[code as usize].load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_errors_are_counted_without_flooding_or_dynamic_content() {
        let diagnostics = Diagnostics::default();
        assert!(diagnostics.record(Code::DiscoveryFailed));
        for _ in 0..1_000 {
            assert!(!diagnostics.record(Code::DiscoveryFailed));
        }
        assert_eq!(diagnostics.count(Code::DiscoveryFailed), 1_001);
        assert!(diagnostics.record(Code::ReceiptRetriesExhausted));
        assert!(!diagnostics.clone().record(Code::ReceiptRetriesExhausted));
        assert_eq!(
            Code::ReceiptRetriesExhausted.as_str(),
            "receipt_retries_exhausted"
        );
    }
}
