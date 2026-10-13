//! Offline Fargate adapter contract against an owned stub ECS/S3 endpoint.
//! No AWS call is made; live qualification belongs to Story 20.7b.
use super::*;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{Request, Response, body::Incoming, server::conn::http1, service::service_fn};
use hyper_util::rt::TokioIo;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use zobba_application::analysis::StagedInput;
use zobba_domain::analysis::server_allowlist;

#[derive(Default)]
struct Stub {
    objects: HashMap<String, Vec<u8>>,
    calls: Vec<(String, String, Value, bool)>, // (target or method, path, body, signed)
    started_by: Option<String>,
    last_status: String,
    exit_code: Option<i64>,
    reason: Option<String>,
    fail_run: bool,
    fail_put: bool,
    /// ECS forgot the task (STOPPED tasks expire after about an hour).
    forgotten: bool,
    expiration: Option<String>,
}
type Shared = Arc<Mutex<Stub>>;

async fn handle(
    state: Shared,
    request: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    let method = request.method().as_str().to_owned();
    let path = request.uri().path().to_owned();
    let query = request.uri().query().unwrap_or_default().to_owned();
    let target = request
        .headers()
        .get("x-amz-target")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let signed = request.headers().get("authorization").is_some_and(|v| {
        v.to_str()
            .unwrap_or_default()
            .starts_with("AWS4-HMAC-SHA256 Credential=AKID/")
    });
    let if_none_match = request.headers().get("if-none-match").is_some();
    let body = request
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    let mut stub = state.lock().unwrap();
    let reply = |status: u16, body: Vec<u8>| {
        Ok(Response::builder()
            .status(status)
            .body(Full::new(Bytes::from(body)))
            .unwrap())
    };
    if path == "/creds" {
        let expiration = stub
            .expiration
            .clone()
            .unwrap_or_else(|| "2026-01-01T00:00:00Z".into());
        return reply(
            200,
            format!(r#"{{"AccessKeyId":"AKID","SecretAccessKey":"secret-value","Token":"session-token","Expiration":"{expiration}"}}"#)
                .into_bytes(),
        );
    }
    if let Some(target) = target {
        let value: Value = serde_json::from_slice(&body).unwrap();
        stub.calls
            .push((target.clone(), path, value.clone(), signed));
        let action = target.rsplit('.').next().unwrap().to_owned();
        let task = json!({"taskArn": "arn:aws:ecs:eu-west-1:123456789012:task/cluster/1", "lastStatus": stub.last_status,
            "containers": [{"name": "stage", "exitCode": 0}, {"name": "analysis", "exitCode": stub.exit_code, "reason": stub.reason}, {"name": "collect", "exitCode": 0}]});
        let response = match action.as_str() {
            "RunTask" if stub.fail_run => {
                json!({"tasks": [], "failures": [{"reason": "RESOURCE:MEMORY"}]})
            }
            "RunTask" => {
                stub.started_by = value["startedBy"].as_str().map(str::to_owned);
                stub.last_status = "PENDING".into();
                json!({"tasks": [task], "failures": []})
            }
            "ListTasks" if stub.forgotten => json!({"taskArns": []}),
            "DescribeTasks" if stub.forgotten => {
                json!({"tasks": [], "failures": [{"reason": "MISSING"}]})
            }
            "ListTasks" => {
                let matches = stub.started_by.as_deref() == value["startedBy"].as_str()
                    && !stub.last_status.is_empty();
                let stopped = stub.last_status == "STOPPED";
                let wanted = value["desiredStatus"] == "STOPPED";
                json!({"taskArns": if matches && stopped == wanted { vec![task["taskArn"].clone()] } else { vec![] }})
            }
            "DescribeTasks" => json!({"tasks": [task], "failures": []}),
            "StopTask" => {
                stub.last_status = "STOPPED".into();
                stub.exit_code = Some(137);
                json!({"task": task})
            }
            _ => return reply(400, b"{}".to_vec()),
        };
        return reply(200, response.to_string().into_bytes());
    }
    let presigned = query.contains("X-Amz-Signature=");
    stub.calls.push((
        method.clone(),
        path.clone(),
        Value::Null,
        signed || presigned,
    ));
    match method.as_str() {
        "PUT" if stub.fail_put => reply(503, vec![]),
        "PUT" => {
            if if_none_match && stub.objects.contains_key(&path) {
                return reply(412, vec![]);
            }
            stub.objects.insert(path, body);
            reply(200, vec![])
        }
        "GET" => match stub.objects.get(&path) {
            Some(bytes) => reply(200, bytes.clone()),
            None => reply(404, vec![]),
        },
        _ => reply(405, vec![]),
    }
}

async fn stub() -> (String, Shared) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let state: Shared = Arc::default();
    let serving = state.clone();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let state = serving.clone();
            tokio::spawn(async move {
                let _ = http1::Builder::new()
                    .serve_connection(
                        TokioIo::new(stream),
                        service_fn(move |r| handle(state.clone(), r)),
                    )
                    .await;
            });
        }
    });
    (format!("http://{address}/"), state)
}

fn sandbox(endpoint: &str) -> FargateSandbox {
    let config = FargateConfig::new(
        "eu-west-1",
        "arn:aws:ecs:eu-west-1:123456789012:cluster/zobba-qualification",
        BTreeMap::from([(
            "general-python-3-13".to_owned(),
            "zobba-qualification-analysis:3".to_owned(),
        )]),
        vec!["subnet-analysis0".into(), "subnet-analysis1".into()],
        vec!["sg-analysis".into()],
        "zobba-qualification-analysis-123456789012",
    )
    .unwrap()
    .with_stub_endpoint(endpoint);
    let credentials = CredentialSource::Container {
        endpoint: Url::parse(&format!("{endpoint}creds")).unwrap(),
    };
    FargateSandbox::new(config, credentials)
        .unwrap()
        .with_clock(|| 1_760_000_000)
}
fn spec() -> SandboxSpec {
    SandboxSpec {
        handle: "a".repeat(64),
        environment: server_allowlist().remove(0),
        program: b"PROGRAM-SECRET-TEXT".to_vec(),
        inputs: vec![StagedInput {
            name: "orig-a".into(),
            bytes: b"INPUT-SECRET-BYTES".to_vec(),
        }],
        limits: AnalysisLimits::DEFAULT,
    }
}

#[test]
fn production_configuration_is_https_and_refuses_unpinned_definitions() {
    let ok = FargateConfig::new(
        "eu-west-1",
        "cluster",
        BTreeMap::from([("e".to_owned(), "family:1".to_owned())]),
        vec!["subnet-1".into()],
        vec!["sg-1".into()],
        "bucket",
    )
    .unwrap();
    assert_eq!(
        ok.ecs_endpoint.as_str(),
        "https://ecs.eu-west-1.amazonaws.com/"
    );
    assert_eq!(
        ok.s3_endpoint.as_str(),
        "https://bucket.s3.eu-west-1.amazonaws.com/"
    );
    for (definition, subnets) in [
        ("family", vec!["subnet-1".to_owned()]),
        ("family:1", vec![]),
    ] {
        assert!(
            FargateConfig::new(
                "eu-west-1",
                "cluster",
                BTreeMap::from([("e".to_owned(), definition.to_owned())]),
                subnets,
                vec!["sg".into()],
                "bucket"
            )
            .is_err()
        );
    }
    assert!(
        FargateConfig::new(
            "eu-west-1",
            "cluster",
            BTreeMap::from([("e".to_owned(), "f:1".to_owned())]),
            vec!["s".into()],
            vec!["sg".into()],
            "Bad_Bucket"
        )
        .is_err()
    );
    assert_eq!(started_by(&"a".repeat(64)).len(), 35);
    assert_eq!(
        task_size(&AnalysisLimits {
            cpu_millis: 1000,
            memory_mib: 1024,
            ..AnalysisLimits::DEFAULT
        }),
        Some((1024, 2048))
    );
    assert_eq!(
        task_size(&AnalysisLimits {
            cpu_millis: 250,
            memory_mib: 4096,
            ..AnalysisLimits::DEFAULT
        }),
        Some((512, 4096))
    );
    assert_eq!(
        task_size(&zobba_domain::analysis::CEILING),
        Some((2048, 4096))
    );
}

#[tokio::test]
async fn run_task_stages_through_presigned_urls_with_no_task_role_or_public_address() {
    let (endpoint, state) = stub().await;
    let sandbox = sandbox(&endpoint);
    sandbox.start(&spec()).await.unwrap();
    let stub = state.lock().unwrap();
    let run = stub
        .calls
        .iter()
        .find(|c| c.0.ends_with(".RunTask"))
        .unwrap();
    assert!(
        run.3,
        "the ECS request is SigV4-signed with the worker's credentials"
    );
    let body = &run.2;
    let text = body.to_string();
    assert!(
        !text.contains("taskRoleArn") && !text.contains("executionRoleArn"),
        "no role override"
    );
    assert_eq!(
        body["networkConfiguration"]["awsvpcConfiguration"]["assignPublicIp"],
        "DISABLED"
    );
    assert_eq!(body["clientToken"], "a".repeat(64));
    assert_eq!(body["taskDefinition"], "zobba-qualification-analysis:3");
    let overrides = body["overrides"]["containerOverrides"].as_array().unwrap();
    assert_eq!(overrides.len(), 2);
    assert_eq!(overrides[0]["name"], STAGE_CONTAINER);
    // The program container gets only its in-job wall limit and fixed argv,
    // never an environment, URL or credential.
    assert_eq!(overrides[1]["name"], ANALYSIS_CONTAINER);
    assert!(overrides[1].get("environment").is_none());
    assert_eq!(
        overrides[1]["command"],
        json!(["300s", "python3", "-I", "-B", "/job/program"])
    );
    assert_eq!(
        body["tags"],
        json!([{"key": "zobba:analysis", "value": "1"}])
    );
    let lifetime = url_lifetime_seconds(&AnalysisLimits::DEFAULT);
    assert_eq!(lifetime, 600 + 300 + 300 + 600);
    assert!(
        overrides[0]["environment"][0]["value"]
            .as_str()
            .unwrap()
            .contains(&format!("X-Amz-Expires={lifetime}"))
    );
    assert!(
        overrides[0]["environment"][0]["value"]
            .as_str()
            .unwrap()
            .contains("X-Amz-Signature=")
    );
    for secret in ["PROGRAM-SECRET-TEXT", "INPUT-SECRET-BYTES", "secret-value"] {
        assert!(!text.contains(secret), "RunTask must not carry {secret}");
    }
    let staged: Vec<&String> = stub.objects.keys().collect();
    assert!(staged.iter().any(|k| k.ends_with("/stage/input/orig-a")));
    assert!(staged.iter().any(|k| k.ends_with("/stage/program")));
    let manifest: Value = serde_json::from_slice(
        &stub.objects[&format!(
            "/zobba-qualification-analysis-123456789012/analysis/{}/stage/manifest.json",
            "a".repeat(64)
        )],
    )
    .unwrap();
    assert_eq!(
        manifest["collect"]["slots"].as_array().unwrap().len(),
        AnalysisLimits::DEFAULT.output_files as usize
    );
    assert!(
        manifest["inputs"][0]["url"]
            .as_str()
            .unwrap()
            .contains("X-Amz-Security-Token=session-token")
    );
    assert!(
        !manifest.to_string().contains("secret-value"),
        "no secret key, only scoped signatures"
    );
}

#[tokio::test]
async fn status_stop_and_collect_follow_the_task() {
    let (endpoint, state) = stub().await;
    let sandbox = sandbox(&endpoint);
    let handle = "a".repeat(64);
    assert_eq!(
        sandbox
            .status(&handle, &server_allowlist()[0])
            .await
            .unwrap(),
        SandboxState::Unconfirmed,
        "an unfindable task is never absent"
    );
    sandbox.start(&spec()).await.unwrap();
    assert_eq!(
        sandbox
            .status(&handle, &server_allowlist()[0])
            .await
            .unwrap(),
        SandboxState::Starting
    );
    state.lock().unwrap().last_status = "RUNNING".into();
    assert_eq!(
        sandbox
            .status(&handle, &server_allowlist()[0])
            .await
            .unwrap(),
        SandboxState::Running
    );
    sandbox.stop(&handle, &server_allowlist()[0]).await.unwrap();
    assert_eq!(
        sandbox
            .status(&handle, &server_allowlist()[0])
            .await
            .unwrap(),
        SandboxState::Exited {
            exit_code: Some(137),
            out_of_memory: false
        }
    );
    // The first observed terminal facts are durable and win over later reads.
    state.lock().unwrap().reason = Some("OutOfMemoryError: Container killed".into());
    assert_eq!(
        sandbox
            .status(&handle, &server_allowlist()[0])
            .await
            .unwrap(),
        SandboxState::Exited {
            exit_code: Some(137),
            out_of_memory: false
        }
    );
    state
        .lock()
        .unwrap()
        .objects
        .retain(|k, _| !k.ends_with("/terminal.json"));
    assert_eq!(
        sandbox
            .status(&handle, &server_allowlist()[0])
            .await
            .unwrap(),
        SandboxState::Exited {
            exit_code: Some(137),
            out_of_memory: true
        }
    );
    {
        let mut stub = state.lock().unwrap();
        let base = format!("/zobba-qualification-analysis-123456789012/analysis/{handle}/out");
        stub.objects.insert(format!("{base}/0"), b"a,b\n".to_vec());
        stub.objects.insert(format!("{base}/manifest.json"), json!({"full": false, "truncated": false, "entries": [
            {"path_hex": "73756d6d6172792e637376", "kind": "regular", "links": 1, "size": 4, "slot": 0},
            {"path_hex": "6c696e6b", "kind": "symlink", "links": 1, "size": 11},
        ]}).to_string().into_bytes());
    }
    let collection = sandbox
        .collect(&handle, &AnalysisLimits::DEFAULT)
        .await
        .unwrap();
    assert_eq!(collection.entries.len(), 2);
    assert_eq!(collection.entries[0].path, b"summary.csv");
    assert_eq!(
        collection.entries[0].content.as_deref(),
        Some(&b"a,b\n"[..])
    );
    assert_eq!(collection.entries[1].kind, OutputKind::Symlink);
    assert!(collection.entries[1].content.is_none());
}

#[tokio::test]
async fn capacity_failure_is_a_refusal_and_nothing_is_running() {
    let (endpoint, state) = stub().await;
    state.lock().unwrap().fail_run = true;
    assert_eq!(
        sandbox(&endpoint).start(&spec()).await,
        Err(SandboxError::Refused)
    );
}

#[tokio::test]
async fn every_failure_before_run_task_is_a_refusal() {
    let (endpoint, state) = stub().await;
    state.lock().unwrap().fail_put = true;
    assert_eq!(
        sandbox(&endpoint).start(&spec()).await,
        Err(SandboxError::Refused)
    );
    assert!(
        !state
            .lock()
            .unwrap()
            .calls
            .iter()
            .any(|c| c.0.ends_with(".RunTask")),
        "a staging failure dispatches nothing"
    );
    // A signing session that ends before the URLs would: refused, nothing staged.
    let (endpoint, state) = stub().await;
    state.lock().unwrap().expiration = Some("2025-10-09T08:00:00Z".into());
    assert_eq!(
        sandbox(&endpoint).start(&spec()).await,
        Err(SandboxError::Refused)
    );
    assert!(state.lock().unwrap().objects.is_empty());
    // Credentials that cannot be fetched: refused.
    let config = FargateConfig::new(
        "eu-west-1",
        "cluster",
        BTreeMap::from([("general-python-3-13".to_owned(), "f:1".to_owned())]),
        vec!["s".into()],
        vec!["sg".into()],
        "bucket",
    )
    .unwrap()
    .with_stub_endpoint(&endpoint);
    let missing = CredentialSource::Container {
        endpoint: Url::parse(&format!("{endpoint}no-credentials")).unwrap(),
    };
    let sandbox = FargateSandbox::new(config, missing).unwrap();
    assert_eq!(sandbox.start(&spec()).await, Err(SandboxError::Refused));
}

#[tokio::test]
async fn a_finished_task_stays_known_after_ecs_forgets_it() {
    let (endpoint, state) = stub().await;
    let sandbox = sandbox(&endpoint);
    let handle = "a".repeat(64);
    let environment = server_allowlist().remove(0);
    sandbox.start(&spec()).await.unwrap();
    assert!(
        state
            .lock()
            .unwrap()
            .objects
            .keys()
            .any(|k| k.ends_with(&format!("{handle}/task.json"))),
        "the task identity is persisted"
    );
    {
        let mut stub = state.lock().unwrap();
        stub.last_status = "STOPPED".into();
        stub.exit_code = Some(0);
    }
    let finished = SandboxState::Exited {
        exit_code: Some(0),
        out_of_memory: false,
    };
    assert_eq!(
        sandbox.status(&handle, &environment).await.unwrap(),
        finished
    );
    // ECS forgets the task; its first-observed terminal facts remain.
    {
        let mut stub = state.lock().unwrap();
        stub.forgotten = true;
        stub.exit_code = Some(9);
    }
    assert_eq!(
        sandbox.status(&handle, &environment).await.unwrap(),
        finished
    );
    // A task never recorded and not found is never claimed absent.
    assert_eq!(
        sandbox.status(&"b".repeat(64), &environment).await.unwrap(),
        SandboxState::Unconfirmed
    );
}

#[test]
fn deployment_environment_names_are_the_terraform_contract() {
    let contract: Vec<String> = serde_json::from_str(include_str!(
        "../../../../deploy/qualification/analysis/worker-environment.json"
    ))
    .unwrap();
    let mut names: Vec<String> = ENVIRONMENT_NAMES.iter().map(|n| (*n).to_owned()).collect();
    let mut expected = contract.clone();
    names.sort();
    expected.sort();
    assert_eq!(names, expected);
}

#[test]
fn from_environment_reads_exactly_the_contract_names() {
    let values = [
        ("ZOBBA_ANALYSIS_SANDBOX", "fargate"),
        ("ZOBBA_ANALYSIS_REGION", "eu-west-1"),
        (
            "ZOBBA_ANALYSIS_CLUSTER",
            "arn:aws:ecs:eu-west-1:123456789012:cluster/zobba-qualification",
        ),
        (
            "ZOBBA_ANALYSIS_TASK_DEFINITION",
            "zobba-qualification-analysis:3",
        ),
        ("ZOBBA_ANALYSIS_SUBNETS", "subnet-a,subnet-b"),
        ("ZOBBA_ANALYSIS_SECURITY_GROUPS", "sg-analysis"),
        (
            "ZOBBA_ANALYSIS_STAGING_BUCKET",
            "zobba-qualification-analysis-123456789012",
        ),
        (
            "ZOBBA_EVIDENCE_BUCKET",
            "zobba-qualification-evidence-123456789012",
        ),
        ("AWS_REGION", "eu-west-1"),
    ];
    assert_eq!(
        values.iter().map(|(n, _)| *n).collect::<Vec<_>>(),
        ENVIRONMENT_NAMES
    );
    // The sandbox selection and evidence bucket are read by the worker
    // composition; the rest build the Fargate configuration.
    let required = [
        "ZOBBA_ANALYSIS_CLUSTER",
        "ZOBBA_ANALYSIS_TASK_DEFINITION",
        "ZOBBA_ANALYSIS_SUBNETS",
        "ZOBBA_ANALYSIS_SECURITY_GROUPS",
        "ZOBBA_ANALYSIS_STAGING_BUCKET",
    ];
    // Edition 2024 makes `set_var` unsafe and this workspace forbids unsafe
    // code, so the contract is checked in a child process with its own env.
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            "analysis::fargate::tests::from_environment_child",
            "--nocapture",
        ])
        .env_clear()
        .env("ZOBBA_FARGATE_CONTRACT_CHILD", "1");
    for (name, value) in values {
        command.env(name, value);
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("contract-ok"));
    for missing in required {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "analysis::fargate::tests::from_environment_child",
                "--nocapture",
            ])
            .env_clear()
            .env("ZOBBA_FARGATE_CONTRACT_CHILD", "1");
        for (name, value) in values.iter().filter(|(n, _)| *n != missing) {
            command.env(name, value);
        }
        let output = command.output().unwrap();
        let text = String::from_utf8_lossy(&output.stdout);
        assert!(
            text.contains("contract-missing"),
            "{missing} must be required: {text}"
        );
    }
}

#[test]
fn from_environment_child() {
    if std::env::var_os("ZOBBA_FARGATE_CONTRACT_CHILD").is_none() {
        return;
    }
    match FargateConfig::from_environment("general-python-3-13") {
        Ok(Some(config)) => {
            assert_eq!(config.region, "eu-west-1");
            assert_eq!(config.subnets, ["subnet-a", "subnet-b"]);
            println!("contract-ok");
        }
        Ok(None) | Err(_) => println!("contract-missing"),
    }
}

#[test]
fn the_pinned_image_digest_is_the_same_everywhere() {
    let digest = zobba_domain::analysis::GENERAL_IMAGE_DIGEST;
    let terraform = include_str!("../../../../deploy/qualification/variables.tf");
    let ci = include_str!("../../../../../.github/workflows/zobba.yml");
    assert!(
        terraform.contains(&format!("\"{digest}\"")),
        "Terraform allowlist"
    );
    assert!(ci.contains(&format!("python@{digest}")), "CI fixture image");
}
