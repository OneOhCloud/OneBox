use std::future::Future;

/// A failed replacement restores the last validated configuration before returning the failure.
pub async fn replace<T, F, Fut>(previous: T, next: T, mut activate: F) -> Result<(), String>
where
    F: FnMut(T) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    if let Err(error) = activate(next).await {
        return match activate(previous).await {
            Ok(()) => Err(format!(
                "activation failed: {error}; previous configuration restored"
            )),
            Err(rollback) => Err(format!(
                "activation failed: {error}; rollback failed: {rollback}"
            )),
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn failed_activation_rolls_back_once() {
        let mut calls = Vec::new();
        let result = replace("old", "new", |config| {
            calls.push(config);
            std::future::ready(if config == "new" {
                Err("kernel exited".into())
            } else {
                Ok(())
            })
        })
        .await;
        assert!(result.unwrap_err().contains("restored"));
        assert_eq!(calls, ["new", "old"]);
    }
    #[tokio::test]
    async fn successful_activation_does_not_restart_again() {
        let mut calls = Vec::new();
        replace("old", "new", |config| {
            calls.push(config);
            std::future::ready(Ok(()))
        })
        .await
        .unwrap();
        assert_eq!(calls, ["new"]);
    }
    #[tokio::test]
    async fn rollback_failure_is_reported_without_retry_loop() {
        let mut calls = Vec::new();
        let result = replace("old", "new", |config| {
            calls.push(config);
            std::future::ready(Err("service unavailable".into()))
        })
        .await;
        assert!(result.unwrap_err().contains("rollback failed"));
        assert_eq!(calls, ["new", "old"]);
    }
}
