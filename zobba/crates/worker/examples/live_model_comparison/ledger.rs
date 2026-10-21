//! The cumulative spend ledger across runs. A run is admitted only when the
//! ledger's committed spend plus this run's own cap fits the total cap. A run
//! reserves its whole cap before the first paid call and records its metered
//! spend after every call; a run that never finished counts at its whole cap
//! (or its spend, if higher) until a person reconciles it deliberately.
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub const SCHEMA: u32 = 1;
const EPSILON: f64 = 1e-9;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub entry_id: String,
    pub run_id: String,
    pub mode: String,
    pub provider: String,
    pub model: String,
    pub output_dir: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    /// "reserved" while the run may still spend; "finished" once it stopped.
    pub state: String,
    pub run_cap_usd: f64,
    pub spent_usd: f64,
    pub calls_sent: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub unknown_usage_calls: u64,
    pub stop_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LedgerFile {
    pub schema: u32,
    pub comparison: String,
    pub total_cap_usd: f64,
    pub entries: Vec<Entry>,
}

impl LedgerFile {
    pub fn new(comparison: &str, total_cap_usd: f64) -> Self {
        Self {
            schema: SCHEMA,
            comparison: comparison.into(),
            total_cap_usd,
            entries: vec![],
        }
    }
    /// Spend that may already have happened: a finished run's metered spend;
    /// an unfinished (possibly interrupted) run's whole cap or its spend.
    pub fn committed(&self) -> f64 {
        self.entries
            .iter()
            .map(|e| {
                if e.state == "finished" {
                    e.spent_usd
                } else {
                    e.spent_usd.max(e.run_cap_usd)
                }
            })
            .sum()
    }
    pub fn admission(&self, run_cap_usd: f64) -> Result<(), String> {
        let committed = self.committed();
        if committed + run_cap_usd > self.total_cap_usd + EPSILON {
            return Err(format!(
                "refused: the ledger already commits {committed:.4} USD; this run's cap of {run_cap_usd:.4} USD would pass the total cap of {:.2} USD",
                self.total_cap_usd
            ));
        }
        Ok(())
    }
}

/// Holds the ledger lock for the life of a run.
struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub struct Ledger {
    path: PathBuf,
    file: LedgerFile,
    index: usize,
    _lock: Lock,
}

/// A read-only early check (no lock, no write), so a run that the ledger
/// would refuse is refused before the engagement is set up.
pub fn precheck(path: &Path, comparison: &str, total_cap_usd: f64, run_cap_usd: f64) -> Result<(), String> {
    if path.with_extension("lock").exists() {
        return Err(format!(
            "the ledger lock {} exists: another run is active, or one stopped abnormally",
            path.with_extension("lock").display()
        ));
    }
    let file = match fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<LedgerFile>(&bytes)
            .map_err(|e| format!("the ledger {} is not valid: {e}", path.display()))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            LedgerFile::new(comparison, total_cap_usd)
        }
        Err(error) => return Err(format!("cannot read the ledger {}: {error}", path.display())),
    };
    if file.comparison != comparison || (file.total_cap_usd - total_cap_usd).abs() > EPSILON {
        return Err(format!(
            "the ledger {} belongs to another comparison or total cap",
            path.display()
        ));
    }
    file.admission(run_cap_usd)
}

impl Ledger {
    /// Take the ledger lock, load (or start) the ledger, refuse the run when
    /// it would pass the total cap, and durably record its reservation.
    pub fn open_and_reserve(
        path: &Path,
        comparison: &str,
        total_cap_usd: f64,
        entry: Entry,
    ) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create the ledger folder {}: {e}", parent.display()))?;
        }
        let lock_path = path.with_extension("lock");
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .map_err(|_| {
                format!(
                    "the ledger lock {} exists: another run is active, or one stopped abnormally (remove the lock only when no run is active)",
                    lock_path.display()
                )
            })?;
        let lock = Lock(lock_path);
        let mut file = match fs::read(path) {
            Ok(bytes) => serde_json::from_slice::<LedgerFile>(&bytes)
                .map_err(|e| format!("the ledger {} is not valid: {e}", path.display()))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                LedgerFile::new(comparison, total_cap_usd)
            }
            Err(error) => return Err(format!("cannot read the ledger {}: {error}", path.display())),
        };
        if file.schema != SCHEMA || file.comparison != comparison {
            return Err(format!(
                "the ledger {} belongs to another comparison or schema",
                path.display()
            ));
        }
        if (file.total_cap_usd - total_cap_usd).abs() > EPSILON {
            return Err(format!(
                "the ledger {} was started with a total cap of {} USD, the comparison file says {}: change one of them deliberately",
                path.display(),
                file.total_cap_usd,
                total_cap_usd
            ));
        }
        if file.entries.iter().any(|e| e.entry_id == entry.entry_id) {
            return Err("this run's ledger entry already exists".into());
        }
        file.admission(entry.run_cap_usd)?;
        file.entries.push(entry);
        let index = file.entries.len() - 1;
        let ledger = Self {
            path: path.to_path_buf(),
            file,
            index,
            _lock: lock,
        };
        ledger.write()?;
        Ok(ledger)
    }

    pub fn committed_excluding_this_run(&self) -> f64 {
        let mut others = self.file.clone();
        others.entries.remove(self.index);
        others.committed()
    }
    pub fn total_cap_usd(&self) -> f64 {
        self.file.total_cap_usd
    }
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn update(
        &mut self,
        spent_usd: f64,
        calls_sent: u64,
        input_tokens: u64,
        output_tokens: u64,
        unknown_usage_calls: u64,
    ) -> Result<(), String> {
        let entry = &mut self.file.entries[self.index];
        entry.spent_usd = spent_usd;
        entry.calls_sent = calls_sent;
        entry.input_tokens = input_tokens;
        entry.output_tokens = output_tokens;
        entry.unknown_usage_calls = unknown_usage_calls;
        self.write()
    }

    pub fn finish(&mut self, ended_at: String, stop_reason: String) -> Result<(), String> {
        let entry = &mut self.file.entries[self.index];
        entry.state = "finished".into();
        entry.ended_at = Some(ended_at);
        entry.stop_reason = Some(stop_reason);
        self.write()
    }

    pub fn committed(&self) -> f64 {
        self.file.committed()
    }

    fn write(&self) -> Result<(), String> {
        write_atomic(
            &self.path,
            &serde_json::to_vec_pretty(&self.file).map_err(|e| e.to_string())?,
        )
    }
}

/// Write to a temporary file, flush it to disk, then rename it over the
/// ledger, so a crash leaves either the old or the new ledger, never half.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    let mut file = File::create(&temporary)
        .map_err(|e| format!("cannot write {}: {e}", temporary.display()))?;
    file.write_all(bytes)
        .and_then(|()| file.write_all(b"\n"))
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("cannot write {}: {e}", temporary.display()))?;
    fs::rename(&temporary, path).map_err(|e| format!("cannot replace {}: {e}", path.display()))?;
    if let Some(parent) = path.parent()
        && let Ok(directory) = File::open(parent)
    {
        let _ = directory.sync_all();
    }
    Ok(())
}
