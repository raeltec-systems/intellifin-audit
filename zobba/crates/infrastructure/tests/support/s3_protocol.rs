#![allow(dead_code)]
//! Owned synthetic S3 protocol fixture, compiled only by integration tests.

use std::collections::HashMap;
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full, StreamBody, combinators::UnsyncBoxBody};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use object_store::RetryConfig;
use object_store::aws::AmazonS3Builder;
use object_store::client::{ClientOptions, HttpClient, HttpConnector};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::task::{JoinHandle, JoinSet};
use url::{Host, Url};

use reqwest_fixture as reqwest;
use zobba_application::evidence::ObjectError;

type HttpBody = UnsyncBoxBody<Bytes, io::Error>;

#[derive(Clone)]
pub struct StoredVersion {
    pub id: String,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct RequestRecord {
    pub method: Method,
    pub path: String,
    pub query: String,
    pub if_none_match: Option<String>,
    pub authorization_present: bool,
}

pub struct FixtureState {
    pub bucket_exists: AtomicBool,
    pub drop_next_put_ack: AtomicBool,
    pub omit_version_header: AtomicBool,
    pub null_version_header: AtomicBool,
    pub corrupt_get: AtomicBool,
    pub mismatch_next_get_version: AtomicBool,
    pub error_next_get_body: AtomicBool,
    pub delay_get_body_ms: AtomicUsize,
    pub fail_uncommitted_puts: AtomicUsize,
    pub conflict_uncommitted_puts: AtomicUsize,
    pub conflict_status: AtomicUsize,
    pub response_delay_ms: AtomicUsize,
    pub next_version: AtomicUsize,
    pub active_requests: AtomicUsize,
    pub peak_requests: AtomicUsize,
    pub objects: std::sync::Mutex<HashMap<String, Vec<StoredVersion>>>,
    pub requests: std::sync::Mutex<Vec<RequestRecord>>,
}

impl FixtureState {
    fn new() -> Self {
        Self {
            bucket_exists: AtomicBool::new(true),
            drop_next_put_ack: AtomicBool::new(false),
            omit_version_header: AtomicBool::new(false),
            null_version_header: AtomicBool::new(false),
            corrupt_get: AtomicBool::new(false),
            mismatch_next_get_version: AtomicBool::new(false),
            error_next_get_body: AtomicBool::new(false),
            delay_get_body_ms: AtomicUsize::new(0),
            fail_uncommitted_puts: AtomicUsize::new(0),
            conflict_uncommitted_puts: AtomicUsize::new(0),
            conflict_status: AtomicUsize::new(409),
            response_delay_ms: AtomicUsize::new(0),
            next_version: AtomicUsize::new(1),
            active_requests: AtomicUsize::new(0),
            peak_requests: AtomicUsize::new(0),
            objects: Default::default(),
            requests: Default::default(),
        }
    }

    pub fn records(&self) -> Vec<RequestRecord> {
        self.requests.lock().unwrap().clone()
    }

    fn enter_request(self: &Arc<Self>) -> ActiveRequest {
        let active = self.active_requests.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak_requests.fetch_max(active, Ordering::SeqCst);
        ActiveRequest(Arc::clone(self))
    }
}

struct ActiveRequest(Arc<FixtureState>);

impl Drop for ActiveRequest {
    fn drop(&mut self) {
        self.0.active_requests.fetch_sub(1, Ordering::SeqCst);
    }
}

pub struct Fixture {
    pub state: Arc<FixtureState>,
    pub endpoint: String,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl Fixture {
    pub async fn start() -> Self {
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        let state = Arc::new(FixtureState::new());
        let task_state = Arc::clone(&state);
        let (shutdown, mut rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let (stream, _) = accepted.unwrap();
                        let state = Arc::clone(&task_state);
                        connections.spawn(async move {
                            serve_connection(stream, state).await;
                        });
                    }
                    _ = &mut rx => break,
                }
            }
            connections.abort_all();
        });
        Self {
            state,
            endpoint: format!("http://{addr}"),
            shutdown: Some(shutdown),
            task,
        }
    }

    pub fn store(&self) -> object_store::aws::AmazonS3 {
        build_fixture_store(&self.endpoint).unwrap()
    }

    pub async fn stop(mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        self.task.await.unwrap();
    }
}

pub fn build_fixture_store(endpoint: &str) -> Result<object_store::aws::AmazonS3, ObjectError> {
    let endpoint = validate_fixture_endpoint(endpoint)?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| ObjectError::Unavailable)?;
    AmazonS3Builder::new()
        .with_endpoint(endpoint.as_str())
        .with_region("us-east-1")
        .with_bucket_name("fixture-bucket")
        .with_access_key_id("fixture-access-key")
        .with_secret_access_key("fixture-secret-key")
        .with_allow_http(true)
        .with_conditional_put(object_store::aws::S3ConditionalPut::ETagMatch)
        .with_retry(RetryConfig {
            max_retries: 0,
            retry_timeout: Duration::from_secs(1),
            ..Default::default()
        })
        .with_http_connector(FixtureConnector(HttpClient::new(client)))
        .build()
        .map_err(|_| ObjectError::Unavailable)
}

#[derive(Clone, Debug)]
struct FixtureConnector(HttpClient);

impl HttpConnector for FixtureConnector {
    fn connect(&self, _options: &ClientOptions) -> object_store::Result<HttpClient> {
        // Installed only after numeric-loopback validation. This deliberately
        // ignores proxy environment variables for the local protocol fixture.
        Ok(self.0.clone())
    }
}

pub fn validate_fixture_endpoint(value: &str) -> Result<Url, ObjectError> {
    let url = Url::parse(value).map_err(|_| ObjectError::Unavailable)?;
    let loopback_ip = match url.host() {
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        Some(Host::Domain(_)) | None => false,
    };
    if url.scheme() != "http"
        || !loopback_ip
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ObjectError::Unavailable);
    }
    Ok(url)
}

async fn serve_connection(stream: TcpStream, state: Arc<FixtureState>) {
    let service = service_fn(move |request| {
        let state = Arc::clone(&state);
        async move { handle_request(request, state).await }
    });
    let _ = http1::Builder::new()
        .keep_alive(false)
        .serve_connection(TokioIo::new(stream), service)
        .await;
}

async fn handle_request(
    request: Request<Incoming>,
    state: Arc<FixtureState>,
) -> Result<Response<HttpBody>, io::Error> {
    let _active = state.enter_request();
    let (parts, body) = request.into_parts();
    let path = parts.uri.path().to_string();
    let query = parts.uri.query().unwrap_or_default().to_string();
    state.requests.lock().unwrap().push(RequestRecord {
        method: parts.method.clone(),
        path: path.clone(),
        query: query.clone(),
        if_none_match: parts
            .headers
            .get("if-none-match")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned),
        authorization_present: parts.headers.contains_key("authorization"),
    });
    let body = body
        .collect()
        .await
        .map_err(|_| io::Error::other("request body error"))?
        .to_bytes();
    let delay_ms = state.response_delay_ms.load(Ordering::SeqCst);
    if delay_ms != 0 {
        tokio::time::sleep(Duration::from_millis(delay_ms as u64)).await;
    }

    if !state.bucket_exists.load(Ordering::SeqCst) {
        return Ok(xml_response(
            StatusCode::NOT_FOUND,
            "<Error><Code>NoSuchBucket</Code></Error>",
        ));
    }

    if parts.method == Method::GET && path == "/fixture-bucket" {
        let max_keys = query_value(&query, "max-keys");
        if max_keys.as_deref() != Some("1")
            || query_value(&query, "prefix").as_deref() != Some("__health/sentinel/")
        {
            return Ok(xml_response(
                StatusCode::BAD_REQUEST,
                "<Error><Code>BadMaxKeys</Code></Error>",
            ));
        }
        return Ok(xml_response(
            StatusCode::OK,
            "<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"></ListBucketResult>",
        ));
    }

    let Some(key) = path.strip_prefix("/fixture-bucket/") else {
        return Ok(xml_response(
            StatusCode::NOT_FOUND,
            "<Error><Code>NoSuchKey</Code></Error>",
        ));
    };

    if parts.method == Method::PUT {
        if parts
            .headers
            .get("if-none-match")
            .and_then(|value| value.to_str().ok())
            != Some("*")
        {
            return Ok(xml_response(
                StatusCode::BAD_REQUEST,
                "<Error><Code>MissingConditional</Code></Error>",
            ));
        }

        if state
            .conflict_uncommitted_puts
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
                value.checked_sub(1)
            })
            .is_ok()
        {
            return Ok(xml_response(
                StatusCode::from_u16(state.conflict_status.load(Ordering::SeqCst) as u16).unwrap(),
                "<Error><Code>ConditionalRequestConflict</Code></Error>",
            ));
        }

        if state
            .fail_uncommitted_puts
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
                if value > 0 { Some(value - 1) } else { None }
            })
            .is_ok()
        {
            return Ok(xml_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "<Error><Code>InternalError</Code></Error>",
            ));
        }

        let mut objects = state.objects.lock().unwrap();
        if objects.contains_key(key) {
            drop(objects);
            return Ok(xml_response(
                StatusCode::PRECONDITION_FAILED,
                "<Error><Code>PreconditionFailed</Code></Error>",
            ));
        }
        let version = state.next_version.fetch_add(1, Ordering::SeqCst);
        let version_id = format!("v{version}");
        objects.insert(
            key.to_string(),
            vec![StoredVersion {
                id: version_id,
                body: body.to_vec(),
            }],
        );
        drop(objects);

        if state.drop_next_put_ack.swap(false, Ordering::SeqCst) {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionReset,
                "fixture dropped PUT acknowledgement after commit",
            ));
        }

        let version_id = format!("v{version}");
        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header("etag", format!("\"etag-{version}\""))
            .header("content-length", "0");
        if !state.omit_version_header.load(Ordering::SeqCst) {
            let version_header = if state.null_version_header.load(Ordering::SeqCst) {
                "null".to_string()
            } else {
                version_id
            };
            response = response.header("x-amz-version-id", version_header);
        }
        return response
            .body(full_body(Bytes::new()))
            .map_err(|_| io::Error::other("response build error"));
    }

    if parts.method == Method::GET || parts.method == Method::HEAD {
        let version_id = query_value(&query, "versionId");
        let object = state.objects.lock().unwrap();
        let Some(versions) = object.get(key) else {
            return Ok(xml_response(
                StatusCode::NOT_FOUND,
                "<Error><Code>NoSuchKey</Code></Error>",
            ));
        };
        let stored = match version_id.as_deref() {
            Some(requested) => versions.iter().find(|version| version.id == requested),
            None => versions.last(),
        };
        let Some(stored) = stored else {
            return Ok(xml_response(
                StatusCode::NOT_FOUND,
                "<Error><Code>NoSuchVersion</Code></Error>",
            ));
        };
        let mut returned = stored.body.clone();
        let version = stored.id.clone();
        drop(object);
        if state.corrupt_get.load(Ordering::SeqCst) && !returned.is_empty() {
            returned[0] ^= 0xff;
        }
        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header("content-length", returned.len().to_string())
            .header("etag", format!("\"etag-{}\"", version))
            .header("connection", "close");
        if !state.omit_version_header.load(Ordering::SeqCst) {
            let version_header = if state.null_version_header.load(Ordering::SeqCst) {
                "null".to_string()
            } else if parts.method == Method::GET
                && state
                    .mismatch_next_get_version
                    .swap(false, Ordering::SeqCst)
            {
                "different-version".to_string()
            } else {
                version
            };
            response = response.header("x-amz-version-id", version_header);
        }
        if parts.method == Method::HEAD {
            return response
                .body(full_body(Bytes::new()))
                .map_err(|_| io::Error::other("response build error"));
        }
        if state.error_next_get_body.swap(false, Ordering::SeqCst) {
            let failing = StreamBody::new(futures_util::stream::once(async {
                Err::<hyper::body::Frame<Bytes>, _>(io::Error::other("fixture GET body error"))
            }))
            .boxed_unsync();
            return response
                .body(failing)
                .map_err(|_| io::Error::other("response build error"));
        }
        let delay_ms = state.delay_get_body_ms.swap(0, Ordering::SeqCst);
        if delay_ms > 0 {
            let delayed = StreamBody::new(futures_util::stream::once(async move {
                tokio::time::sleep(Duration::from_millis(delay_ms as u64)).await;
                Ok::<_, io::Error>(hyper::body::Frame::data(Bytes::from(returned)))
            }))
            .boxed_unsync();
            return response
                .body(delayed)
                .map_err(|_| io::Error::other("response build error"));
        }
        return response
            .body(full_body(Bytes::from(returned)))
            .map_err(|_| io::Error::other("response build error"));
    }

    Ok(xml_response(
        StatusCode::METHOD_NOT_ALLOWED,
        "<Error><Code>MethodNotAllowed</Code></Error>",
    ))
}

fn xml_response(status: StatusCode, body: &str) -> Response<HttpBody> {
    Response::builder()
        .status(status)
        .header("content-type", "application/xml")
        .header("content-length", body.len().to_string())
        .header("connection", "close")
        .body(full_body(Bytes::from(body.to_owned())))
        .unwrap()
}

fn full_body(body: Bytes) -> HttpBody {
    Full::new(body)
        .map_err(|never| match never {})
        .boxed_unsync()
}

pub fn query_value(query: &str, wanted: &str) -> Option<String> {
    url::form_urlencoded::parse(query.as_bytes())
        .find_map(|(key, value)| (key == wanted).then(|| value.into_owned()))
}
