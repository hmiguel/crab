//! Thin Tauri glue over crab-core. No business logic here.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crab_core::error::{CrabError, ErrorKind};
use crab_core::exec::{execute, ExecOptions, ResponseData};
use crab_core::env::{self, EnvFiles, FileEnv};
use crab_core::history::{ListQuery, NewRun, PastRun, RequestKey, RunSummary};
use crab_core::model::{ParsedFile, ResolvedRequest};
use crab_core::{files, parser, prepare_request, request_key};
use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

use crate::state::AppState;

const STATE_FILES: &[&str] = &["workspace", "session"];

#[tauri::command]
pub fn parse_text(text: String) -> ParsedFile {
    parser::parse(&text)
}

#[tauri::command]
pub async fn run_request(
    state: State<'_, AppState>,
    run_id: String,
    path: Option<String>,
    text: String,
    line: usize,
    env: Option<String>,
    root: Option<String>,
) -> Result<ResponseData, CrabError> {
    let base_dir = path.as_deref().and_then(|p| Path::new(p).parent()).map(Path::to_path_buf);
    // Unsaved files have no folder to look for env files in.
    let files = match path.as_deref() {
        Some(p) => EnvFiles::discover(Path::new(p), root.as_deref().map(Path::new))?,
        None => EnvFiles::default(),
    };
    let provider = FileEnv::new(env.clone(), files);
    let key = request_key(&text, line);
    let request = prepare_request(&text, line, base_dir.as_deref(), &provider)?;
    let masked = request.masked();
    let at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
    let token = CancellationToken::new();
    state.runs.lock().unwrap().insert(run_id.clone(), token.clone());
    let result = execute(&request, &ExecOptions::default(), token).await;
    state.runs.lock().unwrap().remove(&run_id);
    let result = result.map(|mut response| {
        response.env = env.clone();
        response.has_secrets = request.has_secrets();
        response.request = masked.clone();
        response
    });
    let history_id = key.and_then(|key| record_run(&state, at_ms, path.clone(), key, env, &masked, &result));
    let mut response = result?;
    response.history_id = history_id;
    if response.has_secrets {
        state.remember_request(run_id, request);
    }
    Ok(response)
}

/// Save a sent run. A history failure never changes the run's result; it is surfaced through `history_status`.
fn record_run(
    state: &AppState,
    at_ms: i64,
    path: Option<String>,
    key: RequestKey,
    env: Option<String>,
    masked: &ResolvedRequest,
    result: &Result<ResponseData, CrabError>,
) -> Option<i64> {
    let run = NewRun::from_outcome(at_ms, path, key, env, masked, result)?;
    let guard = state.history.lock().unwrap();
    match guard.as_ref()?.record(&run) {
        Ok(id) => Some(id),
        Err(e) => {
            *state.history_error.lock().unwrap() = Some(e.message);
            None
        }
    }
}

#[derive(Serialize)]
pub struct HistoryStatus {
    enabled: bool,
    error: Option<String>,
}

#[tauri::command]
pub fn history_list(state: State<'_, AppState>, query: ListQuery) -> Vec<RunSummary> {
    let guard = state.history.lock().unwrap();
    guard.as_ref().and_then(|h| h.list(&query).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn history_get(state: State<'_, AppState>, id: i64) -> Option<PastRun> {
    let guard = state.history.lock().unwrap();
    guard.as_ref().and_then(|h| h.get(id).ok().flatten())
}

#[tauri::command]
pub fn history_clear(state: State<'_, AppState>) {
    if let Some(h) = state.history.lock().unwrap().as_ref() {
        if let Err(e) = h.clear() {
            *state.history_error.lock().unwrap() = Some(e.message);
        }
    }
}

#[tauri::command]
pub fn history_status(state: State<'_, AppState>) -> HistoryStatus {
    HistoryStatus { enabled: state.history.lock().unwrap().is_some(), error: state.history_error.lock().unwrap().clone() }
}

#[tauri::command]
pub fn reveal_request(state: State<'_, AppState>, run_id: String) -> Option<ResolvedRequest> {
    state.revealed_request(&run_id)
}

#[tauri::command]
pub async fn list_environments(roots: Vec<String>) -> env::EnvScan {
    let mut names = BTreeSet::new();
    let mut warnings = Vec::new();
    for root in &roots {
        let scan = env::scan_env_files(Path::new(root));
        names.extend(scan.names);
        warnings.extend(scan.warnings);
    }
    env::EnvScan { names: names.into_iter().collect(), warnings }
}

#[tauri::command]
pub fn cancel_request(state: State<'_, AppState>, run_id: String) {
    if let Some(token) = state.runs.lock().unwrap().remove(&run_id) {
        token.cancel();
    }
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, CrabError> {
    files::read_text(Path::new(&path))
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), CrabError> {
    files::write_atomic(Path::new(&path), contents.as_bytes())
}

#[tauri::command]
pub async fn list_http_files(root: String) -> Result<Vec<String>, CrabError> {
    files::find_http_files(Path::new(&root))
}

fn state_file(app: &AppHandle, name: &str) -> Result<PathBuf, CrabError> {
    if !STATE_FILES.contains(&name) {
        return Err(CrabError::new(ErrorKind::Io, format!("Unknown state file: {name}")));
    }
    let dir = app.path().app_data_dir().map_err(|e| CrabError::new(ErrorKind::Io, e.to_string()))?;
    Ok(dir.join(format!("{name}.json")))
}

#[tauri::command]
pub fn load_state(app: AppHandle, name: String) -> Result<Option<serde_json::Value>, CrabError> {
    files::load_json(&state_file(&app, &name)?)
}

#[tauri::command]
pub fn save_state(app: AppHandle, name: String, value: serde_json::Value) -> Result<(), CrabError> {
    let bytes = serde_json::to_vec_pretty(&value).map_err(|e| CrabError::new(ErrorKind::Io, e.to_string()))?;
    files::write_atomic(&state_file(&app, &name)?, &bytes)
}

#[tauri::command]
pub fn watch_roots(app: AppHandle, state: State<'_, AppState>, roots: Vec<String>) -> Result<(), CrabError> {
    let mut debouncer = new_debouncer(Duration::from_millis(300), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let paths: Vec<String> = events.into_iter().map(|e| e.path.to_string_lossy().into_owned()).collect();
            let _ = app.emit("fs-changed", paths);
        }
    })
    .map_err(|e| CrabError::new(ErrorKind::Io, format!("Cannot watch files: {e}")))?;
    for root in &roots {
        let path = Path::new(root);
        if path.is_dir() {
            let _ = debouncer.watcher().watch(path, RecursiveMode::Recursive);
        }
    }
    *state.watcher.lock().unwrap() = Some(debouncer);
    Ok(())
}
