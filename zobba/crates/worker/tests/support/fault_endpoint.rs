//! An owned, real HTTP source used only by qualification tests. Its lookup
//! linearizes with send and tombstones absent attempts, so an old delayed sender
//! cannot invalidate a guaranteed-absence receipt. This is an explicit contract
//! of this fixture, not a promise about arbitrary remote providers.
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    net::{Ipv4Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinHandle,
    time::timeout,
};
use zobba_application::operation::wire::{StoredCanonical, StoredSource};
use zobba_domain::permissions::{CanonicalOperation, SourceBinding};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fault {
    None,
    DropBeforeAccept,
    DropAfterEffect,
    AcceptPending,
    UnknownLookup,
    OversizedReply,
    OversizedReplyWithoutLength,
    HoldReply,
    WrongOperation,
    WrongAttempt,
    WrongFingerprint,
    WrongSource,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    pub kind: &'static str,
    pub operation_id: String,
    pub attempt_id: String,
}

#[derive(Default)]
struct State {
    operations: HashMap<String, Entry>,
    events: Vec<Event>,
    faults: VecDeque<Fault>,
    resources: HashMap<(String, String, String), String>,
    attachments: HashMap<String, TrustedAttachment>,
    now: Option<i64>,
}
struct TrustedAttachment {
    bytes: Vec<u8>,
    classification: String,
}

struct Entry {
    fingerprint: String,
    fenced: HashSet<String>,
    effect_count: usize,
    outcome: Option<&'static str>,
    pending: Option<CanonicalOperation>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    source: StoredSource,
    operation_id: String,
    attempt_id: String,
    fingerprint: String,
    #[serde(default)]
    canonical_request: Option<StoredCanonical>,
}

pub struct Endpoint {
    pub address: SocketAddr,
    pub source: SourceBinding,
    state: Arc<Mutex<State>>,
    release: Arc<tokio::sync::Notify>,
    handle: JoinHandle<()>,
}

impl Endpoint {
    pub async fn start() -> Self {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(State::default()));
        state.lock().unwrap().resources.insert(
            (
                "qualification-account".into(),
                "qualification-environment".into(),
                "synthetic-record".into(),
            ),
            "version-1".into(),
        );
        let source = SourceBinding {
            source_id: "owned-qualification".into(),
            ledger_id: format!("{:x}", Sha256::digest(rand::random::<[u8; 32]>())),
            endpoint_digest: format!("{:x}", Sha256::digest(address.to_string().as_bytes())),
            contract_version: 1,
        };
        let source_binding = source.clone();
        let shared = state.clone();
        let release = Arc::new(tokio::sync::Notify::new());
        let notify = release.clone();
        let handle = tokio::spawn(async move {
            let permits = Arc::new(tokio::sync::Semaphore::new(8));
            let mut requests = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { break };
                        let Ok(permit) = permits.clone().try_acquire_owned() else { continue };
                        let state = shared.clone();
                        let notify = notify.clone();
                        let source = source_binding.clone();
                        requests.spawn(async move {
                            let _permit = permit;
                            let _ = timeout(Duration::from_secs(3), handle_request(stream, state, notify, source)).await;
                        });
                    }
                    _ = requests.join_next(), if !requests.is_empty() => {},
                }
            }
        });
        Self {
            address,
            source,
            state,
            release,
            handle,
        }
    }

    pub fn fault(&self, fault: Fault) {
        self.state.lock().unwrap().faults.push_back(fault);
    }

    pub fn release_reply(&self) {
        self.release.notify_one();
    }

    pub fn events(&self) -> Vec<Event> {
        self.state.lock().unwrap().events.clone()
    }

    pub fn effects(&self, operation_id: &str) -> usize {
        self.state
            .lock()
            .unwrap()
            .operations
            .get(operation_id)
            .map_or(0, |entry| entry.effect_count)
    }

    pub fn set_resource_version(&self, version: &str) {
        self.state.lock().unwrap().resources.insert(
            (
                "qualification-account".into(),
                "qualification-environment".into(),
                "synthetic-record".into(),
            ),
            version.into(),
        );
    }

    pub fn set_clock(&self, now: Option<i64>) {
        self.state.lock().unwrap().now = now;
    }

    pub fn register_attachment(&self, id: &str, bytes: &[u8], classification: &str) {
        let previous = self.state.lock().unwrap().attachments.insert(
            id.into(),
            TrustedAttachment {
                bytes: bytes.into(),
                classification: classification.into(),
            },
        );
        assert!(
            previous.is_none(),
            "trusted attachment identity is immutable"
        );
    }

    pub fn complete_pending(&self, operation_id: &str) -> bool {
        let mut state = self.state.lock().unwrap();
        let pending = state
            .operations
            .get(operation_id)
            .unwrap()
            .pending
            .as_ref()
            .unwrap();
        if !preconditions(&state, pending) {
            return false;
        }
        let entry = state.operations.get_mut(operation_id).unwrap();
        assert_eq!(entry.outcome, Some("accepted"));
        entry.outcome = Some("completed");
        entry.effect_count += 1;
        entry.pending = None;
        true
    }
}

impl Drop for Endpoint {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

async fn handle_request(
    mut stream: TcpStream,
    state: Arc<Mutex<State>>,
    release: Arc<tokio::sync::Notify>,
    source: SourceBinding,
) -> Option<()> {
    let mut bytes = Vec::new();
    let header_end = loop {
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break end + 4;
        }
        if bytes.len() >= 8192 {
            return None;
        }
        let mut chunk = [0; 1024];
        let count = stream.read(&mut chunk).await.ok()?;
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&chunk[..count]);
    };
    let header = std::str::from_utf8(&bytes[..header_end]).ok()?;
    let path = header
        .lines()
        .next()?
        .strip_prefix("POST ")?
        .strip_suffix(" HTTP/1.1")?
        .to_owned();
    let length: usize = header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("content-length")
            .then(|| value.trim().parse().ok())
            .flatten()
    })?;
    if length > 131_072 {
        return None;
    }
    while bytes.len() < header_end + length {
        let mut chunk = [0; 4096];
        let count = stream.read(&mut chunk).await.ok()?;
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    let request: Request = serde_json::from_slice(&bytes[header_end..header_end + length]).ok()?;
    if request.source.0 != source {
        return None;
    }
    let lookup = match path.as_str() {
        "/v1/operations/lookup" => true,
        "/v1/operations/send" => false,
        _ => return None,
    };
    if request.operation_id.is_empty()
        || request.attempt_id.is_empty()
        || request.operation_id.len() > 128
        || request.attempt_id.len() > 128
        || request.fingerprint.len() != 64
        || !request
            .fingerprint
            .bytes()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
    {
        return None;
    }
    if !lookup {
        let canonical = request.canonical_request.as_ref()?;
        let canonical = canonical.0.canonical_bytes()?;
        let fingerprint = format!("{:x}", Sha256::digest(canonical));
        if fingerprint != request.fingerprint {
            return None;
        }
    }
    let (response, hold, oversized, omit_length, fault, refused) = {
        let mut state = state.lock().unwrap();
        if state.events.len() >= 4096 || state.operations.len() >= 256 {
            return None;
        }
        state.events.push(Event {
            kind: if lookup { "lookup" } else { "send" },
            operation_id: request.operation_id.clone(),
            attempt_id: request.attempt_id.clone(),
        });
        let fault = state.faults.pop_front().unwrap_or(Fault::None);
        let permitted = request
            .canonical_request
            .as_ref()
            .is_none_or(|request| preconditions(&state, &request.0));
        let mut refused = false;
        let entry = state
            .operations
            .entry(request.operation_id.clone())
            .or_insert_with(|| Entry {
                fingerprint: request.fingerprint.clone(),
                fenced: HashSet::new(),
                effect_count: 0,
                outcome: None,
                pending: None,
            });
        if entry.fingerprint != request.fingerprint {
            return None;
        }
        let response = if lookup {
            let outcome = if fault == Fault::UnknownLookup {
                "unknown"
            } else if entry.fenced.contains(&request.attempt_id) {
                // Absence belongs to this attempt, even after a different
                // attempt of the same logical operation completes.
                "absent"
            } else if let Some(outcome) = entry.outcome {
                outcome
            } else {
                // The negative observation is also a durable no-send fence for
                // this attempt for the lifetime of this owned source instance.
                entry.fenced.insert(request.attempt_id.clone());
                "absent"
            };
            Some(reply(&request, outcome))
        } else if entry.fenced.contains(&request.attempt_id) {
            Some(reply(&request, "absent"))
        } else if let Some(outcome) = entry.outcome {
            Some(reply(&request, outcome))
        } else if !permitted {
            entry.fenced.insert(request.attempt_id.clone());
            refused = true;
            Some(reply(&request, "absent"))
        } else if fault == Fault::DropBeforeAccept {
            None
        } else if fault == Fault::AcceptPending {
            entry.outcome = Some("accepted");
            entry.pending = request
                .canonical_request
                .as_ref()
                .map(|request| request.0.clone());
            Some(reply(&request, "accepted"))
        } else {
            entry.effect_count += 1;
            entry.outcome = Some("completed");
            if fault == Fault::DropAfterEffect {
                None
            } else {
                Some(reply(&request, "completed"))
            }
        };
        (
            response,
            fault == Fault::HoldReply,
            matches!(
                fault,
                Fault::OversizedReply | Fault::OversizedReplyWithoutLength
            ),
            fault == Fault::OversizedReplyWithoutLength,
            fault,
            refused,
        )
    };
    if hold {
        release.notified().await;
    }
    let mut response = response?;
    match fault {
        Fault::WrongOperation => response["operation_id"] = json!("unrelated-operation"),
        Fault::WrongAttempt => response["attempt_id"] = json!("unrelated-attempt"),
        Fault::WrongFingerprint => response["fingerprint"] = json!("f".repeat(64)),
        Fault::WrongSource => response["source"]["ledger_id"] = json!("unrelated-source-ledger"),
        _ => {}
    }
    let mut body = serde_json::to_vec(&response).ok()?;
    if oversized {
        // Otherwise-valid wire JSON proves the byte cap rather than a separate
        // schema refusal. JSON parsers accept this trailing whitespace.
        body.resize(body.len() + 65_536, b' ');
    }
    let length = if omit_length {
        String::new()
    } else {
        format!("Content-Length: {}\r\n", body.len())
    };
    let status = if refused {
        "412 Precondition Failed"
    } else {
        "200 OK"
    };
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{length}Connection: close\r\n\r\n"
    );
    stream.write_all(header.as_bytes()).await.ok()?;
    stream.write_all(&body).await.ok()?;
    Some(())
}

fn reply(request: &Request, outcome: &str) -> Value {
    json!({
        "source": request.source,
        "operation_id": request.operation_id,
        "attempt_id": request.attempt_id,
        "fingerprint": request.fingerprint,
        "outcome": outcome,
    })
}

fn preconditions(state: &State, request: &CanonicalOperation) -> bool {
    let now = state.now.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    });
    request.expires_at > now
        && state.resources.get(&(
            request.account_id.clone(),
            request.environment_id.clone(),
            request.resource_id.clone(),
        )) == Some(&request.resource_version)
        && request.material_digest == format!("{:x}", Sha256::digest(request.material.as_bytes()))
        && request.attachments.iter().all(|attachment| {
            state
                .attachments
                .get(&attachment.id)
                .is_some_and(|trusted| {
                    attachment.classification == trusted.classification
                        && attachment.digest == format!("{:x}", Sha256::digest(&trusted.bytes))
                })
        })
}
