//! Reading-tool contracts with in-memory ports (the 22.4 analysis fakes, a
//! synthetic model transport). The real sandbox, documents, PostgreSQL and
//! object store are proven by the worker integration suite.
use super::*;
use crate::{
    analysis::tests::{Behaviour, INPUT, World, basis, digest, regular, run, target},
    model::{DispatchPermit, PreparedInvocation},
};
use std::sync::Mutex;
use zobba_domain::{
    citation::{Segment, UnverifiedReason, Verification},
    model::{Capabilities, JsonValue, ModelEvent, Provider, Qualification, TransportOutcome, Usage},
    permissions::{Action, Attachment, OPERATION_VERSION, Purpose},
};

const ORIGINAL: &str = "orig-a";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nsynthetic-page-three";

fn manifest(text_layer: Option<&str>) -> Vec<u8> {
    let layer = text_layer.map_or("null".to_string(), |t| format!("\"{t}\""));
    format!(
        "{{\"page_count\": 3, \"pages\": [{{\"file\": null, \"page\": 1, \"reason\": \"page_too_large\", \"text_layer\": null}}, {{\"file\": \"pages/0003.png\", \"page\": 3, \"reason\": null, \"text_layer\": {layer}}}], \"reason\": null, \"status\": \"rendered\"}}"
    )
    .into_bytes()
}

#[derive(Default)]
struct Models {
    requests: Mutex<Vec<ModelRequest>>,
    invocations: Mutex<Vec<Invocation>>,
}
impl ModelStore for Models {
    async fn prepare(
        &self,
        _: &str,
        _: &Scope,
        request: &ModelRequest,
    ) -> Result<PreparedInvocation, ModelError> {
        if let Some(existing) = self
            .invocations
            .lock()
            .unwrap()
            .iter()
            .find(|i| i.key == request.key)
        {
            return Ok(PreparedInvocation::Recovered(Box::new(existing.clone())));
        }
        self.requests.lock().unwrap().push(request.clone());
        let id = format!("invocation-{}", self.requests.lock().unwrap().len());
        self.invocations.lock().unwrap().push(Invocation {
            id: id.clone(),
            key: request.key.clone(),
            request: request.clone(),
            outcome: None,
        });
        Ok(PreparedInvocation::Dispatch(DispatchPermit {
            invocation_id: id,
            receipt_capability: "c".repeat(64),
        }))
    }
    async fn complete(
        &self,
        permit: &DispatchPermit,
        outcome: &TransportOutcome,
    ) -> Result<Invocation, ModelError> {
        let mut invocations = self.invocations.lock().unwrap();
        let invocation = invocations
            .iter_mut()
            .find(|i| i.id == permit.invocation_id)
            .unwrap();
        invocation.outcome = Some(outcome.clone());
        Ok(invocation.clone())
    }
    async fn current_audience(&self, _: &str, _: &Scope, _: &str) -> Result<(), ModelError> {
        Ok(())
    }
    async fn get(&self, _: &str, _: &Scope, id: &str) -> Result<Invocation, ModelError> {
        self.invocations
            .lock()
            .unwrap()
            .iter()
            .find(|i| i.id == id)
            .cloned()
            .ok_or(ModelError::Denied)
    }
    async fn admit_tool(
        &self,
        _: &str,
        _: &Scope,
        _: &ClaimBasis,
        _: &str,
        _: &str,
        _: &str,
    ) -> Result<zobba_domain::permissions::Operation, ModelError> {
        unreachable!("page reads admit no tool")
    }
}

/// Synthetic transport: never a live provider.
struct Transport {
    outcome: Mutex<Vec<Completion>>,
    images: Mutex<Vec<(String, usize)>>,
}
impl Transport {
    fn new(script: Vec<Completion>) -> Self {
        Self {
            outcome: Mutex::new(script),
            images: Mutex::default(),
        }
    }
}
impl ModelTransport for Transport {
    async fn invoke(&self, request: &ModelRequest, _: &ModelCancellation) -> TransportOutcome {
        for image in request.messages.iter().flat_map(|m| m.images.iter()) {
            self.images
                .lock()
                .unwrap()
                .push((image.sha256.clone(), image.bytes.len()));
        }
        let completion = self.outcome.lock().unwrap().remove(0);
        let value = JsonValue::Object(
            [
                ("text".to_string(), JsonValue::String("Signed by A. Auditor".into())),
                (
                    "unreadable".to_string(),
                    JsonValue::Array(vec![JsonValue::String("The stamp is illegible.".into())]),
                ),
            ]
            .into(),
        );
        let events = if completion == Completion::Succeeded {
            vec![
                ModelEvent {
                    sequence: 0,
                    kind: EventKind::Structured {
                        item_id: "item-1".into(),
                        value,
                    },
                },
                ModelEvent {
                    sequence: 1,
                    kind: EventKind::Usage(Usage::default()),
                },
            ]
        } else {
            vec![]
        };
        TransportOutcome {
            events,
            actual_provider: Provider::OpenAi,
            actual_model: (completion == Completion::Succeeded).then(|| "fixture-model".into()),
            response_id: (completion == Completion::Succeeded).then(|| "response-1".into()),
            usage: Usage::default(),
            completion,
        }
    }
}

#[derive(Default)]
struct Facts {
    renders: Mutex<Vec<RenderBatch>>,
    reads: Mutex<Vec<PageRead>>,
    runs: Mutex<Vec<ProgramRun>>,
    citations: Mutex<Vec<(String, Vec<StoredCitation>)>>,
}
struct Store<'a> {
    facts: Facts,
    world: &'a World,
}
impl ReadingStore for Store<'_> {
    async fn original(
        &self,
        _: &str,
        _: &Scope,
        id: &str,
    ) -> Result<Option<ReadingOriginal>, ReadingError> {
        Ok((id == ORIGINAL).then(|| ReadingOriginal {
            id: ORIGINAL.into(),
            sha256: digest(INPUT),
            size: INPUT.len() as u64,
            filename: "Scanned letter.pdf".into(),
        }))
    }
    async fn originals(&self, _: &str, _: &Scope) -> Result<Vec<ReadingOriginal>, ReadingError> {
        Ok(vec![self.original("", &crate::analysis::tests::scope(), ORIGINAL).await?.unwrap()])
    }
    async fn render_batch(
        &self,
        _: &str,
        _: &Scope,
        original_id: &str,
        sha: &str,
        batch: u32,
    ) -> Result<Option<RenderBatch>, ReadingError> {
        Ok(self
            .facts
            .renders
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.original_id == original_id && r.original_sha256 == sha && r.batch == batch)
            .cloned())
    }
    async fn record_render(&self, _: &ClaimBasis, batch: &RenderBatch) -> Result<RenderBatch, ReadingError> {
        assert!(batch.is_valid());
        self.facts.renders.lock().unwrap().push(batch.clone());
        Ok(batch.clone())
    }
    async fn job_outputs(&self, _: &str, _: &Scope, job_id: &str) -> Result<Vec<Descendant>, ReadingError> {
        Ok(self.world.jobs.descendants_of(job_id))
    }
    async fn page_reads(&self, _: &str, _: &Scope, _: &str) -> Result<Vec<PageRead>, ReadingError> {
        Ok(self.facts.reads.lock().unwrap().clone())
    }
    async fn record_page_read(&self, _: &ClaimBasis, read: &PageRead) -> Result<PageRead, ReadingError> {
        assert!(read.is_valid(), "{read:?}");
        self.facts.reads.lock().unwrap().push(read.clone());
        Ok(read.clone())
    }
    async fn program_runs(&self, _: &str, _: &Scope, _: &str) -> Result<Vec<ProgramRun>, ReadingError> {
        Ok(self.facts.runs.lock().unwrap().clone())
    }
    async fn record_program_run(&self, _: &ClaimBasis, run: &ProgramRun) -> Result<ProgramRun, ReadingError> {
        self.facts.runs.lock().unwrap().push(run.clone());
        Ok(run.clone())
    }
    async fn citations(&self, _: &str, _: &Scope, id: &str) -> Result<Option<Vec<StoredCitation>>, ReadingError> {
        Ok(self
            .facts
            .citations
            .lock()
            .unwrap()
            .iter()
            .find(|(i, _)| i == id)
            .map(|(_, c)| c.clone()))
    }
    async fn record_citations(
        &self,
        _: &ClaimBasis,
        id: &str,
        citations: &[StoredCitation],
    ) -> Result<Vec<StoredCitation>, ReadingError> {
        self.facts
            .citations
            .lock()
            .unwrap()
            .push((id.into(), citations.to_vec()));
        Ok(citations.to_vec())
    }
}

/// Stand-in for the infrastructure binding: the page image is its own
/// attachment beside one input-class attachment.
fn bind(request: &mut ModelRequest) -> Result<(), ModelError> {
    let mut attachments: Vec<Attachment> = request
        .messages
        .iter()
        .flat_map(|m| m.images.iter())
        .map(|i| Attachment {
            id: i.attachment_id.clone(),
            digest: i.sha256.clone(),
            classification: i.classification.clone(),
        })
        .collect();
    attachments.push(Attachment {
        id: "model-input-00".into(),
        digest: "1".repeat(64),
        classification: request.input_classes[0].clone(),
    });
    attachments.sort_by(|a, b| a.id.cmp(&b.id));
    request.disclosure.attachments = attachments;
    Ok(())
}
fn settings() -> ReadingSettings {
    ReadingSettings {
        profile: ModelProfile {
            id: "profile".into(),
            revision: 1,
            provider: Provider::OpenAi,
            model: "fixture-model".into(),
            account_id: "account".into(),
            destination: "destination".into(),
            capability_revision: "v1".into(),
            qualification: Qualification::Fixture,
            enabled: true,
            capabilities: Capabilities {
                tools: true,
                structured_output: true,
                reasoning: false,
                image_input: true,
            },
            max_output_tokens: 512,
        },
        catalogue: ToolCatalog {
            id: "catalogue".into(),
            revision: 1,
            enabled: true,
            tools: vec![],
        },
        disclosure: CanonicalOperation {
            version: OPERATION_VERSION,
            purpose: Purpose::AuditCoordination,
            action: Action::Send,
            account_id: "account".into(),
            environment_id: "model-environment".into(),
            destination: "destination".into(),
            recipients: vec!["provider".into()],
            material: "Synthetic model processing".into(),
            material_digest: "2".repeat(64),
            attachments: vec![],
            resource_id: "model-resource".into(),
            resource_version: "v1".into(),
            expires_at: 2_000_000_000,
        },
        input_class: "audit".into(),
        classification: "confidential".into(),
        max_output_tokens: 256,
        analysis: target(),
        bind,
    }
}

struct Harness {
    world: World,
    models: ModelCoordinator<Models, Transport>,
    settings: ReadingSettings,
}
impl Harness {
    fn new(entries: Vec<zobba_domain::analysis::OutputEntry>, script: Vec<Completion>) -> Self {
        Self {
            world: World::new(Behaviour::Exit(0), entries),
            models: ModelCoordinator {
                store: Models::default(),
                transport: Transport::new(script),
            },
            settings: settings(),
        }
    }
    fn reading<'a>(
        &'a self,
        store: &'a Store<'a>,
    ) -> Reading<'a, Models, Transport, Store<'a>, crate::analysis::tests::Store, crate::analysis::tests::Jobs, crate::analysis::tests::Sandbox, crate::analysis::tests::Objects>
    {
        let analysis = self.world.analysis();
        Reading {
            models: &self.models,
            store,
            operations: analysis.store,
            jobs: analysis.jobs,
            sandbox: analysis.sandbox,
            objects: analysis.objects,
            allowlist: analysis.allowlist,
            analysis_settings: analysis.settings,
            settings: &self.settings,
        }
    }
}
fn rendered(text_layer: Option<&str>) -> Vec<zobba_domain::analysis::OutputEntry> {
    vec![regular("pages.json", &manifest(text_layer)), regular("pages/0003.png", PNG)]
}

#[test]
fn a_native_page_read_renders_once_and_discloses_exactly_that_page_image() {
    let h = Harness::new(rendered(None), vec![Completion::Succeeded]);
    let store = Store {
        facts: Facts::default(),
        world: &h.world,
    };
    let reading = h.reading(&store);
    let cancel = ModelCancellation::new();
    let read = run(reading.read_page(&basis("p1"), "methodology", ORIGINAL, 3, &cancel)).unwrap();
    assert_eq!(read.status, ReadStatus::Read);
    assert_eq!(read.image_sha256.as_deref(), Some(digest(PNG).as_str()));
    let transcript = read.transcript.clone().unwrap();
    assert_eq!(transcript.unreadable, vec!["The stamp is illegible."]);
    // The trusted program, not a model's, rendered the page in the sandbox.
    let spec = h.world.sandbox.seen_spec.lock().unwrap().clone().unwrap();
    let program = String::from_utf8(spec.program).unwrap();
    assert!(program.starts_with(DOCUMENT_PROGRAM));
    assert!(program.contains("main(_zobba_json.loads("));
    assert_eq!(spec.inputs.len(), 1);
    // One request, one image, the exact rendered bytes, its own attachment.
    let requests = h.models.store.requests.lock().unwrap().clone();
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    let images: Vec<_> = request.messages.iter().flat_map(|m| m.images.iter()).collect();
    assert_eq!(images.len(), 1);
    assert_eq!(images[0].sha256, digest(PNG));
    assert_eq!(
        request
            .disclosure
            .attachments
            .iter()
            .filter(|a| a.digest == digest(PNG))
            .map(|a| (a.id.as_str(), a.classification.as_str()))
            .collect::<Vec<_>>(),
        vec![("page-image", "confidential")]
    );
    assert_eq!(request.structured_output, Some(PageTranscript::schema()));
    assert_eq!(*h.models.transport.images.lock().unwrap(), vec![(digest(PNG), PNG.len())]);
    // Reading again discloses nothing new and renders nothing new.
    let again = run(reading.read_page(&basis("p1"), "methodology", ORIGINAL, 3, &cancel)).unwrap();
    assert_eq!(again, read);
    assert_eq!(h.models.store.requests.lock().unwrap().len(), 1);
    assert_eq!(h.world.sandbox.started.lock().unwrap().len(), 1);
    assert_eq!(store.facts.renders.lock().unwrap().len(), 1);
    // The transcription enters later context only as labelled model output.
    let invocation = h.models.store.invocations.lock().unwrap()[0].clone();
    let text = transcript_envelope("page-read-0", &invocation).unwrap();
    assert!(text.contains("not verified evidence") && text.contains("The stamp is illegible."));
    let context = run(reading.reading_context(&basis("p1"))).unwrap();
    assert!(context.originals.unwrap().contains(ORIGINAL));
    assert_eq!(
        context
            .readings
            .iter()
            .filter(|r| r.3.as_deref() == Some(invocation.id.as_str()))
            .count(),
        1
    );
}

#[test]
fn model_failure_records_a_failed_read_without_text_and_retries_are_bounded() {
    let h = Harness::new(
        rendered(None),
        vec![
            Completion::Failed(ModelError::Provider),
            Completion::Failed(ModelError::Malformed),
            Completion::Failed(ModelError::Provider),
        ],
    );
    let store = Store {
        facts: Facts::default(),
        world: &h.world,
    };
    let reading = h.reading(&store);
    let cancel = ModelCancellation::new();
    for attempt in 1..=MAX_PAGE_READ_ATTEMPTS {
        let read = run(reading.read_page(&basis("p1"), "methodology", ORIGINAL, 3, &cancel)).unwrap();
        assert_eq!((read.status, read.attempt), (ReadStatus::Failed, attempt));
        assert_eq!(read.transcript, None, "no fabricated text");
        assert!(read.reason.is_some());
    }
    // The bound is reached: the last failure stands and nothing else is sent.
    let last = run(reading.read_page(&basis("p1"), "methodology", ORIGINAL, 3, &cancel)).unwrap();
    assert_eq!(last.attempt, MAX_PAGE_READ_ATTEMPTS);
    assert_eq!(h.models.store.requests.lock().unwrap().len(), 3);
    // A page the renderer could not fit is refused without any disclosure.
    let large = run(reading.read_page(&basis("p1"), "methodology", ORIGINAL, 1, &cancel)).unwrap();
    assert_eq!(large.reason.as_deref(), Some("page_too_large"));
    let missing = run(reading.read_page(&basis("p1"), "methodology", ORIGINAL, 2, &cancel)).unwrap();
    assert_eq!(missing.reason.as_deref(), Some("page_not_found"));
    assert_eq!(h.models.store.requests.lock().unwrap().len(), 3);
    // Out of the per-document bound is refused before anything happens.
    assert_eq!(
        run(reading.read_page(&basis("p1"), "methodology", ORIGINAL, 201, &cancel)),
        Err(ReadingError::Invalid)
    );
}

fn cited(locator: &str, quote: &str) -> CitedAnswer {
    CitedAnswer {
        segments: vec![Segment {
            text: "The letter is signed.".into(),
            sources: vec![zobba_domain::citation::CitationSource {
                original_id: ORIGINAL.into(),
                locator: Locator::parse(locator),
                quote: quote.into(),
            }],
        }],
        limitations: vec![],
        read_pages: vec![],
        programs: vec![],
    }
}
fn answer_invocation() -> Invocation {
    let mut request = crate::analysis::tests::basis("p1");
    request.task_id = "task".into();
    Invocation {
        id: "answer-1".into(),
        key: "answer-1".into(),
        request: ModelRequest {
            key: "answer-1".into(),
            basis: request,
            profile: settings().profile,
            catalogue: settings().catalogue,
            disclosure: settings().disclosure,
            context: ContextManifest {
                verification: VerifyKnowledge {
                    expected_execution_epoch: 1,
                    expected_methodology_binding_id: "methodology".into(),
                    items: vec![],
                    exact: false,
                    include_inactive: false,
                },
                entries: vec![],
            },
            input_classes: vec!["audit".into()],
            messages: vec![],
            history: vec![],
            effort: Effort::None,
            max_output_tokens: 1,
            structured_output: None,
        },
        outcome: None,
    }
}

#[test]
fn a_scanned_page_is_page_only_and_a_text_layer_verifies_it() {
    // Scanned: no text layer. The answer asks to read page 3 natively first.
    let h = Harness::new(rendered(None), vec![Completion::Succeeded]);
    let store = Store {
        facts: Facts::default(),
        world: &h.world,
    };
    let reading = h.reading(&store);
    let cancel = ModelCancellation::new();
    let mut answer = cited("page:3", "Signed by A. Auditor");
    answer.read_pages = vec![zobba_domain::citation::PageRequest {
        original_id: ORIGINAL.into(),
        page: 3,
    }];
    let invocation = answer_invocation();
    let more = run(reading.after_answer(&basis("p1"), "methodology", &invocation, &answer, &cancel)).unwrap();
    assert!(more, "the answer asked to read further");
    // Verification ran before the read: the page was not yet sent.
    let citations = store.facts.citations.lock().unwrap()[0].1.clone();
    assert_eq!(
        citations[0].sources[0].verification,
        Verification::Unverified(UnverifiedReason::NotFoundAtLocation)
    );
    // After the native read, the same citation is page-only.
    let after = run(crate::citation::verify(&reading, &basis("p1"), &cited("page:3", "Signed by A. Auditor"))).unwrap();
    assert_eq!(
        after[0].sources[0].verification,
        Verification::Unverified(UnverifiedReason::PageOnly)
    );
    // Verification is recorded once per answer, and never re-run.
    run(reading.after_answer(&basis("p1"), "methodology", &invocation, &answer, &cancel)).unwrap();
    assert_eq!(store.facts.citations.lock().unwrap().len(), 1);
    assert_eq!(h.models.store.requests.lock().unwrap().len(), 1, "one disclosure for page 3");

    // A real text layer confirms the quote at the page.
    let layered = Harness::new(rendered(Some("Signatures\\r\\nSigned  by A. Auditor")), vec![]);
    let store = Store {
        facts: Facts::default(),
        world: &layered.world,
    };
    let reading = layered.reading(&store);
    let verified = run(crate::citation::verify(&reading, &basis("p1"), &cited("page:3", "Signed by A. Auditor"))).unwrap();
    assert_eq!(verified[0].sources[0].verification, Verification::Verified);
    assert_eq!(verified[0].sources[0].original_sha256, Some(digest(INPUT)));
    let absent = run(crate::citation::verify(&reading, &basis("p1"), &cited("page:9", "x"))).unwrap();
    assert_eq!(
        absent[0].sources[0].verification,
        Verification::Unverified(UnverifiedReason::NotFoundAtLocation)
    );
    assert!(layered.models.store.requests.lock().unwrap().is_empty());
}

#[test]
fn trusted_requests_escape_every_unsafe_character_and_manifests_are_strict() {
    let locate = locate_request("orig-a", &[Locator::parse("cell:Bad \"sheet\u{e9}!B4").unwrap()]);
    assert_eq!(
        locate,
        "{\"locators\":[\"cell:Bad \\\"sheet\u{e9}!B4\"],\"mode\":\"locate\",\"original\":\"orig-a\"}"
    );
    let program = document_program(&locate);
    let call = program.lines().last().unwrap();
    let inner = call
        .strip_prefix("main(_zobba_json.loads(\"")
        .and_then(|c| c.strip_suffix("\"))"))
        .unwrap();
    // Only safe characters and \u escapes reach the Python literal.
    assert!(!inner.contains('"') && inner.is_ascii(), "{call}");
    assert!(inner.contains("\\u0022") && inner.contains("\\u00e9") && inner.contains("\\u005c"));
    assert_eq!(
        render_request("orig-a", 1),
        "{\"first\":33,\"last\":64,\"max_image_bytes\":2097152,\"mode\":\"render\",\"original\":\"orig-a\"}"
    );
    for hostile in [
        &b"{\"a\":1,\"a\":2}"[..],
        b"[[[[[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]]]",
        b"{\"a\":\"\\ud800\"}",
        b"{\"a\":1} trailing",
        b"\xff",
    ] {
        assert_eq!(manifest::parse(hostile), None, "{hostile:?}");
    }
    assert_eq!(
        manifest::parse(b"{\"a\":[1,\"\\u00e9\\n\",null,true]}"),
        Some(manifest::Value::Object(vec![(
            "a".into(),
            manifest::Value::Array(vec![
                manifest::Value::Number(1),
                manifest::Value::String("\u{e9}\n".into()),
                manifest::Value::Null,
                manifest::Value::Bool(true)
            ])
        )]))
    );
    // A manifest naming a page file the job did not validly produce is not
    // trusted: the batch is recorded unreadable, never guessed.
    let h = Harness::new(vec![regular("pages.json", &manifest(None))], vec![]);
    let store = Store {
        facts: Facts::default(),
        world: &h.world,
    };
    let reading = h.reading(&store);
    let original = run(store.original("", &crate::analysis::tests::scope(), ORIGINAL)).unwrap().unwrap();
    let batch = run(reading.render(&basis("p1"), &original, 0, &ModelCancellation::new())).unwrap();
    assert_eq!(batch.status, DocumentStatus::Unreadable);
    assert_eq!(batch.reason.as_deref(), Some("no_manifest"));
}
