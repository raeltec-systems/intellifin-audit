//! Operator provisioning of a first organisation Admin: fresh, exact retry,
//! conflicting retries refused with no change, and READ COMMITTED selection.
use sqlx::{Connection, Executor, PgConnection};
use zobba_application::BootstrapError;
use zobba_infrastructure::{
    database_options, migrate,
    provision::{
        OrganisationProvision, ProvisionError, ProvisionOutcome, derived_identity_id,
        provision_organisation,
    },
};
mod support;
use support::Configuration;
#[path = "support/isolation.rs"]
mod isolation;

const ISSUER: &str = "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_Provision1";
const SUBJECT: &str = "11111111-2222-4333-8444-555555555555";

async fn state(admin: &mut PgConnection) -> Vec<String> {
    let mut rows = Vec::new();
    for table in [
        "identities",
        "organisations",
        "organisation_memberships",
        "membership_versions",
        "zobba_bootstrap",
    ] {
        rows.push(sqlx::query_scalar::<_,String>(&format!("SELECT coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'empty') FROM public.{table} t")).fetch_one(&mut *admin).await.unwrap());
    }
    rows
}

fn request(id: &str, name: &str, subject: &str) -> OrganisationProvision {
    OrganisationProvision::new(id, name, ISSUER, subject, "Casey Administrator").unwrap()
}

async fn reset(config: &Configuration, owner: &mut PgConnection) {
    config.guard_connection(owner).await;
    owner
        .execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        .await
        .unwrap();
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn provisioning_is_exact_idempotent_and_refuses_conflicts_without_change() {
    let config = Configuration::from_environment();
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    reset(&config, &mut owner).await;
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;

    // A stale snapshot default must not leak into provisioning, and two
    // concurrent exact requests create exactly one organisation and Admin.
    let first = request("org-first", "Northstar LLP", SUBJECT);
    let (left, right) = isolation::with_migration_default(&config, "repeatable read", || async {
        tokio::join!(
            provision_organisation(&config.migration, &first),
            provision_organisation(&config.migration, &first)
        )
    })
    .await;
    let identity_id = derived_identity_id(ISSUER, SUBJECT);
    let mut outcomes = [left.unwrap(), right.unwrap()];
    outcomes.sort_by_key(|outcome| outcome.code());
    assert_eq!(
        outcomes,
        [
            ProvisionOutcome::AlreadyProvisioned {
                identity_id: identity_id.clone()
            },
            ProvisionOutcome::Provisioned {
                identity_id: identity_id.clone()
            },
        ]
    );
    let row: (String, String, String, String, bool) = sqlx::query_as(
        "SELECT id,issuer,subject,display_name,active FROM public.identities WHERE id=$1",
    )
    .bind(&identity_id)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        row,
        (
            identity_id.clone(),
            ISSUER.into(),
            SUBJECT.into(),
            "Casey Administrator".into(),
            true
        )
    );
    let membership: (Vec<String>, bool, Option<i64>) = sqlx::query_as(
        "SELECT roles,active,expires_at FROM public.organisation_memberships WHERE organisation_id='org-first' AND actor_id=$1",
    )
    .bind(&identity_id)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(membership, (vec!["admin".to_owned()], true, None));
    let after_first = state(&mut admin).await;

    // Exact retry, including a sign-in display-name refresh, changes nothing.
    admin
        .execute("UPDATE public.identities SET display_name='Casey (signed in)'")
        .await
        .unwrap();
    let refreshed = state(&mut admin).await;
    assert_eq!(
        provision_organisation(&config.migration, &first).await,
        Ok(ProvisionOutcome::AlreadyProvisioned {
            identity_id: identity_id.clone()
        })
    );
    assert_eq!(state(&mut admin).await, refreshed);
    assert_ne!(refreshed, after_first);

    // Conflicting retries refuse with a fixed code and leave state unchanged.
    for (conflict, expected) in [
        (
            request("org-first", "Different Name", SUBJECT),
            ProvisionError::OrganisationConflict,
        ),
        (
            request("org-first", "Northstar LLP", "another-subject"),
            ProvisionError::OrganisationConflict,
        ),
    ] {
        assert_eq!(
            provision_organisation(&config.migration, &conflict).await,
            Err(expected)
        );
        assert_eq!(state(&mut admin).await, refreshed, "{expected:?}");
    }

    // A widened or expiring Admin membership is not the provisioned state, and is
    // never narrowed, extended or cleared by a retry.
    let mut extra = admin.begin().await.unwrap();
    extra
        .execute("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('second-admin','other','second','Second')")
        .await
        .unwrap();
    extra.execute("INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-first','second-admin',ARRAY['admin'])").await.unwrap();
    sqlx::query("UPDATE public.organisation_memberships SET roles=ARRAY['admin','auditor'] WHERE actor_id=$1")
        .bind(&identity_id)
        .execute(&mut *extra)
        .await
        .unwrap();
    extra.commit().await.unwrap();
    let widened = state(&mut admin).await;
    assert_eq!(
        provision_organisation(&config.migration, &first).await,
        Err(ProvisionError::OrganisationConflict)
    );
    assert_eq!(state(&mut admin).await, widened);
    sqlx::query("UPDATE public.organisation_memberships SET roles=ARRAY['admin'],expires_at=4102444800 WHERE actor_id=$1")
        .bind(&identity_id)
        .execute(&mut admin)
        .await
        .unwrap();
    let expiring = state(&mut admin).await;
    assert_eq!(
        provision_organisation(&config.migration, &first).await,
        Err(ProvisionError::OrganisationConflict)
    );
    assert_eq!(state(&mut admin).await, expiring);

    // An inactive existing identity is never reactivated for a new organisation.
    admin.execute("INSERT INTO public.identities(id,issuer,subject,display_name,active) VALUES('inactive-one','https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_Provision1','inactive-subject','Inactive',false)").await.unwrap();
    let inactive = state(&mut admin).await;
    assert_eq!(
        provision_organisation(
            &config.migration,
            &request("org-second", "Meridian", "inactive-subject")
        )
        .await,
        Err(ProvisionError::IdentityInactive)
    );
    assert_eq!(state(&mut admin).await, inactive);

    // An identity created by an earlier sign-in keeps its own ID.
    admin.execute("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('signed-in-random','https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_Provision1','signed-in','Drew')").await.unwrap();
    assert_eq!(
        provision_organisation(
            &config.migration,
            &request("org-third", "Beacon", "signed-in")
        )
        .await,
        Ok(ProvisionOutcome::Provisioned {
            identity_id: "signed-in-random".into()
        })
    );

    // A schema that is not exactly current refuses before any write.
    owner
        .execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        .await
        .unwrap();
    assert_eq!(
        provision_organisation(&config.migration, &first).await,
        Err(ProvisionError::Bootstrap(BootstrapError::SchemaMismatch))
    );
    reset(&config, &mut owner).await;
}
