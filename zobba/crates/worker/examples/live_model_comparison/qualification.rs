//! Whether a live run may start, and the harness's own trusted qualification
//! source. A live run needs a receipt from the repository's qualification
//! runner (`crates/infrastructure/examples/model_qualification.rs`) that shows
//! the exact provider and model passed every phase, or the explicit
//! `--assume-qualified-for-evaluation` flag, which is written loudly into the
//! result. No production qualification rule is changed: this source exists
//! only inside this harness process.
use serde::Serialize;
use std::path::{Path, PathBuf};
use zobba_application::model::{ModelProfile, ModelQualificationSource, Provider, Qualification};

pub const LIVE_CAPABILITY_REVISION: &str = "native-v1-comparison";
pub const FIXTURE_CAPABILITY_REVISION: &str = "fixture-native-v1";
pub const ASSUMED_WARNING: &str = "ASSUMED QUALIFIED FOR EVALUATION ONLY: no qualification receipt from the repository's qualification runner shows this provider and model passing; this result is not evidence of qualification.";

#[derive(Clone, Debug, Serialize)]
pub struct QualificationRecord {
    /// "fixture" (scripted), "receipt" or "assumed_for_evaluation".
    pub basis: String,
    pub receipt: Option<String>,
    pub warning: Option<String>,
    pub note: String,
}

impl QualificationRecord {
    pub fn fixture() -> Self {
        Self {
            basis: "fixture".into(),
            receipt: None,
            warning: None,
            note: "Scripted mode: the loopback fixture provider, never a live provider.".into(),
        }
    }
}

/// The phases the qualification runner sends for one provider and model.
const PHASES: [&str; 3] = ["text", "tool", "continuation"];

/// The first receipt in `dir` whose run finished with the runner's own
/// success result and whose observed text, tool and continuation calls for
/// this provider all requested and were answered by exactly this model.
pub fn receipt_for(dir: &Path, provider: Provider, model: &str) -> Result<Option<PathBuf>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(None),
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("model-qualification-") && n.ends_with(".jsonl"))
        })
        .collect();
    files.sort();
    for file in files {
        let text = std::fs::read_to_string(&file)
            .map_err(|e| format!("cannot read receipt {}: {e}", file.display()))?;
        if receipt_qualifies(&text, provider, model) {
            return Ok(Some(file));
        }
    }
    Ok(None)
}

/// The rule, separated for the self-check.
pub fn receipt_qualifies(text: &str, provider: Provider, model: &str) -> bool {
    let records: Vec<serde_json::Value> = text
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let finished = records.iter().any(|r| {
        r["kind"] == "finished" && r["result"] == "adapter_qualification_evidence_only"
    });
    let stopped = records
        .iter()
        .any(|r| r["kind"] == "qualification_stopped");
    let passed = |phase: &str| {
        records.iter().any(|r| {
            r["kind"] == "observed"
                && r["phase"] == phase
                && r["provider"] == provider.as_str()
                && r["requested_model"] == model
                && r["actual_model"] == model
                && r["transport_completion"] == "Succeeded"
        }) && records.iter().any(|r| {
            r["kind"] == "validated_synthetic_output" && r["phase"] == phase
        })
    };
    finished && !stopped && PHASES.iter().all(|phase| passed(phase))
}

/// The harness's trusted source: exactly one profile (provider, model,
/// account, destination, capability revision and qualification class).
pub struct Qualified {
    pub provider: Provider,
    pub model: String,
    pub account: String,
    pub destination: String,
    pub capability_revision: String,
    pub qualification: Qualification,
}
impl ModelQualificationSource for Qualified {
    fn qualified(&self, p: &ModelProfile) -> bool {
        p.qualification == self.qualification
            && p.provider == self.provider
            && p.model == self.model
            && p.account_id == self.account
            && p.destination == self.destination
            && p.capability_revision == self.capability_revision
    }
}
