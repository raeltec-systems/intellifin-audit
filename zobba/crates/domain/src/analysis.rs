//! Measured analysis jobs (Story 22.4): pure meaning, limits, status and the
//! trusted output rules. No sandbox, storage, hashing or cloud types enter.
//!
//! A job is an exact recorded operation: a supplied program, run in one
//! server-allowlisted environment (pinned by image digest) over immutable
//! staged originals, with bounded compute. Nothing a job produces is trusted
//! until [`validate_outputs`] accepts it and trusted code measures its hash.
use crate::{
    identity::valid_scope_id,
    permissions::{Attachment, MATERIAL_MAX, SET_MAX, valid_digest},
};

/// Program text is stored once for staging; receipts carry only its digest.
pub const MAX_PROGRAM_BYTES: usize = 256 * 1024;
pub const MAX_INPUTS: usize = SET_MAX;
/// Fixed sandbox layout. Inputs are staged read-only under their original IDs.
pub const INPUT_DIR: &str = "/input";
pub const PROGRAM_PATH: &str = "/job/program";
pub const OUTPUT_DIR: &str = "/output";
/// Bounded descendant path shape.
pub const OUTPUT_PATH_MAX: usize = 255;
pub const OUTPUT_DEPTH_MAX: usize = 8;
/// A descendant is registered through the same immutable evidence path as an
/// original, so one output file cannot exceed an original's bound.
pub const OUTPUT_FILE_CEILING: u64 = crate::evidence::MAX_ORIGINAL_BYTES as u64;
/// Trusted collectors stop after this many entries and report truncation.
pub const COLLECT_ENTRIES_MAX: usize = 1024;
/// Collectors report at most this many path bytes; a longer name is withheld
/// as too long, so a hostile tree can never make the manifest unbounded.
pub const COLLECT_PATH_BYTES_MAX: usize = OUTPUT_PATH_MAX + 1;
/// A job is refused for good after this many attempts that never started.
pub const MAX_START_ATTEMPTS: u32 = 8;
/// A receipt names at most this many rejected entries; every rejection is a
/// separate row and the receipt also carries exact counts per reason.
pub const RECEIPT_REJECTION_SAMPLE: usize = 32;

/// Owner-approved ceilings (Story 22.4 "Ask First"): 2 vCPU, 4 GiB, 15 minutes,
/// 100 MiB total output. A request may only narrow them.
pub const CEILING: AnalysisLimits = AnalysisLimits {
    cpu_millis: 2_000,
    memory_mib: 4_096,
    pids: 256,
    wall_seconds: 900,
    output_total_bytes: 100 * 1024 * 1024,
    output_file_bytes: OUTPUT_FILE_CEILING,
    output_files: 64,
};
const FLOOR: AnalysisLimits = AnalysisLimits {
    cpu_millis: 250,
    memory_mib: 128,
    pids: 16,
    wall_seconds: 1,
    output_total_bytes: 1,
    output_file_bytes: 1,
    output_files: 1,
};

macro_rules! vocabulary {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];
            pub const fn as_str(self) -> &'static str { match self { $(Self::$variant => $value),+ } }
            pub fn parse(value: &str) -> Option<Self> { match value { $($value => Some(Self::$variant),)+ _ => None } }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AnalysisLimits {
    pub cpu_millis: u32,
    pub memory_mib: u32,
    pub pids: u32,
    pub wall_seconds: u32,
    pub output_total_bytes: u64,
    pub output_file_bytes: u64,
    pub output_files: u32,
}
impl AnalysisLimits {
    pub const DEFAULT: Self = Self {
        cpu_millis: 1_000,
        memory_mib: 1_024,
        pids: 128,
        wall_seconds: 300,
        output_total_bytes: 32 * 1024 * 1024,
        output_file_bytes: 8 * 1024 * 1024,
        output_files: 32,
    };
    pub fn is_valid(&self) -> bool {
        (FLOOR.cpu_millis..=CEILING.cpu_millis).contains(&self.cpu_millis)
            && (FLOOR.memory_mib..=CEILING.memory_mib).contains(&self.memory_mib)
            && (FLOOR.pids..=CEILING.pids).contains(&self.pids)
            && (FLOOR.wall_seconds..=CEILING.wall_seconds).contains(&self.wall_seconds)
            && (FLOOR.output_total_bytes..=CEILING.output_total_bytes)
                .contains(&self.output_total_bytes)
            && (FLOOR.output_file_bytes..=CEILING.output_file_bytes)
                .contains(&self.output_file_bytes)
            && self.output_file_bytes <= self.output_total_bytes
            && (FLOOR.output_files..=CEILING.output_files).contains(&self.output_files)
    }
}

/// One server-owned environment. Requests can only name an entry by ID and
/// repeat its digest; they can never name an image, repository or command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnalysisEnvironment {
    pub id: String,
    /// `sha256:<64 hex>` of the image index or manifest.
    pub image_digest: String,
    /// Fixed interpreter argv; the program is always the last argument.
    pub command: Vec<String>,
    /// Sorted media types a descendant of this environment may have.
    pub media_types: Vec<String>,
}
impl AnalysisEnvironment {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.id)
            && valid_image_digest(&self.image_digest)
            && !self.command.is_empty()
            && self.command.len() <= 8
            && self
                .command
                .iter()
                .all(|v| !v.is_empty() && v.len() <= 256 && !v.chars().any(char::is_control))
            && !self.media_types.is_empty()
            && self
                .media_types
                .iter()
                .all(|m| MEDIA_TYPES.iter().any(|(_, known)| known == m))
            && self.media_types.windows(2).all(|p| p[0] < p[1])
    }
    /// Program argv inside the sandbox.
    pub fn argv(&self) -> Vec<String> {
        let mut argv = self.command.clone();
        argv.push(PROGRAM_PATH.into());
        argv
    }
}

pub fn valid_image_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(valid_digest)
}

/// The one pinned general-purpose analysis image: Python 3.13 slim plus the
/// owner-approved document libraries (Story 22.5: pandas, openpyxl,
/// python-docx, pypdfium2; `deploy/qualification/analysis/general`). The
/// digest is the reproducible OCI manifest digest that `build.sh` prints. Any
/// further allowlist entry or library is an explicit owner decision.
pub const GENERAL_ENVIRONMENT_ID: &str = "general-python-3-13";
pub const GENERAL_IMAGE_DIGEST: &str =
    "sha256:8241deca19d20b576c0d4b2ad75deac753492d335de45d284766df3d5666ea5f";
/// The Story 22.4 base it is built from (Python 3.13 slim, index digest).
pub const GENERAL_BASE_IMAGE_DIGEST: &str =
    "sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f";
pub fn server_allowlist() -> Vec<AnalysisEnvironment> {
    vec![AnalysisEnvironment {
        id: GENERAL_ENVIRONMENT_ID.into(),
        image_digest: GENERAL_IMAGE_DIGEST.into(),
        command: vec!["python3".into(), "-I".into(), "-B".into()],
        media_types: vec![
            "application/json".into(),
            // Page images rendered by the trusted document program.
            "image/png".into(),
            "text/csv".into(),
            "text/markdown".into(),
            "text/plain".into(),
        ],
    }]
}

/// Extension → media type. Trusted code decides the type; program output
/// metadata never does. An unlisted extension has no type and is refused.
pub const MEDIA_TYPES: &[(&str, &str)] = &[
    ("csv", "text/csv"),
    ("json", "application/json"),
    ("md", "text/markdown"),
    ("png", "image/png"),
    ("txt", "text/plain"),
];
pub fn media_type_for(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next()?;
    let (stem, extension) = name.rsplit_once('.')?;
    if stem.is_empty() {
        return None;
    }
    let extension = extension.to_ascii_lowercase();
    MEDIA_TYPES
        .iter()
        .find(|(known, _)| *known == extension)
        .map(|(_, media)| *media)
}

/// An immutable registered original, by ID and the digest the caller saw.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnalysisInput {
    pub original_id: String,
    pub digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnalysisRequest {
    pub environment_id: String,
    pub image_digest: String,
    pub program: String,
    /// Asserted by the caller and measured again by trusted code.
    pub program_sha256: String,
    /// Strictly ordered by original ID.
    pub inputs: Vec<AnalysisInput>,
    pub limits: AnalysisLimits,
}
impl AnalysisRequest {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.environment_id)
            && valid_image_digest(&self.image_digest)
            && !self.program.is_empty()
            && self.program.len() <= MAX_PROGRAM_BYTES
            && !self.program.contains('\0')
            && valid_digest(&self.program_sha256)
            && self.inputs.len() <= MAX_INPUTS
            && self
                .inputs
                .iter()
                .all(|i| valid_scope_id(&i.original_id) && valid_digest(&i.digest))
            && self
                .inputs
                .windows(2)
                .all(|p| p[0].original_id < p[1].original_id)
            && self.limits.is_valid()
    }

    /// Exact allowlist entry this request names, or None (refused before any
    /// consumption, staging or sandbox call).
    pub fn environment<'a>(
        &self,
        allowlist: &'a [AnalysisEnvironment],
    ) -> Option<&'a AnalysisEnvironment> {
        allowlist.iter().find(|e| {
            e.is_valid() && e.id == self.environment_id && e.image_digest == self.image_digest
        })
    }

    /// Canonical reviewed meaning bound into the operation material: the
    /// environment and digest, program SHA-256, every input and every limit.
    /// Program text is deliberately absent; only its digest is reviewed.
    pub fn canonical_material(&self) -> Option<String> {
        if !self.is_valid() {
            return None;
        }
        let l = &self.limits;
        let mut out = format!(
            "zobba-analysis-v1\nenvironment:{}\nimage:{}\nprogram:{}\ninputs:{}\n",
            self.environment_id,
            self.image_digest,
            self.program_sha256,
            self.inputs.len()
        );
        for input in &self.inputs {
            out.push_str(&format!("input:{}:{}\n", input.original_id, input.digest));
        }
        out.push_str(&format!(
            "limits:cpu_millis={},memory_mib={},pids={},wall_seconds={},output_total_bytes={},output_file_bytes={},output_files={}\n",
            l.cpu_millis,
            l.memory_mib,
            l.pids,
            l.wall_seconds,
            l.output_total_bytes,
            l.output_file_bytes,
            l.output_files
        ));
        (out.len() <= MATERIAL_MAX).then_some(out)
    }

    /// Inputs as operation attachments with one trusted classification.
    pub fn attachments(&self, classification: &str) -> Vec<Attachment> {
        self.inputs
            .iter()
            .map(|i| Attachment {
                id: i.original_id.clone(),
                digest: i.digest.clone(),
                classification: classification.into(),
            })
            .collect()
    }
}

vocabulary!(JobStatus {
    Admitted => "admitted",
    PossiblyStarted => "possibly_started",
    Running => "running",
    Completed => "completed",
    Failed => "failed",
    LimitExceeded => "limit_exceeded",
    Stopped => "stopped",
    Collected => "collected",
    Unknown => "unknown",
    Absent => "absent",
});
impl JobStatus {
    /// Confirmed whole-job termination.
    pub const fn is_terminated(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::LimitExceeded | Self::Stopped
        )
    }
    /// Collection is permitted only after confirmed termination; a stopped job
    /// is discarded rather than collected.
    pub const fn collectable(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::LimitExceeded)
    }
    /// A new attempt may start: never started, or source-confirmed absent.
    pub const fn retryable(self) -> bool {
        matches!(self, Self::Admitted | Self::Absent)
    }
    /// Exact durable transitions. `Unknown` never leaves automatically; the
    /// operator transitions exist only for explicit reconciliation.
    pub fn can_follow(self, previous: Self) -> bool {
        use JobStatus::*;
        match previous {
            Admitted => matches!(self, PossiblyStarted | Absent),
            // Failed only as `start_refused`, after MAX_START_ATTEMPTS.
            Absent => matches!(self, PossiblyStarted | Absent | Failed),
            PossiblyStarted => matches!(
                self,
                Running | Completed | Failed | LimitExceeded | Stopped | Absent | Unknown
            ),
            Running => matches!(self, Completed | Failed | LimitExceeded | Stopped | Unknown),
            Completed | Failed | LimitExceeded => matches!(self, Collected | Unknown),
            Unknown => matches!(self, Absent | Completed | Failed | LimitExceeded | Stopped),
            Stopped | Collected => false,
        }
    }
}

vocabulary!(LimitReason {
    WallTime => "wall_time",
    Memory => "memory",
    OutputFile => "output_file",
    OutputTotal => "output_total",
});

vocabulary!(OutputKind {
    Regular => "regular",
    Directory => "directory",
    Symlink => "symlink",
    Fifo => "fifo",
    Socket => "socket",
    Device => "device",
    Other => "other",
});

vocabulary!(RejectReason {
    Encoding => "encoding",
    Nul => "nul",
    ControlCharacter => "control_character",
    ReservedCharacter => "reserved_character",
    Absolute => "absolute",
    ParentReference => "parent_reference",
    NotNormalized => "not_normalized",
    TooLong => "too_long",
    TooDeep => "too_deep",
    Duplicate => "duplicate",
    CaseCollision => "case_collision",
    Symlink => "symlink",
    Hardlink => "hardlink",
    Fifo => "fifo",
    Socket => "socket",
    Device => "device",
    NotRegular => "not_regular",
    FileTooLarge => "file_too_large",
    SizeMismatch => "size_mismatch",
    TooManyFiles => "too_many_files",
    TotalTooLarge => "total_too_large",
    MediaType => "media_type",
    CollectionTruncated => "collection_truncated",
    CollectionUnavailable => "collection_unavailable",
});

vocabulary!(Withheld {
    TooLong => "too_long",
    Unreadable => "unreadable",
    Budget => "budget",
    Slots => "slots",
});

/// The one case-insensitive identity of an output path, shared by the trusted
/// validator and the database unique key: NFC, Unicode full case folding,
/// then NFC again (folding can denormalize).
pub fn fold_key(path: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let normalized: String = path.nfc().collect();
    caseless::default_case_fold_str(&normalized).nfc().collect()
}

/// Untrusted collector report of one filesystem entry under the output
/// directory, gathered with `lstat` semantics (links never followed).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputEntry {
    /// Raw relative name bytes as reported.
    pub path: Vec<u8>,
    pub kind: OutputKind,
    pub links: u64,
    pub size: u64,
    /// Present only for regular files the collector read within limits.
    pub content: Option<Vec<u8>>,
    /// Why a trusted collector reported this entry without its content.
    pub withheld: Option<Withheld>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AcceptedOutput {
    pub index: usize,
    pub path: String,
    /// [`fold_key`] of the path, stored as the database unique key.
    pub fold_key: String,
    pub media_type: &'static str,
    pub size: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RejectedOutput {
    pub index: usize,
    pub reason: RejectReason,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OutputValidation {
    pub accepted: Vec<AcceptedOutput>,
    pub rejected: Vec<RejectedOutput>,
}

fn path_shape(raw: &[u8]) -> Result<String, RejectReason> {
    if raw.contains(&0) {
        return Err(RejectReason::Nul);
    }
    let path = std::str::from_utf8(raw).map_err(|_| RejectReason::Encoding)?;
    if path.chars().any(char::is_control) {
        return Err(RejectReason::ControlCharacter);
    }
    if path.contains('\\') {
        return Err(RejectReason::ReservedCharacter);
    }
    if path.starts_with('/') {
        return Err(RejectReason::Absolute);
    }
    let components: Vec<&str> = path.split('/').collect();
    if components.contains(&"..") {
        return Err(RejectReason::ParentReference);
    }
    if components.iter().any(|c| c.is_empty() || *c == ".") {
        return Err(RejectReason::NotNormalized);
    }
    if path.len() > OUTPUT_PATH_MAX {
        return Err(RejectReason::TooLong);
    }
    if components.len() > OUTPUT_DEPTH_MAX {
        return Err(RejectReason::TooDeep);
    }
    Ok(path.to_owned())
}

/// Trusted output rules. Directories are structure, not outputs. Every other
/// entry is either accepted (later measured and registered) or refused with a
/// closed reason; a refusal never removes a safe sibling. Paths are examined in
/// byte order so the result is deterministic for the same collection.
pub fn validate_outputs(
    entries: &[OutputEntry],
    limits: &AnalysisLimits,
    environment: &AnalysisEnvironment,
) -> OutputValidation {
    let mut result = OutputValidation::default();
    let mut order: Vec<usize> = (0..entries.len()).collect();
    order.sort_by(|a, b| entries[*a].path.cmp(&entries[*b].path));
    let mut candidates: Vec<(usize, String)> = Vec::new();
    for index in order {
        let entry = &entries[index];
        let reject = |reason| RejectedOutput { index, reason };
        if entry.withheld == Some(Withheld::TooLong) {
            result.rejected.push(reject(RejectReason::TooLong));
            continue;
        }
        let path = match path_shape(&entry.path) {
            Ok(path) => path,
            Err(reason) => {
                result.rejected.push(reject(reason));
                continue;
            }
        };
        let kind = match entry.kind {
            OutputKind::Directory => continue,
            OutputKind::Regular if entry.links > 1 => Err(RejectReason::Hardlink),
            OutputKind::Regular => Ok(()),
            OutputKind::Symlink => Err(RejectReason::Symlink),
            OutputKind::Fifo => Err(RejectReason::Fifo),
            OutputKind::Socket => Err(RejectReason::Socket),
            OutputKind::Device => Err(RejectReason::Device),
            OutputKind::Other => Err(RejectReason::NotRegular),
        };
        if let Err(reason) = kind {
            result.rejected.push(reject(reason));
            continue;
        }
        candidates.push((index, path));
    }
    // Exact and case-insensitive uniqueness: no member of a colliding group is
    // canonical, so every member is refused.
    let keys: Vec<String> = candidates.iter().map(|(_, p)| fold_key(p)).collect();
    let mut keep = Vec::new();
    for (position, (index, path)) in candidates.iter().enumerate() {
        let exact = candidates
            .iter()
            .enumerate()
            .any(|(other, (_, p))| other != position && p == path);
        let folded = keys
            .iter()
            .enumerate()
            .any(|(other, k)| other != position && *k == keys[position]);
        if exact {
            result.rejected.push(RejectedOutput {
                index: *index,
                reason: RejectReason::Duplicate,
            });
        } else if folded {
            result.rejected.push(RejectedOutput {
                index: *index,
                reason: RejectReason::CaseCollision,
            });
        } else {
            keep.push((*index, path.clone(), keys[position].clone()));
        }
    }
    let mut total: u64 = 0;
    for (index, path, fold_key) in keep {
        let entry = &entries[index];
        let reject = |reason| RejectedOutput { index, reason };
        let media = media_type_for(&path)
            .filter(|media| environment.media_types.iter().any(|m| m == media));
        let Some(media_type) = media else {
            result.rejected.push(reject(RejectReason::MediaType));
            continue;
        };
        if entry.size > limits.output_file_bytes {
            result.rejected.push(reject(RejectReason::FileTooLarge));
            continue;
        }
        // A collector withheld the bytes for a reason of its own budget; that
        // reason, not a size mismatch, is the refusal.
        match entry.withheld {
            Some(Withheld::Budget) => {
                result.rejected.push(reject(RejectReason::TotalTooLarge));
                continue;
            }
            Some(Withheld::Slots) => {
                result.rejected.push(reject(RejectReason::TooManyFiles));
                continue;
            }
            Some(Withheld::Unreadable) => {
                result.rejected.push(reject(RejectReason::NotRegular));
                continue;
            }
            Some(Withheld::TooLong) | None => {}
        }
        if entry.content.as_ref().map(|c| c.len() as u64) != Some(entry.size) {
            result.rejected.push(reject(RejectReason::SizeMismatch));
            continue;
        }
        if result.accepted.len() >= limits.output_files as usize {
            result.rejected.push(reject(RejectReason::TooManyFiles));
            continue;
        }
        if total.saturating_add(entry.size) > limits.output_total_bytes {
            result.rejected.push(reject(RejectReason::TotalTooLarge));
            continue;
        }
        total += entry.size;
        result.accepted.push(AcceptedOutput {
            index,
            path,
            fold_key,
            media_type,
            size: entry.size,
        });
    }
    result.rejected.sort_by_key(|r| r.index);
    result
}

#[cfg(test)]
mod tests;
