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
        DocumentStatus, MAX_CONTEXT_ORIGINALS, PageImage, PageRead, ProgramRun, ProgramStatus,
        ReadStatus, ReadingOriginal, ReadingStore, RenderBatch, RenderedPage,
    },
};
use zobba_domain::{
    analysis::MEDIA_TYPES,
    citation::{
        CitationSource, Locator, PageTranscript, Span, UnverifiedReason, Verification,
        VerifiedSource,
    },
    evidence::ContentIdentity,
    identity::{Scope, valid_scope_id},
    model::ImageMediaType,
    task::ClaimBasis,
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
        "SELECT p.page,p.image_id,p.image_sha256,p.image_size,p.image_media_type,p.text_layer,d.namespace,d.version
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
    Ok(ProgramRun {
        task_id: field(row, "task_id")?,
        cycle_id: field(row, "cycle_id")?,
        invocation_id: field(row, "invocation_id")?,
        index: field::<i32>(row, "ordinal")? as u32,
        job_id: field(row, "job_id")?,
        status: program_status(&field::<String>(row, "status")?)
            .ok_or(ReadingError::Unavailable)?,
        output: field(row, "output")?,
        reason: field(row, "reason")?,
    })
}

/// Stored citations of one answer, in segment and source order.
async fn load_citations(
    tx: &mut Tx,
    invocation_id: &str,
) -> Result<Option<Vec<StoredCitation>>, ReadingError> {
    let verified: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM public.answer_verifications WHERE invocation_id=$1)",
    )
    .bind(invocation_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(unavailable)?;
    if !verified {
        return Ok(None);
    }
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
    Ok(Some(citations))
}

impl CitationRepository {
    /// Answers of one Task's current cycle with their verified citations, for
    /// the current viewer (RLS: their own current engagement access).
    pub async fn answers(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
    ) -> Result<Vec<(String, Vec<StoredCitation>)>, ReadingError> {
        if !valid_scope_id(task_id) {
            return Err(ReadingError::Invalid);
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT v.invocation_id FROM public.answer_verifications v JOIN public.tasks t ON (t.organisation_id,t.client_id,t.engagement_id,t.id)=(v.organisation_id,v.client_id,v.engagement_id,v.task_id) AND t.cycle_id=v.cycle_id
              WHERE v.task_id=$1 ORDER BY v.verified_at DESC, v.invocation_id COLLATE \"C\" LIMIT 20",
        )
        .bind(task_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
        let mut result = Vec::new();
        for id in ids {
            if let Some(citations) = load_citations(&mut tx, &id).await? {
                result.push((id, citations));
            }
        }
        tx.commit().await.map_err(unavailable)?;
        result.reverse();
        Ok(result)
    }
}

impl CitationRepository {
    /// The exact original as the current viewer may see it: its filename,
    /// storage version and digest, or None when the viewer cannot read it now.
    /// A citation never grants source access; the caller withholds the quote
    /// and filename of a source this returns None for.
    pub async fn viewer_original(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
    ) -> Result<Option<(String, String, String)>, ReadingError> {
        if !valid_scope_id(id) {
            return Ok(None);
        }
        let mut tx = begin(&self.pool, actor, s).await?;
        let row = sqlx::query("SELECT (request::jsonb)->>'filename' AS filename,version,digest FROM public.evidence_originals WHERE id=$1")
            .bind(id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        let original = row
            .map(|row| {
                Ok::<_, ReadingError>((
                    field(&row, "filename")?,
                    field(&row, "version")?,
                    field(&row, "digest")?,
                ))
            })
            .transpose()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(original)
    }
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
        let original = row
            .map(|row| {
                Ok::<_, ReadingError>(ReadingOriginal {
                    id: field(&row, "id")?,
                    sha256: field(&row, "digest")?,
                    size: field::<i64>(&row, "size")? as u64,
                    filename: field(&row, "filename")?,
                })
            })
            .transpose()?;
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
        let mut result = Vec::new();
        for row in &rows {
            result.push(ReadingOriginal {
                id: field(row, "id")?,
                sha256: field(row, "digest")?,
                size: field::<i64>(row, "size")? as u64,
                filename: field(row, "filename")?,
            });
        }
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
            sqlx::query("INSERT INTO public.document_pages(organisation_id,client_id,engagement_id,original_id,original_sha256,batch,page,image_id,image_sha256,image_size,image_media_type,text_layer) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
                .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&batch.original_id).bind(&batch.original_sha256)
                .bind(batch.batch as i32).bind(page.page as i32)
                .bind(page.image.as_ref().map(|i| i.descendant_id.clone()))
                .bind(page.image.as_ref().map(|i| i.sha256.clone()))
                .bind(page.image.as_ref().map(|i| i.size as i64))
                .bind(page.image.as_ref().map(|i| i.media_type.as_str()))
                .bind(&page.text_layer)
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
        let rows = sqlx::query("SELECT id,path,fold_key,media_type,digest,size,namespace,version FROM public.analysis_descendants WHERE job_id=$1 ORDER BY path COLLATE \"C\" LIMIT 64")
            .bind(job_id).fetch_all(&mut *tx).await.map_err(unavailable)?;
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
    async fn page_reads(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
    ) -> Result<Vec<PageRead>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let rows = sqlx::query("SELECT * FROM public.task_page_reads WHERE task_id=$1 ORDER BY created_at, original_id COLLATE \"C\", page, attempt LIMIT 1024")
            .bind(task_id).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let reads = rows.iter().map(page_read_from).collect::<Result<_, _>>()?;
        tx.commit().await.map_err(unavailable)?;
        Ok(reads)
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
    async fn program_runs(
        &self,
        actor: &str,
        s: &Scope,
        task_id: &str,
    ) -> Result<Vec<ProgramRun>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let rows = sqlx::query("SELECT * FROM public.task_program_runs WHERE task_id=$1 ORDER BY created_at, invocation_id COLLATE \"C\", ordinal LIMIT 256")
            .bind(task_id).fetch_all(&mut *tx).await.map_err(unavailable)?;
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
        if run.task_id != basis.task_id || run.cycle_id != basis.cycle_id {
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
            return Ok(stored);
        }
        sqlx::query("INSERT INTO public.task_program_runs(organisation_id,client_id,engagement_id,task_id,cycle_id,actor_id,invocation_id,ordinal,job_id,status,output,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(&run.task_id).bind(&run.cycle_id).bind(&basis.actor_id)
            .bind(&run.invocation_id).bind(run.index as i32).bind(&run.job_id)
            .bind(match run.status { ProgramStatus::Completed => "completed", ProgramStatus::Failed => "failed" })
            .bind(&run.output).bind(&run.reason)
            .execute(&mut *tx).await.map_err(refusal)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(run.clone())
    }
    async fn citations(
        &self,
        actor: &str,
        s: &Scope,
        invocation_id: &str,
    ) -> Result<Option<Vec<StoredCitation>>, ReadingError> {
        let mut tx = begin(&self.pool, actor, s).await?;
        let citations = load_citations(&mut tx, invocation_id).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(citations)
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
        if let Some(existing) = load_citations(&mut tx, invocation_id).await? {
            tx.commit().await.map_err(unavailable)?;
            return Ok(existing);
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
        sqlx::query("INSERT INTO public.answer_verifications(organisation_id,client_id,engagement_id,invocation_id,task_id,cycle_id,actor_id,citations,sources) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(invocation_id)
            .bind(&basis.task_id).bind(&basis.cycle_id).bind(&basis.actor_id)
            .bind(citations.len() as i32).bind(sources)
            .execute(&mut *tx).await.map_err(refusal)?;
        let stored = load_citations(&mut tx, invocation_id)
            .await?
            .ok_or(ReadingError::Unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok(stored)
    }
}
