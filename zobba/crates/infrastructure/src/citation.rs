//! Story 22.5 reading and citation facts. Every call is freshly scoped (RLS
//! under the actor's current engagement access); every record is immutable,
//! checked again by `reading_guard`, and an identical retry returns the
//! original. No SQL transaction spans model, sandbox or object I/O.
use crate::scope;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use zobba_application::{
    analysis::Descendant,
    citation::{ReadingError, StoredCitation},
    reading::{
        AnswerVerification, DocumentStatus, MAX_CONTEXT_ORIGINALS, PageImage, PageRead,
        PageRequestRecord, ProgramRun, ProgramStatus, ReadStatus, ReadingOriginal, ReadingStore,
        RenderBatch, RenderedPage, RequestOutcome,
    },
};
use zobba_domain::{
    analysis::MEDIA_TYPES,
    citation::{
        CitationSource, Locator, MAX_PAGE_REQUESTS, MAX_PROGRAM_REQUESTS, PageTranscript, Span,
        UnverifiedReason, Verification, VerifiedSource,
    },
    evidence::ContentIdentity,
    identity::{Scope, valid_scope_id},
    model::ImageMediaType,
    task::ClaimBasis,
    work::MAX_TURNS_PER_CYCLE,
};

type Tx = Transaction<'static, Postgres>;
const READING_LOCK: i64 = 2_205;

#[derive(Clone)]
pub struct CitationRepository {
    pool: PgPool,
}
impl CitationRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn unavailable(_: sqlx::Error) -> ReadingError {
    ReadingError::Unavailable
}
fn refusal(error: sqlx::Error) -> ReadingError {
    match &error {
        sqlx::Error::Database(database)
            if matches!(
                database.code().as_deref(),
                Some("23514" | "23505" | "23503")
            ) =>
        {
            ReadingError::Invalid
        }
        _ => ReadingError::Unavailable,
    }
}
fn field<T>(row: &PgRow, name: &str) -> Result<T, ReadingError>
where
    T: for<'r> sqlx::Decode<'r, Postgres> + sqlx::Type<Postgres>,
{
    row.try_get(name).map_err(unavailable)
}
async fn begin(pool: &PgPool, actor: &str, s: &Scope) -> Result<Tx, ReadingError> {
    if !valid_scope_id(actor) || !s.is_valid() {
        return Err(ReadingError::Denied);
    }
    scope::begin(pool, actor, s).await.map_err(|e| match e {
        scope::ScopeError::Denied => ReadingError::Denied,
        _ => ReadingError::Unavailable,
    })
}
/// Serialize writers of one logical record so an identical retry sees the
/// first insert rather than racing it.
async fn lock(tx: &mut Tx, key: &str) -> Result<(), ReadingError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,$2))")
        .bind(key)
        .bind(READING_LOCK)
        .execute(&mut **tx)
        .await
        .map_err(unavailable)?;
    Ok(())
}
fn static_media(value: &str) -> Option<&'static str> {
    MEDIA_TYPES
        .iter()
        .find(|(_, m)| *m == value)
        .map(|(_, m)| *m)
}
fn transcript_json(transcript: &PageTranscript) -> Value {
    json!({"text": transcript.text, "unreadable": transcript.unreadable})
}
fn transcript_from(value: &Value) -> Option<PageTranscript> {
    let object = value.as_object()?;
    if object.len() != 2 {
        return None;
    }
    let transcript = PageTranscript {
        text: object.get("text")?.as_str()?.into(),
        unreadable: object
            .get("unreadable")?
            .as_array()?
            .iter()
            .map(|v| v.as_str().map(String::from))
            .collect::<Option<_>>()?,
    };
    transcript.is_valid().then_some(transcript)
}
fn read_status(value: &str) -> Option<ReadStatus> {
    match value {
        "read" => Some(ReadStatus::Read),
        "failed" => Some(ReadStatus::Failed),
        _ => None,
    }
}
fn program_status(value: &str) -> Option<ProgramStatus> {
    match value {
        "completed" => Some(ProgramStatus::Completed),
        "failed" => Some(ProgramStatus::Failed),
        _ => None,
    }
}

async fn load_batch(
    tx: &mut Tx,
    original_id: &str,
    sha256: &str,
    batch: u32,
) -> Result<Option<RenderBatch>, ReadingError> {
    let Some(row) = sqlx::query("SELECT job_id,status,reason,page_count FROM public.document_renders WHERE original_id=$1 AND original_sha256=$2 AND batch=$3")
        .bind(original_id).bind(sha256).bind(batch as i32)
        .fetch_optional(&mut **tx).await.map_err(unavailable)?
    else {
        return Ok(None);
    };
    let pages = sqlx::query(
        "SELECT p.page,p.image_id,p.image_sha256,p.image_size,p.image_media_type,p.text_layer,p.reason,d.namespace,d.version
           FROM public.document_pages p LEFT JOIN public.analysis_descendants d ON d.id=p.image_id
          WHERE p.original_id=$1 AND p.original_sha256=$2 AND p.batch=$3 ORDER BY p.page",
    )
    .bind(original_id)
    .bind(sha256)
    .bind(batch as i32)
    .fetch_all(&mut **tx)
    .await
    .map_err(unavailable)?;
    let mut rendered = Vec::new();
    for page in &pages {
        let image_id: Option<String> = field(page, "image_id")?;
        let image = match image_id {
            None => None,
            // The page names an image whose descendant row cannot be read
            // now: a transient condition, never a smaller batch.
            Some(_) if field::<Option<String>>(page, "namespace")?.is_none() => {
                return Err(ReadingError::Unavailable);
            }
            Some(id) => Some(PageImage {
                descendant_id: id,
                sha256: field(page, "image_sha256")?,
                size: field::<i64>(page, "image_size")? as u64,
                media_type: ImageMediaType::parse(&field::<String>(page, "image_media_type")?)
                    .ok_or(ReadingError::Unavailable)?,
                namespace: field(page, "namespace")?,
                version: field(page, "version")?,
            }),
        };
        rendered.push(RenderedPage {
            page: field::<i32>(page, "page")? as u32,
            image,
            text_layer: field(page, "text_layer")?,
            reason: field(page, "reason")?,
        });
    }
    let batch = RenderBatch {
        original_id: original_id.into(),
        original_sha256: sha256.into(),
        batch,
        job_id: field(&row, "job_id")?,
        status: DocumentStatus::parse(&field::<String>(&row, "status")?)
            .ok_or(ReadingError::Unavailable)?,
        reason: field(&row, "reason")?,
        page_count: field::<i32>(&row, "page_count")? as u32,
        pages: rendered,
    };
    batch
        .is_valid()
        .then_some(Some(batch))
        .ok_or(ReadingError::Unavailable)
}

/// Bounds of the cycle-wide reads: every reading request and program run of a
/// cycle (turns are bounded) and every answer verification.
const CYCLE_REQUESTS: i64 = (MAX_TURNS_PER_CYCLE * MAX_PAGE_REQUESTS) as i64;
const CYCLE_RUNS: i64 = (MAX_TURNS_PER_CYCLE * MAX_PROGRAM_REQUESTS) as i64;
const CYCLE_ANSWERS: i64 = MAX_TURNS_PER_CYCLE as i64;
/// Outputs one job may have (the owner ceiling on output files).
const JOB_OUTPUTS: i64 = 64;

fn page_read_from(row: &PgRow) -> Result<PageRead, ReadingError> {
    let transcript: Option<Value> = field(row, "transcript")?;
    let read = PageRead {
        task_id: field(row, "task_id")?,
        cycle_id: field(row, "cycle_id")?,
        original_id: field(row, "original_id")?,
        original_sha256: field(row, "original_sha256")?,
        page: field::<i32>(row, "page")? as u32,
        attempt: field::<i32>(row, "attempt")? as u32,
        image_sha256: field(row, "image_sha256")?,
        invocation_id: field(row, "invocation_id")?,
        status: read_status(&field::<String>(row, "status")?).ok_or(ReadingError::Unavailable)?,
        transcript: match transcript {
            Some(value) => Some(transcript_from(&value).ok_or(ReadingError::Unavailable)?),
            None => None,
        },
        reason: field(row, "reason")?,
    };
    read.is_valid()
        .then_some(read)
        .ok_or(ReadingError::Unavailable)
}
fn program_run_from(row: &PgRow) -> Result<ProgramRun, ReadingError> {
    let run = ProgramRun {
        task_id: field(row, "task_id")?,
        cycle_id: field(row, "cycle_id")?,
        invocation_id: field(row, "invocation_id")?,
        index: field::<i32>(row, "ordinal")? as u32,
        job_id: field(row, "job_id")?,
        status: program_status(&field::<String>(row, "status")?)
            .ok_or(ReadingError::Unavailable)?,
        output: field(row, "output")?,
        reason: field(row, "reason")?,
        recorded_us: Some(field(row, "created_us")?),
    };
    run.is_valid()
        .then_some(run)
        .ok_or(ReadingError::Unavailable)
}
const REQUEST_COLUMNS: &str = "q.task_id AS q_task_id,q.cycle_id AS q_cycle_id,q.invocation_id AS q_invocation_id,q.ordinal AS q_ordinal,q.original_id AS q_original_id,q.page AS q_page,q.outcome AS q_outcome,q.reason AS q_reason,q.created_us AS q_created_us,r.*";
const REQUEST_JOIN: &str = "public.task_page_requests q LEFT JOIN public.task_page_reads r ON (r.organisation_id,r.client_id,r.engagement_id,r.task_id,r.original_id,r.original_sha256,r.page,r.attempt)=(q.organisation_id,q.client_id,q.engagement_id,q.task_id,q.original_id,q.read_sha256,q.page,q.read_attempt)";
fn request_from(row: &PgRow) -> Result<PageRequestRecord, ReadingError> {
    let attempt: Option<i32> = field(row, "attempt")?;
    let record = PageRequestRecord {
        task_id: field(row, "q_task_id")?,
        cycle_id: field(row, "q_cycle_id")?,
        invocation_id: field(row, "q_invocation_id")?,
        ordinal: field::<i32>(row, "q_ordinal")? as u32,
        original_id: field(row, "q_original_id")?,
        page: field::<i32>(row, "q_page")? as u32,
        outcome: RequestOutcome::parse(&field::<String>(row, "q_outcome")?)
            .ok_or(ReadingError::Unavailable)?,
        reason: field(row, "q_reason")?,
        read: match attempt {
            Some(_) => Some(page_read_from(row)?),
            None => None,
        },
        recorded_us: Some(field(row, "q_created_us")?),
    };
    record
        .is_valid()
        .then_some(record)
        .ok_or(ReadingError::Unavailable)
}

/// Stored verification of one answer, in segment and source order.
async fn load_verification(
    tx: &mut Tx,
    invocation_id: &str,
) -> Result<Option<AnswerVerification>, ReadingError> {
    let Some(row) = sqlx::query(
        "SELECT status,verified_us FROM public.answer_verifications WHERE invocation_id=$1",
    )
    .bind(invocation_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(unavailable)?
    else {
        return Ok(None);
    };
    let failed = match field::<String>(&row, "status")?.as_str() {
        "verified" => false,
        "failed" => true,
        _ => return Err(ReadingError::Unavailable),
    };
    let spans = sqlx::query("SELECT segment,span_start,span_end FROM public.answer_citations WHERE invocation_id=$1 ORDER BY segment")
        .bind(invocation_id).fetch_all(&mut **tx).await.map_err(unavailable)?;
    let sources = sqlx::query("SELECT segment,ordinal,original_id,locator,quote,original_sha256,verification,reason FROM public.citation_sources WHERE invocation_id=$1 ORDER BY segment,ordinal")
        .bind(invocation_id).fetch_all(&mut **tx).await.map_err(unavailable)?;
    let mut citations = Vec::new();
    for span in &spans {
        let segment: i32 = field(span, "segment")?;
        let mut list = Vec::new();
        for source in sources
            .iter()
            .filter(|s| s.try_get::<i32, _>("segment").ok() == Some(segment))
        {
            let locator: Option<String> = field(source, "locator")?;
            let verification = match field::<String>(source, "verification")?.as_str() {
                "verified" => Verification::Verified,
                _ => Verification::Unverified(
                    UnverifiedReason::parse(&field::<String>(source, "reason")?)
                        .ok_or(ReadingError::Unavailable)?,
                ),
            };
            list.push(VerifiedSource {
                source: CitationSource {
                    original_id: field(source, "original_id")?,
                    locator: match locator {
                        Some(text) => Some(Locator::parse(&text).ok_or(ReadingError::Unavailable)?),
                        None => None,
                    },
                    quote: field(source, "quote")?,
                },
                original_sha256: field(source, "original_sha256")?,
                verification,
            });
        }
        citations.push(StoredCitation {
            segment: segment as u32,
            span: Span {
                start: field::<i32>(span, "span_start")? as u32,
                end: field::<i32>(span, "span_end")? as u32,
            },
            sources: list,
        });
    }
    Ok(Some(AnswerVerification {
        invocation_id: invocation_id.into(),
        failed,
        citations,
        recorded_us: Some(field(&row, "verified_us")?),
    }))
}

/// An original as the current viewer may see it now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ViewerOriginal {
    pub filename: Option<String>,
    pub version: String,
    pub sha256: String,
}

impl CitationRepository {
    /// Verified answers of one Task's current cycle, oldest first, for the
    /// current viewer (RLS: their own current engagement access).
    pub async fn answers(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
    ) -> Result<Vec<AnswerVerification>, ReadingError> {
        if !valid_scope_id(task_id) {
            return Err(ReadingError::Invalid);
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT v.invocation_id FROM public.answer_verifications v JOIN public.tasks t ON (t.organisation_id,t.client_id,t.engagement_id,t.id)=(v.organisation_id,v.client_id,v.engagement_id,v.task_id) AND t.cycle_id=v.cycle_id
              WHERE v.task_id=$1 ORDER BY v.verified_us DESC, v.invocation_id COLLATE \"C\" DESC LIMIT 20",
        )
        .bind(task_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
        let mut result = Vec::new();
        for id in ids.iter().rev() {
            result.push(
                load_verification(&mut tx, id)
                    .await?
                    .ok_or(ReadingError::Unavailable)?,
            );
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }

    /// The exact originals as the current viewer may see them, in one query:
    /// absent IDs are originals the viewer cannot read now (a citation never
    /// grants source access).
    pub async fn viewer_originals(
        &self,
        actor: &str,
        s: &Scope,
        ids: &[String],
    ) -> Result<std::collections::BTreeMap<String, ViewerOriginal>, ReadingError> {
        let ids: Vec<&String> = ids.iter().filter(|id| valid_scope_id(id)).collect();
        if ids.is_empty() {
            return Ok(Default::default());
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        let rows = sqlx::query("SELECT id,(request::jsonb)->>'filename' AS filename,version,digest FROM public.evidence_originals WHERE id = ANY($1)")
            .bind(&ids).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let mut result = std::collections::BTreeMap::new();
        for row in &rows {
            result.insert(
                field::<String>(row, "id")?,
                ViewerOriginal {
                    filename: field(row, "filename")?,
                    version: field(row, "version")?,
                    sha256: field(row, "digest")?,
                },
            );
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
}

fn original_from(row: &PgRow) -> Result<ReadingOriginal, ReadingError> {
    Ok(ReadingOriginal {
        id: field(row, "id")?,
        sha256: field(row, "digest")?,
        size: field::<i64>(row, "size")? as u64,
        filename: field(row, "filename")?,
    })
}

impl ReadingStore for CitationRepository {
    async fn original(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
    ) -> Result<Option<ReadingOriginal>, ReadingError> {
        if !valid_scope_id(id) {
            return Ok(None);
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        let row = sqlx::query("SELECT id,digest,size,(request::jsonb)->>'filename' AS filename FROM public.evidence_originals WHERE id=$1")
            .bind(id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        let original = row.as_ref().map(original_from).transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(original)
    }
    async fn originals(
        &self,
        actor: &str,
        s: &Scope,
    ) -> Result<Vec<ReadingOriginal>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let rows = sqlx::query("SELECT id,digest,size,(request::jsonb)->>'filename' AS filename FROM public.evidence_originals ORDER BY registered_at DESC, id COLLATE \"C\" LIMIT $1")
            .bind((MAX_CONTEXT_ORIGINALS + 1) as i64).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let result = rows.iter().map(original_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn render_batch(
        &self,
        actor: &str,
        s: &Scope,
        original_id: &str,
        original_sha256: &str,
        batch: u32,
    ) -> Result<Option<RenderBatch>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let batch = load_batch(&mut tx, original_id, original_sha256, batch).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(batch)
    }
    async fn record_render(
        &self,
        basis: &ClaimBasis,
        batch: &RenderBatch,
    ) -> Result<RenderBatch, ReadingError> {
        if !batch.is_valid() {
            return Err(ReadingError::Invalid);
        }
        let s = &basis.scope;
        let mut tx = begin(&self.pool, &basis.actor_id, s).await?;
        lock(
            &mut tx,
            &format!("render:{}:{}", batch.original_sha256, batch.batch),
        )
        .await?;
        if let Some(existing) = load_batch(
            &mut tx,
            &batch.original_id,
            &batch.original_sha256,
            batch.batch,
        )
        .await?
        {
            // Another job may have rendered the same pages first; its facts stand.
            tx.commit().await.map_err(unavailable)?;
            return Ok(existing);
        }
        sqlx::query("INSERT INTO public.document_renders(organisation_id,client_id,engagement_id,original_id,original_sha256,batch,job_id,status,reason,page_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&batch.original_id).bind(&batch.original_sha256)
            .bind(batch.batch as i32).bind(&batch.job_id).bind(batch.status.as_str()).bind(&batch.reason).bind(batch.page_count as i32)
            .execute(&mut *tx).await.map_err(refusal)?;
        for page in &batch.pages {
            sqlx::query("INSERT INTO public.document_pages(organisation_id,client_id,engagement_id,original_id,original_sha256,batch,page,image_id,image_sha256,image_size,image_media_type,text_layer,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&batch.original_id).bind(&batch.original_sha256)
                .bind(batch.batch as i32).bind(page.page as i32)
                .bind(page.image.as_ref().map(|i| i.descendant_id.clone()))
                .bind(page.image.as_ref().map(|i| i.sha256.clone()))
                .bind(page.image.as_ref().map(|i| i.size as i64))
                .bind(page.image.as_ref().map(|i| i.media_type.as_str()))
                .bind(&page.text_layer)
                .bind(&page.reason)
                .execute(&mut *tx).await.map_err(refusal)?;
        }
        let stored = load_batch(
            &mut tx,
            &batch.original_id,
            &batch.original_sha256,
            batch.batch,
        )
        .await?
        .ok_or(ReadingError::Unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored)
    }
    async fn document_jobs(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        program_sha256: &str,
    ) -> Result<(u64, Option<String>), ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let (count, newest): (i64, Option<String>) = sqlx::query_as("SELECT count(*),(SELECT id FROM public.analysis_jobs WHERE task_id=$1 AND environment_id='document-python-3-13' AND program_sha256=$2 ORDER BY admitted_us DESC,id COLLATE \"C\" DESC LIMIT 1) FROM public.analysis_jobs WHERE task_id=$1 AND environment_id='document-python-3-13' AND program_sha256=$2")
            .bind(task_id).bind(program_sha256).fetch_one(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok((
            u64::try_from(count).map_err(|_| ReadingError::Unavailable)?,
            newest,
        ))
    }
    async fn job_failure(
        &self,
        actor: &str,
        s: &Scope,
        job_id: &str,
    ) -> Result<Option<String>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let status: Option<String> = sqlx::query_scalar("SELECT status FROM public.analysis_job_events WHERE job_id=$1 AND status IN ('failed','limit_exceeded') ORDER BY sequence DESC LIMIT 1")
            .bind(job_id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(status)
    }
    async fn job_outputs(
        &self,
        actor: &str,
        s: &Scope,
        job_id: &str,
    ) -> Result<Vec<Descendant>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let rows = sqlx::query("SELECT id,path,fold_key,media_type,digest,size,namespace,version FROM public.analysis_descendants WHERE job_id=$1 ORDER BY path COLLATE \"C\" LIMIT $2")
            .bind(job_id).bind(JOB_OUTPUTS + 1).fetch_all(&mut *tx).await.map_err(unavailable)?;
        // More descendants than any job may have: never a silently cut list.
        if rows.len() as i64 > JOB_OUTPUTS {
            return Err(ReadingError::Unavailable);
        }
        let mut result = Vec::new();
        for row in &rows {
            result.push(Descendant {
                id: field(row, "id")?,
                path: field(row, "path")?,
                fold_key: field(row, "fold_key")?,
                media_type: static_media(&field::<String>(row, "media_type")?)
                    .ok_or(ReadingError::Unavailable)?,
                identity: ContentIdentity {
                    sha256: field(row, "digest")?,
                    size: field::<i64>(row, "size")? as u64,
                },
                namespace: field(row, "namespace")?,
                version: field(row, "version")?,
            });
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn page_attempts(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        original_id: &str,
        original_sha256: &str,
        page: u32,
    ) -> Result<Vec<PageRead>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let rows = sqlx::query("SELECT * FROM public.task_page_reads WHERE task_id=$1 AND original_id=$2 AND original_sha256=$3 AND page=$4 ORDER BY attempt")
            .bind(task_id).bind(original_id).bind(original_sha256).bind(page as i32)
            .fetch_all(&mut *tx).await.map_err(unavailable)?;
        let reads = rows.iter().map(page_read_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(reads)
    }
    async fn pages_disclosed(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        original_id: &str,
    ) -> Result<u32, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let count: i64 = sqlx::query_scalar("SELECT count(DISTINCT page) FROM public.task_page_reads WHERE task_id=$1 AND original_id=$2 AND invocation_id IS NOT NULL")
            .bind(task_id).bind(original_id).fetch_one(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(count as u32)
    }
    async fn record_page_read(
        &self,
        basis: &ClaimBasis,
        read: &PageRead,
    ) -> Result<PageRead, ReadingError> {
        if !read.is_valid() || read.task_id != basis.task_id || read.cycle_id != basis.cycle_id {
            return Err(ReadingError::Invalid);
        }
        let s = &basis.scope;
        let mut tx = begin(&self.pool, &basis.actor_id, s).await?;
        lock(
            &mut tx,
            &format!(
                "read:{}:{}:{}",
                read.task_id, read.original_sha256, read.page
            ),
        )
        .await?;
        let existing = sqlx::query("SELECT * FROM public.task_page_reads WHERE task_id=$1 AND original_id=$2 AND original_sha256=$3 AND page=$4 AND attempt=$5")
            .bind(&read.task_id).bind(&read.original_id).bind(&read.original_sha256).bind(read.page as i32).bind(read.attempt as i32)
            .fetch_optional(&mut *tx).await.map_err(unavailable)?;
        if let Some(row) = existing {
            let stored = page_read_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            return if stored == *read {
                Ok(stored)
            } else {
                Err(ReadingError::Invalid)
            };
        }
        sqlx::query("INSERT INTO public.task_page_reads(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,original_id,original_sha256,page,attempt,image_sha256,invocation_id,status,transcript,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&read.task_id).bind(&read.cycle_id).bind(&basis.actor_id)
            .bind(&read.original_id).bind(&read.original_sha256).bind(read.page as i32).bind(read.attempt as i32).bind(&read.image_sha256).bind(&read.invocation_id)
            .bind(match read.status { ReadStatus::Read => "read", ReadStatus::Failed => "failed" })
            .bind(read.transcript.as_ref().map(transcript_json)).bind(&read.reason)
            .execute(&mut *tx).await.map_err(refusal)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(read.clone())
    }
    async fn page_request(
        &self,
        actor: &str,
        s: &Scope,
        invocation_id: &str,
        ordinal: u32,
    ) -> Result<Option<PageRequestRecord>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let row = sqlx::query(&format!(
            "SELECT {REQUEST_COLUMNS} FROM {REQUEST_JOIN} WHERE q.invocation_id=$1 AND q.ordinal=$2"
        ))
        .bind(invocation_id)
        .bind(ordinal as i32)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?;
        let record = row.as_ref().map(request_from).transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(record)
    }
    async fn page_requests(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        cycle_id: &str,
    ) -> Result<Vec<PageRequestRecord>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let rows = sqlx::query(&format!("SELECT {REQUEST_COLUMNS} FROM {REQUEST_JOIN} WHERE q.task_id=$1 AND q.cycle_id=$2 ORDER BY q.created_us, q.invocation_id COLLATE \"C\", q.ordinal LIMIT $3"))
            .bind(task_id).bind(cycle_id).bind(CYCLE_REQUESTS + 1).fetch_all(&mut *tx).await.map_err(unavailable)?;
        if rows.len() as i64 > CYCLE_REQUESTS {
            return Err(ReadingError::Unavailable);
        }
        let records = rows.iter().map(request_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(records)
    }
    async fn record_page_request(
        &self,
        basis: &ClaimBasis,
        request: &PageRequestRecord,
    ) -> Result<PageRequestRecord, ReadingError> {
        if !request.is_valid()
            || request.task_id != basis.task_id
            || request.cycle_id != basis.cycle_id
        {
            return Err(ReadingError::Invalid);
        }
        let s = &basis.scope;
        let mut tx = begin(&self.pool, &basis.actor_id, s).await?;
        lock(
            &mut tx,
            &format!("request:{}:{}", request.invocation_id, request.ordinal),
        )
        .await?;
        let existing = sqlx::query(&format!(
            "SELECT {REQUEST_COLUMNS} FROM {REQUEST_JOIN} WHERE q.invocation_id=$1 AND q.ordinal=$2"
        ))
        .bind(&request.invocation_id)
        .bind(request.ordinal as i32)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?;
        if let Some(row) = existing {
            let stored = request_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            let same = PageRequestRecord {
                recorded_us: None,
                ..stored.clone()
            } == PageRequestRecord {
                recorded_us: None,
                ..request.clone()
            };
            return if same {
                Ok(stored)
            } else {
                Err(ReadingError::Invalid)
            };
        }
        sqlx::query("INSERT INTO public.task_page_requests(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,original_id,page,outcome,reason,read_sha256,read_attempt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&request.task_id).bind(&request.cycle_id).bind(&basis.actor_id)
            .bind(&request.invocation_id).bind(request.ordinal as i32).bind(&request.original_id).bind(request.page as i32)
            .bind(request.outcome.as_str()).bind(&request.reason)
            .bind(request.read.as_ref().map(|r| r.original_sha256.clone()))
            .bind(request.read.as_ref().map(|r| r.attempt as i32))
            .execute(&mut *tx).await.map_err(refusal)?;
        let row = sqlx::query(&format!(
            "SELECT {REQUEST_COLUMNS} FROM {REQUEST_JOIN} WHERE q.invocation_id=$1 AND q.ordinal=$2"
        ))
        .bind(&request.invocation_id)
        .bind(request.ordinal as i32)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        let stored = request_from(&row)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored)
    }
    async fn program_run(
        &self,
        actor: &str,
        s: &Scope,
        invocation_id: &str,
        index: u32,
    ) -> Result<Option<ProgramRun>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let row = sqlx::query(
            "SELECT * FROM public.task_program_runs WHERE invocation_id=$1 AND ordinal=$2",
        )
        .bind(invocation_id)
        .bind(index as i32)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?;
        let run = row.as_ref().map(program_run_from).transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(run)
    }
    async fn program_runs(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        cycle_id: &str,
    ) -> Result<Vec<ProgramRun>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let rows = sqlx::query("SELECT * FROM public.task_program_runs WHERE task_id=$1 AND cycle_id=$2 ORDER BY created_us, invocation_id COLLATE \"C\", ordinal LIMIT $3")
            .bind(task_id).bind(cycle_id).bind(CYCLE_RUNS + 1).fetch_all(&mut *tx).await.map_err(unavailable)?;
        if rows.len() as i64 > CYCLE_RUNS {
            return Err(ReadingError::Unavailable);
        }
        let runs = rows
            .iter()
            .map(program_run_from)
            .collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(runs)
    }
    async fn record_program_run(
        &self,
        basis: &ClaimBasis,
        run: &ProgramRun,
    ) -> Result<ProgramRun, ReadingError> {
        if !run.is_valid() || run.task_id != basis.task_id || run.cycle_id != basis.cycle_id {
            return Err(ReadingError::Invalid);
        }
        let s = &basis.scope;
        let mut tx = begin(&self.pool, &basis.actor_id, s).await?;
        lock(
            &mut tx,
            &format!("program:{}:{}", run.invocation_id, run.index),
        )
        .await?;
        let existing = sqlx::query(
            "SELECT * FROM public.task_program_runs WHERE invocation_id=$1 AND ordinal=$2",
        )
        .bind(&run.invocation_id)
        .bind(run.index as i32)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?;
        if let Some(row) = existing {
            let stored = program_run_from(&row)?;
            tx.commit().await.map_err(unavailable)?;
            // An identical retry returns the recorded run; a different fact
            // for the same request is refused, never silently replaced.
            return if stored.same_fact(run) {
                Ok(stored)
            } else {
                Err(ReadingError::Invalid)
            };
        }
        sqlx::query("INSERT INTO public.task_program_runs(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,job_id,status,output,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&run.task_id).bind(&run.cycle_id).bind(&basis.actor_id)
            .bind(&run.invocation_id).bind(run.index as i32).bind(&run.job_id)
            .bind(match run.status { ProgramStatus::Completed => "completed", ProgramStatus::Failed => "failed" })
            .bind(&run.output).bind(&run.reason)
            .execute(&mut *tx).await.map_err(refusal)?;
        let row = sqlx::query(
            "SELECT * FROM public.task_program_runs WHERE invocation_id=$1 AND ordinal=$2",
        )
        .bind(&run.invocation_id)
        .bind(run.index as i32)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        let stored = program_run_from(&row)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored)
    }
    async fn verification(
        &self,
        actor: &str,
        s: &Scope,
        invocation_id: &str,
    ) -> Result<Option<AnswerVerification>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let verification = load_verification(&mut tx, invocation_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(verification)
    }
    async fn cycle_verifications(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
        cycle_id: &str,
    ) -> Result<Vec<AnswerVerification>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let ids: Vec<String> = sqlx::query_scalar("SELECT invocation_id FROM public.answer_verifications WHERE task_id=$1 AND cycle_id=$2 ORDER BY verified_us, invocation_id COLLATE \"C\" LIMIT $3")
            .bind(task_id).bind(cycle_id).bind(CYCLE_ANSWERS + 1).fetch_all(&mut *tx).await.map_err(unavailable)?;
        if ids.len() as i64 > CYCLE_ANSWERS {
            return Err(ReadingError::Unavailable);
        }
        let mut result = Vec::new();
        for id in &ids {
            result.push(
                load_verification(&mut tx, id)
                    .await?
                    .ok_or(ReadingError::Unavailable)?,
            );
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn record_citations(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
        citations: &[StoredCitation],
    ) -> Result<Vec<StoredCitation>, ReadingError> {
        if !valid_scope_id(invocation_id)
            || citations.len() > 64
            || citations
                .iter()
                .any(|c| c.sources.len() > 8 || c.sources.iter().any(|v| !v.is_valid()))
        {
            return Err(ReadingError::Invalid);
        }
        let s = &basis.scope;
        let mut tx = begin(&self.pool, &basis.actor_id, s).await?;
        lock(&mut tx, &format!("answer:{invocation_id}")).await?;
        if let Some(existing) = load_verification(&mut tx, invocation_id).await? {
            tx.commit().await.map_err(unavailable)?;
            return Ok(existing.citations);
        }
        let mut sources = 0i32;
        for citation in citations {
            sqlx::query("INSERT INTO public.answer_citations(organisation_id,client_id,engagement_id,invocation_id,segment,span_start,span_end) VALUES($1,$2,$3,$4,$5,$6,$7)")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(invocation_id)
                .bind(citation.segment as i32).bind(citation.span.start as i32).bind(citation.span.end as i32)
                .execute(&mut *tx).await.map_err(refusal)?;
            for (ordinal, source) in citation.sources.iter().enumerate() {
                sources += 1;
                let (verification, reason) = match source.verification {
                    Verification::Verified => ("verified", None),
                    Verification::Unverified(reason) => ("unverified", Some(reason.as_str())),
                };
                sqlx::query("INSERT INTO public.citation_sources(organisation_id,client_id,engagement_id,invocation_id,segment,ordinal,original_id,locator,quote,original_sha256,verification,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
                    .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(invocation_id)
                    .bind(citation.segment as i32).bind(ordinal as i32).bind(&source.source.original_id)
                    .bind(source.source.locator.as_ref().map(Locator::render)).bind(&source.source.quote)
                    .bind(&source.original_sha256).bind(verification).bind(reason)
                    .execute(&mut *tx).await.map_err(refusal)?;
            }
        }
        sqlx::query("INSERT INTO public.answer_verifications(organisation_id,client_id,engagement_id,invocation_id,task_id,cycle_id,actor_id,status,citations,sources) VALUES($1,$2,$3,$4,$5,$6,$7,'verified',$8,$9)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(invocation_id)
            .bind(&basis.task_id).bind(&basis.cycle_id).bind(&basis.actor_id)
            .bind(citations.len() as i32).bind(sources)
            .execute(&mut *tx).await.map_err(refusal)?;
        let stored = load_verification(&mut tx, invocation_id)
            .await?
            .ok_or(ReadingError::Unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored.citations)
    }
    async fn record_verification_failure(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<(), ReadingError> {
        if !valid_scope_id(invocation_id) {
            return Err(ReadingError::Invalid);
        }
        let s = &basis.scope;
        let mut tx = begin(&self.pool, &basis.actor_id, s).await?;
        lock(&mut tx, &format!("answer:{invocation_id}")).await?;
        if load_verification(&mut tx, invocation_id).await?.is_none() {
            sqlx::query("INSERT INTO public.answer_verifications(organisation_id,client_id,engagement_id,invocation_id,task_id,cycle_id,actor_id,status,citations,sources) VALUES($1,$2,$3,$4,$5,$6,$7,'failed',0,0)")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(invocation_id)
                .bind(&basis.task_id).bind(&basis.cycle_id).bind(&basis.actor_id)
                .execute(&mut *tx).await.map_err(refusal)?;
        }
        tx.commit().await.map_err(unavailable)?;
        Ok(())
    }
}

#[cfg(test)]
mod pin_tests {
    use sha2::{Digest, Sha256};
    use zobba_application::reading::DOCUMENT_PROGRAM;

    /// The schema's document-environment guard pins the exact trusted program:
    /// changing `document.py` must change the latest migration with it.
    /// Migration 0019 (Story 24.2) pins the current program and keeps the
    /// 0016 program admissible for jobs that predate it; 0016 is unchanged.
    #[test]
    fn the_schema_pins_the_trusted_document_program() {
        let migration = include_str!("../../../migrations/0019_assessment_coverage.sql");
        let sha = format!("{:x}", Sha256::digest(DOCUMENT_PROGRAM.as_bytes()));
        let bytes = DOCUMENT_PROGRAM.len();
        // Both the document-environment admission and the render guard.
        assert_eq!(
            migration.matches(&format!("'{sha}'")).count(),
            2,
            "document program SHA-256 {sha}"
        );
        assert_eq!(
            migration
                .matches(&format!("FROM 1 FOR {bytes})),'hex')"))
                .count(),
            2,
            "document program length {bytes}"
        );
        assert!(
            migration.contains(&format!("octet_length(program) > {bytes}")),
            "document program length {bytes}"
        );
    }

    /// The 0016 pin is the published Story 22.4 program and never moves.
    #[test]
    fn the_published_citation_migration_keeps_its_program_pin() {
        let migration = include_str!("../../../migrations/0016_citations.sql");
        let old = "8abd34b8ef01866706cb18717a95ace272cedf55ce675cb0d7796553983ca849";
        assert_eq!(migration.matches(&format!("'{old}'")).count(), 2);
        assert_eq!(migration.matches("FROM 1 FOR 19327)),'hex')").count(), 2);
    }
}
