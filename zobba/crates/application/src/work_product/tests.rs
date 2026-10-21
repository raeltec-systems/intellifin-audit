//! Work-product contracts with an in-memory store and trusted reader: every
//! refusal reason, keep-by-ID, a person's blocks, currency on read, a
//! person's edit and deterministic exports. The real PostgreSQL guards and
//! the work loop are proven by the worker integration suite.
use std::sync::Mutex;

use super::*;
use crate::{
    analysis::tests::{basis, run},
    citation::CitedOriginal,
    evidence::MeasuredObject,
    investigation::tests::{binding, invocation},
    methodology::{ResolvedTemplate, TemplateDefinition, TemplateSection},
};
use zobba_domain::{
    citation::{Located, Locator, PageFacts},
    coverage::{
        Completeness, CriterionCounts, Partition, PopulationCounts, Reconciliation, Summary,
    },
    evidence::ContentIdentity,
    work_product::{AssertionKind, ProductKind, RefreshReason},
};

const POLICY: &str = "Invoices above 1,000.00 USD require an approver.";
const POLICY_SHA: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn hex(prefix: &str, c: char) -> String {
    format!("{prefix}-{}", c.to_string().repeat(40))
}
fn summary(not_met: u64) -> Summary {
    Summary {
        completeness: Completeness::Complete,
        reconciliation: Reconciliation::NotDeclared,
        counts: PopulationCounts {
            received_rows: 1_256,
            unkeyed: 0,
            duplicate_rows: 6,
            distinct_subjects: 1_250,
            excluded_out_of_period: 50,
            scope_unknown_period_unparsed: 0,
            scope_unknown_period_missing: 0,
            scope_unknown_conflicting_duplicate: 0,
            in_scope: 1_200,
        },
        selected: None,
        criteria: vec![CriterionCounts {
            criterion_id: "crit-a".into(),
            applicable: 1_000,
            not_applicable: 200,
            applicability_unknown: 0,
            met: 1_000 - not_met - 10,
            not_met,
            undetermined: 10,
            undetermined_by_reason: BTreeMap::new(),
            execution_failed: 0,
            not_evaluated: 0,
            met_unreviewed: 0,
        }],
        partition: Partition {
            failing: 20,
            meets_every_applicable: 960,
            unresolved: 20,
            not_applicable_to_any: 200,
        },
        failing_opportunities: 27,
        conclusion: Conclusion::ExceptionsFoundInconclusive,
        limitations: vec![],
    }
}

#[derive(Default)]
struct State {
    products: Vec<ProductRecord>,
    versions: Vec<VersionRecord>,
    records: RecordsNow,
    exports: Vec<ExportRecord>,
    readable: BTreeMap<String, (String, Option<String>)>,
    editors: Vec<String>,
    objects: BTreeMap<String, Vec<u8>>,
}
#[derive(Default)]
struct Store {
    state: Mutex<State>,
}
impl Store {
    fn new() -> Self {
        let store = Self::default();
        {
            let mut s = store.state.lock().unwrap();
            s.records.heads.push(HeadNow {
                id: hex("eval", '4'),
                digest: "4".repeat(64),
                subject: Some("INV-0042".into()),
                basis_id: hex("basis", '1'),
                criterion_id: "crit-s".into(),
                head_id: hex("eval", '4'),
                verdict: Some(Verdict::NotMet),
                origin: EffectiveOrigin::ModelProposal,
                review: ReviewState::Unreviewed,
            });
            s.records.summaries.push(SummaryNow {
                id: hex("summary", '5'),
                kind: RecordKind::Summary,
                digest: "5".repeat(64),
                summary: summary(15),
                conclusion: Conclusion::ExceptionsFoundInconclusive,
                superseded: false,
            });
            s.records.facts.push(FactNow {
                id: hex("fact", '6'),
                digest: "6".repeat(64),
                value: Some("1250.00".into()),
                unit: Some("USD".into()),
                subject: "INV-0042".into(),
                supported: true,
                superseded: false,
            });
            s.records.exceptions.push(ExceptionNow {
                id: hex("exc", '7'),
                task_id: "task".into(),
                root: "crit-s".into(),
                subject: "INV-0042".into(),
                status: ExceptionStatus::Open,
            });
            s.records.bases.push(BasisNow {
                id: hex("basis", '1'),
                digest: "1".repeat(64),
                period: "2026-01-01/2026-12-31".into(),
                limitations: vec!["The organisation chart is dated 2025.".into()],
                exceptions: [1, 0, 0, 0],
            });
            s.readable.insert(
                "ap-policy".into(),
                (POLICY_SHA.into(), Some("AP policy.txt".into())),
            );
            s.editors.push("actor".into());
        }
        store
    }
    fn head_of(&self, product_id: &str) -> Option<VersionRecord> {
        self.state
            .lock()
            .unwrap()
            .versions
            .iter()
            .filter(|v| v.version.product_id == product_id)
            .max_by_key(|v| v.version.number)
            .cloned()
    }
    fn stored(version: &Version) -> VersionRecord {
        VersionRecord {
            version: version.clone(),
            digest: version.digest(),
            recorded_us: Some(1),
        }
    }
}
impl WorkProductStore for Store {
    async fn invocation_version(
        &self,
        _: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<Option<VersionRecord>, ReadingError> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .versions
            .iter()
            .find(|v| matches!(&v.version.author, Author::Agent { invocation_id: i } if i == invocation_id))
            .cloned())
    }
    async fn products(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
    ) -> Result<Vec<ProductHead>, ReadingError> {
        let products = self.state.lock().unwrap().products.clone();
        Ok(products
            .into_iter()
            .filter_map(|p| {
                let head = self.head_of(&p.id)?;
                let versions = self
                    .state
                    .lock()
                    .unwrap()
                    .versions
                    .iter()
                    .filter(|v| v.version.product_id == p.id)
                    .count() as u64;
                Some(ProductHead {
                    product: p,
                    head,
                    versions,
                })
            })
            .collect())
    }
    async fn product(
        &self,
        a: &str,
        s: &Scope,
        t: &str,
        product_id: &str,
    ) -> Result<Option<ProductHead>, ReadingError> {
        Ok(self
            .products(a, s, t)
            .await?
            .into_iter()
            .find(|p| p.product.id == product_id))
    }
    async fn version(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        version_id: &str,
    ) -> Result<Option<VersionRecord>, ReadingError> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .versions
            .iter()
            .find(|v| v.version.id == version_id)
            .cloned())
    }
    async fn records(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        _: &RecordQuery,
    ) -> Result<RecordsNow, ReadingError> {
        Ok(self.state.lock().unwrap().records.clone())
    }
    async fn current(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        version_ids: &[String],
    ) -> Result<Vec<CurrentRow>, ReadingError> {
        // What `work_product_current` derives, from the records now.
        let s = self.state.lock().unwrap();
        let mut rows = Vec::new();
        for v in s
            .versions
            .iter()
            .filter(|v| version_ids.contains(&v.version.id))
        {
            for (block, pins) in v.version.claims() {
                for (ordinal, pin) in pins.iter().enumerate() {
                    let mut row = CurrentRow {
                        version_id: v.version.id.clone(),
                        block_id: block.id.clone(),
                        ordinal: ordinal as u32,
                        head_id: None,
                        verdict: None,
                        origin: None,
                        review: None,
                        superseded: None,
                        status: None,
                        registered: None,
                    };
                    match pin.kind {
                        AssertionKind::Outcome => {
                            if let Some(h) = s.records.head(&pin.record_id) {
                                row.head_id = Some(h.head_id.clone());
                                row.verdict = Some(verdict_value(h.verdict).into());
                                row.origin = Some(h.origin.as_str().into());
                                row.review = Some(h.review.as_str().into());
                            }
                        }
                        AssertionKind::Count | AssertionKind::Conclusion => {
                            row.superseded = s.records.summary(&pin.record_id).map(|x| x.superseded)
                        }
                        AssertionKind::Fact => {
                            row.superseded = s.records.fact(&pin.record_id).map(|x| x.superseded)
                        }
                        AssertionKind::Exception => {
                            row.status = s
                                .records
                                .exception(&pin.record_id)
                                .map(|x| x.status.as_str().into())
                        }
                        AssertionKind::Quote => {
                            row.registered =
                                (pin.record_id == "ap-policy").then(|| POLICY_SHA.into())
                        }
                        AssertionKind::Period => {}
                    }
                    rows.push(row);
                }
            }
        }
        Ok(rows)
    }
    async fn record_agent(
        &self,
        _: &ClaimBasis,
        product: Option<&ProductRecord>,
        version: &Version,
    ) -> Result<VersionRecord, WriteError> {
        assert!(version.is_valid(), "trusted code wrote an invalid version");
        if let Some(head) = self.head_of(&version.product_id)
            && version.predecessor.as_deref() != Some(head.version.id.as_str())
        {
            return Err(WriteError::StaleBase(head.version.id));
        }
        let mut s = self.state.lock().unwrap();
        if let Some(p) = product {
            s.products.push(p.clone());
        }
        let stored = Self::stored(version);
        s.versions.push(stored.clone());
        Ok(stored)
    }
}
impl WorkProductPeople for Store {
    async fn edit_basis(
        &self,
        actor: &str,
        _: &Scope,
        _: &str,
        _: &str,
    ) -> Result<EditBasis, EditError> {
        if self
            .state
            .lock()
            .unwrap()
            .editors
            .iter()
            .any(|e| e == actor)
        {
            Ok(EditBasis {
                methodology_binding_id: "binding-1".into(),
                execution_epoch: 1,
            })
        } else {
            Err(EditError::Denied)
        }
    }
    async fn version_by_key(
        &self,
        actor: &str,
        _: &Scope,
        _: &str,
        key: &str,
    ) -> Result<Option<VersionRecord>, EditError> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .versions
            .iter()
            .find(|v| {
                matches!(&v.version.author, Author::Human { actor_id } if actor_id == actor)
                    && v.version.key.as_deref() == Some(key)
            })
            .cloned())
    }
    async fn record_person(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        version: &Version,
    ) -> Result<VersionRecord, EditError> {
        assert!(version.is_valid());
        if let Some(head) = self.head_of(&version.product_id)
            && version.predecessor.as_deref() != Some(head.version.id.as_str())
        {
            return Err(EditError::StaleBase(head.version.id));
        }
        let stored = Self::stored(version);
        self.state.lock().unwrap().versions.push(stored.clone());
        Ok(stored)
    }
    async fn export_by_key(
        &self,
        actor: &str,
        _: &Scope,
        key: &str,
    ) -> Result<Option<ExportRecord>, ExportError> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .exports
            .iter()
            .find(|e| e.actor_id == actor && e.key == key)
            .cloned())
    }
    async fn export(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        id: &str,
    ) -> Result<Option<ExportRecord>, ExportError> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .exports
            .iter()
            .find(|e| e.id == id)
            .cloned())
    }
    async fn record_export(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        record: &ExportRecord,
    ) -> Result<ExportRecord, ExportError> {
        self.state.lock().unwrap().exports.push(record.clone());
        Ok(record.clone())
    }
    async fn labels(
        &self,
        _: &str,
        _: &Scope,
        ids: &[String],
    ) -> Result<BTreeMap<String, String>, ReadingError> {
        Ok(ids
            .iter()
            .map(|i| (i.clone(), format!("Person {i}")))
            .collect())
    }
    async fn readable(
        &self,
        _: &str,
        _: &Scope,
        ids: &[String],
    ) -> Result<BTreeMap<String, (String, Option<String>)>, ReadingError> {
        let s = self.state.lock().unwrap();
        Ok(ids
            .iter()
            .filter_map(|i| s.readable.get(i).map(|r| (i.clone(), r.clone())))
            .collect())
    }
}
impl EvidenceObjects for Store {
    fn namespace(&self) -> &str {
        "n"
    }
    fn measure(&self, bytes: &[u8]) -> ContentIdentity {
        ContentIdentity {
            sha256: sha256_hex(bytes),
            size: bytes.len() as u64,
        }
    }
    async fn put_if_absent(&self, id: &str, bytes: Vec<u8>) -> Result<String, ObjectError> {
        let mut s = self.state.lock().unwrap();
        if s.objects.contains_key(id) {
            return Err(ObjectError::AlreadyExists);
        }
        s.objects.insert(id.into(), bytes);
        Ok("v1".into())
    }
    async fn latest_version(&self, id: &str) -> Result<Option<String>, ObjectError> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .objects
            .contains_key(id)
            .then(|| "v1".into()))
    }
    async fn get_version(&self, id: &str, _: &str, _: &str) -> Result<MeasuredObject, ObjectError> {
        let bytes = self
            .state
            .lock()
            .unwrap()
            .objects
            .get(id)
            .cloned()
            .ok_or(ObjectError::Unavailable)?;
        Ok(MeasuredObject {
            identity: self.measure(&bytes),
            bytes,
        })
    }
}

/// A reader over one plain-text original, the AP policy.
struct Reader;
impl CitationReader for Reader {
    async fn original(
        &self,
        _: &ClaimBasis,
        id: &str,
    ) -> Result<Option<CitedOriginal>, ReadingError> {
        Ok((id == "ap-policy").then(|| CitedOriginal {
            id: id.into(),
            sha256: POLICY_SHA.into(),
        }))
    }
    async fn byte_range(
        &self,
        _: &ClaimBasis,
        _: &CitedOriginal,
        start: u64,
        end: u64,
    ) -> Result<Located, ReadingError> {
        Ok(POLICY
            .get(start as usize..end as usize)
            .map_or(Located::Missing, |t| Located::Found(vec![t.into()])))
    }
    async fn byte_context(
        &self,
        _: &ClaimBasis,
        _: &CitedOriginal,
        start: u64,
        end: u64,
    ) -> Result<Option<String>, ReadingError> {
        Ok(crate::citation::widened(
            POLICY.as_bytes(),
            start as usize,
            end as usize,
        ))
    }
    async fn locate(
        &self,
        _: &ClaimBasis,
        _: &CitedOriginal,
        locators: &[Locator],
        _: &ModelCancellation,
    ) -> Result<Vec<Located>, ReadingError> {
        Ok(vec![Located::Unreadable; locators.len()])
    }
    async fn page(
        &self,
        _: &ClaimBasis,
        _: &CitedOriginal,
        _: u32,
        _: &ModelCancellation,
    ) -> Result<Option<PageFacts>, ReadingError> {
        Ok(None)
    }
}

/// The method binding with the firm template (`ap-template:v1`).
fn firm() -> Binding {
    let mut b = binding("binding-1");
    b.resolution.templates = vec![ResolvedTemplate {
        template: TemplateDefinition {
            id: "ap-template".into(),
            version: "v1".into(),
            name: "AP working paper FY2026".into(),
            sections: [
                ("objective", true),
                ("results", false),
                ("conclusion", true),
            ]
            .iter()
            .map(|(id, required)| TemplateSection {
                id: (*id).into(),
                title: format!("Section {id}"),
                content: "Write it.".into(),
                required: *required,
            })
            .collect(),
        },
        source_version_id: "ap-method-v1".into(),
    }];
    b
}

fn count(measure: CountMeasure, value: u64) -> ProposedAssertion {
    ProposedAssertion::Count {
        summary_id: hex("summary", '5'),
        measure: Some(measure),
        criterion_id: measure.per_criterion().then(|| "crit-a".into()),
        value: Some(value),
    }
}
fn quote() -> ProposedAssertion {
    ProposedAssertion::Quote {
        source: CitationSource {
            original_id: "ap-policy".into(),
            locator: Locator::parse("bytes:0-48"),
            quote: POLICY.into(),
        },
    }
}
fn outcome(verdict: Option<Verdict>) -> ProposedAssertion {
    ProposedAssertion::Outcome {
        evaluation_id: hex("eval", '4'),
        verdict: Some(verdict),
    }
}
fn claim(section: &str, statement: &str, assertions: Vec<ProposedAssertion>) -> ProposedBlock {
    ProposedBlock::New {
        section: section.into(),
        content: ProposedContent::Claim {
            statement: statement.into(),
            assertions,
        },
    }
}
fn narrative(section: &str, label: NarrativeLabel, text: &str) -> ProposedBlock {
    ProposedBlock::New {
        section: section.into(),
        content: ProposedContent::Narrative {
            label,
            text: text.into(),
        },
    }
}
fn draft(base: Option<String>, blocks: Vec<ProposedBlock>) -> Draft {
    Draft {
        title: "AP approvals working paper".into(),
        kind: ProductKind::WorkingPaper,
        template_id: "ap-template".into(),
        template_version: "v1".into(),
        base_version: base,
        blocks,
    }
}
fn first_draft() -> Draft {
    draft(
        None,
        vec![
            narrative(
                "objective",
                NarrativeLabel::Narrative,
                "Test every invoice above the threshold.",
            ),
            narrative(
                "results",
                NarrativeLabel::Judgment,
                "Approvals appear weak.",
            ),
            claim(
                "results",
                "15 of 1,000 applicable invoices had no recorded approver.",
                vec![
                    count(CountMeasure::NotMet, 15),
                    count(CountMeasure::Applicable, 1_000),
                ],
            ),
            claim(
                "results",
                "Segregation was not met for INV-0042.",
                vec![outcome(Some(Verdict::NotMet))],
            ),
            claim(
                "results",
                "The policy requires an approver above 1,000.00 USD.",
                vec![quote()],
            ),
            claim(
                "results",
                "Invoice INV-0042 shows 1,250.00 USD.",
                vec![ProposedAssertion::Fact {
                    fact_id: hex("fact", '6'),
                    value: "1250.00".into(),
                }],
            ),
            claim(
                "results",
                "The exception of INV-0042 is open.",
                vec![ProposedAssertion::Exception {
                    exception_id: hex("exc", '7'),
                    status: Some(ExceptionStatus::Open),
                }],
            ),
            claim(
                "results",
                "The basis covers 2026-01-01 to 2026-12-31.",
                vec![ProposedAssertion::Period {
                    basis_id: hex("basis", '1'),
                }],
            ),
            ProposedBlock::New {
                section: "results".into(),
                content: ProposedContent::Coverage {
                    summary_id: hex("summary", '5'),
                },
            },
            ProposedBlock::New {
                section: "results".into(),
                content: ProposedContent::Exceptions {
                    basis_id: hex("basis", '1'),
                },
            },
        ],
    )
}
fn record(store: &Store, turn: &str, d: &Draft) -> (bool, Vec<String>) {
    let mut feedback = Vec::new();
    let recorded = run(record_draft(
        store,
        &Reader,
        &basis("p1"),
        &firm(),
        &invocation(turn, "binding-1"),
        d,
        &mut feedback,
    ))
    .unwrap();
    (recorded, feedback)
}
fn latest(store: &Store) -> Version {
    let s = store.state.lock().unwrap();
    s.versions.last().unwrap().version.clone()
}
fn keep_all(v: &Version) -> Vec<ProposedBlock> {
    v.blocks
        .iter()
        .map(|b| ProposedBlock::Keep(b.id.clone()))
        .collect()
}

#[test]
fn a_draft_whose_every_claim_agrees_is_recorded_with_the_platform_limitations() {
    let store = Store::new();
    let (recorded, feedback) = record(&store, "turn-1", &first_draft());
    assert!(recorded, "{feedback:?}");
    let v = latest(&store);
    assert_eq!(v.number, 1);
    assert_eq!(v.claims().count(), 6);
    assert_eq!(v.blocks.last().unwrap().content, Content::Limitations);
    assert_eq!(v.blocks.last().unwrap().section, "conclusion");
    assert_eq!(
        v.missing_required,
        ["conclusion"],
        "the limitations block is not content"
    );
    assert!(v.is_valid());
    // Pins hold the record's canonical values and digests.
    let pins: Vec<&Pin> = v.claims().flat_map(|(_, p)| p).collect();
    assert_eq!(pins[0].value, "15");
    assert_eq!(pins[0].record_digest, "5".repeat(64));
    assert_eq!(pins[2].origin, Some(EffectiveOrigin::ModelProposal));
    assert_eq!(pins[3].record_digest, POLICY_SHA);
    assert_eq!(pins[4].unit.as_deref(), Some("USD"));
    assert_eq!(
        pins[5].record_digest,
        exception_digest(&hex("exc", '7'), "task", "crit-s", "INV-0042")
    );
    assert_eq!(pins[6].value, "2026-01-01/2026-12-31");
    // Idempotent per invocation.
    let (again, feedback) = record(&store, "turn-1", &first_draft());
    assert!(!again && feedback[0].contains("was recorded by this answer"));
    assert_eq!(store.state.lock().unwrap().versions.len(), 1);
}

/// Each new block with one fault is refused with its own closed reason;
/// nothing is recorded (all or nothing).
#[test]
fn every_refusal_reason_names_its_block_and_records_nothing() {
    let store = Store::new();
    assert!(record(&store, "turn-1", &first_draft()).0);
    let v1 = latest(&store);
    let cases: Vec<(ProposedBlock, Refusal)> = vec![
        (
            claim(
                "results",
                "14 of 1,000 applicable invoices had no recorded approver.",
                vec![
                    count(CountMeasure::NotMet, 15),
                    count(CountMeasure::Applicable, 1_000),
                ],
            ),
            Refusal::UnsupportedFigure,
        ),
        (
            claim(
                "results",
                "15 invoices failed.",
                vec![count(CountMeasure::NotMet, 14)],
            ),
            Refusal::CountMismatch,
        ),
        (
            claim(
                "results",
                "It is inconclusive.",
                vec![ProposedAssertion::Conclusion {
                    summary_id: hex("summary", '5'),
                    code: Some(Conclusion::NoExceptionFound),
                }],
            ),
            Refusal::ConclusionMismatch,
        ),
        (
            claim(
                "results",
                "Met for INV-0042.",
                vec![outcome(Some(Verdict::Met))],
            ),
            Refusal::OutcomeMismatch,
        ),
        (
            claim(
                "results",
                "Closed.",
                vec![ProposedAssertion::Exception {
                    exception_id: hex("exc", '7'),
                    status: Some(ExceptionStatus::ClosedByDisposition),
                }],
            ),
            Refusal::StatusMismatch,
        ),
        (
            claim(
                "results",
                "The value differs.",
                vec![ProposedAssertion::Fact {
                    fact_id: hex("fact", '6'),
                    value: "1250.0".into(),
                }],
            ),
            Refusal::FactMismatch,
        ),
        (
            claim(
                "results",
                "A misquote.",
                vec![ProposedAssertion::Quote {
                    source: CitationSource {
                        original_id: "ap-policy".into(),
                        locator: Locator::parse("bytes:0-8"),
                        quote: "Invoice".into(),
                    },
                }],
            ),
            Refusal::QuoteUnverified,
        ),
        (
            narrative(
                "results",
                NarrativeLabel::Judgment,
                "About 20 items failed.",
            ),
            Refusal::FigureInNarrative,
        ),
        (
            claim("results", "The control passed.", vec![quote()]),
            Refusal::VerdictWithoutRecord,
        ),
        (
            claim(
                "results",
                "Unknown.",
                vec![ProposedAssertion::Fact {
                    fact_id: hex("fact", '9'),
                    value: "1".into(),
                }],
            ),
            Refusal::UnknownRecord,
        ),
        (
            narrative("nowhere", NarrativeLabel::Narrative, "Text."),
            Refusal::SectionUnknown,
        ),
        (
            ProposedBlock::New {
                section: "results".into(),
                content: ProposedContent::Malformed,
            },
            Refusal::BoundExceeded,
        ),
        (ProposedBlock::Keep(hex("blk", '0')), Refusal::UnknownRecord),
    ];
    for (index, (bad, reason)) in cases.into_iter().enumerate() {
        let mut blocks = keep_all(&v1);
        blocks.push(bad);
        let at = blocks.len() - 1;
        let (recorded, feedback) = record(
            &store,
            &format!("turn-r{index}"),
            &draft(Some(v1.id.clone()), blocks),
        );
        assert!(!recorded, "{reason:?}");
        let text = feedback.join("\n");
        assert!(
            text.contains(&format!("block {at}: {}", reason.as_str())),
            "{reason:?}: {text}"
        );
        assert_eq!(store.state.lock().unwrap().versions.len(), 1, "{reason:?}");
    }
}

#[test]
fn superseded_support_and_figures_identifiers_and_bounds() {
    let store = Store::new();
    {
        let mut s = store.state.lock().unwrap();
        s.records.heads[0].head_id = hex("rev", '8');
        s.records.facts[0].superseded = true;
    }
    let (recorded, feedback) = record(&store, "turn-1", &first_draft());
    assert!(!recorded);
    let text = feedback.join("\n");
    assert!(
        text.contains("block 3: superseded_support") && text.contains(&hex("rev", '8')),
        "{text}"
    );
    assert!(text.contains("block 5: superseded_support"), "{text}");
    // Identifiers that resolve are allowed in narrative and headings;
    // FY2026 is in the template's name, A1 is not anywhere.
    let store = Store::new();
    let mut d = first_draft();
    d.blocks.push(narrative(
        "objective",
        NarrativeLabel::Narrative,
        "The FY2026 working paper.",
    ));
    assert!(record(&store, "turn-2", &d).0);
    let mut d = first_draft();
    d.blocks.push(narrative(
        "objective",
        NarrativeLabel::Narrative,
        "See A1 and ISA 315.",
    ));
    let (recorded, feedback) = record(&store, "turn-3", &d);
    assert!(!recorded && feedback.join("\n").contains("figure_in_narrative"));
    // A title out of bounds; too many blocks.
    let mut d = first_draft();
    d.title = " padded".into();
    assert!(
        record(&store, "turn-4", &d)
            .1
            .join("\n")
            .contains("bound_exceeded")
    );
    let mut d = first_draft();
    d.blocks = (0..64)
        .map(|_| narrative("objective", NarrativeLabel::Narrative, "Text."))
        .collect();
    assert!(
        record(&store, "turn-5", &d)
            .1
            .join("\n")
            .contains("bound_exceeded")
    );
}

#[test]
fn the_base_must_be_the_latest_and_a_template_of_the_binding() {
    let store = Store::new();
    let mut d = first_draft();
    d.template_id = "other".into();
    let (recorded, feedback) = record(&store, "turn-0", &d);
    assert!(!recorded && feedback.join("\n").contains("template_unbound"));
    assert!(record(&store, "turn-1", &first_draft()).0);
    let v1 = latest(&store);
    assert!(record(&store, "turn-2", &draft(Some(v1.id.clone()), keep_all(&v1))).0);
    let v2 = latest(&store);
    assert_eq!(
        (v2.number, v2.predecessor.as_deref()),
        (2, Some(v1.id.as_str()))
    );
    assert_eq!(
        v2.blocks, v1.blocks,
        "kept blocks are byte-equal, authors included"
    );
    let (recorded, feedback) = record(&store, "turn-3", &draft(Some(v1.id.clone()), keep_all(&v1)));
    let text = feedback.join("\n");
    assert!(
        !recorded && text.contains("stale_base") && text.contains(&v2.id),
        "{text}"
    );
    // A product's template is fixed.
    let mut d = draft(Some(v2.id.clone()), keep_all(&v2));
    d.template_version = "v2".into();
    assert!(
        record(&store, "turn-4", &d)
            .1
            .join("\n")
            .contains("template_unbound")
    );
}

#[test]
fn the_agent_keeps_every_persons_block_unchanged() {
    let store = Store::new();
    assert!(record(&store, "turn-1", &first_draft()).0);
    let v1 = latest(&store);
    let narrative_id = v1.blocks[0].id.clone();
    let edit = EditRequest {
        key: "edit-1".into(),
        base_version: v1.id.clone(),
        blocks: v1
            .blocks
            .iter()
            .map(|b| EditBlock {
                block: b.id.clone(),
                text: (b.id == narrative_id).then(|| "Test every invoice, as edited.".into()),
            })
            .collect(),
    };
    let v2 = run(save_edit(
        &store,
        &Reader,
        "actor",
        &basis("p1").scope,
        "s",
        "task",
        &v1.product_id,
        &edit,
    ))
    .unwrap();
    assert_eq!(
        v2.version.blocks[0].author,
        Author::Human {
            actor_id: "actor".into()
        }
    );
    let mut without = keep_all(&v2.version);
    without.remove(0);
    let (recorded, feedback) = record(
        &store,
        "turn-2",
        &draft(Some(v2.version.id.clone()), without),
    );
    assert!(!recorded && feedback.join("\n").contains("human_block_dropped"));
    assert!(
        record(
            &store,
            "turn-3",
            &draft(Some(v2.version.id.clone()), keep_all(&v2.version))
        )
        .0
    );
    assert_eq!(latest(&store).blocks[0], v2.version.blocks[0]);
}

#[test]
fn a_persons_edit_is_checked_like_the_agents_and_is_idempotent() {
    let store = Store::new();
    assert!(record(&store, "turn-1", &first_draft()).0);
    let v1 = latest(&store);
    let claim_id = v1.claims().next().unwrap().0.id.clone();
    let request = |key: &str, base: &str, text: &str, drop: usize| EditRequest {
        key: key.into(),
        base_version: base.into(),
        blocks: v1
            .blocks
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != drop)
            .map(|(_, b)| EditBlock {
                block: b.id.clone(),
                text: (b.id == claim_id).then(|| text.into()),
            })
            .collect(),
    };
    let scope = basis("p1").scope;
    let save = |r: &EditRequest, actor: &str| {
        run(save_edit(
            &store,
            &Reader,
            actor,
            &scope,
            "s",
            "task",
            &v1.product_id,
            r,
        ))
    };
    // A wrong figure in the edited sentence.
    let wrong = request(
        "k0",
        &v1.id,
        "16 of 1,000 applicable invoices lacked an approver.",
        99,
    );
    match save(&wrong, "actor") {
        Err(EditError::Refused(r)) => assert_eq!(r[0].reason, Refusal::UnsupportedFigure),
        other => panic!("{other:?}"),
    }
    // Admin alone (not an editor) is refused before anything is read.
    assert_eq!(save(&wrong, "admin").unwrap_err(), EditError::Denied);
    let good = request(
        "k1",
        &v1.id,
        "15 of 1,000 applicable invoices lacked an approver.",
        1,
    );
    let v2 = save(&good, "actor").unwrap();
    assert_eq!(
        v2.version.blocks.len(),
        v1.blocks.len() - 1,
        "a removed block"
    );
    assert_eq!(
        save(&good, "actor").unwrap(),
        v2,
        "an exact retry returns the original"
    );
    assert_eq!(
        save(&request("k1", &v1.id, "Other.", 1), "actor").unwrap_err(),
        EditError::Conflict
    );
    assert_eq!(
        save(&request("k2", &v1.id, "Other.", 1), "actor").unwrap_err(),
        EditError::StaleBase(v2.version.id.clone())
    );
    // The limitations block is kept even when the person leaves it out.
    let last = v1.blocks.len() - 1;
    let v3 = run(save_edit(
        &store,
        &Reader,
        "actor",
        &scope,
        "s",
        "task",
        &v1.product_id,
        &EditRequest {
            key: "k3".into(),
            base_version: v2.version.id.clone(),
            blocks: v2.version.blocks[..v2.version.blocks.len() - 1]
                .iter()
                .map(|b| EditBlock {
                    block: b.id.clone(),
                    text: None,
                })
                .collect(),
        },
    ))
    .unwrap();
    assert_eq!(
        v3.version.blocks.last().unwrap().content,
        Content::Limitations
    );
    let _ = last;
    // A record changed under an edited claim: its assertions are checked
    // again and the edit is refused.
    store.state.lock().unwrap().records.summaries[0].superseded = true;
    let claim_v3 = v3.version.claims().next().unwrap().0.id.clone();
    let refused = run(save_edit(
        &store,
        &Reader,
        "actor",
        &scope,
        "s",
        "task",
        &v1.product_id,
        &EditRequest {
            key: "k4".into(),
            base_version: v3.version.id.clone(),
            blocks: v3
                .version
                .blocks
                .iter()
                .map(|b| EditBlock {
                    block: b.id.clone(),
                    text: (b.id == claim_v3)
                        .then(|| "15 of 1,000 applicable invoices had none.".into()),
                })
                .collect(),
        },
    ));
    match refused {
        Err(EditError::Refused(r)) => assert_eq!(r[0].reason, Refusal::SupersededSupport),
        other => panic!("{other:?}"),
    }
}

#[test]
fn currency_is_derived_on_read_and_withheld_quotes_are_never_stale() {
    let store = Store::new();
    assert!(record(&store, "turn-1", &first_draft()).0);
    let v1 = store.state.lock().unwrap().versions[0].clone();
    let scope = basis("p1").scope;
    let readable: BTreeMap<String, String> =
        [("ap-policy".to_string(), POLICY_SHA.to_string())].into();
    let view = run(views(
        &store,
        "actor",
        &scope,
        "task",
        std::slice::from_ref(&v1),
        Some(&readable),
    ))
    .unwrap()
    .remove(0);
    assert_eq!((view.refresh, view.withheld), (0, 0));
    assert!(
        view.limitations
            .iter()
            .any(|l| l.contains("Section conclusion is required"))
    );
    assert!(
        view.limitations
            .iter()
            .any(|l| l.contains("not evidence of remediation"))
    );
    assert!(view.limitations.iter().any(|l| l.contains("dated 2025")));
    {
        let mut s = store.state.lock().unwrap();
        s.records.heads[0].head_id = hex("rev", '8');
        s.records.summaries[0].superseded = true;
        s.records.exceptions[0].status = ExceptionStatus::ResolvedByEvidence;
        s.records.facts[0].superseded = true;
    }
    let view = run(views(
        &store,
        "actor",
        &scope,
        "task",
        std::slice::from_ref(&v1),
        Some(&BTreeMap::new()),
    ))
    .unwrap()
    .remove(0);
    let reasons: Vec<Vec<RefreshReason>> = view
        .claims
        .values()
        .map(|c| c.currency.reasons.clone())
        .collect();
    assert!(reasons.contains(&vec![RefreshReason::EvaluationRevised]));
    assert!(reasons.contains(&vec![RefreshReason::SummarySuperseded]));
    assert!(reasons.contains(&vec![RefreshReason::ExceptionStatusChanged]));
    assert!(reasons.contains(&vec![RefreshReason::FactSuperseded]));
    assert_eq!(view.refresh, 4);
    // The limitations name the claims needing refresh in claim order, never
    // in the order of their (random) block IDs.
    let numbers: Vec<usize> = view
        .limitations
        .iter()
        .filter_map(|l| l.strip_prefix("Claim ["))
        .map(|l| l.split(']').next().unwrap().parse().unwrap())
        .collect();
    assert_eq!(numbers.len(), 4);
    assert!(numbers.windows(2).all(|w| w[0] < w[1]), "{numbers:?}");
    assert_eq!(view.withheld, 1, "the viewer may not read the policy");
    assert!(view.withheld_originals.contains("ap-policy"));
    assert!(view.claims.values().any(|c| {
        c.support
            .iter()
            .any(|s| s.contains("withheld for this viewer"))
    }));
    // The outline line counts them exactly; the version is unchanged.
    let head = run(store.products("actor", &scope, "task"))
        .unwrap()
        .remove(0);
    let line = product_line(&head, &view);
    assert!(
        line.contains("4 need refresh") && line.contains("1 quotes withheld"),
        "{line}"
    );
    assert_eq!(store.state.lock().unwrap().versions[0], v1);
    // The message shows each block by ID with its author class.
    let text = products_text(&[(head, view)]).unwrap();
    assert!(
        text.contains("NEEDS REFRESH (evaluation_revised)"),
        "{text}"
    );
    assert!(text.contains("class=model-output"));
    let message = work_products_message(&firm(), Some(&text)).unwrap();
    assert!(message.contains("template ap-template:v1"));
    assert!(message.len() <= MAX_WORK_PRODUCTS_BYTES);
}

#[test]
fn exports_are_deterministic_and_bound_to_the_viewers_withheld_set() {
    let store = Store::new();
    assert!(record(&store, "turn-1", &first_draft()).0);
    let v1 = latest(&store);
    let scope = basis("p1").scope;
    let first = run(export(
        &store,
        &store,
        "actor",
        &scope,
        "s",
        "task",
        &v1.id,
        ExportFormat::Docx,
        "x1",
    ))
    .unwrap();
    let second = run(export(
        &store,
        &store,
        "actor",
        &scope,
        "s",
        "task",
        &v1.id,
        ExportFormat::Docx,
        "x2",
    ))
    .unwrap();
    assert_eq!(first.digest, second.digest, "identical bytes");
    assert_eq!(
        run(export(
            &store,
            &store,
            "actor",
            &scope,
            "s",
            "task",
            &v1.id,
            ExportFormat::Docx,
            "x1"
        ))
        .unwrap(),
        first,
        "an exact retry returns the original"
    );
    assert_eq!(
        run(export(
            &store,
            &store,
            "actor",
            &scope,
            "s",
            "task",
            &v1.id,
            ExportFormat::Xlsx,
            "x1"
        ))
        .unwrap_err(),
        ExportError::Conflict
    );
    let (record, bytes) =
        run(download(&store, &store, "actor", &scope, "task", &first.id)).unwrap();
    assert_eq!(record, first);
    assert_eq!(sha256_hex(&bytes), first.digest);
    // The viewer loses access to the policy: their withheld set is no
    // longer the export's.
    store.state.lock().unwrap().readable.clear();
    assert_eq!(
        run(download(&store, &store, "actor", &scope, "task", &first.id)).unwrap_err(),
        ExportError::ScopeChanged
    );
    let theirs = run(export(
        &store,
        &store,
        "actor",
        &scope,
        "s",
        "task",
        &v1.id,
        ExportFormat::Docx,
        "x3",
    ))
    .unwrap();
    assert_ne!(theirs.withheld_digest, first.withheld_digest);
    let (_, bytes) = run(download(
        &store, &store, "actor", &scope, "task", &theirs.id,
    ))
    .unwrap();
    let parts = zobba_domain::work_product::export::unzip(&bytes).unwrap();
    let document = String::from_utf8(
        parts
            .iter()
            .find(|(n, _)| n == "word/document.xml")
            .unwrap()
            .1
            .clone(),
    )
    .unwrap();
    assert!(document.contains("withheld for this viewer"));
    // Altered stored bytes are refused.
    store
        .state
        .lock()
        .unwrap()
        .objects
        .insert(theirs.id.clone(), b"changed".to_vec());
    assert_eq!(
        run(download(
            &store, &store, "actor", &scope, "task", &theirs.id
        ))
        .unwrap_err(),
        ExportError::Integrity
    );
    // Stale at export: the count is recorded.
    store.state.lock().unwrap().records.summaries[0].superseded = true;
    let stale = run(export(
        &store,
        &store,
        "actor",
        &scope,
        "s",
        "task",
        &v1.id,
        ExportFormat::Xlsx,
        "x4",
    ))
    .unwrap();
    assert_eq!(stale.refresh_count, 1);
}

#[test]
fn binding_templates_carry_their_neutral_standing() {
    let firm = firm();
    let t = binding_template(&firm, "ap-template", "v1").unwrap();
    assert!(!t.neutral && t.sections.len() == 3 && t.sections[0].required);
    assert!(binding_template(&firm, "ap-template", "v2").is_none());
    let mut neutral = firm.clone();
    neutral.resolution.neutral_source_version_ids = vec!["ap-method-v1".into()];
    let t = binding_template(&neutral, "ap-template", "v1").unwrap();
    assert!(
        t.neutral
            && t.label()
                .ends_with("Neutral starter (not firm methodology)")
    );
}
