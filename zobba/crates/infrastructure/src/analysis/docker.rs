//! TEST-ONLY local sandbox (cargo feature `test-docker-sandbox`). It runs the
//! hostile fixtures for real on a developer or CI Docker engine. It is never
//! compiled into production builds and requires explicit construction.
//!
//! Isolation per attempt: `--network none`, read-only root, all capabilities
//! dropped, `no-new-privileges`, non-root user, PID/memory/CPU limits, a
//! size-bounded tmpfs `/tmp`, a per-file size rlimit, read-only bind mounts of
//! the staged inputs and program, and one size-bounded tmpfs output volume. The
//! job never receives the Docker socket, host environment or any credential.
//! A separate idle holder container keeps the output volume mounted so trusted
//! collection can read it after the job's termination is confirmed.
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command};
use zobba_application::analysis::{
    AnalysisSandbox, Collection, SandboxError, SandboxSpec, SandboxState,
};
use zobba_domain::{
    analysis::{
        AnalysisEnvironment, AnalysisLimits, INPUT_DIR, OUTPUT_DIR, OutputEntry, OutputKind,
        PROGRAM_PATH, Withheld,
    },
    identity::valid_scope_id,
};

const CLI_TIMEOUT: Duration = Duration::from_secs(60);
const CLI_OUTPUT_LIMIT: usize = 1024 * 1024;
const TMP_BYTES: u64 = 64 * 1024 * 1024;
/// The trusted collector shared with the Fargate `collect` container, run in
/// the holder container over the read-only output volume after the job
/// stopped. `lstat` only; links are never followed.
const LABEL: &str = "zobba.analysis.test-sandbox";
pub const COLLECTOR: &str = include_str!("../../../../deploy/qualification/analysis/collect.py");

pub struct DockerSandbox {
    repository: String,
    staging_root: PathBuf,
    config_dir: PathBuf,
}

fn name(handle: &str) -> Result<String, SandboxError> {
    if !valid_scope_id(handle) || handle.len() > 64 {
        return Err(SandboxError::Refused);
    }
    Ok(format!("zobba-analysis-{handle}"))
}

struct Output {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl DockerSandbox {
    /// Explicit test construction only. `repository` names where the pinned
    /// image digest is available locally (for example a registry mirror); the
    /// digest itself always comes from the allowlisted environment.
    pub fn explicit_test(repository: &str, staging_root: &Path) -> Result<Self, SandboxError> {
        if repository.is_empty()
            || repository.contains('@')
            || !repository
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"./-_:".contains(&b))
        {
            return Err(SandboxError::Unavailable);
        }
        let config_dir = staging_root.join("docker-config");
        std::fs::create_dir_all(&config_dir).map_err(|_| SandboxError::Unavailable)?;
        Ok(Self {
            repository: repository.into(),
            staging_root: staging_root.into(),
            config_dir,
        })
    }

    fn image(&self, digest: &str) -> String {
        format!("{}@{digest}", self.repository)
    }

    /// The CLI runs with a cleared environment and an empty client config, so
    /// no host variable or configured proxy is injected into any container.
    async fn docker(
        &self,
        arguments: &[String],
        stdin: Option<&[u8]>,
    ) -> Result<Output, SandboxError> {
        let mut command = Command::new("docker");
        command
            .args(arguments)
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("DOCKER_CONFIG", &self.config_dir)
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(host) = std::env::var_os("DOCKER_HOST") {
            command.env("DOCKER_HOST", host);
        }
        let mut child = command.spawn().map_err(|_| SandboxError::Unavailable)?;
        if let Some(bytes) = stdin {
            use tokio::io::AsyncWriteExt;
            let mut pipe = child.stdin.take().ok_or(SandboxError::Unavailable)?;
            pipe.write_all(bytes)
                .await
                .map_err(|_| SandboxError::Uncertain)?;
            drop(pipe);
        }
        let mut stdout = child.stdout.take().ok_or(SandboxError::Unavailable)?;
        let mut stderr = child.stderr.take().ok_or(SandboxError::Unavailable)?;
        let run = async {
            let mut out = Vec::new();
            let mut err = Vec::new();
            let mut stdout = (&mut stdout).take(CLI_OUTPUT_LIMIT as u64 * 160);
            let mut stderr = (&mut stderr).take(CLI_OUTPUT_LIMIT as u64);
            let (a, b) = tokio::join!(stdout.read_to_end(&mut out), stderr.read_to_end(&mut err));
            a.and(b).map_err(|_| SandboxError::Uncertain)?;
            let status = child.wait().await.map_err(|_| SandboxError::Uncertain)?;
            Ok::<_, SandboxError>(Output {
                success: status.success(),
                stdout: out,
                stderr: err,
            })
        };
        tokio::time::timeout(CLI_TIMEOUT, run)
            .await
            .map_err(|_| SandboxError::Uncertain)?
    }
    async fn run(&self, arguments: &[&str]) -> Result<Output, SandboxError> {
        let arguments: Vec<String> = arguments.iter().map(|v| (*v).to_owned()).collect();
        self.docker(&arguments, None).await
    }

    async fn inspect(&self, container: &str) -> Result<Option<serde_json::Value>, SandboxError> {
        let output = self
            .run(&["inspect", "--type", "container", container])
            .await?;
        if !output.success {
            let message = String::from_utf8_lossy(&output.stderr);
            return if message.contains("No such") {
                Ok(None)
            } else {
                Err(SandboxError::Unavailable)
            };
        }
        let value: serde_json::Value =
            serde_json::from_slice(&output.stdout).map_err(|_| SandboxError::Unavailable)?;
        Ok(value.as_array().and_then(|v| v.first()).cloned())
    }

    fn hardening(limits: Option<&AnalysisLimits>) -> Vec<String> {
        let mut flags: Vec<String> = [
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--user",
            "65534:65534",
            "--ipc",
            "none",
            "--label",
            LABEL,
        ]
        .map(String::from)
        .into();
        match limits {
            Some(l) => flags.extend([
                // A minimal init reaps forked children and lets kernel limit
                // signals (SIGXFSZ, OOM) end the program as they would anywhere.
                "--init".into(),
                format!("--pids-limit={}", l.pids),
                format!("--memory={}m", l.memory_mib),
                format!("--memory-swap={}m", l.memory_mib),
                format!("--cpus={}.{:03}", l.cpu_millis / 1000, l.cpu_millis % 1000),
                format!("--ulimit=fsize={}", l.output_file_bytes + 1),
                format!("--tmpfs=/tmp:rw,nosuid,nodev,size={TMP_BYTES}"),
            ]),
            None => flags.extend([
                "--pids-limit=8".into(),
                "--memory=64m".into(),
                "--memory-swap=64m".into(),
            ]),
        }
        flags
    }

    /// Fence a never-started handle: a container with the job's exact name
    /// makes any delayed `docker create` for this attempt fail. The fence uses
    /// the job's own pinned image. True only when this call created it.
    async fn fence(&self, container: &str, digest: &str) -> Result<bool, SandboxError> {
        let mut arguments = vec!["create".to_owned(), "--name".into(), container.into()];
        arguments.extend(Self::hardening(None));
        arguments.extend(["--label".into(), "zobba.analysis.fence=1".into()]);
        arguments.extend([self.image(digest), "true".into()]);
        Ok(self.docker(&arguments, None).await?.success)
    }

    /// Remove everything a failed start created before the job container.
    async fn undo_start(&self, container: &str) {
        let _ = self.run(&["rm", "-f", &format!("{container}-hold")]).await;
        let _ = self
            .run(&["volume", "rm", "-f", &format!("{container}-out")])
            .await;
        self.remove_staging(container);
    }
    fn remove_staging(&self, container: &str) {
        use std::os::unix::fs::PermissionsExt;
        let root = self.staging_root.join(container);
        for dir in [root.join("input"), root.join("job"), root.clone()] {
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755));
        }
        let _ = std::fs::remove_dir_all(root);
    }

    fn stage(&self, spec: &SandboxSpec, container: &str) -> Result<PathBuf, SandboxError> {
        use std::os::unix::fs::PermissionsExt;
        let root = self.staging_root.join(container);
        let input = root.join("input");
        let job = root.join("job");
        for dir in [&input, &job] {
            std::fs::create_dir_all(dir).map_err(|_| SandboxError::Refused)?;
        }
        for staged in &spec.inputs {
            if !valid_scope_id(&staged.name) {
                return Err(SandboxError::Refused);
            }
            let path = input.join(&staged.name);
            std::fs::write(&path, &staged.bytes).map_err(|_| SandboxError::Refused)?;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444))
                .map_err(|_| SandboxError::Refused)?;
        }
        let program = job.join("program");
        std::fs::write(&program, &spec.program).map_err(|_| SandboxError::Refused)?;
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o444))
            .map_err(|_| SandboxError::Refused)?;
        for dir in [&input, &job, &root] {
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o555))
                .map_err(|_| SandboxError::Refused)?;
        }
        Ok(root)
    }
}

impl AnalysisSandbox for DockerSandbox {
    async fn start(&self, spec: &SandboxSpec) -> Result<(), SandboxError> {
        let container = name(&spec.handle)?;
        let digest = &spec.environment.image_digest;
        let image = self.image(digest);
        // The pinned image must already be present; nothing is pulled at run time.
        if !self.run(&["image", "inspect", &image]).await?.success {
            return Err(SandboxError::Refused);
        }
        let root = match self.stage(spec, &container) {
            Ok(root) => root,
            Err(error) => {
                self.remove_staging(&container);
                return Err(error);
            }
        };
        let volume = format!("{container}-out");
        let size = spec.limits.output_total_bytes + 1024 * 1024;
        // Nothing below the job container has started anything: every failure
        // before `docker create` of the job removes what it made and is Refused.
        let created_volume = self
            .run(&[
                "volume",
                "create",
                "--driver",
                "local",
                "--opt",
                "type=tmpfs",
                "--opt",
                "device=tmpfs",
                "--opt",
                &format!("o=size={size},uid=65534,gid=65534,mode=0700"),
                "--label",
                LABEL,
                &volume,
            ])
            .await;
        if !created_volume.is_ok_and(|o| o.success) {
            self.undo_start(&container).await;
            return Err(SandboxError::Refused);
        }
        let mut hold = vec![
            "run".to_owned(),
            "-d".into(),
            "--name".into(),
            format!("{container}-hold"),
        ];
        hold.extend(Self::hardening(None));
        hold.extend([
            "--mount".into(),
            format!("type=volume,src={volume},dst={OUTPUT_DIR},readonly"),
            "--entrypoint".into(),
            "sleep".into(),
            image.clone(),
            "infinity".into(),
        ]);
        if !self.docker(&hold, None).await.is_ok_and(|o| o.success) {
            self.undo_start(&container).await;
            return Err(SandboxError::Refused);
        }
        let argv = spec.environment.argv();
        let mut create = vec!["create".to_owned(), "--name".into(), container.clone()];
        create.extend(Self::hardening(Some(&spec.limits)));
        create.extend([
            "--label".into(),
            format!("zobba.analysis.handle={}", spec.handle),
            "--mount".into(),
            format!(
                "type=bind,src={},dst={INPUT_DIR},readonly",
                root.join("input").display()
            ),
            "--mount".into(),
            format!(
                "type=bind,src={},dst=/job,readonly",
                root.join("job").display()
            ),
            "--mount".into(),
            format!("type=volume,src={volume},dst={OUTPUT_DIR}"),
            "--workdir".into(),
            "/tmp".into(),
            "--entrypoint".into(),
            argv[0].clone(),
            image,
        ]);
        create.extend(argv[1..].iter().cloned());
        debug_assert_eq!(argv.last().map(String::as_str), Some(PROGRAM_PATH));
        let created = match self.docker(&create, None).await {
            Ok(created) => created,
            Err(_) => return Err(SandboxError::Uncertain),
        };
        if !created.success {
            // A fence owns the name: nothing of this attempt can start.
            if let Ok(Some(info)) = self.inspect(&container).await
                && info["Config"]["Labels"]["zobba.analysis.fence"] == "1"
            {
                self.undo_start(&container).await;
                return Err(SandboxError::Refused);
            }
            return Err(SandboxError::Uncertain);
        }
        let started = self.run(&["start", &container]).await?;
        if !started.success {
            return Err(SandboxError::Uncertain);
        }
        Ok(())
    }

    async fn status(
        &self,
        handle: &str,
        environment: &AnalysisEnvironment,
    ) -> Result<SandboxState, SandboxError> {
        let container = name(handle)?;
        let info = match self.inspect(&container).await? {
            Some(info) => info,
            None => {
                // Fence first, then report absence only once a fence exists. A
                // failed fence create with no container left is never absence.
                let fenced = self.fence(&container, &environment.image_digest).await?;
                match self.inspect(&container).await? {
                    Some(info) => info,
                    None if !fenced => return Ok(SandboxState::Unconfirmed),
                    None => return Ok(SandboxState::Unconfirmed),
                }
            }
        };
        if info["Config"]["Labels"]["zobba.analysis.fence"] == "1" {
            return Ok(SandboxState::Absent);
        }
        let state = &info["State"];
        Ok(match state["Status"].as_str() {
            Some("created") => SandboxState::Starting,
            Some("running" | "paused" | "restarting") => SandboxState::Running,
            Some("exited" | "dead") => SandboxState::Exited {
                exit_code: state["ExitCode"]
                    .as_i64()
                    .and_then(|v| i32::try_from(v).ok()),
                out_of_memory: state["OOMKilled"].as_bool().unwrap_or(false),
            },
            _ => SandboxState::Unconfirmed,
        })
    }

    async fn stop(
        &self,
        handle: &str,
        environment: &AnalysisEnvironment,
    ) -> Result<(), SandboxError> {
        let container = name(handle)?;
        let _ = self.run(&["kill", &container]).await?;
        if let Some(info) = self.inspect(&container).await?
            && info["State"]["Status"] == "created"
        {
            // Never started: remove (refused if it started meanwhile) and fence.
            if self.run(&["rm", &container]).await?.success
                && !self.fence(&container, &environment.image_digest).await?
            {
                return Err(SandboxError::Unavailable);
            }
        }
        Ok(())
    }

    async fn collect(
        &self,
        handle: &str,
        limits: &AnalysisLimits,
    ) -> Result<Collection, SandboxError> {
        let container = name(handle)?;
        match self
            .inspect(&container)
            .await?
            .as_ref()
            .and_then(|info| info["State"]["Status"].as_str().map(str::to_owned))
            .as_deref()
        {
            Some("exited" | "dead") => {}
            _ => return Err(SandboxError::Unavailable),
        }
        let output = self
            .docker(
                &[
                    "exec".into(),
                    "-i".into(),
                    format!("{container}-hold"),
                    "python3".into(),
                    "-I".into(),
                    "-".into(),
                    "local".into(),
                    limits.output_file_bytes.to_string(),
                    limits.output_total_bytes.to_string(),
                    limits.output_files.to_string(),
                ],
                Some(COLLECTOR.as_bytes()),
            )
            .await?;
        if !output.success {
            return Err(SandboxError::Unavailable);
        }
        let value: serde_json::Value =
            serde_json::from_slice(&output.stdout).map_err(|_| SandboxError::Unavailable)?;
        let free = value["free"].as_u64().ok_or(SandboxError::Unavailable)?;
        let mut collection = Collection {
            // The volume holds total + 1 MiB of headroom; under 64 KiB free
            // means a writer reached the total output bound.
            full: free < 64 * 1024,
            truncated: value["truncated"]
                .as_bool()
                .ok_or(SandboxError::Unavailable)?,
            entries: Vec::new(),
        };
        use base64::Engine as _;
        for entry in value["entries"]
            .as_array()
            .ok_or(SandboxError::Unavailable)?
        {
            let path = entry["path_hex"]
                .as_str()
                .and_then(decode_hex)
                .ok_or(SandboxError::Unavailable)?;
            let withheld = match entry.get("withheld") {
                None => None,
                Some(value) => Some(
                    value
                        .as_str()
                        .and_then(Withheld::parse)
                        .ok_or(SandboxError::Unavailable)?,
                ),
            };
            let kind = entry["kind"]
                .as_str()
                .and_then(OutputKind::parse)
                .ok_or(SandboxError::Unavailable)?;
            let content = match entry["content"].as_str() {
                Some(text) => Some(
                    base64::engine::general_purpose::STANDARD
                        .decode(text)
                        .map_err(|_| SandboxError::Unavailable)?,
                ),
                None => None,
            };
            collection.entries.push(OutputEntry {
                path,
                kind,
                links: entry["links"].as_u64().ok_or(SandboxError::Unavailable)?,
                size: entry["size"].as_u64().ok_or(SandboxError::Unavailable)?,
                content,
                withheld,
            });
        }
        Ok(collection)
    }

    async fn discard(&self, handle: &str) -> Result<(), SandboxError> {
        let container = name(handle)?;
        let _ = self
            .run(&["rm", "-f", &container, &format!("{container}-hold")])
            .await?;
        let _ = self
            .run(&["volume", "rm", "-f", &format!("{container}-out")])
            .await?;
        self.remove_staging(&container);
        Ok(())
    }
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2)
        || value.len() > 2 * zobba_domain::analysis::COLLECT_PATH_BYTES_MAX
    {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(value.get(i..i + 2)?, 16).ok())
        .collect()
}

/// Remove every container and volume this test sandbox created.
pub async fn remove_all_test_resources() {
    for arguments in [
        vec!["ps", "-aq", "--filter", &format!("label={LABEL}")],
        vec!["volume", "ls", "-q", "--filter", &format!("label={LABEL}")],
    ] {
        let Ok(output) = Command::new("docker").args(&arguments).output().await else {
            return;
        };
        let ids: Vec<String> = String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .map(str::to_owned)
            .collect();
        if ids.is_empty() {
            continue;
        }
        let mut remove = if arguments[0] == "ps" {
            vec!["rm".to_owned(), "-f".into()]
        } else {
            vec!["volume".to_owned(), "rm".into(), "-f".into()]
        };
        remove.extend(ids);
        let _ = Command::new("docker").args(&remove).output().await;
    }
}
