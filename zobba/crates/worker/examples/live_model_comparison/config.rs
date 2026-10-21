//! Run inputs: a JSON comparison file (model IDs, effort, prices, caps) plus
//! command-line overrides. Nothing here names a real model or a real price;
//! the shipped example file holds clearly fake placeholders.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use zobba_domain::model::{Provider, valid_external_id};

/// The owner's total cap for the whole comparison (2026-10-21). A comparison
/// file may set a lower total, never a higher one.
pub const OWNER_TOTAL_CAP_USD: f64 = 100.0;
/// Bounds of one run, whatever the file says.
const MAX_CYCLES: u32 = 10;
const MAX_MODEL_CALLS: u64 = 400;
const MAX_MINUTES: u64 = 240;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// The loopback provider answers with scripted replies: no network, no cost.
    Scripted,
    /// The real native transport of the run's provider: paid calls.
    Live,
}
impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Scripted => "scripted",
            Mode::Live => "live",
        }
    }
}

/// Command-line options. Paths given here are relative to the current
/// directory; paths inside the comparison file are relative to the
/// repository root.
pub struct Cli {
    pub config: PathBuf,
    pub run: String,
    pub mode: Mode,
    pub confirm_live: Option<String>,
    pub assume_qualified: bool,
    pub out: Option<PathBuf>,
    pub ledger: Option<PathBuf>,
    pub run_cap_usd: Option<f64>,
    pub max_cycles: Option<u32>,
    pub max_model_calls: Option<u64>,
    pub max_minutes: Option<u64>,
    pub skip_expectations: bool,
}

pub const USAGE: &str = "usage: live_model_comparison --config <file.json> --run <run id> [--mode scripted|live]
  [--confirm-live <run id>] [--assume-qualified-for-evaluation]
  [--out <dir>] [--ledger <file.json>] [--run-cap-usd <usd>]
  [--max-cycles <n>] [--max-model-calls <n>] [--max-minutes <n>] [--skip-scripted-expectations]
Scripted mode (the default) uses the loopback provider: no network and no cost.
Live mode needs --confirm-live with the same run id, verified prices, a real
model ID, the provider key in ZOBBA_OPENAI_API_KEY or ZOBBA_ANTHROPIC_API_KEY,
and a qualification receipt (or --assume-qualified-for-evaluation).";

impl Cli {
    pub fn parse(mut args: impl Iterator<Item = String>) -> Result<Self, String> {
        let mut config = None;
        let mut run = None;
        let mut cli = Cli {
            config: PathBuf::new(),
            run: String::new(),
            mode: Mode::Scripted,
            confirm_live: None,
            assume_qualified: false,
            out: None,
            ledger: None,
            run_cap_usd: None,
            max_cycles: None,
            max_model_calls: None,
            max_minutes: None,
            skip_expectations: false,
        };
        while let Some(arg) = args.next() {
            let mut value = |name: &str| {
                args.next()
                    .filter(|v| !v.starts_with("--"))
                    .ok_or_else(|| format!("{name} needs a value\n{USAGE}"))
            };
            match arg.as_str() {
                "--config" => config = Some(PathBuf::from(value("--config")?)),
                "--run" => run = Some(value("--run")?),
                "--mode" => {
                    cli.mode = match value("--mode")?.as_str() {
                        "scripted" => Mode::Scripted,
                        "live" => Mode::Live,
                        _ => return Err(format!("--mode is scripted or live\n{USAGE}")),
                    }
                }
                "--confirm-live" => cli.confirm_live = Some(value("--confirm-live")?),
                "--assume-qualified-for-evaluation" => cli.assume_qualified = true,
                "--out" => cli.out = Some(PathBuf::from(value("--out")?)),
                "--ledger" => cli.ledger = Some(PathBuf::from(value("--ledger")?)),
                "--run-cap-usd" => cli.run_cap_usd = Some(usd(&value("--run-cap-usd")?)?),
                "--max-cycles" => cli.max_cycles = Some(whole(&value("--max-cycles")?)? as u32),
                "--max-model-calls" => cli.max_model_calls = Some(whole(&value("--max-model-calls")?)?),
                "--max-minutes" => cli.max_minutes = Some(whole(&value("--max-minutes")?)?),
                "--skip-scripted-expectations" => cli.skip_expectations = true,
                "--help" | "-h" => return Err(USAGE.into()),
                other => return Err(format!("unknown option {other}\n{USAGE}")),
            }
        }
        cli.config = config.ok_or_else(|| format!("--config is required\n{USAGE}"))?;
        cli.run = run.ok_or_else(|| format!("--run is required\n{USAGE}"))?;
        Ok(cli)
    }
}

fn usd(text: &str) -> Result<f64, String> {
    let value: f64 = text
        .parse()
        .map_err(|_| format!("{text} is not a USD amount"))?;
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("{text} is not a positive USD amount"));
    }
    Ok(value)
}
fn whole(text: &str) -> Result<u64, String> {
    text.parse::<u64>()
        .ok()
        .filter(|v| *v > 0)
        .ok_or_else(|| format!("{text} is not a positive whole number"))
}

/// USD per million tokens, as the provider publishes them. `verified` and
/// `source` are the operator's statement that the numbers were checked.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Price {
    pub input_usd_per_million: f64,
    pub output_usd_per_million: f64,
    pub cached_input_usd_per_million: f64,
    pub source: String,
    pub verified: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Defaults {
    #[serde(default)]
    pub max_cycles: Option<u32>,
    #[serde(default)]
    pub max_model_calls: Option<u64>,
    #[serde(default)]
    pub max_minutes: Option<u64>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub account: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunConfig {
    #[serde(rename = "_comment", default)]
    pub comment: Option<String>,
    pub id: String,
    pub provider: String,
    pub model: String,
    /// OpenAI only: the profile declares the reasoning capability, so the
    /// adapter sends `reasoning.effort = "none"`. False sends no field.
    #[serde(default)]
    pub openai_reasoning: bool,
    /// Requested reasoning effort. The native adapter refuses anything but
    /// "none" (`native.rs`, `request_body`), so this harness does too.
    #[serde(default = "effort_none")]
    pub effort: String,
    pub run_cap_usd: f64,
    pub price: Price,
    #[serde(default)]
    pub account: Option<String>,
    #[serde(default)]
    pub destination: Option<String>,
    #[serde(default)]
    pub max_cycles: Option<u32>,
    #[serde(default)]
    pub max_model_calls: Option<u64>,
    #[serde(default)]
    pub max_minutes: Option<u64>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub notes: Option<String>,
}
fn effort_none() -> String {
    "none".into()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComparisonFile {
    #[serde(rename = "_comment", default)]
    pub comment: Option<String>,
    pub comparison: String,
    pub total_cap_usd: f64,
    pub ledger: String,
    pub output_root: String,
    pub qualification_receipts: String,
    #[serde(default)]
    pub defaults: Defaults,
    pub runs: Vec<RunConfig>,
}
impl ComparisonFile {
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = std::fs::read(path)
            .map_err(|e| format!("cannot read the comparison file {}: {e}", path.display()))?;
        serde_json::from_slice(&bytes)
            .map_err(|e| format!("the comparison file {} is not valid: {e}", path.display()))
    }
}

/// One resolved, validated run.
#[derive(Clone, Debug)]
pub struct RunPlan {
    pub mode: Mode,
    pub run: RunConfig,
    pub comparison: String,
    /// The configured provider (live mode calls it; scripted mode only
    /// records it, since the loopback speaks the OpenAI wire format).
    pub configured_provider: Provider,
    pub provider: Provider,
    pub model: String,
    pub account: String,
    pub destination: String,
    pub openai_reasoning: bool,
    pub total_cap_usd: f64,
    pub run_cap_usd: f64,
    pub price: Price,
    pub ledger_path: PathBuf,
    pub output_dir: PathBuf,
    pub receipts_dir: PathBuf,
    pub max_cycles: u32,
    pub max_model_calls: u64,
    pub max_minutes: u64,
    pub max_output_tokens: u32,
    pub assume_qualified: bool,
    pub skip_expectations: bool,
    pub started: SystemTime,
    pub stamp: String,
}

pub const FIXTURE_MODEL: &str = "fixture-model";
pub const FIXTURE_ACCOUNT: &str = "fixture-account";
pub const FIXTURE_DESTINATION: &str = "fixture-destination";

fn placeholder(text: &str) -> bool {
    text.to_ascii_lowercase().contains("fill-in") || text.to_ascii_lowercase().contains("fill in")
}

impl RunPlan {
    pub fn resolve(file: &ComparisonFile, cli: &Cli, repo: &Path) -> Result<Self, String> {
        if !valid_scope(&file.comparison) {
            return Err("comparison must be 1-128 letters, digits, '-' or '_'".into());
        }
        if !file.total_cap_usd.is_finite()
            || file.total_cap_usd <= 0.0
            || file.total_cap_usd > OWNER_TOTAL_CAP_USD
        {
            return Err(format!(
                "total_cap_usd must be above 0 and at most the owner's {OWNER_TOTAL_CAP_USD} USD"
            ));
        }
        let mut seen = std::collections::BTreeSet::new();
        for run in &file.runs {
            if !seen.insert(run.id.as_str()) {
                return Err(format!("run id {} appears twice", run.id));
            }
        }
        let run = file
            .runs
            .iter()
            .find(|r| r.id == cli.run)
            .cloned()
            .ok_or_else(|| format!("no run with id {} in the comparison file", cli.run))?;
        if !valid_scope(&run.id) {
            return Err("a run id is 1-128 letters, digits, '-' or '_'".into());
        }
        let configured_provider = Provider::parse(&run.provider)
            .ok_or_else(|| format!("run {}: provider is openai or anthropic", run.id))?;
        if !valid_external_id(&run.model) {
            return Err(format!(
                "run {}: the model ID holds 1-200 letters, digits, '-', '_', '.' or ':'",
                run.id
            ));
        }
        if run.effort != "none" {
            return Err(format!(
                "run {}: effort {:?} is refused: the native adapter sends no requested reasoning effort (only \"none\"); changing that is a production change this harness does not make",
                run.id, run.effort
            ));
        }
        if run.openai_reasoning && configured_provider != Provider::OpenAi {
            return Err(format!(
                "run {}: openai_reasoning applies to OpenAI only",
                run.id
            ));
        }
        let price = run.price.clone();
        for (name, value) in [
            ("input_usd_per_million", price.input_usd_per_million),
            ("output_usd_per_million", price.output_usd_per_million),
            ("cached_input_usd_per_million", price.cached_input_usd_per_million),
        ] {
            if !value.is_finite() || value < 0.0 {
                return Err(format!("run {}: price {name} must be 0 or more", run.id));
            }
        }
        let run_cap_usd = cli.run_cap_usd.unwrap_or(run.run_cap_usd);
        if !run_cap_usd.is_finite() || run_cap_usd <= 0.0 || run_cap_usd > file.total_cap_usd {
            return Err(format!(
                "run {}: the run cap must be above 0 and at most the total cap",
                run.id
            ));
        }
        let pick_u32 = |cli: Option<u32>, run: Option<u32>, default: Option<u32>, fallback: u32| {
            cli.or(run).or(default).unwrap_or(fallback)
        };
        let pick_u64 = |cli: Option<u64>, run: Option<u64>, default: Option<u64>, fallback: u64| {
            cli.or(run).or(default).unwrap_or(fallback)
        };
        let max_cycles = pick_u32(cli.max_cycles, run.max_cycles, file.defaults.max_cycles, 3);
        let max_model_calls = pick_u64(
            cli.max_model_calls,
            run.max_model_calls,
            file.defaults.max_model_calls,
            80,
        );
        let max_minutes = pick_u64(cli.max_minutes, run.max_minutes, file.defaults.max_minutes, 60);
        let max_output_tokens = run
            .max_output_tokens
            .or(file.defaults.max_output_tokens)
            .unwrap_or(4_096);
        if !(1..=MAX_CYCLES).contains(&max_cycles)
            || !(1..=MAX_MODEL_CALLS).contains(&max_model_calls)
            || !(1..=MAX_MINUTES).contains(&max_minutes)
            || !(1..=zobba_domain::model::MAX_OUTPUT_TOKENS).contains(&max_output_tokens)
        {
            return Err(format!(
                "run {}: limits are out of range (cycles 1-{MAX_CYCLES}, model calls 1-{MAX_MODEL_CALLS}, minutes 1-{MAX_MINUTES}, output tokens 1-{})",
                run.id,
                zobba_domain::model::MAX_OUTPUT_TOKENS
            ));
        }
        let started = SystemTime::now();
        let stamp = crate::report::stamp(started);
        let (provider, model, account, destination) = match cli.mode {
            // The loopback adapter is bound to the fixture account and
            // destination and speaks the OpenAI Responses wire format.
            Mode::Scripted => (
                Provider::OpenAi,
                FIXTURE_MODEL.to_string(),
                FIXTURE_ACCOUNT.to_string(),
                FIXTURE_DESTINATION.to_string(),
            ),
            Mode::Live => (
                configured_provider,
                run.model.clone(),
                run.account
                    .clone()
                    .or(file.defaults.account.clone())
                    .unwrap_or_else(|| "zobba-test".into()),
                run.destination
                    .clone()
                    .unwrap_or_else(|| format!("{}-comparison", configured_provider.as_str())),
            ),
        };
        if !valid_scope(&account) || !valid_scope(&destination) {
            return Err(format!(
                "run {}: account and destination are 1-128 letters, digits, '-' or '_'",
                run.id
            ));
        }
        if cli.mode == Mode::Live {
            if cli.confirm_live.as_deref() != Some(run.id.as_str()) {
                return Err(format!(
                    "a live run spends money: repeat the run id with --confirm-live {}",
                    run.id
                ));
            }
            if placeholder(&run.model) {
                return Err(format!(
                    "run {}: the model ID is still a placeholder; fill in the provider's exact model ID",
                    run.id
                ));
            }
            if !price.verified
                || placeholder(&price.source)
                || price.input_usd_per_million <= 0.0
                || price.output_usd_per_million <= 0.0
            {
                return Err(format!(
                    "run {}: the prices are not verified: fill in the provider's published USD per million tokens, name the source, and set verified to true",
                    run.id
                ));
            }
        } else if cli.confirm_live.is_some() || cli.assume_qualified {
            return Err("--confirm-live and --assume-qualified-for-evaluation apply to live runs only".into());
        }
        let resolve = |text: &str| -> PathBuf {
            let path = PathBuf::from(text);
            if path.is_absolute() { path } else { repo.join(path) }
        };
        let ledger_path = match (&cli.ledger, cli.mode) {
            (Some(path), _) => path.clone(),
            (None, Mode::Live) => resolve(&file.ledger),
            // Dry runs use the same code with their own ledger, so they never
            // consume the live budget.
            (None, Mode::Scripted) => scripted_ledger(&resolve(&file.ledger)),
        };
        let root = cli.out.clone().unwrap_or_else(|| resolve(&file.output_root));
        let folder = match cli.mode {
            Mode::Live => format!(
                "{}-{}-{stamp}",
                configured_provider.as_str(),
                folder_safe(&run.model)
            ),
            Mode::Scripted => format!("scripted-{FIXTURE_MODEL}-{stamp}"),
        };
        Ok(RunPlan {
            mode: cli.mode,
            comparison: file.comparison.clone(),
            configured_provider,
            provider,
            model,
            account,
            destination,
            openai_reasoning: cli.mode == Mode::Live && run.openai_reasoning,
            total_cap_usd: file.total_cap_usd,
            run_cap_usd,
            price,
            ledger_path,
            output_dir: root.join(folder),
            receipts_dir: resolve(&file.qualification_receipts),
            max_cycles,
            max_model_calls,
            max_minutes,
            max_output_tokens,
            assume_qualified: cli.assume_qualified,
            skip_expectations: cli.skip_expectations,
            started,
            stamp,
            run,
        })
    }
}

fn scripted_ledger(live: &Path) -> PathBuf {
    let stem = live
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("spend-ledger");
    live.with_file_name(format!("{stem}.scripted.json"))
}

fn folder_safe(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '.' { c } else { '_' })
        .collect()
}

pub fn valid_scope(text: &str) -> bool {
    zobba_domain::identity::valid_scope_id(text)
}
