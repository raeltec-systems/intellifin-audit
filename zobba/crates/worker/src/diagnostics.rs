//! Fixed codes only; one message per code per five seconds, with bounded counters.
use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
    AnalysisFailed,
    AnalysisUnresolved,
    /// A work cycle stopped without a recorded step (see [`Diagnostics::halt`]).
    CycleUnavailable,
    /// A work cycle was cancelled because its Task's authority ended.
    AuthorityLost,
    /// One authority poll could not be answered in time (it is retried until
    /// the owner lease could have lapsed).
    AuthorityUnknown,
    /// A work cycle ended fenced (a control or a new epoch).
    CycleFenced,
}
impl Code {
    const COUNT: usize = 20;
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
            Self::AnalysisFailed => "analysis_failed",
            Self::AnalysisUnresolved => "analysis_unresolved",
            Self::CycleUnavailable => "cycle_unavailable",
            Self::AuthorityLost => "authority_lost",
            Self::AuthorityUnknown => "authority_unknown",
            Self::CycleFenced => "cycle_fenced",
        }
    }
}

const HALTS: usize = zobba_application::work::Halt::ALL.len();
struct Inner {
    started: Instant,
    counts: [AtomicU64; Code::COUNT],
    next_message: [AtomicU64; Code::COUNT],
    halts: [AtomicU64; HALTS],
    next_halt_message: [AtomicU64; HALTS],
}
#[derive(Clone)]
pub struct Diagnostics(Arc<Inner>);
impl Default for Diagnostics {
    fn default() -> Self {
        Self(Arc::new(Inner {
            started: Instant::now(),
            counts: std::array::from_fn(|_| AtomicU64::new(0)),
            next_message: std::array::from_fn(|_| AtomicU64::new(0)),
            halts: std::array::from_fn(|_| AtomicU64::new(0)),
            next_halt_message: std::array::from_fn(|_| AtomicU64::new(0)),
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
    /// A work cycle that stopped without a recorded step, with its closed
    /// reason: counted and said (one message per reason per five seconds),
    /// so a silent stop can always be explained.
    pub fn halt(&self, halt: zobba_application::work::Halt) -> bool {
        self.0.counts[Code::CycleUnavailable as usize].fetch_add(1, Ordering::Relaxed);
        let i = zobba_application::work::Halt::ALL
            .iter()
            .position(|h| *h == halt)
            .unwrap_or(0);
        self.0.halts[i].fetch_add(1, Ordering::Relaxed);
        let now = self.0.started.elapsed().as_millis() as u64 + 1;
        let next = &self.0.next_halt_message[i];
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
            eprintln!(
                "worker: {} {}",
                Code::CycleUnavailable.as_str(),
                halt.as_str()
            );
            true
        } else {
            false
        }
    }
    pub fn halts(&self, halt: zobba_application::work::Halt) -> u64 {
        zobba_application::work::Halt::ALL
            .iter()
            .position(|h| *h == halt)
            .map_or(0, |i| self.0.halts[i].load(Ordering::Relaxed))
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

    #[test]
    fn a_stopped_cycle_is_counted_with_its_closed_reason() {
        use zobba_application::work::Halt;
        let diagnostics = Diagnostics::default();
        assert!(diagnostics.halt(Halt::Assessment));
        assert!(!diagnostics.halt(Halt::Assessment));
        assert!(diagnostics.halt(Halt::Answer));
        assert_eq!(diagnostics.count(Code::CycleUnavailable), 3);
        assert_eq!(diagnostics.halts(Halt::Assessment), 2);
        assert_eq!(diagnostics.halts(Halt::Answer), 1);
        assert_eq!(diagnostics.halts(Halt::Model), 0);
        assert_eq!(Halt::Assessment.as_str(), "assessment_context");
    }
}
