use super::*;
use crate::permissions::{Action, OPERATION_VERSION, Purpose};

fn operation() -> CanonicalOperation {
    CanonicalOperation {
        version: OPERATION_VERSION,
        purpose: Purpose::TestWorkflows,
        action: Action::Read,
        account_id: "account".into(),
        environment_id: "sandbox".into(),
        destination: "fixture".into(),
        recipients: vec![],
        material: "bounded query".into(),
        material_digest: "a".repeat(64),
        attachments: vec![],
        resource_id: "resource".into(),
        resource_version: "v1".into(),
        expires_at: 1_900_000_000,
    }
}
fn tool() -> ToolDescriptor {
    let operation = operation();
    ToolDescriptor {
        name: "read_source".into(),
        version: 1,
        description: "Read exact fixture resource".into(),
        input_schema: ArgumentSchema::for_operation(&operation),
        output_schema: ArgumentSchema::String {
            max_bytes: 100,
            enumeration: vec![],
        },
        operation,
        effect: Effect::Read,
        cancellation: CancellationSemantics::LocalOnly,
        idempotency: IdempotencySemantics::ExactKey,
        reconciliation: ReconciliationSemantics::SourceLookup,
        completeness: OutputCompleteness::MayBePartial,
    }
}
fn profile() -> ModelProfile {
    ModelProfile {
        id: "profile".into(),
        revision: 1,
        provider: Provider::OpenAi,
        model: "model-v1".into(),
        account_id: "account".into(),
        destination: "fixture".into(),
        capability_revision: "native_v1".into(),
        qualification: Qualification::Fixture,
        enabled: true,
        capabilities: Capabilities {
            tools: true,
            structured_output: true,
            reasoning: false,
        },
        max_output_tokens: 128,
    }
}
fn outcome() -> TransportOutcome {
    TransportOutcome {
        events: vec![ModelEvent {
            sequence: 0,
            kind: EventKind::TextDelta {
                item_id: "message_1".into(),
                text: "answer".into(),
            },
        }],
        actual_provider: Provider::OpenAi,
        actual_model: Some("model-v1".into()),
        response_id: Some("response_1".into()),
        usage: Usage::default(),
        completion: Completion::Succeeded,
    }
}

#[test]
fn catalogue_rejects_case_and_separator_collisions_and_effect_substitution() {
    let descriptor = tool();
    let mut catalogue = ToolCatalog {
        id: "catalogue".into(),
        revision: 1,
        enabled: true,
        tools: vec![descriptor.clone()],
    };
    assert!(catalogue.is_valid());
    for name in ["READ_SOURCE", "read-source", "read_source"] {
        catalogue.tools = vec![
            descriptor.clone(),
            ToolDescriptor {
                name: name.into(),
                ..descriptor.clone()
            },
        ];
        assert!(!catalogue.is_valid());
    }
    let mut changed = descriptor;
    changed.effect = Effect::Write;
    assert!(!changed.is_valid());
}

#[test]
fn exact_argument_contract_refuses_account_material_and_schema_substitution() {
    let descriptor = tool();
    let exact = operation_arguments(&descriptor.operation);
    assert_eq!(descriptor.resolve(&exact), Ok(descriptor.operation.clone()));
    for field in [
        "account_id",
        "material",
        "resource_version",
        "material_digest",
        "destination",
    ] {
        let JsonValue::Object(mut changed) = exact.clone() else {
            unreachable!()
        };
        changed.insert(field.into(), JsonValue::String("substituted".into()));
        assert_eq!(
            descriptor.resolve(&JsonValue::Object(changed)),
            Err(ModelError::Invalid)
        );
    }
    let mut changed = descriptor;
    changed.input_schema = ArgumentSchema::Object {
        properties: BTreeMap::new(),
        required: vec![],
    };
    assert!(!changed.is_valid());
}

#[test]
fn schema_checks_required_unknown_keys_types_depth_nodes_and_bytes() {
    let schema = ArgumentSchema::Object {
        properties: BTreeMap::from([(
            "answer".into(),
            ArgumentSchema::Integer {
                minimum: 1,
                maximum: 3,
            },
        )]),
        required: vec!["answer".into()],
    };
    assert!(schema.accepts(&JsonValue::Object(BTreeMap::from([(
        "answer".into(),
        JsonValue::Integer(2)
    )]))));
    assert!(!schema.accepts(&JsonValue::Object(BTreeMap::new())));
    assert!(!schema.accepts(&JsonValue::Object(BTreeMap::from([(
        "answer".into(),
        JsonValue::Integer(4)
    )]))));
    assert!(!schema.accepts(&JsonValue::Object(BTreeMap::from([
        ("answer".into(), JsonValue::Integer(2)),
        ("extra".into(), JsonValue::Null)
    ]))));
    let mut value = JsonValue::Null;
    for _ in 0..=MAX_JSON_DEPTH {
        value = JsonValue::Array(vec![value]);
    }
    assert!(!value.is_valid());
    assert!(!JsonValue::Array(vec![JsonValue::Null; MAX_JSON_NODES]).is_valid());
    assert!(!JsonValue::String("x".repeat(MAX_TOOL_ARGUMENT_BYTES + 1)).is_valid());
    assert!(
        !ArgumentSchema::String {
            max_bytes: MAX_TOOL_ARGUMENT_BYTES as u32,
            enumeration: vec![
                "a".repeat(MAX_TOOL_ARGUMENT_BYTES / 2),
                "b".repeat(MAX_TOOL_ARGUMENT_BYTES / 2)
            ]
        }
        .is_valid()
    );
}

#[test]
fn terminal_identity_order_usage_and_refusal_are_fail_closed() {
    let profile = profile();
    let valid = outcome();
    assert_eq!(valid.validate(&profile), Ok(()));
    let mut changed = valid.clone();
    changed.actual_model = Some("another-model".into());
    assert_eq!(changed.validate(&profile), Err(ModelError::Identity));
    changed.completion = Completion::Failed(ModelError::Identity);
    assert_eq!(changed.validate(&profile), Ok(()));
    changed = valid.clone();
    changed.actual_model = None;
    assert_eq!(changed.validate(&profile), Err(ModelError::Malformed));
    changed = valid.clone();
    changed.events[0].sequence = 1;
    assert_eq!(changed.validate(&profile), Err(ModelError::Malformed));
    changed = valid.clone();
    changed.events[0].kind = EventKind::Refusal {
        item_id: "refusal".into(),
        text: "declined".into(),
    };
    assert_eq!(changed.validate(&profile), Err(ModelError::Malformed));
    changed.completion = Completion::Refused;
    assert_eq!(changed.validate(&profile), Ok(()));
    changed = valid;
    changed.events.push(ModelEvent {
        sequence: 1,
        kind: EventKind::Usage(Usage {
            input_tokens: Some(4),
            output_tokens: None,
            actual_service_tier: None,
        }),
    });
    assert_eq!(changed.validate(&profile), Err(ModelError::Malformed));
}

#[test]
fn duplicate_tool_call_ids_and_output_overflow_are_rejected() {
    let mut value = outcome();
    let proposal = EventKind::ToolProposal {
        call_id: "call".into(),
        name: "read_source".into(),
        arguments: JsonValue::Object(BTreeMap::new()),
    };
    value.events = vec![
        ModelEvent {
            sequence: 0,
            kind: proposal.clone(),
        },
        ModelEvent {
            sequence: 1,
            kind: proposal,
        },
    ];
    assert_eq!(value.validate(&profile()), Err(ModelError::Malformed));
    value.events = vec![
        ModelEvent {
            sequence: 0,
            kind: EventKind::TextDelta {
                item_id: "message".into(),
                text: "x".repeat(MAX_OUTPUT_BYTES),
            },
        },
        ModelEvent {
            sequence: 1,
            kind: EventKind::TextDelta {
                item_id: "message".into(),
                text: "x".into(),
            },
        },
    ];
    assert_eq!(value.validate(&profile()), Err(ModelError::Capacity));
}

#[test]
fn incomplete_outcome_retains_identifiable_text_and_unknown_usage() {
    let mut partial = outcome();
    partial.completion = Completion::Incomplete;
    assert_eq!(partial.validate(&profile()), Ok(()));
    assert_eq!(partial.usage, Usage::default());
    partial.actual_model = None;
    partial.response_id = None;
    assert_eq!(partial.validate(&profile()), Ok(()));
}

#[test]
fn actual_tier_is_bounded_and_live_success_requires_observed_standard() {
    for (provider, standard) in [
        (Provider::OpenAi, "default"),
        (Provider::Anthropic, "standard"),
    ] {
        let mut profile = profile();
        profile.provider = provider;
        let mut observed = outcome();
        observed.actual_provider = provider;
        assert_eq!(observed.validate(&profile), Ok(()));
        profile.qualification = Qualification::Live;
        assert_eq!(observed.validate(&profile), Err(ModelError::Identity));
        observed.completion = Completion::Incomplete;
        assert_eq!(observed.validate(&profile), Ok(()));
        observed.completion = Completion::Succeeded;
        observed.usage.actual_service_tier = Some(standard.into());
        assert_eq!(observed.validate(&profile), Ok(()));
        observed.usage.actual_service_tier = Some("priority".into());
        assert_eq!(observed.validate(&profile), Err(ModelError::Identity));
        observed.completion = Completion::Failed(ModelError::Identity);
        assert_eq!(observed.validate(&profile), Ok(()));
        for invalid in [
            String::new(),
            "bad tier".into(),
            "tier\nsecret".into(),
            "x".repeat(201),
        ] {
            observed.usage.actual_service_tier = Some(invalid);
            assert_eq!(observed.validate(&profile), Err(ModelError::Malformed));
        }
    }
}

#[test]
fn failed_http_classification_preserves_nonstandard_tier_and_known_usage() {
    for error in [ModelError::RateLimited, ModelError::Unavailable] {
        let mut observed = outcome();
        observed.completion = Completion::Failed(error);
        observed.usage = Usage {
            input_tokens: Some(21),
            output_tokens: Some(3),
            actual_service_tier: Some("priority".into()),
        };
        let original = observed.clone();
        assert_eq!(observed.validate(&profile()), Ok(()));
        assert_eq!(observed, original);
        observed.actual_model = Some("unexpected-model".into());
        assert_eq!(observed.validate(&profile()), Err(ModelError::Identity));
    }
}

fn thinking(text: &str, signature: &str) -> ReasoningBlock {
    ReasoningBlock::Thinking {
        thinking: text.into(),
        signature: signature.into(),
    }
}

fn claude(events: Vec<EventKind>) -> TransportOutcome {
    TransportOutcome {
        events: events
            .into_iter()
            .enumerate()
            .map(|(sequence, kind)| ModelEvent {
                sequence: sequence as u64,
                kind,
            })
            .collect(),
        actual_provider: Provider::Anthropic,
        ..outcome()
    }
}

#[test]
fn reasoning_blocks_are_bounded_printable_and_never_debugged() {
    assert!(thinking("", "EqQBCkYIBRgCKkB+/=").is_valid());
    assert!(thinking("step one\nstep two", "sig").is_valid());
    for invalid in [
        thinking("", ""),
        thinking("", "sig\nnature"),
        thinking("", "sïg"),
        thinking("", &"s".repeat(MAX_REASONING_SIGNATURE_BYTES + 1)),
        thinking(&"t".repeat(MAX_REASONING_TEXT_BYTES + 1), "sig"),
        thinking("bell\u{7}", "sig"),
        ReasoningBlock::Redacted {
            data: String::new(),
        },
        ReasoningBlock::Redacted {
            data: "d".repeat(MAX_REDACTED_REASONING_BYTES + 1),
        },
        ReasoningBlock::Redacted {
            data: "tab\tdata".into(),
        },
    ] {
        assert!(!invalid.is_valid(), "{invalid:?}");
    }
    let debug = format!("{:?}", thinking("secret reasoning", "secret-signature"));
    assert!(!debug.contains("secret"));
    assert!(debug.contains("thinking_bytes"));
    let debug = format!(
        "{:?}",
        ReasoningBlock::Redacted {
            data: "opaque".into()
        }
    );
    assert!(!debug.contains("opaque"));
}

#[test]
fn replay_blocks_keep_original_pre_tool_order_for_claude_tool_calls_only() {
    let proposal = EventKind::ToolProposal {
        call_id: "call_1".into(),
        name: "read_source".into(),
        arguments: JsonValue::Null,
    };
    let text = |item: &str, value: &str| EventKind::TextDelta {
        item_id: item.into(),
        text: value.into(),
    };
    let reasoning = |item: &str, block: ReasoningBlock| EventKind::Reasoning {
        item_id: item.into(),
        block,
    };
    let interleaved = claude(vec![
        reasoning("r:0", thinking("", "sig-a")),
        text("r:1", "Let me "),
        text("r:1", "check."),
        reasoning(
            "r:2",
            ReasoningBlock::Redacted {
                data: "opaque".into(),
            },
        ),
        proposal.clone(),
    ]);
    assert!(interleaved.validate(&profile()).is_err()); // provider differs from profile
    let mut anthropic = profile();
    anthropic.provider = Provider::Anthropic;
    assert_eq!(interleaved.validate(&anthropic), Ok(()));
    assert_eq!(
        interleaved.replay_blocks(),
        vec![
            ReplayBlock::Reasoning(thinking("", "sig-a")),
            ReplayBlock::Text("Let me check.".into()),
            ReplayBlock::Reasoning(ReasoningBlock::Redacted {
                data: "opaque".into()
            }),
        ]
    );
    // A text-only answer keeps its reasoning in the outcome; nothing replays.
    let answer = claude(vec![
        reasoning("r:0", thinking("", "sig")),
        text("r:1", "Done"),
    ]);
    assert_eq!(answer.validate(&anthropic), Ok(()));
    assert!(answer.replay_blocks().is_empty());
    // Non-successful or OpenAI outcomes never replay.
    let mut failed = interleaved.clone();
    failed.completion = Completion::Incomplete;
    assert!(failed.replay_blocks().is_empty());
    let mut openai = interleaved.clone();
    openai.actual_provider = Provider::OpenAi;
    assert!(openai.replay_blocks().is_empty());
    assert_eq!(openai.validate(&profile()), Err(ModelError::Malformed));
    // Invalid reasoning and oversized reasoning fail closed.
    let bad = claude(vec![reasoning("r:0", thinking("", "")), proposal.clone()]);
    assert_eq!(bad.validate(&anthropic), Err(ModelError::Malformed));
    let large = claude(vec![
        reasoning("r:0", thinking(&"t".repeat(MAX_REASONING_TEXT_BYTES), "s")),
        reasoning("r:1", thinking(&"t".repeat(MAX_REASONING_TEXT_BYTES), "s")),
        reasoning("r:2", thinking(&"t".repeat(MAX_REASONING_TEXT_BYTES), "s")),
        proposal,
    ]);
    assert_eq!(large.validate(&anthropic), Err(ModelError::Capacity));
}

#[test]
fn exchange_replay_blocks_are_validated_and_bounded() {
    let mut exchange = ToolExchange {
        invocation_id: "invocation".into(),
        call_id: "call_1".into(),
        tool: tool(),
        arguments: operation_arguments(&operation()),
        result: ToolResult {
            source_id: "source".into(),
            operation_id: "operation".into(),
            attempt_id: "attempt".into(),
            fact: SourceFact::Completed,
            content: "result".into(),
            is_error: false,
        },
        preceding: vec![],
    };
    assert!(exchange.is_valid());
    exchange.preceding = vec![ReplayBlock::Reasoning(thinking("", "sig"))];
    assert!(exchange.is_valid());
    exchange.preceding = vec![ReplayBlock::Text(String::new())];
    assert!(!exchange.is_valid());
    exchange.preceding = vec![ReplayBlock::Reasoning(thinking("", "sig")); MAX_REPLAY_BLOCKS + 1];
    assert!(!exchange.is_valid());
}
