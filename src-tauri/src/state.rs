use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use notify_debouncer_mini::notify::RecommendedWatcher;
use notify_debouncer_mini::Debouncer;
use crab_core::model::ResolvedRequest;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct AppState {
    /// In-flight requests by the run id the UI generated.
    pub runs: Mutex<HashMap<String, CancellationToken>>,
    /// Replaced on every `watch_roots` call; dropping it stops the old watches.
    pub watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    /// Unmasked requests of the latest runs that had secrets, for "Reveal secrets". Memory only.
    pub revealed: Mutex<VecDeque<(String, ResolvedRequest)>>,
}

const REVEAL_CAP: usize = 20;

impl AppState {
    pub fn remember_request(&self, run_id: String, request: ResolvedRequest) {
        let mut revealed = self.revealed.lock().unwrap();
        revealed.push_back((run_id, request));
        while revealed.len() > REVEAL_CAP {
            revealed.pop_front();
        }
    }

    pub fn revealed_request(&self, run_id: &str) -> Option<ResolvedRequest> {
        self.revealed.lock().unwrap().iter().find(|(id, _)| id == run_id).map(|(_, r)| r.clone())
    }
}
