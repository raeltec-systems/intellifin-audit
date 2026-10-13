//! Deployment sandbox: one disposable ECS Fargate task per consumed attempt.
//!
//! The worker (outside the job) stages the program and pinned original bytes to
//! a job-scoped prefix of the private staging bucket, then passes exactly one
//! presigned manifest URL to the trusted `stage` container. The analysis
//! container receives no URL, credential or task role; it runs in isolated
//! subnets whose only route is the S3 gateway endpoint (restricted by policy to
//! the staging bucket). A trusted `collect` container uploads `lstat` facts and
//! regular files to presigned slots after the analysis container exits, and the
//! worker validates everything again before registration.
//!
//! Lookup cannot fence a delayed `RunTask` (ECS has no such fence), so a task
//! that cannot be found is `Unconfirmed`, never `Absent`. Verified offline
//! against a stub endpoint; live qualification belongs to Story 20.7b.
use super::sigv4::{self, Credentials};
use serde_json::{Value, json};
use std::{collections::BTreeMap, time::Duration};
use url::Url;
use zobba_application::analysis::{
    AnalysisSandbox, Collection, SandboxError, SandboxSpec, SandboxState,
};
use zobba_domain::analysis::{AnalysisLimits, OutputEntry, OutputKind};

const ECS_TARGET: &str = "AmazonEC2ContainerServiceV20141113";
const API_RESPONSE_LIMIT: usize = 1024 * 1024;
const MANIFEST_LIMIT: usize = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
/// Trusted container names in every analysis task definition.
pub const STAGE_CONTAINER: &str = "stage";
pub const ANALYSIS_CONTAINER: &str = "analysis";
pub const COLLECT_CONTAINER: &str = "collect";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FargateConfig {
    pub region: String,
    pub cluster: String,
    /// Environment ID → pinned task definition (`family:revision`).
    pub task_definitions: BTreeMap<String, String>,
    pub subnets: Vec<String>,
    pub security_groups: Vec<String>,
    pub staging_bucket: String,
    ecs_endpoint: Url,
    s3_endpoint: Url,
    s3_path_prefix: String,
    pub url_lifetime_seconds: u32,
}
fn listed(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .collect()
}
fn aws_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1600
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b":/_-.".contains(&b))
}
impl FargateConfig {
    /// Production shape: HTTPS regional endpoints, virtual-hosted staging bucket.
    pub fn new(
        region: &str,
        cluster: &str,
        task_definitions: BTreeMap<String, String>,
        subnets: Vec<String>,
        security_groups: Vec<String>,
        staging_bucket: &str,
    ) -> Result<Self, SandboxError> {
        let region_ok = !region.is_empty()
            && region
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        let bucket_ok = !staging_bucket.is_empty()
            && staging_bucket.len() <= 63
            && staging_bucket
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if !region_ok
            || !bucket_ok
            || !aws_id(cluster)
            || task_definitions.is_empty()
            || !task_definitions
                .values()
                .all(|v| aws_id(v) && v.contains(':'))
            || subnets.is_empty()
            || !subnets.iter().all(|v| aws_id(v))
            || security_groups.is_empty()
            || !security_groups.iter().all(|v| aws_id(v))
        {
            return Err(SandboxError::Unavailable);
        }
        Ok(Self {
            region: region.into(),
            cluster: cluster.into(),
            task_definitions,
            subnets,
            security_groups,
            staging_bucket: staging_bucket.into(),
            ecs_endpoint: Url::parse(&format!("https://ecs.{region}.amazonaws.com/"))
                .map_err(|_| SandboxError::Unavailable)?,
            s3_endpoint: Url::parse(&format!(
                "https://{staging_bucket}.s3.{region}.amazonaws.com/"
            ))
            .map_err(|_| SandboxError::Unavailable)?,
            s3_path_prefix: String::new(),
            url_lifetime_seconds: 3_600,
        })
    }
    /// Reads the explicit deployment configuration. Absent means "no sandbox".
    pub fn from_environment(environment_id: &str) -> Result<Option<Self>, SandboxError> {
        let read = |name: &str| std::env::var(name).ok();
        let Some(cluster) = read("ZOBBA_ANALYSIS_CLUSTER") else {
            return Ok(None);
        };
        let region = read("ZOBBA_ANALYSIS_REGION")
            .or_else(|| read("AWS_REGION"))
            .ok_or(SandboxError::Unavailable)?;
        let definition = read("ZOBBA_ANALYSIS_TASK_DEFINITION").ok_or(SandboxError::Unavailable)?;
        let subnets = listed(&read("ZOBBA_ANALYSIS_SUBNETS").ok_or(SandboxError::Unavailable)?);
        let groups =
            listed(&read("ZOBBA_ANALYSIS_SECURITY_GROUPS").ok_or(SandboxError::Unavailable)?);
        let bucket = read("ZOBBA_ANALYSIS_STAGING_BUCKET").ok_or(SandboxError::Unavailable)?;
        Self::new(
            &region,
            &cluster,
            BTreeMap::from([(environment_id.to_owned(), definition)]),
            subnets,
            groups,
            &bucket,
        )
        .map(Some)
    }
    /// Offline stub endpoints. Not compiled into production builds.
    #[cfg(any(test, feature = "test-loopback"))]
    pub fn with_stub_endpoint(mut self, endpoint: &str) -> Self {
        let url = Url::parse(endpoint).unwrap();
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        self.ecs_endpoint = url.clone();
        self.s3_path_prefix = format!("/{}", self.staging_bucket);
        self.s3_endpoint = url;
        self
    }
}

/// Worker credentials: the standard environment pair, or the ECS container
/// credentials endpoint of the worker's own task role. Never the job's.
pub enum CredentialSource {
    Environment,
    Container { endpoint: Url },
}
impl CredentialSource {
    pub fn from_environment() -> Self {
        match std::env::var("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI") {
            Ok(relative) if relative.starts_with('/') => Url::parse("http://169.254.170.2")
                .and_then(|base| base.join(&relative))
                .map(|endpoint| Self::Container { endpoint })
                .unwrap_or(Self::Environment),
            _ => Self::Environment,
        }
    }
    async fn credentials(&self, http: &reqwest::Client) -> Result<Credentials, SandboxError> {
        match self {
            Self::Environment => {
                let read = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
                Ok(Credentials::new(
                    read("AWS_ACCESS_KEY_ID").ok_or(SandboxError::Unavailable)?,
                    read("AWS_SECRET_ACCESS_KEY").ok_or(SandboxError::Unavailable)?,
                    read("AWS_SESSION_TOKEN"),
                ))
            }
            Self::Container { endpoint } => {
                let response = http
                    .get(endpoint.clone())
                    .send()
                    .await
                    .map_err(|_| SandboxError::Unavailable)?;
                let body = bounded(response, 16 * 1024).await?;
                let value: Value =
                    serde_json::from_slice(&body).map_err(|_| SandboxError::Unavailable)?;
                let text = |k: &str| {
                    value[k]
                        .as_str()
                        .map(str::to_owned)
                        .ok_or(SandboxError::Unavailable)
                };
                Ok(Credentials::new(
                    text("AccessKeyId")?,
                    text("SecretAccessKey")?,
                    Some(text("Token")?),
                ))
            }
        }
    }
}

async fn bounded(response: reqwest::Response, limit: usize) -> Result<Vec<u8>, SandboxError> {
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| SandboxError::Uncertain)?;
        if body.len() + chunk.len() > limit {
            return Err(SandboxError::Unavailable);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub struct FargateSandbox {
    config: FargateConfig,
    credentials: CredentialSource,
    http: reqwest::Client,
    clock: fn() -> i64,
}
fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}
/// ECS `startedBy` is at most 36 characters; a stable digest of the attempt.
pub fn started_by(handle: &str) -> String {
    format!("zobba-{}", &sigv4::sha256_hex(handle.as_bytes())[..29])
}
/// Fargate's smallest valid (cpu units, memory MiB) at or above the limits.
pub fn task_size(limits: &AnalysisLimits) -> Option<(u32, u32)> {
    const SIZES: &[(u32, &[u32])] = &[
        (256, &[512, 1024, 2048]),
        (512, &[1024, 2048, 3072, 4096]),
        (1024, &[2048, 3072, 4096]),
        (2048, &[4096]),
    ];
    let needed = (u64::from(limits.cpu_millis) * 1024).div_ceil(1000);
    SIZES
        .iter()
        .filter(|(cpu, _)| u64::from(*cpu) >= needed)
        .find_map(|(cpu, memory)| {
            memory
                .iter()
                .find(|m| **m >= limits.memory_mib)
                .map(|m| (*cpu, *m))
        })
}

impl FargateSandbox {
    pub fn new(config: FargateConfig, credentials: CredentialSource) -> Result<Self, SandboxError> {
        let http = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| SandboxError::Unavailable)?;
        Ok(Self {
            config,
            credentials,
            http,
            clock: unix_now,
        })
    }
    #[cfg(test)]
    fn with_clock(mut self, clock: fn() -> i64) -> Self {
        self.clock = clock;
        self
    }

    fn object_url(&self, key: &str) -> (Url, String, String) {
        let path = format!("{}/{key}", self.config.s3_path_prefix);
        let mut url = self.config.s3_endpoint.clone();
        url.set_path(&path);
        let host = match url.port() {
            Some(port) => format!("{}:{port}", url.host_str().unwrap_or_default()),
            None => url.host_str().unwrap_or_default().to_owned(),
        };
        (url, host, path)
    }
    fn presign(&self, credentials: &Credentials, method: &str, key: &str) -> String {
        let (mut url, host, path) = self.object_url(key);
        let query = sigv4::presign_query(
            credentials,
            &sigv4::Scope {
                region: &self.config.region,
                service: "s3",
            },
            method,
            &host,
            &path,
            &sigv4::amz_date((self.clock)()),
            self.config.url_lifetime_seconds,
        );
        url.set_query(Some(&query));
        url.into()
    }
    async fn signed(
        &self,
        credentials: &Credentials,
        service: &str,
        method: &str,
        url: Url,
        extra: &[(String, String)],
        body: Vec<u8>,
    ) -> Result<reqwest::Response, SandboxError> {
        let date = sigv4::amz_date((self.clock)());
        let host = match url.port() {
            Some(port) => format!("{}:{port}", url.host_str().unwrap_or_default()),
            None => url.host_str().unwrap_or_default().to_owned(),
        };
        let mut headers = vec![
            ("host".to_owned(), host),
            ("x-amz-date".to_owned(), date.clone()),
            ("x-amz-content-sha256".to_owned(), sigv4::sha256_hex(&body)),
        ];
        if let Some(token) = &credentials.session_token {
            headers.push(("x-amz-security-token".to_owned(), token.clone()));
        }
        headers.extend_from_slice(extra);
        let authorization = sigv4::authorization(
            credentials,
            &sigv4::Scope {
                region: &self.config.region,
                service,
            },
            method,
            url.path(),
            &mut [],
            &headers,
            &body,
            &date,
        );
        let mut request = self
            .http
            .request(
                reqwest::Method::from_bytes(method.as_bytes())
                    .map_err(|_| SandboxError::Unavailable)?,
                url,
            )
            .body(body);
        for (name, value) in headers.iter().filter(|(n, _)| n != "host") {
            request = request.header(name, value);
        }
        let mut value = reqwest::header::HeaderValue::from_str(&authorization)
            .map_err(|_| SandboxError::Unavailable)?;
        value.set_sensitive(true);
        request
            .header(reqwest::header::AUTHORIZATION, value)
            .send()
            .await
            .map_err(|_| SandboxError::Uncertain)
    }
    async fn ecs(
        &self,
        credentials: &Credentials,
        action: &str,
        body: Value,
    ) -> Result<Value, SandboxError> {
        let response = self
            .signed(
                credentials,
                "ecs",
                "POST",
                self.config.ecs_endpoint.clone(),
                &[
                    (
                        "content-type".to_owned(),
                        "application/x-amz-json-1.1".to_owned(),
                    ),
                    ("x-amz-target".to_owned(), format!("{ECS_TARGET}.{action}")),
                ],
                body.to_string().into_bytes(),
            )
            .await?;
        let status = response.status();
        let body = bounded(response, API_RESPONSE_LIMIT).await?;
        if status.is_server_error() {
            return Err(SandboxError::Uncertain);
        }
        if !status.is_success() {
            return Err(SandboxError::Refused);
        }
        serde_json::from_slice(&body).map_err(|_| SandboxError::Uncertain)
    }
    async fn put(
        &self,
        credentials: &Credentials,
        key: &str,
        body: Vec<u8>,
    ) -> Result<(), SandboxError> {
        let (url, ..) = self.object_url(key);
        let response = self
            .signed(
                credentials,
                "s3",
                "PUT",
                url,
                &[("if-none-match".to_owned(), "*".to_owned())],
                body,
            )
            .await?;
        // 412: this attempt's immutable object already exists (a retried put).
        match response.status().as_u16() {
            200 | 201 | 412 => Ok(()),
            500..=599 => Err(SandboxError::Uncertain),
            _ => Err(SandboxError::Unavailable),
        }
    }
    async fn get(
        &self,
        credentials: &Credentials,
        key: &str,
        limit: usize,
    ) -> Result<Option<Vec<u8>>, SandboxError> {
        let (url, ..) = self.object_url(key);
        let response = self
            .signed(credentials, "s3", "GET", url, &[], Vec::new())
            .await?;
        match response.status().as_u16() {
            200 => bounded(response, limit).await.map(Some),
            404 => Ok(None),
            _ => Err(SandboxError::Unavailable),
        }
    }
    async fn find(
        &self,
        credentials: &Credentials,
        handle: &str,
    ) -> Result<Option<Value>, SandboxError> {
        let mut arns = Vec::new();
        for desired in ["RUNNING", "STOPPED"] {
            let page = self
                .ecs(
                    credentials,
                    "ListTasks",
                    json!({"cluster": self.config.cluster, "startedBy": started_by(handle), "desiredStatus": desired, "maxResults": 10}),
                )
                .await
                .map_err(|_| SandboxError::Unavailable)?;
            for arn in page["taskArns"].as_array().into_iter().flatten() {
                arns.push(arn.as_str().ok_or(SandboxError::Unavailable)?.to_owned());
            }
        }
        if arns.is_empty() {
            return Ok(None);
        }
        let described = self
            .ecs(
                credentials,
                "DescribeTasks",
                json!({"cluster": self.config.cluster, "tasks": arns}),
            )
            .await
            .map_err(|_| SandboxError::Unavailable)?;
        let tasks = described["tasks"].as_array().cloned().unwrap_or_default();
        // clientToken idempotency yields one task per attempt; more is not ours to choose.
        if tasks.len() != 1 {
            return Err(SandboxError::Unavailable);
        }
        Ok(tasks.into_iter().next())
    }
}

fn prefix(handle: &str) -> String {
    format!("analysis/{handle}")
}

impl AnalysisSandbox for FargateSandbox {
    async fn start(&self, spec: &SandboxSpec) -> Result<(), SandboxError> {
        let definition = self
            .config
            .task_definitions
            .get(&spec.environment.id)
            .ok_or(SandboxError::Refused)?;
        let (cpu, memory) = task_size(&spec.limits).ok_or(SandboxError::Refused)?;
        let credentials = self.credentials.credentials(&self.http).await?;
        let base = prefix(&spec.handle);
        let mut inputs = Vec::new();
        for input in &spec.inputs {
            let key = format!("{base}/stage/input/{}", input.name);
            self.put(&credentials, &key, input.bytes.clone()).await?;
            inputs.push(json!({"name": input.name, "size": input.bytes.len(), "sha256": sigv4::sha256_hex(&input.bytes), "url": self.presign(&credentials, "GET", &key)}));
        }
        let program_key = format!("{base}/stage/program");
        self.put(&credentials, &program_key, spec.program.clone())
            .await?;
        let slots: Vec<String> = (0..spec.limits.output_files)
            .map(|i| self.presign(&credentials, "PUT", &format!("{base}/out/{i}")))
            .collect();
        let manifest = json!({
            "inputs": inputs,
            "program": {"size": spec.program.len(), "sha256": sigv4::sha256_hex(&spec.program), "url": self.presign(&credentials, "GET", &program_key)},
            "collect": {
                "manifest": self.presign(&credentials, "PUT", &format!("{base}/out/manifest.json")),
                "slots": slots,
                "output_file_bytes": spec.limits.output_file_bytes,
                "output_total_bytes": spec.limits.output_total_bytes,
            },
        });
        let manifest_key = format!("{base}/stage/manifest.json");
        self.put(
            &credentials,
            &manifest_key,
            manifest.to_string().into_bytes(),
        )
        .await?;
        let body = json!({
            "cluster": self.config.cluster,
            "taskDefinition": definition,
            "launchType": "FARGATE",
            "platformVersion": "1.4.0",
            "count": 1,
            "clientToken": spec.handle,
            "startedBy": started_by(&spec.handle),
            "enableExecuteCommand": false,
            "networkConfiguration": {"awsvpcConfiguration": {
                "subnets": self.config.subnets,
                "securityGroups": self.config.security_groups,
                "assignPublicIp": "DISABLED",
            }},
            "overrides": {
                "cpu": cpu.to_string(),
                "memory": memory.to_string(),
                "containerOverrides": [
                    {"name": STAGE_CONTAINER, "environment": [{"name": "ZOBBA_STAGE_URL", "value": self.presign(&credentials, "GET", &manifest_key)}]},
                ],
            },
        });
        let response = self.ecs(&credentials, "RunTask", body).await?;
        let started = response["tasks"].as_array().is_some_and(|t| t.len() == 1);
        let failed = response["failures"]
            .as_array()
            .is_some_and(|f| !f.is_empty());
        match (started, failed) {
            (true, _) => Ok(()),
            (false, true) => Err(SandboxError::Refused),
            (false, false) => Err(SandboxError::Uncertain),
        }
    }

    async fn status(&self, handle: &str) -> Result<SandboxState, SandboxError> {
        let credentials = self.credentials.credentials(&self.http).await?;
        let Some(task) = self.find(&credentials, handle).await? else {
            // A delayed RunTask cannot be fenced: never claim absence.
            return Ok(SandboxState::Unconfirmed);
        };
        Ok(match task["lastStatus"].as_str() {
            Some("PROVISIONING" | "PENDING" | "ACTIVATING") => SandboxState::Starting,
            Some("RUNNING" | "DEACTIVATING" | "STOPPING" | "DEPROVISIONING") => {
                SandboxState::Running
            }
            Some("STOPPED") => {
                let container = task["containers"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|c| c["name"] == ANALYSIS_CONTAINER);
                let exit_code = container
                    .and_then(|c| c["exitCode"].as_i64())
                    .and_then(|c| i32::try_from(c).ok());
                let out_of_memory = container
                    .and_then(|c| c["reason"].as_str())
                    .is_some_and(|r| r.contains("OutOfMemory"));
                SandboxState::Exited {
                    exit_code,
                    out_of_memory,
                }
            }
            _ => SandboxState::Unconfirmed,
        })
    }

    async fn stop(&self, handle: &str) -> Result<(), SandboxError> {
        let credentials = self.credentials.credentials(&self.http).await?;
        let task = self
            .find(&credentials, handle)
            .await?
            .ok_or(SandboxError::Unavailable)?;
        let arn = task["taskArn"].as_str().ok_or(SandboxError::Unavailable)?;
        self.ecs(
            &credentials,
            "StopTask",
            json!({"cluster": self.config.cluster, "task": arn, "reason": "zobba analysis stop"}),
        )
        .await
        .map(|_| ())
    }

    async fn collect(
        &self,
        handle: &str,
        limits: &AnalysisLimits,
    ) -> Result<Collection, SandboxError> {
        let credentials = self.credentials.credentials(&self.http).await?;
        let base = prefix(handle);
        let manifest = self
            .get(
                &credentials,
                &format!("{base}/out/manifest.json"),
                MANIFEST_LIMIT,
            )
            .await?
            .ok_or(SandboxError::Unavailable)?;
        let manifest: Value =
            serde_json::from_slice(&manifest).map_err(|_| SandboxError::Unavailable)?;
        let mut collection = Collection {
            full: manifest["full"].as_bool().unwrap_or(true),
            truncated: manifest["truncated"].as_bool().unwrap_or(true),
            entries: Vec::new(),
        };
        for entry in manifest["entries"]
            .as_array()
            .ok_or(SandboxError::Unavailable)?
        {
            let path = entry["path_hex"]
                .as_str()
                .and_then(decode_hex)
                .ok_or(SandboxError::Unavailable)?;
            let kind = entry["kind"]
                .as_str()
                .and_then(OutputKind::parse)
                .ok_or(SandboxError::Unavailable)?;
            let size = entry["size"].as_u64().ok_or(SandboxError::Unavailable)?;
            let content = match entry["slot"].as_u64() {
                Some(slot)
                    if slot < u64::from(limits.output_files)
                        && size <= limits.output_file_bytes =>
                {
                    self.get(&credentials, &format!("{base}/out/{slot}"), size as usize)
                        .await?
                }
                _ => None,
            };
            collection.entries.push(OutputEntry {
                path,
                kind,
                links: entry["links"].as_u64().ok_or(SandboxError::Unavailable)?,
                size,
                content,
            });
        }
        Ok(collection)
    }

    /// Staged and collected objects expire under the bucket lifecycle rule.
    async fn discard(&self, _: &str) -> Result<(), SandboxError> {
        Ok(())
    }
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) || value.len() > 2048 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(value.get(i..i + 2)?, 16).ok())
        .collect()
}

#[cfg(test)]
#[path = "fargate_tests.rs"]
mod tests;
