//! Admin methodology document proposals (Story 22.6 AC4): immutable disclosure
//! and result facts under the Admin session. A proposal is configuration
//! evidence, not a Task, and has no effect until the Admin's validated Save.
use crate::scope;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};
use std::sync::Arc;
use zobba_application::{
    methodology::{Definition, SourceAttribution},
    model::{ModelProfile, ModelQualificationSource, wire::StoredProfile},
    proposal::{
        DraftedProposal, FieldCitation, Location, ProposalConflict, ProposalDisclosure,
        ProposalError, ProposalResult, ProposalStore, StoredProposal,
    },
};
use zobba_domain::identity::valid_scope_id;

type Tx = Transaction<'static, Postgres>;
enum Filter<'a> {
    Id(&'a str),
    Key(&'a str, &'a str),
}
const ADVISORY: i64 = 2206;
/// The `document` column bound (its CHECK), measured as PostgreSQL measures it.
const MAX_DOCUMENT_BYTES: i64 = 1_048_576;
/// The fixed reason recorded when a draft does not fit its record.
pub const PROPOSAL_TOO_LARGE: &str = "proposal_too_large";

#[derive(Clone)]
pub struct ProposalRepository {
    pool: PgPool,
    session_hash: String,
    qualifications: Arc<dyn ModelQualificationSource>,
}

fn db(error: sqlx::Error) -> ProposalError {
    match error.as_database_error().and_then(|e| e.code()).as_deref() {
        Some("23505") => ProposalError::Conflict,
        Some("42501") => ProposalError::Denied,
        _ => ProposalError::Unavailable,
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredLocation {
    start: u64,
    end: u64,
    line: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredCitation {
    field: String,
    quote: String,
    location: StoredLocation,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredConflict {
    text: String,
    quote: String,
    location: StoredLocation,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, tag = "status", rename_all = "snake_case")]
enum StoredResult {
    Drafted {
        definition: Box<Definition>,
        source: SourceAttribution,
        citations: Vec<StoredCitation>,
        conflicts: Vec<StoredConflict>,
        missing_criteria: Vec<String>,
        unverified: Vec<String>,
    },
    Failed {
        reason: String,
    },
}

fn location(l: &Location) -> StoredLocation {
    StoredLocation {
        start: l.start,
        end: l.end,
        line: l.line,
    }
}
fn restore(l: StoredLocation) -> Location {
    Location {
        start: l.start,
        end: l.end,
        line: l.line,
    }
}

fn encode_result(result: &ProposalResult) -> Result<Value, ProposalError> {
    let stored = match result {
        ProposalResult::Drafted(d) => StoredResult::Drafted {
            definition: Box::new(d.definition.clone()),
            source: d.source.clone(),
            citations: d
                .citations
                .iter()
                .map(|c| StoredCitation {
                    field: c.field.clone(),
                    quote: c.quote.clone(),
                    location: location(&c.location),
                })
                .collect(),
            conflicts: d
                .conflicts
                .iter()
                .map(|c| StoredConflict {
                    text: c.text.clone(),
                    quote: c.quote.clone(),
                    location: location(&c.location),
                })
                .collect(),
            missing_criteria: d.missing_criteria.clone(),
            unverified: d.unverified.clone(),
        },
        ProposalResult::Failed { reason } => StoredResult::Failed {
            reason: reason.clone(),
        },
    };
    serde_json::to_value(stored).map_err(|_| ProposalError::Invalid)
}

fn decode_result(value: Value) -> Result<ProposalResult, ProposalError> {
    match serde_json::from_value(value).map_err(|_| ProposalError::Unavailable)? {
        StoredResult::Drafted {
            definition,
            source,
            citations,
            conflicts,
            missing_criteria,
            unverified,
        } => Ok(ProposalResult::Drafted(Box::new(DraftedProposal {
            definition: *definition,
            source,
            citations: citations
                .into_iter()
                .map(|c| FieldCitation {
                    field: c.field,
                    quote: c.quote,
                    location: restore(c.location),
                })
                .collect(),
            conflicts: conflicts
                .into_iter()
                .map(|c| ProposalConflict {
                    text: c.text,
                    quote: c.quote,
                    location: restore(c.location),
                })
                .collect(),
            missing_criteria,
            unverified,
        }))),
        StoredResult::Failed { reason } => Ok(ProposalResult::Failed { reason }),
    }
}

fn encode_disclosure(d: &ProposalDisclosure) -> Value {
    json!({
        "filename": d.filename, "media_type": d.media_type,
        "document_sha256": d.document_sha256, "document_size": d.document_size,
        "reservation_id": d.reservation_id, "namespace": d.namespace,
        "object_version": d.object_version, "profile_id": d.profile_id,
        "profile_revision": d.profile_revision, "provider": d.provider,
        "model": d.model, "destination": d.destination,
    })
}

fn decode_disclosure(value: &Value) -> Result<ProposalDisclosure, ProposalError> {
    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(ProposalError::Unavailable)
    };
    let number = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_u64)
            .ok_or(ProposalError::Unavailable)
    };
    Ok(ProposalDisclosure {
        filename: text("filename")?,
        media_type: text("media_type")?,
        document_sha256: text("document_sha256")?,
        document_size: number("document_size")?,
        reservation_id: text("reservation_id")?,
        namespace: text("namespace")?,
        object_version: text("object_version")?,
        profile_id: text("profile_id")?,
        profile_revision: number("profile_revision")?,
        provider: text("provider")?,
        model: text("model")?,
        destination: text("destination")?,
    })
}

impl ProposalRepository {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            session_hash: String::new(),
            qualifications: Arc::new(crate::model::Unqualified),
        }
    }
    pub fn with_session_hash(mut self, hash: String) -> Self {
        self.session_hash = hash;
        self
    }
    pub fn with_qualification_source(mut self, source: Arc<dyn ModelQualificationSource>) -> Self {
        self.qualifications = source;
        self
    }

    /// An Admin transaction for this organisation; denied otherwise.
    async fn admin(
        &self,
        actor: &str,
        organisation: &str,
        lock: bool,
    ) -> Result<Tx, ProposalError> {
        if !valid_scope_id(actor)
            || !valid_scope_id(organisation)
            || !crate::identity::valid_secret(&self.session_hash)
        {
            return Err(ProposalError::Denied);
        }
        let mut tx = scope::begin_actor(&self.pool, actor)
            .await
            .map_err(|_| ProposalError::Unavailable)?;
        sqlx::query("SELECT set_config('zobba.organisation_id',$1,true),set_config('zobba.model_session_hash',$2,true)")
            .bind(organisation)
            .bind(&self.session_hash)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        if lock {
            sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,$2))")
                .bind(organisation)
                .bind(ADVISORY)
                .execute(&mut *tx)
                .await
                .map_err(db)?;
        }
        let allowed: bool = sqlx::query_scalar("SELECT public.model_configuration_admin($1,$2,$3)")
            .bind(actor)
            .bind(organisation)
            .bind(&self.session_hash)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        if allowed {
            Ok(tx)
        } else {
            Err(ProposalError::Denied)
        }
    }

    async fn read(
        tx: &mut Tx,
        organisation: &str,
        filter: Filter<'_>,
    ) -> Result<Option<StoredProposal>, ProposalError> {
        let query = match filter {
            Filter::Id(id) => sqlx::query_as("SELECT id,event,actor_id,key,document,created_us,floor(extract(epoch FROM clock_timestamp())*1000000)::bigint FROM public.methodology_proposals WHERE organisation_id=$1 AND id=$2 ORDER BY event")
                .bind(organisation)
                .bind(id),
            // The result row carries the same actor and key as its disclosure.
            Filter::Key(actor, key) => sqlx::query_as("SELECT id,event,actor_id,key,document,created_us,floor(extract(epoch FROM clock_timestamp())*1000000)::bigint FROM public.methodology_proposals WHERE organisation_id=$1 AND actor_id=$2 AND key=$3 ORDER BY event")
                .bind(organisation)
                .bind(actor)
                .bind(key),
        };
        let rows: Vec<(String, String, String, String, Value, i64, i64)> =
            query.fetch_all(&mut **tx).await.map_err(db)?;
        let Some(disclosure) = rows.iter().find(|r| r.1 == "disclosure") else {
            return Ok(None);
        };
        let result = rows
            .iter()
            .find(|r| r.1 == "result" && r.0 == disclosure.0)
            .map(|r| decode_result(r.4.clone()))
            .transpose()?;
        Ok(Some(StoredProposal {
            id: disclosure.0.clone(),
            key: disclosure.3.clone(),
            actor_id: disclosure.2.clone(),
            disclosure: decode_disclosure(&disclosure.4)?,
            result,
            created_us: disclosure.5,
            observed_us: disclosure.6,
        }))
    }

    /// Recent proposals of this organisation, newest first.
    pub async fn list(
        &self,
        actor: &str,
        organisation: &str,
    ) -> Result<Vec<StoredProposal>, ProposalError> {
        let mut tx = self.admin(actor, organisation, false).await?;
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM public.methodology_proposals WHERE organisation_id=$1 AND event='disclosure' ORDER BY created_us DESC, id COLLATE \"C\" LIMIT 20")
            .bind(organisation)
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
        let mut out = Vec::new();
        for id in ids {
            if let Some(p) = Self::read(&mut tx, organisation, Filter::Id(&id)).await? {
                out.push(p);
            }
        }
        tx.commit().await.map_err(db)?;
        Ok(out)
    }
}

impl ProposalStore for ProposalRepository {
    async fn profile(
        &self,
        actor: &str,
        organisation: &str,
        profile_id: &str,
    ) -> Result<Option<ModelProfile>, ProposalError> {
        let mut tx = self.admin(actor, organisation, false).await?;
        let document: Option<Value> = sqlx::query_scalar("SELECT document FROM public.model_profiles WHERE organisation_id=$1 AND id=$2 ORDER BY revision DESC LIMIT 1")
            .bind(organisation)
            .bind(profile_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        let Some(document) = document else {
            return Ok(None);
        };
        let profile = serde_json::from_value::<StoredProfile>(document)
            .map_err(|_| ProposalError::Unavailable)?
            .0;
        Ok(
            (profile.enabled && profile.is_valid() && self.qualifications.qualified(&profile))
                .then_some(profile),
        )
    }

    async fn by_key(
        &self,
        actor: &str,
        organisation: &str,
        key: &str,
    ) -> Result<Option<StoredProposal>, ProposalError> {
        let mut tx = self.admin(actor, organisation, false).await?;
        let found = Self::read(&mut tx, organisation, Filter::Key(actor, key)).await?;
        tx.commit().await.map_err(db)?;
        Ok(found)
    }

    async fn disclose(
        &self,
        actor: &str,
        organisation: &str,
        key: &str,
        id: &str,
        disclosure: &ProposalDisclosure,
    ) -> Result<i64, ProposalError> {
        let mut tx = self.admin(actor, organisation, true).await?;
        let created_us: i64 = sqlx::query_scalar("INSERT INTO public.methodology_proposals(organisation_id,id,event,actor_id,key,document) VALUES($1,$2,'disclosure',$3,$4,$5) RETURNING created_us")
            .bind(organisation)
            .bind(id)
            .bind(actor)
            .bind(key)
            .bind(encode_disclosure(disclosure))
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(created_us)
    }

    async fn record_result(
        &self,
        actor: &str,
        organisation: &str,
        key: &str,
        id: &str,
        result: &ProposalResult,
    ) -> Result<ProposalResult, ProposalError> {
        let mut tx = self.admin(actor, organisation, true).await?;
        // A draft too large for its record is stored as a fixed failure, so
        // the proposal never stays uncertain because its result did not fit.
        let mut stored = result.clone();
        let mut document = encode_result(&stored)?;
        let size: i64 = sqlx::query_scalar("SELECT octet_length($1::jsonb::text)::bigint")
            .bind(&document)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        if size > MAX_DOCUMENT_BYTES {
            stored = ProposalResult::Failed {
                reason: PROPOSAL_TOO_LARGE.into(),
            };
            document = encode_result(&stored)?;
        }
        sqlx::query("INSERT INTO public.methodology_proposals(organisation_id,id,event,actor_id,key,document) VALUES($1,$2,'result',$3,$4,$5)")
            .bind(organisation)
            .bind(id)
            .bind(actor)
            .bind(key)
            .bind(document)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(stored)
    }

    async fn proposal(
        &self,
        actor: &str,
        organisation: &str,
        id: &str,
    ) -> Result<Option<StoredProposal>, ProposalError> {
        let mut tx = self.admin(actor, organisation, false).await?;
        let found = Self::read(&mut tx, organisation, Filter::Id(id)).await?;
        tx.commit().await.map_err(db)?;
        Ok(found)
    }
}
