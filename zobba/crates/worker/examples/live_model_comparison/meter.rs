//! A metering wrapper around the real native transport. Every model call of
//! the worker (agent turns and page reads) passes through it. Before a call is
//! sent, its worst-case cost (request bytes as input tokens, plus a margin,
//! and the full output cap) must fit the run's remaining cap; otherwise the
//! call is refused locally and nothing is sent. After a call, its cost is the
//! provider's own usage receipt times the price table; unknown usage is
//! charged at its worst case. The ledger is written after every call.
use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::Instant,
};
use zobba_application::model::{ModelCancellation, ModelRequest, ModelTransport, TransportOutcome};
use zobba_domain::model::{Completion, ModelError, Usage};
use zobba_infrastructure::model::native::NativeAdapter;

/// Provider-side tokens the request bytes may not show (message framing,
/// schema rendering). Request bytes already over-count text tokens.
pub const INPUT_MARGIN_TOKENS: u64 = 2_048;

/// USD per million tokens.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct Rates {
    pub input: f64,
    pub output: f64,
    /// Recorded for completeness: the native adapter reports no cached-token
    /// count, so every input token is charged at the full input price (an
    /// upper bound when a provider discounted cached input).
    pub cached_input: f64,
}
impl Rates {
    pub fn cost(&self, input_tokens: u64, output_tokens: u64) -> f64 {
        (input_tokens as f64 * self.input + output_tokens as f64 * self.output) / 1_000_000.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopReason {
    RunCap,
    CallLimit,
    LedgerWrite,
}
impl StopReason {
    pub fn as_str(self) -> &'static str {
        match self {
            StopReason::RunCap => "run_cap_reached",
            StopReason::CallLimit => "model_call_limit_reached",
            StopReason::LedgerWrite => "ledger_write_failed",
        }
    }
}

/// One call as the meter saw it. Never request or response content.
#[derive(Clone, Debug, Serialize)]
pub struct CallRecord {
    pub number: u64,
    pub request_key: String,
    pub body_bytes: usize,
    pub max_output_tokens: u32,
    pub sent: bool,
    pub refused: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub service_tier: Option<String>,
    pub actual_model: Option<String>,
    pub completion: String,
    pub cost_usd: f64,
    pub worst_case_usd: f64,
    pub started_at: String,
    pub seconds: f64,
}

#[derive(Default)]
struct State {
    sent: u64,
    refused: u64,
    spent: f64,
    reserved: f64,
    in_flight: u32,
    input: u64,
    output: u64,
    unknown_usage: u64,
    stop: Option<StopReason>,
    log: Vec<CallRecord>,
}

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub sent: u64,
    pub refused: u64,
    pub spent: f64,
    pub in_flight: u32,
    pub input: u64,
    pub output: u64,
    pub unknown_usage: u64,
    pub stop: Option<StopReason>,
    pub log: Vec<CallRecord>,
}

pub struct Meter {
    pub rates: Rates,
    pub cap: f64,
    pub max_calls: u64,
    state: Mutex<State>,
    ledger: Option<Arc<Mutex<crate::ledger::Ledger>>>,
}

pub fn completion_word(completion: &Completion) -> String {
    match completion {
        Completion::Succeeded => "succeeded".into(),
        Completion::Refused => "refused".into(),
        Completion::Incomplete => "incomplete".into(),
        Completion::Cancelled => "cancelled".into(),
        Completion::Failed(error) => format!("failed:{}", error.as_str()),
    }
}

impl Meter {
    pub fn new(
        rates: Rates,
        cap: f64,
        max_calls: u64,
        ledger: Option<Arc<Mutex<crate::ledger::Ledger>>>,
    ) -> Self {
        Self {
            rates,
            cap,
            max_calls,
            state: Mutex::new(State::default()),
            ledger,
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let s = self.state.lock().expect("meter lock");
        Snapshot {
            sent: s.sent,
            refused: s.refused,
            spent: s.spent,
            in_flight: s.in_flight,
            input: s.input,
            output: s.output,
            unknown_usage: s.unknown_usage,
            stop: s.stop,
            log: s.log.clone(),
        }
    }

    /// Worst case of one call: request bytes count as input tokens (UTF-8
    /// bytes over-count tokens) plus a margin; the whole output cap.
    pub fn worst_case(&self, body_bytes: usize, max_output_tokens: u32) -> f64 {
        self.rates.cost(
            body_bytes as u64 + INPUT_MARGIN_TOKENS,
            u64::from(max_output_tokens),
        )
    }

    /// Admit one call whose worst case is `worst`, or refuse it (and every
    /// later call) when the run cap or call limit would be passed.
    pub fn admit(&self, worst: f64) -> Result<u64, StopReason> {
        let mut s = self.state.lock().expect("meter lock");
        if let Some(stop) = s.stop {
            s.refused += 1;
            return Err(stop);
        }
        if s.sent >= self.max_calls {
            s.stop = Some(StopReason::CallLimit);
            s.refused += 1;
            return Err(StopReason::CallLimit);
        }
        if s.spent + s.reserved + worst > self.cap {
            s.stop = Some(StopReason::RunCap);
            s.refused += 1;
            return Err(StopReason::RunCap);
        }
        s.sent += 1;
        s.in_flight += 1;
        s.reserved += worst;
        Ok(s.sent)
    }

    /// Charge an admitted call and record it; write the ledger.
    pub fn settle(&self, worst: f64, body_bytes: usize, max_output: u32, mut record: CallRecord, usage: &Usage) {
        let input = usage
            .input_tokens
            .unwrap_or(body_bytes as u64 + INPUT_MARGIN_TOKENS);
        let output = usage.output_tokens.unwrap_or(u64::from(max_output));
        let unknown = usage.input_tokens.is_none() || usage.output_tokens.is_none();
        let cost = self.rates.cost(input, output);
        record.cost_usd = cost;
        let (spent, sent, total_in, total_out, unknown_calls) = {
            let mut s = self.state.lock().expect("meter lock");
            s.spent += cost;
            s.reserved = (s.reserved - worst).max(0.0);
            s.in_flight = s.in_flight.saturating_sub(1);
            s.input += usage.input_tokens.unwrap_or(0);
            s.output += usage.output_tokens.unwrap_or(0);
            if unknown {
                s.unknown_usage += 1;
            }
            s.log.push(record);
            (s.spent, s.sent, s.input, s.output, s.unknown_usage)
        };
        if let Some(ledger) = &self.ledger {
            let written = ledger
                .lock()
                .expect("ledger lock")
                .update(spent, sent, total_in, total_out, unknown_calls);
            if let Err(error) = written {
                eprintln!("comparison: {error}; refusing every further call");
                let mut s = self.state.lock().expect("meter lock");
                s.stop = Some(StopReason::LedgerWrite);
            }
        }
    }

    pub fn record_refusal(&self, record: CallRecord) {
        self.state.lock().expect("meter lock").log.push(record);
    }
}

/// The real transport, metered. Scripted mode wraps the loopback adapter the
/// same way, so the dry run proves the metering path too.
pub struct Metered {
    pub inner: NativeAdapter,
    pub meter: Arc<Meter>,
}

fn refused_outcome(request: &ModelRequest) -> TransportOutcome {
    // Nothing was sent: zero tokens is the exact usage, and the failure is a
    // capacity refusal the work loop records as a failed turn.
    TransportOutcome {
        events: vec![],
        actual_provider: request.profile.provider,
        actual_model: None,
        response_id: None,
        usage: Usage {
            input_tokens: Some(0),
            output_tokens: Some(0),
            actual_service_tier: None,
        },
        completion: Completion::Failed(ModelError::Capacity),
    }
}

impl ModelTransport for Metered {
    async fn invoke(
        &self,
        request: &ModelRequest,
        cancellation: &ModelCancellation,
    ) -> TransportOutcome {
        let started = Instant::now();
        let started_at = crate::report::now_rfc3339();
        // The adapter's own byte preview: no I/O. A request it refuses is
        // refused again inside `invoke` before anything is sent.
        let body_bytes = match self.inner.preview(request) {
            Ok(body) => body.len(),
            Err(_) => return self.inner.invoke(request, cancellation).await,
        };
        let worst = self.meter.worst_case(body_bytes, request.max_output_tokens);
        let base = CallRecord {
            number: 0,
            request_key: request.key.clone(),
            body_bytes,
            max_output_tokens: request.max_output_tokens,
            sent: false,
            refused: None,
            input_tokens: None,
            output_tokens: None,
            service_tier: None,
            actual_model: None,
            completion: String::new(),
            cost_usd: 0.0,
            worst_case_usd: worst,
            started_at,
            seconds: 0.0,
        };
        let number = match self.meter.admit(worst) {
            Ok(number) => number,
            Err(stop) => {
                let mut record = base;
                record.refused = Some(stop.as_str().into());
                record.completion = "not_sent".into();
                self.meter.record_refusal(record);
                return refused_outcome(request);
            }
        };
        let outcome = self.inner.invoke(request, cancellation).await;
        let mut record = base;
        record.number = number;
        record.sent = true;
        record.input_tokens = outcome.usage.input_tokens;
        record.output_tokens = outcome.usage.output_tokens;
        record.service_tier = outcome.usage.actual_service_tier.clone();
        record.actual_model = outcome.actual_model.clone();
        record.completion = completion_word(&outcome.completion);
        record.seconds = started.elapsed().as_secs_f64();
        self.meter.settle(
            worst,
            body_bytes,
            request.max_output_tokens,
            record,
            &outcome.usage,
        );
        outcome
    }
}
