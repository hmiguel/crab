use std::collections::HashMap;
use std::sync::Mutex;

use notify_debouncer_mini::notify::RecommendedWatcher;
use notify_debouncer_mini::Debouncer;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct AppState {
    /// In-flight requests by the run id the UI generated.
    pub runs: Mutex<HashMap<String, CancellationToken>>,
    /// Replaced on every `watch_roots` call; dropping it stops the old watches.
    pub watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}
