//! Verify the final acceptance boundary after its engagement-row lock wait.
use serde_json::Value;
use sqlx::{Connection, Executor, PgConnection, PgPool};
use std::time::{Duration, Instant};
use zobba_application::{identity::CurrentAuthority, membership::*};
use zobba_infrastructure::{
    identity::{IdentityRepository, secret_hash},
    membership::MembershipRepository,
};

async fn durable(admin: &mut PgConnection, invitation: &str, actor: &str) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('invitation',(SELECT to_jsonb(i) FROM membership_invitations i WHERE id=$1),'members',(SELECT count(*) FROM organisation_memberships WHERE organisation_id='org' AND actor_id=$2),'assignments',(SELECT count(*) FROM engagement_assignments WHERE organisation_id='org' AND actor_id=$2),'events',(SELECT count(*) FROM membership_events WHERE organisation_id='org' AND actor_id=$2))")
        .bind(invitation).bind(actor).fetch_one(admin).await.unwrap()
}

pub async fn verify(
    pool: &PgPool,
    admin: &mut PgConnection,
    repo: &MembershipRepository,
    issuer: &str,
    admin_url: &str,
) {
    let identities = IdentityRepository::new(pool.clone());
    for (index, age_proof) in [false, true].into_iter().enumerate() {
        let key = format!("repair-vg2-{index}");
        let secret = if age_proof { "p" } else { "q" }.repeat(43);
        let email = format!("repair-vg2-{index}@example.com");
        let invitation = repo
            .invite(
                "admin",
                "org",
                &InviteCommand {
                    key: key.clone(),
                    expected_version: "0".into(),
                    recipient_email: email.clone(),
                    roles: vec!["auditor".into()],
                    assignments: super::assignments(),
                    expires_in_seconds: 3600,
                    secret: secret.clone(),
                },
            )
            .await
            .unwrap();
        let id = invitation.invitation_id.unwrap();
        let token = identities
            .establish_verified_session(issuer, &key, "Waiting recipient", Some(&email), None)
            .await
            .unwrap();
        let actor = identities.session(&token).await.unwrap().identity.id;
        let hash = secret_hash(&token);
        let before = durable(admin, &id, &actor).await;
        let mut barrier = PgConnection::connect(admin_url).await.unwrap();
        let barrier_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut barrier)
            .await
            .unwrap();
        barrier.execute("BEGIN; SELECT id FROM engagements WHERE organisation_id='org' AND client_id='client' AND id='engagement' FOR UPDATE").await.unwrap();
        let pending_repo = repo.clone();
        let pending_actor = actor.clone();
        let pending_hash = hash.clone();
        let pending_secret = secret.clone();
        let pending_key = key.clone();
        let pending = tokio::spawn(async move {
            pending_repo
                .accept(&pending_actor, &pending_hash, &pending_secret, &pending_key)
                .await
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.datname=current_database() AND a.query LIKE '%membership_accept%' AND $1=ANY(pg_blocking_pids(a.pid)))").bind(barrier_pid).fetch_one(&mut *admin).await.unwrap();
            if blocked {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "acceptance did not reach the engagement fence"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        // The exact invocation is past its initial recipient check. Only the
        // second check can refuse these changes after the barrier is released.
        if age_proof {
            sqlx::query("UPDATE sessions SET verified_at=extract(epoch FROM clock_timestamp())::bigint-301 WHERE token_hash=$1").bind(&hash).execute(&mut *admin).await.unwrap();
        } else {
            identities.logout(&token).await.unwrap();
        }
        barrier.execute("COMMIT").await.unwrap();
        assert_eq!(
            pending.await.unwrap(),
            Err(MembershipError::InvitationRefused)
        );
        assert_eq!(
            durable(admin, &id, &actor).await,
            before,
            "a refused waiting acceptance changed durable authority or history"
        );
        sqlx::query("DELETE FROM membership_events WHERE organisation_id='org' AND actor_id='admin' AND command_key=$1").bind(&key).execute(&mut *admin).await.unwrap();
        sqlx::query("DELETE FROM membership_invitations WHERE id=$1")
            .bind(&id)
            .execute(&mut *admin)
            .await
            .unwrap();
        admin
            .execute("UPDATE membership_versions SET version=0 WHERE organisation_id='org'")
            .await
            .unwrap();
    }
}
