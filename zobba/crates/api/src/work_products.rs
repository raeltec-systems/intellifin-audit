//! Story 24.4: firm-shaped work products with supported claims.
//!
//! The shelf lists the engagement's (or one Task's) work products with an
//! exact count, the review state word Draft, the claims needing refresh and
//! the missing required sections. A version view shows its blocks by
//! template section with each claim's currency derived now (never stored):
//! a claim whose records changed says why it needs refresh, and a quote the
//! viewer may not read now is withheld, never stale. A person edits through
//! an authenticated POST (Origin, session CSRF, the expected-actor fence and
//! a request key idempotent per actor): a currently assigned Auditor or
//! Audit manager edits text and claim sentences, removes or reorders blocks,
//! and the same checks as the agent's apply. Exports are rendered by trusted
//! code from one exact version; a download requires the viewer's current
//! withheld set to equal the export's.
use std::{collections::BTreeMap, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use utoipa::ToSchema;
use zobba_application::{
    disposition::PersonReader,
    task::TaskError,
    work_product::{
        BlockRefusal, ClaimView, EditBlock, EditError, EditRequest, ExportError, ExportRecord,
        ProductHead, VersionRecord, VersionView, WorkProductStore, download, export, save_edit,
        viewer_readable, views,
    },
};
use zobba_domain::{
    identity::valid_scope_id,
    work_product::{
        Author, Block, Content, ExportFormat, JUDGMENT_LABEL, NOT_COMPLETED, NarrativeLabel, Pin,
        REVIEW_STATE, export::media_type, valid_block_id, valid_export_id, valid_product_id,
        valid_version_id,
    },
};
use zobba_infrastructure::{
    assessment::AssessmentRepository,
    citation::{CitationRepository, ViewerOriginal},
    evidence::{EvidenceRepository, s3::S3EvidenceObjects},
    identity::secret_hash,
};

use crate::tasks::{TaskScopeQuery, failure};

#[derive(Clone)]
pub(crate) struct WorkProductState {
    identity: crate::auth::AuthState,
    assessments: AssessmentRepository,
    evidence: EvidenceRepository,
    citations: CitationRepository,
    objects: Option<Arc<S3EvidenceObjects>>,
}

pub(crate) fn router(
    pool: sqlx::PgPool,
    identity: crate::auth::AuthState,
    objects: Option<Arc<S3EvidenceObjects>>,
) -> Router {
    let capacity = Arc::new(Semaphore::new(4));
    Router::new()
        .route("/engagements/{engagement_id}/work-products", get(shelf))
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/work-products",
            get(task_shelf),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions",
            post(edit),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions/{version_id}",
            get(version),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions/{version_id}/claims/{block_id}/support",
            get(support),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions/{version_id}/exports",
            post(request_export),
        )
        .route(
            "/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/exports/{export_id}/content",
            get(content),
        )
        .with_state(WorkProductState {
            identity,
            assessments: AssessmentRepository::new(pool.clone()),
            evidence: EvidenceRepository::new(pool.clone()),
            citations: CitationRepository::new(pool),
            objects,
        })
        .layer(axum::extract::DefaultBodyLimit::max(96 * 1024))
        .layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let capacity = capacity.clone();
                async move {
                    let Ok(_permit) = capacity.try_acquire_owned() else {
                        return failure(TaskError::Capacity);
                    };
                    match tokio::time::timeout(Duration::from_secs(60), next.run(request)).await {
                        Ok(response) => response,
                        Err(_) => failure(TaskError::Unavailable),
                    }
                }
            },
        ))
}

/// Whether a request is export I/O (rendering and the object store), which
/// runs under the longer evidence deadline.
pub(crate) fn is_io_request(request: &axum::extract::Request) -> bool {
    let parts: Vec<_> = request.uri().path().split('/').collect();
    matches!(parts.as_slice(), ["", "engagements", _, "tasks", _, "work-products", _, "versions", _, "exports"] if request.method() == axum::http::Method::POST)
        || matches!(parts.as_slice(), ["", "engagements", _, "tasks", _, "work-products", _, "exports", _, "content"] if request.method() == axum::http::Method::GET)
}

// ---------------------------------------------------------------- responses

/// One work product on a shelf: its latest version, the review state word,
/// the exact number of its claims needing refresh and its required sections
/// not completed.
#[derive(Serialize, ToSchema)]
pub struct WorkProductSummaryResponse {
    pub id: String,
    /// The originating Task.
    pub task_id: String,
    pub title: String,
    /// `working_paper`, `analysis`, `finding_summary` or `report_draft`.
    pub kind: String,
    /// The template's name; a neutral starter says so.
    pub template: String,
    pub template_id: String,
    pub template_version: String,
    /// The built-in neutral starter or a neutral source: "Neutral starter
    /// (not firm methodology)".
    pub neutral: bool,
    #[schema(pattern = "^wpv-[0-9a-f]{40}$")]
    pub version_id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub version: String,
    /// `agent` or `human`.
    pub author_kind: String,
    /// Always "Draft" in this story.
    pub review_state: String,
    #[schema(pattern = "^[0-9]+$")]
    pub claims: String,
    /// Exact count of claims needing refresh now.
    #[schema(pattern = "^[0-9]+$")]
    pub refresh: String,
    /// Required template sections with no content, in template order.
    #[schema(max_items = 64)]
    pub missing_required: Vec<String>,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub recorded_us: Option<String>,
}

/// One page of a shelf (50, C-ordered by work product ID).
#[derive(Serialize, ToSchema)]
pub struct WorkProductShelfResponse {
    #[schema(max_items = 50)]
    pub products: Vec<WorkProductSummaryResponse>,
    /// Exact count over the whole shelf, never over the page.
    #[schema(pattern = "^[0-9]+$")]
    pub total: String,
    #[schema(required = true, pattern = "^wp-[0-9a-f]{40}$")]
    pub next_cursor: Option<String>,
}

/// One checked assertion of a claim. A quote's value is withheld from a
/// viewer who may not read its original now.
#[derive(Serialize, ToSchema)]
pub struct WorkProductAssertionResponse {
    pub kind: String,
    pub record_kind: String,
    pub record_id: String,
    pub record_digest: String,
    #[schema(required = true)]
    pub measure: Option<String>,
    #[schema(required = true)]
    pub criterion_id: Option<String>,
    #[schema(required = true)]
    pub value: Option<String>,
    pub withheld: bool,
    #[schema(required = true)]
    pub origin: Option<String>,
    #[schema(required = true)]
    pub review: Option<String>,
    #[schema(required = true)]
    pub locator: Option<String>,
    #[schema(required = true)]
    pub unit: Option<String>,
    #[schema(required = true)]
    pub subject: Option<String>,
    /// A quote's source for the citation chip: navigable only when the
    /// viewer may read the exact original now.
    #[schema(required = true)]
    pub source: Option<crate::answers::CitationSourceResponse>,
}

/// A claim's currency, derived now (never stored).
#[derive(Serialize, ToSchema)]
pub struct WorkProductClaimResponse {
    /// Its 1-based number in the version.
    #[schema(pattern = "^[0-9]+$")]
    pub number: String,
    pub current: bool,
    /// Closed reasons it needs refresh.
    #[schema(max_items = 6)]
    pub refresh: Vec<String>,
    #[schema(max_items = 6)]
    pub refresh_words: Vec<String>,
    /// A quote this viewer may not read now (withheld, never stale).
    pub withheld: bool,
    /// The platform coverage line of its summary or basis.
    #[schema(required = true)]
    pub coverage: Option<String>,
    /// What each record says, in the platform's words.
    #[schema(max_items = 8)]
    pub support: Vec<String>,
    #[schema(max_items = 8)]
    pub assertions: Vec<WorkProductAssertionResponse>,
}

/// One block of a version.
#[derive(Serialize, ToSchema)]
pub struct WorkProductBlockResponse {
    #[schema(pattern = "^blk-[0-9a-f]{40}$")]
    pub id: String,
    pub section_id: String,
    /// `heading`, `narrative`, `claim`, `coverage`, `exceptions` or
    /// `limitations`.
    pub kind: String,
    /// A narrative's `judgment` or `narrative`.
    #[schema(required = true)]
    pub label: Option<String>,
    /// "Zobba's judgment — not checked against records" on a judgment block.
    #[schema(required = true)]
    pub label_words: Option<String>,
    /// A heading's or narrative's text, or a claim's sentence.
    #[schema(required = true)]
    pub text: Option<String>,
    #[schema(required = true)]
    pub record_id: Option<String>,
    pub author_kind: String,
    pub author_id: String,
    #[schema(required = true)]
    pub author_label: Option<String>,
    pub authored_in_version: String,
    #[schema(required = true)]
    pub claim: Option<WorkProductClaimResponse>,
    /// Platform lines of a coverage, exceptions or limitations block.
    #[schema(max_items = 256)]
    pub lines: Vec<String>,
}

/// One template section with its blocks.
#[derive(Serialize, ToSchema)]
pub struct WorkProductSectionResponse {
    pub id: String,
    pub title: String,
    pub required: bool,
    /// "Not completed in this version." when required and empty.
    #[schema(required = true)]
    pub not_completed: Option<String>,
    #[schema(max_items = 64)]
    pub blocks: Vec<WorkProductBlockResponse>,
}

/// One exact version of a work product with its claims' currency now.
#[derive(Serialize, ToSchema)]
pub struct WorkProductVersionResponse {
    pub product: WorkProductSummaryResponse,
    #[schema(pattern = "^wpv-[0-9a-f]{40}$")]
    pub id: String,
    #[schema(pattern = "^[0-9]+$")]
    pub version: String,
    /// SHA-256 of the version's canonical document.
    pub digest: String,
    #[schema(required = true)]
    pub predecessor_id: Option<String>,
    pub author_kind: String,
    #[schema(required = true)]
    pub author_label: Option<String>,
    pub title: String,
    pub kind: String,
    pub template: String,
    pub figure_rule: String,
    pub review_state: String,
    #[schema(max_items = 64)]
    pub sections: Vec<WorkProductSectionResponse>,
    #[schema(max_items = 512)]
    pub limitations: Vec<String>,
    #[schema(pattern = "^[0-9]+$")]
    pub refresh: String,
    #[schema(pattern = "^[0-9]+$")]
    pub withheld: String,
    #[schema(max_items = 64)]
    pub missing_required: Vec<String>,
    /// The latest version's ID when this is not the latest (a newer version
    /// is announced, never swapped in).
    #[schema(required = true)]
    pub newer_version_id: Option<String>,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub recorded_us: Option<String>,
}

/// One assertion of a claim as pinned, and what its record says now.
#[derive(Serialize, ToSchema)]
pub struct WorkProductSupportItemResponse {
    pub pinned: WorkProductAssertionResponse,
    /// The platform's words for the pinned record.
    pub support: String,
}

/// A claim's support: its sentence, each pinned record and its currency.
#[derive(Serialize, ToSchema)]
pub struct WorkProductSupportResponse {
    pub block_id: String,
    pub statement: String,
    pub claim: WorkProductClaimResponse,
    #[schema(max_items = 8)]
    pub items: Vec<WorkProductSupportItemResponse>,
}

/// A refusal of a person's edit, per block (or the edit as a whole).
#[derive(Serialize, ToSchema)]
pub struct WorkProductRefusalItemResponse {
    #[schema(required = true)]
    pub block: Option<u32>,
    pub reason: String,
    pub words: String,
    pub detail: String,
}
#[derive(Serialize, ToSchema)]
pub struct WorkProductErrorResponse {
    pub error: &'static str,
    /// The work product's latest version, for `stale_base`.
    #[schema(required = true)]
    pub head: Option<String>,
    #[schema(max_items = 256)]
    pub refusals: Vec<WorkProductRefusalItemResponse>,
}

/// A stored export of one exact version.
#[derive(Serialize, ToSchema)]
pub struct WorkProductExportResponse {
    #[schema(pattern = "^wpx-[0-9a-f]{40}$")]
    pub id: String,
    pub version_id: String,
    /// `docx` or `xlsx`.
    pub format: String,
    pub media_type: String,
    pub renderer: String,
    pub digest: String,
    #[schema(pattern = "^[0-9]+$")]
    pub size: String,
    /// The digest of the requesting viewer's withheld set.
    pub withheld_digest: String,
    /// Claims needing refresh at export time.
    #[schema(pattern = "^[0-9]+$")]
    pub refresh_count: String,
    #[schema(required = true, pattern = "^[0-9]+$")]
    pub recorded_us: Option<String>,
}

fn summary_response(head: &ProductHead, view: &VersionView) -> WorkProductSummaryResponse {
    let v = &head.head.version;
    let t = &head.product.template;
    WorkProductSummaryResponse {
        id: head.product.id.clone(),
        task_id: head.product.task_id.clone(),
        title: v.title.clone(),
        kind: v.kind.as_str().into(),
        template: t.label(),
        template_id: t.id.clone(),
        template_version: t.version.clone(),
        neutral: t.neutral,
        version_id: v.id.clone(),
        version: v.number.to_string(),
        author_kind: v.author.kind().as_str().into(),
        review_state: REVIEW_STATE.into(),
        claims: view.claims.len().to_string(),
        refresh: view.refresh.to_string(),
        missing_required: v.missing_required.clone(),
        recorded_us: head.head.recorded_us.map(|u| u.to_string()),
    }
}

type Originals = BTreeMap<String, ViewerOriginal>;

fn assertion_response(
    pin: &Pin,
    withheld: bool,
    originals: &Originals,
) -> WorkProductAssertionResponse {
    // A withheld quote carries no source: its text is the thing withheld.
    let source =
        (pin.kind == zobba_domain::work_product::AssertionKind::Quote && !withheld).then(|| {
            crate::answers::source_response(
                &zobba_domain::citation::CitationSource {
                    original_id: pin.record_id.clone(),
                    locator: pin.locator.clone(),
                    quote: pin.value.clone(),
                },
                crate::answers::exact_original(originals, &pin.record_id, Some(&pin.record_digest)),
                (crate::answers::CitationVerificationResponse::Verified, None),
            )
        });
    WorkProductAssertionResponse {
        source,
        kind: pin.kind.as_str().into(),
        record_kind: pin.record_kind.as_str().into(),
        record_id: pin.record_id.clone(),
        record_digest: pin.record_digest.clone(),
        measure: pin.measure.map(|m| m.as_str().into()),
        criterion_id: pin.criterion_id.clone(),
        value: (!withheld).then(|| pin.value.clone()),
        withheld,
        origin: pin.origin.map(|o| o.as_str().into()),
        review: pin.review.map(|r| r.as_str().into()),
        locator: pin.locator.as_ref().map(|l| l.render()),
        unit: pin.unit.clone(),
        subject: pin.subject.clone(),
    }
}

fn claim_response(
    view: &VersionView,
    claim: &ClaimView,
    pins: &[Pin],
    originals: &Originals,
) -> WorkProductClaimResponse {
    WorkProductClaimResponse {
        number: claim.number.to_string(),
        current: claim.currency.current(),
        refresh: claim
            .currency
            .reasons
            .iter()
            .map(|r| r.as_str().into())
            .collect(),
        refresh_words: claim
            .currency
            .reasons
            .iter()
            .map(|r| r.words().into())
            .collect(),
        withheld: claim.currency.withheld,
        coverage: claim.coverage.clone(),
        support: claim.support.clone(),
        assertions: pins
            .iter()
            .map(|p| {
                assertion_response(
                    p,
                    p.kind == zobba_domain::work_product::AssertionKind::Quote
                        && view.withheld_originals.contains(&p.record_id),
                    originals,
                )
            })
            .collect(),
    }
}

fn block_response(
    view: &VersionView,
    block: &Block,
    labels: &BTreeMap<String, String>,
    originals: &Originals,
) -> WorkProductBlockResponse {
    let (label, text, record) = match &block.content {
        Content::Heading { text } => (None, Some(text.clone()), None),
        Content::Narrative { label, text } => (Some(*label), Some(text.clone()), None),
        Content::Claim { statement, .. } => (None, Some(statement.clone()), None),
        Content::Coverage { summary_id } => (None, None, Some(summary_id.clone())),
        Content::Exceptions { basis_id } => (None, None, Some(basis_id.clone())),
        Content::Limitations => (None, None, None),
    };
    let claim = match &block.content {
        Content::Claim { pins, .. } => view
            .claims
            .get(&block.id)
            .map(|c| claim_response(view, c, pins, originals)),
        _ => None,
    };
    let lines = match &block.content {
        Content::Limitations => view.limitations.clone(),
        _ => view.lines.get(&block.id).cloned().unwrap_or_default(),
    };
    WorkProductBlockResponse {
        id: block.id.clone(),
        section_id: block.section.clone(),
        kind: block.content.kind().as_str().into(),
        label: label.map(|l| l.as_str().into()),
        label_words: (label == Some(NarrativeLabel::Judgment)).then(|| JUDGMENT_LABEL.into()),
        text,
        record_id: record,
        author_kind: block.author.kind().as_str().into(),
        author_id: block.author.id().into(),
        author_label: match &block.author {
            Author::Human { actor_id } => labels.get(actor_id).cloned(),
            Author::Agent { .. } => Some("Zobba (agent)".into()),
        },
        authored_in_version: block.authored_in.clone(),
        claim,
        lines,
    }
}

fn version_response(
    head: &ProductHead,
    head_view: &VersionView,
    view: &VersionView,
    labels: &BTreeMap<String, String>,
    originals: &Originals,
) -> WorkProductVersionResponse {
    let v = &view.record.version;
    let sections = v
        .template
        .sections
        .iter()
        .map(|s| {
            let blocks: Vec<WorkProductBlockResponse> = v
                .blocks
                .iter()
                .filter(|b| b.section == s.id)
                .map(|b| block_response(view, b, labels, originals))
                .collect();
            WorkProductSectionResponse {
                id: s.id.clone(),
                title: s.title.clone(),
                required: s.required,
                not_completed: v
                    .missing_required
                    .contains(&s.id)
                    .then(|| NOT_COMPLETED.into()),
                blocks,
            }
        })
        .collect();
    WorkProductVersionResponse {
        product: summary_response(head, head_view),
        id: v.id.clone(),
        version: v.number.to_string(),
        digest: view.record.digest.clone(),
        predecessor_id: v.predecessor.clone(),
        author_kind: v.author.kind().as_str().into(),
        author_label: match &v.author {
            Author::Human { actor_id } => labels.get(actor_id).cloned(),
            Author::Agent { .. } => Some("Zobba (agent)".into()),
        },
        title: v.title.clone(),
        kind: v.kind.as_str().into(),
        template: v.template.label(),
        figure_rule: zobba_domain::work_product::FIGURE_RULE.into(),
        review_state: REVIEW_STATE.into(),
        sections,
        limitations: view.limitations.clone(),
        refresh: view.refresh.to_string(),
        withheld: view.withheld.to_string(),
        missing_required: v.missing_required.clone(),
        newer_version_id: (head.head.version.id != v.id).then(|| head.head.version.id.clone()),
        recorded_us: view.record.recorded_us.map(|u| u.to_string()),
    }
}

fn export_response(record: &ExportRecord) -> WorkProductExportResponse {
    WorkProductExportResponse {
        id: record.id.clone(),
        version_id: record.version_id.clone(),
        format: record.format.as_str().into(),
        media_type: media_type(record.format).into(),
        renderer: zobba_domain::work_product::RENDERER.into(),
        digest: record.digest.clone(),
        size: record.size.to_string(),
        withheld_digest: record.withheld_digest.clone(),
        refresh_count: record.refresh_count.to_string(),
        recorded_us: record.recorded_us.map(|u| u.to_string()),
    }
}

fn error_response(status: StatusCode, error: &'static str) -> Response {
    (
        status,
        Json(WorkProductErrorResponse {
            error,
            head: None,
            refusals: vec![],
        }),
    )
        .into_response()
}
fn not_found() -> Response {
    error_response(StatusCode::NOT_FOUND, "work_product_not_found")
}
fn reading_failure(error: zobba_application::citation::ReadingError) -> Response {
    use zobba_application::citation::ReadingError as R;
    failure(match error {
        R::Denied | R::Fenced => TaskError::Denied,
        R::Invalid => TaskError::Invalid,
        R::Capacity => TaskError::Capacity,
        R::Unavailable => TaskError::Unavailable,
    })
}

fn refusal_items(refusals: &[BlockRefusal]) -> Vec<WorkProductRefusalItemResponse> {
    refusals
        .iter()
        .map(|r| WorkProductRefusalItemResponse {
            block: r.block.map(|b| b as u32),
            reason: r.reason.as_str().into(),
            words: r.reason.words().into(),
            detail: r.detail.clone(),
        })
        .collect()
}
fn edit_refusal(error: EditError) -> Response {
    let status = match &error {
        EditError::Invalid => StatusCode::BAD_REQUEST,
        EditError::Denied => StatusCode::FORBIDDEN,
        EditError::NotFound => StatusCode::NOT_FOUND,
        EditError::StaleBase(_)
        | EditError::Refused(_)
        | EditError::Conflict
        | EditError::Capacity => StatusCode::CONFLICT,
        EditError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
    };
    let (head, refusals) = match &error {
        EditError::StaleBase(head) => (Some(head.clone()).filter(|h| !h.is_empty()), vec![]),
        EditError::Refused(r) => (None, refusal_items(r)),
        _ => (None, vec![]),
    };
    let code = match &error {
        // A refusal names its first reason (the list names every one).
        EditError::Refused(r) => r
            .first()
            .map_or("work_product_refused", |r| r.reason.as_str()),
        other => other.code(),
    };
    (
        status,
        Json(WorkProductErrorResponse {
            error: code,
            head,
            refusals,
        }),
    )
        .into_response()
}
fn export_refusal(error: ExportError) -> Response {
    let status = match &error {
        ExportError::Invalid => StatusCode::BAD_REQUEST,
        ExportError::Denied => StatusCode::FORBIDDEN,
        ExportError::NotFound => StatusCode::NOT_FOUND,
        ExportError::Conflict | ExportError::ScopeChanged => StatusCode::CONFLICT,
        ExportError::Integrity | ExportError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
    };
    error_response(status, error.code())
}

// ------------------------------------------------------------------ reads

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ShelfQuery {
    organisation_id: String,
    client_id: String,
    cursor: Option<String>,
}

async fn shelf_view(
    state: &WorkProductState,
    actor: &str,
    scope: &zobba_domain::identity::Scope,
    task_id: Option<&str>,
    cursor: Option<&str>,
) -> Response {
    if let Err(error) = state.assessments.work_product_viewer(actor, scope).await {
        return failure(error);
    }
    let page = match state
        .assessments
        .work_product_shelf(actor, scope, task_id, cursor)
        .await
    {
        Ok(page) => page,
        Err(error) => return reading_failure(error),
    };
    // Currency per Task, set-based over each Task's latest versions.
    let mut by_task: BTreeMap<String, Vec<VersionRecord>> = BTreeMap::new();
    for p in &page.products {
        by_task
            .entry(p.product.task_id.clone())
            .or_default()
            .push(p.head.clone());
    }
    let mut computed: BTreeMap<String, VersionView> = BTreeMap::new();
    for (task, heads) in &by_task {
        match views(
            &state.assessments,
            actor,
            scope,
            task,
            heads,
            Some(&BTreeMap::new()),
        )
        .await
        {
            Ok(list) => {
                for v in list {
                    computed.insert(v.record.version.id.clone(), v);
                }
            }
            Err(error) => return reading_failure(error),
        }
    }
    let products = page
        .products
        .iter()
        .filter_map(|p| {
            computed
                .get(&p.head.version.id)
                .map(|v| summary_response(p, v))
        })
        .collect();
    Json(WorkProductShelfResponse {
        products,
        total: page.total.to_string(),
        next_cursor: page.next,
    })
    .into_response()
}

#[utoipa::path(get,path="/engagements/{engagement_id}/work-products",operation_id="list_work_products",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition",min_length=1,max_length=128),("engagement_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),
        ("cursor"=Option<String>,Query,description="next_cursor of the previous page",pattern="^wp-[0-9a-f]{40}$")),
    responses((status=200,description="One page (50, C-ordered) of the engagement's work products with an exact total, each with its latest version, review state Draft, claims needing refresh and missing required sections",body=WorkProductShelfResponse),(status=400,body=crate::auth::ErrorResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,body=crate::auth::ErrorResponse),(status=412,description="Session changed",body=crate::auth::ErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=crate::auth::ErrorResponse)))]
pub(crate) async fn shelf(
    State(state): State<WorkProductState>,
    headers: HeaderMap,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<ShelfQuery>, QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let (Ok(Path(engagement_id)), Ok(Query(query))) = (path, query) else {
        return failure(TaskError::Invalid);
    };
    let scope = match (TaskScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    })
    .scope(engagement_id)
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    if query
        .cursor
        .as_deref()
        .is_some_and(|c| !valid_product_id(c))
    {
        return failure(TaskError::Invalid);
    }
    shelf_view(
        &state,
        &current.identity.id,
        &scope,
        None,
        query.cursor.as_deref(),
    )
    .await
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/work-products",operation_id="list_task_work_products",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),
        ("cursor"=Option<String>,Query,description="next_cursor of the previous page",pattern="^wp-[0-9a-f]{40}$")),
    responses((status=200,description="The Task's work products (a Task holds at most 16) with an exact total",body=WorkProductShelfResponse),(status=400,body=crate::auth::ErrorResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,body=crate::auth::ErrorResponse),(status=412,description="Session changed",body=crate::auth::ErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=crate::auth::ErrorResponse)))]
pub(crate) async fn task_shelf(
    State(state): State<WorkProductState>,
    headers: HeaderMap,
    path: Result<Path<(String, String)>, PathRejection>,
    query: Result<Query<ShelfQuery>, QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let (Ok(Path((engagement_id, task_id))), Ok(Query(query))) = (path, query) else {
        return failure(TaskError::Invalid);
    };
    let scope = match (TaskScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    })
    .scope(engagement_id)
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&task_id)
        || query
            .cursor
            .as_deref()
            .is_some_and(|c| !valid_product_id(c))
    {
        return failure(TaskError::Invalid);
    }
    shelf_view(
        &state,
        &current.identity.id,
        &scope,
        Some(&task_id),
        query.cursor.as_deref(),
    )
    .await
}

/// A version and its product's latest version, each with currency now for
/// this viewer, and the labels of its people.
async fn read_version(
    state: &WorkProductState,
    actor: &str,
    scope: &zobba_domain::identity::Scope,
    task_id: &str,
    product_id: &str,
    version_id: &str,
) -> Result<Read, Response> {
    if let Err(error) = state.assessments.work_product_viewer(actor, scope).await {
        return Err(failure(error));
    }
    let head = WorkProductStore::product(&state.assessments, actor, scope, task_id, product_id)
        .await
        .map_err(reading_failure)?
        .ok_or_else(not_found)?;
    let record = WorkProductStore::version(&state.assessments, actor, scope, task_id, version_id)
        .await
        .map_err(reading_failure)?
        .filter(|v| v.version.product_id == product_id)
        .ok_or_else(not_found)?;
    let readable = viewer_readable(&state.assessments, actor, scope, &record.version)
        .await
        .map_err(reading_failure)?;
    let mut head_readable = viewer_readable(&state.assessments, actor, scope, &head.head.version)
        .await
        .map_err(reading_failure)?;
    head_readable.extend(readable.clone());
    let digests: BTreeMap<String, String> = head_readable
        .iter()
        .map(|(id, (sha, _))| (id.clone(), sha.clone()))
        .collect();
    let mut list = views(
        &state.assessments,
        actor,
        scope,
        task_id,
        &[record.clone(), head.head.clone()],
        Some(&digests),
    )
    .await
    .map_err(reading_failure)?;
    let head_view = list.pop().ok_or_else(|| failure(TaskError::Unavailable))?;
    let view = list.pop().ok_or_else(|| failure(TaskError::Unavailable))?;
    let people = zobba_application::work_product::editors(&record.version);
    let labels = zobba_application::work_product::WorkProductPeople::labels(
        &state.assessments,
        actor,
        scope,
        &people,
    )
    .await
    .map_err(reading_failure)?;
    let quotes: Vec<String> = record
        .version
        .claims()
        .flat_map(|(_, pins)| pins.iter())
        .filter(|p| p.kind == zobba_domain::work_product::AssertionKind::Quote)
        .map(|p| p.record_id.clone())
        .collect();
    let originals = state
        .citations
        .viewer_originals(actor, scope, &quotes)
        .await
        .map_err(reading_failure)?;
    Ok((head, head_view, view, labels, originals))
}

type Read = (
    ProductHead,
    VersionView,
    VersionView,
    BTreeMap<String, String>,
    Originals,
);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ScopeQuery {
    organisation_id: String,
    client_id: String,
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions/{version_id}",operation_id="get_work_product_version",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("product_id"=String,Path),("version_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query)),
    responses((status=200,description="One exact version by template section, each claim's currency derived now, its limitations, and the latest version's ID when this is not the latest",body=WorkProductVersionResponse),(status=400,body=crate::auth::ErrorResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,body=crate::auth::ErrorResponse),(status=404,body=WorkProductErrorResponse),(status=412,description="Session changed",body=crate::auth::ErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=crate::auth::ErrorResponse)))]
pub(crate) async fn version(
    State(state): State<WorkProductState>,
    headers: HeaderMap,
    path: Result<Path<(String, String, String, String)>, PathRejection>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let (Ok(Path((engagement_id, task_id, product_id, version_id))), Ok(Query(query))) =
        (path, query)
    else {
        return failure(TaskError::Invalid);
    };
    let scope = match (TaskScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    })
    .scope(engagement_id)
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&task_id) || !valid_product_id(&product_id) || !valid_version_id(&version_id)
    {
        return not_found();
    }
    match read_version(
        &state,
        &current.identity.id,
        &scope,
        &task_id,
        &product_id,
        &version_id,
    )
    .await
    {
        Ok((head, head_view, view, labels, originals)) => Json(version_response(
            &head, &head_view, &view, &labels, &originals,
        ))
        .into_response(),
        Err(response) => response,
    }
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions/{version_id}/claims/{block_id}/support",operation_id="get_work_product_claim_support",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("product_id"=String,Path),("version_id"=String,Path),("block_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query)),
    responses((status=200,description="One claim's pinned records and their currency now; a quote this viewer may not read now is withheld",body=WorkProductSupportResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,body=crate::auth::ErrorResponse),(status=404,body=WorkProductErrorResponse),(status=412,description="Session changed",body=crate::auth::ErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=crate::auth::ErrorResponse)))]
pub(crate) async fn support(
    State(state): State<WorkProductState>,
    headers: HeaderMap,
    path: Result<Path<(String, String, String, String, String)>, PathRejection>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let (Ok(Path((engagement_id, task_id, product_id, version_id, block_id))), Ok(Query(query))) =
        (path, query)
    else {
        return failure(TaskError::Invalid);
    };
    let scope = match (TaskScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    })
    .scope(engagement_id)
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&task_id)
        || !valid_product_id(&product_id)
        || !valid_version_id(&version_id)
        || !valid_block_id(&block_id)
    {
        return not_found();
    }
    let (_, _, view, _, originals) = match read_version(
        &state,
        &current.identity.id,
        &scope,
        &task_id,
        &product_id,
        &version_id,
    )
    .await
    {
        Ok(found) => found,
        Err(response) => return response,
    };
    let Some(block) = view.record.version.blocks.iter().find(|b| b.id == block_id) else {
        return not_found();
    };
    let (Content::Claim { statement, pins }, Some(claim)) =
        (&block.content, view.claims.get(&block.id))
    else {
        return not_found();
    };
    let response = claim_response(&view, claim, pins, &originals);
    let items = pins
        .iter()
        .zip(&claim.support)
        .map(|(p, s)| WorkProductSupportItemResponse {
            pinned: assertion_response(
                p,
                p.kind == zobba_domain::work_product::AssertionKind::Quote
                    && view.withheld_originals.contains(&p.record_id),
                &originals,
            ),
            support: s.clone(),
        })
        .collect();
    Json(WorkProductSupportResponse {
        block_id: block.id.clone(),
        statement: statement.clone(),
        claim: response,
        items,
    })
    .into_response()
}

// ---------------------------------------------------------------- commands

/// One block a person keeps, in order: a base block by ID, with new text
/// for a heading, a narrative or a claim's sentence (absent keeps it).
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkProductEditBlockRequest {
    #[schema(pattern = "^blk-[0-9a-f]{40}$")]
    pub block: String,
    /// At most 4,000 UTF-8 bytes (a claim's sentence 1,000, a heading 500).
    #[schema(required = false, max_length = 4000)]
    pub text: Option<String>,
}

/// A person's edit of a work product's latest version.
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkProductEditRequest {
    /// Request key, idempotent per actor and bound to the session.
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    /// The version it edits: the latest.
    #[schema(pattern = "^wpv-[0-9a-f]{40}$")]
    pub base_version: String,
    /// The blocks to keep, in order (the limitations block is kept anyway).
    #[schema(max_items = 64)]
    pub blocks: Vec<WorkProductEditBlockRequest>,
}

fn mutation_actor(state: &WorkProductState, headers: &HeaderMap, actor: &str, csrf: &str) -> bool {
    crate::operations::expected_actor_matches(headers, actor)
        && state.identity.permits_mutation(headers, csrf)
}

#[utoipa::path(post,path="/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions",operation_id="save_work_product_version",security(("server_session"=[])),
    params(("engagement_id"=String,Path),("task_id"=String,Path),("product_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("Origin"=String,Header,description="Exact configured HTTPS application origin"),("X-CSRF-Token"=String,Header,description="Current session-bound token"),("X-Expected-Actor"=String,Header,description="Required refusal fence for the current session actor",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")),
    request_body=WorkProductEditRequest,
    responses((status=200,description="The recorded version (an exact retry returns the original); every kept block is unchanged with its author, every edited claim's assertions were checked again",body=WorkProductVersionResponse),(status=400,body=WorkProductErrorResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,description="access_denied: not a currently assigned Auditor or Audit manager in their own session (Admin alone is refused)",body=WorkProductErrorResponse),(status=404,body=WorkProductErrorResponse),(status=409,description="stale_base naming the latest version, a closed refusal reason per block, or work_product_edit_conflict",body=WorkProductErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=WorkProductErrorResponse)))]
pub(crate) async fn edit(
    State(state): State<WorkProductState>,
    headers: HeaderMap,
    path: Result<Path<(String, String, String)>, PathRejection>,
    query: Result<Query<TaskScopeQuery>, QueryRejection>,
    body: Result<Json<WorkProductEditRequest>, JsonRejection>,
) -> Response {
    let current = match state.identity.current(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    if !mutation_actor(&state, &headers, &current.identity.id, &current.csrf_token) {
        return crate::auth::failure(zobba_application::identity::IdentityError::Denied);
    }
    let Some(token) = crate::auth::cookie(&headers, crate::auth::SESSION_COOKIE) else {
        return crate::auth::failure(zobba_application::identity::IdentityError::Unauthenticated);
    };
    let (Ok(Path((engagement_id, task_id, product_id))), Ok(Query(query))) = (path, query) else {
        return edit_refusal(EditError::Invalid);
    };
    let scope = match query.scope(engagement_id) {
        Ok(scope) => scope,
        Err(_) => return edit_refusal(EditError::Denied),
    };
    let Ok(Json(body)) = body else {
        return edit_refusal(EditError::Invalid);
    };
    if !valid_scope_id(&task_id) || !valid_product_id(&product_id) {
        return edit_refusal(EditError::Invalid);
    }
    let request = EditRequest {
        key: body.key,
        base_version: body.base_version,
        blocks: body
            .blocks
            .into_iter()
            .map(|b| EditBlock {
                block: b.block,
                text: b.text,
            })
            .collect(),
    };
    let evidence = state
        .evidence
        .clone()
        .with_session_hash(secret_hash(&token));
    let reader = PersonReader {
        metadata: &evidence,
        objects: state.objects.as_deref(),
        store: &state.assessments,
    };
    let actor = current.identity.id.clone();
    match save_edit(
        &state.assessments,
        &reader,
        &actor,
        &scope,
        &secret_hash(&token),
        &task_id,
        &product_id,
        &request,
    )
    .await
    {
        Ok(saved) => match read_version(
            &state,
            &actor,
            &scope,
            &task_id,
            &product_id,
            &saved.version.id,
        )
        .await
        {
            Ok((head, head_view, view, labels, originals)) => Json(version_response(
                &head, &head_view, &view, &labels, &originals,
            ))
            .into_response(),
            Err(response) => response,
        },
        Err(error) => edit_refusal(error),
    }
}

/// An export request: the format and a request key idempotent per actor.
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkProductExportRequest {
    #[schema(min_length = 1, max_length = 128, pattern = "^[A-Za-z0-9_-]+$")]
    pub key: String,
    /// `docx` or `xlsx`.
    pub format: String,
}

#[utoipa::path(post,path="/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/versions/{version_id}/exports",operation_id="export_work_product_version",security(("server_session"=[])),
    params(("engagement_id"=String,Path),("task_id"=String,Path),("product_id"=String,Path),("version_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query),("Origin"=String,Header,description="Exact configured HTTPS application origin"),("X-CSRF-Token"=String,Header,description="Current session-bound token"),("X-Expected-Actor"=String,Header,description="Required refusal fence for the current session actor",min_length=1,max_length=128,pattern="^[A-Za-z0-9_-]+$")),
    request_body=WorkProductExportRequest,
    responses((status=200,description="The stored export of this exact version for the requesting viewer's withheld set (an exact retry returns the original; the same version, format and withheld set give identical bytes)",body=WorkProductExportResponse),(status=400,body=WorkProductErrorResponse),(status=401,body=crate::auth::ErrorResponse),(status=403,body=WorkProductErrorResponse),(status=404,body=WorkProductErrorResponse),(status=409,description="work_product_export_conflict for a key used for another request",body=WorkProductErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,description="The object store is unavailable: nothing was recorded; retry",body=WorkProductErrorResponse)))]
pub(crate) async fn request_export(
    State(state): State<WorkProductState>,
    headers: HeaderMap,
    path: Result<Path<(String, String, String, String)>, PathRejection>,
    query: Result<Query<TaskScopeQuery>, QueryRejection>,
    body: Result<Json<WorkProductExportRequest>, JsonRejection>,
) -> Response {
    let current = match state.identity.current(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    if !mutation_actor(&state, &headers, &current.identity.id, &current.csrf_token) {
        return crate::auth::failure(zobba_application::identity::IdentityError::Denied);
    }
    let Some(token) = crate::auth::cookie(&headers, crate::auth::SESSION_COOKIE) else {
        return crate::auth::failure(zobba_application::identity::IdentityError::Unauthenticated);
    };
    let (Ok(Path((engagement_id, task_id, product_id, version_id))), Ok(Query(query))) =
        (path, query)
    else {
        return export_refusal(ExportError::Invalid);
    };
    let scope = match query.scope(engagement_id) {
        Ok(scope) => scope,
        Err(_) => return export_refusal(ExportError::Denied),
    };
    let Ok(Json(body)) = body else {
        return export_refusal(ExportError::Invalid);
    };
    let Some(format) = ExportFormat::parse(&body.format) else {
        return export_refusal(ExportError::Invalid);
    };
    if !valid_scope_id(&task_id) || !valid_product_id(&product_id) {
        return export_refusal(ExportError::Invalid);
    }
    let Some(objects) = state.objects.as_deref() else {
        return export_refusal(ExportError::Unavailable);
    };
    let actor = current.identity.id.clone();
    if let Err(error) = state.assessments.work_product_viewer(&actor, &scope).await {
        return failure(error);
    }
    match WorkProductStore::version(&state.assessments, &actor, &scope, &task_id, &version_id).await
    {
        Ok(Some(v)) if v.version.product_id == product_id => {}
        Ok(_) => return not_found(),
        Err(error) => return reading_failure(error),
    }
    match export(
        &state.assessments,
        objects,
        &actor,
        &scope,
        &secret_hash(&token),
        &task_id,
        &version_id,
        format,
        &body.key,
    )
    .await
    {
        Ok(record) => Json(export_response(&record)).into_response(),
        Err(error) => export_refusal(error),
    }
}

#[utoipa::path(get,path="/engagements/{engagement_id}/tasks/{task_id}/work-products/{product_id}/exports/{export_id}/content",operation_id="download_work_product_export",security(("server_session"=[])),
    params(("X-Expected-Session"=Option<String>,Header,description="Optional session-bound read precondition",min_length=1,max_length=128),("engagement_id"=String,Path),("task_id"=String,Path),("product_id"=String,Path),("export_id"=String,Path),("organisation_id"=String,Query),("client_id"=String,Query)),
    responses((status=200,description="The export's exact bytes, their size and digest checked again",content_type="application/octet-stream",body=Vec<u8>),(status=401,body=crate::auth::ErrorResponse),(status=403,body=WorkProductErrorResponse),(status=404,body=WorkProductErrorResponse),(status=409,description="export_scope_changed: the viewer's withheld set is not the export's; request your own export",body=WorkProductErrorResponse),(status=412,description="Session changed",body=crate::auth::ErrorResponse),(status=429,body=crate::auth::ErrorResponse),(status=503,body=WorkProductErrorResponse)))]
pub(crate) async fn content(
    State(state): State<WorkProductState>,
    headers: HeaderMap,
    path: Result<Path<(String, String, String, String)>, PathRejection>,
    query: Result<Query<ScopeQuery>, QueryRejection>,
) -> Response {
    let current = match state.identity.current_read(&headers).await {
        Ok(current) => current,
        Err(error) => return crate::auth::failure(error),
    };
    let (Ok(Path((engagement_id, task_id, product_id, export_id))), Ok(Query(query))) =
        (path, query)
    else {
        return failure(TaskError::Invalid);
    };
    let scope = match (TaskScopeQuery {
        organisation_id: query.organisation_id,
        client_id: query.client_id,
    })
    .scope(engagement_id)
    {
        Ok(scope) => scope,
        Err(error) => return failure(error),
    };
    if !valid_scope_id(&task_id) || !valid_product_id(&product_id) || !valid_export_id(&export_id) {
        return not_found();
    }
    let Some(objects) = state.objects.as_deref() else {
        return export_refusal(ExportError::Unavailable);
    };
    let actor = current.identity.id.clone();
    if let Err(error) = state.assessments.work_product_viewer(&actor, &scope).await {
        return failure(error);
    }
    match download(
        &state.assessments,
        objects,
        &actor,
        &scope,
        &task_id,
        &export_id,
    )
    .await
    {
        Ok((record, bytes)) => {
            let mut response = Response::new(Body::from(bytes));
            let h = response.headers_mut();
            h.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static(media_type(record.format)),
            );
            h.insert(
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!(
                    "attachment; filename=\"{}.{}\"",
                    record.version_id,
                    record.format.as_str()
                ))
                .unwrap_or(HeaderValue::from_static("attachment")),
            );
            h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            h.insert(
                "X-Content-Type-Options",
                HeaderValue::from_static("nosniff"),
            );
            response
        }
        Err(error) => export_refusal(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_edit_refusal_has_its_status_and_names_the_head() {
        let status = |e: EditError| edit_refusal(e).status();
        assert_eq!(status(EditError::Invalid), StatusCode::BAD_REQUEST);
        assert_eq!(status(EditError::Denied), StatusCode::FORBIDDEN);
        assert_eq!(status(EditError::NotFound), StatusCode::NOT_FOUND);
        assert_eq!(
            status(EditError::StaleBase("wpv-x".into())),
            StatusCode::CONFLICT
        );
        assert_eq!(status(EditError::Conflict), StatusCode::CONFLICT);
        assert_eq!(
            status(EditError::Unavailable),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[test]
    fn each_export_refusal_has_its_status() {
        let status = |e: ExportError| export_refusal(e).status();
        assert_eq!(status(ExportError::ScopeChanged), StatusCode::CONFLICT);
        assert_eq!(status(ExportError::Conflict), StatusCode::CONFLICT);
        assert_eq!(status(ExportError::Denied), StatusCode::FORBIDDEN);
        assert_eq!(
            status(ExportError::Unavailable),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(ExportError::ScopeChanged.code(), "export_scope_changed");
    }

    #[test]
    fn export_io_runs_under_the_longer_deadline() {
        let request = |method: &str, path: &str| {
            axum::http::Request::builder()
                .method(method)
                .uri(path)
                .body(axum::body::Body::empty())
                .unwrap()
        };
        assert!(is_io_request(&request(
            "POST",
            "/engagements/e/tasks/t/work-products/p/versions/v/exports"
        )));
        assert!(is_io_request(&request(
            "GET",
            "/engagements/e/tasks/t/work-products/p/exports/x/content"
        )));
        assert!(!is_io_request(&request(
            "GET",
            "/engagements/e/tasks/t/work-products/p/versions/v"
        )));
    }

    #[test]
    fn a_withheld_quote_has_no_value() {
        let pin = Pin {
            kind: zobba_domain::work_product::AssertionKind::Quote,
            record_kind: zobba_domain::work_product::RecordKind::Original,
            record_id: "ap-policy".into(),
            record_digest: "a".repeat(64),
            measure: None,
            criterion_id: None,
            value: "Invoices".into(),
            origin: None,
            review: None,
            locator: zobba_domain::citation::Locator::parse("bytes:0-8"),
            unit: None,
            subject: None,
        };
        let shown = assertion_response(&pin, true, &Originals::new());
        assert!(shown.value.is_none() && shown.withheld && shown.source.is_none());
        assert!(
            assertion_response(&pin, false, &Originals::new())
                .source
                .is_some_and(|s| !s.readable && s.quote.is_none())
        );
        assert_eq!(
            assertion_response(&pin, false, &Originals::new())
                .value
                .as_deref(),
            Some("Invoices")
        );
    }
}
