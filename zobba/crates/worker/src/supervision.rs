//! Unexpected coordinator termination withdraws readiness before service exit.
use crate::diagnostics::{Code, Diagnostics};
use std::{
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::watch;
use zobba_application::BootstrapError;

pub const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(20);

struct Liveness(Arc<AtomicBool>);
impl Drop for Liveness {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

pub async fn wait_for_shutdown(mut shutdown: watch::Receiver<bool>) {
    while !*shutdown.borrow_and_update() {
        if shutdown.changed().await.is_err() {
            return;
        }
    }
}

pub async fn supervise<C, S, F>(
    coordinator: C,
    server: S,
    signal: F,
    shutdown: watch::Sender<bool>,
    healthy: Arc<AtomicBool>,
    diagnostics: Diagnostics,
) -> Result<(), BootstrapError>
where
    C: Future<Output = ()> + Send + 'static,
    S: Future<Output = Result<(), std::io::Error>>,
    F: Future<Output = ()>,
{
    let coordinator_health = healthy.clone();
    let mut coordinator = tokio::spawn(async move {
        let _liveness = Liveness(coordinator_health);
        coordinator.await;
    });
    tokio::pin!(server, signal);
    let unexpected = tokio::select! {
        biased;
        _ = &mut coordinator => {
            healthy.store(false, Ordering::Release);
            diagnostics.record(Code::CoordinatorFailed);
            let _ = shutdown.send(true);
            if tokio::time::timeout(SHUTDOWN_TIMEOUT, &mut server).await.is_err() {
                diagnostics.record(Code::ShutdownTimeout);
            }
            return Err(BootstrapError::ListenerUnavailable);
        },
        result = &mut server => Some(result),
        _ = &mut signal => None,
    };
    healthy.store(false, Ordering::Release);
    let _ = shutdown.send(true);
    if unexpected.is_some() {
        if tokio::time::timeout(SHUTDOWN_TIMEOUT, &mut coordinator)
            .await
            .is_err()
        {
            diagnostics.record(Code::ShutdownTimeout);
            coordinator.abort();
        }
        return Err(BootstrapError::ListenerUnavailable);
    }
    let drained = tokio::time::timeout(SHUTDOWN_TIMEOUT, async {
        let (service, coordinator) = tokio::join!(&mut server, &mut coordinator);
        service.map_err(|_| BootstrapError::ListenerUnavailable)?;
        coordinator.map_err(|_| BootstrapError::ListenerUnavailable)
    })
    .await;
    match drained {
        Ok(result) => result,
        Err(_) => {
            diagnostics.record(Code::ShutdownTimeout);
            coordinator.abort();
            Err(BootstrapError::ListenerUnavailable)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn live_http_service_exits_when_its_coordinator_unexpectedly_returns() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let healthy = Arc::new(AtomicBool::new(true));
        let endpoint_health = healthy.clone();
        let router = axum::Router::new().route(
            "/ready",
            axum::routing::get(move || {
                let endpoint_health = endpoint_health.clone();
                async move {
                    if endpoint_health.load(Ordering::Acquire) {
                        axum::http::StatusCode::OK
                    } else {
                        axum::http::StatusCode::SERVICE_UNAVAILABLE
                    }
                }
            }),
        );
        let (shutdown, receiver) = watch::channel(false);
        let (finish, finished) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(supervise(
            async move {
                let _ = finished.await;
            },
            async move {
                axum::serve(listener, router)
                    .with_graceful_shutdown(wait_for_shutdown(receiver))
                    .await
            },
            std::future::pending(),
            shutdown,
            healthy.clone(),
            Diagnostics::default(),
        ));
        let mut connection = tokio::net::TcpStream::connect(address).await.unwrap();
        connection
            .write_all(b"GET /ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        connection.read_to_string(&mut response).await.unwrap();
        assert!(response.starts_with("HTTP/1.1 200"));
        finish.send(()).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result, Err(BootstrapError::ListenerUnavailable));
        assert!(!healthy.load(Ordering::Acquire));
        assert!(tokio::net::TcpStream::connect(address).await.is_err());
    }

    #[tokio::test]
    async fn unexpected_coordinator_exit_withdraws_readiness_and_stops_service() {
        let (shutdown, receiver) = watch::channel(false);
        let healthy = Arc::new(AtomicBool::new(true));
        let watched = healthy.clone();
        let diagnostics = Diagnostics::default();
        let result = supervise(
            async {},
            async move {
                wait_for_shutdown(receiver).await;
                assert!(!watched.load(Ordering::Acquire));
                Ok(())
            },
            std::future::pending(),
            shutdown,
            healthy.clone(),
            diagnostics.clone(),
        )
        .await;
        assert_eq!(result, Err(BootstrapError::ListenerUnavailable));
        assert!(!healthy.load(Ordering::Acquire));
        assert_eq!(diagnostics.count(Code::CoordinatorFailed), 1);
    }

    #[tokio::test]
    async fn coordinator_panic_withdraws_readiness_before_join_is_handled() {
        let (shutdown, receiver) = watch::channel(false);
        let healthy = Arc::new(AtomicBool::new(true));
        let result = supervise(
            async { panic!("test coordinator failure") },
            async move {
                wait_for_shutdown(receiver).await;
                Ok(())
            },
            std::future::pending(),
            shutdown,
            healthy.clone(),
            Diagnostics::default(),
        )
        .await;
        assert_eq!(result, Err(BootstrapError::ListenerUnavailable));
        assert!(!healthy.load(Ordering::Acquire));
    }
}
