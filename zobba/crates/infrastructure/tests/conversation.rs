//! Actual restricted PostgreSQL projection, commit visibility, bounded history
//! and fresh audience proof. One parent test owns this disposable schema.
use sqlx::{Connection, Executor, PgConnection, postgres::PgPoolOptions};
use std::{collections::BTreeSet, time::Duration};
use zobba_application::{
    conversation::ConversationRead,
    task::{TaskCommands, TaskError},
};
use zobba_domain::{
    conversation::ConversationActivity,
    identity::Scope,
    task::{CommandKind, CommandReceipt, TaskCommand, WakeupRoute},
};
use zobba_infrastructure::{
    conversation::ConversationRepository, database_options, fixture::seed_local_configured,
    migrate, task::TaskRepository,
};
mod support;

fn scope(suffix: &str) -> Scope {
    Scope {
        organisation_id: format!("org-{suffix}"),
        client_id: format!("client-{suffix}"),
        engagement_id: format!("engagement-{suffix}"),
    }
}
fn create(key: &str, content: &str) -> TaskCommand {
    TaskCommand {
        key: key.into(),
        kind: CommandKind::Create,
        task_id: None,
        cycle_id: None,
        content: Some(content.into()),
    }
}
fn guide(key: &str, target: &CommandReceipt) -> TaskCommand {
    TaskCommand {
        key: key.into(),
        kind: CommandKind::Guide,
        task_id: Some(target.task_id.clone()),
        cycle_id: Some(target.cycle_id.clone()),
        content: Some(format!("Exact retained guidance {key}")),
    }
}

#[tokio::test]
async fn scoped_consistent_conversation_history_and_bounded_recovery() {
    let config = support::Configuration::from_environment();
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    seed_local_configured("https://127.0.0.1:4443", &config.migration)
        .await
        .unwrap();
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(2))
        .connect_with(
            database_options(&config.runtime)
                .unwrap()
                .application_name("zobba-conversation-contract"),
        )
        .await
        .unwrap();
    let commands = TaskRepository::new(pool.clone());
    let conversation = ConversationRepository::new(pool.clone());
    let a = scope("a");
    let empty = conversation.snapshot("actor-a", &a).await.unwrap();
    assert_eq!(empty.watermark, "0");
    assert_eq!(empty.latest_activity, None);
    assert!(empty.messages.is_empty() && empty.tasks.is_empty());
    assert_eq!(
        conversation
            .events("actor-a", &a, 0)
            .await
            .unwrap()
            .next_cursor,
        "0"
    );
    let first = commands
        .admit("actor-a", &a, &create("a", "Original A objective"))
        .await
        .unwrap();
    let second = commands
        .admit("actor-manager", &a, &create("b", "Original B objective"))
        .await
        .unwrap();
    let guidance = guide("guide-a", &first);
    let received = commands
        .admit("actor-manager", &a, &guidance)
        .await
        .unwrap();
    assert_eq!(
        commands
            .admit("actor-manager", &a, &guidance)
            .await
            .unwrap(),
        received
    );
    let mut changed = guidance.clone();
    changed.content = Some("Different meaning".into());
    assert_eq!(
        commands.admit("actor-manager", &a, &changed).await,
        Err(TaskError::Conflict)
    );
    let snap = conversation.snapshot("actor-a", &a).await.unwrap();
    assert_eq!(snap.watermark, "3");
    assert_eq!(
        snap.latest_activity,
        Some(ConversationActivity {
            cursor: received.event_cursor.clone(),
            task_id: first.task_id.clone(),
        })
    );
    assert_eq!(snap.tasks.len(), 2);
    assert_eq!(snap.messages.len(), 3);
    assert_eq!(snap.messages[0].author_id, "actor-a");
    assert_eq!(snap.messages[0].author_label, "Alex Auditor");
    assert_eq!(snap.messages[1].author_id, "actor-manager");
    assert_eq!(snap.messages[2].author_label, "Morgan Manager");
    assert_eq!(snap.messages[2].task_id, first.task_id);
    assert_ne!(snap.messages[2].task_id, second.task_id);
    assert_eq!(
        snap.messages[2].target_cycle_id.as_deref(),
        Some(first.cycle_id.as_str())
    );
    assert_eq!(snap.messages[2].command_id, received.command_id);
    assert_eq!(snap.messages[2].content, guidance.content);
    assert!(snap.messages.iter().all(|m| m.applied_cursor.is_none()));
    let route = WakeupRoute {
        id: first.task_id.clone(),
        actor_id: "actor-a".into(),
        scope: a.clone(),
        task_id: first.task_id.clone(),
    };
    commands
        .coordinate(&route, "projection-worker")
        .await
        .unwrap();
    let applied = conversation.snapshot("actor-a", &a).await.unwrap();
    assert!(applied.messages[2].applied_cursor.is_some());
    assert_eq!(
        applied.latest_activity,
        Some(ConversationActivity {
            cursor: applied.messages[2].applied_cursor.clone().unwrap(),
            task_id: first.task_id.clone(),
        })
    );
    let task = applied
        .tasks
        .iter()
        .find(|t| t.id == first.task_id)
        .unwrap();
    assert_eq!(task.objective, "Original A objective");
    assert_eq!(task.working_brief, guidance.content.clone().unwrap());
    assert_eq!(task.accountable_actor, "actor-a");
    assert_eq!(task.accountable_label, "Alex Auditor");
    assert!(
        conversation
            .history("actor-a", &a, 3, None, None)
            .await
            .unwrap()
            .messages
            .iter()
            .all(|m| m.applied_cursor.is_none()),
        "fixed snapshot history never imports later Applied facts"
    );

    // Preserve authorship after the author loses audit authority; never join the
    // current reader's membership to the historical author's retained label.
    admin.execute("UPDATE public.organisation_memberships SET roles=ARRAY['admin'] WHERE actor_id='actor-manager'").await.unwrap();
    assert_eq!(
        conversation.snapshot("actor-manager", &a).await,
        Err(TaskError::Denied)
    );
    assert_eq!(
        conversation.snapshot("actor-a", &a).await.unwrap().messages[2].author_label,
        "Morgan Manager"
    );
    for actor in ["actor-b", "actor-admin", "actor-unassigned"] {
        assert_eq!(
            conversation.snapshot(actor, &a).await,
            Err(TaskError::Denied)
        );
    }
    let foreign = commands
        .admit(
            "actor-b",
            &scope("b"),
            &create("foreign", "Foreign protected objective"),
        )
        .await
        .unwrap();
    assert_eq!(
        conversation
            .snapshot("actor-b", &scope("b"))
            .await
            .unwrap()
            .messages[0]
            .task_id,
        foreign.task_id
    );
    assert_eq!(
        conversation
            .history("actor-a", &a, 3, None, Some(&foreign.task_id))
            .await
            .unwrap()
            .messages
            .len(),
        0
    );

    // A writer held at commit cannot advance the snapshot watermark or leak
    // uncommitted text. Readers take no engagement lock and finish independently.
    admin.execute("CREATE FUNCTION public.conversation_commit_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(9026040099); RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER conversation_commit_gate AFTER INSERT ON public.task_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.conversation_commit_gate()").await.unwrap();
    admin
        .execute("SELECT pg_advisory_lock(9026040099)")
        .await
        .unwrap();
    let repo = commands.clone();
    let target = first.clone();
    let writer = tokio::spawn(async move {
        repo.admit("actor-a", &scope("a"), &guide("held-commit", &target))
            .await
            .unwrap()
    });
    tokio::time::timeout(Duration::from_secs(2),async {
        loop {
            let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='zobba-conversation-contract' AND wait_event='advisory')").fetch_one(&mut admin).await.unwrap();
            if waiting {break;} tokio::task::yield_now().await;
        }
    }).await.unwrap();
    let held = tokio::time::timeout(Duration::from_secs(1), conversation.snapshot("actor-a", &a))
        .await
        .expect("reader does not wait for a command commit")
        .unwrap();
    assert_eq!(held, applied);
    assert!(
        conversation
            .events("actor-a", &a, held.watermark.parse().unwrap())
            .await
            .unwrap()
            .events
            .is_empty()
    );
    admin
        .execute("SELECT pg_advisory_unlock(9026040099)")
        .await
        .unwrap();
    let held_receipt = writer.await.unwrap();
    admin.execute("DROP TRIGGER conversation_commit_gate ON public.task_commands; DROP FUNCTION public.conversation_commit_gate()").await.unwrap();
    assert_eq!(
        conversation
            .events("actor-a", &a, held.watermark.parse().unwrap())
            .await
            .unwrap()
            .events[0]
            .command_id
            .as_deref(),
        Some(held_receipt.command_id.as_str())
    );

    // Concurrent commits race every snapshot: head, last Received and current
    // intent must agree. Mixed sequential statements would violate this equality.
    let before = conversation.snapshot("actor-a", &a).await.unwrap();
    let baseline = before.watermark.parse::<u64>().unwrap();
    let baseline_intent = before
        .tasks
        .iter()
        .find(|t| t.id == first.task_id)
        .unwrap()
        .intent_revision;
    let repo = commands.clone();
    let target = first.clone();
    let burst = tokio::spawn(async move {
        for n in 0..205 {
            repo.admit(
                "actor-a",
                &scope("a"),
                &guide(&format!("race-{n}"), &target),
            )
            .await
            .unwrap();
        }
    });
    let mut snapshots = 0;
    while !burst.is_finished() {
        let snap = conversation.snapshot("actor-a", &a).await.unwrap();
        let head = snap.watermark.parse::<u64>().unwrap();
        assert_eq!(
            snap.latest_activity,
            Some(ConversationActivity {
                cursor: snap.watermark.clone(),
                task_id: first.task_id.clone(),
            }),
            "activity and watermark share the same commit snapshot"
        );
        assert_eq!(
            snap.messages.last().unwrap().received_cursor,
            snap.watermark
        );
        assert_eq!(
            snap.tasks
                .iter()
                .find(|t| t.id == first.task_id)
                .unwrap()
                .intent_revision,
            baseline_intent + head - baseline
        );
        snapshots += 1;
    }
    burst.await.unwrap();
    assert!(snapshots > 0);
    let current = conversation.snapshot("actor-a", &a).await.unwrap();
    assert_eq!(current.messages.len(), 100);
    assert!(current.before_cursor.is_some());
    let mut all = current.messages.clone();
    let mut before = current.before_cursor.clone();
    while let Some(cursor) = before {
        let page = conversation
            .history(
                "actor-a",
                &a,
                current.watermark.parse().unwrap(),
                Some(cursor.parse().unwrap()),
                None,
            )
            .await
            .unwrap();
        assert!(page.messages.len() <= 100);
        assert!(
            page.messages
                .last()
                .unwrap()
                .received_cursor
                .parse::<u64>()
                .unwrap()
                < cursor.parse::<u64>().unwrap()
        );
        before = page.before_cursor;
        all.extend(page.messages);
    }
    let expected: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.task_commands WHERE engagement_id='engagement-a'",
    )
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert_eq!(all.len() as i64, expected);
    assert_eq!(
        all.iter()
            .map(|m| &m.command_id)
            .collect::<BTreeSet<_>>()
            .len(),
        all.len()
    );
    let task_history = conversation
        .history(
            "actor-a",
            &a,
            current.watermark.parse().unwrap(),
            None,
            Some(&second.task_id),
        )
        .await
        .unwrap();
    assert_eq!(task_history.messages.len(), 1);
    assert_eq!(task_history.messages[0].command_id, second.command_id);
    let mut cursor = 0;
    let mut delivered = Vec::new();
    loop {
        let feed = conversation.events("actor-a", &a, cursor).await.unwrap();
        assert!(!feed.resync_required);
        assert!(feed.events.len() <= 100);
        for event in &feed.events {
            cursor += 1;
            assert_eq!(event.cursor, cursor.to_string());
        }
        assert_eq!(feed.next_cursor, cursor.to_string());
        delivered.extend(feed.events);
        if !feed.has_more {
            break;
        }
    }
    assert_eq!(cursor, current.watermark.parse::<u64>().unwrap());
    assert_eq!(delivered.len() as u64, cursor);
    let future = conversation
        .events("actor-a", &a, cursor + 1)
        .await
        .unwrap();
    assert!(future.resync_required);
    assert!(future.events.is_empty());
    assert_eq!(future.next_cursor, (cursor + 1).to_string());
    assert_eq!(
        conversation
            .history("actor-a", &a, cursor + 1, None, None)
            .await,
        Err(TaskError::Conflict)
    );
    // Force a synthetic missing row in this guarded fixture: an explicit resync
    // must replace continuity, never jump from cursor 1 to cursor 3.
    admin
        .execute("DELETE FROM public.task_events WHERE engagement_id='engagement-a' AND cursor=2")
        .await
        .unwrap();
    let gap = conversation.events("actor-a", &a, 0).await.unwrap();
    assert!(gap.resync_required);
    assert_eq!(gap.next_cursor, "0");
    assert!(gap.events.is_empty());
    for n in 0..1_001 {
        commands
            .admit("actor-a", &a, &guide(&format!("overflow-{n}"), &first))
            .await
            .unwrap();
    }
    let overflow = conversation.events("actor-a", &a, cursor).await.unwrap();
    assert!(overflow.resync_required);
    assert_eq!(overflow.next_cursor, cursor.to_string());
    assert!(overflow.events.is_empty());
    let resynced = conversation.snapshot("actor-a", &a).await.unwrap();
    assert!(
        !conversation
            .events("actor-a", &a, resynced.watermark.parse().unwrap())
            .await
            .unwrap()
            .resync_required
    );

    // An older command may reach a work boundary after its message leaves the
    // latest 100. Follow must still receive that exact Applied fact and Task.
    let older = commands
        .admit(
            "actor-a",
            &a,
            &create("older-activity", "Older activity objective"),
        )
        .await
        .unwrap();
    for n in 0..100 {
        commands
            .admit(
                "actor-a",
                &a,
                &guide(&format!("newer-than-activity-{n}"), &first),
            )
            .await
            .unwrap();
    }
    let before_applied = conversation.snapshot("actor-a", &a).await.unwrap();
    assert_eq!(before_applied.messages.len(), 100);
    assert!(
        before_applied
            .messages
            .iter()
            .all(|m| m.command_id != older.command_id)
    );
    assert_eq!(
        before_applied.latest_activity.as_ref().unwrap().task_id,
        first.task_id
    );
    commands
        .coordinate(
            &WakeupRoute {
                id: older.task_id.clone(),
                actor_id: "actor-a".into(),
                scope: a.clone(),
                task_id: older.task_id.clone(),
            },
            "older-activity-worker",
        )
        .await
        .unwrap();
    let after_applied = conversation.snapshot("actor-a", &a).await.unwrap();
    assert_eq!(after_applied.messages, before_applied.messages);
    let applied_cursor: String = sqlx::query_scalar(
        "SELECT cursor::text FROM public.task_events WHERE command_id=$1 AND kind='applied'",
    )
    .bind(&older.command_id)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert!(
        applied_cursor.parse::<u64>().unwrap() > before_applied.watermark.parse::<u64>().unwrap()
    );
    assert!(
        applied_cursor.parse::<u64>().unwrap() <= after_applied.watermark.parse::<u64>().unwrap()
    );
    assert_eq!(
        after_applied.latest_activity,
        Some(ConversationActivity {
            cursor: applied_cursor,
            task_id: older.task_id.clone(),
        })
    );
    assert!(
        conversation
            .history(
                "actor-a",
                &a,
                before_applied.watermark.parse().unwrap(),
                None,
                Some(&older.task_id)
            )
            .await
            .unwrap()
            .messages
            .iter()
            .all(|message| message.applied_cursor.is_none()),
        "latest activity does not change fixed-watermark historical facts"
    );
    assert_eq!(
        conversation
            .snapshot("actor-b", &scope("b"))
            .await
            .unwrap()
            .latest_activity,
        Some(ConversationActivity {
            cursor: foreign.event_cursor.clone(),
            task_id: foreign.task_id.clone(),
        }),
        "latest activity never follows a different engagement's newer events"
    );

    // Every endpoint rechecks current authority, including exact historical pages
    // and empty feeds, and pooled contexts cannot leak to the next actor/scope.
    admin
        .execute("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a'")
        .await
        .unwrap();
    assert_eq!(
        conversation.snapshot("actor-a", &a).await,
        Err(TaskError::Denied)
    );
    assert_eq!(
        conversation.history("actor-a", &a, 3, None, None).await,
        Err(TaskError::Denied)
    );
    assert_eq!(
        conversation.events("actor-a", &a, 0).await,
        Err(TaskError::Denied)
    );
    assert_eq!(
        conversation
            .snapshot("actor-b", &scope("b"))
            .await
            .unwrap()
            .messages
            .len(),
        1
    );
    for _ in 0..4 {
        let visible: i64 = sqlx::query_scalar("SELECT count(*) FROM public.task_commands")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(visible, 0);
    }
    pool.close().await;
}
