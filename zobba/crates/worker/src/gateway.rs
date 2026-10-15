//! Owned operation dispatch. Consumption commits before bounded remote I/O;
//! reconciliation only looks up source facts and never sends an operation.
//!
//! The sole adapter in this story is an explicitly configured loopback
//! qualification endpoint. It is not a live connector and cannot select a
//! destination from operation content, recipient, URL, or caller input.
use reqwest::{Client, redirect::Policy};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, future::Future, net::SocketAddr, sync::Arc, time::Duration};
use zobba_application::operation::{
    OperationError, OperationGateway, OperationStore,
    wire::{StoredCanonical, StoredSource},
};
use zobba_domain::{
    identity::Scope,
    permissions::{ConsumedOperation, OperationCustody, SourceBinding, SourceFact},
    task::ClaimBasis,
};

const SOURCE_TIMEOUT: Duration = Duration::from_secs(2);
const STORE_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_RESPONSE_BYTES: usize = 4096;
const MAX_REQUEST_BYTES: usize = 131_072;
const MAX_RECOVERY_ENTRIES: usize = 1000;

/// Process-owned trusted configuration. Numeric loopback addresses avoid DNS
/// rebinding and proxy routing. Redirects, ambient proxies and automatic request
/// retries are disabled, preserving the exact owned source and one-use send.
#[derive(Clone)]
pub struct Gateway {
    endpoint: HttpEndpoint,
    recovery: Arc<tokio::sync::Mutex<HashMap<RecoveryKey, RecoveryEntry>>>,
}

#[derive(Clone, Hash, PartialEq, Eq)]
struct RecoveryKey {
    actor: String,
    organisation: String,
    client: String,
    engagement: String,
    attempt: String,
    source: String,
    ledger: String,
    endpoint_digest: String,
    contract_version: u16,
}
struct RecoveryEntry {
    attempt: Arc<ConsumedOperation>,
    terminal: bool,
}

impl Gateway {
    pub fn qualification(
        address: SocketAddr,
        source: SourceBinding,
    ) -> Result<Self, OperationError> {
        if !address.ip().is_loopback()
            || address.port() == 0
            || !source.is_valid()
            || source.endpoint_digest
                != format!("{:x}", Sha256::digest(address.to_string().as_bytes()))
        {
            return Err(OperationError::Invalid);
        }
        let client = Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(SOURCE_TIMEOUT)
            .timeout(SOURCE_TIMEOUT)
            .build()
            .map_err(|_| OperationError::Unavailable)?;
        Ok(Self {
            endpoint: HttpEndpoint {
                client,
                base_url: format!("http://{address}"),
                source,
            },
            recovery: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        })
    }

    /// The only outward dispatch entrypoint. A timeout at consumption may follow
    /// a committed cutoff; it grants no permission to send or repeat. The store
    /// returns only owned values, so no SQL transaction spans source I/O.
    pub async fn dispatch<S: OperationStore>(
        &self,
        store: &S,
        basis: &ClaimBasis,
        operation_id: &str,
    ) -> Result<SourceFact, OperationError> {
        self.dispatch_attempt(store, basis, operation_id)
            .await
            .map(|(_, fact)| fact)
    }

    /// As `dispatch`, also returning the exact consumed attempt identity so the
    /// work loop can bind the receipt into durable portable history.
    pub async fn dispatch_attempt<S: OperationStore>(
        &self,
        store: &S,
        basis: &ClaimBasis,
        operation_id: &str,
    ) -> Result<(String, SourceFact), OperationError> {
        let attempt = database_call(store.consume(basis, operation_id)).await?;
        let fact = self.endpoint.dispatch(&attempt).await?;
        // Failure to persist a known outcome never causes another send. A
        // recovering owner reconstructs this same attempt and queries source.
        database_call(store.observe(&attempt, fact)).await?;
        Ok((attempt.attempt_id.clone(), fact))
    }

    /// Recovery uses current reader/Task authority to obtain an exact receipt
    /// capability, performs source lookup, then records only that source fact.
    /// Accepted/unknown remain unresolved. Guaranteed absence is valid here only
    /// because lookup atomically fences a delayed send for this exact attempt.
    pub async fn recover<S: OperationStore>(
        &self,
        store: &S,
        actor: &str,
        scope: &Scope,
        attempt_id: &str,
    ) -> Result<SourceFact, OperationError> {
        let source = &self.endpoint.source;
        let key = RecoveryKey {
            actor: actor.into(),
            organisation: scope.organisation_id.clone(),
            client: scope.client_id.clone(),
            engagement: scope.engagement_id.clone(),
            attempt: attempt_id.into(),
            source: source.source_id.clone(),
            ledger: source.ledger_id.clone(),
            endpoint_digest: source.endpoint_digest.clone(),
            contract_version: source.contract_version,
        };
        // Serialize initial custody acquisition, with bounded lock and DB waits.
        // Retain that exact custody across normal polls, including Unknown.
        let attempt = {
            let mut cache = tokio::time::timeout(STORE_TIMEOUT, self.recovery.lock())
                .await
                .map_err(|_| OperationError::Unavailable)?;
            if let Some(entry) = cache.get(&key) {
                entry.attempt.clone()
            } else {
                if cache.len() >= MAX_RECOVERY_ENTRIES {
                    let terminal = cache
                        .iter()
                        .find_map(|(key, entry)| entry.terminal.then(|| key.clone()));
                    if let Some(terminal) = terminal {
                        cache.remove(&terminal);
                    } else {
                        return Err(OperationError::Capacity);
                    }
                }
                let attempt =
                    Arc::new(database_call(store.recover(actor, scope, attempt_id)).await?);
                cache.insert(
                    key.clone(),
                    RecoveryEntry {
                        attempt: attempt.clone(),
                        terminal: false,
                    },
                );
                attempt
            }
        };
        database_call(store.reauthorize_recovery(actor, scope, &attempt)).await?;
        if attempt.source != self.endpoint.source {
            return Err(OperationError::Fenced);
        }
        let fact = self.endpoint.lookup(&attempt).await?;
        database_call(store.observe(&attempt, fact)).await?;
        if fact.is_resolved() {
            let mut cache = tokio::time::timeout(STORE_TIMEOUT, self.recovery.lock())
                .await
                .map_err(|_| OperationError::Unavailable)?;
            if let Some(entry) = cache.get_mut(&key) {
                entry.terminal = true;
            }
        }
        Ok(fact)
    }
}

async fn database_call<T>(
    future: impl Future<Output = Result<T, OperationError>>,
) -> Result<T, OperationError> {
    tokio::time::timeout(STORE_TIMEOUT, future)
        .await
        .unwrap_or(Err(OperationError::Unavailable))
}

#[derive(Clone)]
struct HttpEndpoint {
    client: Client,
    base_url: String,
    source: SourceBinding,
}

#[derive(Serialize)]
struct Request<'a> {
    source: StoredSource,
    operation_id: &'a str,
    attempt_id: &'a str,
    fingerprint: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    canonical_request: Option<StoredCanonical>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Response {
    source: StoredSource,
    operation_id: String,
    attempt_id: String,
    fingerprint: String,
    outcome: String,
}

impl HttpEndpoint {
    async fn request(&self, attempt: &ConsumedOperation, lookup: bool) -> SourceFact {
        tokio::time::timeout(SOURCE_TIMEOUT, self.bounded_request(attempt, lookup))
            .await
            .ok()
            .flatten()
            .unwrap_or(SourceFact::Unknown)
    }

    async fn bounded_request(
        &self,
        attempt: &ConsumedOperation,
        lookup: bool,
    ) -> Option<SourceFact> {
        if attempt.source != self.source {
            return None;
        }
        let canonical = attempt.request.canonical_bytes()?;
        if format!("{:x}", Sha256::digest(&canonical)) != attempt.request_digest {
            return None;
        }
        let body = serde_json::to_vec(&Request {
            source: StoredSource(self.source.clone()),
            operation_id: &attempt.operation_id,
            attempt_id: &attempt.attempt_id,
            fingerprint: &attempt.request_digest,
            canonical_request: if lookup {
                None
            } else {
                Some(StoredCanonical(attempt.request.clone()))
            },
        })
        .ok()?;
        if body.len() > MAX_REQUEST_BYTES {
            return None;
        }
        let path = if lookup { "lookup" } else { "send" };
        let mut response = self
            .client
            .post(format!("{}/v1/operations/{path}", self.base_url))
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await
            .ok()?;
        if response.status() != reqwest::StatusCode::OK
            || response
                .content_length()
                .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return None;
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }
        let response: Response = serde_json::from_slice(&bytes).ok()?;
        if response.source.0 != attempt.source
            || response.operation_id != attempt.operation_id
            || response.attempt_id != attempt.attempt_id
            || response.fingerprint != attempt.request_digest
        {
            return None;
        }
        match response.outcome.as_str() {
            "unknown" => Some(SourceFact::Unknown),
            "accepted" => Some(SourceFact::Accepted),
            "completed" => Some(SourceFact::Completed),
            "absent" => Some(SourceFact::AuthoritativelyAbsent),
            _ => None,
        }
    }
}

impl OperationGateway for HttpEndpoint {
    async fn dispatch(&self, attempt: &ConsumedOperation) -> Result<SourceFact, OperationError> {
        if attempt.custody != OperationCustody::Dispatch || attempt.source != self.source {
            return Err(OperationError::Fenced);
        }
        Ok(self.request(attempt, false).await)
    }

    async fn lookup(&self, attempt: &ConsumedOperation) -> Result<SourceFact, OperationError> {
        Ok(self.request(attempt, true).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zobba_domain::permissions::{Action, CanonicalOperation, Purpose};

    fn binding(address: SocketAddr) -> SourceBinding {
        SourceBinding {
            source_id: "qualification".into(),
            ledger_id: "ledger".into(),
            endpoint_digest: format!("{:x}", Sha256::digest(address.to_string().as_bytes())),
            contract_version: 1,
        }
    }

    fn attempt(custody: OperationCustody, source: SourceBinding) -> ConsumedOperation {
        let request = CanonicalOperation {
            version: 1,
            purpose: Purpose::TestWorkflows,
            action: Action::Write,
            account_id: "account".into(),
            environment_id: "environment".into(),
            destination: "destination".into(),
            recipients: vec![],
            material: "qualification".into(),
            material_digest: format!("{:x}", Sha256::digest(b"qualification")),
            attachments: vec![],
            resource_id: "resource".into(),
            resource_version: "v1".into(),
            expires_at: 1_999_999_999,
        };
        ConsumedOperation {
            source,
            custody,
            basis: ClaimBasis {
                actor_id: "actor".into(),
                scope: Scope {
                    organisation_id: "org".into(),
                    client_id: "client".into(),
                    engagement_id: "engagement".into(),
                },
                task_id: "task".into(),
                cycle_id: "cycle".into(),
                claim_id: "basis_claim".into(),
                worker_id: "worker".into(),
                process_instance: "producer".into(),
                owner_epoch: 1,
                execution_epoch: 1,
                intent_revision: 1,
            },
            operation_id: "operation".into(),
            attempt_id: "attempt".into(),
            claim_id: "claim".into(),
            request_digest: format!("{:x}", Sha256::digest(request.canonical_bytes().unwrap())),
            request,
            receipt_capability: "secret-never-sent-to-source".into(),
        }
    }

    #[test]
    fn qualification_configuration_refuses_remote_and_unspecified_addresses() {
        for address in ["0.0.0.0:4312", "192.0.2.1:4312", "[::]:4312", "127.0.0.1:0"] {
            let address = address.parse().unwrap();
            assert!(Gateway::qualification(address, binding(address)).is_err());
        }
        for address in ["127.0.0.1:4312", "[::1]:4312"] {
            let address = address.parse().unwrap();
            assert!(Gateway::qualification(address, binding(address)).is_ok());
        }
        let address = "127.0.0.1:4312".parse().unwrap();
        let mut source = binding(address);
        source.endpoint_digest = "0".repeat(64);
        assert!(Gateway::qualification(address, source).is_err());
        let mut source = binding(address);
        source.contract_version = 2;
        assert!(Gateway::qualification(address, source).is_err());
    }

    #[tokio::test]
    async fn recovered_receipt_custody_cannot_dispatch() {
        let address = "127.0.0.1:1".parse().unwrap();
        let gateway = Gateway::qualification(address, binding(address)).unwrap();
        assert_eq!(
            gateway
                .endpoint
                .dispatch(&attempt(
                    OperationCustody::ReceiptOnly,
                    gateway.endpoint.source.clone()
                ))
                .await,
            Err(OperationError::Fenced)
        );
    }

    #[tokio::test]
    async fn blackholed_source_is_bounded_and_stays_unknown() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let gateway = Gateway::qualification(address, binding(address)).unwrap();
        let source = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(4)).await;
            drop(stream);
        });
        let start = std::time::Instant::now();
        assert_eq!(
            gateway
                .endpoint
                .dispatch(&attempt(
                    OperationCustody::Dispatch,
                    gateway.endpoint.source.clone()
                ))
                .await
                .unwrap(),
            SourceFact::Unknown
        );
        assert!(start.elapsed() < Duration::from_secs(3));
        source.abort();
    }
}
