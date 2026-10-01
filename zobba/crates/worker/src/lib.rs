//! Bounded inert execution for the durable Task foundation.
pub mod diagnostics;
pub mod executor;
pub mod gateway;
pub mod supervision;

use rand::{RngCore, rngs::OsRng};
use std::{collections::HashMap, time::Duration};
use tokio::{sync::watch, task::JoinSet};
use zobba_application::task::{TaskDelivery, TaskError, TaskExecution};
use zobba_domain::task::{Decision, WakeupRoute};
use zobba_infrastructure::{RuntimeDatabase, dispatcher::Dispatcher, task::TaskRepository};

pub const MAX_CHILDREN: usize = 4;
const POLL_INTERVAL: Duration = Duration::from_millis(200);
pub const DATABASE_TIMEOUT: Duration = Duration::from_secs(2);
use diagnostics::{Code, Diagnostics};

async fn database_call<T>(
    future: impl std::future::Future<Output = Result<T, TaskError>>,
) -> Result<T, TaskError> {
    tokio::time::timeout(DATABASE_TIMEOUT, future)
        .await
        .unwrap_or(Err(TaskError::Unavailable))
}

/// One pool is shared by discovery, scoped coordination and health. No child
/// retains a SQL transaction or connection while it is running or being joined.
pub async fn coordinate(
    database: RuntimeDatabase,
    config: executor::Config,
    shutdown: watch::Receiver<bool>,
) {
    let dispatcher = Dispatcher::new(database.pool().clone());
    let repository = TaskRepository::new(database.pool().clone());
    coordinate_with(dispatcher, repository, config, shutdown).await;
}

/// Production orchestration uses inward ports. Test executables may wrap real
/// adapters; production contains no fault flags, bypasses or hook callbacks.
pub async fn coordinate_with<D, E>(
    dispatcher: D,
    repository: E,
    config: executor::Config,
    mut shutdown: watch::Receiver<bool>,
) where
    D: TaskDelivery + Clone + 'static,
    E: TaskExecution + Clone + 'static,
{
    if *shutdown.borrow() {
        return;
    }
    let diagnostics = config.diagnostics();
    let mut children = JoinSet::new();
    let mut active_tasks = HashMap::new();
    let mut ticker = tokio::time::interval(POLL_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let worker_id = worker_id();
    loop {
        tokio::select! {
            biased;
            _ = shutdown.changed() => break,
            joined = children.join_next(), if !children.is_empty() => {
                match joined {
                    Some(Ok(task_id)) => { active_tasks.remove(&task_id); },
                    Some(Err(error)) => {
                        diagnostics.record(Code::RunnerFailed);
                        active_tasks.retain(|_, id| *id != error.id());
                    },
                    None => {},
                }
            },
            _ = ticker.tick(), if children.len() < MAX_CHILDREN => {
                let routes = match database_call(dispatcher.take(MAX_CHILDREN - children.len(), &worker_id)).await {
                    Ok(routes) => routes,
                    Err(_) => { diagnostics.record(Code::DiscoveryFailed); continue; },
                };
                for route in routes {
                    if active_tasks.contains_key(&route.task_id) {
                        if database_call(dispatcher.release(&route, &worker_id)).await.is_err() {
                            diagnostics.record(Code::ReleaseFailed);
                        }
                        continue;
                    }
                    let task_id = route.task_id.clone();
                    let repository = repository.clone();
                    let dispatcher = dispatcher.clone();
                    let config = config.clone();
                    let worker_id = worker_id.clone();
                    let shutdown = shutdown.clone();
                    let returned_task_id = task_id.clone();
                    let handle = children.spawn(async move {
                        advance(repository, dispatcher, route, worker_id, config, shutdown).await;
                        returned_task_id
                    });
                    active_tasks.insert(task_id, handle.id());
                }
            }
        }
    }
    // Each active future observes shutdown, kills its own child, then joins the
    // exact handle before recording a late receipt. Aborting it would lose that
    // proof, so drain rather than abort tasks on graceful termination.
    while let Some(joined) = children.join_next().await {
        if joined.is_err() {
            diagnostics.record(Code::RunnerFailed);
        }
    }
}

async fn advance<D, E>(
    repository: E,
    dispatcher: D,
    route: WakeupRoute,
    worker_id: String,
    config: executor::Config,
    shutdown: watch::Receiver<bool>,
) where
    D: TaskDelivery,
    E: TaskExecution,
{
    let diagnostics: Diagnostics = config.diagnostics();
    let decision = database_call(repository.coordinate(&route, &worker_id)).await;
    if decision.is_err() {
        diagnostics.record(Code::CoordinationFailed);
    }
    // Ownership and dispatch consumption are scoped repository decisions.
    // Losing a delivery lease cannot cancel or confer execution authority.
    if database_call(dispatcher.release(&route, &worker_id))
        .await
        .is_err()
    {
        diagnostics.record(Code::ReleaseFailed);
    }
    if *shutdown.borrow() {
        return;
    }
    if let Ok(Decision::Execute(basis)) = decision {
        // A timeout may follow committed consumption. Never retry or spawn
        // without the returned exact-attempt capability; recovery stays unsure.
        let attempt = match database_call(repository.consume(&basis)).await {
            Ok(attempt) => attempt,
            Err(error) => {
                diagnostics.record(if error == TaskError::Unavailable {
                    Code::ConsumptionUncertain
                } else {
                    Code::CoordinationFailed
                });
                return;
            }
        };
        let observation = executor::execute(&config, &attempt.basis, shutdown, || {
            repository.current(&attempt.basis)
        })
        .await;
        if let Some(observation) = observation {
            // A capability grants only an immutable fact, even after authority
            // or ownership was lost. Never log or expose this secret.
            for retry in 0..5 {
                match database_call(repository.observe(&attempt, observation)).await {
                    Ok(()) => {
                        if database_call(repository.reconcile(&route, &worker_id))
                            .await
                            .is_err()
                        {
                            diagnostics.record(Code::ReconciliationFailed);
                        }
                        break;
                    }
                    Err(TaskError::Unavailable) if retry < 4 => {
                        diagnostics.record(Code::ReceiptWriteFailed);
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                    Err(_) => {
                        diagnostics.record(Code::ReceiptRetriesExhausted);
                        break;
                    }
                }
            }
        }
    }
}

fn worker_id() -> String {
    let mut bytes = [0_u8; 16];
    OsRng.fill_bytes(&mut bytes);
    let mut value = String::from("worker_");
    for byte in bytes {
        use std::fmt::Write;
        write!(value, "{byte:02x}").expect("writing to a String cannot fail");
    }
    value
}
