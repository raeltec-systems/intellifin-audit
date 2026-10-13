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
    analysis::{AnalysisLimits, INPUT_DIR, OUTPUT_DIR, OutputEntry, OutputKind, PROGRAM_PATH},
    identity::valid_scope_id,
};

const CLI_TIMEOUT: Duration = Duration::from_secs(60);
const CLI_OUTPUT_LIMIT: usize = 1024 * 1024;
const TMP_BYTES: u64 = 64 * 1024 * 1024;
/// The collector stops after this many entries and reports truncation.
pub const COLLECT_ENTRIES: usize = 1024;
const LABEL: &str = "zobba.analysis.test-sandbox";

/// Trusted collector, run in the holder container over the read-only output
/// volume after the job stopped. `lstat` only; links are never followed.
const COLLECTOR: &str = r#"
import base64, json, os, stat, sys
root = b"/output"
per, total, entries_max = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
vfs = os.statvfs(root)
free = vfs.f_bavail * vfs.f_frsize
out = []
budget = total
truncated = False
def walk(relative, depth):
    global budget, truncated
    directory = os.path.join(root, relative) if relative else root
    for name in sorted(os.listdir(directory)):
        if len(out) >= entries_max:
            truncated = True
            return
        path = os.path.join(relative, name) if relative else name
        full = os.path.join(root, path)
        info = os.lstat(full)
        mode = info.st_mode
        kind = ("directory" if stat.S_ISDIR(mode) else "regular" if stat.S_ISREG(mode)
                else "symlink" if stat.S_ISLNK(mode) else "fifo" if stat.S_ISFIFO(mode)
                else "socket" if stat.S_ISSOCK(mode) else "device" if (stat.S_ISCHR(mode) or stat.S_ISBLK(mode)) else "other")
        entry = {"path": path.hex(), "kind": kind, "links": info.st_nlink, "size": info.st_size}
        if kind == "regular" and info.st_nlink == 1 and info.st_size <= per and info.st_size <= budget:
            fd = os.open(full, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                again = os.fstat(fd)
                if stat.S_ISREG(again.st_mode) and again.st_ino == info.st_ino:
                    data = os.read(fd, info.st_size + 1)
                    entry["content"] = base64.b64encode(data).decode()
                    budget -= len(data)
            finally:
                os.close(fd)
        out.append(entry)
        if kind == "directory" and depth < 16:
            walk(path, depth + 1)
walk(b"", 0)
json.dump({"free": free, "truncated": truncated, "entries": out}, sys.stdout)
"#;

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
    /// makes any delayed `docker create` for this attempt fail.
    async fn fence(&self, container: &str, digest: &str) -> Result<(), SandboxError> {
        let mut arguments = vec!["create".to_owned(), "--name".into(), container.into()];
        arguments.extend(Self::hardening(None));
        arguments.extend(["--label".into(), "zobba.analysis.fence=1".into()]);
        arguments.extend([self.image(digest), "true".into()]);
        let _ = self.docker(&arguments, None).await?;
        Ok(())
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
        let root = self.stage(spec, &container)?;
        let volume = format!("{container}-out");
        let size = spec.limits.output_total_bytes + 1024 * 1024;
        if !self
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
            .await?
            .success
        {
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
        if !self.docker(&hold, None).await?.success {
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
        let created = self.docker(&create, None).await?;
        if !created.success {
            // A fence or a concurrent create owns the name: not ours to start.
            return Err(SandboxError::Uncertain);
        }
        let started = self.run(&["start", &container]).await?;
        if !started.success {
            return Err(SandboxError::Uncertain);
        }
        Ok(())
    }

    async fn status(&self, handle: &str) -> Result<SandboxState, SandboxError> {
        let container = name(handle)?;
        let Some(info) = self.inspect(&container).await? else {
            // Fence first, then report absence only once the fence exists.
            let digest = zobba_domain::analysis::GENERAL_IMAGE_DIGEST;
            self.fence(&container, digest).await?;
            return match self.inspect(&container).await? {
                Some(info) if info["Config"]["Labels"]["zobba.analysis.fence"] == "1" => {
                    Ok(SandboxState::Absent)
                }
                _ => Ok(SandboxState::Unconfirmed),
            };
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

    async fn stop(&self, handle: &str) -> Result<(), SandboxError> {
        let container = name(handle)?;
        let _ = self.run(&["kill", &container]).await?;
        if let Some(info) = self.inspect(&container).await?
            && info["State"]["Status"] == "created"
        {
            // Never started: remove (refused if it started meanwhile) and fence.
            if self.run(&["rm", &container]).await?.success {
                self.fence(&container, zobba_domain::analysis::GENERAL_IMAGE_DIGEST)
                    .await?;
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
        match self.status(handle).await? {
            SandboxState::Exited { .. } => {}
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
                    limits.output_file_bytes.to_string(),
                    limits.output_total_bytes.to_string(),
                    COLLECT_ENTRIES.to_string(),
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
            let path = entry["path"]
                .as_str()
                .and_then(decode_hex)
                .ok_or(SandboxError::Unavailable)?;
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
            });
        }
        Ok(collection)
    }

    async fn discard(&self, handle: &str) -> Result<(), SandboxError> {
        use std::os::unix::fs::PermissionsExt;
        let container = name(handle)?;
        let _ = self
            .run(&["rm", "-f", &container, &format!("{container}-hold")])
            .await?;
        let _ = self
            .run(&["volume", "rm", "-f", &format!("{container}-out")])
            .await?;
        let root = self.staging_root.join(&container);
        for dir in [root.join("input"), root.join("job"), root.clone()] {
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755));
        }
        let _ = std::fs::remove_dir_all(root);
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
