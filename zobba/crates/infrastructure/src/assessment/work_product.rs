//! Story 24.4: work products, their immutable versions, blocks, assertions
//! and exports. An agent's version is written under the exact claim
//! producer's custody; a person's under their exact session and current
//! assignment. The database checks every written assertion against its
//! record again (`work_product_batch`), the base against the product's latest
//! version under a per-product lock (`work_product_guard`) and the whole
//! version against its document at commit (`work_product_complete`). Reads
//! verify each stored document against its digest; claim currency is
//! derived on read from `work_product_current`, never stored.
use std::collections::BTreeMap;

use super::{AssessmentRepository, Tx, claimed, scoped, to_json, unavailable};
use crate::task;
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use zobba_application::{
    assessment::{coverage::summary_from, document_digest},
    citation::ReadingError,
    task::TaskError,
    work_product::{
        BasisNow, ChangeKind, CurrentRow, DecisionRecord, EditBasis, EditError, ExceptionNow,
        ExportError, ExportRecord, FactNow, GuideRequest, HeadNow, ProductHead, ProductRecord,
        ProposalRecord, ProposalState, RecordQuery, RecordsNow, SummaryNow, VersionRecord,
        WorkProductPeople, WorkProductStore, WriteError,
    },
};
use zobba_domain::{
    assessment::Verdict,
    coverage::Conclusion,
    exception::ExceptionStatus,
    identity::{Scope, valid_scope_id},
    model::JsonValue,
    revision::{EffectiveOrigin, ReviewState},
    task::ClaimBasis,
    work_product::{
        Content, ExportFormat, RecordKind, SectionRef, TemplateRef, Version, valid_export_id,
        valid_product_id, valid_proposal_id, valid_version_id,
    },
};

/// The upper bound of products one Task may hold, plus one (an exact read).
const PRODUCTS_READ: i64 = zobba_domain::work_product::MAX_PRODUCTS as i64 + 1;

const VERSION_SELECT: &str =
    "SELECT v.document, v.digest, v.created_us FROM public.work_product_versions v";

fn version_from(row: &PgRow) -> Result<VersionRecord, ReadingError> {
    let document: Value = row.try_get("document").map_err(unavailable)?;
    let digest: String = row.try_get("digest").map_err(unavailable)?;
    let created: i64 = row.try_get("created_us").map_err(unavailable)?;
    let document = crate::work::json_value(&document).ok_or(ReadingError::Unavailable)?;
    if document_digest(&document) != digest {
        return Err(ReadingError::Unavailable);
    }
    let version = Version::from_document(&document).ok_or(ReadingError::Unavailable)?;
    Ok(VersionRecord {
        version,
        digest,
        recorded_us: Some(created),
    })
}

fn sections_of(value: &Value) -> Option<Vec<SectionRef>> {
    value
        .as_array()?
        .iter()
        .map(|s| {
            Some(SectionRef {
                id: s.get("id")?.as_str()?.into(),
                title: s.get("title")?.as_str()?.into(),
                required: s.get("required")?.as_bool()?,
            })
        })
        .collect()
}
fn sections_json(sections: &[SectionRef]) -> Value {
    Value::Array(
        sections
            .iter()
            .map(|s| json!({"id": s.id, "title": s.title, "required": s.required}))
            .collect(),
    )
}

const PRODUCT_COLUMNS: &str = "p.id AS product_id, p.task_id, p.cycle_id, p.invocation_id, p.actor_id AS product_actor, p.binding_id, p.template_id, p.template_version, p.template_source, p.template_neutral, p.template_name, p.sections, p.created_us AS product_us, v.document, v.digest, v.created_us, (SELECT count(*) FROM public.work_product_versions c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.product_id)=(p.organisation_id,p.client_id,p.engagement_id,p.id)) AS versions";
const PRODUCT_FROM: &str = "FROM public.work_products p JOIN LATERAL (SELECT x.document, x.digest, x.created_us FROM public.work_product_versions x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.product_id)=(p.organisation_id,p.client_id,p.engagement_id,p.id) ORDER BY x.version DESC LIMIT 1) v ON true";

fn head_from(row: &PgRow) -> Result<ProductHead, ReadingError> {
    let s = |name: &str| row.try_get::<String, _>(name).map_err(unavailable);
    let sections: Value = row.try_get("sections").map_err(unavailable)?;
    let product = ProductRecord {
        id: s("product_id")?,
        task_id: s("task_id")?,
        cycle_id: s("cycle_id")?,
        invocation_id: s("invocation_id")?,
        actor_id: s("product_actor")?,
        template: TemplateRef {
            binding_id: s("binding_id")?,
            id: s("template_id")?,
            version: s("template_version")?,
            source_version_id: s("template_source")?,
            name: s("template_name")?,
            neutral: row.try_get("template_neutral").map_err(unavailable)?,
            sections: sections_of(&sections).ok_or(ReadingError::Unavailable)?,
        },
        recorded_us: Some(row.try_get("product_us").map_err(unavailable)?),
    };
    let head = version_from(row)?;
    let versions: i64 = row.try_get("versions").map_err(unavailable)?;
    if head.version.product_id != product.id || head.version.template != product.template {
        return Err(ReadingError::Unavailable);
    }
    Ok(ProductHead {
        product,
        head,
        versions: versions as u64,
    })
}

async fn products_in(
    tx: &mut Tx,
    task_id: &str,
    product_id: Option<&str>,
) -> Result<Vec<ProductHead>, ReadingError> {
    let rows = sqlx::query(&format!(
        "SELECT {PRODUCT_COLUMNS} {PRODUCT_FROM} WHERE p.task_id=$1 AND ($2::text IS NULL OR p.id=$2) ORDER BY p.id COLLATE \"C\" LIMIT $3"
    ))
    .bind(task_id)
    .bind(product_id)
    .bind(PRODUCTS_READ)
    .fetch_all(&mut **tx)
    .await
    .map_err(unavailable)?;
    rows.iter().map(head_from).collect()
}

fn ids(set: &std::collections::BTreeSet<String>) -> Vec<String> {
    set.iter()
        .filter(|id| valid_scope_id(id))
        .cloned()
        .collect()
}

async fn records_in(
    tx: &mut Tx,
    s: &Scope,
    task_id: &str,
    query: &RecordQuery,
) -> Result<RecordsNow, ReadingError> {
    let mut now = RecordsNow::default();
    let bind4 = |q: &'static str| {
        sqlx::query(q)
            .bind(s.organisation_id.clone())
            .bind(s.client_id.clone())
            .bind(s.engagement_id.clone())
            .bind(task_id.to_string())
    };
    let evaluations = ids(&query.evaluations);
    if !evaluations.is_empty() {
        let rows = bind4("SELECT id,digest,subject,basis_id,criterion_id,head_id,verdict,origin,review FROM public.work_product_heads($1,$2,$3,$4,$5)")
            .bind(&evaluations)
            .fetch_all(&mut **tx)
            .await
            .map_err(unavailable)?;
        for row in &rows {
            let t = |n: &str| row.try_get::<String, _>(n).map_err(unavailable);
            let verdict: String = t("verdict")?;
            now.heads.push(HeadNow {
                id: t("id")?,
                digest: t("digest")?,
                subject: row.try_get("subject").map_err(unavailable)?,
                basis_id: t("basis_id")?,
                criterion_id: t("criterion_id")?,
                head_id: t("head_id")?,
                verdict: match verdict.as_str() {
                    "none" => None,
                    v => Some(Verdict::parse(v).ok_or(ReadingError::Unavailable)?),
                },
                origin: EffectiveOrigin::parse(&t("origin")?).ok_or(ReadingError::Unavailable)?,
                review: ReviewState::parse(&t("review")?).ok_or(ReadingError::Unavailable)?,
            });
        }
    }
    let summaries = ids(&query.summaries);
    if !summaries.is_empty() {
        let rows = bind4("SELECT id,kind,digest,summary,conclusion,superseded FROM public.work_product_summaries($1,$2,$3,$4,$5)")
            .bind(&summaries)
            .fetch_all(&mut **tx)
            .await
            .map_err(unavailable)?;
        for row in &rows {
            let t = |n: &str| row.try_get::<String, _>(n).map_err(unavailable);
            let document: Value = row.try_get("summary").map_err(unavailable)?;
            let summary = match crate::work::json_value(&document) {
                Some(JsonValue::Object(map)) => summary_from(&map),
                _ => None,
            }
            .ok_or(ReadingError::Unavailable)?;
            now.summaries.push(SummaryNow {
                id: t("id")?,
                kind: RecordKind::parse(&t("kind")?).ok_or(ReadingError::Unavailable)?,
                digest: t("digest")?,
                summary,
                conclusion: Conclusion::parse(&t("conclusion")?)
                    .ok_or(ReadingError::Unavailable)?,
                superseded: row.try_get("superseded").map_err(unavailable)?,
            });
        }
    }
    let facts = ids(&query.facts);
    if !facts.is_empty() {
        let rows = bind4("SELECT id,digest,value,unit,subject,supported,superseded FROM public.work_product_facts($1,$2,$3,$4,$5)")
            .bind(&facts)
            .fetch_all(&mut **tx)
            .await
            .map_err(unavailable)?;
        let sources: Vec<(String, String, String)> = bind4("SELECT s.fact_id, s.original_id, s.original_sha256 FROM public.assessment_fact_sources s JOIN public.assessment_facts f ON (f.organisation_id,f.client_id,f.engagement_id,f.id)=(s.organisation_id,s.client_id,s.engagement_id,s.fact_id) WHERE (s.organisation_id,s.client_id,s.engagement_id)=($1,$2,$3) AND f.task_id=$4 AND s.fact_id = ANY($5) AND s.verification='verified' ORDER BY s.fact_id COLLATE \"C\", s.ordinal")
            .bind(&facts)
            .fetch_all(&mut **tx)
            .await
            .map_err(unavailable)?
            .iter()
            .map(|row| {
                Ok((
                    row.try_get("fact_id").map_err(unavailable)?,
                    row.try_get("original_id").map_err(unavailable)?,
                    row.try_get("original_sha256").map_err(unavailable)?,
                ))
            })
            .collect::<Result<_, ReadingError>>()?;
        for row in &rows {
            let id: String = row.try_get("id").map_err(unavailable)?;
            let of: Vec<(String, String)> = sources
                .iter()
                .filter(|(f, _, _)| *f == id)
                .map(|(_, o, sha)| (o.clone(), sha.clone()))
                .collect();
            now.facts.push(FactNow {
                id,
                digest: row.try_get("digest").map_err(unavailable)?,
                value: row.try_get("value").map_err(unavailable)?,
                unit: row.try_get("unit").map_err(unavailable)?,
                subject: row.try_get("subject").map_err(unavailable)?,
                supported: row.try_get("supported").map_err(unavailable)?,
                superseded: row.try_get("superseded").map_err(unavailable)?,
                sources: of,
            });
        }
    }
    let exceptions = ids(&query.exceptions);
    if !exceptions.is_empty() {
        let rows = bind4("SELECT s.id, x.task_id, s.criterion_root, s.subject, s.status FROM public.assessment_exception_statuses($1,$2,$3,$4,$5) s JOIN public.assessment_exceptions x ON (x.organisation_id,x.client_id,x.engagement_id,x.id)=($1,$2,$3,s.id) AND x.task_id=$4")
            .bind(&exceptions)
            .fetch_all(&mut **tx)
            .await
            .map_err(unavailable)?;
        for row in &rows {
            let t = |n: &str| row.try_get::<String, _>(n).map_err(unavailable);
            now.exceptions.push(ExceptionNow {
                id: t("id")?,
                task_id: t("task_id")?,
                root: t("criterion_root")?,
                subject: t("subject")?,
                status: ExceptionStatus::parse(&t("status")?).ok_or(ReadingError::Unavailable)?,
            });
        }
    }
    let bases = ids(&query.bases);
    if !bases.is_empty() {
        let rows = bind4("WITH b AS MATERIALIZED (SELECT k.id, k.digest, k.period_from::text || '/' || k.period_to::text AS period, k.document->'limitations' AS limitations, k.document->'criteria' AS criteria FROM public.assessment_bases k WHERE (k.organisation_id,k.client_id,k.engagement_id,k.task_id)=($1,$2,$3,$4) AND k.id = ANY($5)),
           r AS MATERIALIZED (SELECT DISTINCT b.id AS basis_id, public.assessment_criterion_root($1,$2,$3,c.value) AS root FROM b CROSS JOIN LATERAL jsonb_array_elements_text(b.criteria) c(value)),
           s AS MATERIALIZED (SELECT x.criterion_root, x.status FROM public.assessment_exception_statuses($1,$2,$3,$4,NULL) x WHERE EXISTS(SELECT 1 FROM b))
           SELECT b.id, b.digest, b.period, b.limitations,
             EXISTS(SELECT 1 FROM public.assessment_bases n WHERE (n.organisation_id,n.client_id,n.engagement_id)=($1,$2,$3) AND n.supersedes=b.id) AS superseded,
             (SELECT count(*) FROM s JOIN r ON r.root=s.criterion_root AND r.basis_id=b.id WHERE s.status='open') AS open,
             (SELECT count(*) FROM s JOIN r ON r.root=s.criterion_root AND r.basis_id=b.id WHERE s.status='resolved_by_evidence') AS resolved,
             (SELECT count(*) FROM s JOIN r ON r.root=s.criterion_root AND r.basis_id=b.id WHERE s.status='replaced_by_human_judgment') AS replaced,
             (SELECT count(*) FROM s JOIN r ON r.root=s.criterion_root AND r.basis_id=b.id WHERE s.status='closed_by_disposition') AS closed
           FROM b")
            .bind(&bases)
            .fetch_all(&mut **tx)
            .await
            .map_err(unavailable)?;
        for row in &rows {
            let limitations: Value = row.try_get("limitations").map_err(unavailable)?;
            let n = |name: &str| -> Result<u64, ReadingError> {
                Ok(row.try_get::<i64, _>(name).map_err(unavailable)? as u64)
            };
            now.bases.push(BasisNow {
                id: row.try_get("id").map_err(unavailable)?,
                digest: row.try_get("digest").map_err(unavailable)?,
                period: row.try_get("period").map_err(unavailable)?,
                limitations: limitations
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                exceptions: [n("open")?, n("resolved")?, n("replaced")?, n("closed")?],
                superseded: row.try_get("superseded").map_err(unavailable)?,
            });
        }
    }
    let originals = ids(&query.originals);
    if !originals.is_empty() {
        let corrected: Vec<String> = sqlx::query_scalar("SELECT DISTINCT c.original_id FROM public.knowledge_source_corrections c WHERE (c.organisation_id,c.client_id,c.engagement_id)=($1,$2,$3) AND c.original_id = ANY($4)")
            .bind(&s.organisation_id)
            .bind(&s.client_id)
            .bind(&s.engagement_id)
            .bind(&originals)
            .fetch_all(&mut **tx)
            .await
            .map_err(unavailable)?;
        now.corrected.extend(corrected);
    }
    Ok(now)
}

async fn current_in(
    tx: &mut Tx,
    s: &Scope,
    task_id: &str,
    versions: &[String],
) -> Result<Vec<CurrentRow>, ReadingError> {
    let versions: Vec<&String> = versions.iter().filter(|v| valid_version_id(v)).collect();
    if versions.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query("SELECT version_id,block_id,ordinal,head_id,verdict,origin,review,superseded,status,registered FROM public.work_product_current($1,$2,$3,$4,$5)")
        .bind(&s.organisation_id)
        .bind(&s.client_id)
        .bind(&s.engagement_id)
        .bind(task_id)
        .bind(&versions)
        .fetch_all(&mut **tx)
        .await
        .map_err(unavailable)?;
    rows.iter()
        .map(|row| {
            Ok(CurrentRow {
                version_id: row.try_get("version_id").map_err(unavailable)?,
                block_id: row.try_get("block_id").map_err(unavailable)?,
                ordinal: row.try_get::<i32, _>("ordinal").map_err(unavailable)? as u32,
                head_id: row.try_get("head_id").map_err(unavailable)?,
                verdict: row.try_get("verdict").map_err(unavailable)?,
                origin: row.try_get("origin").map_err(unavailable)?,
                review: row.try_get("review").map_err(unavailable)?,
                superseded: row.try_get("superseded").map_err(unavailable)?,
                status: row.try_get("status").map_err(unavailable)?,
                registered: row.try_get("registered").map_err(unavailable)?,
            })
        })
        .collect()
}

/// The block and assertion rows of a version, as the tables hold them.
fn rows_of(version: &Version, actor: &str) -> (Value, Value) {
    let mut blocks = Vec::new();
    let mut assertions = Vec::new();
    for (ordinal, b) in version.blocks.iter().enumerate() {
        let (label, body, record) = match &b.content {
            Content::Heading { text } => (None, Some(text.clone()), None),
            Content::Narrative { label, text } => (Some(label.as_str()), Some(text.clone()), None),
            Content::Claim { statement, .. } => (None, Some(statement.clone()), None),
            Content::Coverage { summary_id } => (None, None, Some(summary_id.clone())),
            Content::Exceptions { basis_id } => (None, None, Some(basis_id.clone())),
            Content::Limitations => (None, None, None),
        };
        blocks.push(json!({
            "actor_id": actor, "ordinal": ordinal, "block_id": b.id, "section_id": b.section,
            "kind": b.content.kind().as_str(), "label": label, "body": body, "record_id": record,
            "author_kind": b.author.kind().as_str(), "author_id": b.author.id(),
            "authored_in_version": b.authored_in,
        }));
        if let Content::Claim { pins, .. } = &b.content {
            for (i, p) in pins.iter().enumerate() {
                assertions.push(json!({
                    "actor_id": actor, "block_id": b.id, "ordinal": i, "kind": p.kind.as_str(),
                    "record_kind": p.record_kind.as_str(), "record_id": p.record_id,
                    "record_digest": p.record_digest, "measure": p.measure.map(|m| m.as_str()),
                    "criterion_id": p.criterion_id, "value": p.value,
                    "origin": p.origin.map(|o| o.as_str()), "review": p.review.map(|r| r.as_str()),
                    "locator": p.locator.as_ref().map(|l| l.render()), "unit": p.unit,
                    "subject": p.subject,
                }));
            }
        }
    }
    (Value::Array(blocks), Value::Array(assertions))
}

/// What a refused version write means, by the guard's words.
fn write_error(error: sqlx::Error) -> WriteError {
    match &error {
        sqlx::Error::Database(database) => {
            let message = database.message();
            if let Some(head) =
                message.strip_prefix("a work-product version edits its product's latest version: ")
            {
                return WriteError::StaleBase(head.to_string());
            }
            match database.code().as_deref() {
                // Two writers of one product at once: the loser's base is
                // stale (one successor per version).
                Some("23505") if message.contains("predecessor") => {
                    WriteError::StaleBase(String::new())
                }
                Some("23514" | "23505" | "23503") => WriteError::Refused,
                Some("57014") => WriteError::Reading(ReadingError::Capacity),
                _ => WriteError::Reading(ReadingError::Unavailable),
            }
        }
        _ => WriteError::Reading(ReadingError::Unavailable),
    }
}

/// Insert a version with its blocks and assertions (and, for a new product,
/// the product first) in this transaction. The completeness check is
/// deferred to commit.
async fn insert_version(
    tx: &mut Tx,
    s: &Scope,
    actor: &str,
    product: Option<&ProductRecord>,
    version: &Version,
) -> Result<(), WriteError> {
    sqlx::query("SET CONSTRAINTS public.work_product_complete DEFERRED")
        .execute(&mut **tx)
        .await
        .map_err(|_| WriteError::Reading(ReadingError::Unavailable))?;
    if let Some(p) = product {
        let t = &p.template;
        sqlx::query("INSERT INTO public.work_products(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,id,binding_id,template_id,template_version,template_source,template_neutral,template_name,sections) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&p.task_id).bind(&p.cycle_id).bind(actor).bind(&p.invocation_id).bind(&p.id)
            .bind(&t.binding_id).bind(&t.id).bind(&t.version).bind(&t.source_version_id)
            .bind(t.neutral).bind(&t.name).bind(sections_json(&t.sections))
            .execute(&mut **tx).await.map_err(write_error)?;
    }
    let document = version.document();
    let (invocation, cycle) = match &version.author {
        zobba_domain::work_product::Author::Agent { invocation_id } => {
            (Some(invocation_id.clone()), version.cycle_id.clone())
        }
        zobba_domain::work_product::Author::Human { .. } => (None, None),
    };
    sqlx::query("INSERT INTO public.work_product_versions(organisation_id,client_id,engagement_id,task_id,actor_id,product_id,id,version,predecessor_id,author_kind,author_id,invocation_id,cycle_id,key,title,kind,methodology_binding_id,execution_epoch,blocks,claims,missing_required,document,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
        .bind(&version.task_id).bind(actor).bind(&version.product_id).bind(&version.id)
        .bind(version.number as i32).bind(&version.predecessor)
        .bind(version.author.kind().as_str()).bind(version.author.id())
        .bind(&invocation).bind(&cycle).bind(&version.key)
        .bind(&version.title).bind(version.kind.as_str())
        .bind(&version.methodology_binding_id).bind(version.execution_epoch as i64)
        .bind(version.blocks.len() as i32).bind(version.claims().count() as i32)
        .bind(&version.missing_required)
        .bind(to_json(&document)).bind(document_digest(&document))
        .execute(&mut **tx).await.map_err(write_error)?;
    let (blocks, assertions) = rows_of(version, actor);
    // One statement each: the statement-level checks see every row at once.
    sqlx::query("INSERT INTO public.work_product_blocks(organisation_id,client_id,engagement_id,task_id,actor_id,version_id,ordinal,block_id,section_id,kind,label,body,record_id,author_kind,author_id,authored_in_version)
       SELECT $1,$2,$3,$4,x.actor_id,$5,x.ordinal,x.block_id,x.section_id,x.kind,x.label,x.body,x.record_id,x.author_kind,x.author_id,x.authored_in_version
       FROM jsonb_to_recordset($6) AS x(actor_id text, ordinal integer, block_id text, section_id text, kind text, label text, body text, record_id text, author_kind text, author_id text, authored_in_version text)")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
        .bind(&version.task_id).bind(&version.id).bind(&blocks)
        .execute(&mut **tx).await.map_err(write_error)?;
    if assertions.as_array().is_some_and(|a| !a.is_empty()) {
        sqlx::query("INSERT INTO public.work_product_assertions(organisation_id,client_id,engagement_id,task_id,actor_id,version_id,block_id,ordinal,kind,record_kind,record_id,record_digest,measure,criterion_id,value,origin,review,locator,unit,subject)
           SELECT $1,$2,$3,$4,x.actor_id,$5,x.block_id,x.ordinal,x.kind,x.record_kind,x.record_id,x.record_digest,x.measure,x.criterion_id,x.value,x.origin,x.review,x.locator,x.unit,x.subject
           FROM jsonb_to_recordset($6) AS x(actor_id text, block_id text, ordinal integer, kind text, record_kind text, record_id text, record_digest text, measure text, criterion_id text, value text, origin text, review text, locator text, unit text, subject text)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id)
            .bind(&version.task_id).bind(&version.id).bind(&assertions)
            .execute(&mut **tx).await.map_err(write_error)?;
    }
    Ok(())
}

async fn stored_version(tx: &mut Tx, id: &str) -> Result<VersionRecord, ReadingError> {
    let row = sqlx::query(&format!("{VERSION_SELECT} WHERE v.id=$1"))
        .bind(id)
        .fetch_one(&mut **tx)
        .await
        .map_err(unavailable)?;
    version_from(&row)
}

/// An applied Guide command of a Task with its author's label.
const GUIDE_SELECT: &str = "SELECT c.id, c.author_id, i.display_name, c.content FROM public.task_commands c LEFT JOIN public.identities i ON i.id=c.author_id WHERE c.kind='guide' AND c.target_task_id=$1 AND EXISTS(SELECT 1 FROM public.task_events e WHERE e.command_id=c.id AND e.kind='applied')";

fn guide_from(row: &PgRow) -> Result<GuideRequest, ReadingError> {
    Ok(GuideRequest {
        command_id: row.try_get("id").map_err(unavailable)?,
        author_id: row.try_get("author_id").map_err(unavailable)?,
        label: row.try_get("display_name").map_err(unavailable)?,
        content: row
            .try_get::<Option<String>, _>("content")
            .map_err(unavailable)?
            .ok_or(ReadingError::Unavailable)?,
    })
}

const PROPOSAL_SELECT: &str = "SELECT p.id, p.task_id, p.cycle_id, p.invocation_id, p.product_id, p.base_version_id, p.version_id, p.requested_by, p.request_id, p.changes, p.document, p.digest, p.created_us, d.id AS decision_id, d.actor_id AS decision_actor, d.key AS decision_key, d.decision, d.created_us AS decision_us FROM public.work_product_proposals p LEFT JOIN public.work_product_proposal_decisions d ON (d.organisation_id,d.client_id,d.engagement_id,d.proposal_id)=(p.organisation_id,p.client_id,p.engagement_id,p.id)";

fn proposal_from(row: &PgRow) -> Result<ProposalState, ReadingError> {
    let t = |n: &str| row.try_get::<String, _>(n).map_err(unavailable);
    let document: Value = row.try_get("document").map_err(unavailable)?;
    let digest = t("digest")?;
    let document = crate::work::json_value(&document).ok_or(ReadingError::Unavailable)?;
    if document_digest(&document) != digest {
        return Err(ReadingError::Unavailable);
    }
    let version = Version::from_document(&document).ok_or(ReadingError::Unavailable)?;
    let changes: Value = row.try_get("changes").map_err(unavailable)?;
    let changes = changes
        .as_array()
        .ok_or(ReadingError::Unavailable)?
        .iter()
        .map(|c| {
            Some((
                c.get("block_id")?.as_str()?.to_string(),
                ChangeKind::parse(c.get("change")?.as_str()?)?,
            ))
        })
        .collect::<Option<Vec<_>>>()
        .ok_or(ReadingError::Unavailable)?;
    let proposal = ProposalRecord {
        id: t("id")?,
        task_id: t("task_id")?,
        cycle_id: t("cycle_id")?,
        invocation_id: t("invocation_id")?,
        product_id: t("product_id")?,
        base_version_id: t("base_version_id")?,
        requested_by: t("requested_by")?,
        request_id: t("request_id")?,
        changes,
        version,
        recorded_us: Some(row.try_get("created_us").map_err(unavailable)?),
    };
    if proposal.version.id != t("version_id")? || proposal.version.product_id != proposal.product_id
    {
        return Err(ReadingError::Unavailable);
    }
    let decision = match row
        .try_get::<Option<String>, _>("decision_id")
        .map_err(unavailable)?
    {
        None => None,
        Some(id) => Some(DecisionRecord {
            id,
            proposal_id: proposal.id.clone(),
            task_id: proposal.task_id.clone(),
            actor_id: t("decision_actor")?,
            key: t("decision_key")?,
            confirmed: t("decision")? == "confirmed",
            recorded_us: Some(row.try_get("decision_us").map_err(unavailable)?),
        }),
    };
    Ok(ProposalState { proposal, decision })
}

const DECISION_SELECT: &str = "SELECT d.id, d.proposal_id, d.task_id, d.actor_id, d.key, d.decision, d.created_us FROM public.work_product_proposal_decisions d";

fn decision_from(row: &PgRow) -> Result<DecisionRecord, EditError> {
    let t = |n: &str| {
        row.try_get::<String, _>(n)
            .map_err(|_| EditError::Unavailable)
    };
    Ok(DecisionRecord {
        id: t("id")?,
        proposal_id: t("proposal_id")?,
        task_id: t("task_id")?,
        actor_id: t("actor_id")?,
        key: t("key")?,
        confirmed: t("decision")? == "confirmed",
        recorded_us: Some(
            row.try_get("created_us")
                .map_err(|_| EditError::Unavailable)?,
        ),
    })
}

impl WorkProductStore for AssessmentRepository {
    async fn invocation_version(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<Option<VersionRecord>, ReadingError> {
        if !valid_scope_id(invocation_id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = sqlx::query(&format!(
            "{VERSION_SELECT} WHERE v.task_id=$1 AND v.invocation_id=$2"
        ))
        .bind(&basis.task_id)
        .bind(invocation_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?
        .as_ref()
        .map(version_from)
        .transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn products(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
    ) -> Result<Vec<ProductHead>, ReadingError> {
        if !valid_scope_id(task_id) {
            return Ok(Vec::new());
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found = products_in(&mut tx, task_id, None).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn product(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        product_id: &str,
    ) -> Result<Option<ProductHead>, ReadingError> {
        if !valid_scope_id(task_id) || !valid_product_id(product_id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found = products_in(&mut tx, task_id, Some(product_id)).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found.into_iter().next())
    }
    async fn version(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        version_id: &str,
    ) -> Result<Option<VersionRecord>, ReadingError> {
        if !valid_scope_id(task_id) || !valid_version_id(version_id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found = sqlx::query(&format!("{VERSION_SELECT} WHERE v.task_id=$1 AND v.id=$2"))
            .bind(task_id)
            .bind(version_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .as_ref()
            .map(version_from)
            .transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn records(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        query: &RecordQuery,
    ) -> Result<RecordsNow, ReadingError> {
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found = records_in(&mut tx, scope, task_id, query).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn current(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        version_ids: &[String],
    ) -> Result<Vec<CurrentRow>, ReadingError> {
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found = current_in(&mut tx, scope, task_id, version_ids).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn record_agent(
        &self,
        basis: &ClaimBasis,
        product: Option<&ProductRecord>,
        version: &Version,
    ) -> Result<VersionRecord, WriteError> {
        if !version.is_valid() || version.task_id != basis.task_id {
            return Err(WriteError::Reading(ReadingError::Invalid));
        }
        let mut tx = claimed(
            &self.pool,
            basis,
            &format!("work_product:{}", basis.task_id),
        )
        .await?;
        insert_version(&mut tx, &basis.scope, &basis.actor_id, product, version).await?;
        let stored = stored_version(&mut tx, &version.id).await?;
        tx.commit().await.map_err(write_error)?;
        Ok(stored)
    }
    async fn labels(
        &self,
        actor: &str,
        scope: &Scope,
        ids: &[String],
    ) -> Result<BTreeMap<String, String>, ReadingError> {
        if ids.is_empty() {
            return Ok(BTreeMap::new());
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found: Vec<(String, String)> =
            sqlx::query_as("SELECT id, display_name FROM public.identities WHERE id = ANY($1)")
                .bind(ids)
                .fetch_all(&mut *tx)
                .await
                .map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found.into_iter().collect())
    }
    async fn guide_requests(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
    ) -> Result<Vec<GuideRequest>, ReadingError> {
        if !valid_scope_id(task_id) {
            return Ok(Vec::new());
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let rows = sqlx::query(&format!(
            "{GUIDE_SELECT} ORDER BY c.received_cursor DESC LIMIT $2"
        ))
        .bind(task_id)
        .bind(zobba_application::work_product::MAX_GUIDE_REQUESTS as i64)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
        let found = rows.iter().map(guide_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn guide_request(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        command_id: &str,
    ) -> Result<Option<GuideRequest>, ReadingError> {
        if !valid_scope_id(task_id) || !valid_scope_id(command_id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found = sqlx::query(&format!("{GUIDE_SELECT} AND c.id=$2"))
            .bind(task_id)
            .bind(command_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .as_ref()
            .map(guide_from)
            .transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn invocation_proposal(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<Option<ProposalRecord>, ReadingError> {
        if !valid_scope_id(invocation_id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, &basis.actor_id, &basis.scope).await?;
        let found = sqlx::query(&format!(
            "{PROPOSAL_SELECT} WHERE p.task_id=$1 AND p.invocation_id=$2"
        ))
        .bind(&basis.task_id)
        .bind(invocation_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?
        .as_ref()
        .map(proposal_from)
        .transpose()?
        .map(|s| s.proposal);
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn record_proposal(
        &self,
        basis: &ClaimBasis,
        proposal: &ProposalRecord,
    ) -> Result<ProposalRecord, WriteError> {
        if !proposal.version.is_valid()
            || proposal.task_id != basis.task_id
            || !valid_proposal_id(&proposal.id)
            || proposal.changes.is_empty()
        {
            return Err(WriteError::Reading(ReadingError::Invalid));
        }
        let mut tx = claimed(
            &self.pool,
            basis,
            &format!("work_product:{}", basis.task_id),
        )
        .await?;
        let document = proposal.version.document();
        let changes = Value::Array(
            proposal
                .changes
                .iter()
                .map(|(block, kind)| json!({"block_id": block, "change": kind.as_str()}))
                .collect(),
        );
        sqlx::query("INSERT INTO public.work_product_proposals(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,id,product_id,base_version_id,version_id,requested_by,request_id,changes,document,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
            .bind(&basis.scope.organisation_id).bind(&basis.scope.client_id).bind(&basis.scope.engagement_id)
            .bind(&proposal.task_id).bind(&proposal.cycle_id).bind(&basis.actor_id)
            .bind(&proposal.invocation_id).bind(&proposal.id).bind(&proposal.product_id)
            .bind(&proposal.base_version_id).bind(&proposal.version.id)
            .bind(&proposal.requested_by).bind(&proposal.request_id)
            .bind(&changes).bind(to_json(&document)).bind(document_digest(&document))
            .execute(&mut *tx).await.map_err(write_error)?;
        let stored = sqlx::query(&format!("{PROPOSAL_SELECT} WHERE p.id=$1"))
            .bind(&proposal.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let stored = proposal_from(&stored)?.proposal;
        tx.commit().await.map_err(write_error)?;
        Ok(stored)
    }
    async fn proposals(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        base_version_id: &str,
    ) -> Result<Vec<ProposalState>, ReadingError> {
        if !valid_scope_id(task_id) || !valid_version_id(base_version_id) {
            return Ok(Vec::new());
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let rows = sqlx::query(&format!(
            "{PROPOSAL_SELECT} WHERE p.task_id=$1 AND p.base_version_id=$2 ORDER BY p.id COLLATE \"C\" LIMIT 16"
        ))
        .bind(task_id)
        .bind(base_version_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
        let found = rows.iter().map(proposal_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
    async fn proposal(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        proposal_id: &str,
    ) -> Result<Option<ProposalState>, ReadingError> {
        if !valid_scope_id(task_id) || !valid_proposal_id(proposal_id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found = sqlx::query(&format!("{PROPOSAL_SELECT} WHERE p.task_id=$1 AND p.id=$2"))
            .bind(task_id)
            .bind(proposal_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .as_ref()
            .map(proposal_from)
            .transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(found)
    }
}

// --------------------------------------------------------------- people

fn edit_denied(error: TaskError) -> EditError {
    match error {
        TaskError::Denied | TaskError::Fenced => EditError::Denied,
        _ => EditError::Unavailable,
    }
}
fn export_denied(error: TaskError) -> ExportError {
    match error {
        TaskError::Denied | TaskError::Fenced => ExportError::Denied,
        _ => ExportError::Unavailable,
    }
}
fn edit_error(error: WriteError) -> EditError {
    match error {
        WriteError::StaleBase(head) => EditError::StaleBase(head),
        WriteError::Refused => EditError::Refused(Vec::new()),
        WriteError::Reading(e) => e.into(),
    }
}

/// The exact session and a current Auditor or Audit manager assignment.
async fn person_fence(tx: &mut Tx, actor: &str, s: &Scope, session: &str) -> Result<(), TaskError> {
    task::admission_fence(tx, actor, s, Some(session)).await
}

async fn edit_basis_in(
    tx: &mut Tx,
    s: &Scope,
    task_id: &str,
) -> Result<Option<EditBasis>, EditError> {
    let row: Option<(Option<String>, i64)> = sqlx::query_as("SELECT public.work_product_binding($1,$2,$3,$4), t.execution_epoch FROM public.tasks t WHERE t.id=$4")
        .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(task_id)
        .fetch_optional(&mut **tx).await.map_err(|_| EditError::Unavailable)?;
    Ok(match row {
        Some((Some(binding), epoch)) if epoch > 0 => Some(EditBasis {
            methodology_binding_id: binding,
            execution_epoch: epoch as u64,
        }),
        Some(_) => return Err(EditError::Unavailable),
        None => None,
    })
}

const EXPORT_SELECT: &str = "SELECT id,key,renderer,actor_id,task_id,version_id,format,withheld_digest,digest,size,namespace,object_version,refresh_count,created_us FROM public.work_product_exports";

fn export_from(row: &PgRow) -> Result<ExportRecord, ExportError> {
    let t = |n: &str| {
        row.try_get::<String, _>(n)
            .map_err(|_| ExportError::Unavailable)
    };
    Ok(ExportRecord {
        id: t("id")?,
        key: t("key")?,
        renderer: t("renderer")?,
        actor_id: t("actor_id")?,
        task_id: t("task_id")?,
        version_id: t("version_id")?,
        format: ExportFormat::parse(&t("format")?).ok_or(ExportError::Unavailable)?,
        withheld_digest: t("withheld_digest")?,
        digest: t("digest")?,
        size: row
            .try_get::<i64, _>("size")
            .map_err(|_| ExportError::Unavailable)? as u64,
        namespace: t("namespace")?,
        object_version: t("object_version")?,
        refresh_count: row
            .try_get::<i32, _>("refresh_count")
            .map_err(|_| ExportError::Unavailable)? as u32,
        recorded_us: Some(
            row.try_get("created_us")
                .map_err(|_| ExportError::Unavailable)?,
        ),
    })
}

impl WorkProductPeople for AssessmentRepository {
    async fn edit_basis(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        task_id: &str,
    ) -> Result<EditBasis, EditError> {
        let mut tx = scoped(&self.pool, actor, scope).await?;
        person_fence(&mut tx, actor, scope, session_hash)
            .await
            .map_err(edit_denied)?;
        let found = edit_basis_in(&mut tx, scope, task_id).await?;
        tx.commit().await.map_err(|_| EditError::Unavailable)?;
        found.ok_or(EditError::NotFound)
    }
    async fn version_by_key(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        key: &str,
    ) -> Result<Option<VersionRecord>, EditError> {
        let mut tx = scoped(&self.pool, actor, scope).await?;
        // A replay is answered only to a person who may edit now, in this
        // exact session.
        person_fence(&mut tx, actor, scope, session_hash)
            .await
            .map_err(edit_denied)?;
        let found = sqlx::query(&format!(
            "{VERSION_SELECT} WHERE v.actor_id=$1 AND v.key=$2 AND v.author_kind='human'"
        ))
        .bind(actor)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| EditError::Unavailable)?
        .as_ref()
        .map(version_from)
        .transpose()?;
        tx.commit().await.map_err(|_| EditError::Unavailable)?;
        Ok(found)
    }
    async fn record_person(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        version: &Version,
    ) -> Result<VersionRecord, EditError> {
        if !version.is_valid()
            || !matches!(&version.author, zobba_domain::work_product::Author::Human { actor_id } if actor_id == actor)
        {
            return Err(EditError::Invalid);
        }
        let mut tx = task::lock(&self.pool, actor, scope)
            .await
            .map_err(edit_denied)?;
        person_fence(&mut tx, actor, scope, session_hash)
            .await
            .map_err(edit_denied)?;
        // The guard requires this person's own live session for the write
        // transaction only: a worker connection holds none.
        sqlx::query("SELECT set_config('zobba.session_hash',$1,true)")
            .bind(session_hash)
            .execute(&mut *tx)
            .await
            .map_err(|_| EditError::Unavailable)?;
        if let Err(error) = insert_version(&mut tx, scope, actor, None, version).await {
            drop(tx);
            // Two first writes of one key at once: answer the winner.
            if error == WriteError::Refused
                && let Some(found) = self
                    .version_by_key(
                        actor,
                        scope,
                        session_hash,
                        version.key.as_deref().unwrap_or(""),
                    )
                    .await?
            {
                return if found.version == *version {
                    Ok(found)
                } else {
                    Err(EditError::Conflict)
                };
            }
            return Err(edit_error(error));
        }
        let stored = stored_version(&mut tx, &version.id).await?;
        tx.commit().await.map_err(|e| edit_error(write_error(e)))?;
        Ok(stored)
    }
    async fn export_by_key(
        &self,
        actor: &str,
        scope: &Scope,
        key: &str,
    ) -> Result<Option<ExportRecord>, ExportError> {
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found = sqlx::query(&format!("{EXPORT_SELECT} WHERE actor_id=$1 AND key=$2"))
            .bind(actor)
            .bind(key)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| ExportError::Unavailable)?
            .as_ref()
            .map(export_from)
            .transpose()?;
        tx.commit().await.map_err(|_| ExportError::Unavailable)?;
        Ok(found)
    }
    async fn export(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        export_id: &str,
    ) -> Result<Option<ExportRecord>, ExportError> {
        if !valid_export_id(export_id) || !valid_scope_id(task_id) {
            return Ok(None);
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let found = sqlx::query(&format!("{EXPORT_SELECT} WHERE task_id=$1 AND id=$2"))
            .bind(task_id)
            .bind(export_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| ExportError::Unavailable)?
            .as_ref()
            .map(export_from)
            .transpose()?;
        tx.commit().await.map_err(|_| ExportError::Unavailable)?;
        Ok(found)
    }
    async fn record_export(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        record: &ExportRecord,
    ) -> Result<ExportRecord, ExportError> {
        if record.actor_id != actor || !valid_export_id(&record.id) {
            return Err(ExportError::Invalid);
        }
        let mut tx = task::lock(&self.pool, actor, scope)
            .await
            .map_err(export_denied)?;
        person_fence(&mut tx, actor, scope, session_hash)
            .await
            .map_err(export_denied)?;
        sqlx::query("SELECT set_config('zobba.session_hash',$1,true)")
            .bind(session_hash)
            .execute(&mut *tx)
            .await
            .map_err(|_| ExportError::Unavailable)?;
        let inserted = sqlx::query("INSERT INTO public.work_product_exports(organisation_id,client_id,engagement_id,task_id,actor_id,id,key,version_id,format,renderer,withheld_digest,digest,size,namespace,object_version,refresh_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
            .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
            .bind(&record.task_id).bind(actor).bind(&record.id).bind(&record.key)
            .bind(&record.version_id).bind(record.format.as_str())
            .bind(&record.renderer)
            .bind(&record.withheld_digest).bind(&record.digest).bind(record.size as i64)
            .bind(&record.namespace).bind(&record.object_version).bind(record.refresh_count as i32)
            .execute(&mut *tx).await;
        if let Err(error) = inserted {
            let unique =
                matches!(&error, sqlx::Error::Database(d) if d.code().as_deref() == Some("23505"));
            drop(tx);
            if unique && let Some(found) = self.export_by_key(actor, scope, &record.key).await? {
                return if found.version_id == record.version_id && found.format == record.format {
                    Ok(found)
                } else {
                    Err(ExportError::Conflict)
                };
            }
            return Err(match &error {
                sqlx::Error::Database(d) if d.message().contains("assigned auditor") => {
                    ExportError::Denied
                }
                sqlx::Error::Database(d) if d.message().contains("of its own Task") => {
                    ExportError::NotFound
                }
                _ => ExportError::Unavailable,
            });
        }
        let row = sqlx::query(&format!("{EXPORT_SELECT} WHERE id=$1"))
            .bind(&record.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| ExportError::Unavailable)?;
        let stored = export_from(&row)?;
        tx.commit().await.map_err(|_| ExportError::Unavailable)?;
        Ok(stored)
    }
    async fn decision_by_key(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        key: &str,
    ) -> Result<Option<DecisionRecord>, EditError> {
        let mut tx = scoped(&self.pool, actor, scope).await?;
        person_fence(&mut tx, actor, scope, session_hash)
            .await
            .map_err(edit_denied)?;
        let found = sqlx::query(&format!(
            "{DECISION_SELECT} WHERE d.actor_id=$1 AND d.key=$2"
        ))
        .bind(actor)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| EditError::Unavailable)?
        .as_ref()
        .map(decision_from)
        .transpose()?;
        tx.commit().await.map_err(|_| EditError::Unavailable)?;
        Ok(found)
    }
    async fn record_decision(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        decision: &DecisionRecord,
        version: Option<&Version>,
    ) -> Result<(DecisionRecord, Option<VersionRecord>), EditError> {
        if decision.actor_id != actor
            || decision.confirmed != version.is_some()
            || version.is_some_and(|v| !v.is_valid())
        {
            return Err(EditError::Invalid);
        }
        let mut tx = task::lock(&self.pool, actor, scope)
            .await
            .map_err(edit_denied)?;
        person_fence(&mut tx, actor, scope, session_hash)
            .await
            .map_err(edit_denied)?;
        sqlx::query("SELECT set_config('zobba.session_hash',$1,true)")
            .bind(session_hash)
            .execute(&mut *tx)
            .await
            .map_err(|_| EditError::Unavailable)?;
        let inserted = sqlx::query("INSERT INTO public.work_product_proposal_decisions(organisation_id,client_id,engagement_id,task_id,actor_id,id,proposal_id,key,decision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id)
            .bind(&decision.task_id).bind(actor).bind(&decision.id).bind(&decision.proposal_id)
            .bind(&decision.key).bind(if decision.confirmed { "confirmed" } else { "declined" })
            .execute(&mut *tx).await;
        if let Err(error) = inserted {
            let unique =
                matches!(&error, sqlx::Error::Database(d) if d.code().as_deref() == Some("23505"));
            drop(tx);
            if unique {
                // Decided meanwhile (by this key, or the proposal by another).
                return Err(EditError::Conflict);
            }
            return Err(edit_error(write_error(error)));
        }
        let stored_version = match version {
            Some(v) => {
                insert_version(&mut tx, scope, actor, None, v)
                    .await
                    .map_err(edit_error)?;
                Some(stored_version(&mut tx, &v.id).await?)
            }
            None => None,
        };
        let row = sqlx::query(&format!("{DECISION_SELECT} WHERE d.id=$1"))
            .bind(&decision.id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| EditError::Unavailable)?;
        let stored = decision_from(&row)?;
        tx.commit().await.map_err(|e| edit_error(write_error(e)))?;
        Ok((stored, stored_version))
    }
    async fn readable(
        &self,
        actor: &str,
        scope: &Scope,
        ids: &[String],
    ) -> Result<BTreeMap<String, (String, Option<String>)>, ReadingError> {
        let ids: Vec<&String> = ids.iter().filter(|id| valid_scope_id(id)).collect();
        if ids.is_empty() {
            return Ok(BTreeMap::new());
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let rows = sqlx::query("SELECT id,(request::jsonb)->>'filename' AS filename,digest FROM public.evidence_originals WHERE id = ANY($1)")
            .bind(&ids)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
        let mut out = BTreeMap::new();
        for row in &rows {
            out.insert(
                row.try_get::<String, _>("id").map_err(unavailable)?,
                (
                    row.try_get::<String, _>("digest").map_err(unavailable)?,
                    row.try_get::<Option<String>, _>("filename")
                        .map_err(unavailable)?,
                ),
            );
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(out)
    }
}

/// One page of a shelf: products (C-ordered by ID) with their latest
/// versions, the exact total and the next cursor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShelfPage {
    pub products: Vec<ProductHead>,
    pub total: u64,
    pub next: Option<String>,
}

impl AssessmentRepository {
    /// A viewer who may read work products: a currently assigned Auditor or
    /// Audit manager of the engagement (Admin alone is not one).
    pub async fn work_product_viewer(&self, actor: &str, scope: &Scope) -> Result<(), TaskError> {
        let mut tx = scoped(&self.pool, actor, scope)
            .await
            .map_err(|e| match e {
                ReadingError::Denied | ReadingError::Fenced => TaskError::Denied,
                _ => TaskError::Unavailable,
            })?;
        task::admission_fence(&mut tx, actor, scope, None).await?;
        tx.commit().await.map_err(|_| TaskError::Unavailable)?;
        Ok(())
    }
    /// The engagement's (or one Task's) work products: an exact count and
    /// one C-ordered page of 50 after `after` (a product ID).
    pub async fn work_product_shelf(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: Option<&str>,
        after: Option<&str>,
    ) -> Result<ShelfPage, ReadingError> {
        if task_id.is_some_and(|t| !valid_scope_id(t))
            || after.is_some_and(|a| !valid_product_id(a))
        {
            return Err(ReadingError::Invalid);
        }
        let mut tx = scoped(&self.pool, actor, scope).await?;
        let page = zobba_domain::work_product::SHELF_PAGE as i64;
        // One statement: the exact count and the page share one snapshot.
        let rows = sqlx::query(&format!(
            "WITH n AS (SELECT count(*) AS total FROM public.work_products p WHERE ($1::text IS NULL OR p.task_id=$1)),
             page AS (SELECT {PRODUCT_COLUMNS} {PRODUCT_FROM} WHERE ($1::text IS NULL OR p.task_id=$1) AND ($2::text IS NULL OR p.id COLLATE \"C\" > $2::text COLLATE \"C\") ORDER BY p.id COLLATE \"C\" LIMIT $3)
             SELECT n.total, page.* FROM n LEFT JOIN page ON true ORDER BY page.product_id COLLATE \"C\""
        ))
        .bind(task_id)
        .bind(after)
        .bind(page + 1)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
        let total: i64 = match rows.first() {
            Some(row) => row.try_get("total").map_err(unavailable)?,
            None => return Err(ReadingError::Unavailable),
        };
        let mut products: Vec<ProductHead> = rows
            .iter()
            .filter(|row| {
                row.try_get::<Option<String>, _>("product_id")
                    .ok()
                    .flatten()
                    .is_some()
            })
            .map(head_from)
            .collect::<Result<_, _>>()?;
        let next = if products.len() as i64 > page {
            products.truncate(page as usize);
            products.last().map(|p| p.product.id.clone())
        } else {
            None
        };
        tx.commit().await.map_err(unavailable)?;
        Ok(ShelfPage {
            products,
            total: total as u64,
            next,
        })
    }
}
