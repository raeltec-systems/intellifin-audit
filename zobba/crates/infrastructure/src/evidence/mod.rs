//! Runtime-only scoped immutable custody. No database transaction spans storage.
pub mod s3;
use crate::{identity::random_secret, scope};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use zobba_application::evidence::*;
use zobba_domain::{
    evidence::*,
    identity::{Scope, valid_scope_id},
};
#[derive(Clone)]
pub struct EvidenceRepository {
    pool: PgPool,
    session_hash: String,
}
type Tx = Transaction<'static, Postgres>;
fn unavailable(_: sqlx::Error) -> EvidenceError {
    EvidenceError::Unavailable
}
fn encode(request: &ReservationRequest) -> String {
    json!({"key":request.key,"filename":request.filename,"sha256":request.identity.sha256,"size":request.identity.size,"system":request.source.system,"account":request.source.account,"source_version":request.source.source_version,"selection":request.source.selection,"coverage":request.source.coverage}).to_string()
}
fn reservation_row(row: &PgRow) -> Result<Reservation, EvidenceError> {
    let request: String = row.try_get("request").map_err(unavailable)?;
    let v: Value = serde_json::from_str(&request).map_err(|_| EvidenceError::Unavailable)?;
    let text = |name: &str| {
        v[name]
            .as_str()
            .map(str::to_owned)
            .ok_or(EvidenceError::Unavailable)
    };
    let optional = |name: &str| match &v[name] {
        Value::Null => Ok(None),
        Value::String(s) => Ok(Some(s.clone())),
        _ => Err(EvidenceError::Unavailable),
    };
    Ok(Reservation {
        id: row.try_get("id").map_err(unavailable)?,
        actor_id: row.try_get("actor_id").map_err(unavailable)?,
        scope: Scope {
            organisation_id: row.try_get("organisation_id").map_err(unavailable)?,
            client_id: row.try_get("client_id").map_err(unavailable)?,
            engagement_id: row.try_get("engagement_id").map_err(unavailable)?,
        },
        request: ReservationRequest {
            key: text("key")?,
            filename: text("filename")?,
            identity: ContentIdentity {
                sha256: text("sha256")?,
                size: v["size"].as_u64().ok_or(EvidenceError::Unavailable)?,
            },
            source: SourceAssertions {
                system: optional("system")?,
                account: optional("account")?,
                source_version: optional("source_version")?,
                selection: optional("selection")?,
                coverage: optional("coverage")?,
            },
        },
        reserved_at: row.try_get("reserved_at").map_err(unavailable)?,
    })
}
fn evidence_row(row: &PgRow) -> Result<RegisteredEvidence, EvidenceError> {
    Ok(RegisteredEvidence {
        reservation: reservation_row(row)?,
        version: row.try_get("version").map_err(unavailable)?,
        registered_at: row.try_get("registered_at").map_err(unavailable)?,
    })
}
impl EvidenceRepository {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            session_hash: String::new(),
        }
    }
    pub fn with_session_hash(mut self, hash: String) -> Self {
        self.session_hash = hash;
        self
    }
    async fn current(&self, tx: &mut Tx, actor: &str, scope: &Scope) -> Result<(), EvidenceError> {
        // Separate statements after each lock refresh READ COMMITTED authority.
        let identity: Option<String> =
            sqlx::query_scalar("SELECT id FROM public.identities WHERE id=$1 AND active FOR SHARE")
                .bind(actor)
                .fetch_optional(&mut **tx)
                .await
                .map_err(unavailable)?;
        if identity.is_none() {
            return Err(EvidenceError::Denied);
        }
        let session: bool = sqlx::query_scalar("SELECT public.evidence_session_locked($1,$2)")
            .bind(actor)
            .bind(&self.session_hash)
            .fetch_one(&mut **tx)
            .await
            .map_err(unavailable)?;
        if !session {
            return Err(EvidenceError::Denied);
        }
        let allowed:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3) AND EXISTS(SELECT 1 FROM public.sessions WHERE token_hash=$4 AND actor_id=$5 AND expires_at>extract(epoch FROM clock_timestamp())::bigint)").bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id).bind(&self.session_hash).bind(actor).fetch_one(&mut **tx).await.map_err(unavailable)?;
        if !allowed {
            return Err(EvidenceError::Denied);
        }
        Ok(())
    }
    async fn begin(&self, actor: &str, s: &Scope) -> Result<Tx, EvidenceError> {
        if !valid_scope_id(actor)
            || !s.is_valid()
            || !crate::identity::valid_secret(&self.session_hash)
        {
            return Err(EvidenceError::Denied);
        }
        let mut tx = scope::begin(&self.pool, actor, s)
            .await
            .map_err(|e| match e {
                scope::ScopeError::Denied => EvidenceError::Denied,
                _ => EvidenceError::Unavailable,
            })?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,205))")
            .bind(&s.organisation_id)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        sqlx::query("SELECT id FROM public.engagements WHERE organisation_id=$1 AND client_id=$2 AND id=$3 FOR UPDATE").bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(EvidenceError::Denied)?;
        self.current(&mut tx, actor, s).await?;
        Ok(tx)
    }
    async fn get_reservation(
        &self,
        tx: &mut Tx,
        id: &str,
    ) -> Result<StoredReservation, EvidenceError> {
        if !valid_scope_id(id) {
            return Err(EvidenceError::Denied);
        }
        let row = sqlx::query("SELECT * FROM public.evidence_reservations WHERE id=$1")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(unavailable)?
            .ok_or(EvidenceError::Denied)?;
        let registered = sqlx::query("SELECT * FROM public.evidence_originals WHERE id=$1")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(unavailable)?
            .as_ref()
            .map(evidence_row)
            .transpose()?;
        Ok(StoredReservation {
            reservation: reservation_row(&row)?,
            namespace: row.try_get("namespace").map_err(unavailable)?,
            registered,
        })
    }
}
impl EvidenceMetadata for EvidenceRepository {
    async fn reserve(
        &self,
        actor: &str,
        s: &Scope,
        request: &ReservationRequest,
        namespace: &str,
    ) -> Result<StoredReservation, EvidenceError> {
        if !request.is_valid()
            || namespace.len() != 64
            || !namespace
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err(EvidenceError::Invalid);
        }
        let mut tx = self.begin(actor, s).await?;
        let previous: Option<String> = sqlx::query_scalar(
            "SELECT id FROM public.evidence_reservations WHERE actor_id=$1 AND key=$2",
        )
        .bind(actor)
        .bind(&request.key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?;
        if let Some(id) = previous {
            let old = self.get_reservation(&mut tx, &id).await?;
            if old.reservation.request != *request {
                return Err(EvidenceError::Conflict);
            }
            self.current(&mut tx, actor, s).await?;
            tx.commit().await.map_err(unavailable)?;
            return Ok(old);
        }
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM (SELECT r.id FROM public.evidence_reservations r WHERE actor_id=$1 AND NOT EXISTS(SELECT 1 FROM public.evidence_originals e WHERE e.id=r.id) LIMIT 101) pending").bind(actor).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if count >= 100 {
            return Err(EvidenceError::ReservationLimit);
        }
        let id = random_secret().map_err(|_| EvidenceError::Unavailable)?;
        sqlx::query("INSERT INTO public.evidence_reservations(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)").bind(&id).bind(&s.organisation_id).bind(&s.client_id).bind(&s.engagement_id).bind(actor).bind(&request.key).bind(encode(request)).bind(&request.identity.sha256).bind(request.identity.size as i64).bind(namespace).execute(&mut *tx).await.map_err(unavailable)?;
        let result = self.get_reservation(&mut tx, &id).await?;
        self.current(&mut tx, actor, s).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn reservation(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
    ) -> Result<StoredReservation, EvidenceError> {
        let mut tx = self.begin(actor, s).await?;
        let result = self.get_reservation(&mut tx, id).await?;
        self.current(&mut tx, actor, s).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn recover(
        &self,
        actor: &str,
        s: &Scope,
        after: Option<&str>,
    ) -> Result<EvidencePage<Reservation>, EvidenceError> {
        if after.is_some_and(|a| !valid_scope_id(a)) {
            return Err(EvidenceError::Invalid);
        }
        let mut tx = self.begin(actor, s).await?;
        let rows=sqlx::query("SELECT r.* FROM public.evidence_reservations r WHERE actor_id=$1 AND ($2::text IS NULL OR id COLLATE \"C\">$2) AND NOT EXISTS(SELECT 1 FROM public.evidence_originals e WHERE e.id=r.id) ORDER BY id COLLATE \"C\" LIMIT 51").bind(actor).bind(after).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let mut items = rows
            .iter()
            .map(reservation_row)
            .collect::<Result<Vec<_>, _>>()?;
        let next_cursor = if items.len() > EVIDENCE_PAGE_SIZE {
            items.truncate(EVIDENCE_PAGE_SIZE);
            items.last().map(|i| i.id.clone())
        } else {
            None
        };
        self.current(&mut tx, actor, s).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(EvidencePage { items, next_cursor })
    }
    async fn list(
        &self,
        actor: &str,
        s: &Scope,
        after: Option<&str>,
    ) -> Result<EvidencePage<RegisteredEvidence>, EvidenceError> {
        if after.is_some_and(|a| !valid_scope_id(a)) {
            return Err(EvidenceError::Invalid);
        }
        let mut tx = self.begin(actor, s).await?;
        let rows=sqlx::query("SELECT * FROM public.evidence_originals WHERE $1::text IS NULL OR id COLLATE \"C\">$1 ORDER BY id COLLATE \"C\" LIMIT 51").bind(after).fetch_all(&mut *tx).await.map_err(unavailable)?;
        let mut items = rows
            .iter()
            .map(evidence_row)
            .collect::<Result<Vec<_>, _>>()?;
        let next_cursor = if items.len() > EVIDENCE_PAGE_SIZE {
            items.truncate(EVIDENCE_PAGE_SIZE);
            items.last().map(|i| i.reservation.id.clone())
        } else {
            None
        };
        self.current(&mut tx, actor, s).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(EvidencePage { items, next_cursor })
    }
    async fn inspect(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
    ) -> Result<StoredEvidence, EvidenceError> {
        if !valid_scope_id(id) {
            return Err(EvidenceError::Denied);
        }
        let mut tx = self.begin(actor, s).await?;
        let row = sqlx::query("SELECT * FROM public.evidence_originals WHERE id=$1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .ok_or(EvidenceError::Denied)?;
        let result = StoredEvidence {
            evidence: evidence_row(&row)?,
            namespace: row.try_get("namespace").map_err(unavailable)?,
        };
        self.current(&mut tx, actor, s).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
    async fn register(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
        namespace: &str,
        version: &str,
        identity: &ContentIdentity,
    ) -> Result<RegisteredEvidence, EvidenceError> {
        self.register_impl(actor, s, id, namespace, version, identity, None)
            .await
    }
    #[allow(clippy::too_many_arguments)]
    async fn register_captured(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
        namespace: &str,
        version: &str,
        identity: &ContentIdentity,
        capture: &zobba_application::knowledge::EvidenceCapture,
    ) -> Result<RegisteredEvidence, EvidenceError> {
        self.register_impl(actor, s, id, namespace, version, identity, Some(capture))
            .await
    }
    async fn authorize(&self, actor: &str, s: &Scope) -> Result<(), EvidenceError> {
        let tx = self.begin(actor, s).await?;
        tx.commit().await.map_err(unavailable)
    }
}

impl EvidenceRepository {
    #[allow(clippy::too_many_arguments)]
    async fn register_impl(
        &self,
        actor: &str,
        s: &Scope,
        id: &str,
        namespace: &str,
        version: &str,
        identity: &ContentIdentity,
        capture: Option<&zobba_application::knowledge::EvidenceCapture>,
    ) -> Result<RegisteredEvidence, EvidenceError> {
        if version.is_empty()
            || version == "null"
            || version.len() > 512
            || version.chars().any(char::is_control)
        {
            return Err(EvidenceError::Invalid);
        }
        let mut tx = self.begin(actor, s).await?;
        let reserved = self.get_reservation(&mut tx, id).await?;
        if reserved.namespace != namespace || reserved.reservation.request.identity != *identity {
            return Err(EvidenceError::Conflict);
        }
        if let Some(previous) = reserved.registered {
            if previous.version != version {
                return Err(EvidenceError::Conflict);
            }
            if let Some(capture) = capture {
                crate::knowledge::capture_registered(&mut tx, actor, &previous, capture)
                    .await
                    .map_err(|_| EvidenceError::Unavailable)?;
            } else {
                crate::knowledge::pending_capture(&mut tx, actor, &previous)
                    .await
                    .map_err(|_| EvidenceError::Unavailable)?;
            }
            self.current(&mut tx, actor, s).await?;
            tx.commit().await.map_err(unavailable)?;
            return Ok(previous);
        }
        sqlx::query("INSERT INTO public.evidence_originals(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at,version) SELECT id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at,$2 FROM public.evidence_reservations WHERE id=$1").bind(id).bind(version).execute(&mut *tx).await.map_err(unavailable)?;
        let row = sqlx::query("SELECT * FROM public.evidence_originals WHERE id=$1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let result = evidence_row(&row)?;
        if let Some(capture) = capture {
            crate::knowledge::capture_registered(&mut tx, actor, &result, capture)
                .await
                .map_err(|_| EvidenceError::Unavailable)?;
        } else {
            crate::knowledge::pending_capture(&mut tx, actor, &result)
                .await
                .map_err(|_| EvidenceError::Unavailable)?;
        }
        self.current(&mut tx, actor, s).await?;
        tx.commit().await.map_err(unavailable)?;
        Ok(result)
    }
}
